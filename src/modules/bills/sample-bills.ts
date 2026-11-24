// Demo supplier bills (ported from thread/src/lib/samples.ts). The images in assets/samples/ were rendered
// from this data, so the offline reader returns exactly what is printed on them.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeGstin } from "../../shared/gst/gstin.js";
import { round2 } from "../../shared/money.js";
import { addDays } from "../../shared/time.js";
import type { BillImage, BillRead, BillReader, MaterialHint } from "./bill-reader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(here, "../../../assets/samples");

const zariGstin = makeGstin("Gujarat", "AAMFM4821Q");
const cottonGstin = makeGstin("Madhya Pradesh", "AABCB7310K");
const ganeshValid = makeGstin("Gujarat", "AAPFG5512M");
// one character mistyped, so the check digit fails
const ganeshTypo = ganeshValid.slice(0, 9) + (ganeshValid[9] === "3" ? "8" : "3") + ganeshValid.slice(10);

type SampleBill = {
  key: string;
  label: string;
  labelHi: string;
  supplierName: string;
  supplierGstin: string;
  supplierState: string;
  billNo: string;
  daysAgo: number;
  items: { description: string; hsn: string; qty: number; unit: string; rate: number; material: RegExp }[];
  gstRate: number;
};

export const SAMPLE_BILLS: SampleBill[] = [
  {
    key: "zari", label: "Zari bill (Surat)", labelHi: "ज़री का बिल (सूरत)", supplierName: "Mahalaxmi Zari Works", supplierGstin: zariGstin,
    supplierState: "Gujarat", billNo: "MZW/2627/0418", daysAgo: 0, gstRate: 5,
    items: [{ description: "Tested Zari Thread (Gold) 2/30", hsn: "5605", qty: 4, unit: "kg", rate: 9150, material: /zari/i }],
  },
  {
    key: "cotton", label: "Cotton yarn bill, handwritten", labelHi: "सूती धागे का हाथ से लिखा बिल", supplierName: "Burhanpur Cotton Yarn Co.",
    supplierGstin: cottonGstin, supplierState: "Madhya Pradesh", billNo: "BCY-7752", daysAgo: 1, gstRate: 5,
    items: [{ description: "Cotton Yarn 100s Combed (Bleached)", hsn: "5205", qty: 25, unit: "kg", rate: 455, material: /cotton/i }],
  },
  {
    key: "typo", label: "Silk bill with a GSTIN error", labelHi: "रेशम का बिल, GSTIN में गलती", supplierName: "Shree Ganesh Yarn Agency",
    supplierGstin: ganeshTypo, supplierState: "Gujarat", billNo: "SGY/1193", daysAgo: 2, gstRate: 5,
    items: [{ description: "Mulberry Raw Silk Yarn 20/22 D", hsn: "5004", qty: 3, unit: "kg", rate: 5650, material: /silk/i }],
  },
];

export const sampleList = () => SAMPLE_BILLS.map((s) => ({ key: s.key, label: s.label, labelHi: s.labelHi }));

export async function sampleImage(key: string): Promise<BillImage | null> {
  if (!SAMPLE_BILLS.some((s) => s.key === key)) return null;
  const buf = await readFile(path.join(SAMPLES_DIR, `bill-${key}.jpg`));
  return { base64: buf.toString("base64"), mediaType: "image/jpeg" };
}

/** Offline reader: knows exactly what the demo bills say. Works without any AI key. */
export class SampleBillReader implements BillReader {
  constructor(private readonly now: () => Date) {}

  async read(input: { sampleKey: string | null; producerState: string }, materials: MaterialHint[]): Promise<BillRead | null> {
    const s = SAMPLE_BILLS.find((b) => b.key === input.sampleKey);
    if (!s) return null;
    const taxable = round2(s.items.reduce((a, i) => a + i.qty * i.rate, 0));
    const tax = round2((taxable * s.gstRate) / 100);
    const intra = s.supplierState === input.producerState;
    return {
      parser: "sample",
      bill: {
        supplierName: s.supplierName,
        supplierGstin: s.supplierGstin,
        billNo: s.billNo,
        billDate: addDays(this.now(), -s.daysAgo).toISOString().slice(0, 10),
        items: s.items.map((i) => ({
          description: i.description, hsn: i.hsn, qty: i.qty, unit: i.unit, rate: i.rate,
          materialId: materials.find((m) => i.material.test(m.name))?.id ?? "",
        })),
        taxable,
        cgst: intra ? round2(tax / 2) : 0,
        sgst: intra ? round2(tax / 2) : 0,
        igst: intra ? 0 : tax,
        total: round2(taxable + tax),
      },
    };
  }
}
