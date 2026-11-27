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
  cluster: { id: string; name: string; city: string };
  industry: IndustryProfile;
};

export class ProducerRepository {
  constructor(private readonly db: DbClient) {}

  async findProfile(producerId: string): Promise<ProducerProfile | null> {
    const p = await this.db.producer.findUnique({
      where: { id: producerId },
      include: { industry: true, cluster: true },
    });
    if (!p) return null;
    const cluster = p.cluster;
    return {
      id: p.id, slug: p.slug, name: p.name, businessName: p.businessName, city: p.city, state: p.state, phone: p.phone,
      gstin: p.gstin, gstScheme: p.gstScheme, udyamNumber: p.udyamNumber, upiId: p.upiId, machines: p.machines,
      avatarColor: p.avatarColor, language: p.language, story: p.story, onTimeRate: p.onTimeRate, ordersDone: p.ordersDone,
      cluster: cluster ? { id: cluster.id, name: cluster.name, city: cluster.city } : { id: "", name: "-", city: "" },
      industry: {
        key: p.industry.key, name: p.industry.name, nameHi: p.industry.nameHi,
        machine: p.industry.machine, machineHi: p.industry.machineHi, emoji: p.industry.emoji,
      },
    };
  }

  async updateLanguage(producerId: string, language: string): Promise<void> {
    await this.db.producer.update({ where: { id: producerId }, data: { language } });
  }
}
