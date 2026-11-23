/**
 * Publish the Canva atlas's compiled generation — the one surface that needs no credential and no network
 * at all.
 *
 * ## Why a sync that calls nothing is still a sync
 *
 * `resyncCommand` is a first-class requirement of the descriptor contract: one command that brings the whole
 * atlas current. On this platform the compiled channel is the half that CAN be current today, so it is what
 * this publishes — 59 operations, 18 declared OAuth scopes, and, for every kind, the coverage cells and gaps
 * that say exactly what the other two channels have not done. Every array it writes is sorted, so two runs
 * given the same `at` produce byte-identical files; the timestamp is the only thing that moves between runs,
 * which is what makes a real diff over a regenerated atlas readable.
 *
 * Landing the module with nothing on disk was rejected for Nightfall's reason and it holds harder here: the
 * compiled table is the ONLY thing this installation can hold, so publishing nothing would leave
 * `slopweaver atlas canva read` answering "nothing has been published" on an atlas whose entire deliverable
 * is already computable offline.
 *
 * ## What it does NOT do, and the gate that makes that structural
 *
 * It never reaches the network, so it can never fill a live channel — but the guarantee does not rest on
 * that, because "this function happens not to make a request" is one refactor from being false. `store.ts`'s
 * publish gate refuses any generation whose entities claim `connect-api` or `web-app`, at the file boundary,
 * whoever wrote it.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { stableEntityId } from "../kit/identity.js";
import { canvaPublishedCoverageCell, canvaUnconfiguredCoverageCell } from "./coverage.js";
import { type CanvaAtlasError, CanvaAtlasErrors } from "./errors.js";
import {
  canvaBrowserOnlyCapabilityGap,
  canvaDeclaredUnusedTagGap,
  canvaGrantableUncallableScopeGap,
  canvaNoCredentialGap,
  canvaNoWebAppWalkGap,
  canvaUndeclaredEntitlementGap,
} from "./gaps.js";
import { CANVA_SCOPES, CANVA_SURFACES } from "./generated/surfaces.js";
import {
  byCanvaKind,
  CANVA_ATLAS_KINDS,
  CANVA_ATLAS_PLATFORM,
  CANVA_PAGE_KIND,
  type CanvaAtlasEntity,
  type CanvaAtlasGap,
  type CanvaAtlasKind,
  type CanvaAtlasKindFile,
  type CanvaAtlasManifest,
  type CanvaEntityDetail,
  emptyCanvaChannels,
  emptyCanvaKindFile,
  initialCanvaManifest,
} from "./model.js";
import { canvaAtlasPaths, publishCanvaAtlas, readCanvaManifest } from "./store.js";
import { canvaProviderId } from "./surfaceNaming.js";

/**
 * How many cookies the owner's own Chrome profile holds for `www.canva.com`.
 *
 * MEASURED through the door, and quoted in the web-app gap so the claim "a session already
 * exists" is checkable rather than asserted. Reproduce it:
 *
 * ```bash
 * slopweaver browser cookies --origin https://www.canva.com
 * ```
 *
 * It is deliberately a number rather than the cookie NAMES: the names include this account's own identity
 * cookies, and an atlas that records what a surface can reach has no reason to write down a session's
 * handles. If the count has moved, the gap's evidence is stale rather than wrong — re-measure and update it
 * in the same change as the walk that closes the gap.
 */
const WEB_APP_COOKIE_COUNT = 21;

/**
 * The declared tags no operation carries — the vendor advertising a product area it publishes no way to reach.
 *
 * MEASURED: the description's `tags` array declares 17 entries and its 59 operations carry 16
 * between them. Reproduce the difference against the pinned document:
 *
 * ```bash
 * yarn tsx tools/generateCanvaSurfaces.ts --verify   # asserts the 16 used; the 17th is below
 * ```
 */
const DECLARED_UNUSED_TAGS: readonly string[] = ["brands"];

/**
 * The operations whose prose sends the reader to the browser for something the Connect API cannot do.
 *
 * A judgement over prose rather than a flag, and that is why it is a hand-kept list beside a generated
 * table. `CanvaSurfaceRow.namesTheCanvaUi` is the WIDE census — nine operations mention the Canva UI — and
 * most of them are comparing themselves to it: `deleteAsset` says it "mirrors the behavior in the Canva UI",
 * which is a reassurance rather than a gap. These two say the opposite:
 *
 * - `moveFolderItem` — an item that exists in several folders returns `item_in_multiple_folders` and "you
 *   must use the Canva UI to move the item to another folder".
 * - `createDesignResizeJob` — "In-place resizing is currently not available in the Connect API, but can be
 *   done in the Canva UI", and "Resizing a section of a design is only available in the Canva UI".
 *
 * Filed under the kind each operation belongs to, so the reader who asks about folders meets the folder one.
 */
const BROWSER_ONLY_CAPABILITIES: Readonly<
  Partial<Record<CanvaAtlasKind, { readonly because: string; readonly operations: readonly string[] }>>
> = {
  folder: {
    because:
      'an item that exists in more than one folder returns `item_in_multiple_folders`, and "you must use the Canva UI to move the item to another folder"',
    operations: ["moveFolderItem"],
  },
  resize: {
    because:
      '"In-place resizing is currently not available in the Connect API, but can be done in the Canva UI", and "Resizing a section of a design is only available in the Canva UI"',
    operations: ["createDesignResizeJob"],
  },
};

/**
 * The operations whose `<Availability>` prose declares a requirement their `x-required-capabilities` omits.
 *
 * MEASURED: nine operations carry the prose, seven carry the extension, and these two are the
 * difference. `eligibility.ts` carries why that is a disagreement worth raising rather than a tidy-up, and
 * `gaps.ts` carries the gap that raises it.
 */
const UNDECLARED_ENTITLEMENTS: Readonly<Partial<Record<CanvaAtlasKind, readonly string[]>>> = {
  autofill: ["createDesignAutofillJob", "getDesignAutofillJob"],
};

/** What one publish produced, so a verb can report it without re-reading the store. */
export interface CanvaSyncReport {
  /** How many entities were written, per kind, in kind order. */
  readonly entitiesByKind: readonly { readonly kind: CanvaAtlasKind; readonly entities: number }[];
  /** How many gaps the generation carries. */
  readonly gaps: number;
  /** Every file written, in write order — kind files first, manifest last. */
  readonly written: readonly string[];
}

/**
 * One entity's compiled-channel slot, built once so the two entity builders below cannot drift apart.
 *
 * Every field but `detail` and `endpoint` is the same for every compiled entity — this channel reads a
 * committed table rather than a provider, so there is never a deep link to record and never an artifact
 * backing it. Writing that envelope out at each call site is how two builders in one file end up disagreeing
 * about what `deepLinkStatus` an absent link deserves, and `kit/contract.ts` is explicit that an absent link
 * must SAY why it is absent.
 *
 * @param at this run's ISO timestamp
 * @param detail what the compiled channel knows about this entity
 * @param endpoint the reproduction handle a reader follows back to the vendor's own document
 * @returns the filled channel slot
 */
function publishedChannel({
  at,
  detail,
  endpoint,
}: {
  at: string;
  detail: CanvaEntityDetail;
  endpoint: string;
}): NonNullable<CanvaAtlasEntity["channels"]["published-api"]> {
  return {
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source: {
      artifacts: [],
      channel: "published-api",
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint,
      observedAt: at,
    },
    state: "observed",
  };
}

/**
 * Every operation entity one kind holds — one per published operation the vendor tagged with it.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, in registry order
 */
function operationEntities({ kind, at }: { kind: CanvaAtlasKind; at: string }): readonly CanvaAtlasEntity[] {
  return CANVA_SURFACES.filter((row) => row.kind === kind).map((row) => {
    const providerId = canvaProviderId({ method: row.method, path: row.path });
    return {
      channels: {
        ...emptyCanvaChannels(),
        "published-api": publishedChannel({
          at,
          detail: {
            bodyParams: [...row.bodyParams],
            capabilities: [...row.capabilities],
            deprecated: row.deprecated,
            effect: row.effect,
            effectBecause: row.effectBecause,
            entitlement: row.entitlement,
            entitlementBecause: row.entitlementBecause,
            headerParams: [...row.headerParams],
            method: row.method,
            namesTheCanvaUi: row.namesTheCanvaUi,
            paging: row.paging,
            path: row.path,
            pathParams: [...row.pathParams],
            queryParams: [...row.queryParams],
            rateLimitPerUserPerMinute: row.rateLimitPerUserPerMinute,
            responseFields: [...row.responseFields],
            scopes: [...row.scopes],
            security: [...row.security],
            server: row.server,
            stability: row.stability,
            synopsis: row.synopsis,
          },
          endpoint: providerId,
        }),
      },
      family: "operation",
      id: stableEntityId({ components: { providerId }, namespace: `${CANVA_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
    };
  });
}

/**
 * Every declared OAuth scope one kind governs.
 *
 * A scope is an entity here rather than a field, because two of the eighteen are named by no operation at
 * all — `model.ts` carries why a flattened scope column could not represent that.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, in registry order
 */
function scopeEntities({ kind, at }: { kind: CanvaAtlasKind; at: string }): readonly CanvaAtlasEntity[] {
  return CANVA_SCOPES.filter((scope) => scope.kind === kind).map((scope) => {
    const providerId = `scope:${scope.scope}`;
    return {
      channels: {
        ...emptyCanvaChannels(),
        "published-api": publishedChannel({
          at,
          detail: { namedBy: [...scope.namedBy], scope: scope.scope },
          endpoint: "components.securitySchemes.oauthAuthCode.flows.authorizationCode.scopes",
        }),
      },
      family: "scope",
      id: stableEntityId({ components: { providerId }, namespace: `${CANVA_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
    };
  });
}

/**
 * Every entity the compiled channel contributes to one kind: its operations, then its scopes.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, sorted by provider key so two runs at the same instant write identical bytes
 */
function compiledEntities({ kind, at }: { kind: CanvaAtlasKind; at: string }): readonly CanvaAtlasEntity[] {
  return [...operationEntities({ at, kind }), ...scopeEntities({ at, kind })].toSorted((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}

/**
 * Every gap one kind carries in the compiled generation.
 *
 * The declared-unused-tag gap is filed under `page` rather than spread across every kind, and that placement
 * is a judgement worth stating: `brands` has no kind of its own precisely because no operation carries it,
 * and what would establish whether the area exists at all is the browser walk — which is what the `page`
 * file holds. A reader who wants it finds it beside the other browser leads.
 *
 * @param kind the kind to build gaps for
 * @param at this run's ISO timestamp
 * @returns the gaps, sorted by id so a re-run writes identical bytes
 */
function compiledGaps({ kind, at }: { kind: CanvaAtlasKind; at: string }): readonly CanvaAtlasGap[] {
  const gaps: CanvaAtlasGap[] = [canvaNoCredentialGap({ at, kind })];
  if (kind === CANVA_PAGE_KIND) {
    gaps.push(canvaNoWebAppWalkGap({ at, cookies: WEB_APP_COOKIE_COUNT }));
    gaps.push(canvaDeclaredUnusedTagGap({ at, tags: DECLARED_UNUSED_TAGS }));
  }
  const uncallable = CANVA_SCOPES.filter((scope) => scope.kind === kind && scope.namedBy.length === 0).map(
    (scope) => scope.scope,
  );
  if (uncallable.length > 0) {
    gaps.push(canvaGrantableUncallableScopeGap({ at, kind, scopes: uncallable.toSorted() }));
  }
  const undeclared = UNDECLARED_ENTITLEMENTS[kind];
  if (undeclared !== undefined) {
    gaps.push(canvaUndeclaredEntitlementGap({ at, kind, operations: undeclared }));
  }
  const browserOnly = BROWSER_ONLY_CAPABILITIES[kind];
  if (browserOnly !== undefined) {
    gaps.push(
      canvaBrowserOnlyCapabilityGap({ at, because: browserOnly.because, kind, operations: browserOnly.operations }),
    );
  }
  return gaps.toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Build the whole compiled generation in memory.
 *
 * Separated from the write so the shape is testable without a filesystem — every judgement in this module is
 * pure, and the only I/O is the publish itself.
 *
 * @param at this run's ISO timestamp
 * @returns every kind file and the manifest, or why the registry cannot be trusted
 */
export function buildCanvaGeneration({ at }: { at: string }): Result<
  {
    readonly files: Record<CanvaAtlasKind, CanvaAtlasKindFile>;
    readonly manifest: CanvaAtlasManifest;
  },
  CanvaAtlasError
> {
  const declared = new Set<string>(CANVA_ATLAS_KINDS);
  const strayOperations = [...new Set(CANVA_SURFACES.map((row) => row.kind))].filter((kind) => !declared.has(kind));
  const strayScopes = [...new Set(CANVA_SCOPES.map((scope) => scope.kind))].filter((kind) => !declared.has(kind));
  const stray = [...new Set([...strayOperations, ...strayScopes])];
  if (stray.length > 0) {
    return err(
      CanvaAtlasErrors.registryInvalid({
        detail: `the registry names kind(s) the model does not declare: ${stray.toSorted().join(", ")}`,
      }),
    );
  }
  const files = byCanvaKind({
    build: ({ kind }) => ({
      ...emptyCanvaKindFile({ kind, updatedAt: at }),
      coverage: [
        canvaPublishedCoverageCell({
          at,
          kind,
          operations: CANVA_SURFACES.filter((row) => row.kind === kind).length,
          scopes: CANVA_SCOPES.filter((scope) => scope.kind === kind).length,
        }),
        canvaUnconfiguredCoverageCell({ at, channel: "connect-api", previous: null }),
        canvaUnconfiguredCoverageCell({ at, channel: "web-app", previous: null }),
      ],
      entities: [...compiledEntities({ at, kind })],
      gaps: [...compiledGaps({ at, kind })],
    }),
  });
  return ok({
    files,
    manifest: {
      ...initialCanvaManifest({ updatedAt: at }),
      kinds: byCanvaKind({
        build: ({ kind }) => ({
          digest: null,
          entityCount: files[kind].entities.length,
          lastAttempt: null,
          lastSuccessAt: at,
        }),
      }),
    },
  });
}

/**
 * Build and publish the compiled generation.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` to publish into
 * @param at this run's ISO timestamp
 * @returns what was written, or why publication was refused
 */
export function syncCanvaAtlas({ home, at }: { home: string; at: string }): Result<CanvaSyncReport, CanvaAtlasError> {
  const generation = buildCanvaGeneration({ at });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const { files, manifest } = generation.value;
  const paths = canvaAtlasPaths({ home });
  // A compiled generation is derived from the registry rather than from the store, so this read is the ONLY
  // thing that establishes what it is replacing. Without it the publish would have to assert `null`, which
  // the compare-and-swap reads as "the store held nothing" and refuses the moment anything has been
  // published — and asserting the live manifest without reading it would be the lost update itself.
  const derivedFrom = readCanvaManifest({ paths });
  if (derivedFrom.isErr()) {
    return err(CanvaAtlasErrors.storeUnreadable({ reasons: derivedFrom.error }));
  }
  const written = publishCanvaAtlas({ derivedFrom: derivedFrom.value, files, manifest, paths });
  if (written.isErr()) {
    return err(CanvaAtlasErrors.storeUnwritable({ reasons: written.error }));
  }
  return ok({
    entitiesByKind: CANVA_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    gaps: CANVA_ATLAS_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0),
    written: written.value,
  });
}
