/**
 * How many ordinary lint gates one machine runs at once — derived from the machine the lap lands on, up to
 * the width a sweep on the CI runner found the knee at.
 *
 * **Why concurrency is the instrument.** MEASURED on `main`: 65 gates, 467.2s
 * serial, 51% of it in four gates and the rest spread across 61, 34 of them at 3s or more. A long tail is
 * what no single gate's own speed fixes. Reproduce with `NODE_OPTIONS=--max-old-space-size=8192 yarn lint`.
 *
 * **Why it is derived, not fixed.** MEASURED: every `ci.yml` job runs on the larger runner,
 * whose runner-facts step prints `cpus: 16` and `memory: 64297 MiB total`, while `main`'s fixed four-wide pool
 * spent 386.2s of gate time in 159.1s of wall time there — 2.43x on sixteen CPUs. Reproduce both halves:
 *
 * ```bash
 * slopweaver github run-log 36246401008 --job lint --lines 2000 | grep -E 'cpus:|memory:|of gate time'
 * ```
 *
 * **Why it stops at eight.** MEASURED, the whole `yarn lint` on that runner at each width, three
 * laps each, medians: 4 → 163s, 8 → 144s, 12 → 139s, 16 → 138s, with about 5s of spread and peak memory
 * 10.1–10.4 GiB at every width. Eight takes 19s of the 25s on offer, and what is left past it is the spread.
 * Every gate slows as the pool widens (`prettier` 43.4s at sixteen), so the wall is held by the exclusive gates
 * plus the slowest contended ones, not by the pool. Reproduce:
 *
 * ```bash
 * for r in 36253592098 36254743988 36256720224; do for c in 4 8 12 16; do
 *   slopweaver github run-log $r --job x-lint-c$c --lines 60 | grep SWEEP; done; done
 * ```
 *
 * **What memory the pool costs, and what it does not.** The same sweep's peak barely moved as the pool went from
 * four to sixteen (10.1 → 10.4 GiB), so twelve more ordinary gates cost about 0.3 GiB between them. The peak is
 * set by what runs alike at every width, an `exclusive` gate alone being the heavy candidate, and the floor is
 * the smallest whole GiB over it. Each gate is budgeted a quarter of that floor, a generous bound rather than a
 * measurement of one, and the pool is as wide as the CPUs and that budget allow. It is never wider than eight or
 * than the machine: a two-CPU machine runs two. On the floor itself this is the four `main` ran on every
 * machine, and only a machine over the floor is ever given more. An `exclusive` gate still runs alone: its own
 * heap is measured, but what it costs beside a full pool is not, and a barrier is the cheap side of that unknown.
 */
import { availableParallelism, totalmem } from "node:os";

/** How many gates run at once on the floor: the four `main` ran on every machine. */
const FLOOR_CONCURRENCY = 4;

/** The widest pool, where the sweep on the CI runner found the knee. */
export const KNEE_CONCURRENCY = 8;

/**
 * The memory floor `ci.yml`'s runner-facts step asserts (`MIN_TOTAL_MIB`, pinned by `RUNNER_FACTS_STEP`).
 * The smallest whole GiB over the lint lap's measured 10.1–10.4 GiB peak (the sweep above), and so over the
 * `named-object-params` gate's own `HEAP_BUDGET_MIB`, which a test holds it above.
 */
export const RUNNER_FLOOR_MIB = 12_288;

/** What one ordinary gate is budgeted: its share of the floor when four fitted there. */
const SLOT_MIB = RUNNER_FLOOR_MIB / FLOOR_CONCURRENCY;

/**
 * How many ordinary gates a machine with these resources runs at once. Pure, so both ends are testable.
 *
 * @param cpus how many CPUs the process may use
 * @param totalMib the machine's whole memory, in MiB
 * @returns the pool width
 */
export function gateConcurrency({ cpus, totalMib }: { cpus: number; totalMib: number }): number {
  return Math.max(1, Math.min(KNEE_CONCURRENCY, cpus, Math.floor(totalMib / SLOT_MIB)));
}

/**
 * How many ordinary gates the machine this process is running on runs at once.
 *
 * @returns the pool width here
 */
export function machineConcurrency(): number {
  return gateConcurrency({ cpus: availableParallelism(), totalMib: Math.floor(totalmem() / 1024 / 1024) });
}
