/**
 * Which seats keep falling over after recovery brings them back, so the next attempt investigates instead of
 * relaunching them again.
 *
 * Part of self-healing is not spinning up fixes for the same thing that crashes every time, so the work never
 * moves. A seat recovery relaunched is walled again only
 * because something put it back behind the wall; relaunching it a fourth time costs a launch and a turn and moves
 * nothing. So a seat journalled `reseated` in {@link CRASH_LOOP_RESEATS} distinct attempts inside
 * {@link CRASH_LOOP_WINDOW_MS} is held, and the supervisor — a session the owner can see — is asked why.
 *
 * ## Why a window, and why this one
 *
 * A machine restart re-walls EVERY seat at once, so an ordinary week of restarts reseats every seat many times over;
 * counting reseats with no window would hold the whole fleet by its third reboot. Three relaunches of one seat inside
 * one hour is not a restart pattern: it is a policy threshold, chosen, not measured — the journal holds no crash loop
 * yet to measure one against.
 *
 * Pure: journal events in, a map out.
 */
import type { FleetJournalEvent } from "./journal.js";

/** Relaunches of one seat, in distinct attempts, that make it a crash loop. */
const CRASH_LOOP_RESEATS = 3;

/** How far back a relaunch still counts toward a crash loop: one hour. */
const CRASH_LOOP_WINDOW_MS = 3_600_000;

/** One seat recovery keeps relaunching. */
export interface FleetCrashLoop {
  readonly workspaceRef: string;
  /** Distinct attempts inside the window that relaunched it. */
  readonly reseats: number;
  /** Its oldest relaunch inside the window. */
  readonly sinceIso: string;
}

/**
 * Every seat that recovery has relaunched often enough, recently enough, to stop relaunching.
 *
 * @param events the decoded journal, oldest first
 * @param nowIso the instant the window ends at — the pass's own clock, so a test needs no real one
 * @returns each looping seat, keyed by workspace ref
 */
export function crashLoopingSeats({
  events,
  nowIso,
}: {
  events: readonly FleetJournalEvent[];
  nowIso: string;
}): ReadonlyMap<string, FleetCrashLoop> {
  const now = Date.parse(nowIso);
  const since = now - CRASH_LOOP_WINDOW_MS;
  const attempts = new Map<string, Set<string>>();
  const oldest = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "seat" || event.phase !== "reseated") {
      continue;
    }
    // An instant that will not parse, or one after now, is evidence of nothing — never a relaunch to count.
    const at = Date.parse(event.atIso);
    if (Number.isNaN(at) || at < since || at > now) {
      continue;
    }
    const seen = attempts.get(event.workspaceRef);
    if (seen === undefined) {
      attempts.set(event.workspaceRef, new Set([event.attemptId]));
      oldest.set(event.workspaceRef, event.atIso);
    } else {
      seen.add(event.attemptId);
    }
  }
  const loops = new Map<string, FleetCrashLoop>();
  for (const [workspaceRef, seen] of attempts) {
    if (seen.size >= CRASH_LOOP_RESEATS) {
      loops.set(workspaceRef, { reseats: seen.size, sinceIso: oldest.get(workspaceRef)!, workspaceRef });
    }
  }
  return loops;
}
