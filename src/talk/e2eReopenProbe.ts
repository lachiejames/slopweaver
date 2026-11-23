/**
 * The one window in which a desktop TEST instance's call may be a reopen (`talk offer --test-instance e2e`). The owner's
 * reopen ruling is proven on a real reopened call by `slopweaver desktop e2e --call --only
 * call-reopen`, and only that scenario wants it: every other scenario's microphone opens on fifteen seconds of lead
 * silence, so a reminder armed on them would hand at three seconds and speak over the greeting `call-live` judges. So a
 * test call is judged a reopen only while this file names an instant still ahead AND the process that wrote it is still
 * running; the scenario writes it before its first call and removes it when it ends. A run killed before its `finally`
 * leaves the file behind, so the writer's pid is what closes the window at once: a
 * `call-live` run straight after a killed `call-reopen` would otherwise be reminded of its call B. The pid is carried
 * with its process's start, as an operation lock's holder is (`../admit/lockHolder.ts`'s `holderIsAlive`), so a pid
 * the OS has since handed to another process, or a zombie, reads as gone. A call
 * leg holding its lock also removes the file before EVERY scenario, and stops when a probe still reads after that
 * (`src/cli/commands/desktop/e2eCallDriver.ts`): only `call-reopen` writes it again, inside its
 * own scenario.
 *
 * What it does NOT close, stated so nobody discovers it: TWO legs at once. A
 * `call-reopen` run suspended past its whole lock-staleness budget (`legLockStaleMs`) loses the lock to a second leg;
 * resumed between that leg's disarm and its first offer, it arms a probe the second leg's call then reads. That needs a
 * process held stopped for a leg's whole budget, which neither a run nor the fleet does by accident. The mechanism that
 * would close it binds the window to the call-leg lock: `talk offer` honouring a probe only while its writer, by pid and
 * start, is the lock's CURRENT holder.
 *
 * The owner's calls never read it: `talk offer` asks only when `--test-instance e2e` is given, and then judges the test
 * instance's own calls alone (`./continuityCalls.ts`'s `testCallsSince`).
 */
import { readFileSync, rmSync } from "node:fs";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { holderIsAlive } from "../admit/lockHolder.js";
import { stateHomePaths } from "../stateHome.js";
import { type ReopenProbeError, ReopenProbeErrors } from "./e2eReopenProbeErrors.js";

/** The file's one shape: when the window closes by itself, and the process holding it open, by pid and start. */
const probeShape = z
  .object({ pid: z.number().int().positive(), start: z.string().min(1), untilIso: z.iso.datetime() })
  .strict();

/**
 * Whether a probe file's text arms the window at an instant: it parses as the one shape, its instant is still strictly
 * ahead, and its writer is still running. Anything else — no file, a torn one, a past instant, a writer gone — is no
 * window, so a test call stays no reopen.
 *
 * @param text the file's text, `undefined` when there is none
 * @param nowIso the instant judged
 * @param alive whether the process with that id and start still runs — {@link processAlive} in the verb, a plain fake
 * in a test
 * @returns whether the window is armed
 */
export function reopenProbeArmed({
  alive,
  nowIso,
  text,
}: {
  alive: (process: { pid: number; start: string }) => boolean;
  nowIso: string;
  text: string | undefined;
}): boolean {
  if (text === undefined) {
    return false;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  const parsed = probeShape.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  const now = Date.parse(nowIso);
  if (Number.isNaN(now) || Date.parse(parsed.data.untilIso) <= now) {
    return false;
  }
  return alive({ pid: parsed.data.pid, start: parsed.data.start });
}

/**
 * Whether the process that wrote the file still runs: its pid is addressable AND `ps` gives it the start the file
 * carries, so a reused pid or a zombie is no writer.
 *
 * @param pid the process id
 * @param start the process's start, as `ps` gave it when the file was written
 * @returns whether it is running
 */
export function processAlive({ pid, start }: { pid: number; start: string }): boolean {
  return holderIsAlive({ pid, start });
}

/**
 * The probe file's text, `undefined` when it cannot be read — absent is the ordinary case.
 *
 * @param home the state home
 * @returns the text, or `undefined`
 */
export function readReopenProbe({ home }: { home: string }): string | undefined {
  try {
    return readFileSync(stateHomePaths({ home }).talkE2eReopenProbeJson, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Arm the window until an instant, for as long as a process runs. Throws as `writeFileAtomic` does.
 *
 * @param home the state home
 * @param pid the process holding the window open: the run that writes it
 * @param start that process's start, as `ps` gives it
 * @param untilIso when the window closes by itself
 */
export function armReopenProbe({
  home,
  pid,
  start,
  untilIso,
}: {
  home: string;
  pid: number;
  start: string;
  untilIso: string;
}): void {
  writeFileAtomic({
    contents: JSON.stringify({ pid, start, untilIso }),
    path: stateHomePaths({ home }).talkE2eReopenProbeJson,
  });
}

/**
 * Close the window. The window is closed once {@link readReopenProbe} reads nothing, since that is the only way
 * `talk offer` arms one: so a file already gone is no failure, and neither is something in the way no read can open —
 * a directory at the path, which is never removed, since this run did not write it. Only a probe still READABLE after
 * the removal failed — a home it may not write, say — is a failure, returned rather than thrown so a call leg that
 * holds its lock releases it first.
 *
 * @param home the state home
 * @returns nothing once no probe a test call could read remains, else why one still does
 */
export function disarmReopenProbe({ home }: { home: string }): Result<void, ReopenProbeError> {
  const path = stateHomePaths({ home }).talkE2eReopenProbeJson;
  try {
    rmSync(path, { force: true });
    return ok(undefined);
  } catch (cause) {
    if (readReopenProbe({ home }) === undefined) {
      return ok(undefined);
    }
    return err(ReopenProbeErrors.stillArmed({ cause, path }));
  }
}
