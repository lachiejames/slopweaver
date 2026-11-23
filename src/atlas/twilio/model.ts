/**
 * The Twilio atlas's on-disk vocabulary — the generation that holds every surface, and the schemas that
 * refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, and the test is not close
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas holds is per-platform, and the test
 * is whether something better suited already holds that platform's entities. For Slack and Notion the
 * answer is yes — the corpus does — so those atlases map the interface alone. For Twilio the answer is no,
 * and not marginally: nothing in this installation holds a phone number, a messaging service, a subaccount
 * or a delivery status. So the entity kinds are declared here rather than marked `held-elsewhere`, and each
 * says for itself how far it has got.
 *
 * ## The voluminous families are a DISPOSITION, not an exclusion
 *
 * The same ruling's one bound, and the ask named the family by hand: message and call logs are enumerated
 * and declared rather than stored whole. They are still REACHED — their operations are mapped like every
 * other, their parameters and response field names recorded — and they simply never publish a row per
 * record. `disposition.ts` carries the criterion and applies it per OPERATION, because it cuts through a
 * product area rather than along it.
 *
 * **What that costs, stated plainly, because it is the one thing a reader of this atlas must not
 * misunderstand.** The ask wants delivery ground truth for customer comms — did the message land, when, and
 * why not. This atlas answers WHERE that lives and WHAT can be asked: the `Message` resource's `status`,
 * `error_code` and `date_sent`, the operations that filter them by date, and the credential each needs. It
 * does not answer whether one particular message landed, and never will: that is a row in the voluminous
 * family, and reading one is a live call, not an atlas read.
 *
 * ## Three surfaces, two channels
 *
 * `spec-declared` compiles Twilio's own published API definitions, pinned by digest — that is the authority
 * on what the API can be ASKED. `account-api` is the live read that would fill the entity kinds and has no
 * credential. Both are the `api` channel, because both are the same acquisition path seen at two moments.
 * `console` is the `browser` channel: the app walked in the owner's own Chrome, authoritative for the
 * navigation surface and never more than `discovery` for the operations it observes — seeing the
 * first-party client call something establishes that it EXISTS, and nothing about what a token may ask for.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";
import { type AtlasCoverageState, type AtlasEvidenceRole, atlasArtifactRefSchema } from "../kit/contract.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const TWILIO_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published definitions, an account's live reads and the
 * console are three SURFACES of this one atlas.
 */
export const TWILIO_ATLAS_PLATFORM = "twilio";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * Five rather than three, because this atlas holds entities as well as a surface map. `api` and `method`
 * are the surface map and are filled from the pinned definitions; `page` is the browser half; `account` and
 * `resource` are the account's own configuration. Declaring the last three before anything fills them is
 * the point rather than an oversight — a kind nothing declares is a kind no generation can publish a
 * non-`synced` state for, so it reads as a kind that does not exist.
 *
 * ONE `resource` kind rather than one per product, and that is Twilio's own model rather than a
 * simplification: every configured thing in a Twilio account is addressed by a 34-character SID whose
 * two-letter prefix IS its type — `PN` a phone number, `MG` a messaging service, `VA` a Verify service,
 * `WS` a TaskRouter workspace, `FW` a Studio flow. A kind per product would invent a taxonomy Twilio does
 * not have; the prefix is one it does.
 */
export const TWILIO_ATLAS_KINDS = ["account", "api", "method", "page", "resource"] as const;

export type TwilioAtlasKind = (typeof TWILIO_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const TWILIO_ATLAS_CHANNELS = ["api", "browser"] as const;

export type TwilioAtlasChannel = (typeof TWILIO_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type TwilioEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type TwilioCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 *
 * The `api` channel's ceiling is Twilio's own PUBLIC definitions repository, which needs no credential and
 * therefore describes the product rather than this account. The `browser` channel's ceiling is whatever the
 * signed-in person's role opens on this account, which is narrower and account-specific. One
 * `visibilityScope` for the atlas would be false about one channel whichever value it took.
 *
 * @internal
 */
export const TWILIO_VISIBILITY_SCOPES = ["api-published-definitions", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type TwilioVisibilityScope = (typeof TWILIO_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function twilioVisibilityScopeFor({ channel }: { channel: TwilioAtlasChannel }): TwilioVisibilityScope {
  return channel === "api" ? "api-published-definitions" : "browser-signed-in-role";
}

/**
 * The permanent claim boundary, stated once for the descriptor.
 *
 * Written in the credentials' own terms rather than as a reassurance: the definition half needs none at all
 * and so can never be account-specific, and the entity half needs an Account SID and a credential this
 * installation does not hold.
 */
export const TWILIO_VISIBILITY_SCOPE =
  "the definition surface is Twilio's own PUBLIC `twilio-oai` repository and needs no credential, so it " +
  "describes the product rather than this account and can never be narrowed by a role; the entity surface " +
  "needs an Account SID plus an API key this installation does not hold, and the console surface sees " +
  "exactly what the signed-in role opens. 'Complete' here is always complete for the channel named on the " +
  "cell";

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const twilioArtifactRefSchema = atlasArtifactRefSchema;

export type TwilioArtifactRef = z.infer<typeof twilioArtifactRefSchema>;

/**
 * The stored vocabulary this atlas shares with every other two-channel one — entity, coverage cell, gap,
 * kind file and manifest — specialised to Twilio's own channels, kinds, platform and visibility scopes.
 *
 * `kit/channelSchemas.ts` owns the SHAPE and says why each of its three load-bearing decisions is the
 * two-surface ruling written down. What stays in this file is what is genuinely Twilio's: the DETAIL
 * schemas below, which are the platform.
 *
 * @internal
 */
const shared = channelSchemas({
  // Spelled out rather than assembled from the tuple: the factory only sees a runtime list, so building
  // these there would need a type assertion to recover the exact keys. Six lines here buys an exact type,
  // and every slot stays REQUIRED — a record would make each optional, and an entity that omitted a
  // channel would then validate and read back as one whose channel had never looked.
  channelSlots: ({ channelEntity }) =>
    z.object({
      api: channelEntity.nullable(),
      browser: channelEntity.nullable(),
    }),
  manifestKinds: ({ kindStatus }) =>
    z.object({
      account: kindStatus,
      api: kindStatus,
      method: kindStatus,
      page: kindStatus,
      resource: kindStatus,
    }),
  channels: TWILIO_ATLAS_CHANNELS,
  kinds: TWILIO_ATLAS_KINDS,
  platform: TWILIO_ATLAS_PLATFORM,
  schemaVersion: TWILIO_ATLAS_SCHEMA_VERSION,
  visibilityScopes: TWILIO_VISIBILITY_SCOPES,
});

/**
 * Where a record came from, through one channel.
 * @internal
 */
export const twilioSourceSchema = shared.source;

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type TwilioSource = z.infer<typeof twilioSourceSchema>;

/**
 * What the definition surface knows about one published API document.
 *
 * `hosts` is the field a reader will want most and the one nobody would think to store: Twilio answers
 * from a different subdomain per product, so "which API is this" and "where do I send the request" are two
 * questions and only the second has a URL in it.
 */
const twilioApiDetailSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    /** Every origin this document's operations answer on, sorted. */
    hosts: z.array(z.string().min(1)),
    operationCount: z.number().int().nonnegative(),
    pathCount: z.number().int().nonnegative(),
    /** The product from Twilio's own file stem — `messaging`, `taskrouter`, `api`. */
    product: z.string().min(1),
    /** Every security scheme its operations require, sorted — which credential reaches this API. */
    securitySchemes: z.array(z.string().min(1)),
    sha256: z.string().length(64),
    /** `info.title` as Twilio writes it. */
    title: z.string().min(1),
    /** The API version from the stem — `v1`, `v2010`. Several are live at once. */
    version: z.string().min(1),
  })
  .strict();

export type TwilioApiDetail = z.infer<typeof twilioApiDetailSchema>;

/**
 * What the definition surface knows about one operation: everything the pinned documents state about that
 * method and path, reduced to names.
 *
 * `specs` is every published document declaring it, which is the fact a caller most needs and the one a
 * single-version atlas destroys: Twilio serves `/v1/Services` and `/v2/Services` on the same host at the
 * same time, and an atlas that mapped only the newest would answer that the first does not exist.
 */
const twilioMethodApiDetailSchema = z
  .object({
    /** Why this operation is never called, or `null` when it is observational. */
    excludedBecause: z.string().min(1).nullable(),
    /** Whether an observation of this operation publishes a row per record, or only its shape. */
    disposition: z.enum(["entity", "shape-index"]),
    /**
     * The origin it answers on — the half of "where does this live" that a path cannot carry — or `null`
     * when Twilio's own definition declares no server for it.
     */
    host: z.string().min(1).nullable(),
    /** Twilio's own `x-twilio.mountName` for the resource, when it declares one. */
    mountName: z.string().min(1).nullable(),
    /** Whether this atlas may call it at all. A refused operation still gets a row — the inventory is what
     * makes an exclusion a stated decision rather than a silence. */
    observational: z.boolean(),
    /** Every declared parameter name, from `parameters` and the request body alike, sorted. */
    parameters: z.array(z.string().min(1)),
    /** Twilio's own `x-twilio.parent` — the resource this one hangs off, when it declares one. */
    parent: z.string().min(1).nullable(),
    /** Twilio's own `x-twilio.pathType` — `list` or `instance`, when it declares one. */
    pathType: z.string().min(1).nullable(),
    /** The product from the declaring document's stem — the greppable taxonomy. `null` when unclaimed. */
    product: z.string().min(1).nullable(),
    /** Response field PATHS to two levels, `[]` marking an array, sorted. Names only, never a value. */
    responseFields: z.array(z.string().min(1)),
    /** The security scheme names it requires, sorted — which credential reaches it. */
    securitySchemes: z.array(z.string().min(1)),
    /** Every published document declaring it, by Twilio's own file stem, sorted. */
    specs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type TwilioMethodApiDetail = z.infer<typeof twilioMethodApiDetailSchema>;

/**
 * What the browser surface saw one operation do: how often the first-party client called it, and the
 * response field NAMES it got back.
 *
 * `seenOnPages` is which declared pages caused the call, which is what turns a list of undocumented
 * operations into something a reader can act on — an operation is a lead, and the page it fires on is where
 * that lead can be reproduced.
 *
 * @internal
 */
export const twilioMethodBrowserDetailSchema = z
  .object({
    /** How many times the walk saw this operation called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** The origin the call went to, so a console-only host is visible as one. */
    host: z.string().min(1),
    /**
     * Every query parameter NAME the console sent, telemetry dropped, sorted.
     *
     * Here because the definition channel records parameters and a channel that did not would make the two
     * incomparable on half of what an operation accepts. A NAME says what an endpoint takes; a session
     * token or a cache-buster says what this session was, and `webReduction.ts`'s telemetry pattern is what
     * keeps the second out.
     */
    parameters: z.array(z.string().min(1)),
    /** Every response field name observed at the body's top level, sorted. */
    responseFields: z.array(z.string().min(1)),
    /** Which declared page surfaces caused this call, sorted. */
    seenOnPages: z.array(z.string().min(1)),
    /** The last HTTP status observed for it. */
    statusCode: z.number().int(),
  })
  .strict();

/**
 * What the browser channel knows about one operation the first-party client called.
 *
 * @internal
 */
export type TwilioMethodBrowserDetail = z.infer<typeof twilioMethodBrowserDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and how
 * much of its own traffic the walk actually accounted for.
 *
 * The screenshot is not here — it is a {@link TwilioSource} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one. `unreachableBecause` is what makes
 * a declared page that redirects a recorded row rather than a silent absence.
 *
 * @internal
 */
export const twilioPageDetailSchema = shared.pageDetail;

/**
 * What the browser channel knows about one declared page it visited.
 *
 * @internal
 */
export type TwilioPageDetail = z.infer<typeof twilioPageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const twilioChannelEntitySchema = shared.channelEntity;

export type TwilioChannelEntity = z.infer<typeof twilioChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const twilioAtlasEntitySchema = shared.entity;

export type TwilioAtlasEntity = z.infer<typeof twilioAtlasEntitySchema>;

/** One coverage cell: what is known about one surface through one channel. */
const twilioCoverageCellSchema = shared.coverageCell;

export type TwilioCoverageCell = z.infer<typeof twilioCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const twilioAtlasGapSchema = shared.gap;

export type TwilioAtlasGap = z.infer<typeof twilioAtlasGapSchema>;

/** One kind's file on disk. */
export const twilioAtlasKindFileSchema = shared.kindFile;

export type TwilioAtlasKindFile = z.infer<typeof twilioAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const twilioAtlasKindStatusSchema = shared.kindStatus;

/** @internal */
export type TwilioAtlasKindStatus = z.infer<typeof twilioAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const twilioAtlasManifestSchema = shared.manifest;

export type TwilioAtlasManifest = z.infer<typeof twilioAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialTwilioManifest({ updatedAt }: { updatedAt: string }): TwilioAtlasManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyTwilioKindFile({
  kind,
  updatedAt,
}: {
  kind: TwilioAtlasKind;
  updatedAt: string;
}): TwilioAtlasKindFile {
  return shared.emptyKindFile({ kind, updatedAt });
}
