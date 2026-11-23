/**
 * `slopweaver google adc` — read whether Google Application Default Credentials work, and when a sign-in is the
 * fix, hand the supervisor the one floating-note line and WAIT on the credential rather than run the sign-in.
 *
 * ## Why this verb exists
 *
 * A seat that runs `gcloud auth application-default login` from its own shell and moves on leaves the localhost
 * redirect with nothing listening: the owner finds the tab, signs in, and lands on a broken page.
 * The fleet waits on the owner longer, and a floating note carries a command to copy.
 *
 * So the listener moves to the OWNER's terminal — the note's literal is the sign-in command — and the seat waits on the
 * one thing the owner's sign-in changes. Nothing here opens a browser or a socket, so nothing a seat does (idling, being
 * closed, its Bash call timing out) can break the owner's redirect. `src/admit/adcSigninCommand.ts` refuses the raw login
 * from a session and names this verb.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  type AdcProbeMemo,
  type AdcReading,
  type AdcSource,
  adcSource,
  readingLine,
  shouldProbe,
  signInFixes,
} from "../../../gcloud/adc.js";
import { adcFingerprint, probeAdc } from "../../../gcloud/adcProbe.js";
import { ADC_SIGNIN_ID_PREFIX, adcSigninLine } from "../../../hand/adcSignin.js";
import { seatPostVerdict } from "../../../hand/seatPost.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import {
  LOCAL_WAIT_CEILING_MS,
  LOCAL_WAIT_SCHEDULE_MS,
  PROVIDER_WAIT_CEILING_MS,
  realWaitClock,
  type WaitClock,
  waitUntilSettled,
} from "../../../wait/loop.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { namedRowRefusal } from "../hand/post.js";

import { type GoogleAdcArgs, parseGoogleAdcArgs } from "./adcArgs.js";
import { GOOGLE_ADC_USAGE } from "./adcUsage.js";

/** How long a seat should wait in the background: a working day, so the owner can be away and come back to it. */
export const ADC_BACKGROUND_WAIT_SECONDS = 28_800;

/** Who should post the note: this caller (it is the chair, or no chair is pinned), or the chair on its behalf. */
export type AdcRelay = "self" | "chair";

/** The effects `google adc` performs, injectable so a test drives the whole verb with plain fakes. */
export interface GoogleAdcDeps {
  readonly clock: WaitClock;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** One real token read — never returns the token. */
  readonly probe: (args: { source: AdcSource }) => Promise<AdcReading>;
  /** The credential file's `mtimeMs:size`, or `missing`. */
  readonly fingerprint: (args: { path: string }) => string;
  /** The ids of open hand steps that are ADC sign-ins, so a second seat does not send a second line. */
  readonly openSignins: (args: { home: string | undefined }) => Result<readonly string[]>;
  /** Why `--row` cannot be named on a card, or undefined when it can. */
  readonly rowRefusal: (args: { home: string | undefined; row: string }) => string | undefined;
  readonly relay: (args: { home: string | undefined }) => AdcRelay;
  readonly out: (line: string) => void;
  readonly error: (line: string) => void;
}

/**
 * Print what stands in for the note: an open step's id, the line for whoever posts it, or what is missing.
 *
 * @param args the invocation
 * @param deps the effects
 * @returns the step id the wait should tell the seat to settle, the refusal exit, or undefined
 */
function reportTheNote({
  args,
  deps,
}: {
  args: GoogleAdcArgs;
  deps: GoogleAdcDeps;
}): Result<string | undefined, number> {
  const open = deps.openSignins({ home: args.home });
  if (open.isErr()) {
    deps.error(
      `google adc: could not read the hand register (${open.error.join("; ")}) — checking nothing for a duplicate`,
    );
  }
  if (open.isOk() && open.value.length > 0) {
    deps.out(`the owner's note is already up: ${open.value.join(", ")} — do not send the supervisor another line`);
    return ok(open.value[0]);
  }
  if (args.unblocks === undefined) {
    deps.out("pass --row <slug> or --unblocks <text> for the one line that puts the sign-in on the owner's screen");
    return ok(undefined);
  }
  if (args.row !== undefined) {
    const refused = deps.rowRefusal({ home: args.home, row: args.row });
    if (refused !== undefined) {
      deps.error(refused);
      return err(EXIT_USAGE);
    }
  }
  const cloudsdkConfig = deps.env["CLOUDSDK_CONFIG"];
  const workspace = deps.env["CMUX_WORKSPACE_ID"];
  const built = adcSigninLine({
    input: {
      cites: args.cites,
      context: args.context,
      unblocks: args.unblocks,
      ...(args.row === undefined ? {} : { row: args.row }),
      ...(cloudsdkConfig === undefined || cloudsdkConfig.trim().length === 0 ? {} : { cloudsdkConfig }),
      ...(workspace === undefined || workspace.trim().length === 0 ? {} : { bySession: `workspace:${workspace}` }),
    },
  });
  if (built.isErr()) {
    deps.error(`google adc: the note would be refused — ${built.error.message}`);
    return err(EXIT_USAGE);
  }
  deps.out(
    deps.relay({ home: args.home }) === "self"
      ? "post it yourself — you are the supervisor, or none is pinned:"
      : "send the supervisor this ONE line with SendMessage (never cmux send), and nothing else about the sign-in:",
  );
  deps.out(built.value.line);
  return ok(built.value.id);
}

/**
 * Why a reading a sign-in cannot fix is not the owner's to fix.
 *
 * @param reading the non-fixable reading
 * @returns one line naming what to do instead
 */
function notOwnersToFix({ reading }: { reading: AdcReading }): string {
  if (reading.source.kind === "env") {
    return `a sign-in cannot fix this: GOOGLE_APPLICATION_CREDENTIALS names ${reading.source.path}, which gcloud never rewrites — unset it or fix that file`;
  }
  return "a sign-in cannot fix this — the failure above is not a credential Google refused; fix it and read again";
}

/**
 * Wait until the credential works, probing the network only when the file changed or a minute has passed.
 *
 * @param args the invocation
 * @param deps the effects
 * @param first the reading already taken
 * @param firstFingerprint the file's fingerprint taken just before that reading
 * @param stepId the open or printed step, for the settle line
 * @returns `EXIT_OK` once valid, `EXIT_DEFERRED` at the timeout
 */
async function waitForSignIn({
  args,
  deps,
  first,
  firstFingerprint,
  stepId,
}: {
  args: GoogleAdcArgs;
  deps: GoogleAdcDeps;
  first: AdcReading;
  firstFingerprint: string;
  stepId: string | undefined;
}): Promise<number> {
  let memo: AdcProbeMemo = { fingerprint: firstFingerprint, probedAtMs: deps.clock.nowMs(), reading: first };
  let shown = readingLine({ reading: first });
  const outcome = await waitUntilSettled({
    ceilingMs: LOCAL_WAIT_CEILING_MS,
    clock: deps.clock,
    emit: (line) => {
      if (line !== shown) {
        deps.out(line);
        shown = line;
      }
    },
    lines: (reading) => [readingLine({ reading })],
    read: async () => {
      const fingerprint = deps.fingerprint({ path: first.source.path });
      const nowMs = deps.clock.nowMs();
      if (shouldProbe({ fingerprint, memo, minIntervalMs: PROVIDER_WAIT_CEILING_MS, nowMs })) {
        memo = { fingerprint, probedAtMs: nowMs, reading: await deps.probe({ source: first.source }) };
      }
      return memo.reading;
    },
    schedule: LOCAL_WAIT_SCHEDULE_MS,
    settled: (reading) => reading.state === "valid",
    timeoutSeconds: args.timeoutSeconds,
  });
  if (outcome.kind === "timed-out") {
    deps.out(
      `WAIT-TIMEOUT google adc still ${outcome.reading.state} after ${String(args.timeoutSeconds)}s — run the same wait again; do not send another line`,
    );
    return EXIT_DEFERRED;
  }
  deps.out(`WAIT-DONE google adc valid (read ${String(outcome.reads)} time(s))`);
  if (stepId !== undefined) {
    deps.out(`settle the owner's note: slopweaver hand done ${stepId} --did signed-in`);
  }
  return EXIT_OK;
}

/**
 * Run `google adc` over injected effects.
 *
 * @param rest the argv tail after `google adc`
 * @param deps the effects
 * @returns 0 valid, 3 a sign-in is needed, 4 still waiting at the timeout, 1 not fixable by a sign-in, 2 usage
 */
export async function runGoogleAdcWithDeps({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GoogleAdcDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out(GOOGLE_ADC_USAGE);
    return EXIT_OK;
  }
  const parsed = parseGoogleAdcArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, GOOGLE_ADC_USAGE].forEach((line) => {
      deps.error(line);
    });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const source = adcSource({ env: deps.env });
  if (source.isErr()) {
    source.error.forEach((line) => {
      deps.error(`google adc: ${line}`);
    });
    return EXIT_ERROR;
  }
  const fingerprint = deps.fingerprint({ path: source.value.path });
  const first = await deps.probe({ source: source.value });
  deps.out(readingLine({ reading: first }));
  if (first.state === "valid") {
    return EXIT_OK;
  }
  if (!signInFixes({ reading: first })) {
    deps.out(notOwnersToFix({ reading: first }));
    return EXIT_ERROR;
  }
  const note = reportTheNote({ args, deps });
  if (note.isErr()) {
    return note.error;
  }
  if (!args.wait) {
    const row = args.row === undefined ? "" : ` --row ${args.row}`;
    deps.out(
      `then wait in the BACKGROUND (never the foreground, never by running the sign-in yourself): slopweaver google adc${row} --wait --timeout-seconds ${String(ADC_BACKGROUND_WAIT_SECONDS)}`,
    );
    return EXIT_EXPECTED_EMPTY;
  }
  return waitForSignIn({ args, deps, first, firstFingerprint: fingerprint, stepId: note.value });
}

/**
 * The ids of open hand steps that are ADC sign-ins.
 *
 * @param home the state home, or the resolved one
 * @returns the ids, or why the register could not be read
 */
function openAdcSignins({ home }: { home: string | undefined }): Result<readonly string[]> {
  const read = readOpenHandSteps(home === undefined ? {} : { home });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  return ok(read.value.steps.map((step) => step.id).filter((id) => id.startsWith(ADC_SIGNIN_ID_PREFIX)));
}

/**
 * The production effects.
 *
 * @returns the real clock, environment, SDK probe, file stat, hand register, board and supervisor pin
 */
export function productionGoogleAdcDeps(): GoogleAdcDeps {
  return {
    clock: realWaitClock(),
    env: process.env,
    error: (line) => {
      logger.error({ msg: line });
    },
    fingerprint: adcFingerprint,
    openSignins: openAdcSignins,
    out: (line) => {
      logger.out({ line });
    },
    probe: probeAdc,
    relay: ({ home }) => {
      const pin = readSupervisorPin(home === undefined ? {} : { home });
      return seatPostVerdict({ command: "slopweaver hand post", env: process.env, pin }).kind === "ok"
        ? "self"
        : "chair";
    },
    rowRefusal: ({ home, row }) => namedRowRefusal({ home: resolveHome({ named: home }), row }),
  };
}

/** `slopweaver google adc` — the tail starts at index 4, after `google adc`. */
export const googleAdcCommand = defineCommand({
  run: (argv) => runGoogleAdcWithDeps({ deps: productionGoogleAdcDeps(), rest: argv.slice(4) }),
});
