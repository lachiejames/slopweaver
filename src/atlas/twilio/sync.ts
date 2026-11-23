/**
 * Publish the definition surface: every operation Twilio's own published definitions declare, onto the
 * `api` and `method` kinds' `api` channel — and the honest `not-configured` cells for the two entity kinds
 * no credential can fill yet.
 *
 * ## Two things a run reports about itself, and neither stops it
 *
 * A document that could not be FETCHED is a transport blip among sixty, and the right answer is the other
 * fifty-nine plus a named gap: one failure must not sink the batch, and a sync that refused everything on
 * one timeout would leave an install with no atlas rather than with a slightly incomplete one. The coverage
 * cell carries the fraction — all sixty compiled is `synced`, any short of that is `deferred` with the
 * count in its reason — so a reader never has to infer completeness from an entity total.
 *
 * A document served under a pinned TAG whose bytes are not the reviewed ones is compiled and recorded as a
 * `spec-moved` gap. `errors.ts` carries the reasoning; the short version is that refusing on a digest would
 * make the atlas unbuildable the day Twilio retargets a tag, and the movement is the more interesting
 * output either way.
 *
 * ## What a synced cell here does and does NOT claim
 *
 * It says Twilio's published definitions were read in full. It says nothing about what this account holds,
 * which products it is entitled to, or whether any credential exists to call one of these operations — the
 * repository is public and describes the product. `model.ts`'s `api-published-definitions` visibility scope
 * is that ceiling, and the `account` and `resource` cells are where this atlas admits it has not yet
 * reached the entities it is supposed to hold.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { publishCompiledGeneration } from "../kit/compiledPublish.js";
import { compilePinnedCatalogue, type CompiledCatalogue as KitCompiledCatalogue } from "../kit/pinnedSpec.js";
import { succeededTwilioCoverageCell } from "./coverage.js";
import { describeTwilioDrift, type TwilioSpecError } from "./errors.js";
import { openTwilioGap } from "./gaps.js";
import { TWILIO_SPEC_PINS } from "./generated/specLock.js";
import { mergeTwilioChannel } from "./merge.js";
import {
  emptyTwilioKindFile,
  initialTwilioManifest,
  type TwilioAtlasEntity,
  type TwilioAtlasGap,
  type TwilioAtlasKind,
  type TwilioAtlasKindFile,
  type TwilioAtlasKindStatus,
  type TwilioAtlasManifest,
} from "./model.js";
import { foldTwilioOperations, projectTwilioApis, projectTwilioMethods } from "./projection.js";
import { type TwilioSpecTransport, verifyAndCompile } from "./specFetch.js";
import type { TwilioSpecPin } from "./specPin.js";
import type { TwilioSpecSurface } from "./specSurface.js";
import {
  publishTwilioAtlas,
  readTwilioAtlas,
  type TwilioAtlasPaths,
  type TwilioAtlasSnapshot,
  withTwilioPublishLock,
} from "./store.js";

/**
 * The surface name the definition channel's coverage is reported under.
 *
 * @internal
 */
export const TWILIO_SPEC_SURFACE = "spec-declared";

/**
 * The surface name the live entity reads would be reported under.
 *
 * @internal
 */
export const TWILIO_ACCOUNT_API_SURFACE = "account-api";

/**
 * The surface name the console walk's coverage is reported under.
 *
 * @internal
 */
export const TWILIO_CONSOLE_SURFACE = "console";

/**
 * What a caller must do to fill the browser surface, when a walk finds the session gone.
 *
 * Names a SIGN-IN rather than a credential, because that is what a lost session costs and typing
 * credentials is something a session may never do. It is no longer the standing state — MEASURED, the
 * owner signed in and the same walk landed and photographed its pages — so this string is the remedy for a session that has since expired rather than a description of today.
 *
 * @internal
 */
export const TWILIO_BROWSER_UNBLOCKED_BY =
  "sign in to console.twilio.com once in your own Chrome, then run `slopweaver atlas twilio walk`, which " +
  "drives the declared routes in that same browser through the shared Playwright extension transport";

/**
 * What a caller must do to fill the entity surface. Named in every `not-configured` cell rather than left
 * as "configure a credential", because a cell that cannot say WHAT would unblock it is a complaint.
 *
 * ## It names a WRITE, and that is why this surface stays unfilled with the console reachable
 *
 * The console is signed in, so the old reason — this surface is blocked behind the
 * browser one — has expired, and the true blocker has to be stated rather than inherited. Minting an API
 * key is the only route to a Twilio credential here and minting one is a WRITE: it creates a durable
 * credential in the account. Twilio is not in `WRITE_POLICY_REGISTER` (`src/admit/browserSurface.ts`), and SETTLED that means it is
 * `refuse-every-write` — so the browser-door guard now refuses that mint rather than allowing it for want
 * of a policy. Every action this atlas takes in that console is a read, enforced rather than intended, and
 * naming the click here is a remedy for whoever has the standing to take it — never an instruction this
 * atlas may follow for itself.
 *
 * @internal
 */
export const TWILIO_ENTITY_UNBLOCKED_BY =
  "the owner minting a read-capable API key in the console personally (Account → API keys & tokens → Create " +
  "API key, Standard), then `slopweaver secrets set twilio-account-sid` and `slopweaver secrets set " +
  "twilio-api-key-secret`. That first step is a WRITE in the account, and under the owner's " +
  "ruling Twilio is unregistered and therefore " +
  "`refuse-every-write`, so the guard refuses it: this surface is unfilled permanently under the current " +
  "ruling rather than pending one, and the console being signed in does not unblock it";

/**
 * What compiling the definition surface did.
 *
 * @internal
 */
export interface TwilioSyncOutcome {
  readonly apiCount: number;
  readonly hostCount: number;
  readonly methodCount: number;
  readonly operationCount: number;
  /** Operations whose records are declared as a shape rather than stored one row each. */
  readonly shapeIndexedCount: number;
  readonly specsCompiled: number;
  readonly specsDeclared: number;
  /** Documents served under a pinned tag whose bytes are not the reviewed ones. */
  readonly specsDrifted: readonly string[];
  readonly specsFailed: readonly string[];
  readonly written: readonly string[];
}

/** Every compiled definition, plus whatever could not be compiled and whatever has since moved. */
type CompiledCatalogue = KitCompiledCatalogue<TwilioSpecSurface, TwilioSpecError>;

/**
 * Fetch and compile every pinned definition. Nothing here stops the batch.
 *
 * @param pins the reviewed lock
 * @param transport how one document's bytes are obtained; a test supplies a deterministic fake
 * @returns every surface compiled, every document that could not be, and every one that has moved
 */
export async function compileTwilioCatalogue({
  pins,
  transport,
}: {
  pins: readonly TwilioSpecPin[];
  transport: TwilioSpecTransport;
}): Promise<CompiledCatalogue> {
  return compilePinnedCatalogue({
    compile: ({ pin, text }) => verifyAndCompile({ pin, text }),
    countOperations: ({ surface }) => surface.operations.length,
    pins,
    transport,
  });
}

/**
 * Compile the published definitions and publish them onto the `api` and `method` kinds' `api` channel.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param transport how one document's bytes are obtained; a test supplies a deterministic fake
 * @returns what was published, or every reason it could not be
 */
export async function syncTwilioSpecSurface({
  paths,
  at,
  transport,
}: {
  paths: TwilioAtlasPaths;
  at: string;
  transport: TwilioSpecTransport;
}): Promise<Result<TwilioSyncOutcome>> {
  const compiled = await compileTwilioCatalogue({ pins: TWILIO_SPEC_PINS, transport });
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withTwilioPublishLock`.
  return withTwilioPublishLock({
    nowIso: at,
    paths,
    publish: () => publishCompiledSurface({ at, catalogue: compiled, paths }),
  });
}

/** The two compiled kind files, or the first reason one of them could not be built. */
function compiledFiles({
  snapshot,
  catalogue,
  at,
}: {
  snapshot: TwilioAtlasSnapshot;
  catalogue: CompiledCatalogue;
  at: string;
}): Result<{ api: TwilioAtlasKindFile; method: TwilioAtlasKindFile }> {
  const reachedIds = new Set(catalogue.surfaces.map((surface) => surface.specId));
  const apiFile = mergedKindFile({
    at,
    catalogue,
    entities: projectTwilioApis({ at, pins: TWILIO_SPEC_PINS.filter((pin) => reachedIds.has(pin.id)) }),
    kind: "api",
    snapshotFiles: snapshot.files,
  });
  if (apiFile.isErr()) {
    return err(apiFile.error);
  }
  const methodFile = mergedKindFile({
    at,
    catalogue,
    entities: projectTwilioMethods({
      at,
      folded: foldTwilioOperations({ pins: TWILIO_SPEC_PINS, surfaces: catalogue.surfaces }),
    }),
    kind: "method",
    snapshotFiles: snapshot.files,
  });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  return ok({ api: apiFile.value, method: methodFile.value });
}

/** How many of a file's method rows are declared as a shape rather than stored one row each. */
function shapeIndexedCount({ file }: { file: TwilioAtlasKindFile }): number {
  return file.entities.filter((entity) => {
    const detail = entity.channels.api?.detail;
    return (
      typeof detail === "object" &&
      detail !== null &&
      (detail as { disposition?: unknown }).disposition === "shape-index"
    );
  }).length;
}

/** The critical section: read the generation, merge the API channel onto it, and publish. */
function publishCompiledSurface({
  paths,
  at,
  catalogue,
}: {
  paths: TwilioAtlasPaths;
  at: string;
  catalogue: CompiledCatalogue;
}): Result<TwilioSyncOutcome> {
  const snapshot = readTwilioAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const published = publishCompiledGeneration({
    compile: ({ snapshot: held }) => compiledFiles({ at, catalogue, snapshot: held }),
    filesFor: ({ compiled, snapshot: held }) => syncedFiles({ at, compiled, stored: held.files }),
    manifestFor: ({ compiled, snapshot: held }) =>
      syncManifest({
        apiCount: compiled.api.entities.length,
        at,
        manifest: held.manifest,
        methodCount: compiled.method.entities.length,
      }),
    publish: ({ files, manifest }) =>
      publishTwilioAtlas({ derivedFrom: snapshot.value.manifest, files, manifest, paths }),
    snapshot: snapshot.value,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const compiled = published.value.compiled;
  return ok({
    apiCount: compiled.api.entities.length,
    hostCount: new Set(catalogue.surfaces.flatMap((surface) => surface.hosts)).size,
    methodCount: compiled.method.entities.length,
    operationCount: catalogue.operationCount,
    shapeIndexedCount: shapeIndexedCount({ file: compiled.method }),
    specsCompiled: catalogue.surfaces.length,
    specsDeclared: TWILIO_SPEC_PINS.length,
    specsDrifted: catalogue.drifts.map((drift) => drift.specId).toSorted(),
    specsFailed: catalogue.failures.map((failure) => failure.specId).toSorted(),
    written: published.value.written,
  });
}

/**
 * Every kind file this sync publishes: the two it compiled, and the three it can only say something about.
 *
 * @param compiled the two kinds this run built from the definitions
 * @param stored every kind as the store already holds it
 * @param at this run's ISO timestamp
 * @returns the files to publish, keyed by kind
 */
function syncedFiles({
  compiled,
  stored,
  at,
}: {
  compiled: { api: TwilioAtlasKindFile; method: TwilioAtlasKindFile };
  stored: Readonly<Record<TwilioAtlasKind, TwilioAtlasKindFile | null>>;
  at: string;
}): Readonly<Partial<Record<TwilioAtlasKind, TwilioAtlasKindFile>>> {
  return {
    account: entitySurfaceFile({ at, kind: "account", scope: "accounts-and-subaccounts", stored: stored.account }),
    api: compiled.api,
    method: compiled.method,
    page: browserSurfaceFile({ at, stored: stored.page }),
    resource: entitySurfaceFile({
      at,
      kind: "resource",
      scope: "configured-account-resources",
      stored: stored.resource,
    }),
  };
}

/**
 * One gap per document this run could not read, and one per document that has moved under its pinned tag.
 *
 * Both are per-KIND, because a reader filtering `atlas twilio coverage --kind method` should see the reason
 * the method rows are what they are without having to know that another kind carries it.
 *
 * @param catalogue what the compile pass came back with
 * @param kind the kind these gaps are recorded against
 * @param at this run's ISO timestamp
 * @returns the gaps this run observed, in failure-then-drift order
 */
function catalogueGaps({
  catalogue,
  kind,
  at,
}: {
  catalogue: CompiledCatalogue;
  kind: TwilioAtlasKind;
  at: string;
}): readonly TwilioAtlasGap[] {
  return [
    ...catalogue.failures.map((failure) =>
      openTwilioGap({
        at,
        condition: "spec-unreadable",
        fields: [],
        kind,
        reason: `${failure.message}. Re-run \`slopweaver atlas twilio sync\`; a document that stays unreadable is a Twilio-side change worth regenerating the lock for`,
        scope: failure.specId,
        surfaces: ["api"],
      }),
    ),
    ...catalogue.drifts.map((drift) =>
      openTwilioGap({
        at,
        condition: "spec-moved",
        fields: [],
        kind,
        reason: describeTwilioDrift({ drift }),
        scope: drift.specId,
        surfaces: ["api"],
      }),
    ),
  ];
}

/** The coverage reason and state one compile earned, stated as a fraction rather than as a total. */
function compileCell({ catalogue }: { catalogue: CompiledCatalogue }): {
  reason: string;
  state: "synced" | "deferred";
} {
  const declared = TWILIO_SPEC_PINS.length;
  const compiled = catalogue.surfaces.length;
  if (compiled === declared) {
    return {
      reason:
        `${String(compiled)} of ${String(declared)} pinned definitions compiled, declaring ` +
        `${String(catalogue.operationCount)} operations across ` +
        `${String(new Set(catalogue.surfaces.flatMap((surface) => surface.hosts)).size)} origins`,
      state: "synced",
    };
  }
  return {
    reason:
      `${String(compiled)} of ${String(declared)} pinned definitions compiled — ` +
      `${String(catalogue.failures.length)} could not be read, and each carries its own gap. The operations ` +
      "those documents declare are absent from this generation rather than absent from Twilio",
    state: "deferred",
  };
}

/** One compiled kind's file: this run's entities merged onto the stored ones, with its own cell replaced. */
function mergedKindFile({
  snapshotFiles,
  kind,
  entities,
  catalogue,
  at,
}: {
  snapshotFiles: Readonly<Record<TwilioAtlasKind, TwilioAtlasKindFile | null>>;
  kind: TwilioAtlasKind;
  entities: readonly TwilioAtlasEntity[];
  catalogue: CompiledCatalogue;
  at: string;
}): Result<TwilioAtlasKindFile> {
  const stored = snapshotFiles[kind] ?? emptyTwilioKindFile({ kind, updatedAt: at });
  const merged = mergeTwilioChannel({ at, channel: "api", observed: entities, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const cell = compileCell({ catalogue });
  return ok({
    ...stored,
    coverage: [
      ...stored.coverage.filter((held) => held.surface !== TWILIO_SPEC_SURFACE),
      succeededTwilioCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason: cell.reason,
        role: "authoritative",
        scope: "published-definitions",
        state: cell.state,
        surface: TWILIO_SPEC_SURFACE,
      }),
    ],
    entities: [...merged.value],
    gaps: [
      ...stored.gaps.filter((held) => held.condition !== "spec-unreadable" && held.condition !== "spec-moved"),
      ...catalogueGaps({ at, catalogue, kind }),
    ],
    updatedAt: at,
  });
}

/**
 * The file for an entity kind nothing has filled: a `not-configured` cell naming exactly what would fill it.
 *
 * The alternative was to leave these kinds absent, and it is the wrong one for the reason `kit/contract.ts`
 * gives about `declared-unfilled`: a kind with no file reads as a kind that does not exist, where a
 * `not-configured` cell is the atlas saying, about itself, that it is supposed to hold this and does not.
 * The entities are deliberately left exactly as stored, because a credential appearing later must not have
 * to re-discover what an earlier one saw.
 */
function entitySurfaceFile({
  stored,
  kind,
  scope,
  at,
}: {
  stored: TwilioAtlasKindFile | null;
  kind: TwilioAtlasKind;
  scope: string;
  at: string;
}): TwilioAtlasKindFile {
  const base = stored ?? emptyTwilioKindFile({ kind, updatedAt: at });
  return {
    ...base,
    coverage: [
      ...base.coverage.filter((held) => held.surface !== TWILIO_ACCOUNT_API_SURFACE),
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: base.coverage.find((held) => held.surface === TWILIO_ACCOUNT_API_SURFACE)?.lastSuccessAt ?? null,
        latestAttemptFailed: false,
        reason:
          "no Twilio credential exists in this installation, so nothing has been read from the account " +
          "itself. This is the kind this atlas is supposed to hold — nothing else here holds a phone " +
          "number, a messaging service or a subaccount — so the absence is a stated gap rather than a " +
          "scoping decision",
        role: "authoritative",
        scope,
        state: "not-configured",
        surface: TWILIO_ACCOUNT_API_SURFACE,
        unblockedBy: TWILIO_ENTITY_UNBLOCKED_BY,
        visibilityScope: "api-published-definitions",
      },
    ],
    gaps: [
      ...base.gaps.filter((held) => held.condition !== "entity-surface-not-configured"),
      openTwilioGap({
        at,
        condition: "entity-surface-not-configured",
        fields: [],
        kind,
        reason: `this atlas holds no ${scope} because no credential reaches the account. ${TWILIO_ENTITY_UNBLOCKED_BY}`,
        scope,
        surfaces: ["api"],
      }),
    ],
    updatedAt: at,
  };
}

/**
 * The `page` kind's file when no walk has run: a `deferred` cell saying so, and nothing else touched.
 *
 * A kind with no cell at all is the silence this whole vocabulary exists to refuse — a reader cannot tell
 * "the walk has not run" from "the walk ran and found nothing". A real walk REPLACES this cell with what it
 * actually reached, so this is the state before the first one rather than a claim about the surface.
 *
 * @param stored the page kind as the store already holds it
 * @param at this run's ISO timestamp
 * @returns the page kind file with the walk's cell present when it has never been filled
 */
function browserSurfaceFile({ stored, at }: { stored: TwilioAtlasKindFile | null; at: string }): TwilioAtlasKindFile {
  const base = stored ?? emptyTwilioKindFile({ kind: "page", updatedAt: at });
  const held = base.coverage.find((cell) => cell.surface === TWILIO_CONSOLE_SURFACE);
  if (held !== undefined) {
    return base;
  }
  return {
    ...base,
    coverage: [
      ...base.coverage,
      {
        artifacts: [],
        channel: "browser",
        lastSuccessAt: null,
        latestAttemptFailed: false,
        reason:
          "no console page has been visited or witnessed. The routes in `browserPages.ts` are DECLARED, " +
          "which is what a walk will be judged against — a declared page never reached is a gap this atlas " +
          "can name, where a page a crawler never noticed is not",
        role: "authoritative",
        scope: "declared-console-pages",
        state: "deferred",
        surface: TWILIO_CONSOLE_SURFACE,
        unblockedBy: TWILIO_BROWSER_UNBLOCKED_BY,
        visibilityScope: "browser-signed-in-role",
      },
    ],
    updatedAt: at,
  };
}

/**
 * The manifest status for a kind this run wrote a coverage cell for and no entities.
 *
 * A prior success is carried forward rather than erased — a credential appearing and then being revoked
 * must not make an earlier successful read disappear, only stop being current.
 *
 * @param previous the status the manifest already held — every kind is a required manifest key, and a fresh
 *   manifest holds each one as never synced
 * @param why what would fill this kind, recorded on the attempt so a reader of the manifest alone sees it
 * @param at this run's ISO timestamp
 * @returns the stamped status
 */
function unfilledKindStatus({
  previous,
  why,
  at,
}: {
  previous: TwilioAtlasKindStatus;
  why: string;
  at: string;
}): TwilioAtlasKindStatus {
  return {
    digest: null,
    entityCount: previous.entityCount,
    lastAttempt: { at, outcome: "ok", reasons: [why] },
    lastSuccessAt: previous.lastSuccessAt,
  };
}

/**
 * Stamp every kind this run wrote, so none of them reads as a file the manifest does not vouch for.
 *
 * The two compiled kinds record a success. The three a credential or a walk would fill record an ATTEMPT
 * with no success, which with `store.ts`'s `gradeNeverSucceeded` is the manifest and the file agreeing on
 * "not yet synced" — where leaving them unstamped reported them as `unpublished`, i.e. corruption, on the
 * very first clean sync.
 */
function syncManifest({
  manifest,
  apiCount,
  methodCount,
  at,
}: {
  manifest: TwilioAtlasManifest | null;
  apiCount: number;
  methodCount: number;
  at: string;
}): TwilioAtlasManifest {
  const base = manifest ?? initialTwilioManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      account: unfilledKindStatus({ at, previous: base.kinds.account, why: TWILIO_ENTITY_UNBLOCKED_BY }),
      api: {
        digest: null,
        entityCount: apiCount,
        lastAttempt: { at, outcome: "ok", reasons: [] },
        lastSuccessAt: at,
      },
      method: {
        digest: null,
        entityCount: methodCount,
        lastAttempt: { at, outcome: "ok", reasons: [] },
        lastSuccessAt: at,
      },
      page: unfilledKindStatus({ at, previous: base.kinds.page, why: TWILIO_BROWSER_UNBLOCKED_BY }),
      resource: unfilledKindStatus({ at, previous: base.kinds.resource, why: TWILIO_ENTITY_UNBLOCKED_BY }),
    },
    updatedAt: at,
  };
}
