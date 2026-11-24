// Scheme matcher (C6). Data, not code: each scheme says who it is for and checks the maker's profile.
// It only says "may qualify" and links the official page; the department decides. Facts kept to what the
// official pages state; amounts that change often are left out.

export type MakerFacts = {
  industryKey: string;
  businessKind: "MAKER" | "TRADER";
  gstScheme: "REGULAR" | "COMPOSITION" | "UNREGISTERED";
  udyam: boolean;
  fyTurnover: number;
  inCluster: boolean;
  marks: string[];
  machines: number;
};

export type Fit = "LIKELY" | "CHECK" | "NO";
export type SchemeResult = { fit: Fit; whyEn: string; whyHi: string };

export type Scheme = {
  key: string;
  name: string;
  nameHi: string;
  whatEn: string;
  whatHi: string;
  link: string;
  check(f: MakerFacts): SchemeResult;
};

const likely = (whyEn: string, whyHi: string): SchemeResult => ({ fit: "LIKELY", whyEn, whyHi });
const check = (whyEn: string, whyHi: string): SchemeResult => ({ fit: "CHECK", whyEn, whyHi });
const no = (whyEn: string, whyHi: string): SchemeResult => ({ fit: "NO", whyEn, whyHi });

export const SCHEMES: Scheme[] = [
  {
    key: "udyam",
    name: "Udyam Registration (MSME)",
    nameHi: "उद्यम रजिस्ट्रेशन (MSME)",
    whatEn: "Free, online, Aadhaar-based MSME registration. Unlocks the 45-day payment rule, priority-sector loans and most schemes below.",
    whatHi: "मुफ़्त, ऑनलाइन, आधार से MSME रजिस्ट्रेशन। 45 दिन में भुगतान का नियम, बैंक लोन और नीचे की ज़्यादातर योजनाएँ इसी से खुलती हैं।",
    link: "https://udyamregistration.gov.in",
    check: (f) => (f.udyam ? no("Already registered", "पहले से रजिस्टर्ड") : likely("You don't have a Udyam number yet", "अभी उद्यम नंबर नहीं है")),
  },
  {
    key: "pm-vishwakarma",
    name: "PM Vishwakarma",
    nameHi: "पीएम विश्वकर्मा",
    whatEn: "For artisans in 18 listed trades (potters, toy makers and others): recognition, skill training with a stipend, a toolkit incentive and collateral-free loans at a concessional rate.",
    whatHi: "18 तय पेशों के कारीगरों (कुम्हार, खिलौना बनाने वाले आदि) के लिए: पहचान, स्टाइपेंड के साथ ट्रेनिंग, औज़ार सहायता और बिना गारंटी सस्ता लोन।",
    link: "https://pmvishwakarma.gov.in",
    check: (f) =>
      ["pottery", "toys"].includes(f.industryKey)
        ? likely("Your trade is on the PM Vishwakarma list", "आपका पेशा पीएम विश्वकर्मा की सूची में है")
        : no("Your trade is not one of the 18 listed trades", "आपका पेशा 18 तय पेशों में नहीं है"),
  },
  {
    key: "handloom-credit",
    name: "Concessional credit for handloom weavers (Weaver MUDRA)",
    nameHi: "हथकरघा बुनकरों के लिए सस्ता लोन (वीवर मुद्रा)",
    whatEn: "Under the National Handloom Development Programme: loans for weavers with margin-money help, interest subvention and a credit guarantee.",
    whatHi: "राष्ट्रीय हथकरघा विकास कार्यक्रम में: बुनकरों को लोन, मार्जिन मनी मदद, ब्याज में छूट और क्रेडिट गारंटी।",
    link: "https://handlooms.nic.in",
    check: (f) => (f.industryKey === "handloom" ? likely("You weave on handlooms", "आप हथकरघा पर बुनते हैं") : no("Only for handloom weavers", "सिर्फ़ हथकरघा बुनकरों के लिए")),
  },
  {
    key: "india-handloom-brand",
    name: "India Handloom Brand / Handloom Mark",
    nameHi: "इंडिया हैंडलूम ब्रांड / हैंडलूम मार्क",
    whatEn: "A quality label for genuine handloom products that buyers and e-commerce platforms look for.",
    whatHi: "असली हथकरघा सामान का गुणवत्ता लेबल, जिसे ख़रीदार और ऑनलाइन बाज़ार देखते हैं।",
    link: "https://indiahandloombrand.gov.in",
    check: (f) =>
      f.industryKey !== "handloom"
        ? no("Only for handloom products", "सिर्फ़ हथकरघा सामान के लिए")
        : f.marks.includes("HANDLOOM_MARK")
          ? no("You already hold the Handloom Mark", "आपके पास हैंडलूम मार्क पहले से है")
          : likely("Your products are handloom and not yet marked", "आपका सामान हथकरघा है और अभी मार्क नहीं है"),
  },
  {
    key: "gi-user",
    name: "GI authorised user",
    nameHi: "GI अधिकृत उपयोगकर्ता",
    whatEn: "Makers in a registered GI area (e.g. Chanderi sarees, Moradabad metal craft) can register as authorised users and use the GI tag.",
    whatHi: "GI वाले इलाक़े (जैसे चंदेरी साड़ी, मुरादाबाद धातु शिल्प) के कारीगर अधिकृत उपयोगकर्ता बनकर GI टैग लगा सकते हैं।",
    link: "https://ipindia.gov.in/gi.htm",
    check: (f) =>
      f.marks.some((m) => m.startsWith("GI_"))
        ? no("You already use a GI tag", "आप पहले से GI टैग लगाते हैं")
        : f.inCluster
          ? check("Your cluster's craft may have a GI tag; ask your cooperative", "आपके क्लस्टर के शिल्प पर GI हो सकता है; सहकारी समिति से पूछें")
          : no("No GI area on your profile", "प्रोफ़ाइल में GI इलाक़ा नहीं"),
  },
  {
    key: "pmegp",
    name: "PMEGP (new or expanding units)",
    nameHi: "पीएमईजीपी (नई या बढ़ती इकाई)",
    whatEn: "Bank loan with a government subsidy (margin money) for setting up a new micro enterprise; run by KVIC.",
    whatHi: "नई छोटी इकाई लगाने के लिए बैंक लोन पर सरकारी सब्सिडी (मार्जिन मनी); KVIC चलाता है।",
    link: "https://www.kviconline.gov.in/pmegpeportal",
    check: (f) =>
      f.businessKind === "MAKER" && f.machines <= 15
        ? check("For a new unit or a second unit; your existing unit itself may not qualify", "नई या दूसरी इकाई के लिए; मौजूदा इकाई शायद नहीं")
        : no("For manufacturing / service micro units", "छोटी निर्माण / सेवा इकाइयों के लिए"),
  },
  {
    key: "cgtmse",
    name: "CGTMSE (loan without collateral)",
    nameHi: "सीजीटीएमएसई (बिना गिरवी लोन)",
    whatEn: "Banks can lend to micro and small enterprises without collateral; the trust guarantees the loan.",
    whatHi: "माइक्रो और छोटे उद्यमों को बैंक बिना गिरवी लोन दे सकते हैं; ट्रस्ट गारंटी देता है।",
    link: "https://www.cgtmse.in",
    check: (f) => (f.udyam ? likely("You are a registered MSME", "आप रजिस्टर्ड MSME हैं") : check("Register on Udyam first", "पहले उद्यम रजिस्ट्रेशन करें")),
  },
  {
    key: "stand-up-india",
    name: "Stand-Up India",
    nameHi: "स्टैंड-अप इंडिया",
    whatEn: "Bank loans for a new (greenfield) enterprise started by a woman or an SC/ST entrepreneur.",
    whatHi: "महिला या SC/ST उद्यमी के नए उद्यम के लिए बैंक लोन।",
    link: "https://www.standupmitra.in",
    check: () => check("Applies if you are a woman or SC/ST entrepreneur starting a new unit", "अगर आप महिला या SC/ST उद्यमी हैं और नई इकाई शुरू कर रहे हैं"),
  },
  {
    key: "gst-registration",
    name: "GST registration",
    nameHi: "GST रजिस्ट्रेशन",
    whatEn: "Lets you sell to other states and to GST-registered buyers who need tax credit; free on the GST portal.",
    whatHi: "दूसरे राज्यों में और GST वाले ख़रीदारों को बेचने के लिए ज़रूरी; GST पोर्टल पर मुफ़्त।",
    link: "https://reg.gst.gov.in/registration/",
    check: (f) =>
      f.gstScheme !== "UNREGISTERED"
        ? no("Already registered", "पहले से रजिस्टर्ड")
        : f.fyTurnover > 2_000_000
          ? likely("Your sales are close to the registration threshold", "आपकी बिक्री रजिस्ट्रेशन की सीमा के पास है")
          : check("Needed to sell to buyers in other states", "दूसरे राज्य के ख़रीदारों को बेचने के लिए ज़रूरी"),
  },
];

export function matchSchemes(f: MakerFacts) {
  const rank: Record<Fit, number> = { LIKELY: 0, CHECK: 1, NO: 2 };
  return SCHEMES.map((s) => ({ key: s.key, name: s.name, nameHi: s.nameHi, what: s.whatEn, whatHi: s.whatHi, link: s.link, ...s.check(f) }))
    .sort((a, b) => rank[a.fit] - rank[b.fit]);
}
