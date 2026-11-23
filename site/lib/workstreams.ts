/**
 * The owner's workstreams, folded from the board's own rows: which streams are main and which lower, what is on the
 * owner, on whom else, and what is slipping, all on one page. The design is `page:console-pages-and-workstreams`.
 *
 * Every field is DERIVED, so there is no workstream list to go stale. `docs/workstreams.md` rules one out, and a
 * workstream exists exactly while an open row carries its `workstream=` tag:
 *
 * - **Membership** is each distinct actionable `workstream=` tag on an open row. A row may carry several.
 * - **Impact** is the highest `impact=` on any member row. A stream with none reads `unrated`, never a default.
 * - **Priority** comes from the derived `priority=` tag, which the verb computes from the row.
 * - **Tier** is `main` for a critical or high impact, or a stream holding a p0. Otherwise it is `lower`.
 * - **Waiting** is ONE answer per row, in this order: on the owner (waiting on owner, `ownerWait` set to the
 *   owner, or paused on the owner), then on the person its pause names, then on the fleet for a row the board holds in NOT YET behind another
 *   row. A pause outranks a `blockedBy` edge, and no row counts in two places.
 * - **Slipping** means a run whose seat died, or an in-flight or awaiting-ship row whose journal has not moved in
 *   more than {@link SLIPPING_AFTER_MS}. Only a readable `movedIso` can say that; an absent or unparseable one
 *   is never slipping. A PAUSED row, or one waiting on a PERSON, is never slipping, because waiting is a state and
 *   not a countdown.
 *
 * Pure: the caller passes the instant, and nothing here reads a clock.
 */
import type { BoardRow } from "../components/live/read";
import { waitsOnOwner } from "../components/live/readBoardWaits";

/** How much rides on a workstream, highest first; `unrated` when no member row declares an impact. */
export type WorkstreamImpact = "critical" | "high" | "medium" | "low" | "unrated";

/** A row priority as the derived `priority=` tag spells it. */
export type WorkstreamPriority = "p0" | "p1" | "p2" | "p3";

/** Main streams lead the band; lower ones fold under their own summary. */
export type WorkstreamTier = "main" | "lower";

/**
 * One party other than the owner that a stream's rows wait on, with the rows waiting.
 *
 * `kind` keeps a pause apart from a block: a PAUSED row names its subject in free text, so one paused on "the
 * fleet" and one blocked by another row share a name and are still two different waits.
 */
export interface WorkstreamOtherWait {
  /** A PAUSED row's named subject, or a row blocked by another row, which waits on the fleet. */
  readonly kind: "pause" | "blocked";
  readonly name: string;
  readonly rows: readonly string[];
}

/** One pill the band draws for a stream's waits on others: how many rows, the words after the count, and the rows. */
export interface OtherWaitPill {
  readonly n: number;
  readonly words: string;
  readonly title: string;
}

/**
 * The band's pills for a stream's waits on others: one counting the paused rows and naming whom they wait on, one
 * counting the rows blocked by another row. Two pills, so a pause whose subject reads "the fleet" never shares a
 * count with a block.
 *
 * @param onOthers the stream's folded waits
 * @returns the paused pill then the blocked pill, each only when it holds a row
 */
export function otherWaitPills({ onOthers }: { onOthers: readonly WorkstreamOtherWait[] }): readonly OtherWaitPill[] {
  const pills: OtherWaitPill[] = [];
  const paused = onOthers.filter((wait) => wait.kind === "pause");
  if (paused.length > 0) {
    pills.push({
      n: paused.reduce((total, wait) => total + wait.rows.length, 0),
      title: paused.map((wait) => `${wait.name}: ${wait.rows.join(", ")}`).join("\n"),
      words: `paused on ${paused.map((wait) => wait.name).join(", ")}`,
    });
  }
  const blocked = onOthers.filter((wait) => wait.kind === "blocked").flatMap((wait) => wait.rows);
  if (blocked.length > 0) {
    pills.push({ n: blocked.length, title: blocked.join("\n"), words: `blocked on ${FLEET}` });
  }
  return pills;
}

/** One of the owner's workstreams as the band draws it. */
export interface Workstream {
  readonly name: string;
  readonly impact: WorkstreamImpact;
  readonly topPriority: WorkstreamPriority | undefined;
  readonly tier: WorkstreamTier;
  readonly onOwner: readonly string[];
  readonly onOthers: readonly WorkstreamOtherWait[];
  readonly slipping: readonly string[];
  readonly rowSlugs: readonly string[];
  readonly p0Count: number;
}

/**
 * The whole band: every stream, and the open rows no stream claims, split by what their `tags` field let the fold
 * know. Only a row whose tags read whole is untagged; the rest are counted apart, never called untagged, and a row whose
 * tags read only partly is counted apart even when it joined a stream.
 */
export interface Workstreams {
  readonly workstreams: readonly Workstream[];
  /** Open rows whose tags read whole and carry no workstream tag. */
  readonly untagged: number;
  /**
   * Open rows whose published `tags` did not wholly read, whether or not a tag that did read put them in a stream:
   * a dropped member could have named another one.
   */
  readonly unread: number;
  /** Open rows that publish no `tags` field at all: a board cut before the verb published tags. */
  readonly unpublished: number;
}

/**
 * An in-flight row with no journal event for longer than this is slipping. It is a day rather than an hour
 * because a seat that has stopped for the night is not slipping. MEASURED: 46 of 58 active in-flight
 * rows and 55 of 57 awaiting-ship rows were already past it. Re-measure with `slopweaver handover list --json |
 * jq '[.rows[] | select(.section=="IN FLIGHT") | .movedIso]'`.
 */
export const SLIPPING_AFTER_MS = 24 * 60 * 60 * 1000;

/** The name a row blocked by another row is grouped under. */
export const FLEET = "the fleet";

/**
 * The derived status of a declared draft: the one NOT YET row a dependency does not hold, whatever its edges say
 * (`src/handover/boardEvidence.ts`).
 */
const DRAFT = "draft";

/** Impacts from highest to lowest; the index is the rank. */
const IMPACT_ORDER: readonly WorkstreamImpact[] = ["critical", "high", "medium", "low", "unrated"];

/** Priorities from highest to lowest; the index is the rank. */
const PRIORITY_ORDER: readonly WorkstreamPriority[] = ["p0", "p1", "p2", "p3"];

/** The sections a row that has left the board sits in. */
const DONE = "DONE";

/** The prefix every terminal-but-not-shipped section opens with. */
const CLOSED_PREFIX = "CLOSED";

/** The sections whose rows are expected to keep moving. */
const MOVING_SECTIONS: ReadonlySet<string> = new Set(["IN FLIGHT", "AWAITING SHIP"]);

/**
 * The role word a pause on the owner records: the console's copy of `src/handover/pauseSubject.ts`'s
 * `OWNER_PAUSE_SUBJECT`, bound to it by `site/__tests__/unit/ownerVocabularyMirror.test.ts`.
 */
export const OWNER_PAUSE_SUBJECT = "owner" as const;

/** The subjects a pause names when it waits on the owner, lowercased — role words, since the owner's own name is state. */
const OWNER_SUBJECTS: ReadonlySet<string> = new Set([OWNER_PAUSE_SUBJECT, "the owner"]);

/**
 * Who a PAUSED row waits on, read from the published `pausedOn` and never from `reason`, whose phrase joins that
 * subject to a free-text `pausedSince` so no pattern can split them back.
 *
 * @returns the subject, or `undefined` when the row is not paused or its board predates `pausedOn`
 */
function pausedOn({ row }: { row: BoardRow }): string | undefined {
  if (row.section !== "PAUSED") {
    return undefined;
  }
  return row.pausedOn;
}

/**
 * Whether a row is still on the board: not done, not closed.
 *
 * @returns true for an open row
 */
export function isOpen({ row }: { row: BoardRow }): boolean {
  return row.section !== DONE && !row.section.startsWith(CLOSED_PREFIX);
}

/**
 * Each distinct value of one tag key on a row, in first-seen order.
 *
 * @returns the values
 */
function tagValues({ row, key }: { row: BoardRow; key: string }): readonly string[] {
  const seen: string[] = [];
  for (const tag of row.tags) {
    if (tag.key === key && !seen.includes(tag.value)) {
      seen.push(tag.value);
    }
  }
  return seen;
}

/**
 * Whether a value is a known impact, narrowed.
 *
 * @returns true for one of the four declared impacts
 */
function isImpact(value: string): value is Exclude<WorkstreamImpact, "unrated"> {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

/**
 * Whether a value is a known priority, narrowed.
 *
 * @returns true for p0 to p3
 */
function isPriority(value: string): value is WorkstreamPriority {
  return value === "p0" || value === "p1" || value === "p2" || value === "p3";
}

/**
 * Whether a row waits on the owner — the one reading the workstream band and the Queue's stopping section both take
 * (`./queueStopping.ts`), so a row cannot wait on the owner on one page and not the other.
 *
 * @returns true when the row is the owner's to move
 */
export function isOnOwner({ row }: { row: BoardRow }): boolean {
  if (row.section === "WAITING ON OWNER" || waitsOnOwner({ ownerWait: row.ownerWait })) {
    return true;
  }
  const subject = pausedOn({ row });
  return subject !== undefined && OWNER_SUBJECTS.has(subject.toLowerCase());
}

/**
 * Who a row waits on, as one answer: the owner first, then the person, team or outside party its pause names, then the
 * fleet for a row blocked by another row. A pause subject is free text and never a slug (`src/handover/doc.ts`),
 * so it is never resolved against the board.
 *
 * @returns the owner, the other party by name, or `undefined` when the row waits on nobody
 */
function waitingOn({
  row,
}: {
  row: BoardRow;
}): { readonly on: "owner" } | { readonly on: "pause" | "blocked"; readonly name: string } | undefined {
  if (isOnOwner({ row })) {
    return { on: "owner" };
  }
  const subject = pausedOn({ row });
  if (subject !== undefined) {
    return { name: subject, on: "pause" };
  }
  // `blockedBy` is the authored list and keeps an edge its dependency already satisfied, so only a row the board
  // itself holds in NOT YET for it is blocked: a declared draft sits in NOT YET whatever its edges say.
  if (row.section === "NOT YET" && row.status !== DRAFT && row.blockedBy.length > 0) {
    return { name: FLEET, on: "blocked" };
  }
  return undefined;
}

/**
 * Whether a row has missed its next expected step.
 *
 * @param nowMs the instant the band is drawn at
 * @returns true for an orphaned run, or a moving row whose journal has been still for more than a day, read
 *   off a `movedIso` that parses: an absent or unreadable one says nothing about how long the row has been still
 */
function isSlipping({ row, nowMs }: { row: BoardRow; nowMs: number }): boolean {
  if (row.run === "orphaned") {
    return true;
  }
  if (!MOVING_SECTIONS.has(row.section)) {
    return false;
  }
  if (row.movedIso === undefined) {
    return false;
  }
  const moved = Date.parse(row.movedIso);
  // Readable means it round-trips: `Date.parse` quietly rolls an impossible date such as February's thirtieth into the next month.
  const readable = !Number.isNaN(moved) && new Date(moved).toISOString() === row.movedIso;
  return readable && moved < nowMs - SLIPPING_AFTER_MS;
}

/**
 * The highest impact any member row declares, said as `unrated` when none declares one.
 *
 * @returns the stream impact
 */
function impactOf({ impacts }: { impacts: readonly WorkstreamImpact[] }): WorkstreamImpact {
  const top = highest({ order: IMPACT_ORDER, values: impacts });
  if (top === undefined) {
    return "unrated";
  }
  return top;
}

/**
 * The highest-ranked member of `values` in `order`.
 *
 * @returns the highest, or `undefined` for an empty list
 */
function highest<T>({ values, order }: { values: readonly T[]; order: readonly T[] }): T | undefined {
  let best: T | undefined;
  for (const value of values) {
    if (best === undefined || order.indexOf(value) < order.indexOf(best)) {
      best = value;
    }
  }
  return best;
}

/** One stream's rows as the fold accumulates them. */
interface Gathered {
  readonly rows: BoardRow[];
}

/**
 * One stream, derived from its member rows.
 *
 * @param nowMs the instant the band is drawn at
 * @returns the stream
 */
function streamOf({ name, rows, nowMs }: { name: string; rows: readonly BoardRow[]; nowMs: number }): Workstream {
  const impacts = rows.flatMap((row) => tagValues({ key: "impact", row }).filter(isImpact));
  const priorities = rows.flatMap((row) => tagValues({ key: "priority", row }).filter(isPriority));
  const impact = impactOf({ impacts });
  const topPriority = highest({ order: PRIORITY_ORDER, values: priorities });
  const p0Count = rows.filter((row) => tagValues({ key: "priority", row }).includes("p0")).length;
  const others = new Map<string, { kind: "pause" | "blocked"; name: string; rows: string[] }>();
  const slipping: string[] = [];
  const onOwner: string[] = [];
  for (const row of rows) {
    const wait = waitingOn({ row });
    if (wait?.on === "owner") {
      onOwner.push(row.slug);
    } else if (wait !== undefined) {
      const key = `${wait.on}:${wait.name}`;
      const waiting = others.get(key);
      if (waiting === undefined) {
        others.set(key, { kind: wait.on, name: wait.name, rows: [row.slug] });
      } else {
        waiting.rows.push(row.slug);
      }
    }
    // A row on the fleet can still slip; one waiting on a person, the owner included, or paused at all, never does: a
    // PAUSED row whose board predates `pausedOn` names nobody, and is still a wait rather than a countdown.
    const heldOnAWait = row.section === "PAUSED" || (wait !== undefined && wait.on !== "blocked");
    if (!heldOnAWait && isSlipping({ nowMs, row })) {
      slipping.push(row.slug);
    }
  }
  const isMain = impact === "critical" || impact === "high" || p0Count > 0;
  return {
    impact,
    name,
    onOwner: onOwner.toSorted(),
    onOthers: [...others.values()]
      .map((waiting) => ({ kind: waiting.kind, name: waiting.name, rows: waiting.rows.toSorted() }))
      .toSorted((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)),
    p0Count,
    rowSlugs: rows.map((row) => row.slug).toSorted(),
    slipping: slipping.toSorted(),
    tier: isMain ? "main" : "lower",
    topPriority,
  };
}

/**
 * Rank two streams: main before lower, then impact, then top priority, then name.
 *
 * @returns negative when `a` comes first
 */
function byStanding({ a, b }: { a: Workstream; b: Workstream }): number {
  const tier = Number(a.tier === "lower") - Number(b.tier === "lower");
  if (tier !== 0) {
    return tier;
  }
  const impact = IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
  if (impact !== 0) {
    return impact;
  }
  const rank = ({ priority }: { priority: WorkstreamPriority | undefined }): number =>
    priority === undefined ? PRIORITY_ORDER.length : PRIORITY_ORDER.indexOf(priority);
  const priority = rank({ priority: a.topPriority }) - rank({ priority: b.topPriority });
  if (priority !== 0) {
    return priority;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Fold the board's open rows into the owner's workstreams.
 *
 * @param nowMs the instant the band is drawn at, passed in so the fold stays pure
 * @returns every stream in standing order, and the open rows no stream claims, by how their tags read
 */
export function workstreamsOf({ rows, nowMs }: { rows: readonly BoardRow[]; nowMs: number }): Workstreams {
  const gathered = new Map<string, Gathered>();
  let untagged = 0;
  let unread = 0;
  let unpublished = 0;
  for (const row of rows) {
    if (!isOpen({ row })) {
      continue;
    }
    const names = tagValues({ key: "workstream", row });
    if (row.tagsRead === "partial") {
      unread += 1;
    } else if (names.length === 0 && row.tagsRead === "absent") {
      unpublished += 1;
    } else if (names.length === 0) {
      untagged += 1;
    }
    for (const name of names) {
      const stream = gathered.get(name);
      if (stream === undefined) {
        gathered.set(name, { rows: [row] });
      } else {
        stream.rows.push(row);
      }
    }
  }
  const workstreams = [...gathered.entries()]
    .map(([name, stream]) => streamOf({ name, nowMs, rows: stream.rows }))
    .toSorted((a, b) => byStanding({ a, b }));
  return { unpublished, unread, untagged, workstreams };
}

/**
 * The open rows no stream claims, in words: each non-zero count, never a count the fold did not read.
 *
 * @returns the clauses, in the order untagged, tags that did not read, tags not published
 */
export function unclaimedClauses({ folded }: { folded: Workstreams }): readonly string[] {
  const clauses: string[] = [];
  if (folded.untagged > 0) {
    clauses.push(`${String(folded.untagged)} open rows untagged`);
  }
  if (folded.unread > 0) {
    clauses.push(`${String(folded.unread)} whose tags did not wholly read`);
  }
  if (folded.unpublished > 0) {
    clauses.push(`${String(folded.unpublished)} whose board row publishes no tags`);
  }
  return clauses;
}

/**
 * What the band says when no row names a workstream, claiming only what the fold read: that no open row carries a
 * workstream tag when every open row's tags read whole, that no open row publishes tags when none published any,
 * and otherwise only that no workstream read. It speaks of open rows only, because that is all the fold reads.
 *
 * @returns the lead clause
 */
export function noStreamLead({ folded }: { folded: Workstreams }): string {
  if (folded.unread === 0 && folded.unpublished === 0) {
    return "no open row carries a workstream tag yet";
  }
  if (folded.untagged === 0 && folded.unread === 0) {
    return "no open row publishes tags yet";
  }
  return "no workstream read yet";
}
