import { describe, expect, it } from "vitest";
import { khataCsv } from "./khata-export.js";
import type { LedgerRow } from "./khata.repository.js";

const row = (o: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "k1", party: "Kaveri Boutique, Bengaluru", direction: "RECEIVE", amount: 10500, note: "Invoice KH/26-27/0001",
  dueDate: new Date("2026-12-10T00:00:00Z"), settled: false, settledAt: null, invoiceNo: "KH/26-27/0001", createdAt: new Date("2026-11-10T00:00:00Z"),
  ...o,
});

describe("khata CSV export", () => {
  it("lists both sides, escapes commas and totals the ledger", () => {
    const csv = khataCsv(
      { business: "Kushwaha Handloom", status: "open" },
      [row(), row({ id: "k2", party: "Mahalaxmi Zari Works", direction: "PAY", amount: 4200, invoiceNo: null, dueDate: null })],
    );
    expect(csv).toContain('"Kaveri Boutique, Bengaluru"');
    expect(csv).toContain("To receive");
    expect(csv).toContain("To pay");
    expect(csv).toContain("14700.00"); // 10500 + 4200
  });

  it("labels settled rows and leaves the invoice empty when there is none", () => {
    const csv = khataCsv({ business: "Kushwaha Handloom", status: "settled" }, [row({ settled: true, settledAt: new Date("2026-12-11T00:00:00Z") })]);
    expect(csv).toContain("Settled");
  });
});
