/**
 * The Fleet page's doctrine panel: five lines that say whether the fleet is running the way the owner's doctrine says,
 * each DERIVED from a reading the supervisor tick already recorded, none omitted, and a reading that did not arrive
 * said as not read — never as a zero.
 *
 * The owner needs to see that the fleet is actually running the way the doctrine says it should, so the page shows
 * what the chair's "the board is quiet" would hide: measured, 58 relay rows, four red drafts of the owner's and seven
 * parked runs sat unseated, with two supervisor workspaces open. The five lines, in the order the owner reads them:
 *
 * 1. **Seats against capacity** — the working seats against the working seats the plans' week carries, both off
 *    the page's glance (`./fleetGlance.ts`), never counted a second time.
 * 2. **Board rows kept from a seat, and why** — `./fleetDoctrineRows.ts`.
 * 3. **The owner's open pull requests with no seat** — `./fleetDoctrinePulls.ts`.
 * 4. **Supervisor workspaces open** — every open seat whose cmux title is `/slopweaver:supervisor`, pinned or not
 *    (`src/cmux/supervisorWorkspace.ts`'s title; the pin alone would miss the second copy). More than one is red.
 * 5. **Plan headroom unused** — the seats the week carries that nobody is in, and the plans behind their week whose
 *    five-hour burst nobody is drawing, off the same glance; the usage lines beside it carry the per-plan figures.
 *
 * Pure: the readings in, the lines out. The panel lays them out and decides nothing.
 */
import { unreadSentenceOf } from "./fleetDoctrineGaps";
import { pullRequestsLineOf } from "./fleetDoctrinePulls";
import { unseatableLineOf } from "./fleetDoctrineRows";
import {
  blindGroupsOf,
  blindSpotOf,
  ceilingUnreadOf,
  type DoctrineGlance,
  type DoctrineSeats,
  diagnosedWhyOf,
  seatName,
  seatPlaceOf,
  shownGroupsOf,
  unknownSignalSeatsOf,
  withdrawnWhysOf,
} from "./fleetDoctrineSeats";
import type {
  DoctrineBoard,
  DoctrineInput,
  DoctrineItem,
  DoctrineLanding,
  DoctrineLine,
  DoctrineReason,
  DoctrineReconcile,
  FleetDoctrine,
} from "./fleetDoctrineTypes";
import type { QuotedReason } from "./quotedReason";
import { counted } from "./sidebarCountsBasis";
import { terminalTitleOf } from "./workingSessions";

/** The title `cmux takeover` sets on the workspace it pins, restated because `site/` imports nothing from `src/`. */
export const SUPERVISOR_TITLE = "/slopweaver:supervisor";

/**
 * The first line: working seats against what the plans' week carries.
 *
 * @returns the line
 */
function seatsLineOf({ glance, seats }: { glance: DoctrineGlance; seats: DoctrineSeats }): DoctrineLine {
  const items: DoctrineItem[] = seats.rows
    .filter((seat) => seat.signal === "working")
    .map((seat) => ({ href: undefined, key: seat.workspaceId, text: seatName({ seat }) }));
  const groups = [...(items.length > 0 ? [{ items, label: "working now" }] : []), ...blindGroupsOf({ seats })];
  const withdrawn = withdrawnWhysOf({ glance, seats });
  if (withdrawn.length > 0) {
    const why: DoctrineReason[] = [...withdrawn];
    const blind = blindSpotOf({ seats });
    if (blind !== undefined) {
      why.push(blind.replace(/\.$/u, ""));
    }
    if (glance.ceiling === undefined) {
      why.push(ceilingUnreadOf({ glance }));
    }
    return {
      groups: [...shownGroupsOf({ seats }), ...blindGroupsOf({ seats })],
      key: "seats",
      ...unreadSentenceOf({ reasons: why, subject: "Seats working" }),
      tone: "unread",
    };
  }
  // A seat session watch left out as too quiet is not a gap in THIS count: it is left out only
  // when the cmux inventory read and did not list its workspace, so it is not open, and only once it has been quiet an
  // hour, while `classifySession` calls a seat working only inside the idle window, 10 minutes by default
  // (`src/sessions/watchReport.ts`'s `reportedSessionWatchRows`, `src/cmux/sessionActivity.ts`).
  const blindSpot = blindSpotOf({ seats });
  let working = counted({ count: glance.working, many: "seats", one: "seat" });
  if (blindSpot !== undefined) {
    // A floor is a number, so zero reads "At least 0 seats", never "At least no seat".
    working = `At least ${String(glance.working)} ${glance.working === 1 ? "seat" : "seats"}`;
  }
  const tail = blindSpot === undefined ? [] : [blindSpot];
  if (glance.ceiling === undefined) {
    const ceiling = clauseOf({ reason: ceilingUnreadOf({ glance }), said: CEILING_UNREAD });
    return {
      groups,
      key: "seats",
      quoted: ceiling.quoted,
      sentence: [`${working} working; ${ceiling.clause}.`, ...tail].join(" "),
      tone: "unread",
    };
  }
  let tone: DoctrineLine["tone"] = "attention";
  if (glance.working >= glance.ceiling) {
    // A full week behind a blind spot is still a count nobody checked whole, so it never reads ok.
    tone = blindSpot === undefined ? "ok" : "unread";
  }
  return {
    groups,
    key: "seats",
    quoted: [],
    sentence: [`${working} working of the ${String(glance.ceiling)} the plans' week carries.`, ...tail].join(" "),
    tone,
  };
}

/** What a sentence says in its own clause when the ceiling's channel quoted a read's reason, which is drawn beneath. */
const CEILING_UNREAD = "how many seats the plans' week carries was not read";

/**
 * A reason as a clause inside a sentence: the console's own words stand there as themselves, while a read's reason
 * leaves `said` in the sentence and is quoted beneath it, said plainly with its raw message folded (steer 7).
 *
 * @param reason the reason
 * @param said the clause the sentence carries in a quoted reason's place
 * @returns the clause and the reasons quoted beneath it
 */
function clauseOf({ reason, said }: { reason: DoctrineReason; said: string }): {
  readonly clause: string;
  readonly quoted: readonly QuotedReason[];
} {
  if (typeof reason === "string") {
    return { clause: reason, quoted: [] };
  }
  return { clause: said, quoted: [reason] };
}

/**
 * The fourth line: how many supervisor workspaces are open. One is the doctrine; two is a breach.
 *
 * @returns the line
 */
function supervisorsLineOf({ seats }: { seats: DoctrineSeats }): DoctrineLine {
  const supervisors = seats.rows.filter(
    (seat) => seat.title !== undefined && terminalTitleOf({ title: seat.title }) === SUPERVISOR_TITLE,
  );
  const untitledSeats = seats.rows.filter((seat) => seat.title === undefined);
  const untitled = untitledSeats.length;
  const items = supervisors.map((seat) => {
    let ref = seat.workspaceId;
    if (seat.workspaceRef !== undefined) {
      ref = seat.workspaceRef;
    }
    return {
      href: undefined,
      key: seat.workspaceId,
      text: `${ref}, ${seat.manager === true ? "pinned" : "not pinned"}`,
    };
  });
  const residue: string[] = [];
  if (untitled > 0) {
    residue.push(
      `${counted({ count: untitled, many: "open seats carry", one: "open seat carries" })} no title, so a copy could hide there.`,
    );
  }
  if (seats.suppressed > 0) {
    residue.push(
      `session watch left out ${counted({ count: seats.suppressed, many: "seats", one: "seat" })} too quiet to count.`,
    );
  }
  const blindSpot = blindSpotOf({ seats });
  if (blindSpot !== undefined) {
    residue.push(blindSpot);
  }
  // Each seat with no title is named, since a second supervisor could be any one of them.
  const untitledItems = untitledSeats.map((seat) => ({
    href: undefined,
    key: seat.workspaceId,
    text: seatPlaceOf({ seat }),
  }));
  const diagnosed = diagnosedWhyOf({ seats });
  const groups = [
    ...(items.length > 0
      ? [{ items, label: diagnosed === undefined ? "supervisor workspaces" : "shown by session watch, not checked" }]
      : []),
    ...(untitledItems.length > 0 ? [{ items: untitledItems, label: "no title, not checked" }] : []),
    ...blindGroupsOf({ seats }),
  ];
  if (diagnosed !== undefined) {
    // Every other place not checked is named beside the problem, never dropped behind it.
    const why = [diagnosed, ...residue.map((part) => part.replace(/\.$/u, ""))];
    return {
      groups,
      key: "supervisors",
      ...unreadSentenceOf({ reasons: why, subject: "Supervisor workspaces open" }),
      tone: "unread",
    };
  }
  // A seat with no title, one session watch left out, or one it could not see was never checked: a count is a floor.
  const floor = residue.length > 0;
  // A zero over unchecked seats is scoped to the seats looked at, and reads unread: an unchecked seat could make it
  // none, one or two, so no tone holds.
  let sentence = floor
    ? "None of the titled seats looked at is a supervisor workspace."
    : "No supervisor workspace is open.";
  let tone: DoctrineLine["tone"] = floor ? "unread" : "attention";
  if (supervisors.length === 1) {
    sentence = floor ? "At least 1 supervisor workspace is open." : "1 supervisor workspace is open.";
    // A seat never checked could be the second copy, so a floor of one is not the doctrine met.
    tone = floor ? "unread" : "ok";
  } else if (supervisors.length > 1) {
    const atLeast = floor ? "At least " : "";
    sentence = `${atLeast}${String(supervisors.length)} supervisor workspaces are open; there should be one.`;
    tone = "danger";
  }
  return { groups, key: "supervisors", quoted: [], sentence: [sentence, ...residue].join(" "), tone };
}

/**
 * The fifth line: the plan headroom nobody is using — empty seats the week carries, and a burst left undrawn.
 *
 * @returns the line
 */
function headroomLineOf({ glance, seats }: { glance: DoctrineGlance; seats: DoctrineSeats }): DoctrineLine {
  const withdrawn = withdrawnWhysOf({ glance, seats });
  if (glance.ceiling === undefined || withdrawn.length > 0) {
    // The burst and session watch's blind spot are named beside the ceiling, never dropped behind it.
    // A withdrawn working count leaves the empty seats unbounded either way.
    const why: DoctrineReason[] = [...withdrawn];
    if (glance.ceiling === undefined) {
      why.push(ceilingUnreadOf({ glance }));
    }
    if (glance.burst.kind === "unread") {
      why.push(glance.burst.why);
    }
    const blindSpot = blindSpotOf({ seats });
    if (blindSpot !== undefined) {
      why.push(blindSpot.replace(/\.$/u, ""));
    }
    return {
      groups: [...(withdrawn.length === 0 ? [] : shownGroupsOf({ seats })), ...blindGroupsOf({ seats })],
      key: "headroom",
      ...unreadSentenceOf({ reasons: why, subject: "Plan headroom unused" }),
      tone: "unread",
    };
  }
  let free = glance.ceiling - glance.working;
  if (free < 0) {
    free = 0;
  }
  // A working count that is a floor makes the empty seats a ceiling, and the line names why on every branch.
  const blindSpot = blindSpotOf({ seats });
  const atMost = blindSpot === undefined ? "" : "At most ";
  let sentence = `${atMost}${counted({ count: free, many: "seats", one: "seat" })} the plans' week carries ${free === 1 ? "sits" : "sit"} empty`;
  if (free === 0 && blindSpot === undefined) {
    sentence = "Every seat the plans' week carries is in use";
  } else if (free === 0) {
    sentence = "As far as session watch could see, every seat the plans' week carries is in use";
  }
  let tone: DoctrineLine["tone"] = free > 0 ? "attention" : "ok";
  const burst = glance.burst;
  let groups: DoctrineLine["groups"] = [];
  let quoted: readonly QuotedReason[] = [];
  if (burst.kind === "unread") {
    const why = burst.why;
    if (typeof why === "string") {
      sentence = `${sentence}; whether a plan is behind its week was not read: ${why}.`;
    } else {
      // The capacity channel's own reason is quoted beneath, never inside the sentence (steer 7).
      sentence = `${sentence}; whether a plan is behind its week was not read.`;
      quoted = [why];
    }
  } else if (burst.open.length > 0 && !burst.taken) {
    const plans =
      burst.open.length === 1
        ? "1 plan is behind its week"
        : `${String(burst.open.length)} plans are behind their week`;
    // The burst is drawn once more seats work than the week carries (`fleetGlance.ts`), and a seat whose state did not
    // read can only add to the working count: undrawn holds only while even all of them working stays within the
    // week's seats. The burst's plans are named either way.
    const couldDraw = glance.working + unknownSignalSeatsOf({ seats }).length > glance.ceiling;
    const asFar = couldDraw ? " as far as session watch could see" : "";
    sentence = `${sentence}, and ${plans} with the five-hour burst undrawn${asFar}.`;
    tone = "attention";
    groups = [
      { items: burst.open.map((alias) => ({ href: undefined, key: alias, text: alias })), label: "behind their week" },
    ];
  } else if (burst.taken) {
    sentence = `${sentence}, drawing above the week's pace on plans behind it.`;
  } else {
    sentence = `${sentence}, and no plan is behind its week.`;
  }
  if (blindSpot !== undefined) {
    sentence = `${sentence} ${blindSpot}`;
  }
  // Nothing found to act on is not the doctrine met while a seat or the burst went unseen.
  if (tone === "ok" && (blindSpot !== undefined || burst.kind === "unread")) {
    tone = "unread";
  }
  return { groups: [...groups, ...blindGroupsOf({ seats })], key: "headroom", quoted, sentence, tone };
}

/**
 * The doctrine panel: its five lines, in the order the owner reads them.
 *
 * @param glance the Fleet page's glance, the one derivation of working seats, their ceiling and the burst
 * @param seats every open seat the tick's `session watch` read, or why that reading is not in hand
 * @param reconcile the same tick's reconcile, or why it is not in hand
 * @param board the board rows, or why they are not in hand
 * @param landing the last `github landing` reading, or why it is not in hand
 * @returns the panel
 */
export function fleetDoctrineOf({
  glance,
  seats,
  reconcile,
  board,
  landing,
}: {
  glance: DoctrineGlance;
  seats: DoctrineInput<DoctrineSeats>;
  reconcile: DoctrineInput<DoctrineReconcile>;
  board: DoctrineInput<DoctrineBoard>;
  landing: DoctrineInput<DoctrineLanding>;
}): FleetDoctrine {
  const rows = unseatableLineOf({ board, reconcile });
  const pulls = pullRequestsLineOf({ board, landing, reconcile });
  const ceilingWhy = glance.ceiling === undefined ? [ceilingUnreadOf({ glance })] : [];
  const burstWhy = glance.burst.kind === "unread" ? [glance.burst.why] : [];
  const unread = ({
    key,
    subject,
    why,
  }: {
    key: DoctrineLine["key"];
    subject: string;
    why: readonly DoctrineReason[];
  }): DoctrineLine => ({
    groups: [],
    key,
    ...unreadSentenceOf({ reasons: why, subject }),
    tone: "unread",
  });
  if (seats.kind === "unread") {
    // The glance's working count is off the same seats, so all three seat lines are withdrawn together.
    // Every other reading the line also stands on and lacks is named beside it, never only the first.
    return {
      lines: [
        unread({ key: "seats", subject: "Seats working", why: [seats.why, ...ceilingWhy] }),
        rows,
        pulls,
        unread({ key: "supervisors", subject: "Supervisor workspaces open", why: [seats.why] }),
        unread({ key: "headroom", subject: "Plan headroom unused", why: [seats.why, ...ceilingWhy, ...burstWhy] }),
      ],
    };
  }
  return {
    lines: [
      seatsLineOf({ glance, seats: seats.value }),
      rows,
      pulls,
      supervisorsLineOf({ seats: seats.value }),
      headroomLineOf({ glance, seats: seats.value }),
    ],
  };
}
