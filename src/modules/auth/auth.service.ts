import { AppError } from "../../core/errors.js";
import type { Clock } from "../../shared/time.js";
import { addDays } from "../../shared/time.js";
import type { AuthRepository } from "./auth.repository.js";
import type { OtpSender } from "./otp-sender.js";
import { ACCESS_TTL_SEC, REFRESH_TTL_DAYS, type TokenService } from "./token.service.js";

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_WINDOW_MS = 15 * 60_000;
const OTP_MAX_PER_WINDOW = 3;
export const CONSENT_VERSION = "2026-11-v1";

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  user: { id: string; phone: string; role: string; producerId: string | null; language: string; needsConsent: boolean; needsOnboarding: boolean };
};

/** India mobile numbers → E.164. Accepts "98000 00001", "+91-98000-00001", "09800000001". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) throw AppError.badRequest("BAD_PHONE", "Enter a 10-digit Indian mobile number");
  return `+91${local}`;
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly sender: OtpSender,
    private readonly clock: Clock,
    private readonly devOtp: string | null,
  ) {}

  async requestOtp(rawPhone: string): Promise<{ phone: string; expiresInSec: number; devOtpEnabled: boolean }> {
    const phone = normalizePhone(rawPhone);
    const now = this.clock.now();
    // New numbers are welcome: the account is created on first successful verification, then onboarding follows.
    const recent = await this.repo.countOtpsSince(phone, new Date(now.getTime() - OTP_WINDOW_MS));
    if (recent >= OTP_MAX_PER_WINDOW) throw AppError.tooMany("Too many codes requested. Try again in 15 minutes.");

    const code = this.tokens.newOtp();
    await this.repo.createOtp({ phone, codeHash: this.tokens.hashOtp(phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS) });
    await this.sender.send(phone, code);
    return { phone, expiresInSec: OTP_TTL_MS / 1000, devOtpEnabled: this.devOtp !== null };
  }

  async verifyOtp(rawPhone: string, code: string): Promise<Session> {
    const phone = normalizePhone(rawPhone);
    const now = this.clock.now();
    const challenge = await this.repo.latestOpenOtp(phone, now);
    if (!challenge) throw AppError.badRequest("OTP_EXPIRED", "The code has expired. Ask for a new one.");
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw AppError.tooMany("Too many wrong codes. Ask for a new one.");

    const ok = this.tokens.otpMatches(phone, code, challenge.codeHash) || (this.devOtp !== null && code === this.devOtp);
    if (!ok) {
      await this.repo.incrementOtpAttempts(challenge.id);
      throw AppError.badRequest("OTP_WRONG", "That code is not right. Please check and try again.");
    }
    await this.repo.consumeOtp(challenge.id, now);
    const user = (await this.repo.findUserByPhone(phone)) ?? (await this.repo.createUser(phone));
    return this.issueSession(user);
  }

  /** Rotate: the old refresh token dies, a new one is issued. Reuse of a dead token revokes every session. */
  async refresh(refreshToken: string): Promise<Session> {
    const now = this.clock.now();
    const row = await this.repo.findRefreshToken(this.tokens.hashRefresh(refreshToken));
    if (!row || row.expiresAt <= now) throw AppError.unauthorized();
    if (!(await this.repo.revokeRefreshToken(row.id, now))) {
      await this.repo.revokeAllForUser(row.userId, now);
      throw AppError.unauthorized("This session was used elsewhere. Please log in again.");
    }
    const user = await this.repo.findUserById(row.userId);
    if (!user) throw AppError.unauthorized();
    return this.issueSession(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const row = await this.repo.findRefreshToken(this.tokens.hashRefresh(refreshToken));
    if (row) await this.repo.revokeRefreshToken(row.id, this.clock.now());
  }

  /** A fresh session for a user, e.g. right after onboarding links them to their new business. */
  async sessionFor(userId: string): Promise<Session> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw AppError.unauthorized();
    return this.issueSession(user);
  }

  async recordConsent(userId: string, version: string): Promise<void> {
    if (version !== CONSENT_VERSION) throw AppError.badRequest("CONSENT_OUTDATED", "Please read the latest privacy notice");
    await this.repo.recordConsent(userId, version, this.clock.now());
  }

  private async issueSession(user: { id: string; phone: string; role: string; producerId: string | null; language: string; consentVersion: string | null }): Promise<Session> {
    const { token, hash } = this.tokens.newRefreshToken();
    await this.repo.createRefreshToken({ userId: user.id, tokenHash: hash, expiresAt: addDays(this.clock.now(), REFRESH_TTL_DAYS) });
    return {
      accessToken: this.tokens.signAccess({ sub: user.id, pid: user.producerId, role: user.role }),
      refreshToken: token,
      expiresInSec: ACCESS_TTL_SEC,
      user: {
        id: user.id, phone: user.phone, role: user.role, producerId: user.producerId, language: user.language,
        needsConsent: user.consentVersion !== CONSENT_VERSION,
        needsOnboarding: user.producerId === null,
      },
    };
  }
}
