/**
 * What calls made INSIDE cmux last heard back, so `cmux revive`, which runs outside it, can tell a hung cmux from a
 * live one.
 *
 * MEASURED: cmux's request handlers hung (inside every seat `window.list`,
 * `read-screen` and `workspace.create` gave nothing for 15s, and the sidebar CLI hit `spawnSync cmux ETIMEDOUT`) while
 * its `cmuxOnly` access layer still answered the outside knock with `ERROR: Access denied - only processes started
 * inside cmux can connect`. That refusal proves the accept loop alive and says nothing of the handlers behind it, and
 * an outside process cannot get past it: cmux admits a caller by a per-launch capability token exported only into
 * its own surfaces (`docs/cmux-client/socket-and-measured-facts.md`). So the hang has to be read from the calls the
 * seats already make. The reading: the revive journal's first entry on this machine — `answering`, the
 * same minute a seat's `slopweaver cmux list` printed `window.list did not answer within 15000ms`
 * (`supervisor-scratch/handoff-<n>/evidence/cmux-revive-outside-knock-reads-access-denied-as-answering.md`).
 *
 * Each live call a seat makes stamps one of two tiny files in the home's runtime directory (`../stateRuntime.ts`'s
 * `runtimeCmuxDir`) with when it ended: `cmux-inside-answered.json` for any reply (an error reply included),
 * `cmux-inside-unanswered.json` for a timeout. Two files rather than one, so seats writing at once never overwrite
 * each other's outcome. Runtime state, not the store: a stamp only counts inside the run of the app it was heard
 * from, and no reboot leaves that app running. Nothing runs to make a call: a hang no seat feels is never restarted
 * (rule 2: no daemon). A timeout also looks once a minute for the modal dialog that can hang cmux and declines
 * it (`./dialogRecovery.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../config.js";
import { type FleetError, FleetErrors } from "../fleet/errors.js";
import { runtimeCmuxDir } from "../stateRuntime.js";
import { productionDialogRecoveryDeps, recoverDialogAfterTimeout } from "./dialogRecovery.js";
import type { CmuxError } from "./errors.js";
import type { CmuxSocket } from "./socket.js";

/** How one call inside cmux ended: cmux replied, or the call's bound passed with no reply. */
export type InsideCallOutcome = "answered" | "unanswered";

/** The newest call inside cmux that the outside verb may judge by. */
export interface InsideCallEvidence {
  readonly outcome: InsideCallOutcome;
  readonly atIso: string;
}

/** The evidence, and how many of the two files would not decode — one that would not could hold the newer outcome. */
export interface InsideCallRead {
  readonly evidence: InsideCallEvidence | undefined;
  /**
   * When a seat's call was last answered, even under a newer timeout: an answer between two outside probes breaks
   * the hang, though only the newest outcome survives to the second.
   */
  readonly answeredIso: string | undefined;
  readonly unreadable: number;
}

const stampSchema = z.object({ atIso: z.iso.datetime(), schemaVersion: z.literal(1) });

const OUTCOMES: readonly InsideCallOutcome[] = ["answered", "unanswered"];

/**
 * How far ahead of a write an existing stamp may be and still stand: a late seat, as against a stamp from a clock
 * that ran ahead, which would otherwise refuse every later write. Fifteen minutes is the hang bound and one reading gap.
 */
const LATE_WRITER_MS = 15 * 60_000;

/** Where one outcome's stamp lives, or why the runtime directory holding it is unavailable. */
function stampPath({ home, outcome }: { home: string; outcome: InsideCallOutcome }): Result<string, FleetError> {
  return runtimeCmuxDir({ home })
    .map((directory) => join(directory, `cmux-inside-${outcome}.json`))
    .mapErr((error) => FleetErrors.runtimeUnavailable({ detail: error.message }));
}

/**
 * Stamp one outcome with the instant its call ended, replacing an older stamp of that outcome. A stamp never moves
 * backwards: a seat finishing late would otherwise hide a newer answer behind its older one.
 * Read-then-write leaves a writer paused between the two able to, which is one reading, never a ten-minute run.
 *
 * @param home the state home
 * @param outcome how the call ended
 * @param atIso when it ended
 * @returns nothing, or why the stamp could not be written
 */
export function recordInsideCall({
  home,
  outcome,
  atIso,
}: {
  home: string;
  outcome: InsideCallOutcome;
  atIso: string;
}): Result<void, FleetError> {
  if (!stampSchema.shape.atIso.safeParse(atIso).success) {
    return err(FleetErrors.stampInvalid({ atIso }));
  }
  const located = stampPath({ home, outcome });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  const existing = readStamp({ home, outcome });
  if (existing.isOk() && existing.value.kind === "stamp") {
    const aheadMs = Date.parse(existing.value.atIso) - Date.parse(atIso);
    if (aheadMs >= 0 && aheadMs <= LATE_WRITER_MS) {
      return ok(undefined);
    }
  }
  try {
    const contents = `${JSON.stringify({ atIso, schemaVersion: 1 })}\n`;
    writeFileAtomic({ contents, dirMode: 0o700, fileMode: 0o600, path });
    return ok(undefined);
  } catch (cause) {
    return err(FleetErrors.io({ cause, path }));
  }
}

/** One stamp file: absent, unreadable, or the instant it carries. */
type StampRead =
  { readonly kind: "absent" } | { readonly kind: "unreadable" } | { readonly kind: "stamp"; readonly atIso: string };

/** Read one stamp file. */
function readStamp({ home, outcome }: { home: string; outcome: InsideCallOutcome }): Result<StampRead, FleetError> {
  const located = stampPath({ home, outcome });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok({ kind: "absent" });
    }
    return err(FleetErrors.io({ cause, path }));
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return ok({ kind: "unreadable" });
  }
  const parsed = stampSchema.safeParse(value);
  return ok(parsed.success ? { atIso: parsed.data.atIso, kind: "stamp" } : { kind: "unreadable" });
}

/**
 * The newest outcome that belongs to this app and has happened: a stamp from before the app started is the previous
 * app's, and one after now is a clock that cannot be trusted. On a tie the answer wins, so a tie never reads as a hang.
 *
 * @param stamps each outcome's stamp, where one decoded
 * @param appStartedMs when the running cmux app started
 * @param nowMs the instant judged
 * @returns the newest outcome, or `undefined` when no stamp qualifies
 */
export function newestInsideCall({
  stamps,
  appStartedMs,
  nowMs,
}: {
  stamps: readonly InsideCallEvidence[];
  appStartedMs: number;
  nowMs: number;
}): InsideCallEvidence | undefined {
  let newest: InsideCallEvidence | undefined;
  for (const stamp of stamps) {
    const atMs = Date.parse(stamp.atIso);
    if (atMs <= appStartedMs || atMs > nowMs) {
      continue;
    }
    const newer = newest === undefined || atMs > Date.parse(newest.atIso);
    const tieWon = newest !== undefined && atMs === Date.parse(newest.atIso) && stamp.outcome === "answered";
    if (newer || tieWon) {
      newest = stamp;
    }
  }
  return newest;
}

/**
 * Read both stamps and pick the newest outcome for this app. A stamp that will not decode yields no evidence at all,
 * because it could have been the newer one.
 *
 * @param home the state home
 * @param appStartedMs when the running cmux app started
 * @param nowMs the instant judged
 * @returns the evidence and the undecodable count, or why a file could not be read
 */
export function readInsideCallEvidence({
  home,
  appStartedMs,
  nowMs,
}: {
  home: string;
  appStartedMs: number;
  nowMs: number;
}): Result<InsideCallRead, FleetError> {
  const stamps: InsideCallEvidence[] = [];
  let unreadable = 0;
  for (const outcome of OUTCOMES) {
    const read = readStamp({ home, outcome });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value.kind === "unreadable") {
      unreadable += 1;
    } else if (read.value.kind === "stamp") {
      stamps.push({ atIso: read.value.atIso, outcome });
    }
  }
  if (unreadable > 0) {
    return ok({ answeredIso: undefined, evidence: undefined, unreadable });
  }
  const answers = stamps.filter((stamp) => stamp.outcome === "answered");
  const answered = newestInsideCall({ appStartedMs, nowMs, stamps: answers });
  const evidence = newestInsideCall({ appStartedMs, nowMs, stamps });
  return ok({ answeredIso: answered?.atIso, evidence, unreadable });
}

/**
 * How a socket call ended, as evidence: any reply — an error reply or a malformed one included — is an answer, a
 * timeout is none, and a connection that failed is the outside knock's to see, so it says nothing here.
 *
 * @param result what the call returned
 * @returns the outcome, or `undefined` when the call is no evidence either way
 */
export function socketCallOutcome({ result }: { result: Result<unknown, CmuxError> }): InsideCallOutcome | undefined {
  if (result.isOk()) {
    return "answered";
  }
  if (result.error.code === "SOCKET_UNAVAILABLE") {
    return undefined;
  }
  return result.error.code === "TIMEOUT" ? "unanswered" : "answered";
}

/**
 * How a `cmux` CLI run that threw ended, as evidence: its bound passing is the hang, and every other failure — no
 * binary, a refused socket, a non-zero exit — is no evidence either way.
 *
 * @param error what `execFileSync` threw
 * @returns `unanswered` for a timeout, else `undefined`
 */
export function cliFailureOutcome({ error }: { error: unknown }): InsideCallOutcome | undefined {
  const timedOut = error instanceof Error && "code" in error && error.code === "ETIMEDOUT";
  return timedOut ? "unanswered" : undefined;
}

/** Stamps one call's outcome, and after a timeout looks for the dialog; settles once both are done, never rejecting. */
export type InsideRecorder = (options: { outcome: InsideCallOutcome }) => Promise<void>;

/**
 * Wrap a socket so each call's outcome is recorded when it ends, returning the call's result untouched.
 *
 * @param socket the socket every call goes through, retries included, so one call is one outcome
 * @param record stamps one outcome
 * @returns the recording socket
 */
export function recordingCmuxSocket({ socket, record }: { socket: CmuxSocket; record: InsideRecorder }): CmuxSocket {
  return {
    call: async (request) => {
      const result = await socket.call(request);
      const outcome = socketCallOutcome({ result });
      if (outcome !== undefined) {
        await record({ outcome });
      }
      return result;
    },
    close: () => {
      socket.close();
    },
  };
}

/**
 * The socket a client makes its calls through: recording, when it is the live socket and this process is a seat; as
 * given otherwise — a named socket is a test's fake or a caller's own, and says nothing about cmux.
 *
 * @param socket the retrying socket
 * @param live whether it is the resolved live socket rather than a named one
 * @returns the socket to call through
 */
export function recordedWhenLive({ socket, live }: { socket: CmuxSocket; live: boolean }): CmuxSocket {
  const record = liveInsideRecorder();
  return live && record !== undefined ? recordingCmuxSocket({ record, socket }) : socket;
}

/**
 * A recorder over one home: stamp each outcome, and after a timeout — once it is stamped — hand the home to
 * `recover`, which declines cmux's allowlisted dialog (`./dialogRecovery.ts`). An answered call never looks for a
 * dialog. A stamp that cannot be written is logged and never fails the call.
 *
 * @param home the state home
 * @param nowIso the clock
 * @param recover what a timeout runs after its stamp; it must never throw
 * @returns the recorder
 */
export function insideRecorder({
  home,
  nowIso,
  recover,
}: {
  home: string;
  nowIso: () => string;
  recover: (options: { home: string }) => Promise<void>;
}): InsideRecorder {
  return async ({ outcome }) => {
    const recorded = recordInsideCall({ atIso: nowIso(), home, outcome });
    if (recorded.isErr()) {
      logger.error({ msg: `cmux: could not record a call's outcome for cmux revive — ${recorded.error.message}` });
    }
    if (outcome === "unanswered") {
      await recover({ home });
    }
  };
}

/**
 * The recorder a live call in this process uses: {@link insideRecorder} over the state home, when cmux's own
 * environment marks this process as one of its seats, and `undefined` otherwise — a process outside cmux cannot reach
 * its handlers, so nothing it hears is evidence.
 *
 * @returns the recorder, or `undefined` outside cmux
 */
export function liveInsideRecorder(): InsideRecorder | undefined {
  const workspace = process.env["CMUX_WORKSPACE_ID"];
  if (workspace === undefined || workspace.trim() === "") {
    return undefined;
  }
  return insideRecorder({
    home: slopweaverHome(),
    nowIso: () => new Date().toISOString(),
    recover: ({ home }) => recoverDialogAfterTimeout({ deps: productionDialogRecoveryDeps(), home }),
  });
}
