/**
 * The console sidebar's entries, the count each one carries, and the derivation behind every count. Pure: the shell
 * (`../components/console/Shell.tsx`) draws only what this decides, over the live readings it already holds.
 *
 * Every sidebar item carries a number badge that is meaningful. A workstream count reaches zero when every
 * workstream is complete, never a hundred. Each page's number:
 *
 * - Workstreams: the unfinished ones in the context shown, reaching zero when every one is done.
 * - Automations: the active automations — switched on whenever it next runs; pausing one stops it counting.
 * - Fleet: the active session count — the seats working now.
 * - Alignment: the general-ruling questions not yet answered — the cards that need the owner's call, never the acts
 *   the fleet already did, so the number is one the owner would actually answer.
 *
 * The sidebar holds the queue, pull requests, workstreams, automations and fleet: every element on the UI must earn
 * its place, so a page the owner does not visit is not there. The Steers record folds into the Alignment page, which
 * tracks steers and alignment over time, and the Talk & voice page is retired, its controls and record in the call
 * widget.
 *
 * Alignment is a sidebar entry, between Queue and Pull requests, its one way in: how Slopweaver aligns with the owner
 * while they live in it must be prominent.
 *
 * Settings and Docs carry no number, BY DESIGN and said in each row's hover: Settings is a modal of plans and
 * preferences, and Docs is reference. Every entry names its decision in {@link SIDEBAR_ENTRIES}, so an entry cannot be
 * added without one. Settings carries a dot instead while no plan is connected, since the Setup page went into it
 * and its Models section is where an install with nothing to run on starts: the dot makes clear that the owner needs
 * to come here right now.
 *
 * The other counts are NEUTRAL (`attention: false`): Queue and Pull requests are the two drawn hot, as waiting on the owner's
 * word. Alignment's especially, though it sits next to the Queue: nothing on that page chases the owner
 * (`docs/console/alignment.md`).
 */
import type { AutomationsView } from "../components/live/readAutomations";
import { counted, type SidebarCount, type SidebarReading } from "./sidebarCountsBasis";
import type { WorkContext } from "./workContext";
import { inContext } from "./workstreamFilter";
import { isWorkstreamsAbsent, type WorkstreamsReading } from "./workstreamsReading";
import type { WorkstreamsView } from "./workstreamTiles";

/** What an entry's badge is: a count, drawn hot or neutral, or none at all and why. */
export type SidebarBadgeDecision =
  | {
      readonly kind: "count";
      /** Whether a nonzero count is drawn as waiting on the owner. */
      readonly attention: boolean;
      /** What the count counts, as policy; the live title says what was measured. */
      readonly means: string;
    }
  | { readonly kind: "none"; readonly why: string };

/** Every sidebar entry, by name. */
export type SidebarEntryKey =
  "queue" | "alignment" | "pull-requests" | "workstreams" | "automations" | "fleet" | "settings" | "docs";

/** One sidebar entry: where it goes, how it is drawn, and its badge. */
export interface SidebarEntry {
  readonly key: SidebarEntryKey;
  /** The page it links to; `null` for Settings, which opens as a modal over the page rather than going anywhere. */
  readonly href: string | null;
  readonly glyph: string;
  readonly label: string;
  /** The pages list, or the small entries at the sidebar's foot. */
  readonly place: "main" | "foot";
  readonly badge: SidebarBadgeDecision;
}

/** The lanes a workstream is finished in, or was never an outcome in (`src/workstreams/lanes.ts`). */
const FINISHED_LANES: ReadonlySet<string> = new Set(["done", "abandoned", "kept-here"]);

/**
 * The sidebar, in order: Queue, Alignment between it and Pull requests, then pull requests, workstreams, automations
 * and fleet, then Settings and Docs at the foot.
 */
export const SIDEBAR_ENTRIES = [
  {
    badge: {
      attention: true,
      kind: "count",
      means: "what waits on your word: the number the Queue's header prints",
    },
    glyph: "☰",
    href: "/queue",
    key: "queue",
    label: "Queue",
    place: "main",
  },
  {
    badge: {
      attention: false,
      kind: "count",
      means:
        "the general-ruling questions you have not answered, never the acts the fleet already did: the number the Alignment page's head prints",
    },
    glyph: "◇",
    href: "/alignment",
    key: "alignment",
    label: "Alignment",
    place: "main",
  },
  {
    badge: {
      attention: true,
      kind: "count",
      means:
        "your open pull requests in this context, drafts included: the cards that page lists under Everything, from its current complete landing reading",
    },
    glyph: "⇄",
    href: "/pull-requests",
    key: "pull-requests",
    label: "Pull requests",
    place: "main",
  },
  {
    badge: {
      attention: false,
      kind: "count",
      means:
        "the workstreams in this context not yet done, abandoned or kept here only, so zero when every one is done",
    },
    glyph: "▰",
    href: "/workstreams",
    key: "workstreams",
    label: "Workstreams",
    place: "main",
  },
  {
    badge: {
      attention: false,
      kind: "count",
      means: "the automations switched on, whenever they next run. One paused, held or disabled is not counted",
    },
    glyph: "↻",
    href: "/automations",
    key: "automations",
    label: "Automations",
    place: "main",
  },
  {
    badge: { attention: false, kind: "count", means: "the sessions working now, off the last session reading" },
    glyph: "◎",
    href: "/fleet",
    key: "fleet",
    label: "Fleet",
    place: "main",
  },
  {
    badge: {
      kind: "none",
      why: "no count: it holds your plans and preferences, and nothing in it waits or runs; a dot marks it while no plan is connected",
    },
    glyph: "⚙",
    href: null,
    key: "settings",
    label: "Settings",
    place: "foot",
  },
  {
    badge: { kind: "none", why: "no count: it is reference, and nothing in it waits or runs" },
    glyph: "¶",
    href: "/docs",
    key: "docs",
    label: "Docs",
    place: "foot",
  },
] as const satisfies readonly [SidebarEntry, ...SidebarEntry[]];

/** One entry of {@link SIDEBAR_ENTRIES}, its decision as literal as it is declared. */
export type SidebarEntryOf = (typeof SIDEBAR_ENTRIES)[number];

/** An entry decided to carry a count, whose key the shell must draw a badge for. */
export type CountedEntry = Extract<SidebarEntryOf, { readonly badge: { readonly kind: "count" } }>;

/**
 * Whether an entry is decided to carry a count.
 *
 * @returns `true` for a counted entry, narrowing it
 */
export function isCountedEntry(entry: SidebarEntryOf): entry is CountedEntry {
  return entry.badge.kind === "count";
}

/**
 * The Workstreams badge: the workstreams in the context shown that are still to finish — not done, abandoned, or kept
 * here only as the means rather than an outcome. Never the total, so it reads zero when every one is complete. A
 * workstream of a kind the reader skipped leaves no number, since its lane and context are unknown and a total
 * leaving it out is an omitted count; the page says the same of it.
 *
 * @param view the workstreams document, with how many rows of an unknown kind it skipped
 * @param context the context the console shows, whose half alone is counted
 * @returns the count and its title, or why there is no number
 */
export function unfinishedWorkstreamsOf({
  view,
  context,
}: {
  view: Pick<WorkstreamsView, "skipped" | "workstreams">;
  context: WorkContext;
}): SidebarReading {
  if (view.skipped > 0) {
    const noun = counted({ count: view.skipped, many: "workstreams", one: "workstream" });
    return { phase: "not-measured", why: `${noun} of a kind this console does not draw yet` };
  }
  const { shown } = inContext({ context, workstreams: view.workstreams });
  const count = shown.filter((one) => !FINISHED_LANES.has(one.lane)).length;
  const finished = shown.length - count;
  const noun = counted({ count, many: "unfinished workstreams", one: "unfinished workstream" });
  return {
    count: {
      count,
      title: `${noun} in this context; ${String(finished)} done, abandoned or kept here only not counted`,
    },
    phase: "measured",
  };
}

/** The badge's hover when no register is written: a true zero, said as one. */
export const NO_REGISTER_TITLE = "no workstreams register yet, so no outcome to count";

/**
 * The Workstreams badge off the register as it read: no register written is a measured zero — the owner has defined no
 * outcome — never a count that could not be read.
 *
 * @param reading the register, or the answer that there is none yet
 * @param context the context the console shows
 * @returns the count and its title, or why there is no number
 */
export function unfinishedWorkstreamsReadingOf({
  reading,
  context,
}: {
  reading: WorkstreamsReading;
  context: WorkContext;
}): SidebarReading {
  if (isWorkstreamsAbsent(reading)) {
    return { count: { count: 0, title: NO_REGISTER_TITLE }, phase: "measured" };
  }
  return unfinishedWorkstreamsOf({ context, view: reading });
}

/**
 * The Automations badge: the rows switched on, whenever they next run. Paused by the owner, or disabled, is off.
 *
 * @param automations every card the automations document carries, each saying whether it is switched on
 * @returns the count and its title
 */
export function switchedOnAutomationsOf({
  automations,
}: {
  automations: readonly { readonly switchedOn: boolean }[];
}): SidebarCount {
  const count = automations.filter((one) => one.switchedOn).length;
  const off = automations.length - count;
  const noun = counted({ count, many: "automations", one: "automation" });
  return { count, title: `${noun} switched on; ${String(off)} paused or disabled not counted` };
}

/**
 * The Automations badge over the whole document: no number when the page itself marks its counts short (the
 * definitions would not list, a definition file is not a row, or a store it reads did not), since a definition with
 * no card, or a pause in a store that did not read, could be switched on either way.
 *
 * @param view the automations document, with what it could not read
 * @returns the count, or why there is no number
 */
export function automationsReadingOf({
  view,
}: {
  view: Pick<AutomationsView, "issues" | "rejected" | "rosterGap"> & {
    readonly automations: readonly { readonly switchedOn: boolean }[];
  };
}): SidebarReading {
  if (view.rosterGap !== undefined) {
    return { phase: "not-measured", why: `the scheduled rows did not read: ${view.rosterGap}` };
  }
  const rejected = view.rejected.at(0);
  if (rejected !== undefined) {
    return { phase: "not-measured", why: `${rejected.file} is not a row: ${rejected.why}` };
  }
  const issue = view.issues.at(0);
  if (issue !== undefined) {
    return { phase: "not-measured", why: `a store this page reads did not read: ${issue}` };
  }
  return { count: switchedOnAutomationsOf({ automations: view.automations }), phase: "measured" };
}

/**
 * The Fleet badge, and the working count the Fleet page's glance prints (`./fleetGlance.ts`): the seats whose signal
 * is `working`. A seat needing input, idle or silent is open but not working.
 *
 * @param seats every open seat the last session reading judged
 * @returns the count and its title
 */
export function workingSessionsCountOf({ seats }: { seats: readonly { readonly signal: string }[] }): SidebarCount {
  const count = seats.filter((seat) => seat.signal === "working").length;
  const noun = counted({ count, many: "sessions", one: "session" });
  return { count, title: `${noun} working now, off the last session reading` };
}
