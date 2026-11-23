/**
 * The work the Fleet page's working count leaves out: board rows whose seat parked itself on a clock or on CI
 * (`handover park --wake-at|--wake-on-checks`) and was CLOSED, until `handover wake` reseats it. Pure: the page passes
 * the board rows, the tick's last wake reading and its clock in.
 *
 * A seat waiting on a build or a clock closes rather than idling in the fleet, so a working count alone hides every
 * piece of work that is in flight but waiting ("2 working" while more was parked). These lines say how many, on what, and when the next one comes back.
 *
 * **A park on CI is split by what its pull request IS, not by what the park said it was waiting for.** The
 * board said "57 on CI" while only twenty pull requests were open: every one of the rest had merged or closed. The board
 * cannot know that, and
 * the tick's `handover wake` reading always does (`../components/live/readWakeReading.ts`), so the count reads each
 * park's pull request off that reading and says which are still running. With no wake reading in hand the parks are
 * said as "on CI no wake reading has measured" and the band says the states were not read — never guessed.
 *
 * They are sentences under the working count, never cards: a parked row is not a session, so it leaves the fleet
 * immediately, and the cards stay the working ones only. A park that waits on the owner carries no wake and is the
 * Queue's to show, so it never reaches here.
 */
import type { BoardRow } from "../components/live/read";
import type { BoardParkedWake } from "../components/live/readParkedWake";
import type { WakeCiReading, WakeCiState } from "../components/live/readWakeReading";
import { clockWords, spanWords } from "./planMetersWords";
import { firstClause } from "./workingSessions";

/** One parked row, as the fold lists it. */
export interface ParkedWait {
  /**
   * Unique per row even when two board rows share a slug (a defect the board reader reports, not one this list
   * may hide): the slug and the row's board position, so the fold keys each item apart.
   */
  readonly key: string;
  readonly slug: string;
  /** The first clause of the row's summary when it is a short title, else the slug. */
  readonly title: string;
  readonly wake: BoardParkedWake;
  /** What it waits on and when it wakes, in words. */
  readonly detail: string;
}

/** The parked rows in wake order, and the sentences the state band draws for them. */
export interface ParkedWaits {
  readonly waits: readonly ParkedWait[];
  /** Empty when nothing is parked on a clock or CI. */
  readonly lines: readonly string[];
}

/** A row carrying the fields a parked wait is drawn from. */
type ParkedRow = Pick<BoardRow, "parkIndex" | "parkedAtIso" | "parkedWake" | "slug" | "summary">;

/**
 * What one park is grouped as: a clock, a CI park by what the wake reading found of its pull request, a CI park the
 * reading did not cover or could not read (`absent`) or no reading at all (`unjoined`), or a wake that did not read.
 */
type Group = "clock" | Exclude<WakeCiState, "unknown"> | "retired" | "absent" | "unjoined" | "unread";

/** The groups in the order the count names them and the fold lists them. */
const GROUP_ORDER: readonly Group[] = [
  "clock",
  "running",
  "finished",
  "merged",
  "closed",
  "retired",
  "absent",
  "unjoined",
  "unread",
];

/**
 * How the count line says each group, after its number and "parked". A retired park is no longer parked, so it is
 * never in the count line: it gets its own line ({@link retiredLine}).
 */
const GROUP_PHRASE: Readonly<Record<Exclude<Group, "retired">, string>> = {
  absent: "on CI the last wake did not read",
  closed: "on a pull request closed unmerged",
  clock: "on a clock",
  finished: "on an open pull request with no check still running",
  merged: "on a pull request that has merged",
  running: "on CI still running",
  // Never a bare "on CI": that is the line that said 57 waited on CI when none did.
  unjoined: "on CI no wake reading has measured",
  unread: "with a wake that did not read",
};

/** The groups that are due now: what they waited on already happened, so the next wake settles or reseats each. */
const DUE_GROUPS: ReadonlySet<Group> = new Set<Group>(["finished", "merged", "closed"]);

/** One park in its group, with its board position. */
interface Grouped {
  readonly position: number;
  readonly row: ParkedRow;
  readonly wake: BoardParkedWake;
  readonly group: Group;
}

/**
 * A clock instant as the page prints it, the date in front when it is not today.
 *
 * @returns `hh:mmZ`, or `D Mon hh:mmZ` when it is not today
 */
function clockOf({ atIso, nowMs }: { atIso: string; nowMs: number }): string {
  const clock = clockWords({ iso: atIso, nowMs });
  if (clock === undefined) {
    // The reader admits only an instant that parses, so this is the journalled text said as it stands.
    return atIso;
  }
  return clock;
}

/**
 * What one CI park waits on, in the words of what its pull request was when the wake read it.
 *
 * @param target `owner/repo#number`
 * @returns the detail words
 */
function ciDetailOf({ group, target }: { group: Group; target: string }): string {
  switch (group) {
    case "running": {
      return `waits on CI on ${target}, still running`;
    }
    case "finished": {
      return `${target} is open with no check still running; the next wake reseats it`;
    }
    case "merged": {
      return `${target} merged; the next wake settles or reseats it`;
    }
    case "closed": {
      return `${target} closed unmerged; the next wake reseats it`;
    }
    case "retired": {
      return `parked on ${target} until the last wake reseated or settled it, after this board was read; the next board read drops it`;
    }
    case "absent": {
      return `wakes when CI on ${target} finishes; the last wake did not read it`;
    }
    // A CI park is never grouped `clock` or `unread`; both stand here so a new group fails to compile.
    case "unjoined":
    case "clock":
    case "unread": {
      return `wakes when CI on ${target} finishes`;
    }
  }
}

/**
 * What one wake waits on, and when it wakes.
 *
 * @returns the detail words
 */
function detailOf({ group, nowMs, wake }: { group: Group; wake: BoardParkedWake; nowMs: number }): string {
  if (wake.kind === "unread") {
    return "what wakes it did not read";
  }
  if (wake.kind === "checks") {
    return ciDetailOf({ group, target: `${wake.repo}#${String(wake.number)}` });
  }
  const clock = clockOf({ atIso: wake.atIso, nowMs });
  if (group === "retired") {
    return `was to wake at ${clock}; the last wake reseated it after this board was read, and the next board read drops it`;
  }
  const ms = Date.parse(wake.atIso) - nowMs;
  if (ms <= 0) {
    return `due since ${clock}, the next tick reseats it`;
  }
  return `wakes at ${clock}, in ${spanWords({ ms })}`;
}

/**
 * A row's title: its summary's first clause when that is a short title, else its slug.
 *
 * @returns the title
 */
function titleOf({ row }: { row: ParkedRow }): string {
  if (row.summary === undefined) {
    return row.slug;
  }
  const clause = firstClause({ label: row.summary });
  if (clause === undefined) {
    return row.slug;
  }
  return clause;
}

/**
 * The group a CI park falls in: what the wake reading found of exactly this park — matched on the slug and the park's
 * position in its journal, with the instant it was journalled and its pull request held equal too, so a reading of an earlier park on the same row is never read as this
 * one's, whichever of the board and the reading is newer. A park the reading did not judge, could not read, or that
 * matches more than once, or a slug the board holds twice, is `absent`: unmeasured, never a state.
 *
 * @param parkedAtIso when the row's standing park was journalled, as the board read it
 * @param duplicate whether another board row carries the same slug
 * @param wakeCi the tick's last wake reading, `undefined` when none is in hand
 * @returns the group
 */
function ciGroupOf({
  duplicate,
  parkIndex,
  parkedAtIso,
  slug,
  wake,
  wakeCi,
}: {
  duplicate: boolean;
  parkIndex: number | undefined;
  parkedAtIso: string | undefined;
  slug: string;
  wake: BoardParkedWake & { kind: "checks" };
  wakeCi: WakeCiReading | undefined;
}): Group {
  if (wakeCi === undefined) {
    return "unjoined";
  }
  if (parkIndex === undefined || parkedAtIso === undefined) {
    return "absent";
  }
  const seen = wakeCi.rows.filter(
    (observation) =>
      observation.slug === slug &&
      observation.parkIndex === parkIndex &&
      observation.parkedAtIso === parkedAtIso &&
      observation.repo === wake.repo &&
      observation.number === wake.number,
  );
  const only = seen.length === 1 ? seen[0] : undefined;
  // Only a board read before that wake finished still holds a park the wake retired. The match is exact on
  // the park itself, so it drops the park even where another row shares the slug; a cleared park is
  // never judged, so retirement is read before an unknown state is.
  if (only?.retired === true) {
    return "retired";
  }
  // A STATE is never said of a slug the board holds twice: one verdict would read as two parks'.
  if (only === undefined || duplicate || only.state === "unknown") {
    return "absent";
  }
  return only.state;
}

/**
 * The group a clock park falls in: `clock`, read off the board alone, unless the wake reading says that very park
 * (slug, journal index, journalled instant and wake instant, exactly once) was reseated or cleared by the wake, after
 * this board was read. The match is exact on the park itself, so a second row sharing the slug does not
 * keep a gone park counted.
 *
 * @param wakeCi the tick's last wake reading, `undefined` when none is in hand
 * @returns the group
 */
function clockGroupOf({
  atIso,
  parkIndex,
  parkedAtIso,
  slug,
  wakeCi,
}: {
  atIso: string;
  parkIndex: number | undefined;
  parkedAtIso: string | undefined;
  slug: string;
  wakeCi: WakeCiReading | undefined;
}): Group {
  if (wakeCi === undefined) {
    return "clock";
  }
  const retired = wakeCi.retiredClocks.filter(
    (clock) =>
      clock.slug === slug &&
      clock.parkIndex === parkIndex &&
      clock.parkedAtIso === parkedAtIso &&
      clock.atIso === atIso,
  );
  return retired.length === 1 ? "retired" : "clock";
}

/**
 * Each parked row in its group.
 *
 * @returns the grouped parks, in board order
 */
function groupedOf({
  rows,
  wakeCi,
}: {
  rows: readonly ParkedRow[];
  wakeCi: WakeCiReading | undefined;
}): readonly Grouped[] {
  const grouped: Grouped[] = [];
  const slugCounts = new Map<string, number>();
  for (const { slug } of rows) {
    const before = slugCounts.get(slug);
    slugCounts.set(slug, before === undefined ? 1 : before + 1);
  }
  for (const [position, row] of rows.entries()) {
    const wake = row.parkedWake;
    if (wake === undefined) {
      continue;
    }
    let group: Group = "unread";
    const duplicate = slugCounts.get(row.slug)! > 1;
    const { parkIndex, parkedAtIso, slug } = row;
    if (wake.kind === "at") {
      group = clockGroupOf({ atIso: wake.atIso, parkIndex, parkedAtIso, slug, wakeCi });
    } else if (wake.kind === "checks") {
      group = ciGroupOf({ duplicate, parkIndex, parkedAtIso, slug, wake, wakeCi });
    }
    grouped.push({ group, position, row, wake });
  }
  return grouped;
}

/**
 * The count line: how many more are parked, and on what — the total said once, then each group as its own clause, or
 * the one group folded into the sentence when there is only one, so a single number is never printed twice.
 *
 * @param counts each group's count, in {@link GROUP_ORDER}, zeros left out
 * @returns `1 more is parked on CI still running, closed until it wakes.` and its plurals
 */
function countLine({ counts }: { counts: readonly { group: Exclude<Group, "retired">; count: number }[] }): string {
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  const only = counts.length === 1 ? counts[0] : undefined;
  if (only !== undefined) {
    const verb = total === 1 ? "is" : "are";
    const until = total === 1 ? "it wakes" : "they wake";
    return `${String(total)} more ${verb} parked ${GROUP_PHRASE[only.group]}, closed until ${until}.`;
  }
  const clauses = counts.map(({ count, group }) => `${String(count)} ${GROUP_PHRASE[group]}`);
  return `${String(total)} more are parked, closed until they wake: ${clauses.join(", ")}.`;
}

/**
 * The retired line: how many parks this board still holds that the last wake, finishing after the board was read,
 * already reseated, settled or cleared — never counted as parked, since they no longer are.
 *
 * @returns the line, or `undefined` when there are none
 */
function retiredLine({ retired }: { retired: number }): string | undefined {
  if (retired === 0) {
    return undefined;
  }
  if (retired === 1) {
    return "1 more on this board is no longer parked: the last wake reseated or settled it after the board was read.";
  }
  return `${String(retired)} more on this board are no longer parked: the last wake reseated or settled them after the board was read.`;
}

/**
 * The due line: how many CI parks already have what they waited on, so the next wake settles or reseats them.
 *
 * @returns the line, or `undefined` when none is due that way
 */
function dueLine({ due }: { due: number }): string | undefined {
  if (due === 0) {
    return undefined;
  }
  if (due === 1) {
    return "1 of them is due now: what it waited on already happened, so the next wake settles or reseats it.";
  }
  return `${String(due)} of them are due now: what they waited on already happened, so the next wake settles or reseats each.`;
}

/**
 * The rows parked on a clock or CI, clock wakes first by instant, then CI parks by what their pull request was when
 * the tick's wake read it (still running, finished, merged, closed, not read), then any whose wake did not read, each
 * group otherwise in board order; and the lines the Fleet page's state band draws under its working count: how many
 * and on what, how many of them are already due, then when the next clock wake is. Nothing parked on either draws no
 * line at all.
 *
 * @param rows every board row; only those carrying a wake are drawn
 * @param wakeCi the tick's last `handover wake` reading, `undefined` when none is in hand: the CI parks are then said
 *   only as "on CI no wake reading has measured"
 * @param nowMs the page's clock, which says whether a clock wake is due and how long until it
 * @returns the waits and the lines
 */
export function parkedWaitsOf({
  nowMs,
  rows,
  wakeCi,
}: {
  rows: readonly ParkedRow[];
  wakeCi: WakeCiReading | undefined;
  nowMs: number;
}): ParkedWaits {
  const grouped = groupedOf({ rows, wakeCi });
  if (grouped.length === 0) {
    return { lines: [], waits: [] };
  }
  const clocks = grouped
    .flatMap((it) => (it.wake.kind === "at" && it.group === "clock" ? [{ ...it, atIso: it.wake.atIso }] : []))
    .toSorted((left, right) => Date.parse(left.atIso) - Date.parse(right.atIso));
  const ordered = [...clocks, ...GROUP_ORDER.slice(1).flatMap((group) => grouped.filter((it) => it.group === group))];
  const waits = ordered.map(({ group, position, row, wake }): ParkedWait => ({
    detail: detailOf({ group, nowMs, wake }),
    key: `${row.slug}@${String(position)}`,
    slug: row.slug,
    title: titleOf({ row }),
    wake,
  }));
  const counts = GROUP_ORDER.flatMap((group) => (group === "retired" ? [] : [group]))
    .map((group) => ({ count: grouped.filter((it) => it.group === group).length, group }))
    .filter(({ count }) => count > 0);
  const lines: string[] = [];
  if (counts.length > 0) {
    lines.push(countLine({ counts }));
  }
  const due = dueLine({ due: grouped.filter(({ group }) => DUE_GROUPS.has(group)).length });
  if (due !== undefined) {
    lines.push(due);
  }
  const retired = retiredLine({ retired: grouped.filter(({ group }) => group === "retired").length });
  if (retired !== undefined) {
    lines.push(retired);
  }
  const next = clocks.at(0);
  if (next !== undefined) {
    const { atIso } = next;
    const clock = clockOf({ atIso, nowMs });
    const ms = Date.parse(atIso) - nowMs;
    if (ms <= 0) {
      lines.push(`The next clock wake was due at ${clock}; the next tick reseats it.`);
    } else {
      lines.push(`The next clock wake is ${clock}, in ${spanWords({ ms })}.`);
    }
  }
  return { lines, waits };
}
