/**
 * WHAT A DEAD TURN LEFT BEHIND, and what a fresh session is told about it — the pure half of turn
 * checkpointing. The effectful half (write a draft, read the review directory, read each verdict file) is
 * `./checkpointStore.ts`.
 *
 * ## The measured failure
 *
 * Ask `C0SYN000008/1789046247.801199`. The worker spent 49 minutes
 * and 61 tool calls, ran TWO serial reviewer rounds, and then its session died mid-response with
 * `API Error: Connection lost mid-response` — one line after it had written that round 2 had found a real
 * error in its cross-service claim and that the live probe gave a much better answer. Zero public output.
 * The thread froze on a card reading "61 tool calls so far". A later session re-investigated from nothing
 * and only answered ninety minutes after the death.
 *
 * Every piece of that turn's work product was in one of two states, and neither was recoverable:
 *
 * - **The draft** was at `answerPath` — an absolute path the worker chose. The measured one was a session
 *   scratchpad, and by the time anyone looked it was gone. `./freeze/plan.ts`'s `insideHome` exists for the
 *   same class seen from the freeze end.
 * - **The verdicts** were on disk the whole time and still are — `reviews/<key>/verdict.json` plus one
 *   `verdict-superseded-<reviewer>-<spawnedAt>.json` per displaced round, exactly as `./reviewStore.ts`
 *   writes them. Nothing outside a review round has ever read one back, and `turn freeze` copied only the
 *   last of them, so a replay fixture of a multi-round turn lost every round but one.
 *
 * So the two halves need different fixes and this module carries both. The draft half is a genuinely
 * missing WRITE (`./checkpointStore.ts`'s `writeDraftCheckpoint`, called at validate time). The verdict half
 * is a missing READ: the bytes are already produced into the record set, and what was absent was an
 * enumeration, an ordering and a freeze that carried them.
 *
 * ## Why rounds are ordered by the reviewer's spawn instant
 *
 * A verdict file carries no timestamp of its own — `reviewVerdictFile.ts`'s schema is `answerDigest`,
 * `claims`, `outcome`, the two session labels — so the file cannot say when it was written. What the record
 * set DOES carry is the instant each reviewer was spawned: in `record.json`'s `spawnedAt` for the round
 * still standing, and encoded into the filename by `supersededVerdictName` for every round before it. That
 * is a fact on disk rather than an mtime, so it survives a copy into a fixture, and it is what
 * {@link checkpointRounds} orders by.
 */

import type { ReviewVerdict } from "../../admit/reviewVerdict.js";
import { isRecord } from "../../lib/parsers.js";

/** The prefix `./reviewStore.ts`'s `supersededVerdictName` puts on an archived verdict. */
const SUPERSEDED_PREFIX = "verdict-superseded-";

/**
 * The basename of the verdict file belonging to the round that is still standing.
 *
 * @internal
 */
export const CURRENT_VERDICT_FILE = "verdict.json";

/** The basename of a checkpoint directory's append-only draft log. */
export const CHECKPOINT_LOG_FILE = "log.jsonl";

/**
 * One review round a turn actually spent, as the record set can prove it — never as anyone claims it.
 *
 * `reviewer` and `spawnedAt` are read back out of the archive filename for a displaced round, so they are
 * the same two tokens `supersededVerdictName` put there and nothing else.
 */
export interface CheckpointRound {
  /** The verdict file's basename, inside the ask's review directory. */
  readonly file: string;
  /** The outgoing reviewer's workspace id, or whatever short token named it. */
  readonly reviewer: string;
  /** The ISO instant that reviewer was spawned — this round's position in the ordering. */
  readonly spawnedAt: string;
  /** Whether this is the round still standing, rather than one a later round displaced. */
  readonly standing: boolean;
}

/**
 * One draft a worker validated, as its own log row records it.
 *
 * ## Why these exact field names
 *
 * Every one of them is a key `./freeze/redact.ts`'s KEEP_KEYS allowlist already keeps, and that is a
 * requirement rather than a coincidence. A frozen fixture is redacted key by key, so a log written with
 * `atIso`/`digest`/`file` comes back as three `[REDACTED]` strings — the rows survive, the drafts beside
 * them survive, and nothing can join the two. `recordedAtIso` is what a turn marker calls the same instant
 * and `answerDigest` is what a verdict calls the same digest, so naming them alike is what the record set
 * already does everywhere else. `draftFile` is the one key added for this, and it carries a digest-derived
 * basename that can hold nothing private.
 */
export interface DraftCheckpoint {
  /** When `turn resume --answer` accepted these bytes. */
  readonly recordedAtIso: string;
  /** The dispatch this draft was written under, as `dispatchIdOf` encodes the ask. */
  readonly dispatchId: string;
  /**
   * The GENERATION token — the dispatch record's own `leaseExpiresAt` at the moment this draft validated.
   *
   * `dispatchId` cannot carry this: it is a pure encoding of the ask identity (`./dispatch.ts`'s
   * `dispatchIdOf`), so two dispatch generations of the same re-dispatched ask share one. The lease is the
   * binding `./turnMarkerStore.ts` already uses for exactly this question, and it is what lets a session
   * tell "I wrote this" from "somebody before me wrote this".
   */
  readonly leaseExpiresAt: string;
  /** The `sha256:<hex>` digest of the draft's bytes, which is also its filename. */
  readonly answerDigest: string;
  /** The draft file's basename, inside the ask's checkpoint directory. */
  readonly draftFile: string;
}

/**
 * Everything one ask's record set can still prove about a turn that did not finish — the drafts it
 * validated and the rounds it was reviewed through, each with its verdict already read.
 */
export interface CheckpointSet {
  /** Every validated draft, oldest first. Empty when the worker never got one past validate. */
  readonly drafts: readonly DraftCheckpoint[];
  /** Every review round, oldest first, each paired with the verdict read off disk. */
  readonly rounds: readonly CheckpointRoundVerdict[];
}

/** One round and the verdict it produced, or the reason that verdict could not be read. */
export interface CheckpointRoundVerdict {
  readonly round: CheckpointRound;
  /** The verdict, or `undefined` when the file is absent or will not parse. */
  readonly verdict: ReviewVerdict | undefined;
}

/**
 * Read a reviewer and a spawn instant back out of an archived verdict's filename — the exact inverse of
 * `./reviewStore.ts`'s `supersededVerdictName`.
 *
 * That function reduces both tokens with a `fileSafe` pass that collapses every run of non-alphanumeric
 * characters to a single `-`, so the instant comes back as `2026-09-10T13-34-39-172Z` rather than as an ISO
 * string. It is restored here, because an ordering key that does not parse as a date is one a reader cannot
 * compare with `record.json`'s own `spawnedAt`. A name that does not carry a restorable instant answers
 * `undefined` rather than guessing: an unorderable round is dropped from the history, never silently placed.
 *
 * @param name the archive file's basename
 * @returns the round it names, or `undefined` when the name is not one that function wrote
 */
export function parseSupersededVerdictName({ name }: { name: string }): CheckpointRound | undefined {
  if (!name.startsWith(SUPERSEDED_PREFIX) || !name.endsWith(".json")) {
    return undefined;
  }
  const middle = name.slice(SUPERSEDED_PREFIX.length, -".json".length);
  const instantStart = middle.search(/\d{4}-\d{2}-\d{2}T/u);
  if (instantStart <= 0) {
    return undefined;
  }
  const spawnedAt = restoreInstant({ token: middle.slice(instantStart) });
  if (spawnedAt === undefined) {
    return undefined;
  }
  return { file: name, reviewer: middle.slice(0, instantStart - 1), spawnedAt, standing: false };
}

/**
 * Put the punctuation back into an instant `fileSafe` flattened — `2026-09-10T13-34-39-172Z` becomes
 * the same instant with colons and a dot.
 *
 * @param token the flattened tail of an archive filename
 * @returns the ISO instant, or `undefined` when the token is not that shape
 */
function restoreInstant({ token }: { token: string }): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u.exec(token);
  if (match === null) {
    return undefined;
  }
  const [, date, hour, minute, second, millis] = match;
  const restored = `${String(date)}T${String(hour)}:${String(minute)}:${String(second)}.${String(millis)}Z`;
  return Number.isNaN(Date.parse(restored)) ? undefined : restored;
}

/**
 * Every review round one ask's review directory can prove, oldest first.
 *
 * Pure over the directory's entry NAMES plus the standing round's own two facts, so the whole ordering is
 * assertable with no filesystem anywhere near it. A standing round is included only when both of its facts
 * are supplied: `verdict.json` carries no reviewer and no instant of its own, so without `record.json` it
 * cannot be placed in the ordering, and a round placed by guesswork is worse than one left out.
 *
 * @param entries the review directory's entry names, in any order
 * @param standing the standing round's reviewer and spawn instant, from `record.json`, when there is one
 * @returns the rounds, oldest first
 */
export function checkpointRounds({
  entries,
  standing,
}: {
  entries: readonly string[];
  standing: { readonly reviewer: string; readonly spawnedAt: string } | undefined;
}): readonly CheckpointRound[] {
  const archived = entries
    .map((name) => parseSupersededVerdictName({ name }))
    .filter((round): round is CheckpointRound => round !== undefined);
  const rounds = [...archived];
  if (standing !== undefined && entries.includes(CURRENT_VERDICT_FILE)) {
    rounds.push({
      file: CURRENT_VERDICT_FILE,
      reviewer: standing.reviewer,
      spawnedAt: standing.spawnedAt,
      standing: true,
    });
  }
  return rounds.toSorted((left, right) => Date.parse(left.spawnedAt) - Date.parse(right.spawnedAt));
}

/**
 * Whether a checkpoint set holds anything a fresh session could resume from.
 *
 * @param set the ask's checkpoint set
 * @returns whether there is any draft or any round to inherit
 */
export function hasCheckpoint({ set }: { set: CheckpointSet }): boolean {
  return set.drafts.length > 0 || set.rounds.length > 0;
}

/**
 * The part of a checkpoint set that an EARLIER dispatch generation produced — what this turn inherited, as
 * opposed to what it has since done itself.
 *
 * The card counts this, never the whole set, and the difference is the difference between a true sentence
 * and a false one. A session that inherits two rounds and then runs a third of its own would otherwise show
 * "3 review rounds recovered from the last session", which claims work the last session never did.
 *
 * Each half is bounded by a durable fact already in the record set:
 *
 * - A DRAFT carries the dispatch lease it was written under, so it is inherited exactly when that lease is
 *   not the running one. No clock read, no screen scrape, and nothing that ages into a lie.
 * - A ROUND carries no such token — `record.json` names one reviewer and a displaced round is identified
 *   only by its archive filename — so it is bounded by the drafts instead. The worker contract validates an
 *   answer before it can review one (`cli/commands/turn/resume.ts`'s numbered steps), so no round of THIS
 *   generation can predate this generation's first draft. With no draft of this generation at all, no round
 *   of it can exist either, and every round on disk is inherited.
 *
 * @param currentLease the running dispatch record's own `leaseExpiresAt`
 * @param set the ask's checkpoint set
 * @returns the inherited half, each list still oldest first
 * @internal
 */
export function inheritedCheckpoint({
  currentLease,
  set,
}: {
  currentLease: string;
  set: CheckpointSet;
}): CheckpointSet {
  const boundary = set.drafts.find((entry) => entry.leaseExpiresAt === currentLease)?.recordedAtIso;
  const rounds =
    boundary === undefined
      ? set.rounds
      : set.rounds.filter((entry) => Date.parse(entry.round.spawnedAt) < Date.parse(boundary));
  return { drafts: set.drafts.filter((entry) => entry.leaseExpiresAt !== currentLease), rounds };
}

/**
 * Whether the turn running NOW is picking up work a previous dispatch generation of the same ask left
 * behind — the one fact the card's resuming state is decided from.
 *
 * @param currentLease the running dispatch record's own `leaseExpiresAt`
 * @param set the ask's checkpoint set
 * @returns whether anything in it was produced by an earlier generation
 */
export function resumingFromCheckpoint({ currentLease, set }: { currentLease: string; set: CheckpointSet }): boolean {
  return hasCheckpoint({ set: inheritedCheckpoint({ currentLease, set }) });
}

/**
 * The one sentence a card shows in place of a frozen `now:` line, when a turn is being picked up over work
 * a dead session already did.
 *
 * Counts only — never a claim's text. The card is a public surface in a channel of colleagues (doctrine rule
 * 7), and what a reader there needs is that the turn is not starting over, not what a reviewer found. And it
 * counts only what was INHERITED, per {@link inheritedCheckpoint}.
 *
 * @param currentLease the running dispatch record's own `leaseExpiresAt`
 * @param set the ask's checkpoint set
 * @returns the detail line, or `undefined` when there is nothing to resume from
 */
export function resumingFromCheckpointDetail({
  currentLease,
  set,
}: {
  currentLease: string;
  set: CheckpointSet;
}): string | undefined {
  const inherited = inheritedCheckpoint({ currentLease, set });
  if (!hasCheckpoint({ set: inherited })) {
    return undefined;
  }
  const parts: string[] = [];
  if (inherited.drafts.length > 0) {
    parts.push("a draft answer");
  }
  if (inherited.rounds.length > 0) {
    parts.push(`${String(inherited.rounds.length)} review round${inherited.rounds.length === 1 ? "" : "s"}`);
  }
  return `resuming from checkpoint — ${parts.join(" and ")} recovered from the last session`;
}

/**
 * The `RESUMING FROM CHECKPOINT` block a fresh session reads before it investigates anything.
 *
 * Its whole purpose is that round 3 does not re-litigate rounds 1 and 2. So it names the draft file to start
 * from and, per round, what that reviewer SETTLED and what it left standing — the two things a re-run would
 * otherwise have to rediscover by paying for the rounds again.
 *
 * A high-impact unsupported claim is called out by name rather than folded into a count: it is the one thing
 * a reviewer found that a re-run must not carry forward, and the measured turn died one line after finding
 * exactly that.
 *
 * @param checkpointDir the ask's checkpoint directory, so the draft path printed is absolute and readable
 * @param reviewDir the ask's review directory, for the same reason
 * @param set the ask's checkpoint set
 * @returns the lines to print, in order; empty when there is nothing to resume from
 */
export function checkpointResumeLines({
  checkpointDir,
  reviewDir,
  set,
}: {
  checkpointDir: string;
  reviewDir: string;
  set: CheckpointSet;
}): readonly string[] {
  if (!hasCheckpoint({ set })) {
    return [];
  }
  const lines = [
    "RESUMING FROM CHECKPOINT: a previous session worked this ask and did not finish. What it left is below,",
    "and it is yours to use — verify it rather than re-derive it, and do not re-litigate a round that already",
    "settled a claim. You still own this ask to its terminal outcome.",
  ];
  const latest = set.drafts[set.drafts.length - 1];
  if (latest === undefined) {
    lines.push("  draft: none — no answer of that session's ever passed validate");
  } else {
    lines.push(
      `  draft: ${checkpointDir}/${latest.draftFile} — validated ${latest.recordedAtIso}, ` +
        `digest ${latest.answerDigest}`,
    );
    lines.push("    Start from those bytes. They are a previous session's draft, not an approved answer.");
  }
  lines.push(...roundLines({ reviewDir, set }));
  return lines;
}

/**
 * The per-round half of {@link checkpointResumeLines}.
 *
 * @param reviewDir the ask's review directory
 * @param set the ask's checkpoint set
 * @returns the round lines, in order
 */
function roundLines({ reviewDir, set }: { reviewDir: string; set: CheckpointSet }): readonly string[] {
  if (set.rounds.length === 0) {
    return ["  rounds: none — no reviewer ever returned a verdict on this ask"];
  }
  const lines = [`  rounds: ${String(set.rounds.length)} already returned a verdict`];
  set.rounds.forEach((entry, index) => {
    const number = index + 1;
    lines.push(`    round ${String(number)} (${entry.round.spawnedAt}): ${reviewDir}/${entry.round.file}`);
    lines.push(...verdictLines({ indent: "      ", verdict: entry.verdict }));
  });
  return lines;
}

/**
 * What one round's verdict settled and what it broke, as lines under that round.
 *
 * @param indent the leading whitespace every line carries
 * @param verdict the verdict read off disk, or `undefined` when it could not be read
 * @returns the lines, in order
 */
function verdictLines({ indent, verdict }: { indent: string; verdict: ReviewVerdict | undefined }): readonly string[] {
  if (verdict === undefined) {
    return [`${indent}unreadable — the verdict file is absent or does not parse; treat this round as unspent`];
  }
  const supported = verdict.claims.filter((claim) => claim.support === "supported");
  const broken = verdict.claims.filter((claim) => claim.support !== "supported");
  const lines = [
    `${indent}outcome ${verdict.outcome}, bound to answer digest ${verdict.answerDigest}`,
    `${indent}settled: ${String(supported.length)} claim(s) this reviewer verified — do not re-verify them`,
  ];
  if (broken.length === 0) {
    return [...lines, `${indent}left standing: nothing`];
  }
  lines.push(`${indent}left standing, and a re-run must NOT carry these forward as written:`);
  for (const claim of broken) {
    lines.push(`${indent}  [${claim.impact} impact, ${claim.support}] ${claim.text}`);
  }
  return lines;
}

/**
 * Which of a checkpoint log's rows fall inside a freeze's window, and which draft files they name.
 *
 * `turn freeze --not-after <iso>` windows every other record-set file by an instant the file itself declares
 * (`cli/commands/turn/freeze.ts`'s `declaredInstant`). A draft's own bytes declare none — it is the answer
 * document, and answer documents carry no write time — so the LOG is the only thing that can date one, and
 * the two have to be trimmed together or the fixture holds drafts its log does not name.
 *
 * A row that will not parse, or that declares no readable instant, is KEPT: the same conservative answer the
 * freeze gives every undated file, because quietly shrinking a fixture on a row shape this cut was never
 * about is the worse failure.
 *
 * @param logText the checkpoint log's raw JSONL
 * @param notAfterIso the instant the window closes at, or `undefined` for no cut
 * @returns the lines to freeze and the draft basenames they name
 */
export function draftRowsWithin({ logText, notAfterIso }: { logText: string; notAfterIso: string | undefined }): {
  readonly keptLines: readonly string[];
  readonly keptFiles: readonly string[];
} {
  const closes = notAfterIso === undefined ? Number.NaN : Date.parse(notAfterIso);
  const keptLines: string[] = [];
  const keptFiles: string[] = [];
  for (const line of logText.split("\n").filter((raw) => raw.trim().length > 0)) {
    const row = parseDraftRow({ line });
    if (row !== undefined && !Number.isNaN(closes) && Date.parse(row.recordedAtIso) > closes) {
      continue;
    }
    keptLines.push(line);
    if (row !== undefined) {
      keptFiles.push(row.draftFile);
    }
  }
  return { keptFiles, keptLines };
}

/**
 * One checkpoint-log row, validated. Never throws — an append-only log has malformed lines as an ordinary
 * state, not an error.
 *
 * @param line the raw JSONL line
 * @returns the draft it records, or `undefined` when the line is not one
 */
export function parseDraftRow({ line }: { line: string }): DraftCheckpoint | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const { answerDigest, dispatchId, draftFile, leaseExpiresAt, recordedAtIso } = value;
  if (
    typeof answerDigest !== "string" ||
    typeof dispatchId !== "string" ||
    typeof draftFile !== "string" ||
    typeof leaseExpiresAt !== "string" ||
    typeof recordedAtIso !== "string"
  ) {
    return undefined;
  }
  return { answerDigest, dispatchId, draftFile, leaseExpiresAt, recordedAtIso };
}
