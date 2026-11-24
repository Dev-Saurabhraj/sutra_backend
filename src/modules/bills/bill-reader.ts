import { z } from "zod";

export const BillSchema = z.object({
  supplierName: z.string(),
  supplierGstin: z.string().describe("15-character GSTIN exactly as printed, or empty string if none"),
  billNo: z.string(),
  billDate: z.string().describe("YYYY-MM-DD"),
  items: z.array(
    z.object({
      description: z.string(),
      materialId: z.string().describe("id of the matching material from the list given, or empty string if none match"),
      hsn: z.string().describe("HSN code as printed, or empty string"),
      qty: z.number(),
      unit: z.string(),
      rate: z.number().describe("price per unit before tax"),
    }),
  ),
  taxable: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  igst: z.number(),
  total: z.number(),
});
export type Bill = z.infer<typeof BillSchema>;

export type BillImage = { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" };
export type MaterialHint = { id: string; name: string; unit: string };

export type BillRead = { bill: Bill; parser: string };

/** Strategy: turn a bill (photo or demo sample) into structured data. Returns null when it can't. Never throws. */
export interface BillReader {
  read(input: { image: BillImage | null; sampleKey: string | null; producerState: string }, materials: MaterialHint[]): Promise<BillRead | null>;
}

/** Chain of responsibility: the first reader that understands the bill wins. */
export class FallbackBillReader implements BillReader {
  constructor(private readonly chain: BillReader[]) {}

  async read(input: Parameters<BillReader["read"]>[0], materials: MaterialHint[]): Promise<BillRead | null> {
    for (const reader of this.chain) {
      const r = await reader.read(input, materials);
      if (r) return r;
    }
    return null;
  }
}
