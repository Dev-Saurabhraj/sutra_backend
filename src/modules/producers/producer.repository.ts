import type { Prisma } from "@prisma/client";
import type { DbClient } from "../../core/db.js";
import type { GstSchemeKind } from "../../shared/gst/tax.js";

export type IndustryProfile = { key: string; name: string; nameHi: string; machine: string; machineHi: string; emoji: string };

export type ProducerProfile = {
  id: string;
  slug: string;
  name: string;
  businessName: string;
  city: string;
  state: string;
  phone: string;
  gstin: string | null;
  gstScheme: GstSchemeKind;
  udyamNumber: string | null;
  upiId: string | null;
  machines: number;
  avatarColor: string;
  language: string;
  story: string;
  onTimeRate: number;
  ordersDone: number;
  businessKind: "MAKER" | "TRADER";
  onboardedAt: Date | null;
  cluster: { id: string; name: string; city: string } | null;
  industry: IndustryProfile;
};

export class ProducerRepository {
  constructor(private readonly db: DbClient) {}

  async findProfile(producerId: string): Promise<ProducerProfile | null> {
    const p = await this.db.producer.findUnique({ where: { id: producerId }, include: { cluster: true, industry: true } });
    if (!p) return null;
    const { cluster, industry } = p;
    return {
      id: p.id, slug: p.slug, name: p.name, businessName: p.businessName, city: p.city, state: p.state, phone: p.phone,
      gstin: p.gstin, gstScheme: p.gstScheme, udyamNumber: p.udyamNumber, upiId: p.upiId, machines: p.machines,
      avatarColor: p.avatarColor, language: p.language, story: p.story, onTimeRate: p.onTimeRate, ordersDone: p.ordersDone,
      businessKind: p.businessKind, onboardedAt: p.onboardedAt,
      cluster: cluster ? { id: cluster.id, name: cluster.name, city: cluster.city } : null,
      industry: {
        key: industry.key, name: industry.name, nameHi: industry.nameHi,
        machine: industry.machine, machineHi: industry.machineHi, emoji: industry.emoji,
      },
    };
  }

  async create(data: Prisma.ProducerUncheckedCreateInput): Promise<{ id: string }> {
    return this.db.producer.create({ data, select: { id: true } });
  }

  /** Industries are reference data; make sure the chosen one exists (new industries come from templates). */
  async ensureIndustry(row: Prisma.IndustryCreateInput): Promise<void> {
    await this.db.industry.upsert({ where: { key: row.key }, update: {}, create: row });
  }

  async updateLanguage(producerId: string, language: string): Promise<void> {
    await this.db.producer.update({ where: { id: producerId }, data: { language } });
  }
}
