/**
 * The effectful half of the fseventsd onset capture (`./onset.ts`): read the unified log and `ps` once
 * per ballooned fseventsd pid, and write what they said under the state home.
 *
 * Taken on any pass that reads fseventsd over the restart line, a live call included: a read stalls nothing, and
 * the log it exists to keep ages out whether or not a call is on. A capture already on disk for the pid is never
 * retaken, and the file is published EXCLUSIVELY and whole (`publishExclusive`), so two passes racing past the
 * existence check leave the first one's capture standing, and a write cut short leaves no file to read as
 * already taken. A failed `log` read writes nothing, so the next pass tries again while the log may still
 * hold it; a failed `ps` is written into the capture beside the log rather than costing the log, and is never
 * retaken, because a later `ps` over the same pids describes whatever holds them by then.
 *
 * The residue, stated: the key is the pid, as the monitor's card key is, so a reused pid whose old capture is still
 * on disk captures nothing for the later balloon.
 */
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { createFileExclusive, ensureDirectory, fsyncDirectories } from "../../lib/writeAtomic.js";

import { clientPidsOf, ONSET_LOG_ARGS, onsetCapturePath, renderOnsetCapture } from "./onset.js";

/**
 * The `log` read's bound, a FIRST bound to ratchet: about 22 times the 5.4 s it took on a healthy daemon
 * (`./onset.ts` carries the repro); a balloon's log is unmeasured.
 */
const LOG_TIMEOUT_MS = 120_000;

/** The `log` read's output ceiling, a first bound too: about 480 times the 136 KB it printed. */
const LOG_MAX_BUFFER = 64 * 1024 * 1024;

/** The bound on the one `ps` over the client pids. */
const PS_TIMEOUT_MS = 10_000;

/** The reads and the write one capture makes — real in production, plain fakes in a test. */
export interface OnsetCaptureSeams {
  readonly exists: (options: { path: string }) => boolean;
  readonly readLog: () => Result<string, string>;
  readonly readPs: (options: { pids: readonly number[] }) => Result<string, string>;
  /** Create the file only if it is absent: `already-existed` when another pass won the race. */
  readonly createExclusive: (options: {
    path: string;
    contents: string;
  }) => Result<"created" | "already-existed", string>;
}

/** What one capture attempt did, when it did not fail outright. */
export type OnsetOutcome =
  | {
      readonly kind: "captured";
      readonly path: string;
      readonly clients: number;
      /** Why `ps` over the client pids failed, written into the capture beside the log; `undefined` when it did not. */
      readonly psProblem: string | undefined;
    }
  | { readonly kind: "already"; readonly path: string };

/**
 * Capture one balloon's log and client pids, unless this pid's capture is already on disk.
 *
 * @param home the state home the capture is written under
 * @param pid the ballooned fseventsd's pid
 * @param bytes its footprint as read
 * @param nowIso the instant of the capture
 * @param seams the reads and the write
 * @returns `captured` with the file, the client count and any `ps` problem, `already` when it was on disk, or why
 *   the log could not be read or the file written
 */
export function captureOnset({
  home,
  pid,
  bytes,
  nowIso,
  seams,
}: {
  home: string;
  pid: number;
  bytes: number;
  nowIso: string;
  seams: OnsetCaptureSeams;
}): Result<OnsetOutcome, string> {
  const path = onsetCapturePath({ home, pid });
  if (seams.exists({ path })) {
    return ok({ kind: "already", path });
  }
  const log = seams.readLog();
  if (log.isErr()) {
    return err(`\`/usr/bin/log show\` for fseventsd failed: ${log.error}`);
  }
  const clients = clientPidsOf({ daemonPid: pid, text: log.value });
  let psText = "(the log names no client pid)";
  let psProblem: string | undefined;
  if (clients.length > 0) {
    const ps = seams.readPs({ pids: clients });
    if (ps.isOk()) {
      psText = ps.value;
    } else {
      psProblem = ps.error;
      psText = `UNREADABLE: ${ps.error}`;
    }
  }
  const contents = renderOnsetCapture({ bytes, clients, logText: log.value, nowIso, pid, psText });
  const created = seams.createExclusive({ contents, path });
  if (created.isErr()) {
    return err(`could not write ${path}: ${created.error}`);
  }
  if (created.value === "already-existed") {
    return ok({ kind: "already", path });
  }
  return ok({ clients: clients.length, kind: "captured", path, psProblem });
}

/**
 * The real reads and write: `/usr/bin/log`, `/bin/ps`, and an exclusive create.
 *
 * @returns the production seams
 */
export function productionOnsetSeams(): OnsetCaptureSeams {
  return {
    createExclusive: ({ path, contents }) =>
      publishExclusive({ contents, path, stagedPath: `${path}.${String(process.pid)}.staged` }),
    exists: ({ path }) => existsSync(path),
    readLog: () => {
      try {
        const options = { encoding: "utf8", maxBuffer: LOG_MAX_BUFFER, timeout: LOG_TIMEOUT_MS } as const;
        return ok(execFileSync("/usr/bin/log", [...ONSET_LOG_ARGS], options));
      } catch (error) {
        return err(errorMessage({ error }));
      }
    },
    readPs: ({ pids }) => {
      try {
        const args = ["-o", "pid=,lstart=,comm=", "-p", pids.join(",")];
        return ok(execFileSync("/bin/ps", args, { encoding: "utf8", timeout: PS_TIMEOUT_MS }));
      } catch (error) {
        return psStdoutOr({ error });
      }
    },
  };
}

/**
 * Publish a capture all-or-nothing and exclusively: write and fsync a staged sibling, then hard-link it to the
 * capture path, which fails with `EEXIST` when another pass got there first. The capture path therefore only ever
 * names a complete file, because a capture created in place and then cut short by a failed write or fsync would
 * stand on disk as `already` and stop every later pass retrying it. The staged file is
 * removed whatever happened once its write began.
 *
 * @param path the capture's own path, the one `captureOnset` checks for existence
 * @param stagedPath a sibling path unique to this process, written first and always removed
 * @param contents the whole capture
 * @returns `created`, `already-existed` when the capture path was taken first, or why staging or linking failed
 */
export function publishExclusive({
  path,
  stagedPath,
  contents,
}: {
  path: string;
  stagedPath: string;
  contents: string;
}): Result<"created" | "already-existed", string> {
  let stagingBegan = false;
  try {
    ensureDirectory({ directory: dirname(path) });
    rmSync(stagedPath, { force: true });
    stagingBegan = true;
    createFileExclusive({ contents, path: stagedPath });
    try {
      linkSync(stagedPath, path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        return ok("already-existed");
      }
      throw error;
    }
    fsyncDirectories({ paths: [path] });
    return ok("created");
  } catch (error) {
    return err(errorMessage({ error }));
  } finally {
    if (stagingBegan) {
      rmSync(stagedPath, { force: true });
    }
  }
}

/**
 * `ps` exits 1 when any listed pid has gone, with the live rows still on stdout, so those rows are kept and the
 * exited pids named as such. Anything else is a failure, rows or not: a `ps` killed by its timeout or a signal
 * may have printed some rows first, and reading those as complete would drop the failure from the capture.
 *
 * @param error what `execFileSync` threw
 * @returns the live rows with the exited pids named, or why `ps` failed
 */
export function psStdoutOr({ error }: { error: unknown }): Result<string, string> {
  const exitedPidsOnly =
    error instanceof Error &&
    "status" in error &&
    error.status === 1 &&
    (!("signal" in error) || error.signal == null) &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    error.stdout.length > 0;
  if (exitedPidsOnly) {
    return ok(`${String(error.stdout)}(any pid not listed above had already exited)\n`);
  }
  return err(errorMessage({ error }));
}
