/**
 * The `slopweaver slack awaiting` document — threads the owner spoke in whose last HUMAN word is theirs, that
 * asked for a reply, and that have had none for at least two business days, as the strict persisted worklist a seated
 * `thread-chase` session reads.
 *
 * ## What a row is, and what it carries for the chase
 *
 * The selection is `sessionStart/slackAwaiting.ts`'s {@link slackAwaitingThreads}. A row names the thread, links
 * THEIR last message, says how many business hours it has been quiet and which of the three signals made it an
 * ask, and lists the people in it — those the owner tagged first, then everybody else who spoke, newest first — each
 * marked whether a chase may tag them. It never names who SHOULD be tagged: that is the seated session's
 * judgement, read against the thread itself.
 *
 * ## An unavailable read never resembles an all-clear
 *
 * `status` is required, exactly as `./owedDocument.ts`'s is. A read that could not see is `unavailable` with
 * zero rows and its reason first in the residue; a thread whose instant could not be read makes it `incomplete`.
 *
 * ## It reads, and it never drafts or sends
 *
 * Every chase is a draft the seated session parks for the owner's yes (`slack draft record`), never an act of this
 * module or its verb.
 *
 * Pure: no clock, no filesystem. `nowIso` is supplied; persistence is `./awaitingStore.ts`.
 */

import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import type {
  SlackAwaitingCandidate,
  SlackAwaitingThread,
  SlackThreadPerson,
} from "../../sessionStart/slackAwaiting.js";
import { slackAwaitingThreads } from "../../sessionStart/slackAwaiting.js";

/** The document's own schema version. A reader refuses any other. 2: the hold count is `insideChaseWait`. */
const SLACK_AWAITING_SCHEMA_VERSION = 2;

/** One business hour, the unit a row reports its quiet in. */
const HOUR_MS = 3_600_000;

/** One person in a thread, as persisted. */
const slackAwaitingPersonSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** When they last spoke in the thread; absent for somebody the owner tagged who never has. */
  lastWordAtIso: z.iso.datetime().optional(),
  /** Whether one of the owner's kept messages tagged them. */
  tagged: z.boolean(),
  /** Whether a chase may tag them: known to the members index, active, a person, not the owner. */
  taggable: z.boolean(),
});

/** One awaiting thread, as persisted. */
const slackAwaitingThreadSchema = z.strictObject({
  /** `${channelId}:${threadTs}` — the id `slack owed` gives the same thread. */
  nativeId: z.string().min(1),
  channelId: z.string().min(1),
  channelName: z.string().optional(),
  /** The thread's ROOT ts, which `slack draft record --thread-ts` takes. */
  threadTs: z.string().min(1),
  /** The permalink of the OWNER'S last message, the one nobody has answered. */
  permalink: z.string().min(1),
  ownerLastWordAtIso: z.iso.datetime(),
  ownerLastText: z.string(),
  /** Whole business hours since the owner's last message, Melbourne weekdays. */
  businessHoursQuiet: z.number().int().nonnegative(),
  asksQuestion: z.boolean(),
  tagsGroup: z.boolean(),
  /** Whether anybody replied in the thread at all — false is a channel root nobody threaded under. */
  hasReplies: z.boolean(),
  people: z.array(slackAwaitingPersonSchema),
  /** Pull requests the owner's messages link, so the seat can defer a review ask to `github landing`. */
  pullRequests: z.array(z.strictObject({ owner: z.string(), repo: z.string(), number: z.number().int() })),
});

/** The whole persisted document. */
const slackAwaitingDocumentSchema = z.strictObject({
  schemaVersion: z.literal(SLACK_AWAITING_SCHEMA_VERSION),
  producer: z.literal("slack awaiting"),
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
    awaiting: z.number().int().nonnegative(),
    insideChaseWait: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    noAsk: z.number().int().nonnegative(),
    directMessagesNotJudged: z.number().int().nonnegative(),
    undated: z.number().int().nonnegative(),
  }),
  threads: z.array(slackAwaitingThreadSchema),
});

/** One awaiting thread in the persisted document. */
type SlackAwaitingThreadDocument = z.infer<typeof slackAwaitingThreadSchema>;

/** The persisted `slack awaiting` document — the contract the seated chase session validates stored bytes against. */
export type SlackAwaitingDocument = z.infer<typeof slackAwaitingDocumentSchema>;

/** What the document is built from: the corpus reader's own fields this module needs, and its window. */
export interface SlackAwaitingReadInput {
  /** Whether the read could see what it set out to — `incomplete` when it lost lines in a thread it follows. */
  readonly status: "complete" | "incomplete" | "unavailable";
  /** Every thread the owner spoke in, before the selection. */
  readonly awaitingCandidates: readonly SlackAwaitingCandidate[];
  /** How many threads the owner spoke in inside the window. */
  readonly threadsSpokenIn: number;
  /** What the read could not see, in its own words — the unavailable reason when there is one. */
  readonly couldNotSee: readonly string[];
  /** How many days back the reader looked. */
  readonly windowDays: number;
}

/**
 * One person as persisted.
 *
 * @param person the person in the thread
 * @param tagged the ids the owner's kept messages tagged
 * @returns the row entry
 */
function personDocumentOf({
  person,
  tagged,
}: {
  person: SlackThreadPerson;
  tagged: ReadonlySet<string>;
}): SlackAwaitingThreadDocument["people"][number] {
  return {
    id: person.id,
    name: person.name,
    tagged: tagged.has(person.id),
    taggable: person.taggable,
    ...(person.lastIso === undefined ? {} : { lastWordAtIso: person.lastIso }),
  };
}

/**
 * Those the owner tagged first, then by latest word, newest first, then id — a stable order the seat can read top down.
 *
 * @param a one person
 * @param b another person
 * @returns the comparator's sign
 */
function byTaggedThenNewest({
  a,
  b,
}: {
  a: SlackAwaitingThreadDocument["people"][number];
  b: SlackAwaitingThreadDocument["people"][number];
}): number {
  if (a.tagged !== b.tagged) {
    return a.tagged ? -1 : 1;
  }
  if (a.lastWordAtIso !== b.lastWordAtIso) {
    // Somebody the owner tagged who never spoke has no word, and sorts after everybody who has.
    if (a.lastWordAtIso === undefined) {
      return 1;
    }
    if (b.lastWordAtIso === undefined) {
      return -1;
    }
    return a.lastWordAtIso > b.lastWordAtIso ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * One kept thread as a persisted row.
 *
 * @param thread a thread the selection kept, whose run is non-empty by construction
 * @returns the row
 */
function threadDocumentOf({ thread }: { thread: SlackAwaitingThread }): SlackAwaitingThreadDocument {
  const { candidate, run } = thread;
  // `awaitingVerdictOf` keeps a thread only when its run has a last message.
  const last = run.at(-1)!;
  const tagged = new Set(run.flatMap((word) => word.ask.taggedIds));
  return {
    asksQuestion: run.some((word) => word.ask.asksQuestion),
    businessHoursQuiet: Math.floor(thread.businessMs / HOUR_MS),
    channelId: candidate.channelId,
    hasReplies: candidate.hasReplies,
    nativeId: `${candidate.channelId}:${candidate.threadTs}`,
    ownerLastText: last.quote,
    ownerLastWordAtIso: last.tsIso,
    people: candidate.people
      .map((person) => personDocumentOf({ person, tagged }))
      .toSorted((a, b) => byTaggedThenNewest({ a, b })),
    permalink: last.permalink,
    pullRequests: run.flatMap((word) => word.pullRequests.map((ref) => ({ ...ref }))),
    tagsGroup: run.some((word) => word.ask.tagsGroup),
    threadTs: candidate.threadTs,
    ...(candidate.channelName === undefined ? {} : { channelName: candidate.channelName }),
  };
}

/**
 * Longest quiet first, then `nativeId` ascending, so two runs over the same corpus print the same order.
 *
 * @param a one row
 * @param b another row
 * @returns the comparator's sign
 */
function byLongestQuiet({ a, b }: { a: SlackAwaitingThreadDocument; b: SlackAwaitingThreadDocument }): number {
  if (a.businessHoursQuiet !== b.businessHoursQuiet) {
    return b.businessHoursQuiet - a.businessHoursQuiet;
  }
  if (a.nativeId === b.nativeId) {
    return 0;
  }
  return a.nativeId < b.nativeId ? -1 : 1;
}

/**
 * Build the document one read produced.
 *
 * The residue is DATA, carried on every document including a zero-row one: what the corpus copy is, the
 * criterion in words, the direct messages not judged, the answer a top-level reply hides, and the review asks
 * `github landing` already chases.
 *
 * @param read the corpus reader's result, adapted to this module's own contract
 * @param nowIso the run's own instant, which is both `observedAtIso` and the window's end
 * @returns the document, `unavailable` with zero threads whenever the read could not see, and `incomplete`
 *   whenever a thread's instant could not be read
 */
export function slackAwaitingDocument({
  read,
  nowIso,
}: {
  read: SlackAwaitingReadInput;
  nowIso: string;
}): SlackAwaitingDocument {
  const { awaiting, tally } = slackAwaitingThreads({ candidates: read.awaitingCandidates, nowIso });
  const readable = read.status !== "unavailable";
  let status = read.status;
  if (status === "complete" && tally.undated > 0) {
    status = "incomplete";
  }
  const residue = [
    ...(tally.undated > 0
      ? [
          `${String(tally.undated)} thread(s) carry an instant the business clock cannot read, so one may be awaiting and not shown`,
        ]
      : []),
    ...read.couldNotSee,
    `only threads you spoke in during the last ${String(read.windowDays)} days qualify, and nothing was re-read live`,
    "a thread qualifies when the last word from a PERSON is yours and no person answered your messages since with a tick, thumbs-up or OK reaction, those messages ask something (a `?` outside links and code) or tag a group or a person (never an app) other than whoever you were answering, and at least two business days have passed — every hour of a Melbourne weekday, public holidays counted as business days",
    `${String(tally["direct-message"])} direct message(s) and group DM(s) are not judged: a DM answer is usually a new message rather than a thread reply, so every DM question would read as unanswered`,
    "an answer a person posts through an app (a synced comment, a workflow) is not read as theirs, and a post of your own as-me bot reads as yours",
    "a reply posted as a new top-level channel message rather than in the thread is not seen here, though a bump's recorder reads one live; a row with hasReplies false is one to read around before chasing",
    "a thread whose messages link one of your open pull requests may already be chased by `github landing` as a review ask",
  ];
  return {
    counts: {
      answered: tally.answered,
      awaiting: tally.awaiting,
      directMessagesNotJudged: tally["direct-message"],
      insideChaseWait: tally["inside-chase-wait"],
      noAsk: tally["no-ask"],
      threadsSpokenIn: read.threadsSpokenIn,
      undated: tally.undated,
    },
    coverage: {
      kind: "bounded",
      residue,
      sinceIso: new Date(Date.parse(nowIso) - read.windowDays * 86_400_000).toISOString(),
      windowDays: read.windowDays,
    },
    observedAtIso: nowIso,
    producer: "slack awaiting",
    schemaVersion: SLACK_AWAITING_SCHEMA_VERSION,
    status,
    threads: readable
      ? awaiting.map((thread) => threadDocumentOf({ thread })).toSorted((a, b) => byLongestQuiet({ a, b }))
      : [],
  };
}

/**
 * Validate stored or received bytes, already parsed, against the strict document schema.
 *
 * @param value anything claiming to be a `slack awaiting` document
 * @returns the typed document, or one sentence per schema issue
 */
export function parseSlackAwaitingDocument({ value }: { value: unknown }): Result<SlackAwaitingDocument> {
  const parsed = slackAwaitingDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/**
 * The room a row names: `#name` for a named channel, the id otherwise.
 *
 * @param row the row to name the room of
 * @returns the room label
 */
function roomLabel({ row }: { row: SlackAwaitingThreadDocument }): string {
  const named = row.channelName;
  if (named === undefined || named.length === 0) {
    return row.channelId;
  }
  return named.startsWith("#") ? named : `#${named}`;
}

/**
 * The human rendering: a header, one block per row, then the residue — always, zero rows or not.
 *
 * @param document the document to render
 * @returns the lines to print, in order
 */
export function renderSlackAwaitingText({ document }: { document: SlackAwaitingDocument }): readonly string[] {
  return [
    headerLineOf({ document }),
    ...document.threads.flatMap((row) => rowLinesOf({ row })),
    "residue:",
    ...document.coverage.residue.map((line) => `  - ${line}`),
  ];
}

/**
 * The first line, which says outright when the list is not an all-clear.
 *
 * @param document the document being rendered
 * @returns the header line
 */
function headerLineOf({ document }: { document: SlackAwaitingDocument }): string {
  if (document.status === "unavailable") {
    return "slack awaiting: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)";
  }
  if (document.status === "incomplete") {
    return (
      `slack awaiting: INCOMPLETE — ${String(document.threads.length)} thread(s) listed from what could be read, ` +
      "so this is NOT an all-clear (reason under residue)"
    );
  }
  return (
    `slack awaiting: ${String(document.threads.length)} thread(s) where your ask has had no reply for two ` +
    `business days or more (${String(document.counts.threadsSpokenIn)} spoken in since ${document.coverage.sinceIso})`
  );
}

/**
 * One row's block: how long quiet and where, the owner's last words, who is taggable, and the link.
 *
 * @param row the row to render
 * @returns its four lines
 */
function rowLinesOf({ row }: { row: SlackAwaitingThreadDocument }): readonly string[] {
  const signals = [row.asksQuestion ? "asks" : "", row.tagsGroup ? "tags a group" : ""].filter((s) => s.length > 0);
  const taggable = row.people.filter((person) => person.taggable).map((person) => person.name);
  return [
    `${String(row.businessHoursQuiet)}h quiet · ${roomLabel({ row })} · you spoke last ${row.ownerLastWordAtIso}` +
      (signals.length === 0 ? "" : ` · ${signals.join(" · ")}`) +
      (row.hasReplies ? "" : " · no replies in thread"),
    `  "${row.ownerLastText}"`,
    `  people: ${taggable.length === 0 ? "nobody taggable" : taggable.join(", ")}`,
    `  ${row.permalink}`,
  ];
}

/**
 * The `--json` rendering and the persisted bytes: one pretty-printed document through the size-guarded
 * serialiser, because the row count is corpus-sized.
 *
 * @param document the document to serialise
 * @returns the JSON text, with no trailing newline
 */
export function renderSlackAwaitingJson({ document }: { document: SlackAwaitingDocument }): string {
  return safeJsonStringify({ label: "slack awaiting document", space: 2, value: document });
}
