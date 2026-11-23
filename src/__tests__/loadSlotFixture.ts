/**
 * Load-slot guards for tests.
 *
 * Every verb that commits a large footprint takes a machine-wide slot before it starts
 * (`src/lib/loadSlots.ts`), and the real guard renames a marker into a lane under the OS temp dir
 * that it shares with every other process on the host. A test must inject one of these instead: the
 * `mkdtempSync` discipline in `.claude/rules/testing.md` is about `$SLOPWEAVER_HOME`, and this is the same
 * rule for the other shared directory a verb can now reach.
 */
import type { LoadSlotGuard } from "../lib/loadSlots.js";

/**
 * A guard that always admits — the shape a test uses when the slot is not what it is asserting on.
 *
 * @returns an admitted verdict, with this process counted as the one load in flight
 */
export const admittingSlotGuard: LoadSlotGuard = () => ({ admitted: true, inFlight: 1, limit: 3 });

/**
 * A guard that always refuses, naming one holder — the shape a test uses to assert the refusal itself.
 *
 * @param pid the holder's pid, so an assertion can look for it in the refusal text
 * @returns the guard
 */
export function refusingSlotGuard({ pid = 4242 }: { pid?: number } = {}): LoadSlotGuard {
  return () => ({
    admitted: false,
    holders: [{ ceilingMib: 12288, pid, startedAtIso: "2026-09-06T00:00:00.000Z" }],
    limit: 3,
    obstacles: [],
  });
}
