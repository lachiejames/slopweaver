import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { fseventsdSpec } from "../../../monitor/fseventsdBloated.js";
import { type FseventsdSeams, readFseventsdBloated } from "../../../monitor/fseventsdBloatedSource.js";
import {
  captureOnset,
  type OnsetCaptureSeams,
  productionOnsetSeams,
  psStdoutOr,
  publishExclusive,
} from "../../../monitor/fseventsdOnset/capture.js";
import { clientPidsOf, onsetCapturePath, renderOnsetCapture } from "../../../monitor/fseventsdOnset/onset.js";

/** fseventsd's compact-log client lines in the two shapes seen on this tree, pids synthetic. */
const LOG = [
  "2026-11-08 18:01:29.866 E  fseventsd[345:18954738] [com.apple.fsevents:daemon] fsevent_add_client: no bundle id available for pid 4101",
  "2026-11-08 18:01:29.868 E  fseventsd[345:18954738] [com.apple.fsevents:daemon] fsevent_add_client: no bundle id available for pid 4101",
  "2026-11-08 18:02:43.136 E  fseventsd[345:18954738] [com.apple.fsevents:daemon] SLOWDOWN: client cmux (pid 4202) sleeping due to too many errors",
  "2026-11-08 18:02:44.000 E  fseventsd[345:18954738] [com.apple.fsevents:daemon] event table has grown too large (filled 196608), pid 999 spid 7",
  "",
].join("\n");

/** A fake capture that records every call it is asked, and answers from what the test hands it. */
function recordingSeams({
  exists = false,
  log = ok(LOG),
  ps = ok("4101 Sun Nov  8 18:00:00 2026 /opt/synthetic/claude\n"),
  created = ok("created"),
}: {
  exists?: boolean;
  log?: Result<string, string>;
  ps?: Result<string, string>;
  created?: Result<"created" | "already-existed", string>;
}): { seams: OnsetCaptureSeams; calls: string[]; written: { path: string; contents: string }[] } {
  const calls: string[] = [];
  const written: { path: string; contents: string }[] = [];
  const seams: OnsetCaptureSeams = {
    createExclusive: ({ path, contents }) => {
      calls.push("create");
      written.push({ contents, path });
      return created;
    },
    exists: () => {
      calls.push("exists");
      return exists;
    },
    readLog: () => {
      calls.push("log");
      return log;
    },
    readPs: ({ pids }) => {
      calls.push(`ps ${pids.join(",")}`);
      return ps;
    },
  };
  return { calls, seams, written };
}

const HOME = "/opt/synthetic/home";
const NOW = "2026-11-08T07:30:00.000Z";
const BYTES = 32 * 1024 ** 3;

describe("clientPidsOf", () => {
  it("names each client once, first seen first, in both line shapes, and never fseventsd or a stray number", () => {
    expect(clientPidsOf({ daemonPid: 345, text: LOG })).toStrictEqual([4101, 4202]);
  });

  it("drops fseventsd's own pid when a line names it", () => {
    expect(clientPidsOf({ daemonPid: 4101, text: LOG })).toStrictEqual([4202]);
  });

  it("names nobody in a log with no client line", () => {
    expect(clientPidsOf({ daemonPid: 345, text: "fseventsd[345:1] started\n" })).toStrictEqual([]);
  });
});

describe("renderOnsetCapture", () => {
  it("heads the file with the balloon, the command, the clients, then ps, then the log", () => {
    const text = renderOnsetCapture({
      bytes: BYTES,
      clients: [4101, 4202],
      logText: "line one\n",
      nowIso: NOW,
      pid: 345,
      psText: "4101 x\n",
    });
    expect(text.split("\n").slice(0, 3)).toStrictEqual([
      `# fseventsd onset capture — pid 345 at 32.0 GB, read ${NOW}`,
      `# log: /usr/bin/log show --last 24h --predicate process == "fseventsd" AND NOT eventMessage CONTAINS "Resolve user group" --style compact`,
      "# client pids the log names (2, cap 64): 4101 4202",
    ]);
    expect(text.endsWith("## ps -o pid=,lstart=,comm= over those pids\n4101 x\n\n## log\nline one\n")).toBe(true);
  });
});

describe("captureOnset", () => {
  it("reads the log, runs ONE ps over every client, and creates the pid's file", () => {
    const { seams, calls, written } = recordingSeams({});
    const outcome = captureOnset({ bytes: BYTES, home: HOME, nowIso: NOW, pid: 345, seams });
    expect(unwrap(outcome)).toStrictEqual({
      clients: 2,
      kind: "captured",
      path: join(HOME, "live", "machine", "fseventsd-onset", "345.log"),
      psProblem: undefined,
    });
    expect(calls).toStrictEqual(["exists", "log", "ps 4101,4202", "create"]);
    expect(written[0]!.contents).toContain("4101 Sun Nov  8 18:00:00 2026 /opt/synthetic/claude");
  });

  it("runs nothing when this pid's capture is already on disk", () => {
    const { seams, calls } = recordingSeams({ exists: true });
    expect(unwrap(captureOnset({ bytes: BYTES, home: HOME, nowIso: NOW, pid: 345, seams })).kind).toBe("already");
    expect(calls).toStrictEqual(["exists"]);
  });

  it("writes nothing when the log cannot be read, so the next pass retries", () => {
    const { seams, calls } = recordingSeams({ log: err("timed out") });
    const outcome = captureOnset({ bytes: BYTES, home: HOME, nowIso: NOW, pid: 345, seams });
    expect(unwrapErr(outcome)).toBe("`/usr/bin/log show` for fseventsd failed: timed out");
    expect(calls).toStrictEqual(["exists", "log"]);
  });

  it("keeps the log when ps fails, naming the failure in the file and the outcome", () => {
    const { seams, written } = recordingSeams({ ps: err("ps: no such process") });
    const outcome = captureOnset({ bytes: BYTES, home: HOME, nowIso: NOW, pid: 345, seams });
    expect(unwrap(outcome)).toMatchObject({ kind: "captured", psProblem: "ps: no such process" });
    expect(written[0]!.contents).toContain("UNREADABLE: ps: no such process");
    expect(written[0]!.contents).toContain("SLOWDOWN: client cmux (pid 4202)");
  });

  it("answers already when another pass created the file first", () => {
    const { seams } = recordingSeams({ created: ok("already-existed") });
    expect(unwrap(captureOnset({ bytes: BYTES, home: HOME, nowIso: NOW, pid: 345, seams })).kind).toBe("already");
  });
});

describe("psStdoutOr", () => {
  const thrown = (fields: Record<string, unknown>): Error => Object.assign(new Error("ps failed"), fields);

  it("keeps the live rows when ps exited 1 because a listed pid had gone", () => {
    const error = thrown({ signal: null, status: 1, stdout: "4101 row\n" });
    expect(unwrap(psStdoutOr({ error }))).toBe("4101 row\n(any pid not listed above had already exited)\n");
  });

  // A ps killed by its timeout may print rows first, and those rows are not the whole answer.
  it("fails a ps killed by a signal even when it printed rows", () => {
    const error = thrown({ signal: "SIGTERM", status: null, stdout: "4101 row\n" });
    expect(unwrapErr(psStdoutOr({ error }))).toBe("ps failed");
  });

  it("fails a ps that exited 1 with nothing on stdout", () => {
    expect(unwrapErr(psStdoutOr({ error: thrown({ signal: null, status: 1, stdout: "" }) }))).toBe("ps failed");
  });
});

describe("the production exclusive create, on a real temp dir", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("creates the directory and the file once, and leaves the first one standing", () => {
    home = mkdtempSync(join(tmpdir(), "onset-"));
    const path = onsetCapturePath({ home, pid: 345 });
    const { createExclusive } = productionOnsetSeams();
    expect(unwrap(createExclusive({ contents: "first\n", path }))).toBe("created");
    expect(unwrap(createExclusive({ contents: "second\n", path }))).toBe("already-existed");
    expect(readFileSync(path, "utf8")).toBe("first\n");
    expect(readdirSync(dirname(path))).toStrictEqual(["345.log"]);
  });

  it("leaves no capture behind when staging fails, so the next pass retries and publishes whole", () => {
    home = mkdtempSync(join(tmpdir(), "onset-"));
    const path = onsetCapturePath({ home, pid: 345 });
    const failed = publishExclusive({ contents: "partial\n", path, stagedPath: join(home, "absent", "staged") });
    expect(unwrapErr(failed)).toContain("ENOENT");
    expect(existsSync(path)).toBe(false);
    const stagedPath = `${path}.retry.staged`;
    expect(unwrap(publishExclusive({ contents: "whole\n", path, stagedPath }))).toBe("created");
    expect(readFileSync(path, "utf8")).toBe("whole\n");
    expect(existsSync(stagedPath)).toBe(false);
  });
});

describe("readFseventsdBloated takes the capture", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const processes = ({ mem, onset }: { mem: string; onset: OnsetCaptureSeams }): FseventsdSeams => ({
    comms: () => [{ comm: fseventsdSpec().comm, pid: 345 }],
    onset,
    watchedTopReport: () => `PID    MEM  \n345    ${mem}\n`,
  });

  it("over the restart line, and fires as before", () => {
    home = mkdtempSync(join(tmpdir(), "onset-"));
    const { seams, calls } = recordingSeams({});
    const reading = readFseventsdBloated({ home, nowMs: 0, processes: processes({ mem: "3G", onset: seams }) });
    expect(reading.state).toBe("firing");
    expect(calls).toStrictEqual(["exists", "log", "ps 4101,4202", "create"]);
  });

  it("never at or under the line", () => {
    home = mkdtempSync(join(tmpdir(), "onset-"));
    const { seams, calls } = recordingSeams({});
    const reading = readFseventsdBloated({ home, nowMs: 0, processes: processes({ mem: "2048M", onset: seams }) });
    expect(reading.state).toBe("clear");
    expect(calls).toStrictEqual([]);
  });
});
