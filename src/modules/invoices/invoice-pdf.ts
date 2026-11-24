// A4 PDF for a tax invoice / bill of supply / proforma, with the fields Rule 46 asks for (docs/RULES.md §C1).
// Built-in Helvetica has no ₹ glyph, so amounts print as "Rs."; names are expected in English on the invoice.
import PDFDocument from "pdfkit";
import { rupeesInWords } from "../../shared/money-words.js";
import { STATE_CODES } from "../../shared/gst/states.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import type { InvoiceRecord } from "./invoice.repository.js";

const INK = "#1F2937";
const SOFT = "#6B7280";
const RULE = "#E7E2DC";
const STRIPE = [["#B4441F", 14], ["#E9C46A", 4], ["#0F766E", 12], ["#E9C46A", 4]] as const;

const money = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateIn = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const stateWithCode = (s: string) => (STATE_CODES[s] ? `${s} (${STATE_CODES[s]})` : s);

const TITLES = { TAX: "TAX INVOICE", BILL_OF_SUPPLY: "BILL OF SUPPLY", PROFORMA: "PROFORMA INVOICE" } as const;

export class InvoicePdfRenderer {
  render(inv: InvoiceRecord, seller: ProducerProfile): Promise<Buffer> {
    const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${TITLES[inv.kind]} ${inv.number}`, Author: seller.businessName, Creator: "Sutra" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

    this.header(doc, inv, seller);
    this.parties(doc, inv, seller);
    this.table(doc, inv);
    this.totals(doc, inv);
    this.footer(doc, inv, seller);
    doc.end();
    return done;
  }

  private stripe(doc: PDFKit.PDFDocument, y: number) {
    let x = 40;
    let i = 0;
    while (x < 555) {
      const [color, w] = STRIPE[i % STRIPE.length]!;
      doc.rect(x, y, Math.min(w, 555 - x), 4).fill(color);
      x += w;
      i++;
    }
  }

  private header(doc: PDFKit.PDFDocument, inv: InvoiceRecord, s: ProducerProfile) {
    doc.fillColor("#B4441F").font("Helvetica-Bold").fontSize(20).text(s.businessName, 40, 40, { width: 320 });
    doc.fillColor(SOFT).font("Helvetica").fontSize(9)
      .text(`${s.city}, ${stateWithCode(s.state)}`)
      .text(s.gstin ? `GSTIN: ${s.gstin}` : "Not registered under GST")
      .text(`Phone: ${s.phone}`);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(TITLES[inv.kind], 360, 42, { width: 195, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(INK)
      .text(`No. ${inv.number}`, 360, doc.y + 4, { width: 195, align: "right" })
      .text(`Date: ${dateIn(inv.issuedAt)}`, { width: 195, align: "right" })
      .text(`Financial year: ${inv.financialYear}`, { width: 195, align: "right" });
    this.stripe(doc, 118);
  }

  private parties(doc: PDFKit.PDFDocument, inv: InvoiceRecord, s: ProducerProfile) {
    const y = 134;
    doc.fillColor(SOFT).font("Helvetica-Bold").fontSize(8).text("BILL TO", 40, y);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(inv.buyerName, 40, y + 12, { width: 300 });
    doc.font("Helvetica").fontSize(9).text(inv.buyerGstin ? `GSTIN: ${inv.buyerGstin}` : "Unregistered buyer", { width: 300 });
    doc.fillColor(SOFT).font("Helvetica-Bold").fontSize(8).text("PLACE OF SUPPLY", 360, y, { width: 195, align: "right" });
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(stateWithCode(inv.buyerState), 360, y + 12, { width: 195, align: "right" });
    doc.fontSize(8).fillColor(SOFT).text(inv.buyerState === s.state ? "Intra-state supply" : "Inter-state supply", { width: 195, align: "right" });
  }

  private table(doc: PDFKit.PDFDocument, inv: InvoiceRecord) {
    const y = 200;
    const cols = [
      { h: "Description", x: 40, w: 175, align: "left" as const },
      { h: "HSN", x: 215, w: 45, align: "left" as const },
      { h: "Qty", x: 260, w: 40, align: "right" as const },
      { h: "Rate", x: 300, w: 70, align: "right" as const },
      { h: "Taxable", x: 370, w: 80, align: "right" as const },
      { h: "GST", x: 450, w: 35, align: "right" as const },
      { h: "Amount", x: 485, w: 70, align: "right" as const },
    ];
    doc.rect(40, y, 515, 20).fill("#FBEDE7");
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5);
    for (const c of cols) doc.text(c.h, c.x + 4, y + 6, { width: c.w - 8, align: c.align });
    const values = [inv.itemName, inv.hsn || "-", String(inv.qty), money(inv.rate), money(inv.taxable), `${inv.gstRate}%`, money(inv.total)];
    doc.font("Helvetica").fontSize(9);
    const rowY = y + 28;
    cols.forEach((c, i) => doc.text(values[i]!, c.x + 4, rowY, { width: c.w - 8, align: c.align }));
    doc.moveTo(40, rowY + 26).lineTo(555, rowY + 26).strokeColor(RULE).stroke();
  }

  private totals(doc: PDFKit.PDFDocument, inv: InvoiceRecord) {
    let y = 268;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(INK);
      doc.text(label, 330, y, { width: 120 }).text(value, 450, y, { width: 105, align: "right" });
      y += bold ? 18 : 15;
    };
    line("Taxable value", money(inv.taxable));
    if (inv.kind !== "BILL_OF_SUPPLY") {
      if (inv.igst > 0) line(`IGST @ ${inv.gstRate}%`, money(inv.igst));
      else {
        line(`CGST @ ${inv.gstRate / 2}%`, money(inv.cgst));
        line(`SGST @ ${inv.gstRate / 2}%`, money(inv.sgst));
      }
    }
    doc.moveTo(330, y).lineTo(555, y).strokeColor(RULE).stroke();
    y += 6;
    line("Total", money(inv.total), true);
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(INK).text(rupeesInWords(inv.total), 40, y + 6, { width: 515 });
  }

  private footer(doc: PDFKit.PDFDocument, inv: InvoiceRecord, s: ProducerProfile) {
    const notes: string[] = [];
    if (inv.kind === "BILL_OF_SUPPLY") {
      notes.push(s.gstScheme === "COMPOSITION"
        ? "Composition taxable person, not eligible to collect tax on supplies."
        : "Supplier not registered under GST; no tax charged.");
    }
    if (inv.kind === "PROFORMA") notes.push("This is a proforma invoice for quotation and payment purposes. It is not a tax invoice.");
    notes.push("Goods once dispatched are subject to the terms agreed with the buyer.");
    doc.font("Helvetica").fontSize(8.5).fillColor(SOFT).text(notes.join("\n"), 40, 380, { width: 300 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9.5).text(`For ${s.businessName}`, 360, 380, { width: 195, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor(SOFT).text("Authorised signatory", 360, 430, { width: 195, align: "right" });
    this.stripe(doc, 470);
    doc.fontSize(7.5).fillColor(SOFT).text("Generated with Sutra", 40, 480, { width: 515, align: "center" });
  }
}
