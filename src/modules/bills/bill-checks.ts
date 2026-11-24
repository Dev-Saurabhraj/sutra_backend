// Checks on a bill that has been read: pure functions, so they are easy to test and to explain to the user.
import { validateGstin, type GstinCheck } from "../../shared/gst/gstin.js";
import { round2 } from "../../shared/money.js";
import type { Bill } from "./bill-reader.js";

const TOLERANCE = 2; // rupees: printed bills round each line

export type BillChecks = {
  gstin: GstinCheck;
  /** Line items add up to the taxable value, and taxable + tax = total. */
  mathOk: boolean;
  itemsTotal: number;
  /** Input tax credit on this bill; claimable only if the supplier GSTIN is valid. */
  itc: number;
  itcAtRisk: boolean;
  unmatchedItems: number;
};

export function checkBill(bill: Bill): BillChecks {
  const gstin = validateGstin(bill.supplierGstin);
  const itemsTotal = round2(bill.items.reduce((a, i) => a + i.qty * i.rate, 0));
  const tax = round2(bill.cgst + bill.sgst + bill.igst);
  const mathOk = Math.abs(itemsTotal - bill.taxable) <= TOLERANCE && Math.abs(bill.taxable + tax - bill.total) <= TOLERANCE;
  return {
    gstin,
    mathOk,
    itemsTotal,
    itc: tax,
    itcAtRisk: !gstin.valid,
    unmatchedItems: bill.items.filter((i) => !i.materialId).length,
  };
}
