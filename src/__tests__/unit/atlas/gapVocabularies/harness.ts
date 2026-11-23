/*
 * What the spread-vocabulary test files share: the two instants, the probe scope and reason, the arrays a
 * constructor must carry through, the shape of one platform's case, and the open-then-resolve composition each
 * case's lifecycle check runs. It moved here when the family's one test file was split by behaviour.
 */
import type { Result } from "#lib/result.js";
import { unwrap } from "#lib/result.js";
import type { AtlasGapRecheck } from "../../../../atlas/kit/gaps.js";

export const AT = "2026-09-30T01:00:00.000Z";
export const LATER = "2026-10-01T01:00:00.000Z";
export const SCOPE = "vocabulary-probe";
export const REASON = "raised by the vocabulary test";
/** Non-empty, so a constructor that drops or truncates the caller's arrays fails the carried-through case. */
export const FIELDS = ["probe-field-a", "probe-field-b"] as const;
/**
 * The one channel every platform here except aether (see `AETHER_SURFACES` in `atlas/aether/model.ts`) and
 * onepassword declares.
 */
export const SURFACES = ["browser"] as const;

/** What every stored gap in this family carries, whatever else its platform adds. */
interface StampedGap {
  readonly condition: string;
  readonly firstDetectedAt: string;
  readonly id: string;
  readonly kind: string | null;
  readonly lastCheckedAt: string | null;
  readonly reason: string;
  readonly lastDetectedAt: string;
  readonly scope: string;
  readonly status: "open" | "closed";
}

/** One platform whose vocabulary spreads the kit's, with its constructor and lifecycle bound to one condition. */
export interface SpreadCase {
  /** What the constructor was handed beyond the stamp, which the gap must carry through exactly. */
  readonly carried: Readonly<Record<string, unknown>>;
  readonly platform: string;
  readonly vocabulary: readonly string[];
  /** The platform's own constructor, raising {@link SpreadCase.condition} at {@link SCOPE}. */
  readonly open: (input: { at: string }) => StampedGap;
  /** The condition the constructor raises — the vocabulary's first member. */
  readonly condition: string;
  /** Open at {@link AT}, then reconcile at {@link LATER} with a resolved recheck of the same pair. */
  readonly openThenRecheck: () => readonly StampedGap[];
}

/**
 * Store one gap, then reconcile a run that rechecked exactly its `(condition, scope)` and found it answered.
 *
 * The recheck names the condition and scope the TEST chose, never the ones read back off the gap, so a
 * constructor that minted its id any other way leaves the gap open.
 *
 * @param gap the gap as the platform's own constructor built it
 * @param condition the condition the constructor was asked to raise
 * @param reconcile the platform's own reconcile, or the kit's where the platform has none
 * @returns every gap after the reconcile
 */
export function openThenResolve<TGap extends StampedGap>({
  gap,
  condition,
  reconcile,
}: {
  gap: TGap;
  condition: string;
  reconcile: (input: {
    stored: readonly TGap[];
    observed: readonly TGap[];
    rechecks: readonly AtlasGapRecheck[];
    runFailed: boolean;
    at: string;
  }) => Result<readonly TGap[]>;
}): readonly TGap[] {
  return unwrap(
    reconcile({
      at: LATER,
      observed: [],
      rechecks: [{ condition, resolved: true, scope: SCOPE }],
      runFailed: false,
      stored: [gap],
    }),
  );
}
