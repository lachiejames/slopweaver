/**
 * Whether a supervisor tick is CONFINED to a scratch state home, and which of its readings a confined tick may run.
 *
 * `supervisor tick open --home <dir>` used to file only its readings-ledger row under `<dir>`: every child ran with no
 * `--home` and the operator's own environment, so a "scratch" tick pressed landings, drove bumps, woke parked seats
 * through `cmux spawn`, fired monitors into the owner's Queue and floating notes, and advanced the real events
 * cursor — while looking confined. Read it off `scratchChild.ts`'s `runChildToFiles` (env = this process's) and
 * `tickReadings`' argv (no `--home`); `subprocess/cli/commands/supervisor/tickConfinement.test.ts` is the witness.
 *
 * The rule here: a `--home` that resolves to a directory OTHER than the ambient home makes a confined tick. Every
 * child then runs with `SLOPWEAVER_HOME` set to that home, a reading that would act on the world or read the owner's
 * live state is WITHHELD (never run, never faked), and a monitor check is REHEARSED (its `--fire` dropped, so it judges
 * and reports but posts no card and raises no note). An omitted `--home`, or one naming the ambient home itself, is
 * the chair's ordinary tick and is untouched, byte for byte.
 *
 * Closed by TYPE, not by list: {@link TickReading.confined} is a required member, so a reading added later without
 * deciding what a confined tick does with it fails to compile.
 *
 * What confinement does NOT cover, said rather than discovered: a kept child that resolves state from something other
 * than `SLOPWEAVER_HOME`. The kept readings still READ the live cmux socket (`cmux list`, `session watch`, `session
 * depth`, `session standing`), the Claude config directory's transcripts and every Codex home's rollouts (`fleet
 * burn`), and the machine's process table and memory (`machine capacity`). None of them writes through those, which
 * is why they are kept; a trial that must not observe the live fleet at all needs them withheld too. Nor does it
 * cover the capture's own build-freshness check, which runs in this process before each reading, not as one: on a
 * cold cache it runs `git ls-files` over the checkout and writes the checkout's source-listing cache under its `.git`
 * — the checkout's build metadata, never state-home state, and Git reads no `SLOPWEAVER_HOME`.
 *
 * The comparison is lexical (`node:path` `resolve`), with no filesystem read, so the decision stays pure. A symlinked
 * alias of the ambient home therefore reads as confined: the error withholds effects, never exposes the real home.
 *
 * No I/O, no clock.
 */
import { resolve } from "node:path";

import type { TickReading } from "./tickCapture.js";

/** What a confined tick does with one reading. An ambient tick runs every reading exactly as declared. */
export type ConfinedReadingDisposition =
  /** Run it unchanged: it reads only the state home, or reads live state without acting on it. */
  | { readonly kind: "keep" }
  /** Run it with `--fire` removed: a monitor that judges and reports, posting no card and raising no note. */
  | { readonly kind: "rehearse" }
  /** Never run it: it acts on the world or reads the owner's live state. The reason is printed in the digest. */
  | { readonly kind: "withhold"; readonly reason: string };

/** Whether a tick runs against the ambient home (the chair's own tick) or a different, scratch one. */
export type TickConfinement =
  | { readonly kind: "ambient"; readonly home: string }
  | { readonly kind: "confined"; readonly home: string; readonly ambientHome: string };

/** The flag a monitor check's argv carries that turns a judgement into a posted card and a raised note. */
const FIRE_FLAG = "--fire";

/** The one disposition every read-only reading carries. */
export const KEEP: ConfinedReadingDisposition = { kind: "keep" };

/** The one disposition every fired monitor carries. */
export const REHEARSE: ConfinedReadingDisposition = { kind: "rehearse" };

/**
 * A withheld disposition, with the reason the digest prints.
 *
 * @param reason what running it would do outside the scratch home, in a clause
 * @returns the disposition
 */
export function withhold({ reason }: { reason: string }): ConfinedReadingDisposition {
  return { kind: "withhold", reason };
}

/**
 * Decide whether a tick is confined.
 *
 * @param home the `--home` the tick was given, when it was given one
 * @param ambientHome the state home this process resolves from its environment
 * @returns ambient when `home` is absent or names the ambient home, else confined to `home`
 */
export function tickConfinement({
  home,
  ambientHome,
}: {
  home: string | undefined;
  ambientHome: string;
}): TickConfinement {
  const ambient = resolve(ambientHome);
  if (home === undefined) {
    return { home: ambient, kind: "ambient" };
  }
  const chosen = resolve(home);
  if (chosen === ambient) {
    return { home: ambient, kind: "ambient" };
  }
  return { ambientHome: ambient, home: chosen, kind: "confined" };
}

/** One reading a confined tick left out, and why. */
interface WithheldReading {
  readonly name: string;
  readonly reason: string;
}

/** The readings a tick runs under its confinement, and what it left out or rehearsed. */
export interface ConfinedReadingPlan {
  readonly readings: readonly TickReading[];
  readonly withheld: readonly WithheldReading[];
  /** The names of the readings run with `--fire` removed. */
  readonly rehearsed: readonly string[];
}

/**
 * The readings a tick runs under its confinement: every one unchanged for an ambient tick; for a confined one, the
 * kept ones unchanged, the rehearsed ones with `--fire` removed, and the withheld ones left out and named.
 *
 * @param readings the tick's readings, in run order
 * @returns the readings to run, in the same order, and what was left out or rehearsed
 */
export function readingsForConfinement({
  confinement,
  readings,
}: {
  confinement: TickConfinement;
  readings: readonly TickReading[];
}): ConfinedReadingPlan {
  if (confinement.kind === "ambient") {
    return { readings, rehearsed: [], withheld: [] };
  }
  const kept: TickReading[] = [];
  const withheld: WithheldReading[] = [];
  const rehearsed: string[] = [];
  for (const reading of readings) {
    const disposition = reading.confined;
    switch (disposition.kind) {
      case "keep":
        kept.push(reading);
        break;
      case "rehearse":
        kept.push({ ...reading, argv: reading.argv.filter((token) => token !== FIRE_FLAG) });
        rehearsed.push(reading.name);
        break;
      case "withhold":
        withheld.push({ name: reading.name, reason: disposition.reason });
        break;
      default: {
        const unreachable: never = disposition;
        return unreachable;
      }
    }
  }
  return { readings: kept, rehearsed, withheld };
}

/**
 * The lines a confined tick's digest opens on, so a reading it left out never reads as one that failed. None for an
 * ambient tick.
 *
 * @param plan what {@link readingsForConfinement} decided
 * @returns the lines, the headline first
 */
export function confinementLines({
  confinement,
  plan,
}: {
  confinement: TickConfinement;
  plan: ConfinedReadingPlan;
}): readonly string[] {
  if (confinement.kind === "ambient") {
    return [];
  }
  const lines = [
    `CONFINED tick: every reading ran with SLOPWEAVER_HOME=${confinement.home}, not the ambient ${confinement.ambientHome}`,
    ...plan.withheld.map((reading) => `withheld ${reading.name}: ${reading.reason}`),
  ];
  if (plan.rehearsed.length > 0) {
    lines.push(`rehearsed without --fire (no card, no note): ${plan.rehearsed.join(", ")}`);
  }
  return lines;
}

/** The line a confined `tick open` adds for the one act it takes outside any reading, which it never takes. */
export const CONFINED_SEATING_LINE =
  "withheld stopped-recipe seating: it registers a board row and runs a real cmux spawn";

/**
 * The environment a confined tick's children run with: the base one, its state home replaced. An ambient tick passes
 * no environment at all, so its children keep exactly what they had.
 *
 * @param base the environment the child would otherwise inherit
 * @returns the child's environment, or `undefined` for an ambient tick
 */
export function confinedChildEnv({
  confinement,
  base,
}: {
  confinement: TickConfinement;
  base: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv | undefined {
  if (confinement.kind === "ambient") {
    return undefined;
  }
  return { ...base, SLOPWEAVER_HOME: confinement.home };
}
