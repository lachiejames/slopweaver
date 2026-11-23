/**
 * The shared shape every lifecycle verb file is written against — `./lifecycleRunEdit.ts` and
 * `./lifecycleRunDelete.ts`. Split into its
 * own leaf so those files (and `./lifecycleRunGuards.ts`) can share `LifecycleDeps` without any of them
 * importing `./lifecycleRun.ts` itself — that would make the thin orchestrator a dependency of the verbs it
 * orchestrates, which is backwards and would cycle back through it.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { PainPointLane } from "../../../admit/painPoint.js";
import type { SlackWriteApi } from "../../../corpus/slack/writeApi.js";
import type { SlackUpload, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import type { Result } from "../../../lib/result.js";
import type { CardNames } from "../../../live/turn/cardNames.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import type { TaggedAccount } from "../../../outbound/slack/departedTags.js";
import type { SlackDraftError } from "../../../outbound/slack/draftErrors.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import type { SlackCardChrome } from "../../../outbound/slack/types.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import type { ProfileReadError } from "../../../profileStore.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import type { HighStakesDeps } from "./highStakesGate.js";
import type { PollPingDeps } from "./pollPings.js";
import type { VerifyOwnDm } from "./verifiedOwnDm.js";
import type { DripConfig } from "./wiring.js";

/** The register write a confirmed `slack delete` makes: the ids it journalled, or why it could not. */
export type JournalDraftDeletion = (args: {
  home: string;
  channel: string;
  ts: string;
  nowIso: string;
}) => Result<readonly string[], SlackDraftError>;

/** Everything the lifecycle shell needs from the world, injected so the flow runs against plain fakes. */
export interface LifecycleDeps {
  readonly readStdin: () => Promise<string>;
  readonly readMedia: (args: { path: string }) => Promise<SlackUpload>;
  readonly botToken: (args: { home: string }) => string | undefined;
  /** The USER token — `edit --as me` / `delete --as me` send with this, never the bot token. */
  readonly userToken: (args: { home: string }) => string | undefined;
  readonly cardChrome: (args: { home: string }) => SlackCardChrome;
  /** Who each person id a checklist edit tags is — `cardNameLookup` live, so the frame reads names, not ids. */
  readonly cardNames: (args: { home: string }) => (args: { ids: readonly string[] }) => CardNames;
  /** The event type a standalone progress message carries, so `delete` can still take a stranded one down. */
  readonly standaloneProgressEventType: (args: { home: string }) => string;
  /** The poll's `metadata.event_type`, so a delete recognises a live poll as this bot's own. */
  readonly pollEventType: (args: { home: string }) => string;
  /** A poll edit's `person` pings to Slack ids — the SAME exact resolver `slack poll` posts them with. */
  readonly resolvePollPeople: PollPingDeps["resolvePeople"];
  /** The destination when proven their own bot DM — the one conversation an edit's opening is not judged in. */
  readonly verifiedOwnDm: VerifyOwnDm;
  /** The operator's as-me drip bounds and exact voice rules — `edit --as me` reuses `post --as me`'s. */
  readonly dripConfig: (args: { home: string }) => Result<DripConfig, ProfileReadError>;
  /** Record exact-rule matches as bounded future-turn guidance; this observation never decides the edit. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /** The operator's exact voice rules alone — the BOT card and answer edits are judged against them at the door. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** The environment `edit --as me`'s `voice-rules` grant check reads its session and state home from. */
  readonly doorEnv: () => Readonly<Record<string, string | undefined>>;
  /** The door ledger every lifecycle mutation's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /** What this write's bare `#<n>`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  /** Resolve the people and groups a payload names, over one read of the store's identity roster. */
  readonly resolveMentions: (args: {
    people: readonly string[];
    groups: readonly string[];
    home: string;
  }) => Promise<Result<MentionResolution, IdentityRosterError>>;
  /** Whether one account an `edit --as me` tags is still active, read live (`./departedTagCheck.ts`). */
  readonly taggedAccount: (args: { home: string; token: string; user: string }) => Promise<TaggedAccount>;
  /** The install's high-stakes channels, so an edit of a top-level message in one is judged as a post there. */
  readonly highStakes: HighStakesDeps["highStakes"];
  /**
   * Journal a `slack delete` on every draft row whose release landed at that message, so a deleted finding is owed no
   * follow-up (`../../../outbound/slack/draftDeletion.ts`).
   */
  readonly journalDraftDeletion: JournalDraftDeletion;
  readonly makeTransport: (args: { token: string; home: string }) => SlackWriteTransport;
  readonly makeApi: (args: { token: string; home: string }) => SlackWriteApi;
  readonly nowMs: () => number;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
}
