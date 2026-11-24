export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
/** ₹1,23,456 — whole rupees, Indian grouping. For messages; the app formats its own numbers. */
export const inr = (n: number): string => inrFmt.format(Math.round(n));
