/**
 * `atlas knock sync` — publish the whole surface map from artifacts already committed to this repository.
 *
 * ## It makes no network call and holds no credential, and that is the design rather than a limitation
 *
 * Both operation registries and the dashboard route table are generated OFFLINE by
 * `tools/generateKnockSurfaces.ts` and committed. So this verb reads two TypeScript constants, projects
 * them, and publishes — which means the surface map is reproducible on a machine with no Knock account, no
 * network, and no way to reach the vendor at all. Regenerating the constants is a separate, deliberate act
 * whose diff a human reviews (`generated/specLock.ts`).
 *
 * ## Thirty `not-configured` cells are the POINT of this verb, not an omission
 *
 * Every entity kind publishes a coverage cell saying it holds nothing and naming what would fill it. An
 * atlas that simply left those kinds absent would be indistinguishable from one whose account is empty, and
 * `docs/atlas-intent/settled-decisions.md`'s "honest about its own gaps" is exactly this: the atlas SAYS what it has not
 * looked at.
 *
 * The unblock it names is unusual and worth reading, because it is the platform's own §2 instance turned on
 * this atlas: no operation in either published document reads a Knock API key or service token, so the
 * credential that would fill the API channel is obtainable through the DASHBOARD and nowhere else.
 *
 * ## Three gap conditions are computed from the registries rather than asserted
 *
 * Each is arithmetic over the committed rows, so a regeneration that changes the platform changes the gaps
 * without anyone editing a list — and a gap that stops being true closes on the next sync rather than
 * standing as a stale claim:
 *
 * - `dashboard-page-has-no-api`, once per WALKABLE route whose subject no callable operation reads. Scoped
 *   to the route pattern, so the four that matter — the Agents workspace, the audit log, the API keys page
 *   and the service tokens page — are four findable rows rather than a number.
 * - `identifier-produced-by-neither-api`, once per read whose path identifiers neither document produces.
 * - `cross-api-identifier-dependency`, once per operation needing the other credential to learn what to
 *   call it with.
 */

import { absentAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { buildCompiledKindFile } from "../kit/compiledSync.js";
import { KNOCK_BROWSER_PAGES } from "./browserPages.js";
import { failedKnockCoverageCell, succeededKnockCoverageCell } from "./coverage.js";
import { type KnockGapCondition, openKnockGap, reconcileKnockGaps } from "./gaps.js";
import { KNOCK_ROUTES } from "./generated/routes.js";
import { KNOCK_SURFACES } from "./generated/surfaces.js";
import { KNOCK_ATLAS_KINDS, type KnockAtlasKind } from "./kinds.js";
import { mergeKnockChannel } from "./merge.js";
import {
  emptyKnockKindFile,
  initialKnockManifest,
  type KnockEntity,
  type KnockGap,
  type KnockKindFile,
  type KnockManifest,
} from "./model.js";
import { KNOCK_ROUTES_SURFACE, KNOCK_SPEC_SURFACE, projectKnockMethods, projectKnockRoutes } from "./projection.js";
import { type KnockAtlasPaths, publishKnockAtlas, readKnockAtlas, withKnockPublishLock } from "./store.js";

/** The two kinds this verb fills. Every other kind gets a `not-configured` cell and no entity. */
const SURFACE_KINDS: readonly KnockAtlasKind[] = ["method", "dashboard-route"];

/**
 * What a sync published, in the terms the verb reports.
 * @internal
 */
export interface KnockSyncOutcome {
  /** How many `dashboard-route` entities were published. */
  readonly routes: number;
  /** How many `method` entities were published. */
  readonly methods: number;
  /** How many entity kinds published a `not-configured` cell rather than rows. */
  readonly unconfiguredKinds: number;
  /** How many gaps this run detected across every kind. */
  readonly gapsDetected: number;
  /** The paths written, in the order the store wrote them. */
  readonly written: readonly string[];
}

/**
 * What would let the API channel hold anything at all.
 *
 * One string rather than one per kind, because thirty kinds are blocked on one act and a reader comparing
 * two cells should be able to see that at a glance rather than by reading thirty sentences.
 * @internal
 */
export const KNOCK_API_UNBLOCK =
  "obtain a Knock credential and run `slopweaver secrets set knock-service-token` — a Management API" +
  " service token reads the whole account, a data-API key reads one environment. NEITHER published" +
  " document declares an operation that reads or mints one, so the dashboard's own /settings/service-tokens" +
  " page is the only surface that can produce it";

/**
 * Every gap this run detected for the `dashboard-route` kind.
 *
 * Scoped to {@link KNOCK_BROWSER_PAGES} — the 57 account- and environment-scoped pages a walk visits —
 * rather than to all 154 routes, and the difference is the whole value of the finding. Every sign-in page,
 * OAuth callback and error route has no API behind it, necessarily and uninterestingly; folding those in
 * turns 19 real findings into 41 rows a reader has to filter. A gap list that has to be filtered is a gap
 * list nobody reads, and `docs/atlas-intent/settled-decisions.md` names the gap list as a deliverable in its own right.
 */
function routeGaps({ at }: { at: string }): readonly KnockGap[] {
  return KNOCK_BROWSER_PAGES.filter((page) => !page.apiBacked).map((page) =>
    openKnockGap({
      at,
      condition: "dashboard-page-has-no-api",
      fields: [],
      kind: "dashboard-route",
      reason:
        `the dashboard declares ${page.surface} and no operation this atlas would call reads what it` +
        " displays, so this page's contents are reachable in a browser and nowhere else",
      scope: page.surface,
      surfaces: ["api", "browser"],
    }),
  );
}

/** Every gap this run detected for the `method` kind. */
function methodGaps({ at }: { at: string }): readonly KnockGap[] {
  const unreachable = KNOCK_SURFACES.filter((row) => row.method === "GET" && row.identifierFrom === "unavailable").map(
    (row) =>
      openKnockGap({
        at,
        condition: "identifier-produced-by-neither-api",
        fields: [],
        kind: "method",
        reason:
          `${row.method} ${row.path} needs an identifier no operation in either published document produces,` +
          " so nothing can enumerate what to call it with",
        scope: `${row.api} ${row.method} ${row.path}`,
        surfaces: ["api"],
      }),
  );
  const crossApi = KNOCK_SURFACES.filter((row) => row.identifierFrom === "other-api").map((row) =>
    openKnockGap({
      at,
      condition: "cross-api-identifier-dependency",
      fields: [],
      kind: "method",
      reason:
        `${row.method} ${row.path} is declared by the ${row.api} API and its identifier is produced only by` +
        " the other one, so reaching it needs both credentials — which neither reference page says",
      scope: `${row.api} ${row.method} ${row.path}`,
      surfaces: ["api"],
    }),
  );
  return [...unreachable, ...crossApi];
}

/** The one gap every unconfigured entity kind carries. */
function credentialGap({ kind, at }: { kind: KnockAtlasKind; at: string }): KnockGap {
  return openKnockGap({
    at,
    condition: "api-credential-absent" satisfies KnockGapCondition,
    fields: [],
    kind,
    reason: `this installation holds no Knock credential, so no ${kind} has ever been read. ${KNOCK_API_UNBLOCK}`,
    scope: kind,
    surfaces: ["api"],
  });
}

/** Build one surface kind's next file from what the committed registries project. */
function buildSurfaceKind({
  kind,
  stored,
  at,
}: {
  kind: KnockAtlasKind;
  stored: KnockKindFile;
  at: string;
}): Result<KnockKindFile> {
  const isMethods = kind === "method";
  return buildCompiledKindFile({
    at,
    coverage: [
      succeededKnockCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason: isMethods
          ? `${String(KNOCK_SURFACES.length)} operation(s) compiled from both pinned OpenAPI documents, every declared GET confirmed to exist by an unauthenticated probe`
          : `${String(KNOCK_ROUTES.length)} route(s) read from the dashboard's own build manifest, which needs no credential`,
        role: isMethods ? "authoritative" : "discovery",
        scope: kind,
        state: "synced",
        surface: isMethods ? KNOCK_SPEC_SURFACE : KNOCK_ROUTES_SURFACE,
      }),
    ],
    kind,
    mergeChannel: ({ stored: held, observed: fresh }) =>
      mergeKnockChannel({ at, channel: "api", observed: fresh, staleAbsent: true, stored: held }),
    observed: isMethods ? projectKnockMethods({ at }) : projectKnockRoutes({ at }),
    observedGaps: isMethods ? methodGaps({ at }) : routeGaps({ at }),
    reconcile: ({ stored: held, observed: fresh, rechecks }) =>
      reconcileKnockGaps({ at, observed: fresh, rechecks, runFailed: false, stored: held }),
    stored,
  });
}

/** What an unconfigured kind observes: nothing, typed so the merge still knows what it is folding onto. */
const NO_ENTITIES: readonly KnockEntity[] = [];

/** Build one unconfigured entity kind's next file: no rows, one honest cell, one gap. */
function buildUnconfiguredKind({
  kind,
  stored,
  at,
}: {
  kind: KnockAtlasKind;
  stored: KnockKindFile;
  at: string;
}): Result<KnockKindFile> {
  return buildCompiledKindFile({
    at,
    coverage: [
      failedKnockCoverageCell({
        channel: "api",
        previous: absentAsNull({
          value: stored.coverage.find((cell) => cell.channel === "api" && cell.scope === kind),
        }),
        reason: `no Knock credential is configured, so no ${kind} has ever been read`,
        role: "authoritative",
        scope: kind,
        state: "not-configured",
        surface: "api-entities",
        unblockedBy: KNOCK_API_UNBLOCK,
      }),
    ],
    kind,
    mergeChannel: ({ stored: held }) => ok(held),
    // Typed rather than a bare literal: `buildCompiledKindFile` infers its entity type from this argument,
    // and an empty literal would infer `never` and stop the stored rows type-checking against it.
    observed: NO_ENTITIES,
    observedGaps: [credentialGap({ at, kind })],
    reconcile: ({ stored: held, observed: fresh, rechecks }) =>
      reconcileKnockGaps({ at, observed: fresh, rechecks, runFailed: false, stored: held }),
    stored,
  });
}

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  kind,
  stored,
  at,
}: {
  kind: KnockAtlasKind;
  stored: KnockKindFile | null | undefined;
  at: string;
}): KnockKindFile {
  if (stored == null) {
    return emptyKnockKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/**
 * Publish the Knock surface map from the committed registries.
 *
 * The whole read-then-publish runs under the publish lock and behind a compare-and-swap, so a dashboard
 * walk running at the same time cannot have its `browser` rows silently discarded — `store.ts` carries why
 * atomicity alone would not be enough.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing was
 */
export function syncKnockAtlas({ paths, at }: { paths: KnockAtlasPaths; at: string }): Result<KnockSyncOutcome> {
  return withKnockPublishLock({
    nowIso: at,
    paths,
    publish: (): Result<KnockSyncOutcome> => {
      const snapshot = readKnockAtlas({ paths });
      if (snapshot.isErr()) {
        return err(snapshot.error);
      }
      const { files, manifest } = snapshot.value;
      const next: Partial<Record<KnockAtlasKind, KnockKindFile>> = {};
      let gapsDetected = 0;
      for (const kind of KNOCK_ATLAS_KINDS) {
        const stored = heldKindFile({ at, kind, stored: files[kind] });
        const built = SURFACE_KINDS.includes(kind)
          ? buildSurfaceKind({ at, kind, stored })
          : buildUnconfiguredKind({ at, kind, stored });
        if (built.isErr()) {
          return err(built.error);
        }
        next[kind] = built.value;
        gapsDetected += built.value.gaps.filter((gap) => gap.status === "open").length;
      }
      const written = publishKnockAtlas({
        derivedFrom: manifest,
        files: next,
        manifest: nextManifest({ at, manifest, next }),
        paths,
      });
      if (written.isErr()) {
        return err(written.error);
      }
      return ok({
        gapsDetected,
        // Both present: the loop above set every kind in `KNOCK_ATLAS_KINDS`, or returned before reaching here.
        methods: next["method"]!.entities.length,
        routes: next["dashboard-route"]!.entities.length,
        unconfiguredKinds: KNOCK_ATLAS_KINDS.length - SURFACE_KINDS.length,
        written: written.value,
      });
    },
  });
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: KnockManifest | null; at: string }): KnockManifest {
  if (manifest == null) {
    return initialKnockManifest({ updatedAt: at });
  }
  return manifest;
}

/** The manifest to publish: every kind stamped with what this run wrote. */
function nextManifest({
  manifest,
  next,
  at,
}: {
  manifest: KnockManifest | null;
  next: Partial<Record<KnockAtlasKind, KnockKindFile>>;
  at: string;
}): KnockManifest {
  const base = heldManifest({ at, manifest });
  const kinds = { ...base.kinds };
  for (const kind of KNOCK_ATLAS_KINDS) {
    const file = next[kind];
    if (file === undefined) {
      continue;
    }
    kinds[kind] = {
      digest: base.kinds[kind].digest,
      entityCount: file.entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
