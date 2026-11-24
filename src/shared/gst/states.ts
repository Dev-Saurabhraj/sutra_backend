/** GST state codes (first two digits of a GSTIN). */
export const STATE_CODES: Readonly<Record<string, string>> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  Punjab: "03",
  Chandigarh: "04",
  Uttarakhand: "05",
  Haryana: "06",
  Delhi: "07",
  Rajasthan: "08",
  "Uttar Pradesh": "09",
  Bihar: "10",
  Sikkim: "11",
  "Arunachal Pradesh": "12",
  Nagaland: "13",
  Manipur: "14",
  Mizoram: "15",
  Tripura: "16",
  Meghalaya: "17",
  Assam: "18",
  "West Bengal": "19",
  Jharkhand: "20",
  Odisha: "21",
  Chhattisgarh: "22",
  "Madhya Pradesh": "23",
  Gujarat: "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  Maharashtra: "27",
  Karnataka: "29",
  Goa: "30",
  Lakshadweep: "31",
  Kerala: "32",
  "Tamil Nadu": "33",
  Puducherry: "34",
  "Andaman and Nicobar Islands": "35",
  Telangana: "36",
  "Andhra Pradesh": "37",
  Ladakh: "38",
};

const CODE_TO_STATE = new Map(Object.entries(STATE_CODES).map(([state, code]) => [code, state]));

export const stateForCode = (code: string): string | undefined => CODE_TO_STATE.get(code);

/** Best-effort city → state for voice notes like "4 Jaipur bheji". Unknown cities return undefined. */
const STATE_BY_CITY: Readonly<Record<string, string>> = {
  jaipur: "Rajasthan",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  mumbai: "Maharashtra",
  pune: "Maharashtra",
  delhi: "Delhi",
  "new delhi": "Delhi",
  indore: "Madhya Pradesh",
  bhopal: "Madhya Pradesh",
  surat: "Gujarat",
  ahmedabad: "Gujarat",
  lucknow: "Uttar Pradesh",
  varanasi: "Uttar Pradesh",
  kolkata: "West Bengal",
  chennai: "Tamil Nadu",
  hyderabad: "Telangana",
};

export const stateForCity = (city: string): string | undefined => STATE_BY_CITY[city.trim().toLowerCase()];
