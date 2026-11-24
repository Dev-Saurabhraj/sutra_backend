// Starter data per industry, offered during onboarding so a new producer taps "yes" instead of typing.
// The engine is the same for every industry; only these settings change (proposal §"Not just for weavers").
// Prices are typical, editable starting points, not advice.

export type TemplateMaterial = { key: string; name: string; nameHi: string; unit: string; hsn: string; gstRate: number; cost: number };
export type TemplateProduct = {
  key: string; name: string; nameHi: string; category: string; price: number; hsn: string; gstRate: number;
  unitsPerMachinePerWeek: number; recipe: Record<string, number>;
};
export type IndustryTemplate = {
  key: string; name: string; nameHi: string; machine: string; machineHi: string; emoji: string; sortOrder: number;
  /** Who usually works here and how they're usually paid — preselects the labour step. */
  labour: { wageType: "DAILY" | "PIECE" | "MONTHLY"; roleHi: string; role: string };
  materials: TemplateMaterial[];
  products: TemplateProduct[];
};

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    key: "handloom", name: "Handloom", nameHi: "हथकरघा", machine: "loom", machineHi: "करघा", emoji: "🧵", sortOrder: 1,
    labour: { wageType: "PIECE", role: "Weaver", roleHi: "बुनकर" },
    materials: [
      { key: "silk", name: "Mulberry silk yarn", nameHi: "रेशम धागा", unit: "kg", hsn: "5004", gstRate: 5, cost: 5600 },
      { key: "cotton", name: "Cotton yarn", nameHi: "सूती धागा", unit: "kg", hsn: "5205", gstRate: 5, cost: 460 },
      { key: "zari", name: "Zari (metallic thread)", nameHi: "ज़री", unit: "kg", hsn: "5605", gstRate: 5, cost: 9200 },
    ],
    products: [
      { key: "saree", name: "Silk-Cotton Saree", nameHi: "सिल्क-कॉटन साड़ी", category: "Saree", price: 3200, hsn: "5007", gstRate: 5, unitsPerMachinePerWeek: 1.5, recipe: { silk: 0.25, cotton: 0.3, zari: 0.05 } },
      { key: "dupatta", name: "Dupatta", nameHi: "दुपट्टा", category: "Dupatta", price: 850, hsn: "5007", gstRate: 5, unitsPerMachinePerWeek: 4, recipe: { silk: 0.1, cotton: 0.12, zari: 0.02 } },
    ],
  },
  {
    key: "brass", name: "Brass & Metal", nameHi: "पीतल", machine: "worker", machineHi: "कारीगर", emoji: "🪔", sortOrder: 2,
    labour: { wageType: "PIECE", role: "Karigar", roleHi: "कारीगर" },
    materials: [
      { key: "brass", name: "Brass sheet", nameHi: "पीतल की चादर", unit: "kg", hsn: "7409", gstRate: 18, cost: 640 },
      { key: "polish", name: "Lacquer & polish", nameHi: "लाह और पॉलिश", unit: "litre", hsn: "3208", gstRate: 18, cost: 380 },
      { key: "box", name: "Packing box", nameHi: "पैकिंग डिब्बा", unit: "pcs", hsn: "4819", gstRate: 18, cost: 24 },
    ],
    products: [
      { key: "diya", name: "Brass Diya Set", nameHi: "पीतल दीया सेट", category: "Diya", price: 650, hsn: "8306", gstRate: 5, unitsPerMachinePerWeek: 6, recipe: { brass: 0.45, polish: 0.02, box: 1 } },
      { key: "urli", name: "Brass Urli", nameHi: "पीतल उरली", category: "Urli", price: 1450, hsn: "8306", gstRate: 5, unitsPerMachinePerWeek: 2, recipe: { brass: 1.6, polish: 0.05, box: 1 } },
    ],
  },
  {
    key: "pottery", name: "Pottery", nameHi: "मिट्टी के बर्तन", machine: "kiln", machineHi: "भट्ठी", emoji: "🏺", sortOrder: 3,
    labour: { wageType: "DAILY", role: "Potter", roleHi: "कुम्हार" },
    materials: [
      { key: "clay", name: "Clay", nameHi: "मिट्टी", unit: "kg", hsn: "2508", gstRate: 5, cost: 6 },
      { key: "glaze", name: "Glaze", nameHi: "ग्लेज़", unit: "kg", hsn: "3207", gstRate: 18, cost: 180 },
    ],
    products: [
      { key: "cup", name: "Kulhad / Cup (set of 6)", nameHi: "कुल्हड़ (6 का सेट)", category: "Cups", price: 240, hsn: "6912", gstRate: 12, unitsPerMachinePerWeek: 60, recipe: { clay: 1.8, glaze: 0.1 } },
      { key: "planter", name: "Planter", nameHi: "गमला", category: "Planters", price: 320, hsn: "6912", gstRate: 12, unitsPerMachinePerWeek: 25, recipe: { clay: 2.5, glaze: 0.15 } },
    ],
  },
  {
    key: "toys", name: "Wooden Toys", nameHi: "लकड़ी के खिलौने", machine: "lathe", machineHi: "खराद", emoji: "🪀", sortOrder: 4,
    labour: { wageType: "PIECE", role: "Turner", roleHi: "खरादी" },
    materials: [
      { key: "wood", name: "Hale wood", nameHi: "हाले की लकड़ी", unit: "kg", hsn: "4403", gstRate: 18, cost: 45 },
      { key: "lacquer", name: "Lac colours", nameHi: "लाख के रंग", unit: "kg", hsn: "1301", gstRate: 5, cost: 420 },
    ],
    products: [
      { key: "top", name: "Spinning Top", nameHi: "लट्टू", category: "Toys", price: 90, hsn: "9503", gstRate: 12, unitsPerMachinePerWeek: 120, recipe: { wood: 0.15, lacquer: 0.01 } },
      { key: "doll", name: "Stacking Doll Set", nameHi: "गुड़िया सेट", category: "Toys", price: 380, hsn: "9503", gstRate: 12, unitsPerMachinePerWeek: 30, recipe: { wood: 0.6, lacquer: 0.03 } },
    ],
  },
  {
    key: "food", name: "Food Processing", nameHi: "खाद्य प्रसंस्करण", machine: "line", machineHi: "लाइन", emoji: "🫙", sortOrder: 5,
    labour: { wageType: "DAILY", role: "Helper", roleHi: "सहायक" },
    materials: [
      { key: "mango", name: "Raw mango", nameHi: "कच्चा आम", unit: "kg", hsn: "0804", gstRate: 0, cost: 40 },
      { key: "oil", name: "Mustard oil", nameHi: "सरसों का तेल", unit: "litre", hsn: "1514", gstRate: 5, cost: 160 },
      { key: "jar", name: "Glass jar", nameHi: "काँच की बरनी", unit: "pcs", hsn: "7010", gstRate: 18, cost: 18 },
    ],
    products: [
      { key: "pickle", name: "Mango Pickle 500 g", nameHi: "आम का अचार 500 ग्राम", category: "Pickle", price: 140, hsn: "2001", gstRate: 12, unitsPerMachinePerWeek: 300, recipe: { mango: 0.35, oil: 0.12, jar: 1 } },
    ],
  },
  {
    key: "machining", name: "Machine Shop", nameHi: "मशीन शॉप", machine: "machine", machineHi: "मशीन", emoji: "⚙️", sortOrder: 6,
    labour: { wageType: "MONTHLY", role: "Operator", roleHi: "ऑपरेटर" },
    materials: [
      { key: "rod", name: "Steel rod", nameHi: "स्टील रॉड", unit: "kg", hsn: "7214", gstRate: 18, cost: 62 },
      { key: "coolant", name: "Coolant oil", nameHi: "कूलेंट तेल", unit: "litre", hsn: "3403", gstRate: 18, cost: 210 },
    ],
    products: [
      { key: "bolt", name: "Hex Bolt M12 (100 pcs)", nameHi: "हेक्स बोल्ट M12 (100)", category: "Fasteners", price: 950, hsn: "7318", gstRate: 18, unitsPerMachinePerWeek: 40, recipe: { rod: 8, coolant: 0.2 } },
    ],
  },
  {
    key: "other", name: "Other", nameHi: "कुछ और", machine: "worker", machineHi: "कारीगर", emoji: "🧰", sortOrder: 99,
    labour: { wageType: "DAILY", role: "Worker", roleHi: "कारीगर" },
    materials: [{ key: "raw", name: "Raw material", nameHi: "कच्चा माल", unit: "kg", hsn: "", gstRate: 18, cost: 100 }],
    products: [{ key: "item", name: "Product", nameHi: "माल", category: "General", price: 500, hsn: "", gstRate: 18, unitsPerMachinePerWeek: 10, recipe: { raw: 1 } }],
  },
];

export const templateFor = (key: string): IndustryTemplate | undefined => INDUSTRY_TEMPLATES.find((t) => t.key === key);
