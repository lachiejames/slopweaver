/**
 * What one integration declares about itself — the shape every `src/integrations/<id>/integration.ts` row has.
 *
 * An integration is one external system Slopweaver reaches (`docs/doctrine-rationale/rule-11.md` § The
 * integration glossary), and a FEATURE is one closed thing it can do. The manifest is the atlas registration
 * (`src/atlas/kit/registration.ts`) widened to every feature: held apart from `./registry.ts` for the same reason
 * that type is held apart from `src/atlas/registry.ts`, so a row can name its type without importing the list it
 * is about to join.
 *
 * ## Why a manifest is strings, one atlas row and `import()` thunks
 *
 * `./registry.ts` imports every manifest eagerly and the lists derived from it sit on every invocation's path, so
 * one static import of an implementation module would put that integration's SDK, Zod model and transport on the
 * cheapest verb in the build. `src/__tests__/unit/integrations/manifestLaziness.test.ts` is the witness. The one
 * static value a manifest may import is its atlas's `registration.ts`, which is itself strings and thunks only
 * (`src/__tests__/unit/atlas/registrationLaziness.test.ts`), and is held as a VALUE so `src/atlas/registry.ts` can
 * derive its synchronous list from this one.
 */
import type { AccessPlatformSpec } from "../accessReview/levels.js";
import type { RegisteredPlatform } from "../admit/browserSurface.js";
import type { AtlasPlatformRegistration } from "../atlas/kit/registration.js";
import type { SourceCapability } from "../route/profile.js";
import type { CREDENTIALS } from "../secrets/registry.js";

/**
 * Loads the module that implements one feature and selects one named export of it.
 *
 * This is MODULE EVIDENCE, not dispatch: the integrations do not share one call shape per feature (each `connect`
 * preflight takes its own dependencies, `src/cli/commands/connect/run.ts`), so a loader proves the feature's
 * implementation exists where the manifest says and nothing about how to call it. Selecting a named export makes
 * a renamed or deleted one a compile error rather than a silently stale row.
 */
type FeatureLoader = () => Promise<unknown>;

/**
 * The closed set of features, each present only when the integration has it.
 *
 * `atlas` is the local map of what the system holds; `connect` its credential preflight; `ingest` copying its
 * history into the corpus; `read` fetching current state on demand; `write` changing it through a door; `listen`
 * receiving its events. An absent key is the claim that the integration does not have that feature.
 */
interface IntegrationFeatures {
  readonly atlas?: AtlasPlatformRegistration;
  readonly connect?: FeatureLoader;
  readonly ingest?: FeatureLoader;
  readonly read?: FeatureLoader;
  readonly write?: FeatureLoader;
  readonly listen?: FeatureLoader;
}

/**
 * Whether `refresh` refuses the source up front when its static token is unset, and, when it does, the exact line
 * that refusal tells the reader to act on.
 */
type TokenGateMetadata =
  | {
      /**
       * Whether `refresh` refuses it up front when its static token is unset, before any network call — the
       * missing-token gate (`missingTokenDiagnostics`, `src/cli/commands/refresh/core.ts`) and the shared tokened job
       * path. `false` is not "needs no credential": GitHub has its own token path, a mailbox and a diary an OAuth grant,
       * Fathom refuses a missing key inside its own lane, and ChatGPT reads an export off disk.
       */
      readonly upfrontTokenGate: true;
      /**
       * What the missing-token refusal tells the reader to set, word for word. Spelled per source rather than built
       * from a `<SOURCE>_TOKEN` convention, because Slack already breaks it: either of two env vars will do, and a
       * hint naming one sends the reader down the wrong path.
       */
      readonly missingTokenHint: string;
    }
  | {
      readonly upfrontTokenGate: false;
      readonly missingTokenHint?: never;
    };

/**
 * Where an integration that ingests sits among the corpus sources — `./corpusSources.ts` and `./corpusProjections.ts`
 * derive every corpus source list from it.
 */
export type CorpusIntegrationMetadata = CorpusPlacement & CorpusPolicy & TokenGateMetadata;

/**
 * What the readers of a source's records may assume about them — who may read them, whether they can name a person,
 * and whether their container is a unit worth tallying. `./corpusSources.ts` derives one list per field, each joined
 * by the local rows that declare the same fact.
 */
interface CorpusPolicy {
  /**
   * Whether EVERY record it carries is private by construction, whatever lane it came from (`isAlwaysPrivateSource`,
   * `src/corpus/visibility.ts`): a source whose counterparties never joined this workspace (a mailbox, a diary, a
   * recorded call) or whose words were written for nobody (a chat history). The org-shared surfaces are `false`, and
   * a private lane within one is the record's own `visibility` stamp.
   */
  readonly alwaysPrivate: boolean;
  /**
   * Whether its `container` is a unit an allowlist would name (a channel, a repo, a team, a workspace section), so the slice-shape reading tallies it per container (`src/corpus/sliceShape.ts`).
   */
  readonly containerScoped: boolean;
  /**
   * Whether a person's roster entry may name it and its ingest can move the derived roster: its authors carry the
   * source's native-id shape (`isNativeIdShaped`, `src/silver/nativeIdShape.ts`). A source whose author is a display
   * name or a role (a mailbox, a diary, a recorded call, a chat history) can mint no identity and is `false`, pinned by
   * `unit/silver/derive/freshness/rosterSources.test.ts`.
   */
  readonly identityRoster: boolean;
  /**
   * Whether a person naming a demand-gated atlas's term in it gives that atlas a reason to walk
   * (`RESYNC_DEMAND_SOURCES`, `src/live/resync/demand.ts`): a surface where people talk. GitHub is `false` because it
   * holds the fleet's own pull requests, which name every atlas they touch, and a chat history is `false` because its
   * other voice is an assistant.
   */
  readonly resyncDemand: boolean;
}

/** The ordinal and the sweep and progress flags every ingesting integration declares. */
interface CorpusPlacement {
  /**
   * Its position in `ALL_CORPUS_SOURCES`, APPEND-ONLY: that order is printed in error messages and is the
   * `content_source` Postgres enum's order (`src/store/schema/enums.ts`), where a reordered value is a migration.
   * A new integration takes the next unused number; `unit/integrations/corpusSources.test.ts` refuses a gap or a
   * duplicate.
   */
  readonly ordinal: number;
  /**
   * Whether `refresh --all-sources` sweeps it: the org-shared surfaces every reader of the corpus is already
   * inside. A private one (a mailbox, a diary, a recorded call, a chat history) is `false` and reached by naming it.
   */
  readonly allSourcesSweep: boolean;
  /**
   * Whether its fetch reports progress under phases that open with its own id (`slack.channel`, `gmail.page`), so
   * the progress snapshot (`phaseSource`, `src/lib/progressSnapshot.ts`) can name the source a phase belongs to. A
   * source whose fetch reports no such phase is `false`, and a phase opening with its id is then reported sourceless.
   */
  readonly progressPhase: boolean;
}

/** A credential file name the secrets register declares — a typo in a manifest's `connection` fails to compile. */
type CredentialName = (typeof CREDENTIALS)[number]["name"];

/**
 * How this install judges the integration connected, and the command that connects it — what a board row declaring
 * `needs=<id>` is held on (`INTEGRATIONS`, `src/handover/integrationNeeds.ts`).
 */
interface IntegrationConnection {
  /** The command printed beside a held row as the way back. */
  readonly connectWith: string;
  /** Alternative credential sets: connected when every file of any ONE set is stored. */
  readonly credentialSets: readonly (readonly CredentialName[])[];
  /**
   * Its position in `INTEGRATIONS`, the order a held row lists what it needs. A new integration takes the next unused
   * number; `unit/integrations/connections.test.ts` refuses a gap or a duplicate.
   */
  readonly ordinal: number;
}

/**
 * Which side of the noun partition the integration's own `slopweaver <id>` noun sits on (`src/route/sourceNouns.ts`):
 * somewhere a routing judgement may be sent, or a noun that reads no source, with the reason it does not.
 */
type IntegrationNoun = { readonly kind: "source-reading" } | { readonly kind: "not-a-source"; readonly reason: string };

/** One routing row this integration answers for, and where it stands in the capability table. */
interface IntegrationRoutingRow {
  /** The row itself, inline: importing it from `src/route/` would put that module on every manifest's eager closure. */
  readonly capability: SourceCapability;
  /** Set when the row's door can hold a meeting's own record, so `MEETING_ARTIFACT_TERMS` joins the end of its terms. */
  readonly meetingRecords?: true;
  /**
   * Its index in `GENERIC_SOURCE_CAPABILITIES`, whose order is the planner's tie-break (`src/route/sourcePlan.ts`). A
   * new integration takes the next unused number; a duplicate or an index past the table's end throws at load.
   */
  readonly ordinal: number;
}

/** This integration's row of the browser write-policy register (`WRITE_POLICY_REGISTER`, `src/admit/browserSurface.ts`). */
interface IntegrationBrowserWrite {
  /** Its place in the register, which is the order a refusal names the platforms in. */
  readonly ordinal: number;
  /** The row itself, inline, its one import being type-only. */
  readonly row: RegisteredPlatform;
}

/** This integration's row of the access review (`src/accessReview/levels.ts`). */
interface IntegrationAccessReview {
  /** Its place in the report. The spine prints after every other row, whatever its number. */
  readonly ordinal: number;
  /** `roster-spine` is the one platform every other is judged against, exactly one integration's row. */
  readonly role: "access-level" | "roster-spine";
  /** The row itself, inline, its one import being type-only. */
  readonly spec: AccessPlatformSpec;
}

/** The slug and plain name every manifest carries, how a board row's need for it is judged, and how it is routed to. */
interface IntegrationManifestBase {
  /** Present exactly when the access review reads this integration's people. */
  readonly accessReview?: IntegrationAccessReview;
  /** Present exactly when a browser may write here. An absent row is refused every write, never overlooked. */
  readonly browserWrite?: IntegrationBrowserWrite;
  /**
   * Present exactly when a board row may declare it needs this integration. Absent for GitHub, reached through the
   * existing `gh` login, which stores nothing here, so a `needs=github` hold would hold every GitHub row.
   */
  readonly connection?: IntegrationConnection;
  /** A lowercase slug (`google-admin`), equal to the atlas's own name where it has one, and to its directory. */
  readonly id: string;
  /** The name as the owner would say it — what `ATLAS_NAMES` (`src/automations/purposeNames.ts`) prints. */
  readonly name: string;
  /** Present exactly when `slopweaver <id>` is a noun of this build. An atlas-only integration has none. */
  readonly noun?: IntegrationNoun;
  /** The capability rows a routing judgement reaches this integration through. */
  readonly routing?: readonly IntegrationRoutingRow[];
}

/** `corpus` exactly when `ingest`: either without the other is a compile error rather than a source missing from one list. */
type CorpusContract =
  | {
      readonly corpus: CorpusIntegrationMetadata;
      readonly features: IntegrationFeatures & { readonly ingest: FeatureLoader };
    }
  | {
      readonly corpus?: never;
      readonly features: IntegrationFeatures & { readonly ingest?: never };
    };

/**
 * `sharedRead` marks an integration the SHARED `<provider> read` reader serves (`ProviderReadSource`,
 * `src/live/providerRead.ts`), and requires `read`. A flag beside the features rather than a field of `read`, so a
 * feature stays one loader thunk.
 */
type SharedReadContract =
  | {
      readonly sharedRead: true;
      readonly features: IntegrationFeatures & { readonly read: FeatureLoader };
    }
  | {
      readonly sharedRead?: never;
      readonly features: IntegrationFeatures;
    };

/**
 * One integration's row: its slug, its plain name, the features it has, where it sits among the corpus sources
 * exactly when it has `ingest`, and whether the shared reader serves it.
 */
export type IntegrationManifest = IntegrationManifestBase & CorpusContract & SharedReadContract;
