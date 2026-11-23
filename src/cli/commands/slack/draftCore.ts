/**
 * `slack draft` — every DECISION, pure. The shell that reads Slack and writes the register is
 * `./draftRun.ts`.
 *
 * ## Why a recorder is a verb at all
 *
 * The as-me lane composes and sends in ONE act, which is right for a message the owner asked for and wrong
 * for one the fleet wrote on its own initiative. The owner reviews such a message as a draft in the local
 * console, so the composition runs every check it can, parks the result where the console can render it, and
 * stops.
 *
 * ## Release is deliberately NOT a verb of this noun
 *
 * None of the sub-commands posts. A parked draft is released through the send lane —
 * `slack post --as me --draft <id>` — because that is where the door, the render proof and the duplicate
 * gate already live. Putting a release here would mean either a second copy of that machinery or a second
 * module holding a send edge, and the whole point of the split in `./prepareDrip.ts` is that the recorder's
 * import graph reaches neither.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { DraftVariant } from "../../../outbound/slack/draftComparison.js";
import { type ReceiptsDeclaration, receiptsDeclarationOf } from "../../../outbound/slack/draftReceipts.js";
import type { DraftHoldReason, ParkedDraftAct, ParkedDraftKind } from "../../../outbound/slack/draftRegister.js";
import { type FindingImpact, findingImpactOf } from "../../../outbound/slack/findingProof.js";
import type { AskedBeforeDeclaration } from "../../../outbound/slack/priorAsk.js";
import type { ReviewerContext } from "../../../outbound/slack/reviewAskShape.js";
import { parseFlagTail } from "../../optionParsers.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import { parseMedia } from "./coreArgs.js";
import { askedBeforeOf } from "./draftAskedBeforeArgs.js";
import { followupOfProblems, recordChoicesOf, rowProblems } from "./draftCardFields.js";
import { parseDraftJudgement, parseDraftPick } from "./draftJudgementArgs.js";
import {
  approvalOptionsOf,
  approvalProblems,
  machineIdProblems,
  RECORD_CARD_PROSE,
  requiredRecordProblems,
  supersededIdsOf,
  supersedesProblems,
  threadProblems,
} from "./draftRecordProblems.js";
import { DRAFT_REVISION_FLAGS, type DraftRevisionOptions, parseDraftRevision } from "./draftReviseArgs.js";

/** The sub-commands, in the order the usage block lists them. */
export const SLACK_DRAFT_SUBCOMMANDS = [
  "record",
  "list",
  "show",
  "context",
  "approve",
  "pick",
  "compare",
  "revise",
  "restore",
  "hold",
  "drop",
  "corrections",
] as const;

/**
 * One sub-command of `slack draft`.
 *
 * @internal exported for {@link SLACK_DRAFT_SUBCOMMANDS} to derive from; nothing outside this file names it.
 */
export type SlackDraftSubcommand = (typeof SLACK_DRAFT_SUBCOMMANDS)[number];

/** What every sub-command shares. */
export interface DraftShared {
  readonly json: boolean;
  readonly home: string;
}

/** `slack draft record`, parsed. */
export interface DraftRecordOptions extends DraftShared {
  readonly mode: "record";
  /**
   * WHOSE name the row goes out under — `--as bot|me`. Absent is `me`, because a record command printed without
   * the flag means the owner. `bot` composes a `--as bot` card and is how a finding shared at the top level of a
   * channel is recorded.
   */
  readonly actor: "me" | "bot";
  /**
   * What the row is — `--kind finding|message`. Absent leaves it undeclared, where the row's why is read instead
   * (`../../../outbound/slack/findingIdentity.ts`); a bot `finding` form is a finding whatever this says.
   */
  readonly kind?: ParkedDraftKind | undefined;
  /**
   * What the message does — `--act reply|bump|review-ask`, the Queue card's badge. Absent leaves the card with no
   * badge; display only, never in the digest.
   */
  readonly act?: ParkedDraftAct | undefined;
  /**
   * The board row that raised the draft — `--row <slug>`. Shape-checked here; `./draftRun.ts` refuses a slug no
   * handover doc holds. The Queue card shows that row's tags; display only, never in the digest.
   */
  readonly row?: string | undefined;
  /**
   * The shared finding this bump follows up — `--followup-of <sd-id>`. Shape-checked here; `./draftPark.ts` refuses,
   * under the register lock, a finding never released, a row outside its thread or not a bump, and a finding whose
   * one follow-up card is spent (`../../../outbound/slack/sharedFindings.ts`). Display and audit only, never in the
   * digest.
   */
  readonly followupOf?: string | undefined;
  readonly channel: string;
  /** The `--form` value as typed: the JSON itself, or `-` for stdin. */
  readonly formSource: string;
  readonly why: string;
  /**
   * The thread root this draft replies under — `--thread-ts`. Present, the row is a `thread` row that only
   * `slack reply --draft` releases; absent, a top-level post in the channel.
   */
  readonly threadTs?: string | undefined;
  /**
   * The files to attach, in the caller's order — `--media`'s own comma syntax. Admitted and stored at
   * recording, so the release sends the exact bytes the owner's approval names; empty when the flag is absent.
   */
  readonly media: readonly string[];
  /**
   * The HELD rows this one re-cuts — `--supersedes <sd-id>[,<sd-id>…]`, empty when the flag is absent. Recording
   * drops each in the same act, with a note naming this row, so every older cut is spent and no queue card, seat or
   * release can send it afterwards. A reply into a thread that already holds one must name every held reply there
   * (`../../../outbound/slack/draftSameThread.ts`), which is how one thread's replies merge into one card.
   */
  readonly supersedes: readonly string[];
  /**
   * Whether the person a DM review ask goes to was in the conversation the work came from — `--reviewer
   * new|in-thread`, or `not-an-ask` where the wording reads as one and is not. Owed only by a DM the gate reads as
   * a review ask; absent on one, the recording is refused (`../../../outbound/slack/reviewAskShape.ts`).
   */
  readonly reviewer?: ReviewerContext | undefined;
  /**
   * Whether this message's question was asked before — `--asked-before none|<permalink>`, with `--changed`,
   * `--changed-media` and `--not-answered` (`./draftAskedBeforeArgs.ts`). REQUIRED in the type, so an in-process
   * recorder chooses rather than inheriting a default; `undeclared` refuses a message that asks
   * (`../../../outbound/slack/priorAsk.ts`).
   */
  readonly askedBefore: AskedBeforeDeclaration;
  /**
   * Why a card with no link and no file needs none — `--self-evident <why>` — or what was tried for the receipt it
   * lacks — `--tried <what and why it failed>`. REQUIRED in the type, like {@link askedBefore}; `undeclared` refuses a
   * card that carries no receipt (`../../../outbound/slack/draftReceipts.ts`).
   */
  readonly receipts: ReceiptsDeclaration;
  /**
   * The impact in people a finding declares — `--impact "<count> <who> <what happened>"`, whose count the message's
   * first line must carry. Owed by every row that raises a finding (`../../../outbound/slack/findingProof.ts`); absent
   * when the flag is not given.
   */
  readonly impact?: FindingImpact | undefined;
  /**
   * Where the owner already said yes to these words' content — `--approved <anchor>`, resolved to their own words before
   * anything is read (`./draftApprovalResolve.ts`). The row is then SENT by the next chair pass, never held for a
   * second yes (`../../../outbound/slack/draftApproval.ts`).
   */
  readonly approved?: string | undefined;
  /**
   * What changed since the owner approved the row this one re-cuts — `--meaning-changed <what>`: the words now mean something
   * else, or the thread moved materially. The new row waits for the owner's yes again.
   */
  readonly meaningChanged?: string | undefined;
}

/** `slack draft list`, parsed. */
export interface DraftListOptions extends DraftShared {
  readonly mode: "list";
  /** Whether released and dropped rows are shown as well as held ones. */
  readonly all: boolean;
}

/** `slack draft show`, parsed. */
export interface DraftShowOptions extends DraftShared {
  readonly mode: "show";
  readonly id: string;
}

/** `slack draft context`, parsed: the conversation a draft lands in, read live. */
export interface DraftContextOptions extends DraftShared {
  readonly mode: "context";
  readonly id: string;
}

/** `slack draft drop`, parsed. */
export interface DraftDropOptions extends DraftShared {
  readonly mode: "drop";
  readonly id: string;
  readonly note: string;
}

/**
 * `slack draft approve`, parsed: the owner's yes, at an anchor, bound to a row already held — no re-cut
 * (`./draftJudgementRun.ts`).
 */
export interface DraftApproveOptions extends DraftShared {
  readonly mode: "approve";
  readonly id: string;
  readonly anchor: string;
  /** On a comparison card, which draft the owner's yes is to — picked and approved under one lock. */
  readonly variant?: DraftVariant | undefined;
}

/** `slack draft pick`, parsed: which draft the owner chose on a comparison card, and where, when they said it. */
export interface DraftPickOptions extends DraftShared {
  readonly mode: "pick";
  readonly id: string;
  readonly variant: DraftVariant;
  readonly anchor?: string | undefined;
}

/** `slack draft compare`, parsed: run the Codex draft again on a row still waiting for one. */
interface DraftCompareOptions extends DraftShared {
  readonly mode: "compare";
  readonly id: string;
}

/** `slack draft hold`, parsed: why a row carrying the owner's words is not being sent now. */
export interface DraftHoldOptions extends DraftShared {
  readonly mode: "hold";
  readonly id: string;
  readonly reason: DraftHoldReason;
  readonly why: string;
}

/** `slack draft corrections`, parsed: every correction the owner made to a draft, by kind. */
interface DraftCorrectionsOptions extends DraftShared {
  readonly mode: "corrections";
}

/** One parsed `slack draft` invocation. */
export type SlackDraftOptions =
  | DraftRecordOptions
  | DraftListOptions
  | DraftShowOptions
  | DraftContextOptions
  | DraftApproveOptions
  | DraftPickOptions
  | DraftCompareOptions
  | DraftRevisionOptions
  | DraftHoldOptions
  | DraftDropOptions
  | DraftCorrectionsOptions;

/**
 * Every flag any sub-command accepts. One spec, because a per-verb copy is how usage drifts from behaviour.
 *
 * Exported so `helpTruth` compares the usage block against the SPEC, the same way it does for the other
 * workspace-shape verbs whose sub-commands share one spec.
 */
export const SLACK_DRAFT_FLAG_SPEC = {
  boolean: ["all", "json"],
  value: [
    "as",
    "channel",
    "form",
    "why",
    "note",
    "home",
    "id",
    "kind",
    "act",
    "row",
    "followup-of",
    "media",
    "thread-ts",
    "supersedes",
    "reviewer",
    "asked-before",
    "changed",
    "changed-media",
    "not-answered",
    "approved",
    "meaning-changed",
    "self-evident",
    "tried",
    "impact",
    "anchor",
    "reason",
    "variant",
    ...DRAFT_REVISION_FLAGS,
  ],
} as const;

/** Whether the first argument names a sub-command. */
function isDraftSubcommand(value: string | undefined): value is SlackDraftSubcommand {
  return SLACK_DRAFT_SUBCOMMANDS.some((candidate) => candidate === value);
}

/**
 * The id a `show` or `drop` names, taken from `--id` or from the bare word after the sub-command.
 *
 * Both spellings are accepted because both are what somebody types: the console's own copy button hands out
 * `slopweaver slack draft show sd-1a2b3c4d`, and a script composing a command line has a flag to reach for.
 */
function idOf({ rest, values }: { rest: readonly string[]; values: Readonly<Record<string, string>> }): string {
  const flagged = values["id"];
  if (flagged !== undefined) {
    return flagged;
  }
  const bare = rest[0];
  if (bare === undefined) {
    return "";
  }
  return bare;
}

/**
 * Parse a `slack draft` invocation.
 *
 * The id is read off the RAW tail rather than through the flag parser, which is why the tail handed to
 * {@link parseFlagTail} drops it: that parser refuses a stray positional, and refusing the id somebody just
 * copied out of the console would be a worse verb than accepting it.
 *
 * @param rest the argv tail, starting at the sub-command
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or every reason it was refused
 */
export function parseSlackDraftArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): SlackParsed<SlackDraftOptions> {
  const sub = rest[0];
  if (!isDraftSubcommand(sub)) {
    return err(SlackArgumentErrors.draftSubcommandUnknown({ got: sub, known: SLACK_DRAFT_SUBCOMMANDS }));
  }
  const tail = rest.slice(1);
  const flagTail = tail.filter((word) => !isBareId({ tail, word }));
  const parsed = parseFlagTail({ rest: flagTail, spec: SLACK_DRAFT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const { home = defaultHome } = values;
  const shared: DraftShared = {
    home,
    json: flags.has("json"),
  };
  if (sub === "record") {
    return parseDraftRecord({ shared, values });
  }
  if (sub === "list") {
    return ok({ all: flags.has("all"), mode: "list", ...shared });
  }
  if (sub === "corrections") {
    return ok({ mode: "corrections", ...shared });
  }
  const id = idOf({ rest: tail, values });
  if (id === "") {
    return err(SlackArgumentErrors.draftIdMissing({ subcommand: sub }));
  }
  if (sub === "show" || sub === "context" || sub === "compare") {
    return ok({ id, mode: sub, ...shared });
  }
  if (sub === "pick") {
    return parseDraftPick({ id, shared, values });
  }
  if (sub === "revise" || sub === "restore") {
    return parseDraftRevision({ id, shared, sub, values });
  }
  if (sub === "approve" || sub === "hold") {
    return parseDraftJudgement({ id, shared, sub, values });
  }
  const note = values["note"];
  if (note === undefined || note.trim() === "") {
    return err(SlackArgumentErrors.draftNoteMissing());
  }
  return ok({ id, mode: "drop", note, ...shared });
}

/**
 * Whether one word of the tail is the bare id — the FIRST word, and only when it is not a flag or a flag's
 * own value. Anything else keeps {@link parseFlagTail}'s stray-positional refusal intact.
 */
function isBareId({ tail, word }: { tail: readonly string[]; word: string }): boolean {
  return tail[0] === word && !word.startsWith("--");
}

/**
 * Build the record options, or every reason they were refused.
 *
 * @param shared the flags every sub-command carries
 * @param values the parsed string flags
 * @returns the parsed record invocation, or its refusals
 */
function parseDraftRecord({
  shared,
  values,
}: {
  shared: DraftShared;
  values: Readonly<Record<string, string>>;
}): SlackParsed<SlackDraftOptions> {
  const channel = values["channel"];
  const formSource = values["form"];
  const why = values["why"];
  const errors = requiredRecordProblems({ channel, formSource, why });
  const threadTs = values["thread-ts"];
  errors.push(...threadProblems({ threadTs, why }));
  const supersedes = supersededIdsOf({ value: values["supersedes"] });
  errors.push(...supersedesProblems({ given: values["supersedes"] !== undefined, supersedes }));
  const row = values["row"];
  errors.push(...rowProblems({ row }));
  const followupOf = values["followup-of"];
  errors.push(...followupOfProblems({ followupOf }));
  const choices = recordChoicesOf({ values });
  if (choices.isErr()) {
    errors.push(...choices.error);
  }
  errors.push(...approvalProblems({ values }), ...machineIdProblems({ ...RECORD_CARD_PROSE, values }));
  const askedBefore = askedBeforeOf({ values });
  if (askedBefore.isErr()) {
    errors.push(...askedBefore.error);
  }
  const proof = proofDeclarationsOf({ values });
  if (proof.isErr()) {
    errors.push(...proof.error);
  }
  const incomplete = channel === undefined || formSource === undefined || why === undefined;
  const refused = choices.isErr() || askedBefore.isErr() || proof.isErr();
  if (incomplete || refused || errors.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: errors }));
  }
  const { act, actor, kind, reviewer } = choices.value;
  const { impact, receipts } = proof.value;
  return ok({
    actor,
    askedBefore: askedBefore.value,
    channel,
    formSource,
    media: parseMedia({ value: values["media"] }),
    mode: "record",
    receipts,
    supersedes,
    why,
    ...(kind === undefined ? {} : { kind }),
    ...(act === undefined ? {} : { act }),
    ...(row === undefined ? {} : { row }),
    ...(followupOf === undefined ? {} : { followupOf }),
    ...(impact === undefined ? {} : { impact }),
    ...(threadTs === undefined ? {} : { threadTs }),
    ...(reviewer === undefined ? {} : { reviewer }),
    ...approvalOptionsOf({ values }),
    ...shared,
  });
}

/**
 * The proof a recording declares: its receipts and its finding impact, or every reason either was refused.
 *
 * @param values the parsed string flags
 * @returns both declarations, or the refusals
 */
function proofDeclarationsOf({
  values,
}: {
  values: Readonly<Record<string, string>>;
}): Result<{ impact: FindingImpact | undefined; receipts: ReceiptsDeclaration }> {
  const receipts = receiptsDeclarationOf({ selfEvident: values["self-evident"], tried: values["tried"] });
  const impact = findingImpactOf({ value: values["impact"] });
  if (receipts.isOk() && impact.isOk()) {
    return ok({ impact: impact.value, receipts: receipts.value });
  }
  const refusals: string[] = [];
  if (receipts.isErr()) {
    refusals.push(...receipts.error);
  }
  if (impact.isErr()) {
    refusals.push(...impact.error);
  }
  return err(refusals);
}
