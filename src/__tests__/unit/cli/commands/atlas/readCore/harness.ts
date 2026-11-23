/*
 * What the `atlas read` and `atlas coverage` test files share: the fixture's fixed clock, one cloudflare snapshot,
 * the same snapshot with the two shapes the coverage gate refuses, and the read answer built over the snapshot.
 * Plain values only — no filesystem, no registry, no process.
 */
import type { AtlasReadSnapshot } from "../../../../../../atlas/kit/read.js";
import { answerAtlasRead } from "../../../../../../atlas/kit/readAnswer.js";
import type { AtlasEntitySelection } from "../../../../../../atlas/kit/selectEntities.js";

/** The fixture's own sync instant, so every freshness verdict in this file is fixed rather than wall-clock. */
export const FIXTURE_NOW_MS = Date.parse("2026-08-20T08:07:53.351Z");

/**
 * A snapshot with one kind holding one entity, and one declared-unfilled surface.
 *
 * @returns a fresh copy, so a case that spreads over it never sees another case's change
 */
// max-lines-exempt: one plain-object fixture of the whole AtlasReadSnapshot, its length that type's, moved verbatim out of a test file this gate skips
export function snapshot(): AtlasReadSnapshot {
  return {
    descriptor: {
      excludes: [{ because: "any mutation", ground: "never-acted" }],
      kinds: ["zone"],
      platform: "cloudflare",
      question: "what edge configuration exists",
      writePolicy: "refuse-every-write",
      resyncCommand: "slopweaver cloudflare sync",
      surfaces: [
        {
          denominator: { because: "a fixture surface with no provider catalogue", known: false },
          acquisition: "api",
          documented: true,
          name: "rest-api",
          role: "authoritative",
          status: "filled",
          unfilledBecause: null,
        },
        {
          denominator: { because: "a fixture surface with no provider catalogue", known: false },
          acquisition: "driven-browser",
          documented: false,
          name: "dashboard",
          role: "corroborating",
          status: "declared-unfilled",
          unfilledBecause: "nobody has driven a browser here",
        },
      ],
      visibilityScope: "configured-token-visible",
    },
    generation: {
      mismatched: [],
      missing: [],
      platform: "cloudflare",
      schemaVersion: 1,
      superseded: [],
      unpublished: [],
      updatedAt: "2026-08-20T07:07:53.351Z",
    },
    kinds: [
      {
        coverage: [
          {
            lastSuccessAt: "2026-08-20T07:07:53.351Z",
            latestAttemptFailed: false,
            reason: "read 12 zone(s)",
            scope: "account/abc",
            state: "synced",
            surface: "rest-api",
            unblockedBy: null,
          },
        ],
        entities: [
          {
            detail: { name: "acme.com" },
            id: "atlas-1",
            kind: "zone",
            observations: [
              {
                artifacts: [],
                deepLink: null,
                deepLinkStatus: "unverified",
                endpoint: "zones-list",
                observedAt: "2026-08-20T07:07:53.351Z",
                state: "observed",
                surface: "rest-api",
              },
            ],
            providerId: "00000000000000000000000000002e01",
            scope: "account/abc",
          },
        ],
        gaps: [
          {
            condition: "permission-refused",
            id: "gap-1",
            lastDetectedAt: "2026-08-20T07:07:53.351Z",
            reason: "the configured token cannot see this surface",
            scope: "zone/abc",
            status: "open",
          },
        ],
        kind: "zone",
        lastSuccessAt: "2026-08-20T07:07:53.351Z",
        latestAttemptFailed: false,
        permissionBlocked: null,
        publishedCount: 1,
      },
    ],
  };
}

/**
 * The fixture answer, with one entity's `detail` and the caller's selection under the test's control.
 *
 * @param detail what the provider's payload holds for the single fixture entity
 * @param selection the caller's own filters, merged over the fixture default
 * @returns the answer `renderAtlasRead` and `atlasReadJson` both take
 */
export function answeredWith({
  detail = { name: "acme.com" },
  selection,
}: {
  detail?: unknown;
  selection: Partial<AtlasEntitySelection>;
}): ReturnType<typeof answerAtlasRead> {
  const base = snapshot();
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the snapshot above always holds one kind; a guard would add a failure path the old in-file helper never had
  const kind = base.kinds[0]!;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- that kind always holds one entity; a guard would add a failure path the old in-file helper never had
  const entity = kind.entities[0]!;
  const kinds = [{ ...kind, entities: [{ ...entity, detail }] }];
  return answerAtlasRead({
    kinds,
    nowMs: FIXTURE_NOW_MS,
    selection: { includeStale: false, ...selection },
    snapshot: { ...base, kinds },
  });
}

/**
 * The same snapshot with the two shapes the coverage gate refuses: an exclusion nobody fetched, and a kind
 * left `deferred`. Built by replacement rather than by a flag, so the clean case above stays the default.
 *
 * @returns a fresh copy of the snapshot carrying one `not-fetched` exclusion and one `deferred` cell
 */
export function refusedSnapshot(): AtlasReadSnapshot {
  const base = snapshot();
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the snapshot above always holds one kind; a guard would add a failure path the old in-file helper never had
  const kind = base.kinds[0]!;
  return {
    ...base,
    descriptor: {
      ...base.descriptor,
      excludes: [
        { because: "any mutation", ground: "never-acted" },
        { because: "modern account and zone Rulesets", ground: "not-fetched", wouldBeClosedBy: "the Rulesets reads" },
      ],
    },
    kinds: [
      {
        ...kind,
        coverage: [
          ...kind.coverage,
          {
            lastSuccessAt: null,
            latestAttemptFailed: false,
            reason: "17 of 32 declared page(s) reached",
            scope: "dashboard",
            state: "deferred",
            surface: "dashboard",
            unblockedBy: null,
          },
        ],
      },
    ],
  };
}
