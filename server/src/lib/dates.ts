export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` until `date`, rounded down; negative once `date` has passed. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}
