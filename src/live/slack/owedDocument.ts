/**
 * The `slopweaver slack owed` document — followed Slack threads whose last word is somebody else's, as a
 * strict, persisted contract a later briefing reads rather than re-deriving.
 *
 * ## What a row is, and what it is not
 *
 * A row is a thread the owner SPOKE in inside the reader's window whose last word belongs to a person who is not
 * the owner. The selection is `sessionStart/slackLeg.ts`'s {@link slackOwedThreads} — the same rule `session-start`
 * ranks — so the standing read and the session list cannot disagree about which threads qualify.
 *
 * Every row carries provider facts and one pure classification, never a ranking: `audience` is binary
 * (`addressed` — a DM or a message naming the owner; `ambient` — a channel message naming nobody), and
 * `asksQuestion` is a separate flag, because "aimed at the owner" and "somebody is demonstrably waiting" are two
 * claims and collapsing them made a DM saying "thanks" read as somebody blocked on the owner. The flag is
 * `directnessOf`'s `asked` rung, so it also covers a question naming nobody under a post of the owner's own — an
 * `ambient` row that asks the owner something.
 *
 * ## An unavailable read never resembles an all-clear
 *
 * `status` is required. A read that could not see — no owner id declared, a corpus file unreadable — is
 * `unavailable` with its reason first in `coverage.residue`, and the text rendering says so above
 * everything else. A complete read with zero threads is the only shape that means "nothing owed here".
 *
 * ## It reads, and it never drafts or sends
 *
 * Nothing here composes a reply or reaches Slack. A row with `asksQuestion` is the worklist of the seated
 * `owed-reply` session (`skills/automation/reference/owed-reply.md`), which parks one reply as the owner on their
 * Queue — never an act of this module or its verb.
 *
 * Pure: no clock, no filesystem. `nowIso` is supplied; persistence is `./owedStore.ts`.
 */

import { z } from "zod";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import type { SlackThread } from "../../sessionStart/slackLeg.js";
import { addressesOwner, directnessOf, slackOwedThreads } from "../../sessionStart/slackLeg.js";

/** The document's own schema version. A reader refuses any other. */
const SLACK_OWED_SCHEMA_VERSION = 1;

/** One owed thread, as persisted. */
const slackOwedThreadSchema = z.strictObject({
  /** `${channelId}:${threadTs}` — the same id `session-start` gives the row. */
  nativeId: z.string().min(1),
  /** The permalink of the LAST message, so one click lands on what the owner has not answered. */
  permalink: z.string().min(1),
  channelId: z.string().min(1),
  channelName: z.string().optional(),
  threadTs: z.string().min(1),
  lastAuthorName: z.string().min(1),
  lastWordAtIso: z.iso.datetime(),
  lastText: z.string(),
  /** When the OWNER'S latest message in the thread landed. */
  ownerLastWordAtIso: z.iso.datetime(),
  audience: z.enum(["addressed", "ambient"]),
  asksQuestion: z.boolean(),
});

/** The whole persisted document. */
const slackOwedDocumentSchema = z.strictObject({
  schemaVersion: z.literal(SLACK_OWED_SCHEMA_VERSION),
  producer: z.literal("slack owed"),
  observedAtIso: z.iso.datetime(),
  status: z.enum(["complete", "incomplete", "unavailable"]),
  coverage: z.strictObject({
    kind: z.literal("bounded"),
    windowDays: z.number().int().positive(),
    sinceIso: z.iso.datetime(),
    residue: z.array(z.string().min(1)).min(1),
  }),
  counts: z.strictObject({
    threadsSpokenIn: z.number().int().nonnegative(),
    movedWithoutOwner: z.number().int().nonnegative(),
    owedToHumans: z.number().int().nonnegative(),
    nonHumanLastWords: z.number().int().nonnegative(),
    mentionOnlyOutstanding: z.number().int().nonnegative(),
  }),
  threads: z.array(slackOwedThreadSchema),
});

/** One owed thread in the persisted document. */
type SlackOwedThreadDocument = z.infer<typeof slackOwedThreadSchema>;

/** The persisted `slack owed` document — the contract a later briefing validates stored bytes against. */
export type SlackOwedDocument = z.infer<typeof slackOwedDocumentSchema>;

/**
 * What the document is built from: the fields of the corpus reader's own result this module needs, and the
 * window it read over. A contract of its own so `src/live/` never imports the CLI shell's type.
 */
export interface SlackOwedReadInput {
  /** Whether the read could see what it set out to — `incomplete` when it lost lines in a thread it follows. */
  readonly status: "complete" | "incomplete" | "unavailable";
  /** Every thread that moved without the owner, BEFORE the non-human filter. */
  readonly movementThreads: readonly SlackThread[];
  /** How many threads the owner spoke in inside the window. */
  readonly threadsSpokenIn: number;
  /** How many of those moved on without the owner, before the non-human filter. */
  readonly movedWithoutOwner: number;
  /** How many threads tagging the owner they have not spoken in since — `session-start`'s mention rows. */
  readonly taggedWithoutOwner: number;
  /** What the read could not see, in its own words — the unavailable reason when there is one. */
  readonly couldNotSee: readonly string[];
  /** How many days back the reader looked. */
  readonly windowDays: number;
}

/**
 * The instant the window opened: `nowIso` less `windowDays` whole days.
 *
 * @param nowIso the run's own instant
 * @param windowDays how many days back the reader looked
 * @returns the window's start as ISO 8601
 */
function sinceOf({ nowIso, windowDays }: { nowIso: string; windowDays: number }): string {
  return new Date(Date.parse(nowIso) - windowDays * 86_400_000).toISOString();
}

/**
 * One reader thread as a persisted row.
 *
 * @param thread a thread `slackOwedThreads` kept
 * @returns the row
 */
function threadDocumentOf({ thread }: { thread: SlackThread }): SlackOwedThreadDocument {
  let audience: SlackOwedThreadDocument["audience"] = "ambient";
  if (addressesOwner({ thread })) {
    audience = "addressed";
  }
  return {
    asksQuestion: directnessOf({ thread }) === "asked",
    audience,
    channelId: thread.channelId,
    lastAuthorName: thread.lastAuthorName,
    lastText: thread.lastText,
    lastWordAtIso: thread.lastIso,
    nativeId: `${thread.channelId}:${thread.threadTs}`,
    ownerLastWordAtIso: thread.ownerLastIso,
    permalink: thread.permalink,
    threadTs: thread.threadTs,
    ...(thread.channelName === undefined ? {} : { channelName: thread.channelName }),
  };
}

/**
 * Newest last word first, then `nativeId` ascending, so two runs over the same corpus print the same order.
 *
 * @param a one row
 * @param b another row
 * @returns the comparator's sign
 */
function byNewestLastWord({ a, b }: { a: SlackOwedThreadDocument; b: SlackOwedThreadDocument }): number {
  if (a.lastWordAtIso !== b.lastWordAtIso) {
    return a.lastWordAtIso > b.lastWordAtIso ? -1 : 1;
  }
  if (a.nativeId === b.nativeId) {
    return 0;
  }
  return a.nativeId < b.nativeId ? -1 : 1;
}

/**
 * Build the document one read produced.
 *
 * The residue is DATA, carried on every document including a zero-row one: what the corpus copy is, which
 * threads qualify, the DM blind spot, the mention rows left to `session-start`, and how many threads a
 * non-human spoke last in.
 *
 * @param read the corpus reader's result, adapted to this module's own contract
 * @param nowIso the run's own instant, which is both `observedAtIso` and the window's end
 * @returns the document, `unavailable` with zero threads whenever the read could not see, and `incomplete`
 *   whenever a thread a person spoke last in could not be listed
 */
export function slackOwedDocument({ read, nowIso }: { read: SlackOwedReadInput; nowIso: string }): SlackOwedDocument {
  const owed = slackOwedThreads({ threads: read.movementThreads });
  const nonHuman = read.movementThreads.filter((thread) => !thread.lastAuthorIsHuman).length;
  const readable = read.status !== "unavailable";
  // A thread a PERSON spoke last in that still made no row — a reply with no permalink, say — is a thread this
  // document cannot list, so it cannot call itself complete either.
  const unlisted = read.movementThreads.filter((thread) => thread.lastAuthorIsHuman).length - owed.length;
  let status = read.status;
  if (status === "complete" && unlisted > 0) {
    status = "incomplete";
  }
  const residue = [
    ...(unlisted > 0
      ? [
          `${String(unlisted)} thread(s) where a person spoke last could not be listed (a field such as the permalink is missing), so one may be owed and not shown`,
        ]
      : []),
    ...read.couldNotSee,
    `only threads you spoke in during the last ${String(read.windowDays)} days qualify`,
    "a record with no author at all — a file share, a huddle, a canvas — is read as nobody's word, so a reply posted that way is not seen",
    "a direct message you never answered is invisible here: the reader reaches a thread only through a message of yours",
    `${String(read.taggedWithoutOwner)} thread(s) that tagged you and you have not spoken in are not listed here — \`slopweaver slack tagged\` lists every tag`,
    `${String(nonHuman)} thread(s) whose last word is a bot, an app or Slackbot are excluded`,
  ];
  return {
    counts: {
      mentionOnlyOutstanding: read.taggedWithoutOwner,
      movedWithoutOwner: read.movedWithoutOwner,
      nonHumanLastWords: nonHuman,
      owedToHumans: owed.length,
      threadsSpokenIn: read.threadsSpokenIn,
    },
    coverage: {
      kind: "bounded",
      residue,
      sinceIso: sinceOf({ nowIso, windowDays: read.windowDays }),
      windowDays: read.windowDays,
    },
    observedAtIso: nowIso,
    producer: "slack owed",
    schemaVersion: SLACK_OWED_SCHEMA_VERSION,
    status,
    threads: readable
      ? owed.map((thread) => threadDocumentOf({ thread })).toSorted((a, b) => byNewestLastWord({ a, b }))
      : [],
  };
}

/** The pronoun spelling of `counts.movedWithoutOwner`, which documents already on disk carry. */
const MOVED_PRONOUN_KEY = "movedWithoutHim";

/**
 * A document with its count spelled `movedWithoutOwner`, whichever of the two spellings it was stored under. A
 * document declaring both keeps both, so the strict schema refuses it rather than this choosing one.
 *
 * @param value the parsed bytes
 * @returns the value with the count under the owner-neutral key, or the value unchanged
 */
function withOwnerNeutralCount({ value }: { value: unknown }): unknown {
  if (!isRecord(value) || !isRecord(value["counts"])) {
    return value;
  }
  const { counts } = value;
  if (!(MOVED_PRONOUN_KEY in counts) || "movedWithoutOwner" in counts) {
    return value;
  }
  const { [MOVED_PRONOUN_KEY]: moved, ...rest } = counts;
  return { ...value, counts: { ...rest, movedWithoutOwner: moved } };
}

/**
 * Validate stored or received bytes, already parsed, against the strict document schema. The moved count reads
 * under either key a writer has used, `movedWithoutOwner` or its pronoun spelling.
 *
 * @param value anything claiming to be a `slack owed` document
 * @returns the typed document, or one sentence per schema issue
 */
export function parseSlackOwedDocument({ value }: { value: unknown }): Result<SlackOwedDocument> {
  const parsed = slackOwedDocumentSchema.safeParse(withOwnerNeutralCount({ value }));
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/**
 * The room a row names: `a direct message` for a DM, `#name` for a named channel, the id otherwise.
 *
 * @param row the row to name the room of
 * @returns the room label
 */
function roomLabel({ row }: { row: SlackOwedThreadDocument }): string {
  if (row.channelId.startsWith("D")) {
    return "a direct message";
  }
  const named = row.channelName;
  if (named === undefined || named.length === 0) {
    return row.channelId;
  }
  return named.startsWith("#") ? named : `#${named}`;
}

/**
 * The human rendering: a header, one three-line block per row, then the residue — always, zero rows or not.
 *
 * @param document the document to render
 * @returns the lines to print, in order
 */
export function renderSlackOwedText({ document }: { document: SlackOwedDocument }): readonly string[] {
  const lines: string[] = [];
  if (document.status === "unavailable") {
    lines.push("slack owed: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)");
  } else if (document.status === "incomplete") {
    lines.push(
      `slack owed: INCOMPLETE — ${String(document.threads.length)} thread(s) listed from what could be read, and a ` +
        "reply may be missing, so this is NOT an all-clear (reason under residue)",
    );
  } else {
    lines.push(
      `slack owed: ${String(document.threads.length)} thread(s) you spoke in where a person has the last word ` +
        `(${String(document.counts.threadsSpokenIn)} spoken in since ${document.coverage.sinceIso})`,
    );
  }
  for (const row of document.threads) {
    const audience = row.audience === "addressed" ? "ADDRESSED" : "AMBIENT";
    const asks = row.asksQuestion ? " · asks a question" : "";
    lines.push(
      `${audience}${asks} · ${roomLabel({ row })} · ${row.lastAuthorName} spoke last ${row.lastWordAtIso}`,
      `  you last spoke ${row.ownerLastWordAtIso}`,
      `  ${row.permalink}`,
    );
  }
  lines.push("residue:", ...document.coverage.residue.map((line) => `  - ${line}`));
  return lines;
}

/**
 * The `--json` rendering and the persisted bytes: one pretty-printed document through the size-guarded
 * serialiser, because the row count is corpus-sized.
 *
 * @param document the document to serialise
 * @returns the JSON text, with no trailing newline
 */
export function renderSlackOwedJson({ document }: { document: SlackOwedDocument }): string {
  return safeJsonStringify({ label: "slack owed document", space: 2, value: document });
}
