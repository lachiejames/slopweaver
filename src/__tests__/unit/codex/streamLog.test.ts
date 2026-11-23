/**
 * `openStreamLog`: the per-pass heartbeat file under the injected home — its announced path, its exact bytes,
 * and the best-effort contract that an unopenable log neither throws nor announces a path that does not exist.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initialCodexActivity } from "../../../codex/progress.js";
import { openStreamLog, type StreamLogDeps } from "../../../codex/streamLog.js";
import type { Logger } from "../../../lib/logger.js";

/**
 * Seams over a fixed home that record every announcement and every home resolution.
 *
 * @returns the seams and what they recorded
 */
function recordingDeps({ home }: { home: string }): {
  readonly deps: StreamLogDeps;
  readonly announced: string[];
  readonly homeReads: string[];
} {
  const announced: string[] = [];
  const homeReads: string[] = [];
  const diagnostic: Logger["error"] = ({ msg }) => {
    announced.push(msg);
  };
  return {
    announced,
    deps: {
      diagnostic,
      home: () => {
        homeReads.push(home);
        return home;
      },
    },
    homeReads,
  };
}

describe("openStreamLog", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "stream-log-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("creates the log under the injected home's orchestration directory and announces that exact path", () => {
    const seams = recordingDeps({ home });
    const expectedPath = join(home, "orchestration", `stream-p2-${String(process.pid)}.log`);

    openStreamLog({ deps: seams.deps, pass: "p2" });

    expect(seams.homeReads).toEqual([home]);
    expect(seams.announced).toEqual([`codex p2: streaming to ${expectedPath}`]);
    expect(readFileSync(expectedPath, "utf8")).toBe("# codex p2 — live heartbeat, appended per event\n");
  });

  it("appends one line per event: rounded seconds, both counters, and the placeholder before any command", () => {
    const seams = recordingDeps({ home });
    const append = openStreamLog({ deps: seams.deps, pass: "r1" });

    append({ activity: { ...initialCodexActivity(), commands: 0, failedCommands: 0 }, elapsedMs: 1499 });
    append({
      activity: { ...initialCodexActivity(), commands: 3, failedCommands: 1, lastCommand: "yarn vitest run" },
      elapsedMs: 2500,
    });

    expect(readFileSync(join(home, "orchestration", `stream-r1-${String(process.pid)}.log`), "utf8")).toBe(
      [
        "# codex r1 — live heartbeat, appended per event",
        "1s  0 cmd  0 failed  (no command yet)",
        "3s  3 cmd  1 failed  yarn vitest run",
        "",
      ].join("\n"),
    );
  });

  it("returns an appender that does nothing, and announces nothing, when the orchestration directory cannot be created", () => {
    writeFileSync(join(home, "orchestration"), "a file where the directory should be\n");
    const seams = recordingDeps({ home });

    const append = openStreamLog({ deps: seams.deps, pass: "p1" });
    append({ activity: initialCodexActivity(), elapsedMs: 1000 });

    expect(seams.announced).toEqual([]);
    expect(readFileSync(join(home, "orchestration"), "utf8")).toBe("a file where the directory should be\n");
    expect(existsSync(join(home, "orchestration", `stream-p1-${String(process.pid)}.log`))).toBe(false);
  });
});
