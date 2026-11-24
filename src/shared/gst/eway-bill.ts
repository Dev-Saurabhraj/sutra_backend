// E-way bill helper (X6). Pure: decides whether one is needed and prefills Part A/B for the portal.
// CGST Rule 138: needed when the consignment value is above ₹50,000; for handicraft goods moved inter-state by a
// person exempt from registration, it is needed whatever the value. Intra-state limits differ in some states.

export const EWAY_LIMIT = 50_000;

export type EwayInput = {
  docType: "TAX" | "BILL_OF_SUPPLY" | "PROFORMA";
  docNo: string;
  docDate: Date;
  value: number; // invoice value including tax
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gstRate: number;
  hsn: string;
  item: string;
  qty: number;
  from: { gstin: string | null; name: string; state: string; city: string };
  to: { gstin: string | null; name: string; state: string };
  transporter?: string | null;
  lrNumber?: string | null;
  vehicleNo?: string | null;
  handicraft: boolean;
};

export type EwayCheck = { required: boolean; reasonEn: string; reasonHi: string };

export function ewayBillNeed(i: Pick<EwayInput, "value" | "from" | "to" | "handicraft">): EwayCheck {
  const interState = i.from.state !== i.to.state;
  const unregistered = !i.from.gstin;
  if (i.handicraft && unregistered && interState) {
    return {
      required: true,
      reasonEn: "Handicraft goods sent to another state by a seller without GST registration need an e-way bill at any value.",
      reasonHi: "बिना GST वाले कारीगर का हस्तशिल्प माल दूसरे राज्य जाए तो हर रकम पर ई-वे बिल चाहिए।",
    };
  }
  if (i.value > EWAY_LIMIT) {
    return {
      required: true,
      reasonEn: `The consignment is worth more than ₹50,000, so an e-way bill is needed before the goods move.${interState ? "" : " Some states set a higher limit inside the state; check yours."}`,
      reasonHi: `माल ₹50,000 से ज़्यादा का है, इसलिए भेजने से पहले ई-वे बिल बनाना ज़रूरी है।${interState ? "" : " राज्य के अंदर कुछ राज्यों में सीमा ज़्यादा है।"}`,
    };
  }
  return { required: false, reasonEn: "Up to ₹50,000 no e-way bill is needed.", reasonHi: "₹50,000 तक ई-वे बिल ज़रूरी नहीं।" };
}

const ddmmyyyy = (d: Date) => {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return `${String(ist.getUTCDate()).padStart(2, "0")}/${String(ist.getUTCMonth() + 1).padStart(2, "0")}/${ist.getUTCFullYear()}`;
};

/** Fields in the order the e-way bill portal asks for them (Part A, then Part B). Review before filing. */
export function ewayBillFields(i: EwayInput) {
  return {
    partA: {
      supplyType: "Outward",
      subSupplyType: "Supply",
      docType: i.docType === "BILL_OF_SUPPLY" ? "Bill of Supply" : "Tax Invoice",
      docNo: i.docNo,
      docDate: ddmmyyyy(i.docDate),
      fromGstin: i.from.gstin ?? "URP",
      fromTradeName: i.from.name,
      fromPlace: i.from.city,
      fromState: i.from.state,
      toGstin: i.to.gstin ?? "URP",
      toTradeName: i.to.name,
      toState: i.to.state,
      items: [{ productName: i.item, hsnCode: i.hsn, quantity: i.qty, unit: "PCS", taxableAmount: i.taxable, taxRate: i.gstRate }],
      totalValue: i.taxable,
      cgstValue: i.cgst,
      sgstValue: i.sgst,
      igstValue: i.igst,
      totalInvoiceValue: i.value,
    },
    partB: {
      transportMode: "Road",
      transporterName: i.transporter ?? "",
      transDocNo: i.lrNumber ?? "",
      vehicleNo: i.vehicleNo ?? "",
    },
    portal: "https://ewaybillgst.gov.in",
  };
}
