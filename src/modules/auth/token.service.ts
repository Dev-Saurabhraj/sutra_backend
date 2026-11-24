import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../../core/errors.js";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

/** pid: the producer the user acts for; bid: the buyer business (marketplace accounts). */
export type AccessClaims = { sub: string; pid: string | null; bid: string | null; role: string };

/** Signs and verifies tokens; hashes secrets before they touch the database (RULES A7). */
export class TokenService {
  constructor(
    private readonly accessSecret: string,
    private readonly pepper: string,
  ) {}

  signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.accessSecret, { expiresIn: ACCESS_TTL_SEC, issuer: "sutra" });
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const payload = jwt.verify(token, this.accessSecret, { issuer: "sutra" });
      if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("bad payload");
      return {
        sub: payload.sub,
        pid: (payload.pid as string | null) ?? null,
        bid: (payload.bid as string | null) ?? null,
        role: String(payload.role),
      };
    } catch {
      throw AppError.unauthorized();
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  newOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }

  hashOtp(phone: string, code: string): string {
    return createHmac("sha256", this.pepper).update(`${phone}:${code}`).digest("hex");
  }

  otpMatches(phone: string, code: string, hash: string): boolean {
    const a = Buffer.from(this.hashOtp(phone, code), "hex");
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
