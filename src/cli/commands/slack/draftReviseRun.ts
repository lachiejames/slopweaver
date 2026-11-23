/**
 * `slack draft revise <id> --text <words|->` and `slack draft restore <id> --version <n>` — a held as-me row's words
 * rewritten, or an earlier version put back, with every version kept (`../../../outbound/slack/draftRevision.ts`).
 * The console voice reaches both through `site/app/api/talk/draft/route.ts` while they look at the card; a session may
 * run them too. Neither sends.
 *
 * A rewrite is admitted exactly as a Codex candidate is (`./draftCandidate.ts`): their voice rules refuse outright, then
 * the same preparation and gates over the row's own destination and placement, plus the PR-lead check a recording
 * makes. Three things a recording would decide are FIXED instead, because the steer is body only:
 *
 * - **who it tags**: a rewrite may drop a tag, never add one — a new person reached is a new audience, which is a
 *   recording's call (`slack draft record --supersedes`), not an edit's;
 * - **where it goes, as whom, under which thread, with which files and prior-ask proof**: none is in the event, and
 *   the digest is recomputed over the row's own, so a release re-prepares the new words against the same binding;
 * - **its receipts**: a link in the new words or a file on the row is `attached`; otherwise the row's own declaration
 *   stands, and a rewrite that drops the only link the row brought as its receipt is refused.
 *
 * The admission reads Slack (the conversation's surface, their identity), so it runs before the register lock; the lock
 * is then taken only to re-read the row, confirm nothing moved, append and read back (`./draftRegisterLock.ts`).
 */
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { DraftWords } from "../../../outbound/slack/draftComparison.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { prLedRefusalsFor } from "../../../outbound/slack/draftPrLead.js";
import { receiptLinks } from "../../../outbound/slack/draftReceipts.js";
import { parkedDraftDigest, type SlackDraftItem, slackDraftEventLine } from "../../../outbound/slack/draftRegister.js";
import { type DraftRevisedEvent, draftVersions, revisionRefusal } from "../../../outbound/slack/draftRevision.js";
import { type DraftRevisionError, DraftRevisionErrors } from "../../../outbound/slack/draftRevisionErrors.js";
import { draftEditableText, revisedFormJson } from "../../../outbound/slack/draftRevisionText.js";
import type { ParkedDraftReceipts } from "../../../outbound/slack/receiptsLine.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { STDIN_SENTINEL } from "./coreTypes.js";
import { admitCandidate } from "./draftCandidate.js";
import { heldRow } from "./draftJudgementAppend.js";
import { draftMediaEvidence } from "./draftMediaEvidence.js";
import { revisionProofRefusal } from "./draftRecordProof.js";
import { underRegisterLock } from "./draftRegisterLock.js";
import type { DraftRestoreOptions, DraftReviseOptions, DraftRevisionVoice } from "./draftReviseArgs.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/** Why a revision was not made: the exit it ends on, and the lines that say why. */
interface RevisionRefusal {
  readonly code: number;
  readonly lines: readonly string[];
}

/**
 * Run `revise` or `restore`.
 *
 * @param deps the injected world: Slack reads for the admission, and the register
 * @param options the parsed invocation
 * @returns the process exit code
 */
export async function runDraftRevision({
  deps,
  options,
}: {
  deps: SlackDraftDeps;
  options: DraftReviseOptions | DraftRestoreOptions;
}): Promise<number> {
  const { home, id } = options;
  const row = heldRow({ deps, home, id });
  if (row.kind === "exit") {
    return row.code;
  }
  const item = row.item;
  const refusal = revisionRefusal({ item });
  if (refusal !== undefined) {
    return refused({ code: EXIT_USAGE, lines: [refusal] });
  }
  const words =
    options.mode === "restore"
      ? restoredWords({ item, version: options.version })
      : await rewrittenWords({ deps, item, options });
  if (words.isErr()) {
    return refused(words.error);
  }
  const media = draftMediaEvidence({ home, media: item.draft.media });
  const unproved = revisionProofRefusal({ item, media, words: words.value });
  if (unproved.length > 0) {
    return refused({ code: EXIT_USAGE, lines: unproved });
  }
  const version = draftVersions({ item }).length + 1;
  const restoredFrom = options.mode === "restore" ? { restoredFrom: options.version } : {};
  const event: DraftRevisedEvent = {
    id,
    kind: "revised",
    tsIso: deps.nowIso(),
    version,
    words: words.value,
    ...voiceOf({ options }),
    ...restoredFrom,
  };
  if (!revisionLineReads({ event })) {
    const why = `${id}'s words are a shape a revision cannot carry, so nothing was recorded — re-record it with`;
    return refused({ code: EXIT_USAGE, lines: [`${why} slack draft record --supersedes ${id}`] });
  }
  const code = underRegisterLock({
    deps,
    home,
    run: () => appendRevision({ deps, digest: item.draft.digest, event, home }),
  });
  if (code !== EXIT_OK) {
    return code;
  }
  reportRevision({ deps, event, json: options.json });
  return EXIT_OK;
}

/** Say what the revision recorded: the new version's digest and editable text for the console, else one line. */
function reportRevision({
  deps,
  event,
  json,
}: {
  deps: SlackDraftDeps;
  event: DraftRevisedEvent;
  json: boolean;
}): void {
  const { id, version, words } = event;
  if (json) {
    const text = draftEditableText({ form: words.form });
    deps.out(JSON.stringify({ digest: words.digest, id, text: text.isOk() ? text.value : undefined, version }));
    return;
  }
  deps.out(
    `${id} now reads as v${String(version)}; every earlier version is kept. It still waits for their yes to send.`,
  );
}

/**
 * Whether the register's own reader would read this revision's line back. A version parked in a shape a revision line
 * cannot carry (a plain payload, say) would append a line the register then refuses, hiding the row, so a restore of
 * one is refused before anything is written.
 *
 * @param event the revision about to be appended
 * @returns true when its line reads back as one event
 */
export function revisionLineReads({ event }: { event: DraftRevisedEvent }): boolean {
  return parseSlackDraftLog({ lines: [slackDraftEventLine({ event })] }).events.length === 1;
}

/** Log a refusal's lines and answer its exit. */
function refused({ code, lines }: RevisionRefusal): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return code;
}

/** their words, the voice's reading and the anchor, as the event records them. */
function voiceOf({ options }: { options: DraftRevisionVoice }): DraftRevisionVoice {
  return {
    ...(options.heard === undefined ? {} : { heard: options.heard }),
    ...(options.reading === undefined ? {} : { reading: options.reading }),
    ...(options.anchor === undefined ? {} : { anchor: options.anchor }),
  };
}

/** An earlier version's words, or why that version cannot be put back. */
function restoredWords({
  item,
  version,
}: {
  item: SlackDraftItem;
  version: number;
}): Result<DraftWords, RevisionRefusal> {
  const versions = draftVersions({ item });
  const found = versions.find((candidate) => candidate.number === version);
  if (found === undefined) {
    const have = `v1-v${String(versions.length)}`;
    return err({ code: EXIT_USAGE, lines: [`${item.id} has no v${String(version)} to put back; it has ${have}`] });
  }
  if (found.words.digest === item.draft.digest) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: [`${item.id} already reads as v${String(version)}`] });
  }
  return ok(found.words);
}

/** The rewritten words, admitted and bound, or why they were refused. */
async function rewrittenWords({
  deps,
  item,
  options,
}: {
  deps: SlackDraftDeps;
  item: SlackDraftItem;
  options: DraftReviseOptions;
}): Promise<Result<DraftWords, RevisionRefusal>> {
  const { draft } = item;
  const text = options.textSource === STDIN_SENTINEL ? await deps.readStdin() : options.textSource;
  const form = revisedFormJson({ form: draft.form, text });
  if (form.isErr()) {
    return err({ code: EXIT_USAGE, lines: [form.error.message] });
  }
  const token = resolveSlackWriteToken({
    actor: "me",
    botToken: undefined,
    userToken: deps.userToken({ home: options.home }),
  });
  if (token.isErr()) {
    return err({ code: EXIT_ERROR, lines: [token.error.message] });
  }
  const admitted = await admitCandidate({ deps, draft, form: form.value, home: options.home, token: token.value });
  if (admitted.isErr()) {
    return err({
      code: EXIT_USAGE,
      lines: [`the rewrite was refused (${admitted.error.stage}):`, ...admitted.error.reasons],
    });
  }
  const { advisory, mentions, payload } = admitted.value;
  const verifiedOwnDm = await deps.verifiedOwnDm({ channel: draft.channel, home: options.home });
  const problems = [
    ...prLedRefusalsFor({ channel: draft.channel, payload, verifiedOwnDm }),
    ...audienceRefusals({ draft, mentions, payload }),
  ];
  const files = draft.media === undefined ? 0 : draft.media.length;
  const receipts = revisedReceipts({ files, original: draft.receipts, payload });
  if (receipts.isErr()) {
    problems.push(receipts.error.message);
  }
  if (problems.length > 0 || receipts.isErr()) {
    return err({ code: EXIT_USAGE, lines: problems });
  }
  const { authorId, channel, groupDm, media, priorAsk, threadTs } = draft;
  const bound = { authorId, channel, groupDm, media, mentions, payload, priorAsk, threadTs };
  const digest = parkedDraftDigest({ draft: bound });
  if (digest === draft.digest) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: [`the rewrite says exactly what ${item.id} already says`] });
  }
  const kept = receipts.value === undefined ? {} : { receipts: receipts.value };
  return ok({ advisory, digest, form: admitted.value.form, mentions, payload, ...kept });
}

/** Each person, group or room the rewrite reaches more often than the parked words: body only, so each is refused. */
function audienceRefusals({
  draft,
  mentions,
  payload,
}: {
  draft: SlackDraftItem["draft"];
  mentions: DraftWords["mentions"];
  payload: unknown;
}): readonly string[] {
  return addedReach({ original: draft.payload, revised: payload }).map((reach) => {
    const tagged = mentions.find((mention) => reach === `${mention.kind}:${mention.target}`);
    const label = tagged === undefined ? reach : tagged.key;
    return (
      `the rewrite reaches ${label} more often than the parked draft does: an edit may drop a tag or an @here, ` +
      "never add or repeat one — re-record to reach someone new"
    );
  });
}

/**
 * Each person tag, group tag and broadcast (`@here`, `@channel`) rewritten words carry MORE TIMES than the parked
 * words. Each one reaches someone, so a new one is a new audience, a recording's call and never an edit's; it is
 * counted rather than set-compared because a drip posts each message on its own, so a repeat pings again.
 *
 * @param original the parked message's payload
 * @param revised the rewritten message's payload
 * @returns each grown reach as `@here`, `@channel`, `person:<id>` or `group:<id>`, sorted, empty when none grew
 */
export function addedReach({ original, revised }: { original: unknown; revised: unknown }): readonly string[] {
  const before = reachOf({ node: original });
  const after = reachOf({ node: revised });
  const count = ({ list, key }: { list: readonly string[]; key: string }): number =>
    list.filter((item) => item === key).length;
  return [...new Set(after)].filter((key) => count({ list: after, key }) > count({ list: before, key })).toSorted();
}

/** Every tag and broadcast under a payload node, one entry per occurrence, walking every array and field. */
function reachOf({ node }: { node: unknown }): readonly string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: unknown) => reachOf({ node: child }));
  }
  if (!isRecord(node)) {
    return [];
  }
  return [...ownReach({ node }), ...Object.values(node).flatMap((child) => reachOf({ node: child }))];
}

/** The reach one rich-text element is, when it is a tag or a broadcast. */
function ownReach({ node }: { node: Record<string, unknown> }): readonly string[] {
  if (node["type"] === "broadcast") {
    return [`@${String(node["range"])}`];
  }
  if (node["type"] === "user") {
    return [`person:${String(node["user_id"])}`];
  }
  if (node["type"] === "usergroup") {
    return [`group:${String(node["usergroup_id"])}`];
  }
  return [];
}

/**
 * The receipts rewritten words carry: `attached` when they hold a link or the row a file, else the row's own
 * declaration — refused when that was a link the rewrite dropped.
 *
 * @param files how many files the row carries
 * @param original the row's receipts, absent on a bump or a row recorded before them
 * @param payload the rewritten message
 * @returns the receipts, or the refusal
 */
export function revisedReceipts({
  files,
  original,
  payload,
}: {
  files: number;
  original: ParkedDraftReceipts | undefined;
  payload: unknown;
}): Result<ParkedDraftReceipts | undefined, DraftRevisionError> {
  const links = receiptLinks({ payload });
  const tried = original?.kind === "tried" || original?.kind === "attached" ? original.tried : undefined;
  if (links.length > 0 || files > 0) {
    return ok({ kind: "attached", links, media: files, ...(tried === undefined ? {} : { tried }) });
  }
  if (original?.kind === "attached") {
    return err(DraftRevisionErrors.receiptDropped());
  }
  return ok(original);
}

/**
 * Append the revision under the lock: the row re-read, refused if its words moved since the admission, then read back.
 *
 * @returns the exit code
 */
function appendRevision({
  deps,
  digest,
  event,
  home,
}: {
  deps: SlackDraftDeps;
  digest: string;
  event: DraftRevisedEvent;
  home: string;
}): number {
  const row = heldRow({ deps, home, id: event.id });
  if (row.kind === "exit") {
    return row.code;
  }
  const refusal = revisionRefusal({ item: row.item });
  const moved = row.item.draft.digest !== digest || draftVersions({ item: row.item }).length + 1 !== event.version;
  if (refusal !== undefined) {
    logger.error({ msg: `${refusal} — nothing was recorded.` });
    return EXIT_ERROR;
  }
  if (moved) {
    logger.error({ msg: `${event.id} changed while the rewrite was checked; read it again — nothing was recorded.` });
    return EXIT_ERROR;
  }
  const appended = deps.appendEvent({ event, home });
  if (appended.isErr()) {
    logger.error({ msg: `${appended.error.message} — nothing was recorded; the row is as it was.` });
    return EXIT_ERROR;
  }
  const after = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const latest = after.find((item) => item.id === event.id)?.versions?.at(-1);
  if (latest?.number !== event.version || latest.atIso !== event.tsIso) {
    logger.error({
      msg: `${event.id} moved before the revision landed, so the register does not read it. Read it again.`,
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}
