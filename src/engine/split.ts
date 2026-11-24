// Split a bulk order across makers in a cluster by what each can make by the date. Pure.

export type SplitCandidate = { producerId: string; productId: string; capacityByDate: number };
export type SplitRow = SplitCandidate & { assigned: number };
export type SplitResult = { rows: SplitRow[]; totalCapacity: number; covered: number; qty: number };

export function splitByCapacity(candidates: SplitCandidate[], qty: number, preferProducerId?: string): SplitResult {
  const rows: SplitRow[] = candidates
    .map((c) => ({ ...c, assigned: 0 }))
    .sort((a, b) => b.capacityByDate - a.capacityByDate);
  const totalCapacity = rows.reduce((a, r) => a + r.capacityByDate, 0);
  let left = qty;

  // The maker the buyer picked gets their full capacity first.
  const preferred = rows.find((r) => r.producerId === preferProducerId);
  if (preferred) {
    preferred.assigned = Math.min(preferred.capacityByDate, left);
    left -= preferred.assigned;
  }

  // The rest is shared in proportion to free capacity, so nobody is overloaded.
  const others = rows.filter((r) => r !== preferred);
  const otherCap = others.reduce((a, r) => a + r.capacityByDate, 0);
  const toShare = left;
  for (const r of others) {
    if (left <= 0) break;
    const share = otherCap > 0 ? Math.round((r.capacityByDate / otherCap) * toShare) : 0;
    r.assigned = Math.min(r.capacityByDate, share, left);
    left -= r.assigned;
  }
  // Rounding leftovers go to whoever still has room, biggest first.
  for (const r of others) {
    if (left <= 0) break;
    const extra = Math.min(r.capacityByDate - r.assigned, left);
    r.assigned += extra;
    left -= extra;
  }

  const ordered = preferred ? [preferred, ...others] : others;
  return { rows: ordered.filter((r) => r.capacityByDate > 0), totalCapacity, covered: qty - left, qty };
}
