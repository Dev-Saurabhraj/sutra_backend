export const DAY_MS = 86_400_000;

export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

export const daysBetween = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / DAY_MS;

export type Lang = "hi" | "en";

export function shortDate(d: Date | null | undefined, lang: Lang = "en"): string {
  if (!d) return "-";
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** Injectable clock so services and tests agree on "now". */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
