/**
 * The poll RECORD — the only thing that remembers a Slack message is a poll, and what its ballot was.
 *
 * ## Why this store is load-bearing rather than a convenience
 *
 * A poll's metadata (`postPoll`) carries only an opaque `pollId` correlating it with this record, never the
 * ballot. So the mapping *option 3 was "Meetings"* exists in exactly two places: the words visible in the
 * posted message, and this file. Counting reads THIS one, because
 * re-parsing a rendered message means turning presentation into a persistence format.
 *
 * Consequence, stated because it drives the write ORDER below: the record is written BEFORE the send. A poll
 * that went out with no record is a poll whose results can never be computed.
 *
 * ## The ballot is stored as POSTED, not re-derived
 *
 * `emojiNames` is persisted explicitly even though `pollBallot` would recompute it from the option list. That
 * redundancy is deliberate: if the palette in `./pollForm.ts` ever changes, an old poll must still be counted
 * with the emoji it was actually posted with. Re-deriving would silently re-interpret history — the same
 * fingerprint-blindness that makes a stale re-capture indistinguishable from a fresh one.
 *
 * ## Absent, corrupt and unwritable are THREE different answers
 *
 * Every read returns a discriminated union rather than `undefined`. The store this replaced had fail-soft
 * reads that conflated "no such run" with "I could not read it", and a claim that conflated "already
 * claimed" with "the store is unwritable". For a poll those collapse into a genuinely wrong answer: a corrupt record read as absent
 * reports a poll as never posted. The caller decides policy; this file only ever reports what it found.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";

/** One poll, as persisted. `ts` is ABSENT until Slack confirmed the post — see {@link confirmPollRecord}. */
export interface PollRecord {
  readonly schemaVersion: 1;
  /** The pre-send identity: a digest of target ⊕ form, so it exists before any `ts` does. */
  readonly pollId: string;
  readonly channel: string;
  readonly question: string;
  readonly why: string;
  /** Option labels in author order — index `i` pairs with `emojiNames[i]`. */
  readonly options: readonly string[];
  /** The ballot emoji names AS POSTED. Never re-derived; see the module note. */
  readonly emojiNames: readonly string[];
  readonly createdIso: string;
  /** The message timestamp, present ONLY once Slack confirmed the post. */
  readonly ts?: string | undefined;
  /** When the post was confirmed. Present iff {@link PollRecord.ts} is. */
  readonly confirmedIso?: string | undefined;
  /**
   * The ballot emoji slopweaver successfully SEEDED as chips on the message.
   *
   * Recorded rather than assumed, because the tally subtracts one from each seeded option and a wrong list is a
   * wrong number: assuming all of them were seeded over-counts when a seed failed, and assuming none were
   * over-counts every option by one. Absent on a record written before the seeding step ran.
   */
  readonly seededEmoji?: readonly string[] | undefined;
}

/** The outcome of reading one record. `unreadable` covers both corrupt bytes and an I/O failure. */
export type PollRecordRead =
  | { readonly kind: "found"; readonly record: PollRecord }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** The outcome of claiming a record. `exists` and `failed` are deliberately NOT the same answer. */
export type PollClaim =
  { readonly kind: "claimed" } | { readonly kind: "exists" } | { readonly kind: "failed"; readonly reason: string };

/** The outcome of attaching a confirmed `ts`. A failure is reported, never swallowed. */
export type PollConfirm = { readonly kind: "confirmed" } | { readonly kind: "failed"; readonly reason: string };

/** The directory holding every poll record. */
function pollsDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "slack-polls");
}

/** The record file for one poll id (the id is a hex digest, so it is a safe filename). */
function pollPath({ home, pollId }: { home: string; pollId: string }): string {
  return join(pollsDir({ home }), `${pollId}.json`);
}

/** The message-error text off an unknown throw, without `any` and without a bare `?? ""`. */
function reasonOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every string in an unknown array, or nothing when it is not an array of strings. */
function stringArray({ value }: { value: unknown }): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Parse a record's bytes, or report it unreadable.
 *
 * Every required field is checked. A record missing one is `unreadable`, never a partially-trusted object: a
 * poll whose `options` failed to parse would otherwise count votes against an empty ballot and report zeros.
 */
function parsePollRecord({ raw }: { raw: string }): PollRecordRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "unreadable", reason: `not valid JSON: ${reasonOf({ error })}` };
  }
  if (!isRecord(parsed)) {
    return { kind: "unreadable", reason: "not a JSON object" };
  }
  const options = stringArray({ value: parsed["options"] });
  const emojiNames = stringArray({ value: parsed["emojiNames"] });
  const { channel, createdIso, pollId, question, why } = parsed;
  if (
    parsed["schemaVersion"] !== 1 ||
    typeof pollId !== "string" ||
    typeof channel !== "string" ||
    typeof question !== "string" ||
    typeof why !== "string" ||
    typeof createdIso !== "string" ||
    options === undefined ||
    emojiNames === undefined
  ) {
    return { kind: "unreadable", reason: "missing or wrongly-typed required fields" };
  }
  if (options.length !== emojiNames.length) {
    return {
      kind: "unreadable",
      reason: `${String(options.length)} options but ${String(emojiNames.length)} ballot emoji — ballot corrupt`,
    };
  }
  const ts = parsed["ts"];
  const confirmedIso = parsed["confirmedIso"];
  const seededEmoji = stringArray({ value: parsed["seededEmoji"] });
  return {
    kind: "found",
    record: {
      channel,
      createdIso,
      emojiNames,
      options,
      pollId,
      question,
      schemaVersion: 1,
      why,
      ...(typeof confirmedIso === "string" ? { confirmedIso } : {}),
      ...(seededEmoji === undefined ? {} : { seededEmoji }),
      ...(typeof ts === "string" ? { ts } : {}),
    },
  };
}

/** Read one file into a parsed record, distinguishing absent from unreadable off the typed errno. */
function readRecordFile({ path }: { path: string }): PollRecordRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    // ENOENT is the ONLY absence. Anything else (EACCES, EISDIR, EIO) is a store we cannot trust, and
    // reporting it as "no such poll" is how a posted poll gets reported as never posted.
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unreadable", reason: reasonOf({ error }) };
  }
  return parsePollRecord({ raw });
}

/**
 * Claim a poll id exclusively, writing the record BEFORE the send.
 *
 * `O_EXCL` so two concurrent runs cannot claim one id, and so `exists` is a fact rather than a race. A
 * failure to write is reported as `failed` with its reason, distinct from `exists` — the caller needs to tell
 * "already posted" from "the store is broken", because those warrant opposite actions.
 *
 * @param home the state home
 * @param record the record to persist, without a `ts` (there is none yet)
 * @returns whether this caller claimed the id, it already existed, or the write failed
 */
export function claimPollRecord({ home, record }: { home: string; record: PollRecord }): PollClaim {
  try {
    mkdirSync(pollsDir({ home }), { recursive: true });
  } catch (error) {
    return { kind: "failed", reason: `cannot create the poll store: ${reasonOf({ error })}` };
  }
  try {
    writeFileSync(pollPath({ home, pollId: record.pollId }), JSON.stringify(record), { flag: "wx" });
    return { kind: "claimed" };
  } catch (error) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      return { kind: "exists" };
    }
    return { kind: "failed", reason: reasonOf({ error }) };
  }
}

/**
 * Read one poll record by its pre-send id.
 *
 * @param home the state home
 * @param pollId the pre-send poll identity
 * @returns the record, its absence, or why it could not be trusted
 */
export function readPollRecord({ home, pollId }: { home: string; pollId: string }): PollRecordRead {
  return readRecordFile({ path: pollPath({ home, pollId }) });
}

/**
 * Attach the confirmed message timestamp — the write that makes a poll findable by `channel:ts`.
 *
 * Until this lands, the poll exists in Slack but cannot be located by the only locator a human has (the
 * message). So a failure here is returned rather than ignored: the caller must tell the operator that results
 * will not be readable and print the `pollId` needed to recover.
 *
 * @param home the state home
 * @param pollId the pre-send poll identity
 * @param ts the message timestamp Slack returned
 * @param nowIso when the send was confirmed
 * @param seededEmoji the ballot chips that actually landed, so the tally can subtract exactly those
 * @returns whether the confirmation was persisted
 */
export function confirmPollRecord({
  home,
  pollId,
  ts,
  nowIso,
  seededEmoji,
}: {
  home: string;
  pollId: string;
  ts: string;
  nowIso: string;
  /** The chips that actually landed. Omitted leaves whatever the record already held. */
  seededEmoji?: readonly string[] | undefined;
}): PollConfirm {
  const existing = readPollRecord({ home, pollId });
  if (existing.kind !== "found") {
    return { kind: "failed", reason: `cannot confirm poll ${pollId}: record is ${existing.kind}` };
  }
  // STAGED then RENAMED, never written in place. This record is the ONLY copy of the emoji→option ballot
  // (a poll carries no Slack metadata), and by this point Slack has already accepted the poll — so a
  // half-written overwrite would leave a live poll whose options are unrecoverable. `rename` within one
  // directory is atomic, so a crash leaves either the pre-send record or the confirmed one, never a torn file.
  try {
    writeFileAtomic({
      contents: JSON.stringify({
        ...existing.record,
        confirmedIso: nowIso,
        ts,
        ...(seededEmoji === undefined ? {} : { seededEmoji }),
      }),
      path: pollPath({ home, pollId }),
    });
    return { kind: "confirmed" };
  } catch (error) {
    return { kind: "failed", reason: reasonOf({ error }) };
  }
}

/**
 * Rewrite a confirmed poll's question and reason after `slack edit` re-rendered the message in place.
 *
 * Only those two fields move. The ballot — `options`, `emojiNames`, `seededEmoji` — is what every cast vote is
 * bound to, so an edit that changes it is refused before Slack is touched, and this write never carries one.
 * Staged then renamed for the reason {@link confirmPollRecord} is: this record is the only copy of the ballot.
 *
 * @param home the state home
 * @param pollId the poll identity the edited message carries
 * @param question the question the message now asks
 * @param why the reason the message now gives
 * @returns whether the revision was persisted
 */
export function revisePollRecord({
  home,
  pollId,
  question,
  why,
}: {
  home: string;
  pollId: string;
  question: string;
  why: string;
}): PollConfirm {
  const existing = readPollRecord({ home, pollId });
  if (existing.kind !== "found") {
    return { kind: "failed", reason: `cannot revise poll ${pollId}: record is ${existing.kind}` };
  }
  try {
    writeFileAtomic({
      contents: JSON.stringify({ ...existing.record, question, why }),
      path: pollPath({ home, pollId }),
    });
    return { kind: "confirmed" };
  } catch (error) {
    return { kind: "failed", reason: reasonOf({ error }) };
  }
}

/** A poll located by its message, plus any records that could not be read while looking. */
export interface PollLookup {
  readonly record: PollRecord | undefined;
  /** Records passed over because they could not be parsed — surfaced, never silently skipped. */
  readonly unreadable: readonly string[];
}

/**
 * Find the poll posted as a given `channel:ts`.
 *
 * Scans the store rather than keeping a second index, because the store holds one small file per poll and a
 * derived index is another thing that can disagree with the truth. Unreadable records are REPORTED alongside
 * the answer: "no poll matches" and "there are three records I could not parse" are different situations, and
 * conflating them is how a real poll gets reported as unknown.
 *
 * @param home the state home
 * @param channel the channel the poll was posted to
 * @param ts the poll message's timestamp
 * @returns the matching record when there is one, plus the ids of any unreadable records
 */
export function findPollByMessage({ home, channel, ts }: { home: string; channel: string; ts: string }): PollLookup {
  let entries: readonly string[];
  try {
    entries = readdirSync(pollsDir({ home }));
  } catch {
    // An absent store is simply no polls. A store that exists but cannot be listed surfaces on the next
    // claim, which is the write path where it actually matters.
    return { record: undefined, unreadable: [] };
  }
  const unreadable: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const read = readRecordFile({ path: join(pollsDir({ home }), entry) });
    if (read.kind === "unreadable") {
      unreadable.push(entry);
      continue;
    }
    if (read.kind === "found" && read.record.channel === channel && read.record.ts === ts) {
      return { record: read.record, unreadable };
    }
  }
  return { record: undefined, unreadable };
}
