import type { Logger } from "../../core/logger.js";

/** Strategy for delivering OTPs. Phase 1 logs them; Phase 6 adds SMS / WhatsApp authentication templates. */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

export class LogOtpSender implements OtpSender {
  constructor(private readonly logger: Logger) {}

  async send(phone: string, code: string): Promise<void> {
    // Development only: the code is printed so the team can log in without an SMS provider.
    this.logger.info({ phone, otp: code }, "OTP (development delivery)");
  }
}
