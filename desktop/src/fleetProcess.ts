/**
 * The fleet's effects: read its health, knock on cmux and revive it when hung, open cmux, type one line into a
 * new cmux tab, and run the Recovery check on the owner's press. The decisions are `fleetAutomation.ts`, `fleetHealth.ts` and `cmuxRevive.ts`; this file only runs
 * processes and files.
 *
 * ## Why AppleScript, and not the cmux socket
 *
 * cmux refuses a socket client it did not start (measured, `Access denied — only processes started inside
 * cmux can connect`), and this shell is started by Finder. cmux's own AppleScript dictionary is the one door it
 * opens to an outside app, gated by macOS Automation consent: open a tab, type a line, press return. The line is
 * passed as an ARGUMENT to the script, never spliced into its source, so no character in it can change what the
 * script does. With no cmux window open the script makes one first — `new tab in front window` fails on none.
 */
import { type ExecFileOptionsWithStringEncoding, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { err, ok, ResultAsync } from "neverthrow";

import { type CmuxReviveReading, parseCmuxRevive } from "./cmuxRevive";
import { childEnv } from "./consoleEndpoint";
import {
  type FleetError,
  FleetErrors,
  type FleetRecoveryError,
  FleetRecoveryErrors,
  lastLine,
  type StateError,
  StateErrors,
} from "./errors";
import { decodeFleetAutomation, type FleetAutomation, NO_EPISODE } from "./fleetAutomationEpisode";
import { type FleetHealth, parseFleetHealth } from "./fleetHealth";
import { type FleetRecoveryResult, parseFleetRecovery } from "./fleetRecoveryCheck";

/** `fleet health` reads processes, sessions and the board: seconds, bounded well above. */
const HEALTH_TIMEOUT_MS = 60_000;

/** `cmux revive`: a knock is seconds, a restart a quit's grace plus five minutes waiting for the reopened app. */
const REVIVE_TIMEOUT_MS = 6 * 60_000;

/**
 * `fleet recover`: two cards, each given its own deadline to start and answer, then closed — the limit on the owner's
 * card, above the verb's own worst case.
 */
const RECOVERY_TIMEOUT_MS = 14 * 60_000;

/** `osascript` opening a tab, or `open -a cmux`: seconds. */
const BRIDGE_TIMEOUT_MS = 30_000;

/** macOS's "not authorised to send Apple events" — Automation consent refused or not yet given. */
const NOT_AUTHORISED = "-1743";

/**
 * The script that opens a tab in cmux and types its one argument, then presses return — and brings cmux to the
 * front only when `raise` says so.
 *
 * An AUTOMATIC recovery never raises it. Measured (`fleet/resume.jsonl`): a brief `down` reading launched the
 * episode's automatic `fleet resume`, and this script's `activate` pulled cmux over the pull request the owner was
 * reading in Chrome, unprompted. A down fleet recovers on its own and the owner sees it when they open Sessions; the
 * owner's own button press is the one launch that takes them there.
 *
 * @param raise whether to bring cmux to the front once the tab is typed — the owner's button press, never an automatic one
 * @returns the AppleScript source lines
 */
export function openTabScript({ raise }: { raise: boolean }): readonly string[] {
  return [
    "on run argv",
    'tell application "cmux"',
    "if (count of windows) = 0 then",
    "set win to new window",
    "else",
    "set win to front window",
    "end if",
    "set w to new tab in win",
    "set t to focused terminal of w",
    "input text (item 1 of argv) & return to t",
    ...(raise ? ["activate"] : []),
    "return id of w",
    "end tell",
    "end run",
  ];
}

/**
 * `open`'s arguments for cmux: `-g` keeps a launch or a knock in the background, so only the owner's own press raises it.
 *
 * @param raise whether to bring cmux to the front
 * @returns the argv after `open`
 */
export function openCmuxArgs({ raise }: { raise: boolean }): readonly string[] {
  return raise ? ["-a", "cmux"] : ["-g", "-a", "cmux"];
}

/** What one process run ended with. */
export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * What `run` reads off `execFile`'s failure: spelled by field, since node's own `ExecFileException` alias is
 * deprecated and `ExecException` types `code` as a number only, which the exit-code-or-errno `code` is not.
 */
type ExecFileFailure = Error & {
  readonly code?: string | number | null | undefined;
  readonly killed?: boolean | undefined;
};

/** `execFile`'s own callback contract: the failure if any, then what the child wrote to stdout and stderr. */
type ExecFileDone = (error: ExecFileFailure | null, stdout: string, stderr: string) => void;

/**
 * Run one program with no shell, bounded, under a PATH that carries node. The program is NOT a parameter: `launch`
 * is the caller's own `execFile` call, program first, so every program this file starts is spelled at
 * a call rule 2's `no-headless` gate recognises by what it runs. A `run({ file, args })` that took any program would
 * leave one recognised call that a later caller could hand a model runner without touching it.
 *
 * @param cwd where it runs
 * @param label what to call the program in a timeout message
 * @param launch the caller's `execFile` call, given the options and callback to pass it
 * @param timeoutMs how long it may run
 * @returns what it printed and its exit code, or why it could not run at all
 */
export function run({
  cwd,
  label,
  launch,
  timeoutMs,
}: {
  cwd: string | undefined;
  label: string;
  launch: (execFileArgs: { options: ExecFileOptionsWithStringEncoding; done: ExecFileDone }) => void;
  timeoutMs: number;
}): ResultAsync<Ran, string> {
  const options: ExecFileOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    env: childEnv({ home: homedir(), inherited: process.env }),
    maxBuffer: 8 * 1024 * 1024,
    timeout: timeoutMs,
  };
  return ResultAsync.fromPromise(
    new Promise<Ran>((resolve, reject) => {
      launch({
        done: (error, stdout, stderr) => {
          if (error !== null && typeof error.code !== "number") {
            reject(
              new Error(
                error.killed
                  ? `${label} did not finish in ${String(timeoutMs / 1000)}s`
                  : `${error.message}\n${stderr}`,
              ),
            );
            return;
          }
          resolve({ code: error === null ? 0 : Number(error.code), stderr, stdout });
        },
        options,
      });
    }),
    (cause) => (cause instanceof Error ? cause.message : String(cause)),
  );
}

/**
 * The fleet's health, read through the checkout's own CLI. Exit 3 is a fleet that is not healthy — the very
 * document the page shows — so the exit code decides nothing; whether stdout carries the document does.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 * @returns the reading, or why there is none
 */
export function readFleetHealth({ checkout }: { checkout: string }): ResultAsync<FleetHealth, FleetError> {
  return run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(join(checkout, "bin", "slopweaver"), ["fleet", "health", "--json"], options, done),
    timeoutMs: HEALTH_TIMEOUT_MS,
  })
    .mapErr((detail) => FleetErrors.unreadable({ detail }))
    .andThen((ran) => {
      const parsed = parseFleetHealth({ text: ran.stdout });
      if (parsed.isErr() && ran.code !== 0 && ran.code !== 3) {
        return err(FleetErrors.unreadable({ detail: ran.stderr }));
      }
      return parsed;
    });
}

/**
 * Run the Recovery check through the checkout's own CLI, on the owner's press and nothing else. This is the one
 * call in the app that causes model sessions, and every one is a visible throwaway card in this app that the owner
 * can watch and stop, opened one at a time by the verb (`src/fleet/recoveryPass.ts`). The verb exits 1 or 3 beside a
 * perfectly good result, so the exit code decides nothing; whether stdout carries the one document does.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 * @returns the result, or why the press produced none
 */
export function recoverFleet({ checkout }: { checkout: string }): ResultAsync<FleetRecoveryResult, FleetRecoveryError> {
  const label = join(checkout, "bin", "slopweaver");
  return run({
    cwd: checkout,
    label,
    launch: ({ done, options }) => execFile(join(checkout, "bin", "slopweaver"), ["fleet", "recover"], options, done),
    timeoutMs: RECOVERY_TIMEOUT_MS,
  })
    .mapErr((detail) =>
      // `run` words a timeout exactly this way, and that is the only failure it words without the child's stderr.
      detail === `${label} did not finish in ${String(RECOVERY_TIMEOUT_MS / 1000)}s`
        ? FleetRecoveryErrors.timeout({ seconds: RECOVERY_TIMEOUT_MS / 1000 })
        : FleetRecoveryErrors.didNotRun({ detail }),
    )
    .andThen((ran) => {
      const parsed = parseFleetRecovery({ text: ran.stdout });
      if (parsed.isErr() && ran.stdout.trim().length === 0) {
        return err(FleetRecoveryErrors.didNotRun({ detail: ran.stderr }));
      }
      return parsed;
    });
}

/**
 * Knock on cmux from outside it and, when it has hung past its bound, quit and reopen it — through the checkout's
 * own CLI, which journals what it heard so `fleet health` reads the same answer. Bounded above the verb's own worst
 * case: a quit's grace, then five minutes for the reopened app to answer.
 *
 * @param checkout the checkout whose `bin/slopweaver` runs
 * @returns the reading, or why there is none
 */
export function reviveCmux({ checkout }: { checkout: string }): ResultAsync<CmuxReviveReading, string> {
  return run({
    cwd: checkout,
    label: join(checkout, "bin", "slopweaver"),
    launch: ({ done, options }) =>
      execFile(join(checkout, "bin", "slopweaver"), ["cmux", "revive", "--json"], options, done),
    timeoutMs: REVIVE_TIMEOUT_MS,
  }).andThen((ran) => {
    const parsed = parseCmuxRevive({ text: ran.stdout });
    if (parsed.isErr()) {
      return err(`${parsed.error}: ${lastLine({ text: ran.stderr })}`);
    }
    return parsed;
  });
}

/**
 * Bring cmux up, launching it when it is not running.
 *
 * @param raise whether to bring it to the front ({@link openCmuxArgs})
 * @returns nothing once it is open, or why it did not open
 */
export function openCmux({ raise }: { raise: boolean }): ResultAsync<void, FleetError> {
  return run({
    cwd: undefined,
    label: "open",
    launch: ({ done, options }) => execFile("open", [...openCmuxArgs({ raise })], options, done),
    timeoutMs: BRIDGE_TIMEOUT_MS,
  })
    .mapErr((detail) => FleetErrors.cmuxUnavailable({ detail }))
    .andThen((ran) => (ran.code === 0 ? ok(undefined) : err(FleetErrors.cmuxUnavailable({ detail: ran.stderr }))));
}

/**
 * Open cmux, then a new tab in it, and type one line there — the recovery runs where the owner can see it, in front of them
 * only when they pressed for it.
 *
 * @param line the line to type, already built from fixed parts
 * @param raise whether to bring cmux to the front ({@link openTabScript})
 * @returns nothing once it was typed, or why it was not
 */
export function launchInCmux({ line, raise }: { line: string; raise: boolean }): ResultAsync<void, FleetError> {
  const args = [...openTabScript({ raise }).flatMap((source) => ["-e", source]), line];
  // Opened in the background either way: the script's own `activate`, once the line is typed, is the one raise.
  return openCmux({ raise: false }).andThen(() =>
    run({
      cwd: undefined,
      label: "osascript",
      launch: ({ done, options }) => execFile("osascript", args, options, done),
      timeoutMs: BRIDGE_TIMEOUT_MS,
    })
      .mapErr((detail) => FleetErrors.launchFailed({ detail }))
      .andThen((ran) => {
        if (ran.code === 0) {
          return ok(undefined);
        }
        if (ran.stderr.includes(NOT_AUTHORISED)) {
          return err(FleetErrors.automationDenied({ detail: ran.stderr }));
        }
        return err(FleetErrors.launchFailed({ detail: ran.stderr }));
      }),
  );
}

/**
 * The saved episode, or none on a first launch.
 *
 * @param path the file in `userData`
 * @returns the memory, or why the file there could not be used
 */
export function readFleetAutomation({ path }: { path: string }): ResultAsync<FleetAutomation, StateError> {
  return ResultAsync.fromPromise(
    readFile(path, "utf8").then(
      (text): string | undefined => text,
      (cause: unknown) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return undefined;
        }
        throw cause;
      },
    ),
    (cause) => StateErrors.unreadable({ detail: cause instanceof Error ? cause.message : String(cause) }),
  ).andThen((text) => {
    if (text === undefined) {
      return ok(NO_EPISODE);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return err(StateErrors.malformed({ field: "fleet (not JSON)" }));
    }
    return decodeFleetAutomation({ value });
  });
}

/**
 * Save the episode atomically.
 *
 * @param path the file in `userData`
 * @param automation what to save
 * @returns nothing on success, or why it could not be written
 */
export function writeFleetAutomation({
  path,
  automation,
}: {
  path: string;
  automation: FleetAutomation;
}): ResultAsync<void, StateError> {
  // One temporary file per write, so two writes can never share one and land each other's bytes.
  const temporary = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  return ResultAsync.fromPromise(
    writeFile(temporary, `${JSON.stringify(automation, null, 2)}\n`, "utf8").then(() => rename(temporary, path)),
    (cause) => StateErrors.unwritable({ detail: cause instanceof Error ? cause.message : String(cause) }),
  );
}
