/**
 * `slopweaver wait` driven whole over plain fakes — a scripted pid/file reader and a clock that only moves when
 * the verb sleeps. No process, no file, no timer.
 */
import { describe, expect, it } from "vitest";

import { runWaitWithDeps, type WaitDeps } from "../../../../../cli/commands/wait/run.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { FileReading, PidReading } from "../../../../../wait/probes.js";

/** Deps whose reads return each scripted reading in turn, then repeat the last. */
function fakeDeps({
  pids = [{ kind: "alive" }],
  files = [{ kind: "absent" }],
}: {
  pids?: readonly PidReading[];
  files?: readonly FileReading[];
}): { deps: WaitDeps; out: string[]; errors: string[] } {
  let now = 0;
  let pidIndex = 0;
  let fileIndex = 0;
  const out: string[] = [];
  const errors: string[] = [];
  return {
    deps: {
      clock: {
        nowMs: () => now,
        sleep: ({ ms }) => {
          now += ms;
          return Promise.resolve();
        },
      },
      error: (line) => errors.push(line),
      out: (line) => out.push(line),
      readFile: () => files[Math.min(fileIndex++, files.length - 1)]!,
      readPid: () => pids[Math.min(pidIndex++, pids.length - 1)]!,
    },
    errors,
    out,
  };
}

describe("slopweaver wait --pid", () => {
  it("prints the running state once and ends on WAIT-DONE when the process exits", async () => {
    const { deps, out } = fakeDeps({ pids: [{ kind: "alive" }, { kind: "alive" }, { kind: "exited" }] });
    expect(await runWaitWithDeps({ deps, rest: ["--pid", "42"] })).toBe(EXIT_OK);
    expect(out).toEqual([
      "WAIT pid 42 timeout=540s",
      "pid 42 still running",
      "WAIT-DONE pid 42 exited (read 3 time(s))",
    ]);
  });

  it("exits EXIT_DEFERRED with WAIT-TIMEOUT when the process outlives the timeout", async () => {
    const { deps, out } = fakeDeps({});
    expect(await runWaitWithDeps({ deps, rest: ["--pid", "42", "--timeout-seconds", "2"] })).toBe(EXIT_DEFERRED);
    expect(out).toEqual([
      "WAIT pid 42 timeout=2s",
      "pid 42 still running",
      "WAIT-TIMEOUT pid 42 still running after 2s",
    ]);
  });
});

describe("slopweaver wait --file", () => {
  it("names each state change and ends when the marker lands", async () => {
    const { deps, out } = fakeDeps({
      files: [{ kind: "absent" }, { kind: "present", matched: false }, { kind: "present", matched: true }],
    });
    expect(await runWaitWithDeps({ deps, rest: ["--file", "/tmp/x.log", "--contains", "DONE"] })).toBe(EXIT_OK);
    expect(out).toEqual([
      'WAIT file /tmp/x.log for "DONE" timeout=540s',
      'file /tmp/x.log for "DONE": not there yet',
      'file /tmp/x.log for "DONE": there, without the text yet',
      'WAIT-DONE file /tmp/x.log for "DONE" (read 3 time(s))',
    ]);
  });

  it("exits EXIT_ERROR naming why when the file exists but cannot be read", async () => {
    const { deps, errors } = fakeDeps({ files: [{ kind: "unreadable", reason: "EACCES: permission denied" }] });
    expect(await runWaitWithDeps({ deps, rest: ["--file", "/tmp/x.log", "--contains", "DONE"] })).toBe(EXIT_ERROR);
    expect(errors).toEqual(["wait: /tmp/x.log exists but could not be read: EACCES: permission denied"]);
  });
});

describe("slopweaver wait — usage", () => {
  it("refuses both targets at once", async () => {
    const { deps, errors } = fakeDeps({});
    expect(await runWaitWithDeps({ deps, rest: ["--pid", "1", "--file", "/tmp/x"] })).toBe(EXIT_USAGE);
    expect(errors[0]).toBe("pass one of --pid or --file, not both");
  });

  it("refuses --contains on a pid", async () => {
    const { deps, errors } = fakeDeps({});
    expect(await runWaitWithDeps({ deps, rest: ["--pid", "1", "--contains", "x"] })).toBe(EXIT_USAGE);
    expect(errors[0]).toBe("--contains only means something with --file");
  });

  it("refuses no target at all", async () => {
    const { deps, errors } = fakeDeps({});
    expect(await runWaitWithDeps({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(errors[0]).toBe("pass --pid <n> or --file <path> to say what to wait on");
  });
});
