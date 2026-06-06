export function parsePagination(input: {
  limit?: unknown;
  offset?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}): { limit: number; offset: number } {
  const defaultLimit = input.defaultLimit ?? 100;
  const maxLimit = input.maxLimit ?? 200;
  const rawLimit = typeof input.limit === 'string' || typeof input.limit === 'number'
    ? Number(input.limit)
    : defaultLimit;
  const rawOffset = typeof input.offset === 'string' || typeof input.offset === 'number'
    ? Number(input.offset)
    : 0;
  const limit = Number.isFinite(rawLimit) ? rawLimit : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
  return {
    limit: Math.max(1, Math.min(maxLimit, Math.trunc(limit))),
    offset: Math.max(0, Math.trunc(offset)),
  };
}
