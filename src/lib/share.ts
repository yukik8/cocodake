export const MAX_EXPIRES_IN_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// 0 = never expires. Anything that is not a whole number of days in 0..365 is rejected
// (before, NaN or a negative value silently meant "never expires").
export function parseExpiresInDays(value: unknown): number | null {
  if (value === undefined) return 30;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_EXPIRES_IN_DAYS) return null;
  return value;
}

export function computeExpiresAt(days: number, now: number = Date.now()): string | null {
  return days > 0 ? new Date(now + days * DAY_MS).toISOString() : null;
}

export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= now;
}
