import type { LedgerDirection } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";

export type LedgerRow = {
  id: string;
  party: string;
  direction: LedgerDirection;
  amount: number;
  note: string;
  dueDate: Date | null;
  settled: boolean;
  settledAt: Date | null;
  invoiceNo: string | null;
  createdAt: Date;
};

export class KhataRepository {
  constructor(private readonly db: DbClient) {}

  async list(producerId: string, settled: boolean): Promise<LedgerRow[]> {
    const rows = await this.db.ledgerEntry.findMany({
      where: { producerId, settled },
      orderBy: settled ? [{ settledAt: "desc" }, { createdAt: "desc" }] : [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: settled ? 50 : 200,
    });
    return rows.map(toRow);
  }

  async find(producerId: string, id: string): Promise<LedgerRow | null> {
    const row = await this.db.ledgerEntry.findFirst({ where: { id, producerId } });
    return row ? toRow(row) : null;
  }

  async create(data: { producerId: string; party: string; direction: LedgerDirection; amount: number; note: string; dueDate?: Date; invoiceNo?: string }) {
    return toRow(await this.db.ledgerEntry.create({ data }));
  }

  /** Settle only if still open; returns false when someone else already settled it. */
  async settle(producerId: string, id: string, at: Date): Promise<boolean> {
    const r = await this.db.ledgerEntry.updateMany({ where: { id, producerId, settled: false }, data: { settled: true, settledAt: at } });
    return r.count === 1;
  }

  /** Partial payment: lower the open amount and keep a note of what was paid. */
  async reduce(producerId: string, id: string, newAmount: number, paymentNote: string): Promise<void> {
    const row = await this.db.ledgerEntry.findFirst({ where: { id, producerId, settled: false } });
    if (!row) return;
    await this.db.ledgerEntry.update({ where: { id }, data: { amount: newAmount, note: `${row.note} · ${paymentNote}` } });
  }

  /** Oldest open entry for a party (used when a voice note says "Jaipur se paise mile"). */
  async oldestOpenForParty(producerId: string, direction: LedgerDirection, party: string): Promise<LedgerRow | null> {
    const row = await this.db.ledgerEntry.findFirst({
      where: { producerId, direction, settled: false, ...(party ? { party: { contains: party, mode: "insensitive" } } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return row ? toRow(row) : null;
  }

  async openTotals(producerId: string): Promise<{ toReceive: number; toPay: number }> {
    const groups = await this.db.ledgerEntry.groupBy({ by: ["direction"], where: { producerId, settled: false }, _sum: { amount: true } });
    const total = (d: LedgerDirection) => num(groups.find((g) => g.direction === d)?._sum.amount);
    return { toReceive: total("RECEIVE"), toPay: total("PAY") };
  }
}

function toRow(r: {
  id: string; party: string; direction: LedgerDirection; amount: unknown; note: string; dueDate: Date | null;
  settled: boolean; settledAt: Date | null; invoiceNo: string | null; createdAt: Date;
}): LedgerRow {
  return {
    id: r.id, party: r.party, direction: r.direction, amount: Number(r.amount), note: r.note, dueDate: r.dueDate,
    settled: r.settled, settledAt: r.settledAt, invoiceNo: r.invoiceNo, createdAt: r.createdAt,
  };
}
