/**
 * `slopweaver github lap-seat set <slug> | clear | show` — the chair's designation of the one handover run whose
 * session may run `github lap` (`./lapSeat.ts` says why it is a file). `show` also names the lap holding the
 * machine's lock, in its preflight or running, since a seat can stand empty while a lap runs, or none stand while
 * one does. Local state only: nothing here reads a provider. The parse is pure; the edges are injected so a unit test passes plain fakes.
 */

import { slopweaverHome } from "../../../config.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { readStandingLapLock } from "./lapLock.js";
import { type LapLock, lapLockPhaseWords } from "./lapLockShape.js";
import type { LapSeat } from "./lapSeat.js";
import { clearLapSeat, type LapSeatError, lapSeatRunClosed, readLapSeat, writeLapSeat } from "./lapSeatStore.js";
import { GITHUB_LAP_SEAT_USAGE } from "./lapSeatUsage.js";

const GITHUB_LAP_SEAT_FLAGS: FlagSpec = { boolean: [], string: ["home"] };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_LAP_SEAT_FLAG_NAMES: readonly string[] = stringFlagsOf({ spec: GITHUB_LAP_SEAT_FLAGS }).map(
  (name) => `--${name}`,
);

/** One resolved `github lap-seat` invocation. */
export type GithubLapSeatArgs =
  | { readonly action: "set"; readonly slug: string; readonly home: string | undefined }
  | { readonly action: "clear" | "show"; readonly home: string | undefined };

/** A `github lap-seat` invocation refused before any file is read; `lines` is what the verb prints, one per line. */
export interface LapSeatUsageError {
  readonly code: "FLAGS_REFUSED" | "SET_ARITY" | "NOT_A_SLUG" | "OPERAND_GIVEN" | "NO_ACTION";
  readonly message: string;
  readonly lines: readonly string[];
}

/** One usage refusal of a single line. */
function usageError({ code, line }: { code: LapSeatUsageError["code"]; line: string }): LapSeatUsageError {
  return { code, lines: [line], message: line };
}

/** The factory for every {@link LapSeatUsageError}, so the parser and its tests build the same values. */
export const LapSeatUsageErrors = {
  flagsRefused: ({ problems }: { problems: readonly string[] }): LapSeatUsageError => ({
    code: "FLAGS_REFUSED",
    lines: problems,
    message: problems.join("; "),
  }),
  noAction: (): LapSeatUsageError =>
    usageError({ code: "NO_ACTION", line: "name one action: set <slug>, clear or show" }),
  notASlug: ({ slug }: { slug: string }): LapSeatUsageError =>
    usageError({ code: "NOT_A_SLUG", line: `"${slug}" is not a run slug (letters, digits, . _ -)` }),
  operandGiven: ({ action }: { action: "clear" | "show" }): LapSeatUsageError =>
    usageError({ code: "OPERAND_GIVEN", line: `\`lap-seat ${action}\` takes no operand` }),
  setArity: (): LapSeatUsageError =>
    usageError({ code: "SET_ARITY", line: "`lap-seat set` takes exactly one run slug" }),
} as const;

/**
 * Parse a `github lap-seat` invocation.
 *
 * @param rest argv after `github lap-seat`
 * @returns the resolved invocation, or the usage refusal naming what is wrong
 */
export function parseGithubLapSeatArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubLapSeatArgs, LapSeatUsageError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: GITHUB_LAP_SEAT_FLAGS });
  if (parsed.isErr()) {
    return err(LapSeatUsageErrors.flagsRefused({ problems: parsed.error }));
  }
  const homeValue = parsed.value.values["home"];
  const home = typeof homeValue === "string" ? homeValue : undefined;
  const [action, ...operands] = parsed.value.positionals;
  if (action === "set") {
    const [slug, ...extra] = operands;
    if (slug === undefined || extra.length > 0) {
      return err(LapSeatUsageErrors.setArity());
    }
    if (!isSafeSlug({ slug })) {
      return err(LapSeatUsageErrors.notASlug({ slug }));
    }
    return ok({ action, home, slug });
  }
  if (action === "clear" || action === "show") {
    if (operands.length > 0) {
      return err(LapSeatUsageErrors.operandGiven({ action }));
    }
    return ok({ action, home });
  }
  return err(LapSeatUsageErrors.noAction());
}

/** The edges `github lap-seat` reaches; a unit test passes plain fakes. */
export interface GithubLapSeatDeps {
  readonly home: () => string;
  readonly now: () => Date;
  readonly sessionId: () => string | undefined;
  readonly readSeat: typeof readLapSeat;
  readonly writeSeat: typeof writeLapSeat;
  readonly clearSeat: typeof clearLapSeat;
  readonly runClosed: typeof lapSeatRunClosed;
  /** The live lap holding the machine, in either phase, read only by `show`. */
  readonly readLapLock: typeof readStandingLapLock;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** One line naming the lap holding the machine, or saying none does, so `show` answers who is lapping right now. */
function machineLine({ lock }: { lock: LapLock | undefined }): string {
  if (lock === undefined) {
    return "github lap-seat: no lap holds the machine";
  }
  const phase = lapLockPhaseWords({ phase: lock.phase });
  return `github lap-seat: a lap holds the machine: ${lock.subject}, pid ${String(lock.pid)}, since ${lock.startedIso}, ${phase}`;
}

/** One line naming a designation. */
function seatLine({ seat }: { seat: LapSeat }): string {
  const by = seat.setBy === undefined ? "" : ` by session ${seat.setBy}`;
  return `github lap-seat: ${seat.slug} holds the lap seat, set ${seat.setIso}${by}`;
}

/** Report a store failure and answer its exit code: a missing run is the caller's mistake, the rest are faults. */
function failed({ deps, error }: { deps: GithubLapSeatDeps; error: LapSeatError }): number {
  deps.writeDiagnostic(`github lap-seat: ${error.message}`);
  return error.code === "RUN_MISSING" ? EXIT_USAGE : EXIT_ERROR;
}

/** `set`: designate a run that has a started journal and is still open, since a closed seat refuses every lap. */
function setSeat({ deps, home, slug }: { deps: GithubLapSeatDeps; home: string; slug: string }): number {
  const closed = deps.runClosed({ home, slug });
  if (closed.isErr()) {
    return failed({ deps, error: closed.error });
  }
  if (closed.value) {
    deps.writeDiagnostic(
      `github lap-seat: ${slug} is closed, and a closed seat refuses every lap; designate an open run, or reopen it first`,
    );
    return EXIT_USAGE;
  }
  const sessionId = deps.sessionId();
  const setIso = deps.now().toISOString();
  const seat: LapSeat = sessionId === undefined ? { setIso, slug } : { setBy: sessionId, setIso, slug };
  const written = deps.writeSeat({ home, seat });
  if (written.isErr()) {
    return failed({ deps, error: written.error });
  }
  deps.out(seatLine({ seat }));
  return EXIT_OK;
}

/**
 * Run `github lap-seat`.
 *
 * @param rest argv after `github lap-seat`
 * @param deps every file and clock edge
 * @returns the process exit code
 */
export function runGithubLapSeat({ rest, deps }: { rest: readonly string[]; deps: GithubLapSeatDeps }): number {
  const parsed = parseGithubLapSeatArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...parsed.error.lines, GITHUB_LAP_SEAT_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let home = deps.home();
  if (args.home !== undefined) {
    home = args.home;
  }
  if (args.action === "set") {
    return setSeat({ deps, home, slug: args.slug });
  }
  if (args.action === "clear") {
    const cleared = deps.clearSeat({ home });
    if (cleared.isErr()) {
      return failed({ deps, error: cleared.error });
    }
    deps.out(
      cleared.value === "cleared"
        ? "github lap-seat: cleared; no rota stands, so any session may lap"
        : "github lap-seat: none stood; nothing to clear",
    );
    return EXIT_OK;
  }
  const seat = deps.readSeat({ home });
  if (seat.isErr()) {
    return failed({ deps, error: seat.error });
  }
  const machine = machineLine({ lock: deps.readLapLock({ home }) });
  if (seat.value === undefined) {
    deps.out("github lap-seat: none stands; any session may lap");
    deps.out(machine);
    return EXIT_EXPECTED_EMPTY;
  }
  deps.out(seatLine({ seat: seat.value }));
  deps.out(machine);
  return EXIT_OK;
}

/**
 * Production seams for `github lap-seat`.
 *
 * @returns the real home, clock, session id, store and output
 */
export function productionGithubLapSeatDeps(): GithubLapSeatDeps {
  return {
    clearSeat: clearLapSeat,
    home: slopweaverHome,
    now: () => new Date(),
    out: (line) => {
      logger.out({ line });
    },
    readLapLock: readStandingLapLock,
    readSeat: readLapSeat,
    runClosed: lapSeatRunClosed,
    sessionId: () => currentSessionId({ env: process.env }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeSeat: writeLapSeat,
  };
}

/** Where a verb's own flags start in `argv`: node, the binary, the noun and the verb come first. */
const VERB_ARG_OFFSET = 4;

/** `slopweaver github lap-seat`, over the production seams. */
export const githubLapSeatCommand = defineCommand({
  run: (argv) => runGithubLapSeat({ deps: productionGithubLapSeatDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
