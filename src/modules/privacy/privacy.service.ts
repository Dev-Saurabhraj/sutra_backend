import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { Clock } from "../../shared/time.js";

/** GST law (CGST Act s.36) keeps tax records for 72 months after the year's annual return. */
export const TAX_RECORD_NOTE =
  "Tax invoices and purchase bills are kept for 6 years because GST law requires it (CGST Act, section 36); they are no longer linked to a login.";
export const TAX_RECORD_NOTE_HI = "GST क़ानून (धारा 36) के कारण टैक्स बिल 6 साल रखे जाते हैं; वे अब किसी लॉगिन से नहीं जुड़े।";

/**
 * X4 (DPDP Act 2023): a person can take all their data with them, and can delete their account.
 * Deleting removes the login and personal details and hides the business; legally required tax records stay.
 */
export class PrivacyService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async export(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { id: true, phone: true, role: true, language: true, consentVersion: true, consentAt: true, createdAt: true, producerId: true, buyerId: true } });
    if (!user) throw AppError.unauthorized();
    const pid = user.producerId;
    const producer = pid
      ? await this.db.producer.findUnique({
          where: { id: pid },
          include: {
            materials: true, products: { include: { recipe: true } }, ownSuppliers: true, clients: true, orders: { include: { messages: true } },
            invoices: true, ledger: true, purchases: { include: { items: true } }, workers: true, workEntries: true, workerPayments: true,
            voiceEntries: true, capacityEvents: true, alerts: true,
          },
        })
      : null;
    const buyer = user.buyerId ? await this.db.buyer.findUnique({ where: { id: user.buyerId }, include: { orders: { include: { messages: true, invoices: true } } } }) : null;
    return {
      filename: `sutra-data-${this.clock.now().toISOString().slice(0, 10)}.json`,
      data: { exportedAt: this.clock.now(), format: "sutra-export-v1", user, producer, buyer },
    };
  }

  async deleteAccount(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    await this.db.$transaction(async (tx) => {
      if (user.producerId) {
        await tx.product.updateMany({ where: { producerId: user.producerId }, data: { published: false } });
        await tx.producer.update({
          where: { id: user.producerId },
          data: { name: "Deleted account", phone: "", story: "", upiId: null, udyamNumber: null, onboardedAt: null, marks: [] },
        });
        await tx.worker.updateMany({ where: { producerId: user.producerId }, data: { phone: null } });
      }
      // access grants go with the account, on either side
      if (user.producerId) await tx.caAccess.updateMany({ where: { producerId: user.producerId }, data: { status: "REVOKED", revokedAt: this.clock.now() } });
      await tx.caAccess.deleteMany({ where: { caUserId: userId } });
      if (user.buyerId) await tx.buyer.update({ where: { id: user.buyerId }, data: { name: "Deleted account", phone: "" } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });
      await tx.user.delete({ where: { id: userId } });
    });
    return { deleted: true, kept: TAX_RECORD_NOTE, keptHi: TAX_RECORD_NOTE_HI };
  }
}
