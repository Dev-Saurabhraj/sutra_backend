// ONDC catalog (X8). Pure: checks each product against what ONDC seller apps need, and builds a Beckn-style
// catalog a seller network participant (seller app) can ingest. Going live needs a registered seller app;
// Sutra prepares the catalog, it does not publish to the network itself.

export type OndcProduct = {
  id: string; name: string; category: string; story: string; price: number; mrp: number; hsn: string; gstRate: number;
  stock: number; imageUrl: string | null; published: boolean;
};
export type OndcSeller = {
  id: string; businessName: string; city: string; state: string; phone: string; gstin: string | null; industryKey: string; upiId: string | null;
};

export type Issue = { field: string; en: string; hi: string; blocking: boolean };

/** ONDC retail domains by trade (seller apps confirm the final category). */
const DOMAIN: Record<string, { code: string; name: string }> = {
  handloom: { code: "ONDC:RET12", name: "Fashion" },
  brass: { code: "ONDC:RET16", name: "Home & Kitchen" },
  pottery: { code: "ONDC:RET16", name: "Home & Kitchen" },
  toys: { code: "ONDC:RET16", name: "Home & Kitchen" },
  food: { code: "ONDC:RET10", name: "Grocery" },
};

export const domainFor = (industryKey: string) => DOMAIN[industryKey] ?? null;

export function productIssues(p: OndcProduct, s: OndcSeller): Issue[] {
  const out: Issue[] = [];
  const add = (field: string, en: string, hi: string, blocking = true) => out.push({ field, en, hi, blocking });
  if (!p.imageUrl) add("image", "Add a photo (seller apps reject items without one)", "फ़ोटो जोड़ें (बिना फ़ोटो सामान नहीं लिया जाता)");
  if (p.story.trim().length < 40) add("description", "Write at least two lines about the product", "सामान के बारे में कम से कम दो लाइन लिखें");
  if (!/^\d{4,8}$/.test(p.hsn)) add("hsn", "HSN code is missing", "HSN कोड नहीं है");
  if (!(p.price > 0)) add("price", "Set a price", "दाम लिखें");
  if (p.mrp < p.price) add("mrp", "MRP is lower than the selling price", "MRP बिक्री दाम से कम है");
  if (!p.published) add("published", "Hidden in your catalog", "आपके कैटलॉग में छुपा है", false);
  if (p.stock <= 0) add("stock", "Out of stock: it will show as unavailable", "स्टॉक ख़त्म: 'उपलब्ध नहीं' दिखेगा", false);
  if (!s.gstin) add("gstin", "Most seller apps need a GSTIN to sell across India", "पूरे भारत में बेचने के लिए ज़्यादातर सेलर ऐप GSTIN माँगते हैं");
  return out;
}

/** Beckn on_search style catalog for one seller (provider). */
export function ondcCatalog(s: OndcSeller, products: OndcProduct[], baseUrl: string) {
  const domain = domainFor(s.industryKey);
  const abs = (u: string) => (u.startsWith("http") ? u : `${baseUrl}${u}`);
  return {
    context: { domain: domain?.code ?? "ONDC:RET16", country: "IND", core_version: "1.2.0" },
    "bpp/descriptor": { name: "Sutra" },
    "bpp/providers": [
      {
        id: s.id,
        descriptor: { name: s.businessName, short_desc: `${s.businessName}, ${s.city}` },
        "@ondc/org/fssai_license_no": undefined,
        locations: [{ id: `${s.id}-loc`, address: { city: s.city, state: s.state, country: "IND" } }],
        items: products.map((p) => ({
          id: p.id,
          descriptor: { name: p.name, short_desc: p.category, long_desc: p.story, images: p.imageUrl ? [abs(p.imageUrl)] : [] },
          price: { currency: "INR", value: p.price.toFixed(2), maximum_value: Math.max(p.mrp, p.price).toFixed(2) },
          quantity: { available: { count: String(Math.max(0, p.stock)) }, maximum: { count: String(Math.max(1, p.stock)) } },
          category_id: p.category,
          location_id: `${s.id}-loc`,
          "@ondc/org/returnable": false,
          "@ondc/org/cancellable": true,
          "@ondc/org/available_on_cod": false,
          "@ondc/org/time_to_ship": "P3D",
          "@ondc/org/contact_details_consumer_care": `${s.businessName},${s.phone}`,
          "@ondc/org/statutory_reqs_packaged_commodities": {
            manufacturer_or_packer_name: s.businessName,
            manufacturer_or_packer_address: `${s.city}, ${s.state}`,
            common_or_generic_name_of_commodity: p.category,
            net_quantity_or_measure_of_commodity_in_pkg: "1 piece",
            month_year_of_manufacture_packing_import: "",
          },
          tags: [{ code: "origin", list: [{ code: "country", value: "IND" }] }, { code: "tax", list: [{ code: "hsn", value: p.hsn }, { code: "gst_rate", value: String(p.gstRate) }] }],
        })),
      },
    ],
  };
}
