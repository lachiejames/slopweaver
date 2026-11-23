/**
 * What every atlas declares about itself, whatever platform it maps.
 *
 * The definition this file encodes is the owner's, consolidated in `docs/atlas-intent.md` from the owner's own
 * recordings. Five of its properties are load-bearing enough that getting them wrong produces something
 * that looks like an atlas and is not one, so each is a type here rather than a convention:
 *
 * ## One PLATFORM per atlas, and surfaces within it
 *
 * An atlas is "the set of all possible places you can find information" in one SaaS app. The API and the
 * browser are two SURFACES of one atlas, never two atlases — a platform appearing twice in the catalogue is
 * the failure this shape exists to prevent. How a surface is acquired is an internal property
 * ({@link AtlasSurface.acquisition}) and the catalogue never keys on it.
 *
 * ## A declared-but-unfilled surface is a STATE, not an omission
 *
 * An API-only atlas is not a smaller atlas; measured once already, it "gave stupid answers" about things
 * plainly visible in the browser. So {@link AtlasSurface.status} makes "we have not looked at the browser
 * yet" a thing the atlas SAYS ABOUT ITSELF, rather than a silence a reader has to notice. Declaring a
 * surface and leaving it `declared-unfilled` is honest; not declaring it is not.
 *
 * ## Provenance carries the LINK, and the link's provenance
 *
 * Every record says where it came from and, where one exists, the exact URL a human opens to see it —
 * because proof here is a screenshot. {@link AtlasSource.deepLinkStatus} distinguishes a link the provider
 * handed back from one discovered by driving the browser, and that distinction is the point: measured on
 * a Vanta generation, every record that carried a link carried a `provider-provided` one and
 * none `browser-discovered`, with the rest never attempted. A field that cannot tell those apart cannot
 * show that the browser surface has never run.
 *
 * ## Nothing here may refuse an undocumented endpoint
 *
 * Owner's ruling: prefer a documented endpoint as the entry point, but where an undocumented one works
 * better in practice, USE it — an atlas that self-imposes restrictions is not omniscient, which was the
 * whole point. {@link AtlasSurface.documented} therefore records a FACT for a reader to weigh, and is
 * deliberately not consulted by any gate in this kit.
 */
import { z } from "zod";

/**
 * How far this atlas has got with one surface, at one scope.
 *
 * Kit-owned and CLOSED, deliberately. Both existing atlases had independently arrived at the first seven
 * members in exactly this order, and coverage is the property the whole design rests on — an atlas must be
 * "honest about how much it thinks it knows and where it thinks it's got gaps". A provider free to add a
 * state of its own is a provider free to make a coverage fraction stop meaning one thing across the hundred
 * atlases this is built for. A genuinely new state is a pull request against this line, which is what
 * `held-elsewhere` was.
 *
 * ## Why `held-elsewhere` is not `excluded`
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas HOLDS is per-platform, and where
 * something better suited already holds a platform's entities, the atlas holds the surface map alone. Slack
 * is that case — the corpus holds its channels, people, usergroups and messages.
 *
 * Without a state for it, such a kind can only be reported as `excluded`, and the two make DIFFERENT claims:
 * `excluded` says "we chose not to reach this", which invites a reader to treat the data as unavailable,
 * while `held-elsewhere` says "this is fully held, by a named store that is not this atlas". Reporting the
 * second as the first is how a completely covered platform reads as empty — the exact dishonesty this
 * vocabulary exists to prevent, arrived at from the opposite direction to the usual one.
 *
 * A cell in this state MUST name its holder in {@link AtlasCoverageCell.reason} — the verb or path that
 * answers the question instead. A state that cannot say WHERE is an unfalsifiable claim, and the atlas would
 * be asserting completeness it has no way to evidence.
 *
 * This atlas is deliberately NOT the source of record for such a kind, so a sync must not exit 0 on the
 * strength of one and a reader must not cite the atlas for a fact the other store owns. What refuses
 * is `kit/mandatoryKinds.ts`, at publish time rather than at exit.
 */
export const ATLAS_COVERAGE_STATES = [
  "synced",
  "held-elsewhere",
  "deferred",
  "not-configured",
  "invalid-configuration",
  "unreadable",
  "unavailable",
  "excluded",
] as const;

export type AtlasCoverageState = (typeof ATLAS_COVERAGE_STATES)[number];

/**
 * Whether one channel still SEES an entity, or last saw it in an earlier generation.
 *
 * A two-member vocabulary, and the one `kit/merge.ts` assigns: a complete read that no longer returns a
 * previously-observed entity marks it `stale` rather than dropping it, so an entity that disappeared stays
 * a fact the atlas can state. It was written out as a bare `"observed" | "stale"` union in five files
 * before `src/store/schema/atlas.ts` needed a sixth copy to generate its `pgEnum` from. A vocabulary a
 * DATABASE enum is built from cannot stay a union spelled once per file: widening it would be a migration
 * whose source nobody could find.
 *
 * Four of the five were converted. `kit/read.ts` still spells the union inline, and deliberately: it sits
 * exactly on its recorded size floor, so the one import line this alias costs would fail the
 * `file-size-ratchet` gate, and splitting a 662-line reader to buy one line is the forced split that gate
 * exists to prevent. The compiler still holds the two together at every assignment between them.
 *
 * It is NOT {@link ATLAS_COVERAGE_STATES}. That grades a SCOPE's readability; this grades one entity's
 * presence, and the two have never shared a member.
 */
export const ATLAS_ENTITY_STATES = ["observed", "stale"] as const;

export type AtlasEntityState = (typeof ATLAS_ENTITY_STATES)[number];

/**
 * The write policies an atlas may declare, mirroring `BrowserWritePolicy` in `src/admit/browserSurface.ts`.
 *
 * Spelled here rather than imported so this kit keeps no dependency on the admit layer; the two are held
 * together by `unit/admit/writePolicyRegister.test.ts`, which fails if either list moves without the other.
 */
export const ATLAS_WRITE_POLICIES = ["refuse-every-write", "read-before-write"] as const;
// No exported alias for the member type: `AtlasDescriptor["writePolicy"]` already is it, and a second name
// for one union is the drift this file exists to prevent.

/**
 * What a surface's evidence is worth for one thing.
 *
 * - `authoritative` — this surface is the source of record for the fact.
 * - `corroborating` — it independently agrees, and may never satisfy an authoritative obligation alone.
 * - `discovery` — it can reveal that something exists without establishing anything about its contents.
 */
export const ATLAS_EVIDENCE_ROLES = ["authoritative", "corroborating", "discovery"] as const;

export type AtlasEvidenceRole = (typeof ATLAS_EVIDENCE_ROLES)[number];

/**
 * How a surface's contents are obtained.
 *
 * There is deliberately no `capture` member. A hand-saved HAR file or an exported archive would make
 * population a manual step the owner performs, and the requirement is the opposite: an agent takes control
 * of both the API and the browser and populates the atlas with minimal human effort. A capture may still
 * inform a build, but it is not a way an atlas STAYS current, and admitting it here would let a surface
 * claim `filled` on the strength of a file somebody made once.
 */
const ATLAS_ACQUISITIONS = ["api", "driven-browser", "compiled"] as const;

/** Whether a declared surface has actually been populated. See this file's header. */
const ATLAS_SURFACE_STATUSES = ["filled", "declared-unfilled", "not-applicable"] as const;

/** How a deep link was come by. `browser-discovered` is the state only a driven browser can write. */
const ATLAS_DEEP_LINK_STATUSES = ["provider-provided", "browser-discovered", "unverified", "unavailable"] as const;

/** What kind of bytes an artifact holds. `page-png` is a proof screenshot — see {@link atlasArtifactRefSchema}. */
const ATLAS_ARTIFACT_KINDS = ["page-png", "page-json", "page-text", "api-json", "binary"] as const;

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact: a screenshot, an extracted page, or a downloaded payload, addressed by
 * digest so the bytes can be proven to be the ones that were seen.
 *
 * Screenshots are held rather than merely linked, by ruling: an atlas that already holds the underlying
 * data has no additional disclosure problem in holding a picture of it, and a proof that depends on a URL
 * still resolving is not a proof. `relativePath` is relative to the atlas's own directory.
 */
export const atlasArtifactRefSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    kind: z.enum(ATLAS_ARTIFACT_KINDS),
    mediaType: z.string().min(1),
    relativePath: z.string().min(1),
    sha256: z.string().length(64),
  })
  .strict();

export type AtlasArtifactRef = z.infer<typeof atlasArtifactRefSchema>;

/**
 * Where a record came from, when it was seen, and what proves it to a human.
 *
 * `deepLink` is nullable but `deepLinkStatus` is not: an absent link must say WHY it is absent, so
 * "the provider offers none" is distinguishable from "nobody has looked".
 */
export const atlasSourceSchema = z
  .object({
    artifacts: z.array(atlasArtifactRefSchema),
    deepLink: z.url().nullable(),
    deepLinkStatus: z.enum(ATLAS_DEEP_LINK_STATUSES),
    /** The endpoint, method or page path this came from — the reproduction handle. */
    endpoint: z.string().min(1),
    observedAt: isoSchema,
    /** Which {@link AtlasSurface.name} produced this. */
    surface: z.string().min(1),
  })
  .strict();

type AtlasSource = z.infer<typeof atlasSourceSchema>;

/**
 * What a surface's coverage is DIVIDED BY — the count of things that exist, independently of what this
 * atlas thought to look for.
 *
 * The owner's ruling is the reason this is a required field rather than a nicety: an atlas hits all the GET
 * endpoints that exist and is honest about which API endpoints exist but were never hit, and which browser
 * URLs exist but were never hit. A coverage fraction whose denominator is the implementation's own list of
 * what it calls can only ever read 100%.
 *
 * MEASURED without a denominator: the Vanta atlas reported both its surfaces `filled` while calling **24 of
 * the 107 GET operations Vanta's own published document declares.** One of the eighty-three it had never been
 * to was `GET /knowledge-base/resources`, which serves every policy document this organisation holds. With no
 * denominator, an endpoint nobody guessed is an absence rather than a gap, and absences appear in no
 * coverage report. Calling that one endpoint moved the count to 25 of the 107 reached and left 82 uncalled.
 * These figures are a measurement of that moment, not the live count: `atlas/vanta/descriptor.ts` carries
 * what the atlas reaches today.
 *
 * `known: false` is a legitimate and expected answer — most providers publish no catalogue, and pretending
 * a crawler can prove an unknown negative would be worse than saying so. What it is not is free: the
 * `atlas-content-coverage` gate ratchets the number of `known: false` surfaces DOWNWARD and refuses a new
 * atlas that lands with one, so today's debt is numbered and can only shrink.
 */
const atlasDenominatorSchema = z.discriminatedUnion("known", [
  z
    .object({
      known: z.literal(true),
      /**
       * How many things the provider's own catalogue says exist on this surface.
       *
       * Zero is legitimate and is not the same claim as `known: false`. A published document that declares
       * no READ operation at all — Vanta's webhook description, whose 24 topics are outbound POSTs — has a
       * denominator of exactly zero, and saying so is a measurement. Saying `known: false` about it would
       * claim nobody has counted, which is false.
       */
      exists: z.number().int().nonnegative(),
      /**
       * How many of them this atlas has actually CALLED or VISITED.
       *
       * Reach, never disposition. A Codex review pass caught the Vanta row counting 42 where 25 had been
       * called, by adding the detail endpoints a walked collection already covers and the two an
       * entitlement refuses — both defensible dispositions, and neither one a call. A denominator that
       * forgives an unreached endpoint because there is a good reason for it is the self-flattering
       * arithmetic this field exists to end; the reason belongs on the endpoint's own row.
       */
      reached: z.number().int().nonnegative(),
      /** The provider artifact this is derived from — a pinned specification, a route manifest, a schema. */
      source: z.string().min(1),
    })
    .strict()
    .refine((value) => value.reached <= value.exists, {
      error: "a surface cannot have reached more than exists — check which of the two numbers is wrong",
    }),
  z
    .object({
      known: z.literal(false),
      /** Why no independent catalogue of this surface exists yet, in words a reader can act on. */
      because: z.string().min(1),
    })
    .strict(),
]);

/** A surface's denominator, known or not.
 * @internal
 */
export type AtlasDenominator = z.infer<typeof atlasDenominatorSchema>;

/**
 * One surface of one platform: a place information can be found, and how much of it has been.
 *
 * `documented` records whether the provider publishes this surface. It is a fact for a reader to weigh and
 * is consulted by nothing in this kit — see this file's header on why an undocumented endpoint that works
 * better is one the atlas should use.
 */
const atlasSurfaceSchema = z
  .object({
    acquisition: z.enum(ATLAS_ACQUISITIONS),
    /** What this surface's coverage is divided by. See {@link atlasDenominatorSchema}. */
    denominator: atlasDenominatorSchema,
    documented: z.boolean(),
    name: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    status: z.enum(ATLAS_SURFACE_STATUSES),
    /** What would fill a `declared-unfilled` surface, when that is known. */
    unfilledBecause: z.string().min(1).nullable(),
  })
  .strict();

type AtlasSurface = z.infer<typeof atlasSurfaceSchema>;

/**
 * The `web-client` surface a driven-browser walk fills with the first-party operations it observes.
 *
 * Always `discovery` and never more: seeing the first-party client call something establishes that it
 * EXISTS, and nothing about what an ordinary credential may ask for. One declaration, because every atlas
 * that walks a web client says exactly this and the copies had begun to drift apart only in whitespace.
 */
export const WEB_CLIENT_DISCOVERY_SURFACE: AtlasSurface = {
  acquisition: "driven-browser",
  denominator: {
    because: "the operations this walk observes are undocumented, so nothing declares how many exist",
    known: false,
  },
  documented: false,
  name: "web-client",
  role: "discovery",
  status: "filled",
  unfilledBecause: null,
};

/**
 * On what ground an atlas does not hold something.
 *
 * **Owner standing rule:** an atlas missing coverage is unacceptable, and the ONLY convincing reason to
 * exclude a KIND is that pulling it is highly voluminous, for example a terabyte on this machine.
 * Everything else is an unacceptable exclusion.
 *
 * That rule is only enforceable once "exclusion" stops being one word for ten different acts. MEASURED
 * across all 36 descriptors: **226** free-prose entries stood in `excludes`, and most of them withheld no
 * record at all — they were bounds on what the atlas DOES, or on what a stored record CARRIES, filed beside
 * the few that really do drop a family. Re-derive the classification at any time with
 * `slopweaver atlas <platform> coverage --json | jq '.excludes'`.
 *
 * **Only three of these grounds withhold a record, and the rest are the reason the rule looked unenforceable
 * before it was split.** `shape-index` is the one the rule admits and it must carry a measurement;
 * `disclosure-bound` and `payload-not-map` withhold records on rulings the owner made, so each names the
 * ruling. Everything else leaves every record where it was.
 *
 * **Both of those two SURVIVE.** They are listed for the owner rather than quietly accepted, and the owner
 * kept both grounds, which together cover twelve rows. So neither is a candidate for the gate and neither is debt: they are settled decisions,
 * and `slopweaver atlas backlog` never lists one.
 *
 * **A weighed `shape-index` family eventually lands in the owner's local store.** That is a destination, not
 * a licence to stop measuring — a family still has to be weighed before anybody can say what landing it
 * costs, and the owner's sequencing for the store
 * (`docs/store.md`: tooling, then a thousand Slack records, then a little of every source, then the
 * gigabytes) has not reached the fourth step. A measured row is what makes that step decidable; an unweighed
 * one is what the gate refuses.
 *
 * - `shape-index` — the voluminous disposition of `docs/atlas-intent/06-holdings.md`. The family IS reached and its
 *   shape recorded; what is never stored is a row per record. Carries a {@link AtlasVolumeBasis}.
 * - `disclosure-bound` — the family is reached and deliberately not stored because a row would be somebody's
 *   pay, review, health record or recorded session. Names the ruling that settled it, because on this ground
 *   alone the reason is a decision rather than a property of the data.
 * - `payload-not-map` — the platform's own content rather than a record about it: an image layer, a
 *   rendered file, a query result set, a screen recording. An atlas that stored these would be a second copy
 *   of the product, which is what one-atlas-per-platform exists to prevent. The operation is mapped in full.
 * - `held-elsewhere` — a named store holds it and the atlas holds the surface map (the owner's ruling,
 *   §6). The same claim {@link ATLAS_COVERAGE_STATES}'s own member makes, so it carries the same
 *   obligation: name the holder, because a state that cannot say WHERE is unfalsifiable.
 * - `never-acted` — a conduct bound. A mutation, a side-effecting read or a photograph the walk will not
 *   take. The surface is still INVENTORIED, so nothing leaves coverage; what is bounded is what the atlas
 *   does, not what it knows.
 * - `names-not-values` — the surface-map disposition applied to a field: the method, the path shape and the
 *   field NAME are held and the value never is. Every record survives; each carries less.
 * - `secret-material` — the same denial `kit/withheld.ts` already reports, kept apart from
 *   `names-not-values` because a credential is withheld for a different reason and by different mechanisms.
 * - `out-of-platform` — a different product or system entirely, which one atlas per platform makes somebody
 *   else's row rather than this one's gap.
 * - `claim-not-made` — the atlas declines to ASSERT something rather than declining to hold it: that a
 *   walked page list is complete, that a screenshot is free of account content, that a probe's `*` is the
 *   real method set. Nothing is withheld; a claim a reader might otherwise infer is refused in writing.
 * - `not-fetched` — nobody has been to get it. **This is the Cloudflare row, and the coverage gate REFUSES
 *   it** ({@link isRefusedExclusion}): under the rule above it is missing coverage, not a settled decision.
 *   Refusing it is not the same as blocking on it — see {@link isRefusedExclusion} and `kit/backlog.ts`.
 *   It is expressible rather than inexpressible on purpose — a ground an author cannot state is a ground an
 *   author mislabels, and a mislabelled row is invisible where a refused one is a name on a list.
 */
export const ATLAS_EXCLUSION_GROUNDS = [
  "shape-index",
  "disclosure-bound",
  "payload-not-map",
  "held-elsewhere",
  "never-acted",
  "names-not-values",
  "secret-material",
  "out-of-platform",
  "claim-not-made",
  "not-fetched",
] as const;

/** One ground, as a value.
 * @internal
 */
export type AtlasExclusionGround = (typeof ATLAS_EXCLUSION_GROUNDS)[number];

/**
 * What makes a family too voluminous to store one row at a time.
 *
 * Two arms rather than one nullable figure, because the difference between them is the whole subject of the
 * rule. `measured` carries a magnitude and the command that re-establishes it — the repo's standing rule
 * that a comment citing a measurement carries its own reproduction, applied to a claim rather than a
 * comment. `unmeasured` is an atlas asserting voluminousness it has never actually weighed, and it is
 * REPORTED AND REFUSED by the coverage gate (`slopweaver atlas <platform> coverage`) rather than silently
 * accepted: an unweighed "too big to hold" is exactly the unfalsifiable exclusion the rule bans.
 *
 * Both arms require `unboundedBecause` — §6's criterion applied to this family, not a restatement of its
 * name. A family that cannot say why its records are time-series OBSERVATIONS rather than configuration
 * somebody authored has not met the criterion at all, and no magnitude rescues that.
 */
const atlasVolumeSchema = z.discriminatedUnion("basis", [
  z
    .object({
      basis: z.literal("measured"),
      /** The command, endpoint or vendor page that re-establishes {@link magnitude}. */
      establishedBy: z.string().min(1),
      /** The figure a reader can check — rows over a window, bytes, a documented retention. */
      magnitude: z.string().min(1),
      unboundedBecause: z.string().min(1),
    })
    .strict(),
  z
    .object({
      basis: z.literal("unmeasured"),
      unboundedBecause: z.string().min(1),
      /** The concrete call or page that WOULD weigh this family, so the debt is actionable. */
      wouldBeMeasuredBy: z.string().min(1),
    })
    .strict(),
]);

/** A volume claim, measured or not.
 * @internal
 */
export type AtlasVolumeBasis = z.infer<typeof atlasVolumeSchema>;

/**
 * One thing an atlas does not hold, and the ground it stands on.
 *
 * `because` is the prose a reader gets — what is not held, and why, in English. The ground beside it is
 * what a gate can read, and the two are checked against each other by nothing: prose cannot be verified, so
 * the discriminant carries every obligation. Four arms carry a second required field, and each one is there
 * so the claim on that ground is falsifiable rather than asserted.
 *
 * @internal
 */
export const atlasExclusionSchema = z.discriminatedUnion("ground", [
  z
    .object({
      because: z.string().min(1),
      ground: z.literal("shape-index"),
      volume: atlasVolumeSchema,
    })
    .strict(),
  z
    .object({
      because: z.string().min(1),
      ground: z.literal("disclosure-bound"),
      /** The owner ruling that settled this bound — what the owner ruled, never "policy". */
      ruledBy: z.string().min(1),
    })
    .strict(),
  z
    .object({
      because: z.string().min(1),
      ground: z.literal("held-elsewhere"),
      /** The verb, path or store that answers this instead — see {@link ATLAS_COVERAGE_STATES}. */
      holder: z.string().min(1),
    })
    .strict(),
  z
    .object({
      because: z.string().min(1),
      ground: z.literal("not-fetched"),
      /** What would close it, so a refused row arrives with its own remedy rather than as a complaint. */
      wouldBeClosedBy: z.string().min(1),
    })
    .strict(),
  z.object({ because: z.string().min(1), ground: z.literal("payload-not-map") }).strict(),
  z.object({ because: z.string().min(1), ground: z.literal("never-acted") }).strict(),
  z.object({ because: z.string().min(1), ground: z.literal("names-not-values") }).strict(),
  z.object({ because: z.string().min(1), ground: z.literal("secret-material") }).strict(),
  z.object({ because: z.string().min(1), ground: z.literal("out-of-platform") }).strict(),
  z.object({ because: z.string().min(1), ground: z.literal("claim-not-made") }).strict(),
]);

export type AtlasExclusion = z.infer<typeof atlasExclusionSchema>;

/**
 * Whether one exclusion actually removes records from the atlas, rather than bounding what it does.
 *
 * The split that makes the owner's rule enforceable: of the ten grounds, four drop a record and six do
 * not. A report that counted all nine would say every atlas withholds five or six things, which is true and
 * useless; this is the predicate a page listing what the owner has to rule on is built from.
 *
 * @param exclusion the declared exclusion to judge
 * @returns `true` when a record that would otherwise be stored is not
 */
export function withholdsRecords({ exclusion }: { exclusion: AtlasExclusion }): boolean {
  return (
    exclusion.ground === "shape-index" ||
    exclusion.ground === "disclosure-bound" ||
    exclusion.ground === "payload-not-map" ||
    exclusion.ground === "not-fetched"
  );
}

/**
 * Whether the coverage gate refuses one declared exclusion.
 *
 * The two shapes the owner's rule bans, and they are one predicate because they are one failure
 * seen from two sides: an exclusion nobody went to get (`not-fetched`), and an exclusion claiming to be too
 * big to get without ever having weighed it (`shape-index` on an `unmeasured` basis). Both assert that
 * coverage is missing for a reason no reader can check.
 *
 * Exported so `slopweaver atlas <platform> coverage`'s report and its exit code cannot drift apart, and so
 * a card counting refused rows counts the same rows the verb refuses.
 *
 * **A refused row is a BACKLOG row, never a gate on a pull request** — the owner's ruling is that the
 * refused rows are worked through steadily at high throughput. `slopweaver atlas <platform> coverage` exits 3,
 * because its question is whether ONE atlas is complete today. `slopweaver atlas backlog` sweeps the fleet,
 * orders the rows the way the owner ruled they should be worked, and always exits 0.
 *
 * @param exclusion the declared exclusion to judge
 * @returns `true` when this exclusion is one the gate refuses
 */
export function isRefusedExclusion({ exclusion }: { exclusion: AtlasExclusion }): boolean {
  if (exclusion.ground === "not-fetched") {
    return true;
  }
  return exclusion.ground === "shape-index" && exclusion.volume.basis === "unmeasured";
}

/**
 * What one platform's atlas declares about itself — the row the catalogue shows.
 *
 * `excludes` is required and may not be empty-by-accident: what an atlas deliberately does NOT hold is the
 * fact a reader needs most and the one nobody writes unless a type demands it. `resyncCommand` is required
 * for the same reason — a single command that brings the whole atlas current is a first-class requirement,
 * because the data drifts and an atlas captured once is stale within the month.
 */
export const atlasDescriptorSchema = z
  .object({
    /** What this atlas answers that no other does. */
    question: z.string().min(1),
    /**
     * What this platform's own web client may be driven to do — REQUIRED, and required is the whole point.
     *
     * **Owner ruling:** the code makes it structurally impossible to have an integration or atlas with no
     * policy set, because everything needs well-defined boundaries. A required field on a `.strict()` schema
     * is that rule in the type system: a new atlas that omits it fails to compile AND fails to parse, rather
     * than inheriting a default nobody chose. The failure mode is a silent fallback, whose mistakes compound
     * and are difficult to pin down.
     *
     * Declaring `read-before-write` here does not GRANT it. `WRITE_POLICY_REGISTER`
     * (`src/admit/browserSurface.ts`) is the only thing the guard reads, and
     * `unit/admit/writePolicyRegister.test.ts` fails when a descriptor claims a policy the register does not
     * back — so the field is a declaration checked against the enforcement, never a second source of truth.
     */
    writePolicy: z.enum(ATLAS_WRITE_POLICIES),
    excludes: z.array(atlasExclusionSchema),
    kinds: z.array(z.string().min(1)).min(1),
    /** ONE per SaaS app. `slack`, never `slack-api` — see this file's header. */
    platform: z.string().min(1),
    /** The one command that brings every surface current. */
    resyncCommand: z.string().min(1),
    /**
     * How long this atlas's published generation may stand before it stops being quotable as current,
     * written the way a cadence is spoken — `30m`, `4h`, `7d`.
     *
     * **Owner ruling:** per-atlas windows default to four hours, the same logic applied to the corpora for
     * Slack, Linear, Notion and GitHub. So the field is OPTIONAL and the default is the ruling: an atlas that
     * declares nothing is judged against `kit/freshnessWindow.ts`'s four hours, a policy the owner set rather
     * than one nobody chose. An atlas
     * whose provider genuinely moves slower, or whose sync is expensive enough that four hours is not
     * achievable, declares its own and says why in a comment beside it.
     */
    freshnessWindow: z.string().min(1).optional(),
    /**
     * The BOUNDED live read that answers one question without re-syncing the whole atlas, when this atlas
     * has one.
     *
     * Call 2 of the same ruling: a bounded live read counts as fresh. An atlas past its window is not
     * refused and does not hold a question on a whole resync — the slice the question needs is read live and
     * THAT read is what gets quoted. `slopweaver atlas vanta control-evidence --control <id>` is the shape:
     * one control against the live posture, seconds rather than the minutes a full walk costs.
     *
     * Absent means this atlas has no such verb, not that nobody wrote the field. `kit/freshnessWindow.ts`
     * reports the difference rather than smoothing it: an atlas with no bounded live read falls to the loud
     * arm and names its `resyncCommand`.
     */
    liveReadCommand: z.string().min(1).optional(),
    /**
     * The words a person would use when this atlas has something new to read, for an atlas whose provider rarely
     * changes and whose walk costs the owner a sign-in.
     *
     * Declared, its scheduled resync walks only when a person has named one of `terms` in the corpus since the
     * atlas last read (`live/resync/demand.ts`); a slot with no demand exits `EXIT_EXPECTED_EMPTY` having opened no
     * browser. `because` is the measurement that justifies gating it. The owner's rule is that a sync asks for
     * a sign-in only when it will be useful. Absent means it walks on its cadence.
     */
    resyncDemand: z
      .object({
        because: z.string().min(1),
        terms: z.array(z.string().min(1)).min(1),
      })
      .strict()
      .optional(),
    /**
     * How this atlas is resynced when it is NOT on the managed schedule: `manual-only`, read on demand by running its
     * `resyncCommand` by hand.
     *
     * Declared, the resync roster (`live/resync/roster.ts`) derives no row for it, so `automation register-resyncs`
     * retires the row it once wrote, and no scheduled walk can meet a sign-in page and raise a card. Its
     * `freshnessWindow` still judges the stored read, and a stale one names the `resyncCommand`. Stronger than
     * `resyncDemand`, which keeps a scheduled row and walks whenever anyone names the atlas. The owner's rule is that
     * a retired platform need not run a scheduled automated sync, and its code is kept. Absent means the atlas is on the managed schedule.
     */
    resyncSchedule: z
      .object({
        because: z.string().min(1),
        kind: z.literal("manual-only"),
      })
      .strict()
      .optional(),
    surfaces: z.array(atlasSurfaceSchema).min(1),
    /** The permanent claim boundary: what "complete" can ever mean for this account's access. */
    visibilityScope: z.string().min(1),
  })
  .strict();

export type AtlasDescriptor = z.infer<typeof atlasDescriptorSchema>;

/**
 * The two surfaces a COMPILED surface-map atlas fills, declared once rather than per platform.
 *
 * Kit-owned because it was copied. The Airtable and Figma atlases each publish a complete surface map with
 * no network call and no credential, from an operation registry compiled offline out of the vendor's own
 * specification and a browser route inventory measured without an account — so both declared byte-identical
 * `spec-declared` and `browser-routes` entries, and the clone ratchet said so. It is the same argument
 * `kit/projection.ts` and `kit/withheld.ts` are here on: a shape that regenerates through ordinary careful
 * work, because the next atlas's author opens whichever sibling they find first.
 *
 * The three fields are not defaults a platform may vary. `acquisition: "compiled"` is what makes the pair
 * publishable with nothing configured; `authoritative` on the specification and `discovery` on the routes is
 * the honest grading, since a declared operation IS the provider's own statement of its surface while a
 * route probe establishes existence and nothing about what the page holds. A platform that wants different
 * values does not have this shape and should spell its own surfaces out.
 *
 * @returns the two filled compiled surfaces, in the order a descriptor lists them
 */
export function compiledSurfaceMapSurfaces(): readonly AtlasSurface[] {
  return [
    {
      acquisition: "compiled",
      denominator: {
        because:
          "no independent catalogue of this surface has been wired into this shared shape yet, so its coverage is divided by this atlas's own compiled registry",
        known: false,
      },
      documented: true,
      name: "spec-declared",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      acquisition: "compiled",
      denominator: {
        because:
          "a route probe establishes that an address exists and nothing about what the page holds, so there is no count of pages to divide by",
        known: false,
      },
      documented: false,
      name: "browser-routes",
      role: "discovery",
      status: "filled",
      unfilledBecause: null,
    },
  ];
}

/**
 * Whether an atlas publishes ONLY what it compiles offline — at least one filled surface, and every filled
 * surface `acquisition: "compiled"`.
 *
 * Such an atlas presents no credential, drives no browser and needs no model: its sync compiles a surface
 * map from a vendor's PUBLIC documents. Most read a pin that changes only when a landing moves it; braze
 * re-reads its public docs sitemap and re-fetches only the pages whose `lastmod` moved
 * (`braze/specSource.ts`), and gemini-ai-studio re-fetches its discovery document when it drifts from the
 * reviewed digest — uncredentialed reads of a public page, never a walk of an account. That is what lets its
 * scheduled resync run in the chair's own tick with no seat and no model — the reason to seat a resync
 * is minutes of provider walking, and this atlas does none (MEASURED on a cold cache,
 * `SLOPWEAVER_HOME=$(mktemp -d) slopweaver atlas airtable sync`: 0.9s for most, 21s for microsoft365, 2m32s
 * for braze's first fetch of its reference pages and 3.7s once cached; braze's 14 scheduled passes ran 2.2
 * minutes between them).
 *
 * The non-empty half is the load-bearing one. Eight atlases declare NO filled surface today, among them the
 * aether and clerk browser walks, and "every filled surface is compiled" is vacuously true of all of them —
 * which would move a walk of the owner's Chrome into an unattended tick.
 *
 * @param descriptor the atlas to classify
 * @returns true when every surface it has filled is compiled, and it has filled at least one
 */
export function isCompileOnlyDescriptor({ descriptor }: { descriptor: AtlasDescriptor }): boolean {
  const filled = descriptor.surfaces.filter((surface) => surface.status === "filled");
  return filled.length > 0 && filled.every((surface) => surface.acquisition === "compiled");
}

/**
 * Whether an atlas is on the managed resync schedule — false only for one declaring `resyncSchedule` manual-only.
 *
 * @param descriptor the atlas to classify
 * @returns true when the resync roster derives a scheduled row for it
 */
export function hasScheduledResync({ descriptor }: { descriptor: AtlasDescriptor }): boolean {
  return descriptor.resyncSchedule?.kind !== "manual-only";
}

/**
 * Whether an atlas has any surface it has declared and never populated.
 *
 * The question a catalogue row answers at a glance, and the one the owner's "both surfaces are mandatory"
 * ruling makes worth asking: an atlas with an unfilled surface is incomplete in a way that a coverage
 * fraction computed over its filled surfaces alone would hide entirely.
 *
 * @param descriptor the atlas to inspect
 * @returns every surface declared but not yet populated, in declaration order
 */
export function unfilledSurfaces({ descriptor }: { descriptor: AtlasDescriptor }): readonly AtlasSurface[] {
  return descriptor.surfaces.filter((surface) => surface.status === "declared-unfilled");
}

/**
 * Whether this atlas has looked at the browser at all.
 *
 * Separate from {@link unfilledSurfaces} because it is the specific question behind the ruling: a platform
 * whose only filled surface is an API is the shape that gave stupid answers, and it should be visible
 * without a reader knowing which surface names this particular platform chose.
 *
 * @param descriptor the atlas to inspect
 * @returns `true` when at least one driven-browser surface is filled
 */
export function hasFilledBrowserSurface({ descriptor }: { descriptor: AtlasDescriptor }): boolean {
  return descriptor.surfaces.some((surface) => surface.acquisition === "driven-browser" && surface.status === "filled");
}
