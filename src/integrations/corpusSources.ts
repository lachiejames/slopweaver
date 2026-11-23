/**
 * The corpus source lists, derived from the integration registry rather than kept beside it.
 *
 * An integration that ingests declares where it sits among the corpus sources on its own manifest (`corpus` in
 * `./manifest.ts`), so a new one is its manifest and appears in every list below with no hand edit. The two
 * sources that are NOT integrations are the one hand-kept table here, {@link LOCAL_CORPUS_SOURCES}: no new
 * integration is ever added to it.
 *
 * ## Order is an append-only ordinal, never the registry's
 *
 * The registry is alphabetical; these lists are not, and their order is observable — printed in error messages,
 * the order `corpus/subset.ts` tallies in, and the `content_source` Postgres enum's order
 * (`src/store/schema/enums.ts`), where a reordered value is a migration. So each source carries its position in
 * {@link ALL_CORPUS_SOURCES}, and `unit/integrations/corpusSources.test.ts` refuses a gap or a duplicate.
 *
 * ## Why this is its own module
 *
 * `src/corpus/types.ts` is imported nearly everywhere and keeps only a TYPE import of this one, erased at
 * runtime, so a corpus record shape never loads the registry. A module that needs a list's VALUE imports it from
 * here.
 */
import type { CorpusIntegrationMetadata, IntegrationManifest } from "./manifest.js";
import { type RegisteredIntegration, registeredIntegrations } from "./registry.js";

/**
 * A corpus source that is not an integration: its id, its position, whether its records reach bronze, and the
 * policy facts an integration declares on its `corpus` row (`./manifest.ts`), save one.
 */
interface LocalCorpusSourceRow {
  readonly alwaysPrivate: boolean;
  readonly bronze: boolean;
  readonly containerScoped: boolean;
  readonly id: string;
  readonly ordinal: number;
  /**
   * Whether its records can move the derived roster. Not `identityRoster`: `self` can (the owner's own notes mint an
   * identity), yet no roster entry ever names it, so the two facts an integration declares as one come apart here.
   */
  readonly rosterWitness: boolean;
}

/**
 * The two corpus sources no integration declares.
 *
 * `gold` is the SYNTHETIC source for gold markdown read back as records, so distilled findings are retrievable and
 * citable alongside bronze; it is synthesised at query time and never persisted to bronze. `self` is the owner's
 * OWN written thinking, scanned off the local filesystem: it has bytes in bronze like the fetched sources, but no
 * network, no pagination and no cursor.
 */
const LOCAL_CORPUS_SOURCES = [
  { alwaysPrivate: false, bronze: false, containerScoped: false, id: "gold", ordinal: 4, rosterWitness: false },
  { alwaysPrivate: true, bronze: true, containerScoped: true, id: "self", ordinal: 5, rosterWitness: true },
] as const satisfies readonly LocalCorpusSourceRow[];

/** One of the two local rows. */
type LocalCorpusSource = (typeof LOCAL_CORPUS_SOURCES)[number];
/** The local row whose records reach bronze. */
type BronzeLocalCorpusSource = Extract<LocalCorpusSource, { readonly bronze: true }>;
/** The members of `M` that ingest. */
type Ingesting<M> = Extract<M, { readonly corpus: CorpusIntegrationMetadata }>;
/**
 * The members of `I` whose `allSourcesSweep` MAY be `true`: a literal `true`, or a widened `boolean`. Not
 * `Extract<…, { allSourcesSweep: true }>`, which drops a widened `IntegrationManifest` and types a non-empty
 * runtime list as `never`; `true extends B` keeps the type no narrower than the value. Distributes over `I`.
 */
type MaySweep<I> = I extends { readonly corpus: { readonly allSourcesSweep: infer B } }
  ? true extends B
    ? I
    : never
  : never;
/** The members of `M` that `refresh --all-sources` may sweep. */
type Swept<M> = MaySweep<Ingesting<M>>;

/**
 * The members of `M` that MAY have a `connect --check` preflight: one declaring `connect`, required or optional.
 * A key test rather than `Extract<…, { connect: unknown }>`, for the reason {@link MaySweep} gives: a widened
 * manifest's optional `connect` would otherwise drop it. Distributes over `M`.
 */
type MayConnect<M> = M extends { readonly features: infer F } ? ("connect" extends keyof F ? M : never) : never;
/** The members of `I` whose `upfrontTokenGate` MAY be `true`, on {@link MaySweep}'s terms. */
type MayTokenGate<I> = I extends { readonly corpus: { readonly upfrontTokenGate: infer B } }
  ? true extends B
    ? I
    : never
  : never;
/** The members of `M` with a `connect --check` preflight. */
type Connecting<M> = MayConnect<M>;
/** The members of `M` that ingest AND have a preflight — what `onboard` connects and turns into a refresh. */
type Connectable<M> = MayConnect<Ingesting<M>>;
/** The members of `M` that `refresh` refuses up front when their static token is unset. */
type TokenGated<M> = MayTokenGate<Ingesting<M>>;
/** The members of `I` whose corpus row's policy field `K` MAY be `true`, on {@link MaySweep}'s terms. */
type MayDeclare<I, K extends string> = I extends { readonly corpus: infer C }
  ? K extends keyof C
    ? true extends C[K]
      ? I
      : never
    : never
  : never;
/** The members of `M` a roster entry may name. */
type IdentityRostered<M> = MayDeclare<Ingesting<M>, "identityRoster">;
/** The members of `M` whose every record is private. */
type AlwaysPrivate<M> = MayDeclare<Ingesting<M>, "alwaysPrivate">;
/** The members of `M` whose container is an allowlist unit. */
type ContainerScoped<M> = MayDeclare<Ingesting<M>, "containerScoped">;
/** The members of `M` where a person's mention is demand for a demand-gated atlas. */
type ResyncDemanded<M> = MayDeclare<Ingesting<M>, "resyncDemand">;
/** The local row whose records can move the derived roster. */
type RosterWitnessLocal = Extract<LocalCorpusSource, { readonly rosterWitness: true }>;
/** The local row whose every record is private. */
type AlwaysPrivateLocal = Extract<LocalCorpusSource, { readonly alwaysPrivate: true }>;
/** The local row whose container is an allowlist unit. */
type ContainerScopedLocal = Extract<LocalCorpusSource, { readonly containerScoped: true }>;

/**
 * `row.id`, typed as `T["id"]` rather than as `id`'s constraint. Reading `.id` straight off a member narrowed to a
 * conditional type (`Swept<M>`, say) answers `string` while `M` is generic; a property read on a TYPE PARAMETER keeps
 * the indexed access, so each list below is typed by the members it was filtered to, with no assertion.
 *
 * @param row the manifest or local row whose id is read
 * @returns its id, typed by that row's own type
 */
function idOf<T extends { readonly id: string }>({ row }: { row: T }): T["id"] {
  return row.id;
}

/** A non-empty list, the shape `pgEnum` and `z.enum` take. */
type NonEmpty<T> = readonly [T, ...T[]];

/** Every corpus source list one set of manifests derives, each in ordinal order. */
interface DerivedCorpusSources<M extends IntegrationManifest> {
  /** Every source, the two local ones included. */
  readonly all: NonEmpty<Ingesting<M>["id"] | LocalCorpusSource["id"]>;
  /** Every source with bytes in bronze: every integration that ingests, plus `self`. */
  readonly bronze: NonEmpty<Ingesting<M>["id"] | BronzeLocalCorpusSource["id"]>;
  /** Every integration that ingests. */
  readonly fetchable: NonEmpty<Ingesting<M>["id"]>;
  /** The integrations `refresh --all-sources` sweeps. */
  readonly allSourcesSweep: NonEmpty<Swept<M>["id"]>;
  /** The integrations that ingest and have a preflight. */
  readonly connectable: NonEmpty<Connectable<M>["id"]>;
  /** Every integration with a preflight: the connectable ones in ordinal order, then the rest by id. */
  readonly connectTargets: NonEmpty<Connecting<M>["id"]>;
  /** The integrations `refresh` refuses up front without a token. */
  readonly tokenGated: NonEmpty<TokenGated<M>["id"]>;
  /** The integrations a roster entry may name. */
  readonly identityRoster: NonEmpty<IdentityRostered<M>["id"]>;
  /** The sources whose records can move the derived roster, ordered by id rather than ordinal. */
  readonly rosterWitness: NonEmpty<IdentityRostered<M>["id"] | RosterWitnessLocal["id"]>;
  /** The sources whose every record is private. */
  readonly alwaysPrivate: NonEmpty<AlwaysPrivate<M>["id"] | AlwaysPrivateLocal["id"]>;
  /** The sources whose container is an allowlist unit. */
  readonly containerScoped: NonEmpty<ContainerScoped<M>["id"] | ContainerScopedLocal["id"]>;
  /** The integrations where a person's mention is demand for a demand-gated atlas. No local row qualifies. */
  readonly resyncDemand: NonEmpty<ResyncDemanded<M>["id"]>;
}

/**
 * The order `connect` names its targets in: the ones that ingest by ordinal, then the live connectors with no
 * corpus row by id.
 *
 * @returns negative when `left` comes first
 */
function byConnectOrder({ left, right }: { left: IntegrationManifest; right: IntegrationManifest }): number {
  if (left.corpus !== undefined && right.corpus !== undefined) {
    return left.corpus.ordinal - right.corpus.ordinal;
  }
  if (left.corpus !== undefined || right.corpus !== undefined) {
    return left.corpus === undefined ? 1 : -1;
  }
  return left.id < right.id ? -1 : 1;
}

/**
 * Narrows a derived list to a FROZEN non-empty tuple, refusing an empty one.
 *
 * Frozen because one list is now read by several modules that each used to hold a private literal (refresh's
 * `--all-sources` selection was one): a caller mutating the shared array would otherwise change every other
 * reader's answer.
 *
 * @param values the derived list
 * @param list which list it is, named in the refusal
 * @returns the same values as a frozen non-empty tuple
 */
function nonEmpty<T>({ values, list }: { values: readonly T[]; list: string }): NonEmpty<T> {
  const [head, ...rest] = values;
  if (head === undefined) {
    // An invariant, not a runtime branch: every production list has members, and a fixture set that declares no
    // corpus source is a test that should fail loudly rather than derive an enum with no values.
    throw new Error(`${list} derived empty: no manifest qualifies for it`);
  }
  const tuple: NonEmpty<T> = [head, ...rest];
  Object.freeze(tuple);
  return tuple;
}

/** Orders rows by ordinal, handed by reference to `toSorted`. */
const byOrdinal = (left: { ordinal: number }, right: { ordinal: number }): number => left.ordinal - right.ordinal;

/**
 * The lists naming which integrations `refresh` and `connect` reach.
 *
 * @param ingesting the integrations that ingest, already in ordinal order
 * @param manifests every integration, for the connect targets with no corpus row
 * @returns those lists, each frozen and non-empty
 */
function reachListsOf<M extends IntegrationManifest>({
  ingesting,
  manifests,
}: {
  ingesting: readonly Ingesting<M>[];
  manifests: readonly M[];
}): Pick<DerivedCorpusSources<M>, "allSourcesSweep" | "connectable" | "connectTargets" | "fetchable" | "tokenGated"> {
  return {
    allSourcesSweep: nonEmpty({
      list: "CORPUS_SOURCES",
      values: ingesting
        .filter((manifest): manifest is Swept<M> => manifest.corpus.allSourcesSweep)
        .map((row) => idOf({ row })),
    }),
    connectable: nonEmpty({
      list: "CONNECT_SOURCES",
      values: ingesting
        .filter((manifest): manifest is Connectable<M> => manifest.features.connect !== undefined)
        .map((row) => idOf({ row })),
    }),
    connectTargets: nonEmpty({
      list: "CONNECT_TARGETS",
      values: manifests
        .filter((manifest): manifest is Connecting<M> => manifest.features.connect !== undefined)
        .toSorted((left, right) => byConnectOrder({ left, right }))
        .map((row) => idOf({ row })),
    }),
    fetchable: nonEmpty({ list: "FETCHABLE_SOURCES", values: ingesting.map((row) => idOf({ row })) }),
    tokenGated: nonEmpty({
      list: "TOKENED_SOURCES",
      values: ingesting
        .filter((manifest): manifest is TokenGated<M> => manifest.corpus.upfrontTokenGate)
        .map((row) => idOf({ row })),
    }),
  };
}

/**
 * The lists naming which sources carry a policy trait: on the roster, always private, scoped by container, or where
 * a mention is resync demand.
 *
 * @param ingesting the integrations that ingest, already in ordinal order
 * @returns those lists, each frozen and non-empty
 */
function policyListsOf<M extends IntegrationManifest>({
  ingesting,
}: {
  ingesting: readonly Ingesting<M>[];
}): Pick<
  DerivedCorpusSources<M>,
  "alwaysPrivate" | "containerScoped" | "identityRoster" | "resyncDemand" | "rosterWitness"
> {
  const identityRostered = ingesting.filter(
    (manifest): manifest is IdentityRostered<M> => manifest.corpus.identityRoster,
  );
  const privateRows = [
    ...ingesting
      .filter((manifest): manifest is AlwaysPrivate<M> => manifest.corpus.alwaysPrivate)
      .map((manifest) => ({ id: idOf({ row: manifest }), ordinal: manifest.corpus.ordinal })),
    ...LOCAL_CORPUS_SOURCES.filter((row): row is AlwaysPrivateLocal => row.alwaysPrivate),
  ];
  const containerRows = [
    ...ingesting
      .filter((manifest): manifest is ContainerScoped<M> => manifest.corpus.containerScoped)
      .map((manifest) => ({ id: idOf({ row: manifest }), ordinal: manifest.corpus.ordinal })),
    ...LOCAL_CORPUS_SOURCES.filter((row): row is ContainerScopedLocal => row.containerScoped),
  ];
  return {
    alwaysPrivate: nonEmpty({
      list: "ALWAYS_PRIVATE_SOURCES",
      values: privateRows.toSorted(byOrdinal).map((row) => idOf({ row })),
    }),
    containerScoped: nonEmpty({
      list: "CONTAINER_SCOPED_SOURCES",
      values: containerRows.toSorted(byOrdinal).map((row) => idOf({ row })),
    }),
    identityRoster: nonEmpty({ list: "IDENTITY_SOURCES", values: identityRostered.map((row) => idOf({ row })) }),
    resyncDemand: nonEmpty({
      list: "RESYNC_DEMAND_SOURCES",
      values: ingesting
        .filter((manifest): manifest is ResyncDemanded<M> => manifest.corpus.resyncDemand)
        .map((row) => idOf({ row })),
    }),
    rosterWitness: nonEmpty({
      list: "ROSTER_SOURCES",
      values: [
        ...identityRostered.map((row) => idOf({ row })),
        ...LOCAL_CORPUS_SOURCES.filter((row): row is RosterWitnessLocal => row.rosterWitness).map((row) =>
          idOf({ row }),
        ),
      ].toSorted(),
    }),
  };
}

/**
 * Every corpus source list, derived from the given manifests and the two local sources.
 *
 * Takes the manifests rather than reading the registry, so a test can add a fixture integration and watch it
 * appear in every list; production passes {@link registeredIntegrations}.
 *
 * @param manifests the integrations to derive from, in any order — the result is ordered by each source's ordinal
 * @returns every list, each in ordinal order — the connect targets with no corpus row follow, by id
 */
export function corpusSourcesOf<M extends IntegrationManifest>({
  manifests,
}: {
  manifests: readonly M[];
}): DerivedCorpusSources<M> {
  const ingesting = manifests
    .filter((manifest): manifest is Ingesting<M> => manifest.corpus !== undefined)
    .toSorted((left, right) => left.corpus.ordinal - right.corpus.ordinal);
  const integrationRows = ingesting.map((manifest) => ({
    id: idOf({ row: manifest }),
    ordinal: manifest.corpus.ordinal,
  }));
  const bronzeLocal = LOCAL_CORPUS_SOURCES.filter((row): row is BronzeLocalCorpusSource => row.bronze);
  return {
    ...reachListsOf({ ingesting, manifests }),
    ...policyListsOf({ ingesting }),
    all: nonEmpty({
      list: "ALL_CORPUS_SOURCES",
      values: [...integrationRows, ...LOCAL_CORPUS_SOURCES].toSorted(byOrdinal).map((row) => idOf({ row })),
    }),
    bronze: nonEmpty({
      list: "BRONZE_SOURCES",
      values: [...integrationRows, ...bronzeLocal].toSorted(byOrdinal).map((row) => idOf({ row })),
    }),
  };
}

/** The production derivation, once. */
const DERIVED: DerivedCorpusSources<RegisteredIntegration> = corpusSourcesOf({
  manifests: registeredIntegrations(),
});

/**
 * Origin system of a record: every integration that ingests, plus `gold` and `self` ({@link LOCAL_CORPUS_SOURCES}).
 *
 * `gmail` is the owner's mailbox, FETCHED with a cursor like the first four and unlike all of them in the one way
 * that shapes every decision downstream: the other four are org-shared surfaces, and a mailbox is one person's
 * private correspondence whose counterparties never joined this workspace. That is why it is an
 * `isAlwaysPrivateSource` source (`src/corpus/visibility.ts`) rather than a source with a private lane, and why it
 * is absent from {@link CORPUS_SOURCES}. `calendar` is the owner's diary, and everything said of the mailbox is
 * true of it word for word. `fathom` is the meeting recorder, the mailbox's argument made explicit: a recorded
 * call's other voices are customers, vendors and partners recorded talking to the owner rather than publishing,
 * and its records carry the RAW words and never the provider's own summary (`corpus/fathom/project.ts`).
 * `chatgpt` is the owner's ChatGPT history, read from the account's official data EXPORT on disk rather than fetched
 * by `refresh` — no official API exposes a chatgpt.com account, and the private web API `chatgpt list` reads is a
 * separate verb — so its cursor is the newest message instant an imported export carried; it is the owner's own
 * words to an assistant, written for nobody, and always private like the mailbox. The
 * shape it projects through is shared with the chat-history providers after it (`corpus/chatHistory/`).
 */
export type CorpusSource = Ingesting<RegisteredIntegration>["id"] | LocalCorpusSource["id"];

/** Every member of {@link CorpusSource} — for validating an untrusted value against the whole union, not just the fetchable half. */
export const ALL_CORPUS_SOURCES: readonly CorpusSource[] = DERIVED.all;

/**
 * The sources the refresh loop sweeps for `refresh --all-sources`: the integrations whose manifest says
 * `allSourcesSweep`. `gold` is excluded — it is synthesised by the gold stage, never fetched or written to bronze —
 * and `self` because it is a full deterministic re-scan of local files, with nothing to page through, nothing to
 * rate-limit and no cursor that could resume.
 *
 * `gmail`, `calendar` and `fathom` ARE fetched and watermarked and are still absent here, the one membership in
 * these lists that is a policy rather than a mechanism. The members are the org-shared surfaces every reader of
 * the corpus is already inside; a mailbox, a diary and a recorded call are not, so each is reached by naming it —
 * see {@link FETCHABLE_SOURCES}, the wider list `--source` validates against.
 */
export const CORPUS_SOURCES: readonly CorpusSource[] = DERIVED.allSourcesSweep;

/**
 * The sources `--source` accepts: every integration that ingests.
 *
 * WIDER than {@link CORPUS_SOURCES}, and the gap is the whole of these connectors' opt-in. `calendar` and `gmail`
 * authenticate with a stored OAuth GRANT and are reached by typing `--source <name>`: a mailbox can be named and
 * cannot be swept up. That is the ONE door — there is deliberately no second `--gmail` flag beside it, because the
 * browser consent round trip `gmail connect` already performs is a far more deliberate opt-in than any flag.
 * `fathom` is here on the same terms, for the strongest version of the same reason. `chatgpt` is named-only for the
 * mailbox's reason, and is the one member read off disk rather than fetched: it projects the newest export
 * `chatgpt import-export` took in, whole, every time (`CURSORLESS_SOURCES`, `src/corpus/types.ts`).
 */
export const FETCHABLE_SOURCES: readonly CorpusSource[] = DERIVED.fetchable;

/**
 * Every source with BYTES IN BRONZE — every fetched source plus `self` — and the `content_source` enum's values.
 *
 * A DIFFERENT list to {@link CORPUS_SOURCES}, and the difference is load-bearing rather than cosmetic. That
 * constant answers "what does refresh fetch and watermark"; this one answers "what can appear on a line of bronze
 * JSONL". The bronze reader, the bronze writer, the storage footprint and the compactor all want the second
 * question, and every one of them was once asking the first — so a `self` record was written by a path that
 * silently dropped it (`bucketRecordsBySource`, `src/corpus/bronzeAppend.ts`, iterated the fetch list) and read
 * back by a validator that rejected its source. Both failures are invisible: a green run, and no records.
 *
 * A non-empty tuple of the narrower bronze union, so `pgEnum` infers a column type without `gold` in it.
 */
export const BRONZE_SOURCES: DerivedCorpusSources<RegisteredIntegration>["bronze"] = DERIVED.bronze;

/**
 * The sources a `connect --check` preflight covers that `onboard` also turns into a `refresh --source` command:
 * every integration that ingests and has a preflight. `ConnectSource` in `src/connect/types.ts` re-exports it.
 */
export type ConnectSource = Connectable<RegisteredIntegration>["id"];

/** Every integration with a `connect --check` preflight — `ConnectTarget` in `src/connect/types.ts`. */
export type ConnectTarget = Connecting<RegisteredIntegration>["id"];

/**
 * The corpus sources whose absence of a token is a `refresh` usage error, refused before any network call — the
 * manifests whose corpus row says `upfrontTokenGate`. `TokenedSource` in `src/cli/commands/refresh/core.ts`.
 */
export type TokenedSource = TokenGated<RegisteredIntegration>["id"];

/** Every {@link ConnectSource}, in ordinal order — the order `onboard` presents them in. */
export const CONNECT_SOURCES: readonly ConnectSource[] = DERIVED.connectable;

/**
 * Every {@link ConnectTarget}: the {@link CONNECT_SOURCES}, then the live connectors with no corpus row (read at
 * question time, never crawled into bronze) by id — the order `connect`'s usage and refusals name them in.
 */
export const CONNECT_TARGETS: readonly ConnectTarget[] = DERIVED.connectTargets;

/**
 * Every {@link TokenedSource}, in ordinal order — the subjects of refresh's missing-token gate.
 *
 * The gate once selected them by `source !== "github"`, a correct spelling of "everything else" for exactly as
 * long as everything else was tokened: `gmail` authenticates with a stored OAuth GRANT, so every `--source gmail`
 * run failed the gate before reaching the network, naming an environment variable that does not exist for it.
 */
export const TOKENED_SOURCES: readonly TokenedSource[] = DERIVED.tokenGated;

/**
 * The sources a person's roster entry may name, in ordinal order — the integrations whose corpus row says
 * `identityRoster`. `src/silver/identity.ts` re-exports it beside `IdentitySource`, which its readers import.
 */
export const IDENTITY_SOURCES: readonly Exclude<CorpusSource, "gold">[] = DERIVED.identityRoster;

/**
 * The sources whose witness can move the derived roster, and therefore the only ones a staleness check compares: the
 * {@link IDENTITY_SOURCES} plus `self`. In id order rather than ordinal, because it is the order a stale verdict lists
 * its changed sources in. `src/silver/derive/freshness.ts` re-exports it and carries the ruling behind it.
 */
export const ROSTER_SOURCES: readonly CorpusSource[] = DERIVED.rosterWitness;

/**
 * The sources whose EVERY record is private by construction, whatever lane it came from — the argument for each is
 * `isAlwaysPrivateSource`'s (`src/corpus/visibility.ts`), which is the one reader.
 */
export const ALWAYS_PRIVATE_SOURCES: readonly CorpusSource[] = DERIVED.alwaysPrivate;

/**
 * The sources whose `container` is a meaningful allowlist unit, which the slice-shape reading tallies per container
 * (`src/corpus/sliceShape.ts`). Read only as a membership test, so its order is not observable.
 *
 * Slack's container is the channel and Notion's the workspace section, both what an allowlist would name; GitHub's
 * `owner/repo` and Linear's team are allowlist units too. So the tally is kept for every source that has one rather
 * than special-casing Slack: the `channels` slice is only ever priced on Slack because Slack is most of the records,
 * but a reading that could not say what the rest looks like could not prove that.
 */
export const CONTAINER_SCOPED_SOURCES: readonly CorpusSource[] = DERIVED.containerScoped;

/**
 * The sources a person's mention of a demand-gated atlas's term can come from, in ordinal order — the integrations
 * whose corpus row says `resyncDemand`. `src/live/resync/demand.ts` re-exports it and carries the ruling behind it.
 */
export const RESYNC_DEMAND_SOURCES: DerivedCorpusSources<RegisteredIntegration>["resyncDemand"] = DERIVED.resyncDemand;
