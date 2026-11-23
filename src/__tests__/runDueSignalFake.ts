/**
 * A plain fake of `automation run-due`'s process edge (`cli/commands/automation/runDueSignal.ts#RunDueSignalProcess`):
 * it records every handler installed, every diagnostic and every exit requested, and delivers a signal by
 * calling the handlers installed for it. Never a mock — no `vi.fn` — just the edge's functions over arrays a
 * test reads back.
 */
import type { RecipeRunDueDeps } from "../cli/commands/automation/rowRunners.js";
import { runRecipeRunDue } from "../cli/commands/automation/runDue.js";
import {
  openRunDueSignalTrap,
  type RunDueSignalProcess,
  type RunDueStopSignal,
} from "../cli/commands/automation/runDueSignal.js";
import type { RunDueVerbTermination } from "../cli/commands/automation/runDueVerbProcessPure.js";

/** The fake, and what it observed. */
export interface FakeRunDueSignalProcess {
  /** The edge to hand the code under test. */
  readonly edge: RunDueSignalProcess;
  /** Every diagnostic line the edge was asked to write, in order. */
  readonly diag: string[];
  /** Every exit code requested, in order. */
  readonly exits: number[];
  /** Every signal a handler was installed for, in order. */
  readonly installed: RunDueStopSignal[];
  /** Deliver one signal to every handler installed for it now. */
  readonly fire: (input: { readonly signal: RunDueStopSignal }) => void;
  /** Every time the trap asked for the verb child to be ended, what it was told. */
  readonly childEnds: RunDueVerbTermination[];
}

/**
 * A fresh fake process edge with nothing installed.
 *
 * @param child what ending the verb child reports — no child running, unless a case says otherwise
 * @returns the fake and its recordings
 */
export function fakeRunDueSignalProcess({
  child = { kind: "none-running" },
}: { readonly child?: RunDueVerbTermination } = {}): FakeRunDueSignalProcess {
  const handlers: { signal: RunDueStopSignal; handler: () => void }[] = [];
  const diag: string[] = [];
  const exits: number[] = [];
  const installed: RunDueStopSignal[] = [];
  const childEnds: RunDueVerbTermination[] = [];
  return {
    childEnds,
    diag,
    edge: {
      endVerbChild: () => {
        childEnds.push(child);
        return child;
      },
      exit: ({ code }) => {
        exits.push(code);
      },
      on: ({ signal, handler }) => {
        installed.push(signal);
        handlers.push({ handler, signal });
      },
      writeDiagnostic: (line) => {
        diag.push(line);
      },
    },
    exits,
    fire: ({ signal }) => {
      handlers
        .filter((entry) => entry.signal === signal)
        .forEach((entry) => {
          entry.handler();
        });
    },
    installed,
  };
}

/**
 * `automation run-due` under a trap over a fresh fake process edge, unless the case hands its own edge. The trap
 * never takes its handlers down, so Node's own edge in a test would leave three listeners on the worker per call.
 *
 * @returns the verb's exit code
 */
export async function runDueUnderFake({
  signalProcess = fakeRunDueSignalProcess().edge,
  ...rest
}: {
  readonly argv: readonly string[];
  readonly deps?: RecipeRunDueDeps;
  readonly signalProcess?: RunDueSignalProcess;
}): Promise<number> {
  return runRecipeRunDue({ ...rest, signalTrap: openRunDueSignalTrap({ signalProcess }) });
}
