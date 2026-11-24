// GSTIN validation with the official mod-36 checksum (ported from thread/src/lib/gst.ts).
import { stateForCode, STATE_CODES } from "./states.js";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14.charAt(i));
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS.charAt((36 - (sum % 36)) % 36);
}

export type GstinCheck = { valid: boolean; reason?: string; state?: string };

export function validateGstin(raw: string | null | undefined): GstinCheck {
  const g = (raw ?? "").trim().toUpperCase();
  if (g.length !== 15) return { valid: false, reason: "GSTIN must be 15 characters" };
  if (!FORMAT.test(g)) return { valid: false, reason: "Format is wrong (should look like 23ABCDE1234F1Z5)" };
  const state = stateForCode(g.slice(0, 2));
  if (!state) return { valid: false, reason: `Unknown state code ${g.slice(0, 2)}` };
  if (gstinChecksum(g.slice(0, 14)) !== g.charAt(14)) {
    return { valid: false, reason: "Check digit does not match: likely a typo or a fake GSTIN", state };
  }
  return { valid: true, state };
}

/** Build a valid GSTIN (seed data and tests). `pan` is 10 characters. */
export function makeGstin(state: string, pan: string, entity = "1"): string {
  const code = STATE_CODES[state];
  if (!code) throw new Error(`No GST state code for ${state}`);
  const first14 = `${code}${pan}${entity}Z`;
  return first14 + gstinChecksum(first14);
}
