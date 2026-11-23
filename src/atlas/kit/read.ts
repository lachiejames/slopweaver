/**
 * The normalized view every atlas is READ through; the pure selection over it is `selectEntities.ts`.
 *
 * ## Why a normalized view rather than each platform's own shape
 *
 * `docs/atlas-intent/settled-decisions.md` records the requirement in the owner's words — _"Turning it into verbs so it's easy for
 * the AI to call"_ — and a verb that answers "what does this atlas hold" cannot switch on Cloudflare kinds,
 * Vanta channels and Slack methods and still be one verb. So each platform contributes an ADAPTER that
 * projects its own strict store into the shapes below, and the CLI never learns a platform's vocabulary.
 * Adding an atlas is one adapter plus one registry row.
 *
 * The view is deliberately the INTERSECTION of what the existing stores can answer, not a superset anybody
 * has to grow into. Cloudflare's entity carries one `source`; Vanta's carries two nullable channels; both
 * project to a list of {@link AtlasObservationView}, and a platform with one channel simply returns one. A
 * field no platform can fill would be a field that lies on two of the three.
 *
 * ## Reading never repairs
 *
 * Every function here is pure and total over what the store handed back. A generation that is half-written,
 * mismatched or stale is REPORTED through {@link AtlasGenerationView} rather than silently smoothed over —
 * the kit's store already distinguishes those states, and discarding them at the read boundary would make
 * the one verb that is supposed to be honest about coverage the one place the honesty is lost.
 */
import type { AtlasArtifactRef, AtlasCoverageState, AtlasDescriptor } from "./contract.js";
import type { AtlasPageDetailTable } from "./pageTable.js";
import type { AtlasPermissionBlock } from "./permissionBlock.js";
import type { AtlasProductAbsence } from "./productAbsence.js";

/** How a platform's own store answered for one kind, once projected. */
export interface AtlasObservationView {
  /** Which declared {@link AtlasDescriptor} surface produced this — `rest-api`, `manage-api`, `dashboard`. */
  readonly surface: string;
  /** The endpoint, method or page path this came from — the reproduction handle. */
  readonly endpoint: string;
  readonly observedAt: string;
  readonly state: "observed" | "stale";
  /** The URL a human opens to see this, when one is genuinely known. Never constructed from ids. */
  readonly deepLink: string | null;
  /** Why an absent link is absent, so "the provider offers none" is distinguishable from "nobody looked". */
  readonly deepLinkStatus: string;
  /**
   * The bytes this surface kept as proof — a screenshot, an extracted page, a downloaded payload.
   *
   * REQUIRED and empty-when-none rather than optional, so an adapter that forgets it fails to compile.
   * The owner's ruling is that a stored screenshot is part of what an atlas holds, since full page
   * screenshots are stored locally, and a view that dropped them made "was this page actually
   * photographed" unanswerable from the one seam every generic reader goes through.
   */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/** One entity, as every atlas presents it. */
export interface AtlasEntityView {
  readonly id: string;
  readonly kind: string;
  readonly providerId: string;
  /** The platform's own scope, rendered as one string — an account, a zone, a parent. */
  readonly scope: string;
  /** One per surface that has actually observed this entity; never empty. */
  readonly observations: readonly AtlasObservationView[];
  /** The provider's own JSON, whatever shape that platform stores. */
  readonly detail: unknown;
}

/** One coverage cell, as every atlas presents it. */
export interface AtlasCoverageCellView {
  readonly surface: string;
  readonly scope: string;
  readonly state: AtlasCoverageState;
  readonly reason: string;
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
  readonly unblockedBy: string | null;
}

/** One open or closed question about what this atlas could not see. */
export interface AtlasGapView {
  readonly id: string;
  readonly condition: string;
  readonly scope: string;
  readonly reason: string;
  readonly status: "open" | "closed";
  readonly lastDetectedAt: string;
}

/** Everything one kind holds. */
export interface AtlasKindView {
  readonly kind: string;
  readonly entities: readonly AtlasEntityView[];
  readonly coverage: readonly AtlasCoverageCellView[];
  readonly gaps: readonly AtlasGapView[];
  /** What the manifest vouches for, which a half-write makes disagree with `entities.length`. */
  readonly publishedCount: number;
  /**
   * The manifest's own permission boundary for this kind, carried through so a READER never has to guess.
   *
   * `null` on every kind an atlas has not classified a refusal for, which is the fail-closed reading: an
   * empty kind with no block is dark for a reason the atlas could not name, and that is a different report
   * from one the owner's credential is simply fenced out of. See `kit/permissionBlock.ts` for the ruling.
   */
  readonly permissionBlocked: AtlasPermissionBlock | null;
  /**
   * The provider's own answer that this organisation has no such product — see `kit/productAbsence.ts`.
   *
   * OPTIONAL, unlike `permissionBlocked` above: only an atlas whose sync classifies that answer ever sets it,
   * and every other adapter omitting it reads as "no absence declared", which is the fail-closed reading.
   */
  readonly productAbsent?: AtlasProductAbsence | null | undefined;
  readonly lastSuccessAt: string | null;
  readonly latestAttemptFailed: boolean;
}

/**
 * What the store said about the generation itself, carried rather than smoothed over.
 *
 * `missing`, `superseded`, `mismatched` and `unpublished` are the kit store's own four ways a generation
 * can disagree with its manifest. A read that dropped them would report an atlas as smaller than it is, with no way for
 * a reader to tell that from an atlas that genuinely holds less.
 */
export interface AtlasGenerationView {
  readonly platform: string;
  readonly schemaVersion: number;
  readonly updatedAt: string | null;
  /** The manifest vouches for it and the file is gone — corruption, not emptiness. */
  readonly missing: readonly string[];
  /** The records are on disk under the previous format's name — a format change, not a loss. */
  readonly superseded: readonly string[];
  /** The file is not the one the manifest published. */
  readonly mismatched: readonly string[];
  /** A file the manifest does not vouch for. */
  readonly unpublished: readonly string[];
}

/** One platform's whole atlas, normalized. */
export interface AtlasReadSnapshot {
  readonly descriptor: AtlasDescriptor;
  readonly generation: AtlasGenerationView;
  readonly kinds: readonly AtlasKindView[];
  /** A platform's own worded tables for its page (`pageTable.ts`); absent for an atlas that draws none. */
  readonly pageDetailTables?: readonly AtlasPageDetailTable[];
}

/**
 * One channel's stored record, in the shape every two-channel atlas here already writes.
 *
 * Structural rather than imported from a platform, so the kit depends on no atlas: Vanta and Slack each
 * declare their own strict schema and both satisfy this. A platform whose channel record grows a field the
 * view needs would widen THIS, not fork a second projection.
 * @internal
 */
export interface AtlasChannelRecord {
  readonly detail: unknown;
  readonly lastSeenAt: string;
  readonly state: "observed" | "stale";
  readonly source: {
    readonly artifacts?: readonly AtlasArtifactRef[];
    readonly deepLink?: string | null;
    readonly deepLinkStatus?: string;
    readonly endpoint?: string;
    readonly observedAt?: string;
  } | null;
}

/**
 * Project a two-channel entity's channels into observations, in declared channel order.
 *
 * Shared by every multi-channel adapter because the two judgements in it are the ones that must not differ
 * between platforms. A channel that has never looked (`null`) contributes NOTHING rather than an
 * observation claiming it looked and found nothing — that distinction is the whole two-surface design. And
 * a channel whose `source` is null still yields an observation, because the channel DID see the entity and
 * only its provenance detail is missing; dropping it would understate coverage, which is the one direction
 * a read must never err in.
 *
 * @param channels the entity's channel slots
 * @param order the platform's declared channel order, which decides observation order
 * @returns one observation per channel that has actually looked
 */
export function channelObservations({
  channels,
  order,
}: {
  channels: Readonly<Record<string, AtlasChannelRecord | null | undefined>>;
  order: readonly string[];
}): readonly AtlasObservationView[] {
  return order.flatMap((channel): readonly AtlasObservationView[] => {
    const observed = channels[channel];
    if (observed === null || observed === undefined) {
      return [];
    }
    // A null source, or a field it does not record, is provenance the channel never wrote: the observation stands,
    // read as unverified, at the channel's own endpoint, when the channel last saw it.
    const {
      artifacts = [],
      deepLink = null,
      deepLinkStatus = "unverified",
      endpoint = channel,
    } = { ...observed.source };
    const { observedAt = observed.lastSeenAt } = { ...observed.source };
    return [{ artifacts, deepLink, deepLinkStatus, endpoint, observedAt, state: observed.state, surface: channel }];
  });
}

/**
 * The detail a reader gets for an entity observed through more than one channel.
 *
 * The first channel holding one wins, in declared order. That is a DISPLAY choice and not a precedence
 * ruling: both channel records stay on disk untouched, and which surface wins a genuine disagreement is
 * explicitly the owner's call, reserved until the owner can see real instances (`docs/atlas-intent/04-corroboration.md`).
 *
 * @param channels the entity's channel slots
 * @param order the platform's declared channel order
 * @returns the first non-null channel detail, or `null` when no channel holds one
 */
export function firstChannelDetail({
  channels,
  order,
}: {
  channels: Readonly<Record<string, AtlasChannelRecord | null | undefined>>;
  order: readonly string[];
}): unknown {
  for (const channel of order) {
    const detail = channels[channel]?.detail;
    if (detail !== undefined && detail !== null) {
      return detail;
    }
  }
  return null;
}

/**
 * Project one platform's stored coverage cells, stamping a surface for an atlas whose cells carry one and
 * passing through the cell's own when it has it.
 *
 * @param cells the stored cells
 * @param surface the surface to stamp when a cell carries none of its own
 * @returns the normalized cells
 */
export function coverageCellViews({
  cells,
  surface,
}: {
  cells: readonly {
    readonly lastSuccessAt: string | null;
    readonly latestAttemptFailed: boolean;
    readonly reason: string;
    readonly scope: string;
    readonly state: AtlasCoverageState;
    readonly surface?: string;
    readonly unblockedBy: string | null;
  }[];
  surface: string;
}): readonly AtlasCoverageCellView[] {
  return cells.map(({ surface: own = surface, ...cell }) => ({
    lastSuccessAt: cell.lastSuccessAt,
    latestAttemptFailed: cell.latestAttemptFailed,
    reason: cell.reason,
    scope: cell.scope,
    state: cell.state,
    surface: own,
    unblockedBy: cell.unblockedBy,
  }));
}

/**
 * Project one platform's stored gaps.
 *
 * @param gaps the stored gaps
 * @returns the normalized gaps
 */
export function gapViews({
  gaps,
}: {
  gaps: readonly {
    readonly condition: string;
    readonly id: string;
    readonly lastDetectedAt: string;
    readonly reason: string;
    readonly scope: string;
    readonly status: "open" | "closed";
  }[];
}): readonly AtlasGapView[] {
  return gaps.map((gap) => ({
    condition: gap.condition,
    id: gap.id,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
  }));
}

/** Why an atlas could not be read. Each variant is something a caller does differently about. */
export interface AtlasPlatformUnknownError {
  readonly code: "ATLAS_PLATFORM_UNKNOWN";
  readonly message: string;
  readonly platform: string;
  readonly known: readonly string[];
}

/** No platform was named at all — a different failure from naming one that does not exist. */
export interface AtlasPlatformMissingError {
  readonly code: "ATLAS_PLATFORM_MISSING";
  readonly message: string;
  readonly known: readonly string[];
}

/** A kind was asked for that this platform does not declare. */
export interface AtlasKindUnknownError {
  readonly code: "ATLAS_KIND_UNKNOWN";
  readonly message: string;
  readonly platform: string;
  readonly kind: string;
  readonly known: readonly string[];
}

/** The store itself refused — absent, unreadable, or published under a schema version this build cannot read. */
export interface AtlasStoreUnreadableError {
  readonly code: "ATLAS_STORE_UNREADABLE";
  readonly message: string;
  readonly platform: string;
  readonly reasons: readonly string[];
}

/** Nothing has ever been published, so the atlas holds nothing rather than the platform holding nothing. */
export interface AtlasGenerationUnpublishedError {
  readonly code: "ATLAS_GENERATION_UNPUBLISHED";
  readonly message: string;
  readonly platform: string;
}

/**
 * A generation is published and the reader cannot see what it vouches for.
 *
 * The one state an atlas used to report by answering zero entities, which is the sentence a reader
 * mistakes for "this organisation holds none" — see `kit/answerable.ts` for the measurement.
 */
export interface AtlasGenerationDarkError {
  readonly code: "ATLAS_GENERATION_DARK";
  readonly message: string;
  readonly platform: string;
  /** The kinds the manifest vouches for and the store cannot produce, sorted. */
  readonly darkKinds: readonly string[];
  /**
   * The subset of {@link AtlasGenerationDarkError.darkKinds} whose records are on disk under the
   * pre-`.jsonl` name. Carried as a field and not only inside the message so a caller can act on the
   * difference — this is the one dark state where nothing has to be fetched again.
   */
  readonly supersededKinds: readonly string[];
  readonly vouchedFor: number;
  readonly readable: number;
}

export type AtlasReadError =
  | AtlasPlatformUnknownError
  | AtlasPlatformMissingError
  | AtlasKindUnknownError
  | AtlasStoreUnreadableError
  | AtlasGenerationUnpublishedError
  | AtlasGenerationDarkError;

/**
 * The half of a dark refusal that says what to DO about it.
 *
 * Split out because the two cases have nothing in common but their tense. A kind on disk under the
 * pre-`.jsonl` name needs nothing fetched — the bytes are correct and only their layout is old — so the
 * refusal says so and names the repair, rather than sending the reader to a second verb to find out which
 * of the two states they are in. That delegation is the whole cost of the incident this guards against: atlases
 * reported as gone while every record sat beside the name the reader was looking under, and a session spent
 * its day looking for corruption that was never there.
 *
 * @param supersededKinds the dark kinds whose records are on disk in the previous format
 * @returns the remedy sentence, tailored when a format change explains it
 */
function supersededRemedy({ supersededKinds }: { supersededKinds: readonly string[] }): string {
  if (supersededKinds.length === 0) {
    return "run `slopweaver atlas doctor` to see the whole estate";
  }
  return (
    `${supersededKinds.length} of them are on disk RIGHT NOW under the pre-\`.jsonl\` name this build no` +
    ` longer reads (${supersededKinds.join(", ")}), so nothing has been lost and nothing needs fetching` +
    " again — run `slopweaver atlas doctor --repair` to rewrite them in the current format, archiving what" +
    " it replaces"
  );
}

/** Construct one {@link AtlasReadError}. Tests build fixtures through these, never a hand-built literal. */
export const AtlasReadErrors = {
  generationDark: ({
    platform,
    darkKinds,
    supersededKinds,
    vouchedFor,
    readable,
  }: {
    platform: string;
    darkKinds: readonly string[];
    /** Those of `darkKinds` whose records are on disk in the pre-`.jsonl` format; empty for every other way of being dark. */
    supersededKinds: readonly string[];
    vouchedFor: number;
    readable: number;
  }): AtlasGenerationDarkError => ({
    code: "ATLAS_GENERATION_DARK",
    darkKinds: [...darkKinds],
    message:
      `the ${platform} atlas has a published generation it cannot read back: its manifest vouches for` +
      ` ${vouchedFor} entities and the store produced ${readable}, with ${darkKinds.length} kind(s) the` +
      ` reader cannot see (${darkKinds.join(", ")}). Answering with what is left would understate the` +
      ` atlas as silently as answering zero would, which is why this refuses instead — ` +
      supersededRemedy({ supersededKinds }),
    platform,
    readable,
    supersededKinds: [...supersededKinds],
    vouchedFor,
  }),
  generationUnpublished: ({
    platform,
    // A platform naming no remedy of its own is pointed at the verbs every atlas has.
    remedy = `publish one with the ${platform} atlas's own sync or walk verb`,
  }: {
    platform: string;
    /** This platform's own way back — its sync verb, its walk, or whatever it is actually blocked on. */
    remedy?: string;
  }): AtlasGenerationUnpublishedError => ({
    code: "ATLAS_GENERATION_UNPUBLISHED",
    message:
      `no ${platform} generation has been published, so this atlas holds nothing. Answering with zero` +
      " entities would be indistinguishable from an organisation that holds none, which is why this" +
      ` refuses instead — ${remedy}`,
    platform,
  }),
  kindUnknown: ({
    platform,
    kind,
    known,
  }: {
    platform: string;
    kind: string;
    known: readonly string[];
  }): AtlasKindUnknownError => ({
    code: "ATLAS_KIND_UNKNOWN",
    kind,
    known: [...known],
    message: `${platform} has no kind ${kind} — it declares: ${known.join(", ")}`,
    platform,
  }),
  platformMissing: ({ known }: { known: readonly string[] }): AtlasPlatformMissingError => ({
    code: "ATLAS_PLATFORM_MISSING",
    known: [...known],
    message: `name an atlas: slopweaver atlas <platform> — this build has ${known.join(", ")}`,
  }),
  platformUnknown: ({
    platform,
    known,
  }: {
    platform: string;
    known: readonly string[];
  }): AtlasPlatformUnknownError => ({
    code: "ATLAS_PLATFORM_UNKNOWN",
    known: [...known],
    message: `no atlas for platform ${platform} — this build has: ${known.join(", ")}`,
    platform,
  }),
  storeUnreadable: ({
    platform,
    reasons,
  }: {
    platform: string;
    reasons: readonly string[];
  }): AtlasStoreUnreadableError => ({
    code: "ATLAS_STORE_UNREADABLE",
    message: `the ${platform} atlas could not be read: ${reasons.join("; ")}`,
    platform,
    reasons: [...reasons],
  }),
} as const;

/**
 * The normalized view of an entity a SINGLE surface observed, which is most of them.
 *
 * An atlas whose kinds are each produced by exactly one surface — every entity carrying its own
 * `source.surface`, `source.endpoint` and `source.deepLink` — has no view-shaping decision left to make, and
 * two atlases had written this literal identically. A multi-surface atlas that folds several observations
 * onto one entity still builds its own view; this is the common case, not a replacement for that.
 *
 * The `surface` reported is the ENTITY's own, never one this builder chose, so a reader filtering by surface
 * gets the surface that actually produced the record.
 *
 * @param entity the stored entity, carrying its own provenance and state
 * @param kind the kind whose file it came from
 * @param scope the platform's own scope string — an account, a tenant, a zone
 * @returns its normalized view, with exactly one observation
 */
export function singleObservationView({
  entity,
  kind,
  scope,
}: {
  entity: {
    readonly id: string;
    readonly providerId: string;
    readonly state: "observed" | "stale";
    readonly source: {
      readonly artifacts?: readonly AtlasArtifactRef[];
      readonly deepLink: string | null;
      readonly deepLinkStatus: AtlasObservationView["deepLinkStatus"];
      readonly endpoint: string;
      readonly observedAt: string;
      readonly surface: string;
    };
  };
  kind: string;
  scope: string;
}): AtlasEntityView {
  // An entity that recorded no artifacts was observed with none.
  const { artifacts = [] } = entity.source;
  return {
    detail: entity,
    id: entity.id,
    kind,
    observations: [
      {
        artifacts,
        deepLink: entity.source.deepLink,
        deepLinkStatus: entity.source.deepLinkStatus,
        endpoint: entity.source.endpoint,
        observedAt: entity.source.observedAt,
        state: entity.state,
        surface: entity.source.surface,
      },
    ],
    providerId: entity.providerId,
    scope,
  };
}
