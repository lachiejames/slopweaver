/**
 * The capture's side of a rebuild in flight: before each reading the built tree beside the child's binary is read,
 * and a stale one is waited out — ONCE, by this parent — so the children that follow meet the fresh build instead of
 * each refusing with `[stale-build]`. A reading that failed while a rebuild crossed it is taken again on the fresh
 * build. MEASURED, the case this closes: one tick lost 39 of 50 readings to one landing's
 * fast-forward of the main checkout (`../../../builtCli/builtState.ts` carries the repro).
 *
 * A wait that runs out with no fresh build is the last one this capture makes: every later reading launches at once
 * and refuses as it did before, so one rebuild that never lands costs a tick one bounded wait, never one per
 * reading. Nothing here runs a stale build; the children's own guard is untouched.
 */
import { type BuiltState, rebuildCrossed } from "../../../builtCli/builtState.js";
import type { ScratchDeps } from "./scratchDeps.js";

/** One settle: where the build stood once settled, and how long settling it waited. */
interface Settled {
  readonly state: BuiltState;
  readonly waitedMs: number;
}

/** The gate one capture runs its readings through. */
export interface ScratchBuildGate {
  /** Read the build before a launch, waiting out a stale one unless an earlier wait already ran out. */
  readonly settle: (args: { reading: string }) => Promise<Settled>;
  /**
   * After a reading: whether it failed while a rebuild crossed it and a fresh build now stands, so it is worth taking
   * again, and how long finding that out waited. A reading that did not fail is never retaken and waits nothing.
   */
  readonly retake: (args: {
    reading: string;
    before: BuiltState;
    failed: boolean;
  }) => Promise<{ again: boolean; waitedMs: number }>;
  /** The reading on whose turn a wait ran out with no fresh build, once one has. */
  readonly gaveUpAt: () => string | undefined;
}

/**
 * The gate for one capture's children, all launched from one binary.
 *
 * @param bin the `slopweaver` binary every reading launches from
 * @param deps the read and the wait
 * @returns the gate
 */
export function scratchBuildGate({
  bin,
  deps,
}: {
  bin: string;
  deps: Pick<ScratchDeps, "readBuild" | "waitForBuild">;
}): ScratchBuildGate {
  let gaveUpAt: string | undefined;
  const settle = async ({ reading }: { reading: string }): Promise<Settled> => {
    const state = deps.readBuild({ bin });
    if (state.kind !== "stale" || gaveUpAt !== undefined) {
      return { state, waitedMs: 0 };
    }
    const waited = await deps.waitForBuild({ bin, judgedText: state.manifestText });
    if (waited.kind === "timed-out") {
      gaveUpAt = reading;
    }
    return { state: deps.readBuild({ bin }), waitedMs: waited.waitedMs };
  };
  return {
    gaveUpAt: () => gaveUpAt,
    retake: async ({ reading, before, failed }) => {
      if (!failed || !rebuildCrossed({ after: deps.readBuild({ bin }), before })) {
        return { again: false, waitedMs: 0 };
      }
      const settled = await settle({ reading });
      return { again: settled.state.kind === "fresh", waitedMs: settled.waitedMs };
    },
    settle,
  };
}
