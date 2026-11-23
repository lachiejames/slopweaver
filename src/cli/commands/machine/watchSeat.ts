/**
 * WHAT `slopweaver machine watch` DOES ABOUT AN ANOMALOUS READING — the seat, in the order it performs it:
 * resolve the checkout, register the board row, record the dispatch row as `registered`, open the workspace.
 *
 * The third step exists because the fourth is slow. MEASURED: the chair ran
 * `timeout 90 slopweaver machine watch --once` at load 27 on 15 cores, the board row
 * `machine-load-hold-on-cpu-78c76a41` was registered, and `cmux spawn` outlived the 90s — so the process died
 * before its only append, and the board row's `--evidence` cited a dispatch id the register never held. Four
 * seats in a day ended that way (`grep -c <id> $SLOPWEAVER_HOME/live/machine/dispatches.jsonl` on any
 * `machine-load-*` board row's evidence). Recording before the spawn makes that id exist, for every reader that
 * knows the `registered` arm, the moment a board row cites it; the watch's final append replaces the line when
 * the seat reports. A reader built before the arm drops the line — `DispatchSeat` states that residue.
 *
 * The gap left, and why it stays: a kill landing between `register` returning and that append — milliseconds,
 * against the minutes the spawn used to leave open — still orphans the board row. Closing it would mean a
 * dispatch row naming a board row that does not exist yet, which is worse. A failed append is logged and the
 * seat carries on, since refusing the spawn would not un-register the board row either.
 *
 * Its own module rather than a half of `./watch.ts`, for the reason `../cmux/spawnPreflight.ts` is its own
 * module: the sampler is a loop around a judgement, and this is the half with a real invariant to protect.
 *
 * ## The invariant, and the measurement that makes it one
 *
 * A board row names a `repo:` PATH, because a worktree is cut from a checkout on this machine. A row without
 * one cannot be seated: `../cmux/spawnPreflight.ts` answers *"names no `repo:`, so there is nowhere to open a
 * worktree in"* and exits 2. The watcher registered its row with no `--repo` from the day it shipped, so it
 * NEVER SEATED ANYTHING — MEASURED on this machine: all 20 rows in
 * `$SLOPWEAVER_HOME/live/machine/dispatches.jsonl` carry `seated.kind: "none"`,
 * and 17 of them read `cmux spawn exited 2`. Fifteen unseatable p1 rows were left standing on the board.
 * Reproduce it against any of them: `slopweaver cmux spawn <slug> --model opus --home <a home holding it>`.
 *
 * `../../../live/checkout/checkoutForRepo.ts` had already been built for exactly this failure, twice
 * measured before this one (`vulnerability-fix topup`, `automation seat`) and described there as "the
 * SHAPE of every register-then-spawn verb". This was the third instance and the one that reached it last.
 * Its rule is the ORDER: resolve BEFORE writing the row, because a verb that registers first leaves a board
 * row nobody is working.
 *
 * So an unresolvable checkout seats nothing and registers NO board row — while the DISPATCH row is still
 * written, always, by `../../../live/machine/watchDecision.ts`. The two row kinds are easy to conflate and
 * the distinction is load-bearing: `../../../live/machine/backoff.ts`'s header carries the deadlock that
 * gating the dispatch row would cause.
 *
 * ## Why the argv is built by exported functions rather than inline
 *
 * `MachineWatchDeps.seat` is an injected seam, so a test that fakes it can never see the flags the REAL seat
 * builds — `--repo` was missing for 17 dispatches with a green suite throughout. The two builders below are
 * what a unit test asserts on. `../recipe/seat.ts`'s `registerArgv` is the same shape for the same reason.
 */
import { workspaceRegisterArgv } from "../../../handover/workspace.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import type { DispatchRow, DispatchSeat } from "../../../live/machine/dispatchRow.js";
import { dispatchRegisterPath } from "../../../live/machine/dispatchStore.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { runCmuxSpawnPastBackoff } from "../cmux/run.js";
import { runHandoverRegister } from "../handover/askRowRun.js";

/** The model a seated investigation runs on — Opus, because this is an investigation (doctrine rule 5). */
const SEAT_MODEL = "opus";

/** A slug for the investigation one row opens — stable in shape, unique by the row's own id. */
function seatSlug({ row }: { row: DispatchRow }): string {
  const subject = row.subject.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return `machine-load-${subject}-${row.id.slice(0, 8)}`;
}

/**
 * The argv words past `handover register` for one dispatch's board row.
 *
 * @param row the dispatch this row is registered from
 * @param slug the board row's slug
 * @param checkout the declared main checkout the seated session's worktree is cut from
 * @param home the state home the board and the register live under
 * @returns the argv words past `handover register`
 */
export function seatRegisterArgv({
  row,
  slug,
  checkout,
  home,
}: {
  row: DispatchRow;
  slug: string;
  checkout: string;
  home: string;
}): readonly string[] {
  return [
    "--ask",
    `anomalous machine load: ${row.subject.why}`,
    "--finding",
    "--evidence",
    `${dispatchRegisterPath({ home })}#${row.id}`,
    "--priority",
    "p1",
    "--slug",
    slug,
    ...workspaceRegisterArgv({
      stated: { because: "anomalous load on the machine this installation runs on", workspace: "self" },
    }),
    "--repo",
    checkout,
    "--home",
    home,
  ];
}

/**
 * The argv words for the spawn that opens the investigation, exported for the same reason.
 *
 * @param slug the board row to open a workspace on
 * @param home the state home the row lives under
 * @returns the argv words past `cmux spawn`
 */
export function seatSpawnArgv({ slug, home }: { slug: string; home: string }): readonly string[] {
  return [slug, "--model", SEAT_MODEL, "--home", home];
}

/**
 * What a non-zero exit from one of the seat's own verbs MEANS, in the vocabulary `../../exitCodes.ts`
 * defines.
 *
 * The callees print their refusal through the module-scope `logger`, which has no capture seam, so the
 * sentence itself cannot be recovered here without threading a logger through `../cmux/run.ts`. The code's
 * documented meaning can be, and it is the difference between a row a reader can act on and one they
 * cannot: nine sessions read `cmux spawn exited 2` on this register and none of them worked out that a `2`
 * says the invocation itself was refused before anything happened.
 *
 * @param code the exit code the verb returned
 * @returns the parenthesised meaning, or an empty string for a code the vocabulary does not name
 */
export function exitCodeMeaning({ code }: { code: number }): string {
  if (code === EXIT_USAGE) {
    return " (usage — the verb refused this invocation before acting, so nothing happened)";
  }
  if (code === EXIT_EXPECTED_EMPTY) {
    return " (expected-empty — the verb ran and reported nothing to do)";
  }
  if (code === EXIT_DEFERRED) {
    return " (deferred — a prerequisite is still in progress, so the verb did nothing)";
  }
  return "";
}

/**
 * Run one slopweaver verb IN PROCESS, the way `../recipe/seat.ts` opens its own seat.
 *
 * Deliberately not a subprocess. Shelling out to `slopweaver` resolves whatever binary is on PATH rather
 * than the install holding this home, and it opens a direct `execFile` seam the door-coverage gate is right
 * to refuse — the two verbs called here route their own effects through the door themselves.
 */
async function runVerb({
  run,
  args,
  what,
}: {
  run: (argv: readonly string[]) => Promise<number>;
  args: readonly string[];
  what: string;
}): Promise<Result<void>> {
  try {
    const code = await run(["node", "slopweaver", ...args]);
    if (code === EXIT_OK) {
      return ok(undefined);
    }
    return err([`${what} exited ${String(code)}${exitCodeMeaning({ code })}`]);
  } catch (error: unknown) {
    return err([error instanceof Error ? error.message : String(error)]);
  }
}

/**
 * ONE SEAT, IN THE ORDER IT PERFORMS — resolve, register, open — over injected runners, so both the order
 * and the argv are testable without a workspace. This module's header carries why the order is the
 * invariant.
 *
 * @param row the dispatch this seat is opened from
 * @param home the state home the board and the register live under
 * @param checkoutFor the declared main checkout the seated session's worktree is cut from
 * @param register writes the board row, given the argv words past `handover register`
 * @param recordRegistered writes the dispatch row's `registered` line once the board row exists and BEFORE the
 *   spawn, so a watch killed mid-spawn still leaves the dispatch id the board row cites
 * @param openWorkspace opens the visible session, given the argv words past `cmux spawn`
 * @returns what was opened, or in words why nothing was
 */
export async function openSeat({
  row,
  home,
  checkoutFor,
  register,
  recordRegistered,
  openWorkspace,
}: {
  row: DispatchRow;
  home: string;
  checkoutFor: (args: { home: string }) => Result<string>;
  register: (args: { argv: readonly string[] }) => Promise<Result<void>>;
  recordRegistered: (args: { slug: string }) => void;
  openWorkspace: (args: { argv: readonly string[] }) => Promise<Result<void>>;
}): Promise<DispatchSeat> {
  const slug = seatSlug({ row });
  const checkout = checkoutFor({ home });
  if (checkout.isErr()) {
    return { kind: "none", why: `no board row was registered: ${checkout.error.join("; ")}` };
  }
  const registered = await register({ argv: seatRegisterArgv({ checkout: checkout.value, home, row, slug }) });
  if (registered.isErr()) {
    return { kind: "none", why: `could not register a board row: ${registered.error.join("; ")}` };
  }
  recordRegistered({ slug });
  const opened = await openWorkspace({ argv: seatSpawnArgv({ home, slug }) });
  if (opened.isErr()) {
    return { kind: "none", why: `board row ${slug} registered, but cmux spawn failed: ${opened.error.join("; ")}` };
  }
  return { kind: "seated", slug, workspace: slug };
}

/**
 * The production seat: the real board and a real visible workspace, both through the one door.
 *
 * @param home the Slopweaver home the board and the register live under
 * @returns the `seat` seam `./watch.ts`'s production deps carry
 */
export function productionSeat({
  home,
}: {
  home: string;
}): (args: { row: DispatchRow; recordRegistered: (args: { slug: string }) => void }) => Promise<DispatchSeat> {
  return ({ row, recordRegistered }) =>
    openSeat({
      checkoutFor: ({ home: stateHome }) => checkoutForRunningRepo({ home: stateHome, verb: "machine watch" }),
      home,
      // Past the fleet spawn backoff: this seat exists BECAUSE the box is held, so the gate that holds every
      // other spawn would hold the one seat sent to investigate why.
      openWorkspace: ({ argv }) =>
        runVerb({ args: ["cmux", "spawn", ...argv], run: runCmuxSpawnPastBackoff, what: "cmux spawn" }),
      register: ({ argv }) =>
        runVerb({
          args: ["handover", "register", ...argv],
          run: runHandoverRegister,
          what: "handover register --finding",
        }),
      recordRegistered,
      row,
    });
}
