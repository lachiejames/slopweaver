/**
 * The blunt half of the ruling gate, at the CLI dispatch boundary — ahead of every verb, before its module
 * is even loaded.
 *
 * Owner turn 291-9x: a ruling recorded on the board must be read by the verb it rules on AT RUN TIME. That
 * is only true if the read happens where every caller passes, including a session that has never heard of
 * the ruling — which is here, beside `../builtCli/guard.ts`'s stale-build refusal, the
 * precedent for a refusal that runs ahead of the whole surface.
 *
 * ## Three placement facts that are the design rather than notes
 *
 * - **Above every act a resolved route can take.** `./router.ts` resolves ONE arm, and a resolved route can
 *   answer `--help`, warn about a stale seat, load its module and run its handler. A check installed below
 *   any one of those would silently exempt the verbs that reach it, which is the failure this guard exists
 *   to prevent, one level up. `../__tests__/unit/cli/mainGatePlacement.test.ts` asserts the order.
 * - **`--help` is never gated.** Help is not an action, and a gated verb whose usage cannot be read is a
 *   refusal with no next move — the shape `../handover/staleReader.ts` records a session hitting.
 * - **One small file read, plus one per distinct argv `--home`.** `../handover/rulingGateIndex.ts` carries the
 *   measurement: the board costs 6.4 s and every journal 728 ms, against 4.1 s for the whole CLI start. A
 *   guardrail that taxes the surface is one that gets removed. An ordinary invocation names no other home, so
 *   it reads one file ({@link gateHomes}).
 *
 * ## Two entry paths, one verdict
 *
 * `./main.ts` asks {@link refuseOnStandingRuling} before it dispatches a typed verb. A verb that calls ANOTHER
 * verb's function in-process never passes there — the automation drain registering a dead-letter row, `github
 * landing` enqueueing, a seat spawning — so every verb body such a path reaches opens with
 * {@link refuseRunnerOnStandingRuling} (an audit found 47 paths into 23 bodies ungated).
 * The gate sits in the DEEPEST body, so a caller importing `registerAskRow` rather than `runHandoverRegister`
 * crosses it too. A typed invocation that is allowed reads the projection twice, one small file each; one that
 * is refused stops at `main` before its module loads, so it never prints twice.
 *
 * It FAILS OPEN on an unreadable projection, deliberately and as stated in that module.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { slopweaverHome } from "../config.js";
import {
  dispatchGateVerdict,
  rulingGateRefusalLines,
  type StandingGate,
  unexpiredGates,
} from "../handover/rulingGate.js";
import { readStandingGates } from "../handover/rulingGateStore.js";
import { logger } from "../lib/logger.js";
import { ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { CALLER_GATE_HOMES_ENV, decodeCallerGateHomes } from "./callerGateHomesEnv.js";
import { EXIT_ERROR } from "./exitCodes.js";
import { wantsHelp } from "./verbHelp.js";

/** What the boundary decided about one invocation. */
export interface RulingGateDoorVerdict {
  /** True when the verb must not run. */
  readonly refuse: boolean;
  /** The lines to print; empty when nothing refused. */
  readonly lines: readonly string[];
}

/**
 * Whether a standing ruling refuses this invocation.
 *
 * Pure over its inputs so the placement rule above is testable without a filesystem — {@link rulingGateDoor}
 * is the wiring that reads the projections.
 *
 * @param gates the standing gates, from the projection
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @param argv the whole process argv, as the CLI received it
 * @param nowIso the instant to judge expiry at
 * @returns the verdict and its lines
 */
export function rulingGateDoorVerdict({
  gates,
  noun,
  verb,
  argv,
  nowIso,
}: {
  gates: readonly StandingGate[];
  noun: string;
  verb: string;
  argv: readonly string[];
  nowIso: string;
}): RulingGateDoorVerdict {
  if (wantsHelp({ argv })) {
    return { lines: [], refuse: false };
  }
  return standingVerdict({ argv, gates, noun, nowIso, verb });
}

/**
 * The verdict with no `--help` exemption: what a verb BODY is judged by, since only `./main.ts` answers help.
 *
 * @param gates every gate the homes hold, lapsed ones included
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @param argv the whole argv, real or synthesised
 * @param nowIso the instant to judge expiry at
 * @returns the verdict and its lines
 */
function standingVerdict({
  gates,
  noun,
  verb,
  argv,
  nowIso,
}: {
  gates: readonly StandingGate[];
  noun: string;
  verb: string;
  argv: readonly string[];
  nowIso: string;
}): RulingGateDoorVerdict {
  const refusing = dispatchGateVerdict({ argv, gates: unexpiredGates({ gates, nowIso }), noun, verb });
  if (refusing.length === 0) {
    return { lines: [], refuse: false };
  }
  return {
    lines: rulingGateRefusalLines({ action: `slopweaver ${noun} ${verb}`, gates: refusing }),
    refuse: true,
  };
}

/**
 * Every state home whose projection judges this invocation: the environment's, always, and an argv
 * `--home` too when it names a different one.
 *
 * The boundary runs BEFORE the verb parses its own flags, so it cannot ask the verb — and
 * `../config.ts`'s `slopweaverHome()` answers from the environment alone. MEASURED while building this: a
 * `--home <dir>` invocation read the operator's real projection and let a gate in `<dir>` through, so the
 * guard silently did not apply to exactly the invocations a test drives. Reading ONLY the argv home was the
 * opposite hole (an audit finding): `--home <empty>`, or a `--home=` token riding in as another
 * flag's value, pointed the read at a home with no rulings and the gate passed. So an argv home may only ADD
 * gates, never remove them. That is also why this does not try to tell a flag from a flag's VALUE — it
 * cannot without the verb's spec, and a misread now costs one extra small file read. EVERY candidate is kept,
 * not only the first: keeping the first would let an earlier decoy token hide the verb's real `--home`, and
 * argv bounds the count. Both spellings are read because `./parseFlags.ts` accepts both.
 *
 * @param argv the whole process argv
 * @param home the state home the environment names, read whatever argv says
 * @returns the homes to read, the environment's first, without repeats
 */
export function gateHomes({ argv, home }: { argv: readonly string[]; home: string }): readonly string[] {
  const homes = [home];
  const tail = argv.slice(2);
  for (const [index, token] of tail.entries()) {
    let named: string | undefined;
    if (token.startsWith("--home=")) {
      named = token.slice("--home=".length);
    } else if (token === "--home") {
      const value = tail[index + 1];
      // `./parseFlags.ts` refuses only a `--` token as a value, so a home named `-held` is a home here too.
      if (value !== undefined && !value.startsWith("--")) {
        named = value;
      }
    }
    // An empty value is a home too: `./parseFlags.ts` hands it to the verb, whose paths then resolve against cwd.
    if (named !== undefined && !homes.includes(named)) {
      homes.push(named);
    }
  }
  return homes;
}

/** The state homes an in-process caller adds to every gate read made under it — {@link withCallerGateHomes}. */
const callerHomes = new AsyncLocalStorage<readonly string[]>();

/**
 * Run `run` with these state homes added to every ruling-gate read made inside it, however deep.
 *
 * A body called in-process judges the words it was HANDED, and a caller often hands it no `--home`: `automation
 * run-due --home <dir>` runs `datadog alert-digest`, which takes no `--home` at all. Without this the inner gate
 * read only the environment's home and a ruling in the tick's own home was walked around. A home here only ADDS gates, exactly as an argv `--home` does, and a nested call
 * keeps its caller's homes.
 *
 * @param homes the state homes the caller is running over
 * @param run the in-process work; its promise, if any, carries the homes across every await
 * @returns what `run` returned
 */
export function withCallerGateHomes<T>({ homes, run }: { homes: readonly string[]; run: () => T }): T {
  const outer = callerHomes.getStore();
  // A frozen copy, so a caller that later empties its own array cannot remove a home from the store.
  const stored = Object.freeze(outer === undefined ? [...homes] : [...outer, ...homes]);
  return callerHomes.run(stored, run);
}

/**
 * The homes a caller added: a parent process's, handed down in {@link CALLER_GATE_HOMES_ENV}, then every enclosing
 * {@link withCallerGateHomes}'s in this process. `automation run-due` encodes exactly this for each verb child it
 * runs, so a nested tick's child keeps every home above it.
 *
 * @returns the inherited homes, in the order the callers added them, or why a parent's could not be read
 */
export function callerGateHomes(): Result<readonly string[]> {
  const handed = decodeCallerGateHomes({ value: process.env[CALLER_GATE_HOMES_ENV] });
  const stored = callerHomes.getStore();
  if (handed.isErr() || stored === undefined) {
    return handed;
  }
  return ok([...handed.value, ...stored]);
}

/**
 * Every gate judging these words: the environment's home, each argv `--home`, and each inherited caller home.
 *
 * @param argv the whole argv, real or synthesised
 * @param home the state home the environment names
 * @returns the gates, lapsed ones included, or why a parent's homes could not be read
 */
function gatesJudging({ argv, home }: { argv: readonly string[]; home: string }): Result<readonly StandingGate[]> {
  return callerGateHomes().map((inherited) =>
    readGatesForHomes({ homes: [...gateHomes({ argv, home }), ...inherited] }),
  );
}

/**
 * The same question, reading the real projections. The clock is the caller's, so a test judges a fixed instant.
 *
 * @param home the state home the environment names; an argv `--home` adds its gates to this one's
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @param argv the whole process argv
 * @param nowIso the instant to judge expiry at
 * @returns the verdict and its lines
 */
export function rulingGateDoor({
  home,
  noun,
  verb,
  argv,
  nowIso,
}: {
  home: string;
  noun: string;
  verb: string;
  argv: readonly string[];
  nowIso: string;
}): RulingGateDoorVerdict {
  const gates = gatesJudging({ argv, home });
  if (gates.isErr()) {
    return { lines: gates.error, refuse: true };
  }
  if (gates.value.length === 0) {
    return { lines: [], refuse: false };
  }
  return rulingGateDoorVerdict({ argv, gates: gates.value, noun, nowIso, verb });
}

/**
 * The homes a gate read opens, each ONCE by the absolute path it names: `automation run-due --home h` run from
 * `/work` with `SLOPWEAVER_HOME=/work/h` names one home twice, and two reads of one projection could union two
 * versions of it across a write between them. A relative or empty home resolves against the working
 * directory, exactly as the projection path built from it would.
 *
 * @param homes the state homes as the environment and argv spell them
 * @returns each distinct home, absolute, in first-seen order
 */
export function distinctGateHomes({ homes }: { homes: readonly string[] }): readonly string[] {
  return [...new Set(homes.map((each) => resolve(each)))];
}

/**
 * Every standing gate the projections of these homes hold, unioned in home order.
 *
 * Each projection fails open on its own, so an unreadable second home never drops the first one's gates. One
 * ruling projected into two homes is one gate, not two copies of the same refusal — but only an IDENTICAL gate
 * is folded: an id is `slug#placedIso`, so two homes can hold different gates under one id, and dropping either
 * would let the second home remove a constraint. `automation run-due` reads the same union for its per-row check.
 *
 * @param homes the state homes to read, a repeat read once
 * @returns the gates, lapsed ones included — expiry is the caller's clock
 */
export function readGatesForHomes({ homes }: { homes: readonly string[] }): readonly StandingGate[] {
  const read = distinctGateHomes({ homes }).flatMap((each) =>
    readStandingGates({ indexPath: stateHomePaths({ home: each }).rulingGatesJson }),
  );
  return read.filter((gate, index) => read.findIndex((other) => isDeepStrictEqual(other, gate)) === index);
}

/**
 * The whole boundary as `./main.ts` uses it: ask, print, and answer with an exit code or nothing.
 *
 * It is a separate function rather than four lines inline because `main` sits against the
 * `max-function-lines` and `cognitive-complexity` ceilings, and a refusal that has to be squeezed in to fit
 * a budget is one a later edit removes.
 *
 * @param argv the whole process argv
 * @param noun the CLI noun about to run
 * @param verb the CLI verb about to run
 * @returns the exit code to return, or `undefined` when nothing refuses and the verb should run
 */
export function refuseOnStandingRuling({
  argv,
  noun,
  verb,
}: {
  argv: readonly string[];
  noun: string;
  verb: string;
}): number | undefined {
  return exitFor({
    verdict: rulingGateDoor({ argv, home: slopweaverHome(), noun, nowIso: new Date().toISOString(), verb }),
  });
}

/**
 * Print a refusing verdict's lines and answer its exit code.
 *
 * @param verdict the door's answer
 * @returns `EXIT_ERROR` when it refuses, else `undefined`
 */
function exitFor({ verdict }: { verdict: RulingGateDoorVerdict }): number | undefined {
  if (!verdict.refuse) {
    return undefined;
  }
  for (const line of verdict.lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * The same boundary, asked by a verb BODY as its first statement — the seam every in-process path crosses.
 *
 * A verb that calls another verb's function directly never passes `./main.ts`, so the inner verb asks here
 * instead, with its own noun and verb and the words it was handed. It synthesises the argv the dispatcher would
 * have seen, so expiry, the environment's home and every `--home` in those words judge it exactly as they judge a
 * typed invocation — plus every home an enclosing {@link withCallerGateHomes} added. `--help` is the one
 * difference: it is NOT exempt here. `./main.ts` answers help before a body runs, so a body handed `--help` or
 * `-h` runs anyway, and `-h` can be a flag's VALUE (`--no-picture-because -h`) that `wantsHelp` cannot tell from
 * a help request. `src/__tests__/unit/cli/inProcessRulingGate.test.ts`
 * holds every body an in-process path reaches to opening with this call.
 *
 * @param noun the CLI noun the body runs
 * @param verb the CLI verb the body runs
 * @param rest the words after the verb, as the body received them
 * @returns the exit code to return, or `undefined` when nothing refuses and the body should run
 */
export function refuseRunnerOnStandingRuling({
  noun,
  verb,
  rest,
}: {
  noun: string;
  verb: string;
  rest: readonly string[];
}): number | undefined {
  const argv = ["node", "slopweaver", noun, verb, ...rest];
  const gates = gatesJudging({ argv, home: slopweaverHome() });
  if (gates.isErr()) {
    return exitFor({ verdict: { lines: gates.error, refuse: true } });
  }
  return exitFor({
    verdict: standingVerdict({ argv, gates: gates.value, noun, nowIso: new Date().toISOString(), verb }),
  });
}
