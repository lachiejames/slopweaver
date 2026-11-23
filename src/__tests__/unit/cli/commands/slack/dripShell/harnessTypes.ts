/*
 * The shapes the as-me drip shell harness is built from: what a case may configure, what every fake records, and
 * what `harness()` hands back. Kept apart from the seam builders so each of them names only the part it reads.
 */
import type { AutonomyLedgerPort } from "../../../../../../autonomy/port.js";
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import type { SlackUpload } from "../../../../../../corpus/slack/writeTransport.js";
import type { Result } from "../../../../../../lib/result.js";
import type { AskedBeforeError } from "../../../../../../outbound/slack/askedBeforeErrors.js";
import type { ChannelAccess } from "../../../../../../outbound/slack/channelJoin.js";
import type { SlackDraftEvent } from "../../../../../../outbound/slack/draftRegister.js";
import type { PriorRead } from "../../../../../../outbound/slack/priorAsk.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../../../../outbound/voice/exactRules.js";
import type { MemoryDoorLedger } from "../../../../../doorLedgerFixture.js";

/** The identity `auth.test` answers for the user token in every release fixture. */
export const RELEASE_SELF = "U0ME";

/** Everything a case may configure on the harness; every field is optional. */
export interface HarnessOptions {
  /** The autonomy ledger a run records into; a fresh in-memory one unless a case wants an outage. */
  autonomy?: AutonomyLedgerPort;
  /** The door ledger every decision is recorded through; a fresh in-memory one unless a case reads it back. */
  door?: MemoryDoorLedger;
  /** Whether the bot-token read proves `D0PROMPT` the owner's own bot DM; it does unless a case says otherwise. */
  ownDm?: SlackWriteDeps["verifiedOwnDm"];
  /** What a release's membership read answers; a member by default, so no fixture joins unasked. */
  channelAccess?: ChannelAccess;
  /** A Slack refusal the join throws, when a case wants one. */
  joinRefusal?: string;
  /** What a release re-reads where it lands; empty means nothing moved since the row's read. */
  releaseConversation?: readonly unknown[];
  /** What a release's re-read of a row's earlier ask answers; unreadable unless a case seeds one. */
  priorRead?: Result<PriorRead, AskedBeforeError>;
  /** The as-me draft register's lines, as a release reads them. */
  draftLog?: readonly string[];
  /** Further environment the door and hatches read, for a hatch a fixture opens by hand. */
  extraEnv?: Readonly<Record<string, string>>;
  stdin?: string;
  resolveMentions?: SlackWriteDeps["resolveMentions"];
  conversationSurface?: SlackWriteDeps["conversationSurface"];
  proveRender?: SlackWriteDeps["proveRender"];
  /** Absent by default, so a fixture written for something else meets the unconfigured refusal, not a fake proof. */
  renderProofChannel?: string;
  userToken?: string | null;
  failOn?: string;
  /** A message Slack itself REFUSES (an `ok: false` platform error), as opposed to `failOn`'s unread failure. */
  refuseOn?: string;
  override?: string;
  exactVoiceRules?: readonly ExactVoiceRule[];
  paragraphSpacing?: boolean;
  /**
   * Live journalled grants written under `home` for this fixture's session. The invocation must pass the SAME
   * `home` as `--home`, because that is where the gate reads them.
   */
  grants?: { readonly hatchIds: readonly string[]; readonly home: string };
  unreadableMedia?: string;
  /** The high-stakes channel list as the profile reads it; none by default, so the gate never fires unasked. */
  highStakes?: ReturnType<SlackWriteDeps["highStakes"]>;
  fleetHistory?: SlackWriteDeps["fleetHistory"];
  wallRun?: SlackWriteDeps["wallRun"];
}

/** The caller's options after every default is applied once, so each seam builder reads the same snapshot. */
export type ResolvedHarnessOptions = {
  readonly [
    K in "failOn" | "grants" | "joinRefusal" | "override" | "refuseOn" | "renderProofChannel" | "unreadableMedia"
  ]: HarnessOptions[K];
} & Required<
  Pick<
    HarnessOptions,
    | "autonomy"
    | "channelAccess"
    | "conversationSurface"
    | "door"
    | "draftLog"
    | "exactVoiceRules"
    | "extraEnv"
    | "fleetHistory"
    | "highStakes"
    | "ownDm"
    | "paragraphSpacing"
    | "priorRead"
    | "proveRender"
    | "releaseConversation"
    | "resolveMentions"
    | "stdin"
    | "userToken"
    | "wallRun"
  >
>;

/** Everything the fakes of one harness record, shared by reference between the seam builders and the caller. */
export interface HarnessRecord {
  readonly mediaReads: string[];
  /** The exact upload objects each `sendDripMessage` was handed, in send order. */
  readonly uploaded: (readonly SlackUpload[])[];
  readonly sends: { payload: SlackDripMessagePayload; threadTs: string | undefined; filenames: readonly string[] }[];
  readonly out: string[];
  readonly painPoints: ExactVoiceRuleFinding[][];
  readonly userHomes: string[];
  /** Every event a release appended to the draft register. */
  readonly draftEvents: SlackDraftEvent[];
  /** Every channel a release joined as the owner, in order. */
  readonly joins: string[];
}

/** What `harness()` hands back: the deps under test, the ledgers they were given, and everything they recorded. */
export interface Harness extends HarnessRecord {
  readonly deps: SlackWriteDeps;
  /** The autonomy ledger the run under test was handed, for reading back what it recorded. */
  readonly autonomy: AutonomyLedgerPort;
  /** The door ledger the run under test was handed, for reading back what it recorded. */
  readonly door: MemoryDoorLedger;
}
