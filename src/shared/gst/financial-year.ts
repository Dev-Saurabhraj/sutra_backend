/** Indian financial year (1 April – 31 March), e.g. 2026-27. Computed in IST. */
export function financialYear(at: Date): { label: string; short: string } {
  const ist = new Date(at.getTime() + 5.5 * 3_600_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  const endShort = String((start + 1) % 100).padStart(2, "0");
  return { label: `${start}-${endShort}`, short: `${String(start % 100).padStart(2, "0")}-${endShort}` };
}

/** Invoice-series prefix from the business name: "Kushwaha Handloom" → "KH". Max 3 letters. */
export function businessPrefix(businessName: string): string {
  const letters = businessName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, "").charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 3);
  return letters || "SU";
}

const SERIES = { TAX: "", PROFORMA: "P", BILL_OF_SUPPLY: "B" } as const;

/** GST invoice number: unique, consecutive per financial year, at most 16 characters (Rule 46). */
export function invoiceNumber(prefix: string, kind: keyof typeof SERIES, fyShort: string, seq: number): string {
  const n = `${prefix}/${SERIES[kind]}${fyShort}/${String(seq).padStart(4, "0")}`;
  if (n.length > 16) throw new Error(`Invoice number too long: ${n}`);
  return n;
}
