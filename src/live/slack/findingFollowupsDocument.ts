/**
 * The `slopweaver slack finding-followups` document — the findings the owner shared that come back to them as ONE follow-up
 * card each, as the strict persisted worklist the seated `thread-chase` session reads.
 *
 * ## What a row is
 *
 * One shared finding whose one card is unspent and whose verdict (`sessionStart/findingFollowups.ts`) is `quiet`,
 * `stalled` or `claimed-fixed`. It carries what the seat needs to read the thread live and park the card with
 * `slack draft record --act bump --followup-of <findingId>`: the finding's id, its channel and thread, its link, when it
 * landed, the verdict, and the team's last word when there is one. It never says what the card should say, or that a
 * claimed fix is deployed or contradicted: those are the seat's to establish.
 *
 * ## An unavailable read never resembles an all-clear
 *
 * `status` is required, exactly as `./awaitingDocument.ts`'s is.
 *
 * Pure: no clock, no filesystem. `nowIso` is supplied; persistence is `./findingFollowupsStore.ts`.
 */

import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonStringify } from "../../lib/safeJson.js";
import type { SharedFinding } from "../../outbound/slack/sharedFindings.js";
import {
  type FindingFollowupVerdict,
  type FindingInHandReason,
  type FindingThreadMessage,
  findingFollowupVerdictOf,
} from "../../sessionStart/findingFollowups.js";

/** The document's own schema version. A reader refuses any other. */
const FINDING_FOLLOWUPS_SCHEMA_VERSION = 1;

/** One business hour, the unit a row reports its quiet in. */
const HOUR_MS = 3_600_000;

/** How much of the team's last word a row quotes. Enough to recognise, never the thread. */
const QUOTE_CHARS = 200;

/** The team's word a row is about: who, when, what, and where. */
const findingFollowupWordSchema = z.strictObject({
  authorId: z.string().min(1),
  atIso: z.iso.datetime(),
  ts: z.string().min(1),
  quote: z.string(),
  permalink: z.string(),
});

/** One finding coming back to the owner, as persisted. */
const findingFollowupRowSchema = z.strictObject({
  /** The released finding's draft id — what `slack draft record --followup-of` takes. */
  findingId: z.string().min(1),
  verdict: z.enum(["quiet", "stalled", "claimed-fixed"]),
  channelId: z.string().min(1),
  channelName: z.string().optional(),
  /** The thread the card replies under — what `slack draft record --thread-ts` takes. */
  threadTs: z.string().min(1),
  /** The finding's own landed message. */
  messageTs: z.string().min(1),
  postedAtIso: z.iso.datetime(),
  /** The finding's link; absent on one released before the register recorded links. */
  permalink: z.string().min(1).optional(),
  /** The board row that raised the finding, for the card's `--row`. */
  row: z.string().min(1).optional(),
  why: z.string(),
  /** Whole business hours since the silence began: the post when `quiet`, the acknowledgement when `stalled`. */
  businessHoursQuiet: z.number().int().nonnegative().optional(),
  /** The acknowledgement when `stalled`, the claim when `claimed-fixed`. */
  teamWord: findingFollowupWordSchema.optional(),
});

/** The whole persisted document. */
const findingFollowupsDocumentSchema = z.strictObject({
  schemaVersion: z.literal(FINDING_FOLLOWUPS_SCHEMA_VERSION),
  producer: z.literal("slack finding-followups"),
  observedAtIso: z.iso.datetime(),
  status: z.enum(["complete", "incomplete", "unavailable"]),
  coverage: z.strictObject({
    kind: z.literal("bounded"),
    windowDays: z.number().int().positive(),
    sinceIso: z.iso.datetime(),
    residue: z.array(z.string().min(1)).min(1),
  }),
  counts: z.strictObject({
    owed: z.number().int().nonnegative(),
    quiet: z.number().int().nonnegative(),
    stalled: z.number().int().nonnegative(),
    claimedFixed: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    insideFirstBusinessDay: z.number().int().nonnegative(),
    ownerSpoke: z.number().int().nonnegative(),
    timedPromise: z.number().int().nonnegative(),
    undated: z.number().int().nonnegative(),
    cardSpent: z.number().int().nonnegative(),
    olderThanWindow: z.number().int().nonnegative(),
  }),
  followups: z.array(findingFollowupRowSchema),
});

/** One row of the persisted document. */
type FindingFollowupRow = z.infer<typeof findingFollowupRowSchema>;

/** The persisted `slack finding-followups` document. */
export type FindingFollowupsDocument = z.infer<typeof findingFollowupsDocumentSchema>;

/** What the document is built from: the reader's own fields this module needs. */
export interface FindingFollowupsReadInput {
  readonly status: "complete" | "incomplete" | "unavailable";
  readonly owed: readonly { readonly finding: SharedFinding; readonly messages: readonly FindingThreadMessage[] }[];
  /** The findings inside the window whose one card is already spent. */
  readonly spent: readonly { readonly findingId: string }[];
  readonly olderThanWindow: number;
  readonly windowDays: number;
  readonly couldNotSee: readonly string[];
}

/**
 * The persisted form of one team word.
 *
 * @param message the word
 * @returns its row entry, quote bounded
 */
function wordOf({ message }: { message: FindingThreadMessage }): FindingFollowupRow["teamWord"] {
  return {
    atIso: message.tsIso,
    authorId: message.authorId,
    permalink: message.permalink,
    quote: message.text.replace(/\s+/g, " ").trim().slice(0, QUOTE_CHARS),
    ts: message.ts,
  };
}

/**
 * One finding as a row, or nothing when its verdict keeps it in hand.
 *
 * @param finding the shared finding
 * @param verdict what the thread says about it
 * @returns the row, undefined for an in-hand finding
 */
function rowOf({
  finding,
  verdict,
}: {
  finding: SharedFinding;
  verdict: FindingFollowupVerdict;
}): FindingFollowupRow | undefined {
  if (verdict.kind === "in-hand") {
    return undefined;
  }
  const base = {
    channelId: finding.channelId,
    findingId: finding.draftId,
    messageTs: finding.messageTs,
    postedAtIso: finding.postedAtIso,
    threadTs: finding.threadTs,
    verdict: verdict.kind,
    why: finding.why,
    ...(finding.channelName === undefined ? {} : { channelName: finding.channelName }),
    ...(finding.permalink === undefined ? {} : { permalink: finding.permalink }),
    ...(finding.row === undefined ? {} : { row: finding.row }),
  };
  if (verdict.kind === "quiet") {
    return { ...base, businessHoursQuiet: Math.floor(verdict.businessMs / HOUR_MS) };
  }
  if (verdict.kind === "stalled") {
    return {
      ...base,
      businessHoursQuiet: Math.floor(verdict.businessMs / HOUR_MS),
      teamWord: wordOf({ message: verdict.acknowledgement }),
    };
  }
  return { ...base, teamWord: wordOf({ message: verdict.claim }) };
}

/** Which in-hand reason each count field tallies. */
const IN_HAND_COUNT: Readonly<Record<FindingInHandReason, keyof FindingFollowupsDocument["counts"]>> = {
  answered: "answered",
  "inside-first-day": "insideFirstBusinessDay",
  "owner-spoke": "ownerSpoke",
  "timed-promise": "timedPromise",
  undated: "undated",
};

/** How long a row has sat quiet, for ordering: a claimed fix runs no clock, so it measures none. */
function quietHoursOf({ row }: { row: FindingFollowupRow }): number {
  if (row.businessHoursQuiet === undefined) {
    return 0;
  }
  return row.businessHoursQuiet;
}

/** A claimed fix first — it comes back at once — then the longest quiet, then the finding id. */
function byUrgency({ a, b }: { a: FindingFollowupRow; b: FindingFollowupRow }): number {
  if ((a.verdict === "claimed-fixed") !== (b.verdict === "claimed-fixed")) {
    return a.verdict === "claimed-fixed" ? -1 : 1;
  }
  const quietA = quietHoursOf({ row: a });
  const quietB = quietHoursOf({ row: b });
  if (quietA !== quietB) {
    return quietB - quietA;
  }
  if (a.findingId === b.findingId) {
    return 0;
  }
  return a.findingId < b.findingId ? -1 : 1;
}

/**
 * Build the document one read produced.
 *
 * @param read the reader's result
 * @param nowIso the run's own instant, which is both `observedAtIso` and the window's end
 * @returns the document, `unavailable` with zero rows whenever the read could not see, `incomplete` whenever a
 *   finding's instant could not be read
 */
export function findingFollowupsDocument({
  read,
  nowIso,
}: {
  read: FindingFollowupsReadInput;
  nowIso: string;
}): FindingFollowupsDocument {
  const { counts, rows } = tallied({ nowIso, read });
  let status = read.status;
  if (status === "complete" && counts.undated > 0) {
    status = "incomplete";
  }
  return {
    counts,
    coverage: {
      kind: "bounded",
      residue: residueOf({ read, undated: counts.undated }),
      sinceIso: new Date(Date.parse(nowIso) - read.windowDays * 86_400_000).toISOString(),
      windowDays: read.windowDays,
    },
    followups: read.status === "unavailable" ? [] : rows.toSorted((a, b) => byUrgency({ a, b })),
    observedAtIso: nowIso,
    producer: "slack finding-followups",
    schemaVersion: FINDING_FOLLOWUPS_SCHEMA_VERSION,
    status,
  };
}

/** Every owed finding judged: the counts by verdict, and the rows that come back to the owner. */
function tallied({ read, nowIso }: { read: FindingFollowupsReadInput; nowIso: string }): {
  readonly counts: FindingFollowupsDocument["counts"];
  readonly rows: readonly FindingFollowupRow[];
} {
  const counts: FindingFollowupsDocument["counts"] = {
    answered: 0,
    cardSpent: read.spent.length,
    claimedFixed: 0,
    insideFirstBusinessDay: 0,
    olderThanWindow: read.olderThanWindow,
    owed: read.owed.length,
    ownerSpoke: 0,
    quiet: 0,
    stalled: 0,
    timedPromise: 0,
    undated: 0,
  };
  const rows: FindingFollowupRow[] = [];
  for (const { finding, messages } of read.owed) {
    const verdict = findingFollowupVerdictOf({
      messageTs: finding.messageTs,
      messages,
      nowIso,
      postedAtIso: finding.postedAtIso,
    });
    if (verdict.kind === "in-hand") {
      counts[IN_HAND_COUNT[verdict.reason]] += 1;
    } else if (verdict.kind === "claimed-fixed") {
      counts.claimedFixed += 1;
    } else {
      counts[verdict.kind] += 1;
    }
    const row = rowOf({ finding, verdict });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return { counts, rows };
}

/** What the document could not see, first, then the bounds every reading carries. */
function residueOf({ read, undated }: { read: FindingFollowupsReadInput; undated: number }): string[] {
  return [
    ...(undated > 0
      ? [
          `${String(undated)} finding(s) carry an instant the business clock cannot read, so one may be owed a card and not shown`,
        ]
      : []),
    ...read.couldNotSee,
    `only findings released from the draft register as \`kind: finding\` in the last ${String(read.windowDays)} days qualify; a finding posted any other way is not seen`,
    "a finding qualifies when no person but you has replied in its thread for a full business day since it landed (quiet), when the team's last word is an untimed acknowledgement with nothing after it for a full business day (stalled), or when the team's last word claims a fix (claimed-fixed, at once) — Melbourne weekdays, public holidays counted as business days",
    'a thread where you spoke after the team\'s last word is left to `slack awaiting`, which chases your own ask; a reaction is not read as a reply; a TIMED promise ("by eod") stays in hand however long ago its time passed',
    "the acknowledgement and fixed-claim tests are lexical and under-select on purpose; a claimed fix is NOT known to be deployed or contradicted — the seat establishes both before any card",
    "the thread is the corpus's own copy and nothing was re-read live; a reply posted at the top of the channel or in a DM is not seen here",
  ];
}

/**
 * Validate stored or received bytes, already parsed, against the strict document schema.
 *
 * @param value anything claiming to be a `slack finding-followups` document
 * @returns the typed document, or one sentence per schema issue
 */
export function parseFindingFollowupsDocument({ value }: { value: unknown }): Result<FindingFollowupsDocument> {
  const parsed = findingFollowupsDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/** The words a verdict prints as. */
const VERDICT_LABEL: Readonly<Record<FindingFollowupRow["verdict"], string>> = {
  "claimed-fixed": "claimed fixed — check the deploy, then the original evidence",
  quiet: "no reply",
  stalled: "only an untimed acknowledgement",
};

/**
 * One row's block: the verdict and where, the team's word when there is one, and the links.
 *
 * @param row the row to render
 * @returns its lines
 */
function rowLinesOf({ row }: { row: FindingFollowupRow }): readonly string[] {
  const room = row.channelName === undefined ? row.channelId : `#${row.channelName.replace(/^#/, "")}`;
  const quiet = row.businessHoursQuiet === undefined ? "" : ` · ${String(row.businessHoursQuiet)}h quiet`;
  return [
    `${row.findingId} · ${VERDICT_LABEL[row.verdict]}${quiet} · ${room} · shared ${row.postedAtIso}`,
    `  ${row.why}`,
    ...(row.teamWord === undefined ? [] : [`  team: "${row.teamWord.quote}" ${row.teamWord.permalink}`]),
    `  ${addressOf({ row })}`,
  ];
}

/** Where a row's finding sits: its link, or its channel and `ts` on a row released before the register kept one. */
function addressOf({ row }: { row: FindingFollowupRow }): string {
  if (row.permalink === undefined) {
    return `${row.channelId} ${row.messageTs}`;
  }
  return row.permalink;
}

/**
 * The first line, which says outright when the list is not an all-clear.
 *
 * @param document the document being rendered
 * @returns the header line
 */
function headerLineOf({ document }: { document: FindingFollowupsDocument }): string {
  if (document.status === "unavailable") {
    return "slack finding-followups: UNAVAILABLE — the read could not see, so this is NOT an all-clear (reason under residue)";
  }
  const listed = `${String(document.followups.length)} shared finding(s) owed their one follow-up card`;
  if (document.status === "incomplete") {
    return `slack finding-followups: INCOMPLETE — ${listed} from what could be read, so this is NOT an all-clear (reason under residue)`;
  }
  return `slack finding-followups: ${listed}, of ${String(document.counts.owed)} shared since ${document.coverage.sinceIso} with the card unspent`;
}

/**
 * The human rendering: a header, one block per row, then the residue — always, zero rows or not.
 *
 * @param document the document to render
 * @returns the lines to print, in order
 */
export function renderFindingFollowupsText({ document }: { document: FindingFollowupsDocument }): readonly string[] {
  return [
    headerLineOf({ document }),
    ...document.followups.flatMap((row) => rowLinesOf({ row })),
    "residue:",
    ...document.coverage.residue.map((line) => `  - ${line}`),
  ];
}

/**
 * The `--json` rendering and the persisted bytes, through the size-guarded serialiser.
 *
 * @param document the document to serialise
 * @returns the JSON text, with no trailing newline
 */
export function renderFindingFollowupsJson({ document }: { document: FindingFollowupsDocument }): string {
  return safeJsonStringify({ label: "slack finding-followups document", space: 2, value: document });
}
