/**
 * Hand-built atlas views the access-review tests run over.
 *
 * Hand-built rather than materialised from this install's own atlases, deliberately: the numbers in this
 * repository's stores move every resync, so a test asserting against them would fail on a day nobody changed
 * any code. What the tests need is the SHAPE — a channelled detail, a kind that mixes surface families, an
 * address carrying two employment spells — and each of those is written here in the smallest form that
 * reproduces it.
 */
import type { AtlasCoverageState } from "../../../atlas/kit/contract.js";
import type { AtlasEntityView, AtlasKindView, AtlasReadSnapshot } from "../../../atlas/kit/read.js";

/**
 * One entity view with the detail a caller gives it.
 *
 * @param providerId the provider id, which is what a surface-family filter reads
 * @param detail the record detail, in the shape the platform's adapter presents
 * @param state its one observation's state; `stale` is a record a complete read no longer returned
 * @returns the view
 */
export function entity({
  providerId,
  detail,
  state = "observed",
}: {
  providerId: string;
  detail: unknown;
  state?: "observed" | "stale";
}): AtlasEntityView {
  return {
    detail,
    id: providerId,
    kind: "test-kind",
    observations: [
      {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: "test",
        observedAt: "2026-10-19T00:00:00.000Z",
        state,
        surface: "test",
      },
    ],
    providerId,
    scope: "test",
  };
}

/**
 * One kind view, with every field a boundary reads.
 *
 * @param kind the kind name
 * @param lastSuccessAt its read stamp
 * @param latestAttemptFailed whether the most recent attempt failed
 * @param publishedCount what the manifest vouches for; omitted takes the entity count
 * @returns the view
 */
export function kindView({
  kind,
  entities,
  lastSuccessAt,
  latestAttemptFailed = false,
  publishedCount = entities.length,
}: {
  kind: string;
  entities: readonly AtlasEntityView[];
  lastSuccessAt: string | null;
  latestAttemptFailed?: boolean;
  publishedCount?: number;
}): AtlasKindView {
  return {
    coverage: [],
    entities,
    gaps: [],
    kind,
    lastSuccessAt,
    latestAttemptFailed,
    permissionBlocked: null,
    publishedCount,
  };
}

/**
 * One Vanta person record's detail — one employment spell.
 *
 * @param email the address
 * @param display the display name
 * @param status the employment status, verbatim
 * @param endDate the employment end date, verbatim
 * @returns the detail object a spine projection reads
 */
export function personDetail({
  email,
  display,
  status,
  endDate,
}: {
  email: string;
  display: string;
  status: string;
  endDate: string | null;
}): unknown {
  return {
    emailAddress: email,
    employment: { endDate, jobTitle: null, status },
    name: { display },
  };
}

/**
 * One coverage cell, with every field the kit's view carries.
 *
 * @param surface the declared surface that produced it
 * @param scope the account or org scope it covers
 * @param state the coverage state, verbatim
 * @param reason the cell's own reason, which is what a declared boundary reads
 * @returns the cell
 */
export function coverageCell({
  surface,
  scope,
  state,
  reason,
}: {
  surface: string;
  scope: string;
  state: AtlasCoverageState;
  reason: string;
}): AtlasKindView["coverage"][number] {
  return {
    lastSuccessAt: null,
    latestAttemptFailed: false,
    reason,
    scope,
    state,
    surface,
    unblockedBy: null,
  };
}

/**
 * One whole read snapshot around the kinds a caller gives it.
 *
 * @param platform the atlas the snapshot is of
 * @param kinds its projected kinds
 * @returns the snapshot, with the smallest descriptor and generation that satisfy the kit's contract
 */
export function snapshot({
  platform,
  kinds,
}: {
  platform: string;
  kinds: readonly AtlasKindView[];
}): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [{ because: "a fixture never writes", ground: "never-acted" }],
      kinds: kinds.map((view) => view.kind),
      platform,
      question: "who holds access here",
      resyncCommand: `slopweaver ${platform} sync`,
      surfaces: [
        {
          acquisition: "api",
          denominator: { because: "a fixture surface has no provider catalogue", known: false },
          documented: true,
          name: "rest-api",
          role: "authoritative",
          status: "filled",
          unfilledBecause: null,
        },
      ],
      visibilityScope: "configured-token-visible",
      writePolicy: "refuse-every-write",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform,
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: null,
    },
    kinds,
  };
}
