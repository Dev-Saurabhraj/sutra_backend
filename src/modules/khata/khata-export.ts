// The bahi as a plain CSV to share with a CA or a partner — the same shape as the GST export.
import type { LedgerRow } from "./khata.repository.js";

const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (xs: (string | number | null | undefined)[]) => xs.map(cell).join(",");
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function khataCsv(meta: { business: string; status: "open" | "settled" }, rows: LedgerRow[]): string {
  const side = (r: LedgerRow) => (r.direction === "RECEIVE" ? "To receive" : "To pay");
  const status = (r: LedgerRow) => (r.settled ? "Settled" : "Open");
  return [
    row(["Sutra khata (ledger)", meta.business, meta.status === "open" ? "Open entries" : "Settled entries"]),
    "",
    row(["Party", "Side", "Amount", "Invoice no", "Due date", "Status", "Note"]),
    ...rows.map((r) => row([r.party, side(r), r.amount.toFixed(2), r.invoiceNo, date(r.dueDate), status(r), r.note])),
    "",
    row(["Total", "", rows.reduce((a, r) => a + r.amount, 0).toFixed(2)]),
  ].join("\r\n");
}
