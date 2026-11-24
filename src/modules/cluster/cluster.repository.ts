import type { DbClient } from "../../core/db.js";
import { num } from "../../core/db.js";

/** Read-only views across every maker of one cluster (the cooperative's ledger). */
export class ClusterRepository {
  constructor(private readonly db: DbClient) {}

  cluster(id: string) {
    return this.db.cluster.findUnique({ where: { id }, select: { id: true, slug: true, name: true, city: true, state: true, industry: { select: { name: true, nameHi: true, machine: true, machineHi: true } } } });
  }

  async adminCluster(userId: string): Promise<string | null> {
    const u = await this.db.user.findUnique({ where: { id: userId }, select: { clusterId: true, role: true } });
    return u?.role === "CLUSTER_ADMIN" ? u.clusterId : null;
  }

  makers(clusterId: string) {
    return this.db.producer.findMany({
      where: { clusterId, onboardedAt: { not: null } },
      select: {
        id: true, slug: true, name: true, businessName: true, machines: true, onTimeRate: true, ordersDone: true, agentCutPct: true,
        gstin: true, gstScheme: true, udyamNumber: true, avatarColor: true, state: true,
      },
      orderBy: { machines: "desc" },
    });
  }

  /** Pieces made per producer since a date. */
  async madeSince(producerIds: string[], since: Date): Promise<Map<string, number>> {
    const rows = await this.db.stockMovement.groupBy({
      by: ["producerId"], where: { producerId: { in: producerIds }, kind: "PRODUCE", productId: { not: null }, createdAt: { gte: since } }, _sum: { qty: true },
    });
    return new Map(rows.map((r) => [r.producerId, Math.abs(num(r._sum.qty))]));
  }

  /** Taxable sales per producer since a date (tax invoices + bills of supply). */
  async salesSince(producerIds: string[], since: Date): Promise<Map<string, { value: number; count: number }>> {
    const rows = await this.db.invoice.groupBy({
      by: ["producerId"], where: { producerId: { in: producerIds }, kind: { in: ["TAX", "BILL_OF_SUPPLY"] }, issuedAt: { gte: since } },
      _sum: { taxable: true }, _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.producerId, { value: num(r._sum.taxable), count: r._count._all }]));
  }

  /** Orders per producer and status. */
  async orderCounts(producerIds: string[]) {
    const rows = await this.db.order.groupBy({ by: ["producerId", "status"], where: { producerId: { in: producerIds } }, _count: { _all: true } });
    return rows.map((r) => ({ producerId: r.producerId, status: r.status, count: r._count._all }));
  }

  /** Delivered orders that came through Sutra (no agent in between) since a date: the agent's cut stays with the maker. */
  async directDelivered(producerIds: string[], since: Date) {
    const rows = await this.db.order.findMany({
      where: { producerId: { in: producerIds }, status: "DELIVERED", channel: { in: ["MARKETPLACE", "DIRECT"] }, deliveredAt: { gte: since } },
      select: { producerId: true, qty: true, rate: true },
    });
    return rows.map((r) => ({ producerId: r.producerId, value: r.qty * num(r.rate) }));
  }
}
