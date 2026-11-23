/**
 * What one `session watch` reading of the open seats can and cannot see, for the doctrine panel's three seat lines
 * (`./fleetDoctrine.ts`): which seats it showed, which it could not read, and every reason a count off it is a floor or
 * no count at all. Split from `./fleetDoctrine.ts`, which composes the lines.
 *
 * Pure: the reading in, the sentences and groups out.
 */
import type { Seat as FullSeat } from "../components/live/readNow";
import type { DoctrineLine, DoctrineReason } from "./fleetDoctrineTypes";
import type { FleetGlance as FullGlance } from "./fleetGlance";
import { workingSessionsCountOf } from "./sidebarCounts";
import { counted } from "./sidebarCountsBasis";
import { terminalTitleOf } from "./workingSessions";

/**
 * The fields of the Fleet page's glance the panel reads, and why the ceiling is not in hand when its channel said so
 * (`doctrineGlanceOf`), so a line names that reason rather than only that the ceiling was not read.
 */
export type DoctrineGlance = Pick<FullGlance, "ceiling" | "working"> & {
  /** The glance's burst, its unread reason the capacity channel's own when that channel did not read. */
  readonly burst: DoctrineBurst;
  readonly ceilingWhy?: DoctrineReason;
  /** Set when the capacity or ceiling channel has nothing in hand yet, its first read still loading. */
  readonly pending?: true;
};

/** The glance's burst as the panel takes it: a capacity channel that did not read carries its reason apart. */
export type DoctrineBurst =
  Exclude<FullGlance["burst"], { readonly kind: "unread" }> | { readonly kind: "unread"; readonly why: DoctrineReason };

/**
 * Why the line has no ceiling to count against, with the ceiling channel's own reason when it gave one: a read's reason
 * stays quoted apart, so the panel says it plainly rather than inside this sentence (steer 7).
 *
 * @returns the reason, without a trailing stop
 */
export function ceilingUnreadOf({ glance }: { glance: DoctrineGlance }): DoctrineReason {
  const unread = "how many seats the plans' week carries was not read";
  if (glance.ceilingWhy === undefined) {
    return unread;
  }
  if (typeof glance.ceilingWhy !== "string") {
    return glance.ceilingWhy;
  }
  return `${unread}: ${glance.ceilingWhy}`;
}

/** The fields of one open seat the panel reads. */
export type Seat = Pick<FullSeat, "manager" | "sessionTitle" | "signal" | "title" | "workspaceId" | "workspaceRef">;

/** The seats the panel reads: every open seat in the tick's `session watch`. */
export interface DoctrineSeats {
  readonly rows: readonly Seat[];
  /** Rows `session watch` left out as too old to be a seat. */
  readonly suppressed: number;
  /** What the drain KNOWS it could not see (`src/sessions/watchReport.ts`); any one makes every seat count not read. */
  readonly diagnostics: readonly string[];
}

/**
 * The sentence naming what session watch could not see, when it reported anything.
 *
 * @returns the sentence, or `undefined` when the drain saw everything it knows of
 */
export function blindSpotOf({ seats }: { seats: DoctrineSeats }): string | undefined {
  const parts: string[] = [];
  const unknown = unknownSignalSeatsOf({ seats });
  if (unknown.length > 0) {
    parts.push(`${counted({ count: unknown.length, many: "seats", one: "seat" })} with a state that did not read`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `session watch could not see everything (${parts.join("; ")}).`;
}

/**
 * Why a seat count cannot be bounded while session watch reported a problem, or `undefined` when it reported none.
 *
 * A problem cuts both ways, so no floor holds: an inventory that would not read keeps every retained row, a
 * workspace that closed included (`src/sessions/watchReport.ts`'s `reportedSessionWatchRows`), and a cursor that
 * aged out can leave a seat's state behind its events. A seat left out as too quiet, or one whose state did not
 * read, only hides a seat, so those stay floors.
 *
 * @returns the reason, without a trailing stop
 */
export function diagnosedWhyOf({ seats }: { seats: DoctrineSeats }): string | undefined {
  if (seats.diagnostics.length === 0) {
    return undefined;
  }
  const problems = counted({ count: seats.diagnostics.length, many: "problems", one: "problem" });
  return `session watch reported ${problems}, so a seat it shows may have closed and one it does not may be open`;
}

/**
 * Every reason the working count stands on nothing: a problem session watch reported cuts both ways, and
 * a glance whose working count is not session watch's own rows' was handed a different reading, since `fleetGlance.ts`
 * counts those rows by the same function. Both are named when both hold.
 *
 * @returns the reasons, each without a trailing stop, or none when the count is the rows'
 */
export function withdrawnWhysOf({
  glance,
  seats,
}: {
  glance: DoctrineGlance;
  seats: DoctrineSeats;
}): readonly string[] {
  const why: string[] = [];
  const diagnosed = diagnosedWhyOf({ seats });
  if (diagnosed !== undefined) {
    why.push(diagnosed);
  }
  const rowsWorking = workingSessionsCountOf({ seats: seats.rows }).count;
  if (rowsWorking !== glance.working) {
    why.push(
      `the page counted ${String(glance.working)} working against a session watch reading listing ${String(rowsWorking)}, so the two are not the same reading`,
    );
  }
  return why;
}

/**
 * Every seat session watch showed whose state read, named as a place not checked, for a line withdrawn over a reported
 * problem: each may have closed, or be in a state its events moved past, so each could change the count.
 * A seat whose state did not read is already named by {@link blindGroupsOf}.
 *
 * @returns the group, or none when it showed no such seat
 */
export function shownGroupsOf({ seats }: { seats: DoctrineSeats }): DoctrineLine["groups"] {
  const items = seats.rows
    .filter((seat) => SEAT_SIGNALS.has(seat.signal))
    .map((seat) => ({ href: undefined, key: seat.workspaceId, text: `${seatPlaceOf({ seat })}, ${seat.signal}` }));
  if (items.length === 0) {
    return [];
  }
  return [{ items, label: "shown by session watch, not checked" }];
}

/** The signals `session watch` prints (`site/components/live/readNow.ts`'s `Seat.signal`). */
const SEAT_SIGNALS: ReadonlySet<string> = new Set(["working", "needs-input", "idle", "silent"]);

/**
 * Seats whose signal is not one session watch prints: any of them could be working, so each is a place not checked.
 *
 * @returns the seats
 */
export function unknownSignalSeatsOf({ seats }: { seats: DoctrineSeats }): readonly Seat[] {
  return seats.rows.filter((seat) => !SEAT_SIGNALS.has(seat.signal));
}

/**
 * Each problem session watch reported, and each seat whose state did not read, named in a folded group, so the
 * sentence stays short and every place it could not look is still there to open.
 *
 * @returns the group, or none when it saw everything
 */
export function blindGroupsOf({ seats }: { seats: DoctrineSeats }): DoctrineLine["groups"] {
  const items = [
    ...[...new Set(seats.diagnostics)].map((text) => ({ href: undefined, key: text, text })),
    ...unknownSignalSeatsOf({ seats }).map((seat) => ({
      href: undefined,
      key: seat.workspaceId,
      text: `${seatPlaceOf({ seat })}, state "${seat.signal}" did not read`,
    })),
  ];
  if (items.length === 0) {
    return [];
  }
  return [{ items, label: "not checked" }];
}

/**
 * A seat's name as an item: the title it gave itself, else its cmux title without the glyph, else its ref, else its id.
 *
 * @returns the name
 */
export function seatName({ seat }: { seat: Seat }): string {
  if (seat.sessionTitle !== undefined) {
    return seat.sessionTitle;
  }
  if (seat.title !== undefined && terminalTitleOf({ title: seat.title }) !== "") {
    return terminalTitleOf({ title: seat.title });
  }
  if (seat.workspaceRef !== undefined) {
    return seat.workspaceRef;
  }
  return seat.workspaceId;
}

/**
 * A seat named as a place not checked: its name, and the workspace it is in whenever the name is not already that,
 * so the reader can find it in cmux.
 *
 * @returns the name, with its workspace ref or id
 */
export function seatPlaceOf({ seat }: { seat: Seat }): string {
  const name = seatName({ seat });
  let where = seat.workspaceId;
  if (seat.workspaceRef !== undefined) {
    where = seat.workspaceRef;
  }
  return name === where ? name : `${name} (${where})`;
}
