/**
 * Publish all three surface maps — every operation the pinned document declares, every authorization-server
 * endpoint the probe established, and every console route that could be established at all — plus an honest
 * coverage cell for every kind none of them fills.
 *
 * ## It makes no network call and presents no credential
 *
 * All three inventories are compiled: `generated/surfaces.ts` from the platform's own OpenAPI document
 * pinned by digest, `authEndpoints.ts` and `apiProbe.ts` from unauthenticated probes whose results are
 * committed, and `consoleRoutes.ts` from a signed-out request and the console's own route manifest. So this
 * verb is a pure local publish, which is what lets the atlas exist at all on an installation holding no
 * Prisma credential.
 *
 * ## The twenty-three empty kinds are the point, not an omission
 *
 * A kind with no entities and no coverage cell says nothing. A kind with a `not-configured` cell naming the
 * missing credential says exactly what is true, and `kit/coverage.ts` does not count it as usable coverage —
 * so a reader cannot cite this atlas for a fact about a Prisma database, and cannot mistake the emptiness
 * for the organisation holding none. That distinction is `docs/atlas-intent/settled-decisions.md`'s "honest about where it
 * thinks it's got gaps" applied to the case where the gap is a credential one.
 *
 * ## Which gaps this run opens, and the one class it deliberately does not
 *
 * Five come off the document and the probes — the seventy undocumented operations, the four undeclared
 * authorization endpoints, the one operation whose own `security` block contradicts its description and the
 * live service, the console origin that discriminates nothing, and the absent signed-in browser session —
 * and one comes off neither surface: `vendor-inventory-disagreement`, which is about the organisation's own
 * two records of this vendor rather than about Prisma.
 *
 * What this run deliberately does NOT open is a gap per undocumented operation. Seventy rows would restate,
 * once per operation, the single fact one gap carries with its own arithmetic. A gap list is a deliverable
 * (`docs/atlas-intent/settled-decisions.md`) and a gap list nobody can read is not one.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { PRISMA_PROBE_CENSUS, PRISMA_PROBE_CONTROLS } from "./apiProbe.js";
import { PRISMA_AUTH_ENDPOINTS, prismaAbsentAuthEndpoints, prismaConfirmedAuthEndpoints } from "./authEndpoints.js";
import { PRISMA_CONSOLE_CANDIDATES, PRISMA_CONSOLE_MANIFEST, PRISMA_CONSOLE_ROUTES } from "./consoleRoutes.js";
import { prismaSurfaceLastSuccess, succeededPrismaCoverageCell } from "./coverage.js";
import { openPrismaGap, type PrismaGapRecheck, reconcilePrismaGaps } from "./gaps.js";
import {
  PRISMA_SPEC_CENSUS,
  PRISMA_SPEC_DISAGREEMENTS,
  PRISMA_SPEC_PIN,
  PRISMA_STABILITY_CENSUS,
  PRISMA_UNDECLARED_ENDPOINTS,
} from "./generated/specLock.js";
import { PRISMA_DATA_PLATFORM_SURFACES } from "./generated/surfaces.js";
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS, type PrismaDataPlatformAtlasKind } from "./kinds.js";
import { mergePrismaChannel } from "./merge.js";
import {
  heldPrismaDataPlatformKindFile,
  heldPrismaDataPlatformManifest,
  type PrismaDataPlatformAtlasChannel,
  type PrismaDataPlatformEntity,
  type PrismaDataPlatformGap,
  type PrismaDataPlatformKindFile,
  type PrismaDataPlatformManifest,
} from "./model.js";
import {
  PRISMA_AUTH_SURFACE,
  PRISMA_CONSOLE_SURFACE,
  PRISMA_SPEC_SURFACE,
  prismaFillableKinds,
  projectPrismaAuthEndpoints,
  projectPrismaConsoleRoutes,
  projectPrismaMethods,
} from "./projection.js";
import {
  type PrismaDataPlatformAtlasPaths,
  publishPrismaDataPlatformAtlas,
  readPrismaDataPlatformAtlas,
  withPrismaDataPlatformPublishLock,
} from "./store.js";

/**
 * The surface name under which every unreachable entity kind reports why it is empty.
 * @internal
 */
export const PRISMA_ENTITY_SURFACE = "management-api";

/**
 * What would fill every entity kind, named once so twenty-three cells cannot drift apart.
 * @internal
 */
export const PRISMA_ENTITY_UNBLOCK =
  "a Prisma service token created in the console under Settings → Service Tokens, stored with" +
  " `slopweaver secrets set prisma-data-platform-token`. Note the credential TYPE matters here: a service" +
  " token never expires, while an OAuth access token lasts an hour and needs the `offline_access` scope to" +
  " be refreshable at all";

/**
 * What publishing the surface maps did.
 * @internal
 */
export interface PrismaSyncOutcome {
  readonly operationCount: number;
  readonly documentedOperationCount: number;
  readonly authEndpointCount: number;
  readonly confirmedAuthEndpointCount: number;
  readonly consoleRouteCount: number;
  readonly unreachableKindCount: number;
  readonly openGapCount: number;
  readonly written: readonly string[];
}

/**
 * Publish all three compiled surface maps and the honest coverage for everything else.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function syncPrismaDataPlatformSurfaces({
  paths,
  at,
}: {
  paths: PrismaDataPlatformAtlasPaths;
  at: string;
}): Result<PrismaSyncOutcome> {
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withPrismaDataPlatformPublishLock`.
  return withPrismaDataPlatformPublishLock({ nowIso: at, paths, publish: () => publishSurfaces({ at, paths }) });
}

/**
 * The three surface-map kinds this run fills, each merged onto what was stored and carrying its own coverage
 * cell and gaps.
 *
 * Split out of {@link publishSurfaces} so the critical section reads as read → build → publish rather than as
 * nine interleaved `isErr` checks. Every step is fallible for the same reason — the kit's merge refuses a
 * duplicate id and its gap reconciler refuses a duplicate `(condition, scope)` — so the short-circuiting is
 * the whole body and it belongs in one place.
 */
function surfaceMapFiles({
  stored,
  at,
}: {
  stored: Readonly<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile | null>>;
  at: string;
}): Result<Readonly<Record<"console-route" | "method" | "oauth-endpoint", PrismaDataPlatformKindFile>>> {
  const methodFile = mergedFile({
    at,
    channel: "api",
    kind: "method",
    observed: projectPrismaMethods({ at }),
    stored: stored.method,
  });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  const authFile = mergedFile({
    at,
    channel: "api",
    kind: "oauth-endpoint",
    observed: projectPrismaAuthEndpoints({ at }),
    stored: stored["oauth-endpoint"],
  });
  if (authFile.isErr()) {
    return err(authFile.error);
  }
  const consoleFile = mergedFile({
    at,
    channel: "browser",
    kind: "console-route",
    observed: projectPrismaConsoleRoutes({ at }),
    stored: stored["console-route"],
  });
  if (consoleFile.isErr()) {
    return err(consoleFile.error);
  }
  const gappedMethods = methodGapsOnto({ at, file: specCoverageOnto({ at, file: methodFile.value }) });
  if (gappedMethods.isErr()) {
    return err(gappedMethods.error);
  }
  const gappedAuth = authGapsOnto({ at, file: authCoverageOnto({ at, file: authFile.value }) });
  if (gappedAuth.isErr()) {
    return err(gappedAuth.error);
  }
  const gappedConsole = consoleGapsOnto({ at, file: consoleCoverageOnto({ at, file: consoleFile.value }) });
  if (gappedConsole.isErr()) {
    return err(gappedConsole.error);
  }
  return ok({
    "console-route": gappedConsole.value,
    method: gappedMethods.value,
    "oauth-endpoint": gappedAuth.value,
  });
}

/**
 * Every kind no surface map fills, each with the cell saying why — and the `workspace` kind additionally
 * carrying the vendor-inventory gap, which is the one question here that is about the organisation.
 */
function unreachableKindFiles({
  stored,
  at,
}: {
  stored: Readonly<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile | null>>;
  at: string;
}): Result<Readonly<Partial<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile>>>> {
  const files: Partial<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile>> = {};
  const unreachable = PRISMA_DATA_PLATFORM_ATLAS_KINDS.filter((kind) => !prismaFillableKinds().includes(kind));
  for (const kind of unreachable) {
    const empty = unreachableKindFile({ at, kind, stored: stored[kind] });
    if (kind !== "workspace") {
      files[kind] = empty;
      continue;
    }
    const gapped = vendorInventoryGapOnto({ at, file: empty });
    if (gapped.isErr()) {
      return err(gapped.error);
    }
    files[kind] = gapped.value;
  }
  return ok(files);
}

/** How many gaps one run's published files hold between them. */
function openGapCountOf({
  files,
}: {
  files: Readonly<Partial<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile>>>;
}): number {
  return Object.values(files).reduce((total, file) => total + file.gaps.length, 0);
}

/** The critical section: read the generation, merge each channel onto it, and publish. */
function publishSurfaces({
  paths,
  at,
}: {
  paths: PrismaDataPlatformAtlasPaths;
  at: string;
}): Result<PrismaSyncOutcome> {
  const snapshot = readPrismaDataPlatformAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { files: stored, manifest } = snapshot.value;
  const maps = surfaceMapFiles({ at, stored });
  if (maps.isErr()) {
    return err(maps.error);
  }
  const empties = unreachableKindFiles({ at, stored });
  if (empties.isErr()) {
    return err(empties.error);
  }
  const files = { ...empties.value, ...maps.value };
  const published = publishPrismaDataPlatformAtlas({
    derivedFrom: manifest,
    files,
    manifest: syncManifest({ at, files, manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    authEndpointCount: PRISMA_AUTH_ENDPOINTS.length,
    confirmedAuthEndpointCount: prismaConfirmedAuthEndpoints().length,
    consoleRouteCount: PRISMA_CONSOLE_ROUTES.length,
    documentedOperationCount: PRISMA_STABILITY_CENSUS.documentedOperations,
    openGapCount: openGapCountOf({ files }),
    operationCount: PRISMA_DATA_PLATFORM_SURFACES.length,
    unreachableKindCount: Object.keys(empties.value).length,
    written: published.value,
  });
}

/** One kind's file with this run's channel merged onto whatever was stored. */
function mergedFile({
  kind,
  channel,
  observed,
  stored,
  at,
}: {
  kind: PrismaDataPlatformAtlasKind;
  channel: PrismaDataPlatformAtlasChannel;
  observed: readonly PrismaDataPlatformEntity[];
  stored: PrismaDataPlatformKindFile | null;
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  const held = heldPrismaDataPlatformKindFile({ kind, stored, updatedAt: at });
  const merged = mergePrismaChannel({ at, channel, observed, stored: held.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  return ok({ ...held, entities: [...merged.value], updatedAt: at });
}

/** The method kind with the spec channel's own coverage cell replaced and nothing else touched. */
function specCoverageOnto({ file, at }: { file: PrismaDataPlatformKindFile; at: string }): PrismaDataPlatformKindFile {
  const reason =
    `${String(PRISMA_SPEC_CENSUS.operations)} operation(s) across ${String(PRISMA_SPEC_CENSUS.paths)} path(s) ` +
    `in the platform's own OpenAPI ${PRISMA_SPEC_PIN.openapi} document, served unauthenticated at ` +
    `${PRISMA_SPEC_PIN.documentUrl} and pinned at sha256 ${PRISMA_SPEC_PIN.documentSha256}. Compiled ` +
    "offline: no request was made to Prisma during this run and no credential was presented. All " +
    `${String(PRISMA_PROBE_CENSUS.probedGets)} declared GET operations were separately confirmed to EXIST ` +
    `against ${String(PRISMA_PROBE_CONTROLS.length)} controls that answer 404, with none absent — so this ` +
    "cell claims the declared read surface was read in full AND corroborated against the running service, " +
    "and claims nothing about what any credential may call";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== PRISMA_SPEC_SURFACE),
      succeededPrismaCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "declared-operations",
        state: "synced",
        surface: PRISMA_SPEC_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/** The oauth-endpoint kind with the authorization server's own coverage cell replaced. */
function authCoverageOnto({ file, at }: { file: PrismaDataPlatformKindFile; at: string }): PrismaDataPlatformKindFile {
  const confirmed = prismaConfirmedAuthEndpoints().length;
  const absent = prismaAbsentAuthEndpoints().length;
  const reason =
    `${String(PRISMA_AUTH_ENDPOINTS.length)} endpoint(s) on auth.prisma.io: ${String(confirmed)} whose ` +
    `existence an unauthenticated probe confirmed and ${String(absent)} it established are NOT there, ` +
    "measured against a control that answers 404. The absences are the useful half — there is no OpenID " +
    "Connect discovery document and no userinfo endpoint, so this platform is OAuth 2.0 without an " +
    "identity layer. `yarn tsx tools/probePrismaDataPlatformSurface.ts --auth --verify` reproduces every row";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== PRISMA_AUTH_SURFACE),
      succeededPrismaCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "authorization-server",
        state: "synced",
        surface: PRISMA_AUTH_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/**
 * The console-route kind's coverage cell.
 *
 * `unreadable` rather than `synced`, and the state is the honest one: what this cell covers is the console's
 * route inventory, and the inventory could not be read. Three routes were established and the origin refused
 * to distinguish anything else from an invented path, so claiming `synced` would report a surface as
 * acquired when its denominator is unknown.
 */
function consoleCoverageOnto({
  file,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  at: string;
}): PrismaDataPlatformKindFile {
  const reason =
    `${String(PRISMA_CONSOLE_ROUTES.length)} console route(s) established, and the inventory cannot be ` +
    `completed without signing in. Every one of ${String(PRISMA_CONSOLE_CANDIDATES.length)} candidate ` +
    "paths — `/settings`, `/workspaces`, `/admin`, even `/robots.txt` — answered the identical sign-in " +
    "redirect an invented control answers, so a signed-out probe cannot tell a real page from one nobody " +
    `built. The console's own signed-out route manifest agrees: ${String(PRISMA_CONSOLE_MANIFEST.declaredEntries)} ` +
    `entries, ${String(PRISMA_CONSOLE_MANIFEST.addressablePaths)} addressable paths. ` +
    "`yarn tsx tools/probePrismaDataPlatformSurface.ts --console --verify` reproduces every row";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== PRISMA_CONSOLE_SURFACE),
      {
        artifacts: [],
        channel: "browser",
        lastSuccessAt: prismaSurfaceLastSuccess({ coverage: file.coverage, surface: PRISMA_CONSOLE_SURFACE }),
        latestAttemptFailed: true,
        reason,
        role: "discovery",
        scope: "declared-routes",
        state: "unreadable",
        surface: PRISMA_CONSOLE_SURFACE,
        unblockedBy:
          "a walk of console.prisma.io in the owner's own work Chrome, signed in. That is the ONLY thing" +
          " that reveals this origin's route tree; the application serves it to an authenticated client and" +
          " to nobody else",
        visibilityScope: "browser-signed-in-role",
      },
    ],
    updatedAt: at,
  };
}

/** The method kind's gaps: what the document and the docs site together say the API surface cannot answer. */
function methodGapsOnto({
  file,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  const undocumented = openPrismaGap({
    at,
    condition: "docs-omit-declared-operation",
    fields: [],
    kind: "method",
    reason:
      `${String(PRISMA_STABILITY_CENSUS.undocumentedOperations)} of the ` +
      `${String(PRISMA_SPEC_CENSUS.operations)} operations this platform declares have no documentation ` +
      "page at all, and the partition is EXACT: the " +
      `${String(PRISMA_STABILITY_CENSUS.documentedOperations)} operations www.prisma.io/docs publishes a ` +
      "page for are precisely the ones carrying no `x-prisma-stability` extension, with zero overlap in " +
      "either direction. What is undocumented is the whole Prisma Compute product — services, deployments, " +
      "builds, branches, custom domains, environment variables, SCM installations, source repositories and " +
      "a twelve-operation infrastructure-state store. A reader working from the documentation would " +
      "conclude this is a Postgres management API and never learn the rest is reachable. Only Prisma " +
      "publishing pages closes this",
    scope: "docs:endpoint-reference",
    surfaces: ["api"],
  });
  const undeclared: readonly PrismaDataPlatformGap[] = PRISMA_UNDECLARED_ENDPOINTS.map((endpoint) =>
    openPrismaGap({
      at,
      condition: "spec-references-undeclared-endpoint",
      fields: [],
      kind: "method",
      reason:
        `the platform names ${endpoint.method} ${endpoint.url} at \`${endpoint.namedAt}\` and declares no ` +
        `path for it, so it appears in no operation listing. It holds ${endpoint.holds}. A reader who ` +
        "enumerated `paths` alone would conclude this platform has no authorization surface at all — " +
        "`authEndpoints.ts` carries what each of them actually answered",
      scope: `endpoint:${endpoint.method} ${endpoint.url}`,
      surfaces: ["api"],
    }),
  );
  const contradictions: readonly PrismaDataPlatformGap[] = PRISMA_SPEC_DISAGREEMENTS.map((row) =>
    openPrismaGap({
      at,
      condition: "surface-self-contradiction",
      fields: ["security"],
      kind: "method",
      reason: `${row.operation}: the document says ${row.documentSays}; the live service ${row.liveServiceSays}. ${row.reading}`,
      scope: `operation:${row.operation}`,
      surfaces: ["api"],
    }),
  );
  const observed = [undocumented, ...undeclared, ...contradictions];
  return withGaps({ at, file, observed });
}

/** The oauth-endpoint kind's gaps: none of its own, since every row is settled by a probe. */
function authGapsOnto({
  file,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  return withGaps({ at, file, observed: [] });
}

/** The console-route kind's gaps: the origin's own refusal to discriminate, and the absent session. */
function consoleGapsOnto({
  file,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  const indiscriminate = openPrismaGap({
    at,
    condition: "console-origin-indiscriminate",
    fields: [],
    kind: "console-route",
    reason:
      `every one of ${String(PRISMA_CONSOLE_CANDIDATES.length)} candidate paths on console.prisma.io — ` +
      "including `/robots.txt` and `/sitemap.xml` — answers the same sign-in redirect an invented control " +
      "answers, so the authentication gate sits in front of the router and a signed-out probe establishes " +
      "nothing about route existence. The application's own route manifest, embedded in the page it serves " +
      `a signed-out visitor, agrees: ${String(PRISMA_CONSOLE_MANIFEST.declaredEntries)} entries and ` +
      `${String(PRISMA_CONSOLE_MANIFEST.addressablePaths)} addressable paths. This atlas therefore declares ` +
      "the three routes it established and does NOT invent the rest. Only a signed-in walk closes this",
    scope: "origin:console.prisma.io",
    surfaces: ["browser"],
  });
  const session = openPrismaGap({
    at,
    condition: "browser-session-absent",
    fields: [],
    kind: "console-route",
    reason:
      "no walk has run, and only a browser signed in to console.prisma.io can run one. A " +
      "signed-out console is graded signed-out and becomes a card for the owner — a session never types a " +
      "credential. This is the surface that would hold the workspace settings, the members list, the " +
      "service-token page, the billing and usage views and the integrations tab, none of which any " +
      "operation in the management API returns as a PAGE",
    scope: "walk:console.prisma.io",
    surfaces: ["browser"],
  });
  return withGaps({ at, file, observed: [indiscriminate, session] });
}

/**
 * The workspace kind's own gap: the organisation's two records of this vendor disagree.
 *
 * Written as a QUESTION carrying the commands that answer it rather than as a count. A register that
 * lacks a vendor the SaaS-discovery inventory holds as a discovered application is exactly the
 * disagreement this gap names — but a gap asserting it would become a confident lie the day somebody adds
 * the row, on the only axis a reader could check. The reproduction is in the reason, so the
 * answer is one command away and never stale.
 */
function vendorInventoryGapOnto({
  file,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  const gap = openPrismaGap({
    at,
    condition: "vendor-inventory-disagreement",
    fields: [],
    kind: "workspace",
    reason:
      "this platform is a live vendor of the organisation reached through single sign-on, and two internal" +
      " stores disagree about whether it is being tracked as one. Check both, in this order:" +
      " `slopweaver atlas trelica read --kind app --query prisma` shows the SaaS-discovery inventory's row" +
      " for it — discovered through the identity provider, with a user count and a review status; " +
      "`slopweaver atlas vanta read --kind vendor --query prisma` shows whether the managed vendor register" +
      " carries one. A vendor in the first and not the second is in the estate and outside the compliance" +
      " programme. This atlas cannot close the gap — only somebody adding the register row can — and it is" +
      " filed here rather than left to memory because nothing else in this installation would say it",
    scope: "vendor-register:prisma-data-platform",
    surfaces: [],
  });
  return withGaps({ at, file, observed: [gap] });
}

/** Reconcile this run's gaps onto whatever the kind file already held. */
function withGaps({
  file,
  observed,
  at,
}: {
  file: PrismaDataPlatformKindFile;
  observed: readonly PrismaDataPlatformGap[];
  at: string;
}): Result<PrismaDataPlatformKindFile> {
  const rechecks: readonly PrismaGapRecheck[] = observed.map((gap) => ({
    condition: gap.condition,
    resolved: false,
    scope: gap.scope,
  }));
  const reconciled = reconcilePrismaGaps({ at, observed, rechecks, runFailed: false, stored: file.gaps });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({ ...file, gaps: [...reconciled.value] });
}

/**
 * An entity kind's file, saying why it is empty.
 *
 * The state is `not-configured` rather than `excluded`: this atlas fully intends to hold these kinds and
 * `descriptor.ts` says so. `unblockedBy` names the one thing that would change it, so a reader learns the
 * remedy from the atlas rather than from a person.
 */
function unreachableKindFile({
  kind,
  stored,
  at,
}: {
  kind: PrismaDataPlatformAtlasKind;
  stored: PrismaDataPlatformKindFile | null;
  at: string;
}): PrismaDataPlatformKindFile {
  const held = heldPrismaDataPlatformKindFile({ kind, stored, updatedAt: at });
  return {
    ...held,
    coverage: [
      ...held.coverage.filter((cell) => cell.surface !== PRISMA_ENTITY_SURFACE),
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: prismaSurfaceLastSuccess({ coverage: held.coverage, surface: PRISMA_ENTITY_SURFACE }),
        latestAttemptFailed: true,
        reason:
          `nothing has been fetched for "${kind}" because this installation holds no Prisma credential — ` +
          "MEASURED: the secrets store under $SLOPWEAVER_HOME carries no Prisma value and none " +
          "is set in the environment. This is a fact about what this INSTALLATION has been given, never " +
          "about what Prisma holds or about what any account can see",
        role: "authoritative",
        scope: "whole-account",
        state: "not-configured",
        surface: PRISMA_ENTITY_SURFACE,
        unblockedBy: PRISMA_ENTITY_UNBLOCK,
        visibilityScope: "api-credential-type",
      },
    ],
    updatedAt: at,
  };
}

/** Stamp every published kind's status, leaving anything this run did not write exactly as it was. */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: PrismaDataPlatformManifest | null;
  files: Readonly<Partial<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile>>>;
  at: string;
}): PrismaDataPlatformManifest {
  const base = heldPrismaDataPlatformManifest({ manifest, updatedAt: at });
  const kinds = { ...base.kinds };
  PRISMA_DATA_PLATFORM_ATLAS_KINDS.forEach((kind) => {
    const file = files[kind];
    if (file === undefined) {
      return;
    }
    kinds[kind] = {
      digest: null,
      entityCount: file.entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  });
  return { ...base, kinds, updatedAt: at };
}
