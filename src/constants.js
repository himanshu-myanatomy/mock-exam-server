/** Mirrors backend `src/models/constants.ts` plan / security template values. */

export const PLAN_TYPE = {
  STANDARD: 'STANDARD',
  STRICT: 'STRICT',
};

export const SECURITY_TEMPLATE = PLAN_TYPE;

export function parsePlanType(raw) {
  const normalized = String(raw ?? '').trim();
  if (normalized === PLAN_TYPE.STRICT) return PLAN_TYPE.STRICT;
  if (normalized === PLAN_TYPE.STANDARD) return PLAN_TYPE.STANDARD;
  return null;
}

export function isPlanType(value) {
  return parsePlanType(value) != null;
}

/** Default only when env/value is empty; invalid explicit values return null. */
export function resolvePlanType(raw) {
  const normalized = String(raw ?? '').trim();
  if (!normalized) return PLAN_TYPE.STANDARD;
  return parsePlanType(raw);
}
