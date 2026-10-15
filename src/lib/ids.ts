export function isGooglePlaceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
