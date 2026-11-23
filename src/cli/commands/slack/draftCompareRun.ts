/**
 * The Codex draft beside a parked as-me original: brief the pass, admit what it returns, and journal the outcome on
 * the row (`../../../outbound/slack/draftComparison.ts`). `slack draft record` runs it once the original has parked;
 * `slack draft compare <id>` runs it again on a row still waiting — a record killed mid-pass, or a pass that found no
 * Codex seat — and never on any other row.
 *
 * Everything it prints goes to stderr, so a `--json` record's stdout stays the one receipt document.
 */
import type { SlackDraftBrief } from "../../../codex/slackDraft.js";
import type { CodexDraftAnswer } from "../../../codex/slackDraftPass.js";
import { logger } from "../../../lib/logger.js";
import { ok, type Result } from "../../../lib/result.js";
import {
  type ComparisonOutcome,
  comparisonRunnable,
  type DraftComposer,
} from "../../../outbound/slack/draftComparison.js";
import { recordedEvidence } from "../../../outbound/slack/draftComparisonEvidence.js";
import type { SlackDraftError } from "../../../outbound/slack/draftErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { type ParkedSlackDraft, type SlackDraftItem, slackDraftById } from "../../../outbound/slack/draftRegister.js";
import { releaseWatermark } from "../../../outbound/slack/releaseFreshness.js";
import type { VoiceRuleBrief } from "../../../outbound/voice/briefStore.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { admitCandidate } from "./draftCandidate.js";
import { authoredQuotesDraft, draftBrief } from "./draftCompareBrief.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/** The two seams a comparison adds to `slack draft`: the sealed Codex pass, and their voice brief. */
export interface DraftComparisonDeps {
  /** One sealed, routed Codex pass over the brief (`../../../codex/slackDraftPass.ts`). */
  readonly codexDraft: (args: { brief: SlackDraftBrief; home: string }) => Promise<CodexDraftAnswer>;
  /** `slack voice-rules`' brief — what a Claude composer is briefed with, so both drafts start equal. */
  readonly loadVoiceBrief: (args: { home: string }) => Result<VoiceRuleBrief>;
}

/** How many of a channel's newest messages a top-level comparison re-reads, as the recording snapshots. */
const TOP_LEVEL_ROWS = 20;

/** A destination that is a person rather than a conversation: nothing to read until it is opened. */
const MEMBER_DESTINATION = /^[UW][A-Z0-9]+$/;

/**
 * Which host composed the original, read off the recording session's own environment. Two hosts leaked into one
 * process is `undetected`, and still compared: only a Codex-composed original has no second opinion to offer.
 *
 * @param env the recording process's environment
 * @returns the composing host
 */
export function draftComposerOf({ env }: { env: Readonly<Record<string, string | undefined>> }): DraftComposer {
  const detection = detectSupervisorSession({ env });
  if (detection.kind !== "active") {
    return "undetected";
  }
  return detection.session.host;
}

/**
 * The comparison `slack draft record` runs once the original has parked: read the row back, and run a pass only when
 * the park left it waiting on one.
 *
 * @param deps the injected world
 * @param id the row just parked
 * @param rows the conversation rows the recording read, raw
 * @param home the state home the register lives under
 * @param token their user token, for the candidate's admission reads
 */
export async function compareRecorded({
  deps,
  home,
  id,
  rows,
  token,
}: {
  deps: SlackDraftDeps;
  home: string;
  id: string;
  rows: readonly unknown[];
  token: string;
}): Promise<void> {
  const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const row = items.find((item) => item.id === id);
  if (row === undefined) {
    // The park landed, so a row that will not read back is a register read failing, never an absent row: say so
    // rather than leaving it `pending` in silence.
    logger.warn({
      msg: `${id} parked but could not be read back, so Codex was not asked; once the register reads, run slopweaver slack draft compare ${id}`,
    });
    return;
  }
  if (!comparisonRunnable({ item: row }) || row.draft.approval !== undefined) {
    return;
  }
  await compareParkedDraft({ deps, draft: row.draft, home, rows, token });
}

/**
 * Run one comparison over a parked original and journal its outcome.
 *
 * @param deps the injected world
 * @param draft the parked original — its words are never shown to the pass
 * @param rows the conversation rows the recording read, raw
 * @param home the state home the register lives under
 * @param token their user token, for the candidate's admission reads
 * @returns the outcome journalled, or `undefined` when the row moved and nothing was journalled
 */
async function compareParkedDraft({
  deps,
  draft,
  rows,
  home,
  token,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  rows: readonly unknown[];
  home: string;
  token: string;
}): Promise<ComparisonOutcome | undefined> {
  logger.info({ msg: `slack draft: asking Codex for its draft beside ${draft.id}…` });
  const outcome = await settledOutcome({ deps, draft, home, rows, token });
  return journalOutcome({ deps, draft, home, outcome });
}

/**
 * The comparison's outcome, a throw included. The original has already parked owing it, so a pass or an admission
 * that throws — a temp directory that will not mint, a live read that rejects — is journalled `unavailable` rather
 * than escaping and leaving the row `pending` with nothing to free it.
 */
async function settledOutcome(args: Parameters<typeof comparisonOutcome>[0]): Promise<ComparisonOutcome> {
  try {
    return await comparisonOutcome(args);
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { reason: `the comparison failed unexpectedly: ${why}`, state: "unavailable" };
  }
}

/**
 * Journal one outcome on a row under the register lock, only while it is still held, unapproved and waiting on one.
 *
 * @returns the outcome journalled, or `undefined` when the row moved or the write failed and nothing was journalled
 */
function journalOutcome({
  deps,
  draft,
  home,
  outcome,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  home: string;
  outcome: ComparisonOutcome;
}): ComparisonOutcome | undefined {
  const unlock = deps.lockRegister({ home });
  if (unlock.isErr()) {
    logger.warn({
      msg: `${unlock.error.message} — the comparison was not recorded; run it again with ${again(draft)}`,
    });
    return undefined;
  }
  try {
    const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
    const row = slackDraftById({ id: draft.id, items, mustBeHeld: true });
    if (row.isErr() || !comparisonRunnable({ item: row.value }) || row.value.draft.approval !== undefined) {
      logger.warn({
        msg: `${draft.id} moved while Codex drafted (approved, sent or dropped), so its draft is not kept`,
      });
      return undefined;
    }
    const appended = deps.appendEvent({
      event: { id: draft.id, kind: "compared", outcome, tsIso: deps.nowIso() },
      home,
    });
    if (appended.isErr()) {
      logger.warn({ msg: `${appended.error.message} — the comparison was not recorded; run ${again(draft)}` });
      return undefined;
    }
  } finally {
    unlock.value();
  }
  logger.info({ msg: outcomeLine({ id: draft.id, outcome }) });
  return outcome;
}

/** The pass and the admission, as one outcome. */
async function comparisonOutcome({
  deps,
  draft,
  home,
  rows,
  token,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  home: string;
  rows: readonly unknown[];
  token: string;
}): Promise<ComparisonOutcome> {
  if (authoredQuotesDraft({ draft })) {
    const quoted =
      "a line its session chose (--why, --act, the re-ask or the destination) quotes the draft, so a pass would see A";
    return { reasons: [quoted], stage: "evidence", state: "refused" };
  }
  const voice = deps.loadVoiceBrief({ home });
  if (voice.isErr()) {
    return { reason: `their voice brief could not be read: ${voice.error.join("; ")}`, state: "unavailable" };
  }
  const brief = draftBrief({ draft, rows, voice: voice.value });
  const answer = await deps.codexDraft({ brief, home });
  if (answer.kind === "unavailable") {
    return { reason: answer.reason, state: "unavailable" };
  }
  const candidate = await admitCandidate({ deps, draft, form: answer.form, home, token });
  if (candidate.isErr()) {
    return { reasons: candidate.error.reasons, stage: candidate.error.stage, state: "refused" };
  }
  const { elapsedMs, requestedModel } = answer;
  return { candidate: candidate.value, elapsedMs, requestedModel, state: "ready" };
}

/** The retry a session runs when a comparison was not recorded. */
function again(draft: Pick<ParkedSlackDraft, "id">): string {
  return `slopweaver slack draft compare ${draft.id}`;
}

/** What a session is told once a comparison is journalled. */
function outcomeLine({ id, outcome }: { id: string; outcome: ComparisonOutcome }): string {
  if (outcome.state === "ready") {
    return `slack draft: Codex's draft sits beside ${id} on the Queue card; they pick one before it sends`;
  }
  if (outcome.state === "refused" && outcome.stage === "evidence") {
    return `slack draft: no Codex draft for ${id} — ${outcome.reasons.join("; ")}. The card shows the original alone.`;
  }
  if (outcome.state === "refused") {
    return `slack draft: Codex's draft for ${id} was refused (${outcome.stage}): ${outcome.reasons.join("; ")}`;
  }
  return `slack draft: no Codex draft for ${id} — ${outcome.reason}. Retry: ${again({ id })}`;
}

/**
 * `slack draft compare <id>` — run the comparison again on a row still waiting for one, over the conversation cut
 * back to what its recording read (`../../../outbound/slack/draftComparisonEvidence.ts`).
 *
 * @param deps the injected world
 * @param id the row
 * @param home the state home the register lives under
 * @returns the exit code: 0 once a pass's outcome is journalled, 3 when the row is not waiting on one or its
 *   conversation was rewritten since (journalled as a final `evidence` refusal, which frees the original), 1 on a
 *   failed read or write
 */
export async function runDraftCompare({
  deps,
  id,
  home,
}: {
  deps: SlackDraftDeps;
  id: string;
  home: string;
}): Promise<number> {
  const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const row = slackDraftById({ id, items, mustBeHeld: false });
  if (row.isErr()) {
    logger.error({ msg: row.error.message });
    return EXIT_ERROR;
  }
  if (!comparisonRunnable({ item: row.value }) || row.value.draft.approval !== undefined) {
    logger.warn({ msg: `${id} is not waiting on a Codex draft (${comparisonState({ item: row.value })})` });
    return EXIT_EXPECTED_EMPTY;
  }
  const { draft } = row.value;
  const token = resolveSlackWriteToken({ actor: "me", botToken: undefined, userToken: deps.userToken({ home }) });
  if (token.isErr()) {
    return unreadable({ deps, draft, home, why: token.error.message });
  }
  const rows = await conversationRows({ deps, draft, token: token.value });
  if (rows.isErr()) {
    return unreadable({ deps, draft, home, why: rows.error.message });
  }
  const evidence = recordedEvidence({ draft, rows: rows.value });
  if (evidence.kind === "moved") {
    // Final, so a pending row is never left owing a draft no retry can produce.
    const refused = { reasons: [evidence.why], stage: "evidence", state: "refused" } as const;
    const journalled = journalOutcome({ deps, draft, home, outcome: refused });
    return journalled === undefined ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
  }
  const outcome = await compareParkedDraft({ deps, draft, home, rows: evidence.rows, token: token.value });
  return outcome === undefined ? EXIT_ERROR : EXIT_OK;
}

/**
 * A retry that could not read the conversation: journalled `unavailable`, so a `pending` row is freed rather than left
 * owing a draft a deleted thread or a lost token can never produce, and it stays retryable, eighth
 * pass).
 */
function unreadable({
  deps,
  draft,
  home,
  why,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  home: string;
  why: string;
}): number {
  logger.error({ msg: why });
  journalOutcome({
    deps,
    draft,
    home,
    outcome: { reason: `the conversation could not be read: ${why}`, state: "unavailable" },
  });
  return EXIT_ERROR;
}

/** What a row's comparison says, for the line telling a session why there is nothing to run. */
function comparisonState({ item }: { item: SlackDraftItem }): string {
  if (item.state !== "held") {
    return item.state;
  }
  if (item.comparison === undefined) {
    return "it was recorded without one";
  }
  return item.comparison.state;
}

/**
 * The conversation a waiting row lands in, read again: a reply's whole thread, a top-level row's channel page ending
 * where its recording's read ended (so a message posted since cannot page one it saw out), and nothing for a
 * row addressed to a person or one whose recording read an empty channel. A row whose watermark does not read is read to now, and the evidence check refuses it.
 */
async function conversationRows({
  deps,
  draft,
  token,
}: {
  deps: SlackDraftDeps;
  draft: ParkedSlackDraft;
  token: string;
}): Promise<Result<readonly unknown[], SlackDraftError>> {
  const { channel, threadTs } = draft;
  if (threadTs !== undefined) {
    return deps.threadReplies({ channel, threadTs, token });
  }
  if (MEMBER_DESTINATION.test(channel)) {
    return ok([]);
  }
  const watermark = releaseWatermark({ draft });
  // A recording that read an empty channel kept a sentinel, never a `ts` Slack takes: what it saw is nothing.
  if (watermark.isOk() && watermark.value.seen?.length === 0) {
    return ok([]);
  }
  const through = watermark.isOk() ? watermark.value.throughTs : undefined;
  const tail = await deps.readConversation({ channel, limit: TOP_LEVEL_ROWS, threadTs: undefined, through, token });
  return tail.map((read) => read.rows);
}
