/*
 * The Fleet page's state, in words: the badge, the lines under it, and the defence that answers "why is the
 * fleet not running more right now?". `fleetGlance.ts` judges; this module only words that judgement and lays out the
 * evidence behind it, so a page and a test read the same sentence.
 *
 * The order is fixed: the state badge first, then ONE plain sentence as if the owner said it, with no apology; then a defence shaped like a Queue card's quote block, carrying the measurement window
 * and the top consumers by name for a machine hold, and when an investigation started and which session has it.
 */
import type { Capacity, CapacityInvestigation, CpuConsumer, MemoryConsumer } from "../components/live/readNow";
import type { FleetGlance } from "./fleetGlance";
import { holdPhrase, machineLines, oneDecimal } from "./fleetStateMachine";
import type { OpenOrder } from "./fleetViews";
import { type JoinedNowSeat, joinGapWords, type NowSeatsView } from "./nowSeats";

/** The fleet's state, one per badge. */
export type FleetStateKind =
  | "at-capacity"
  | "picking-up"
  | "holding-machine"
  | "holding-board"
  | "holding-plans"
  | "holding-pace"
  | "not-measured";

/** The badge each state reads as — the first words on the page. */
export const FLEET_BADGES: Readonly<Record<FleetStateKind, string>> = {
  "at-capacity": "at capacity",
  "holding-board": "holding: nothing ready",
  "holding-machine": "holding: machine busy",
  "holding-pace": "holding: at the week's pace",
  "holding-plans": "holding: plans won't take another session",
  "not-measured": "not measured",
  "picking-up": "picking up more",
};

/** Whether a load investigation is running, and which session has it. */
export type FleetInvestigation =
  | {
      readonly kind: "active";
      readonly startedIso: string;
      /** The board row the session works, as its label reads. */
      readonly session: string;
      readonly slug: string;
      readonly why: string;
    }
  | { readonly kind: "none"; readonly why: string }
  | { readonly kind: "unknown"; readonly why: string }
  | { readonly kind: "not-applicable" };

/** How many consumers the defence names before the fold. */
export const CONSUMERS_SHOWN = 3;

/** The heaviest processes, the first {@link CONSUMERS_SHOWN} shown and the rest folded. */
export interface ConsumerList<T> {
  readonly shown: readonly T[];
  readonly folded: readonly T[];
}

/** The defence: why the fleet runs what it runs, with the figures and the names behind it. */
export interface FleetDefence {
  readonly headline: string;
  readonly measurements: readonly string[];
  /** When the capacity reading was taken, `undefined` when there was none. */
  readonly readAtIso: string | undefined;
  /** Present for a machine hold only: the CPU and memory consumers, never claimed as the cause. */
  readonly cpu: ConsumerList<CpuConsumer> | undefined;
  readonly memory: ConsumerList<MemoryConsumer> | undefined;
  readonly investigation: FleetInvestigation;
}

/**
 * The working count and what follows it, one clause per line. A single line joined on em dashes
 * breaks two of the owner's voice rules at once, so the page draws each line as its own paragraph.
 */
export interface FleetSentence {
  /** `6 working`, always first, in stronger type. */
  readonly lead: string;
  /** One complete sentence per displayed line. */
  readonly lines: readonly string[];
}

/** The whole state. */
export interface FleetState {
  readonly kind: FleetStateKind;
  readonly badge: string;
  readonly sentence: FleetSentence;
  readonly defence: FleetDefence;
}

/**
 * The state a glance verdict is — the badge above the page and each span of its history both read this.
 *
 * @param glance the verdict and the ceiling that binds it
 * @returns the kind
 */
export function fleetStateKindOf({ glance }: { glance: Pick<FleetGlance, "binding" | "verdict"> }): FleetStateKind {
  if (glance.verdict === "capacity maxed") {
    return "at-capacity";
  }
  if (glance.verdict === "seats free") {
    return "picking-up";
  }
  if (glance.verdict === "burst unused") {
    return "holding-pace";
  }
  if (glance.verdict === "not measured") {
    return "not-measured";
  }
  if (glance.binding === "machine load") {
    return "holding-machine";
  }
  if (glance.binding === "board") {
    return "holding-board";
  }
  return "holding-plans";
}

/**
 * The phrase for a count of ready rows.
 *
 * @returns `1 ready row has` or `3 ready rows have`
 */
function readyRows({ n }: { n: number }): string {
  if (n === 1) {
    return "1 ready row has";
  }
  return `${String(n)} ready rows have`;
}

/**
 * What follows the working count, one sentence per line.
 *
 * @returns the lines
 */
function linesOf({
  kind,
  glance,
  capacity,
  order,
}: {
  kind: FleetStateKind;
  glance: FleetGlance;
  capacity: Capacity | undefined;
  order: OpenOrder | undefined;
}): readonly string[] {
  if (kind === "holding-machine" && capacity !== undefined) {
    return machineLines({ capacity });
  }
  if (kind === "holding-board") {
    return ["Every ready row already has a session.", "The next one starts when a row becomes ready."];
  }
  if (kind === "holding-plans") {
    return ["No Claude plan will take another session.", "The next one starts when a plan reopens."];
  }
  if (kind === "holding-pace" && glance.ceiling !== undefined) {
    return [`The plans' week paces ${String(glance.ceiling)}.`, "The plans behind their week could carry more."];
  }
  if (kind === "picking-up") {
    if (order?.kind === "open") {
      return [`${readyRows({ n: order.open.length })} nobody on yet.`, "The fleet picks them up next."];
    }
    return ["There is room for more within the plans' week."];
  }
  if (kind === "not-measured" && glance.binding === "board") {
    return ["The plans' week has room for more.", "Whether a ready row has nobody on it was not read."];
  }
  if (kind === "at-capacity") {
    if (glance.burst.kind === "read" && glance.burst.taken && glance.ceiling !== undefined) {
      return [
        `That is above the ${String(glance.ceiling)} the week paces.`,
        "The fleet is using the plans behind their week.",
      ];
    }
    return ["That is the most the plans' week carries at the measured burn."];
  }
  return ["How many more the plans can carry is not measured right now."];
}

/**
 * The headline the defence opens on.
 *
 * @returns the headline
 */
function headlineOf({
  kind,
  glance,
  capacity,
}: {
  kind: FleetStateKind;
  glance: FleetGlance;
  capacity: Capacity | undefined;
}): string {
  if (kind === "holding-machine" && capacity !== undefined) {
    return `The machine is holding new sessions: ${holdPhrase({ capacity })}.`;
  }
  if (kind === "holding-board") {
    return "Every ready row on the board already has a session.";
  }
  return glance.why;
}

/**
 * The figures behind the state.
 *
 * @returns one line per figure
 */
function measurementsOf({
  kind,
  glance,
  capacity,
}: {
  kind: FleetStateKind;
  glance: FleetGlance;
  capacity: Capacity | undefined;
}): readonly string[] {
  const lines: string[] = [];
  if (glance.ceiling === undefined) {
    lines.push(`${String(glance.working)} working; how many the plans' week carries is not measured`);
  } else {
    lines.push(`${String(glance.working)} working; the plans' week carries ${String(glance.ceiling)}`);
  }
  if (kind === "holding-machine" && capacity !== undefined) {
    lines.push(
      `load ${oneDecimal({ value: capacity.load1 })} / ${oneDecimal({ value: capacity.load5 })} / ${oneDecimal({ value: capacity.load15 })} over 1, 5 and 15 minutes; the hold is judged on the 1-minute figure at ${String(capacity.loadHold)}`,
    );
  }
  return lines;
}

/**
 * The first few of a list, and the rest.
 *
 * @returns the split list
 */
function splitList<T>({ list }: { list: readonly T[] }): ConsumerList<T> {
  return { folded: list.slice(CONSUMERS_SHOWN), shown: list.slice(0, CONSUMERS_SHOWN) };
}

/**
 * Every working seat with its board row, off a joined view.
 *
 * @returns the working seats placed on a row
 */
function workingPlaced({ view }: { view: NowSeatsView & { kind: "joined" } }): readonly JoinedNowSeat[] {
  return [...view.working, ...view.betweenTurns, ...view.notOnBoard].filter(
    (joined) => joined.seat.signal === "working" && joined.placement !== undefined,
  );
}

/**
 * Whether a load investigation is running: a covering dispatch raised by the hold whose board row a working seat is
 * on right now. An open row alone is not one — the register keeps rows whose session has long gone.
 *
 * @returns the investigation, or why there is none
 */
export function investigationOf({
  capacity,
  view,
}: {
  capacity: Capacity | undefined;
  view: NowSeatsView;
}): FleetInvestigation {
  if (capacity === undefined || !capacity.hold) {
    return { kind: "not-applicable" };
  }
  const investigations: readonly CapacityInvestigation[] | undefined = capacity.dispatch?.investigations;
  if (investigations === undefined) {
    return { kind: "unknown", why: "this capacity reading predates the investigations it carries" };
  }
  if (view.kind === "signal-only") {
    return {
      kind: "unknown",
      why: `the sessions could not be matched to an investigation: ${joinGapWords({ reason: view.reason })}`,
    };
  }
  const working = workingPlaced({ view });
  for (const investigation of investigations) {
    if (!investigation.triggers.includes("hold")) {
      continue;
    }
    const seat = working.find((joined) => joined.placement?.row.id === investigation.slug);
    if (seat?.placement !== undefined) {
      return {
        kind: "active",
        session: seat.placement.row.label,
        slug: investigation.slug,
        startedIso: investigation.observedIso,
        why: investigation.subjectWhy,
      };
    }
  }
  if (investigations.length > 0) {
    return {
      kind: "none",
      why: "no session is looking into it, and the investigations still open have no working session on them",
    };
  }
  return { kind: "none", why: "no session is looking into it" };
}

/**
 * The Fleet page's state, sentence and defence.
 *
 * @param glance the judgement `fleetGlanceOf` made
 * @param capacity the machine capacity reading the glance judged, `undefined` until it arrives
 * @param readAtIso when that reading was taken
 * @param view the seats joined to the board, which the investigation join reads
 * @param order the ready rows no seat is on, `undefined` until the board reads
 * @returns the state
 */
export function fleetStateOf({
  glance,
  capacity,
  readAtIso,
  view,
  order,
}: {
  glance: FleetGlance;
  capacity: Capacity | undefined;
  readAtIso: string | undefined;
  view: NowSeatsView;
  order: OpenOrder | undefined;
}): FleetState {
  const kind = fleetStateKindOf({ glance });
  const machine = kind === "holding-machine" && capacity !== undefined;
  let cpu: ConsumerList<CpuConsumer> | undefined;
  let memory: ConsumerList<MemoryConsumer> | undefined;
  if (machine && capacity.cpu !== undefined) {
    cpu = splitList({ list: capacity.cpu.hogs });
  }
  if (machine && capacity.memory !== undefined) {
    memory = splitList({ list: capacity.memory });
  }
  return {
    badge: FLEET_BADGES[kind],
    defence: {
      cpu,
      headline: headlineOf({ capacity, glance, kind }),
      investigation: investigationOf({ capacity, view }),
      measurements: measurementsOf({ capacity, glance, kind }),
      memory,
      readAtIso,
    },
    kind,
    sentence: { lead: `${String(glance.working)} working`, lines: linesOf({ capacity, glance, kind, order }) },
  };
}
