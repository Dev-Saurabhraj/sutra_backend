/* Realistic demo data for Sutra (ported from thread/prisma/seed.ts).
 * Cluster 1: Chanderi handloom (MP), 10 weavers. Hero: Rohit Kushwaha, phone +919800000001.
 * Cluster 2: Moradabad brass (UP), 3 workshops, for the "any industry" switch.
 * Every producer gets a login: phone +9198000000NN, dev OTP from .env (DEV_OTP).
 * Run: npm run db:seed
 */
import { PrismaClient, type Buyer, type GstScheme, type Prisma } from "@prisma/client";
import { makeGstin } from "../src/shared/gst/gstin.js";
import { splitTax, noTax } from "../src/shared/gst/tax.js";
import { businessPrefix, financialYear, invoiceNumber } from "../src/shared/gst/financial-year.js";
import { istDate } from "../src/modules/labour/wages.js";

const db = new PrismaClient();

let seed = 20261124;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (a: number, b: number) => a + (b - a) * rnd();
const int = (a: number, b: number) => Math.round(between(a, b));
const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * DAY);
const daysAhead = (d: number) => new Date(NOW + d * DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;
const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const pan = (surname: string, kind = "P") =>
  `${L[int(0, 25)]}${L[int(0, 25)]}${L[int(0, 25)]}${kind}${surname.charAt(0).toUpperCase()}${int(1000, 9999)}${L[int(0, 25)]}`;

// ---- numbering (kept in step with the API's Counter table) ----
let orderNo = 1000;
const nextOrderCode = () => `SUT-${++orderNo}`;
const counters = new Map<string, number>();
function nextInvoice(producerId: string, businessName: string, kind: "TAX" | "PROFORMA" | "BILL_OF_SUPPLY", at: Date) {
  const fy = financialYear(at);
  const key = `inv:${producerId}:${kind}:${fy.label}`;
  const seq = (counters.get(key) ?? 0) + 1;
  counters.set(key, seq);
  return { number: invoiceNumber(businessPrefix(businessName), kind, fy.short, seq), financialYear: fy.label };
}

async function reset() {
  const tables = [
    "VoiceEntry", "Message", "Alert", "LedgerEntry", "Invoice", "Order", "SupplierOrder", "PurchaseItem", "Purchase",
    "StockMovement", "RecipeItem", "Product", "Material", "RefreshToken", "OtpChallenge", "IdempotencyRecord", "User",
    "Buyer", "Supplier", "Producer", "Cluster", "Industry", "Counter",
  ];
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

type MatDef = { key: string; name: string; nameHi: string; unit: string; hsn: string; gst: number; cost: number; supplier: string };
type ProdDef = {
  key: string; name: string; nameHi: string; category: string; price: number; mrp: number; hsn: string; gst: number;
  upmw: number; share: number; recipe: Record<string, number>; story: string;
};
type MakerDef = {
  slug: string; name: string; biz: string; machines: number; color: string; story: string;
  scheme?: GstScheme; all?: boolean; onTime?: number;
};

const MOTIFS = ["Asharfi Buti", "Mor (Peacock)", "Nalferma", "Hans (Swan)", "Kamal (Lotus)", "Chatai", "Ambi", "Phool Patti", "Jaal", "Gend"];
const PALETTES = [
  "#7C2D3A,#E9C46A", "#0F766E,#F4D9A6", "#9D174D,#FBCFE8", "#1E3A8A,#FDE68A", "#B45309,#FEF3C7",
  "#4D7C0F,#ECFCCB", "#6D28D9,#EDE9FE", "#BE123C,#FFE4E6", "#155E75,#CFFAFE", "#92400E,#FDE68A",
];

const INDUSTRIES = [
  { key: "handloom", name: "Handloom", nameHi: "हथकरघा", machine: "loom", machineHi: "करघा", emoji: "🧵" },
  { key: "brass", name: "Brass & Metal", nameHi: "पीतल", machine: "worker", machineHi: "कारीगर", emoji: "🪔" },
  { key: "toys", name: "Wooden Toys", nameHi: "लकड़ी के खिलौने", machine: "lathe", machineHi: "खराद", emoji: "🪀" },
  { key: "pottery", name: "Pottery", nameHi: "मिट्टी के बर्तन", machine: "kiln", machineHi: "भट्ठी", emoji: "🏺" },
  { key: "food", name: "Food Processing", nameHi: "खाद्य प्रसंस्करण", machine: "line", machineHi: "लाइन", emoji: "🫙" },
  { key: "machining", name: "Machine Shop", nameHi: "मशीन शॉप", machine: "machine", machineHi: "मशीन", emoji: "⚙️" },
];

const HANDLOOM_MATS: MatDef[] = [
  { key: "silk", name: "Mulberry silk yarn", nameHi: "रेशम धागा", unit: "kg", hsn: "5004", gst: 5, cost: 5600, supplier: "silk" },
  { key: "cotton", name: "Cotton yarn (100s count)", nameHi: "सूती धागा", unit: "kg", hsn: "5205", gst: 5, cost: 460, supplier: "cotton" },
  { key: "zari", name: "Zari (metallic thread)", nameHi: "ज़री", unit: "kg", hsn: "5605", gst: 5, cost: 9200, supplier: "zari" },
];
const HANDLOOM_PRODS: ProdDef[] = [
  { key: "sc-saree", name: "Chanderi Silk-Cotton Saree", nameHi: "चंदेरी सिल्क-कॉटन साड़ी", category: "Silk-Cotton Saree", price: 3200, mrp: 6000, hsn: "5007", gst: 5, upmw: 1.5, share: 0.5,
    recipe: { silk: 0.25, cotton: 0.3, zari: 0.05 },
    story: "Woven on a traditional pit loom, this featherlight silk-cotton saree carries the sheer, glass-like texture Chanderi is famous for. Each motif is hand-inserted with a separate needle, so no two pieces are exactly alike." },
  { key: "silk-saree", name: "Pure Silk Chanderi Saree, Zari Border", nameHi: "शुद्ध रेशम चंदेरी साड़ी, ज़री बॉर्डर", category: "Pure Silk Saree", price: 5400, mrp: 9500, hsn: "5007", gst: 5, upmw: 0.8, share: 0.2,
    recipe: { silk: 0.55, zari: 0.12 },
    story: "A pure mulberry-silk Chanderi with a rich zari border and pallu. It takes close to a week of continuous weaving on one loom, and is finished and checked by hand before dispatch." },
  { key: "dupatta", name: "Chanderi Dupatta", nameHi: "चंदेरी दुपट्टा", category: "Dupatta", price: 850, mrp: 1600, hsn: "5007", gst: 5, upmw: 4, share: 0.15,
    recipe: { silk: 0.1, cotton: 0.12, zari: 0.02 },
    story: "A light, translucent dupatta with scattered hand-woven butis. Pairs with any kurta and is a steady seller for boutiques all year round." },
  { key: "suit", name: "Chanderi Suit Fabric Set (3 pc)", nameHi: "चंदेरी सूट सेट (3 पीस)", category: "Suit Set", price: 1600, mrp: 2800, hsn: "5007", gst: 5, upmw: 2.5, share: 0.15,
    recipe: { silk: 0.15, cotton: 0.35, zari: 0.03 },
    story: "Unstitched kurta, bottom and dupatta fabric woven as one matching set. Popular with boutiques that offer custom tailoring." },
];
const WEAVERS: MakerDef[] = [
  { slug: "rohit", name: "Rohit Kushwaha", biz: "Kushwaha Handloom", machines: 12, all: true, onTime: 0.94, color: "#B4441F",
    story: "Rohit is a third-generation Chanderi weaver. His family has run looms in the old town for over 60 years, and today he employs 12 weavers from his mohalla. He is known for fine butis and clean, even zari work." },
  { slug: "rukhsana", name: "Rukhsana Bano", biz: "Bano Weaves", machines: 6, onTime: 0.91, color: "#9D174D",
    story: "Rukhsana took over her father's looms in 2015 and now trains young women from her neighbourhood. Her dupattas are known for delicate pastel colours." },
  { slug: "mohan", name: "Mohan Koli", biz: "Koli Hathkargha", machines: 8, all: true, onTime: 0.88, color: "#0F766E",
    story: "Mohan comes from the Koli weaving community, the original weavers of Chanderi. He specialises in traditional Nalferma and Asharfi butis." },
  { slug: "sitaram", name: "Sitaram Koli", biz: "Sitaram Handloom", machines: 5, onTime: 0.86, color: "#1E3A8A", scheme: "COMPOSITION",
    story: "Sitaram runs five looms with his sons. Steady, reliable output of everyday silk-cotton sarees." },
  { slug: "farida", name: "Farida Begum", biz: "Farida Chanderi", machines: 4, onTime: 0.9, color: "#B45309",
    story: "Farida's small unit focuses on dupattas and suit sets with bright, festive colours." },
  { slug: "abdul", name: "Abdul Rehman Ansari", biz: "Rehman Silk House", machines: 10, all: true, onTime: 0.92, color: "#4D7C0F",
    story: "Abdul's unit is one of the larger ones in the cluster, known for pure silk sarees with heavy zari borders." },
  { slug: "kamla", name: "Kamla Bai Koli", biz: "Kamla Bai Koli", machines: 3, onTime: 0.84, color: "#6D28D9", scheme: "UNREGISTERED",
    story: "Kamla Bai has been weaving for 30 years. She works three looms from home with her daughters-in-law." },
  { slug: "ramesh", name: "Ramesh Koli", biz: "Ramesh Weaving Centre", machines: 6, onTime: 0.87, color: "#BE123C",
    story: "Ramesh weaves classic silk-cotton sarees and supplies to two shops in Bhopal." },
  { slug: "shabana", name: "Shabana Ansari", biz: "Shabana Handloom", machines: 4, onTime: 0.89, color: "#155E75",
    story: "Shabana's looms produce fine dupattas with mor (peacock) motifs, her family's signature design." },
  { slug: "gopal", name: "Gopal Vishwakarma", biz: "Vishwakarma Textiles", machines: 7, all: true, onTime: 0.9, color: "#92400E",
    story: "Gopal combines handloom tradition with new colour palettes, popular with younger boutique buyers in metros." },
];

const BRASS_MATS: MatDef[] = [
  { key: "brass", name: "Brass sheet (0.8 mm)", nameHi: "पीतल की चादर", unit: "kg", hsn: "7409", gst: 18, cost: 640, supplier: "brass" },
  { key: "lacquer", name: "Lacquer & polish", nameHi: "लाह और पॉलिश", unit: "litre", hsn: "3208", gst: 18, cost: 380, supplier: "lacquer" },
  { key: "box", name: "Packing box", nameHi: "पैकिंग डिब्बा", unit: "pcs", hsn: "4819", gst: 18, cost: 24, supplier: "pack" },
];
const BRASS_PRODS: ProdDef[] = [
  { key: "diya", name: "Brass Diya Set (5 pcs)", nameHi: "पीतल दीया सेट (5 पीस)", category: "Diya Set", price: 650, mrp: 1200, hsn: "8306", gst: 5, upmw: 6, share: 0.35,
    recipe: { brass: 0.45, lacquer: 0.02, box: 1 }, story: "Hand-cast and hand-polished brass diyas from Moradabad, the 'Peetal Nagri' of India. Sold as a festive set of five." },
  { key: "urli", name: "Brass Urli Bowl, 12 inch", nameHi: "पीतल उरली, 12 इंच", category: "Urli", price: 1450, mrp: 2800, hsn: "8306", gst: 5, upmw: 2, share: 0.25,
    recipe: { brass: 1.6, lacquer: 0.05, box: 1 }, story: "A wide decorative urli for floating flowers and candles, hand-beaten with an engraved rim." },
  { key: "elephant", name: "Brass Elephant Figurine", nameHi: "पीतल हाथी", category: "Figurine", price: 900, mrp: 1800, hsn: "8306", gst: 5, upmw: 4, share: 0.2,
    recipe: { brass: 0.7, lacquer: 0.03, box: 1 }, story: "Sand-cast brass elephant with hand-chased detailing. A favourite with gift stores and hotels." },
  { key: "thali", name: "Brass Pooja Thali Set", nameHi: "पीतल पूजा थाली सेट", category: "Pooja Thali", price: 1100, mrp: 2100, hsn: "8306", gst: 5, upmw: 3, share: 0.2,
    recipe: { brass: 1.1, lacquer: 0.04, box: 1 }, story: "Complete pooja thali with diya, bell, kalash and incense stand, engraved by hand." },
];
const BRASS_MAKERS: MakerDef[] = [
  { slug: "salim", name: "Mohd. Salim", biz: "Salim Brass Works", machines: 8, color: "#B45309",
    story: "Salim runs a workshop of eight karigars in Moradabad's Peetal Basti, making festive and decor brassware for over 20 years." },
  { slug: "naseem", name: "Naseem Ahmed", biz: "Naseem Art Metal", machines: 5, color: "#92400E",
    story: "Naseem specialises in hand-engraved urlis and thalis, a skill passed down in his family." },
  { slug: "rajesh", name: "Rajesh Kumar", biz: "Kumar Handicrafts", machines: 6, color: "#B4441F",
    story: "Rajesh's unit focuses on cast figurines and gift items for hotels and corporate buyers." },
];

const BASE_STOCK: Record<string, number> = { silk: 9, cotton: 22, zari: 2.4, brass: 260, lacquer: 14, box: 400 };
const HERO_STOCK: Record<string, number> = { zari: 1.1, silk: 7.5, cotton: 21 };
const HERO_PRODUCT_STOCK: Record<string, number> = { "sc-saree": 24, "silk-saree": 6, dupatta: 40, suit: 12 };

async function main() {
  await reset();
  await db.industry.createMany({ data: INDUSTRIES });

  const sup = {
    silk: await db.supplier.create({ data: { name: "Shree Krishna Silk Traders", city: "Surat", state: "Gujarat", phone: "+91 98251 44120", gstin: makeGstin("Gujarat", "AAKFS2286D"), leadTimeDays: 7 } }),
    zari: await db.supplier.create({ data: { name: "Mahalaxmi Zari Works", city: "Surat", state: "Gujarat", phone: "+91 99099 31876", gstin: makeGstin("Gujarat", "AAMFM4821Q"), leadTimeDays: 10 } }),
    cotton: await db.supplier.create({ data: { name: "Burhanpur Cotton Yarn Co.", city: "Burhanpur", state: "Madhya Pradesh", phone: "+91 94250 66713", gstin: makeGstin("Madhya Pradesh", "AABCB7310K"), leadTimeDays: 4 } }),
    brass: await db.supplier.create({ data: { name: "Jain Metal Sheets", city: "Moradabad", state: "Uttar Pradesh", phone: "+91 97190 22045", gstin: makeGstin("Uttar Pradesh", pan("Jain", "F")), leadTimeDays: 3 } }),
    lacquer: await db.supplier.create({ data: { name: "Rathi Chemicals", city: "New Delhi", state: "Delhi", phone: "+91 98110 57391", gstin: makeGstin("Delhi", pan("Rathi", "C")), leadTimeDays: 5 } }),
    pack: await db.supplier.create({ data: { name: "Moradabad Corrugated Box", city: "Moradabad", state: "Uttar Pradesh", phone: "+91 90127 88104", gstin: makeGstin("Uttar Pradesh", pan("Gupta", "F")), leadTimeDays: 2 } }),
  };
  const supByKey: Record<string, (typeof sup)["silk"]> = sup;

  const buyerDefs = [
    { name: "Anjali Rao", business: "Kaveri Boutique", city: "Bengaluru", state: "Karnataka" },
    { name: "Vikram Singh Shekhawat", business: "Neel Textiles", city: "Jaipur", state: "Rajasthan" },
    { name: "Meher Kapadia", business: "Saanjh Studio", city: "Mumbai", state: "Maharashtra" },
    { name: "Amit Jain", business: "Tanaa Bana Store", city: "Indore", state: "Madhya Pradesh" },
    { name: "Sana Qureshi", business: "Hastkala Exports", city: "New Delhi", state: "Delhi" },
    { name: "Priya Kulkarni", business: "Vastra House", city: "Pune", state: "Maharashtra" },
  ];
  const buyers: Buyer[] = [];
  for (const [i, b] of buyerDefs.entries()) {
    buyers.push(await db.buyer.create({ data: { ...b, gstin: makeGstin(b.state, pan(b.business, "F")), phone: `+9197000000${String(i + 1).padStart(2, "0")}` } }));
  }
  const buyerBy = (biz: string) => buyers.find((b) => b.business === biz)!;

  const chanderi = await db.cluster.create({ data: { slug: "chanderi", name: "Chanderi Handloom Cluster", city: "Chanderi", state: "Madhya Pradesh", industryKey: "handloom" } });
  const moradabad = await db.cluster.create({ data: { slug: "moradabad", name: "Moradabad Brass Cluster", city: "Moradabad", state: "Uttar Pradesh", industryKey: "brass" } });

  let phoneNo = 0;
  async function createMaker(m: MakerDef, clusterId: string, industryKey: string, city: string, state: string, agentCut: number) {
    phoneNo += 1;
    const scheme = m.scheme ?? "REGULAR";
    const phone = `+9198000000${String(phoneNo).padStart(2, "0")}`;
    const producer = await db.producer.create({
      data: {
        slug: m.slug, clusterId, industryKey, name: m.name, businessName: m.biz, city, state, phone,
        gstin: scheme === "UNREGISTERED" ? null : makeGstin(state, pan(m.name.split(" ").slice(-1)[0] ?? "X")),
        gstScheme: scheme, machines: m.machines, story: m.story, avatarColor: m.color, onTimeRate: m.onTime ?? between(0.86, 0.95),
        joinedAt: daysAgo(m.slug === "rohit" ? 75 : int(30, 70)), agentCutPct: agentCut,
        ...(m.slug === "rohit" ? { udyamNumber: "UDYAM-MP-23-0041827", upiId: "kushwaha.handloom@demo" } : {}),
      },
    });
    await db.user.create({ data: { phone, role: "PRODUCER", producerId: producer.id } });
    return producer;
  }

  for (const [wi, w] of WEAVERS.entries()) {
    const producer = await createMaker(w, chanderi.id, "handloom", "Chanderi", "Madhya Pradesh", 25);
    const prods = w.all ? HANDLOOM_PRODS : HANDLOOM_PRODS.filter((_, i) => i === 0 || (wi + i) % 2 === 0);
    await buildProducer(producer, w.slug, wi, HANDLOOM_MATS, prods, w.slug === "rohit");
  }
  for (const [i, m] of BRASS_MAKERS.entries()) {
    const producer = await createMaker(m, moradabad.id, "brass", "Moradabad", "Uttar Pradesh", 22);
    await buildProducer(producer, m.slug, i + 3, BRASS_MATS, BRASS_PRODS, false);
  }

  await rohitExtras();
  await rohitLabour();

  await db.counter.createMany({
    data: [{ key: "order", value: orderNo }, ...[...counters.entries()].map(([key, value]) => ({ key, value }))],
  });

  async function buildProducer(
    producer: { id: string; businessName: string; state: string; machines: number; joinedAt: Date; agentCutPct: number; gstScheme: GstScheme },
    slug: string, idx: number, mats: MatDef[], prods: ProdDef[], hero: boolean,
  ) {
    const matRows: Record<string, { id: string; cost: number; gst: number; supplierId: string; supplierState: string }> = {};
    for (const m of mats) {
      const s = supByKey[m.supplier]!;
      const stock = hero && HERO_STOCK[m.key] !== undefined ? HERO_STOCK[m.key]! : r2(BASE_STOCK[m.key]! * (producer.machines / 8) * between(0.7, 1.3));
      const row = await db.material.create({
        data: { producerId: producer.id, supplierId: s.id, name: m.name, nameHi: m.nameHi, unit: m.unit, hsn: m.hsn, gstRate: m.gst, costPerUnit: m.cost, stock },
      });
      matRows[m.key] = { id: row.id, cost: m.cost, gst: m.gst, supplierId: s.id, supplierState: s.state };
    }

    const totalShare = prods.reduce((a, p) => a + p.share, 0);
    const prodRows: { def: ProdDef; id: string; price: number; looms: number }[] = [];
    for (const [i, p] of prods.entries()) {
      const motif = MOTIFS[(idx + i * 3) % MOTIFS.length];
      const name = mats[0]!.key === "silk" && p.key !== "suit" ? `${p.name}: ${motif}` : p.name;
      const price = Math.round((p.price * (1 + (idx % 3) * 0.04 - 0.04)) / 10) * 10;
      const row = await db.product.create({
        data: {
          producerId: producer.id, slug: `${slug}-${p.key}`, name, nameHi: p.nameHi, category: p.category, story: p.story,
          price, mrp: p.mrp, hsn: p.hsn, gstRate: p.gst, stock: hero ? (HERO_PRODUCT_STOCK[p.key] ?? 10) : int(4, 30),
          unitsPerMachinePerWeek: p.upmw, palette: PALETTES[(idx + i) % PALETTES.length]!,
          recipe: { create: Object.entries(p.recipe).map(([k, q]) => ({ materialId: matRows[k]!.id, qtyPerUnit: q })) },
        },
      });
      prodRows.push({ def: p, id: row.id, price, looms: (producer.machines * p.share) / totalShare });
    }

    // 26 weeks of production + consumption history
    const movements: Prisma.StockMovementCreateManyInput[] = [];
    const weeklyUse: Record<string, number> = {};
    for (let wk = 26; wk >= 1; wk--) {
      const util = between(0.6, 0.85);
      for (const pr of prodRows) {
        const made = Math.max(0, Math.round(pr.looms * pr.def.upmw * util));
        if (!made) continue;
        const at = daysAgo(wk * 7 - int(0, 5));
        movements.push({ producerId: producer.id, productId: pr.id, kind: "PRODUCE", qty: made, source: "SEED", createdAt: at });
        for (const [k, q] of Object.entries(pr.def.recipe)) {
          const used = r2(made * q);
          weeklyUse[k] = (weeklyUse[k] ?? 0) + used / 26;
          movements.push({ producerId: producer.id, materialId: matRows[k]!.id, kind: "CONSUME", qty: -used, source: "SEED", createdAt: at });
        }
      }
    }
    await db.stockMovement.createMany({ data: movements });

    // purchases roughly every 4 weeks per material
    for (const m of mats) {
      const mr = matRows[m.key]!;
      for (let wk = 25; wk >= 1; wk -= 4) {
        const qty = r2((weeklyUse[m.key] ?? 1) * 4 * between(0.9, 1.15));
        if (qty <= 0) continue;
        const rate = r2(mr.cost * between(0.97, 1.03));
        const t = splitTax(qty * rate, mr.gst, mr.supplierState, producer.state);
        const at = daysAgo(wk * 7 + int(0, 3));
        await db.purchase.create({
          data: {
            producerId: producer.id, supplierId: mr.supplierId, billNo: `${m.key.slice(0, 2).toUpperCase()}-${int(1000, 9999)}`,
            billDate: at, ...t, source: "SEED", createdAt: at,
            items: { create: [{ materialId: mr.id, qty, rate, amount: r2(qty * rate) }] },
          },
        });
        await db.stockMovement.create({ data: { producerId: producer.id, materialId: mr.id, kind: "PURCHASE", qty, source: "SEED", createdAt: at } });
      }
    }

    // sales: agent sales before joining Sutra, marketplace sales after
    const joinedDaysAgo = Math.round((NOW - producer.joinedAt.getTime()) / DAY);
    const docKind = producer.gstScheme === "REGULAR" ? "TAX" : "BILL_OF_SUPPLY";
    for (let d = 175; d >= 6; d -= int(9, 16)) {
      const pr = prodRows[int(0, prodRows.length - 1)]!;
      const viaSutra = d < joinedDaysAgo && rnd() < 0.8;
      let buyer = viaSutra ? buyers[int(0, buyers.length - 1)]! : null;
      // composition / unregistered makers only sell within their state in the demo data
      if (buyer && docKind !== "TAX" && buyer.state !== producer.state) buyer = buyerBy("Tanaa Bana Store");
      const qty = pr.def.key === "dupatta" || pr.def.key === "diya" ? int(15, 45) : int(5, 20);
      const rate = viaSutra ? pr.price : Math.round(pr.price * (1 - producer.agentCutPct / 100));
      const delivered = daysAgo(d);
      const order = await db.order.create({
        data: {
          code: nextOrderCode(), producerId: producer.id, productId: pr.id, buyerId: buyer?.id ?? null, channel: viaSutra ? "MARKETPLACE" : "AGENT",
          status: "DELIVERED", qty, rate, wantedBy: delivered, fullDate: delivered, createdAt: daysAgo(d + int(8, 14)), deliveredAt: delivered,
        },
      });
      const bState = buyer?.state ?? producer.state;
      const t = docKind === "TAX" ? splitTax(qty * rate, pr.def.gst, producer.state, bState) : noTax(qty * rate);
      await db.invoice.create({
        data: {
          ...nextInvoice(producer.id, producer.businessName, docKind, delivered), kind: docKind, producerId: producer.id, orderId: order.id,
          buyerName: buyer ? `${buyer.business}, ${buyer.city}` : "Agent: Lalitpur Kapda Mandi", buyerGstin: buyer?.gstin ?? null, buyerState: bState,
          itemName: (await db.product.findUniqueOrThrow({ where: { id: pr.id } })).name, hsn: pr.def.hsn, qty, rate,
          gstRate: docKind === "TAX" ? pr.def.gst : 0, ...t, issuedAt: delivered,
        },
      });
      await db.stockMovement.create({ data: { producerId: producer.id, productId: pr.id, kind: "SALE", qty: -qty, source: "SEED", createdAt: delivered } });
      if (viaSutra) await db.producer.update({ where: { id: producer.id }, data: { ordersDone: { increment: 1 } } });
    }
  }

  async function rohitLabour() {
    const rohit = await db.producer.findUniqueOrThrow({ where: { slug: "rohit" } });
    const ramesh = await db.worker.create({ data: { producerId: rohit.id, name: "Ramesh Prajapati", phone: "+919800000101", skill: "weaver", wageType: "DAILY", rate: 450, payCycle: "WEEKLY" } });
    const sita = await db.worker.create({ data: { producerId: rohit.id, name: "Sita Bai", phone: "+919800000102", skill: "weaver", wageType: "DAILY", rate: 450, payCycle: "WEEKLY" } });
    const geeta = await db.worker.create({ data: { producerId: rohit.id, name: "Geeta Koli", phone: "+919800000103", skill: "weaver", wageType: "PIECE", rate: 180, payCycle: "WEEKLY" } });
    const mohan = await db.worker.create({ data: { producerId: rohit.id, name: "Mohan Das", phone: null, skill: "helper", wageType: "MONTHLY", rate: 9100, payCycle: "MONTHLY" } });

    // Attendance for the week, plus today's marks so the labour screen shows who is present.
    for (const w of [ramesh, sita]) {
      for (let d = 5; d >= 1; d--) {
        await db.workEntry.create({ data: { producerId: rohit.id, workerId: w.id, kind: "ATTENDANCE", date: istDate(daysAgo(d)), units: 1, rate: 450, amount: 450, source: "SEED" } });
      }
    }
    await db.workEntry.create({ data: { producerId: rohit.id, workerId: ramesh.id, kind: "ATTENDANCE", date: istDate(daysAgo(0)), units: 1, rate: 450, amount: 450, source: "SEED" } });
    await db.workEntry.create({ data: { producerId: rohit.id, workerId: sita.id, kind: "ATTENDANCE", date: istDate(daysAgo(0)), units: 0.5, rate: 450, amount: r2(450 * 0.5), source: "SEED" } });

    // Piece worker: 4–5 pieces a day for the last week.
    for (let d = 6; d >= 1; d--) {
      const pieces = d % 2 === 0 ? 5 : 4;
      await db.workEntry.create({ data: { producerId: rohit.id, workerId: geeta.id, kind: "PIECE", date: istDate(daysAgo(d)), units: pieces, rate: 180, amount: r2(pieces * 180), source: "SEED" } });
    }

    // Monthly helper on a day rate of 9100 / 26.
    for (let d = 5; d >= 1; d--) {
      await db.workEntry.create({ data: { producerId: rohit.id, workerId: mohan.id, kind: "ATTENDANCE", date: istDate(daysAgo(d)), units: 1, rate: 350, amount: 350, source: "SEED" } });
    }

    await db.workerPayment.createMany({
      data: [
        { producerId: rohit.id, workerId: ramesh.id, kind: "ADVANCE", amount: 1500, mode: "CASH", note: "Peshgi (advance)", paidAt: daysAgo(4) },
        { producerId: rohit.id, workerId: ramesh.id, kind: "RECOVERY", amount: 500, mode: "CASH", note: "Advance adjusted", paidAt: daysAgo(2) },
        { producerId: rohit.id, workerId: ramesh.id, kind: "WAGE", amount: 1300, mode: "CASH", note: "Weekly wages", paidAt: daysAgo(2) },
      ],
    });
  }

  async function rohitExtras() {
    const rohit = await db.producer.findUniqueOrThrow({ where: { slug: "rohit" }, include: { products: true, materials: true } });
    const dupatta = rohit.products.find((p) => p.slug === "rohit-dupatta")!;
    const silkSaree = rohit.products.find((p) => p.slug === "rohit-silk-saree")!;
    const zari = rohit.materials.find((m) => m.hsn === "5605")!;
    const neel = buyerBy("Neel Textiles");
    const tanaa = buyerBy("Tanaa Bana Store");

    const live = await db.order.create({
      data: {
        code: nextOrderCode(), producerId: rohit.id, productId: dupatta.id, buyerId: neel.id, channel: "MARKETPLACE", status: "IN_PRODUCTION",
        qty: 40, rate: dupatta.price, wantedBy: daysAhead(9), promisedQtyByWanted: 40, fullDate: daysAhead(8), createdAt: daysAgo(4),
        quoteNote: "Confirmed: 40 dupattas, mixed pastel colours",
      },
    });
    const t = splitTax(40 * Number(dupatta.price), 5, "Madhya Pradesh", neel.state);
    await db.invoice.create({
      data: {
        ...nextInvoice(rohit.id, rohit.businessName, "PROFORMA", daysAgo(4)), kind: "PROFORMA", producerId: rohit.id, orderId: live.id,
        buyerName: `${neel.business}, ${neel.city}`, buyerGstin: neel.gstin, buyerState: neel.state, itemName: dupatta.name, hsn: dupatta.hsn,
        qty: 40, rate: dupatta.price, gstRate: 5, ...t, issuedAt: daysAgo(4),
      },
    });
    await db.message.createMany({
      data: [
        { producerId: rohit.id, orderId: live.id, sender: "BUYER", text: "Hi Rohit ji, can you do 40 dupattas in pastel shades? Need them before our winter sale.", textEn: "Hi Rohit ji, can you do 40 dupattas in pastel shades? Need them before our winter sale.", textHi: "नमस्ते रोहित जी, क्या आप पेस्टल रंगों में 40 दुपट्टे बना सकते हैं? हमें विंटर सेल से पहले चाहिए।", createdAt: daysAgo(5) },
        { producerId: rohit.id, orderId: live.id, sender: "PRODUCER", text: "हाँ, 40 दुपट्टे 8 दिन में तैयार हो जाएंगे।", textHi: "हाँ, 40 दुपट्टे 8 दिन में तैयार हो जाएंगे।", textEn: "Yes, 40 dupattas will be ready in 8 days.", createdAt: daysAgo(4) },
      ],
    });

    const inquiry = await db.order.create({
      data: {
        code: nextOrderCode(), producerId: rohit.id, productId: silkSaree.id, buyerId: tanaa.id, channel: "MARKETPLACE", status: "QUOTED",
        qty: 15, rate: silkSaree.price, wantedBy: daysAhead(20), createdAt: daysAgo(1),
      },
    });
    await db.message.create({
      data: {
        producerId: rohit.id, orderId: inquiry.id, sender: "BUYER",
        text: "Do you have pure silk sarees with a red zari border? We'd like 15 for a wedding collection.",
        textEn: "Do you have pure silk sarees with a red zari border? We'd like 15 for a wedding collection.",
        textHi: "क्या आपके पास लाल ज़री बॉर्डर वाली शुद्ध रेशम साड़ियाँ हैं? हमें शादी के कलेक्शन के लिए 15 चाहिए।",
        createdAt: daysAgo(1),
      },
    });

    await db.ledgerEntry.createMany({
      data: [
        { producerId: rohit.id, party: "Neel Textiles, Jaipur", direction: "RECEIVE", amount: 35700, note: "Advance balance for 40 dupattas", dueDate: daysAhead(10), createdAt: daysAgo(4) },
        { producerId: rohit.id, party: "Kaveri Boutique, Bengaluru", direction: "RECEIVE", amount: 21840, note: "Invoice balance (Oct order)", dueDate: daysAgo(3), createdAt: daysAgo(38) },
        { producerId: rohit.id, party: "Mahalaxmi Zari Works", direction: "PAY", amount: 18400, note: "Zari, last bill", dueDate: daysAhead(6) },
        { producerId: rohit.id, party: "Weavers' wages (week)", direction: "PAY", amount: 26400, note: "12 looms, weekly wages", dueDate: daysAhead(2) },
        { producerId: rohit.id, party: "Saanjh Studio, Mumbai", direction: "RECEIVE", amount: 16800, note: "Paid via UPI", dueDate: daysAgo(12), settled: true, settledAt: daysAgo(10) },
      ],
    });

    await db.alert.createMany({
      data: [
        { producerId: rohit.id, kind: "ORDER", title: "New inquiry from Tanaa Bana Store, Indore", titleHi: "टाना बाना स्टोर, इंदौर से नई पूछताछ",
          body: "15 pure silk sarees with red zari border, needed in 20 days.", bodyHi: "लाल ज़री बॉर्डर वाली 15 शुद्ध रेशम साड़ियाँ, 20 दिन में चाहिए।", createdAt: daysAgo(1) },
        { producerId: rohit.id, kind: "LOW_STOCK", title: "Zari (metallic thread) is running low", titleHi: "ज़री कम हो रही है",
          body: `Only ${Number(zari.stock)} kg left. At your usage it will finish in about a week.`, bodyHi: `सिर्फ़ ${Number(zari.stock)} किलो बची है। लगभग एक हफ़्ते में ख़त्म हो जाएगी।`, route: "/stock", createdAt: daysAgo(0.2) },
        { producerId: rohit.id, kind: "PAYMENT", title: "Kaveri Boutique payment is overdue", titleHi: "कावेरी बुटीक का भुगतान बाकी है",
          body: "₹21,840 was due 3 days ago.", bodyHi: "₹21,840 तीन दिन पहले देय था।", route: "/khata", createdAt: daysAgo(2) },
      ],
    });
  }

  const counts = {
    producers: await db.producer.count(), users: await db.user.count(), products: await db.product.count(),
    orders: await db.order.count(), invoices: await db.invoice.count(), movements: await db.stockMovement.count(),
  };
  console.log("Seeded", counts, "\nDemo login: +919800000001 (Rohit) with the DEV_OTP from .env");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
