/**
 * A UPI intent link that pays straight into the maker's own UPI ID. Sutra never holds the money, so no
 * payment-aggregator licence is involved (README §3.2); a licensed gateway can replace this later.
 */
export function upiLink(vpa: string, payee: string, amount: number, note: string): string {
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

/** A UPI transaction reference (UTR / RRN) is 12 digits. */
export const UTR = /^\d{12}$/;
