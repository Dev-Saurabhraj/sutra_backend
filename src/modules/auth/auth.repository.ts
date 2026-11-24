import type { DbClient } from "../../core/db.js";

export class AuthRepository {
  constructor(private readonly db: DbClient) {}

  findUserByPhone(phone: string) {
    return this.db.user.findUnique({ where: { phone } });
  }

  findUserById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  countOtpsSince(phone: string, since: Date) {
    return this.db.otpChallenge.count({ where: { phone, createdAt: { gte: since } } });
  }

  createOtp(data: { phone: string; codeHash: string; expiresAt: Date }) {
    return this.db.otpChallenge.create({ data });
  }

  latestOpenOtp(phone: string, now: Date) {
    return this.db.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
  }

  incrementOtpAttempts(id: string) {
    return this.db.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  consumeOtp(id: string, at: Date) {
    return this.db.otpChallenge.update({ where: { id }, data: { consumedAt: at } });
  }

  createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.db.refreshToken.create({ data });
  }

  findRefreshToken(tokenHash: string) {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  /** Revoke if still active. Returns false when the token was already used (possible theft → caller revokes all). */
  async revokeRefreshToken(id: string, at: Date): Promise<boolean> {
    const r = await this.db.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
    return r.count === 1;
  }

  revokeAllForUser(userId: string, at: Date) {
    return this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  }

  recordConsent(userId: string, version: string, at: Date) {
    return this.db.user.update({ where: { id: userId }, data: { consentVersion: version, consentAt: at } });
  }

  setLanguage(userId: string, language: string) {
    return this.db.user.update({ where: { id: userId }, data: { language } });
  }
}
