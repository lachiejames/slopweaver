import { describe, expect, it } from "vitest";

import {
  type RegisterRecorders,
  recordFirstRead,
  watchOutcome,
} from "../../../../../cli/commands/github/checksRegister.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { GithubChecksSnapshot } from "../../../../../live/github/checks.js";

/** One register row as the recorder seams saw it: the fields a fold reads, without the clock or the session. */
type RowWitness =
  | { kind: "read"; repo: string; number: number; headSha: string; rollup: string }
  | { kind: "watching"; repo: string; number: number; headSha: string; mode: string; timeoutSeconds: number };

const TARGET = { home: undefined, number: 42, owner: "acme", repo: "widget", timeoutSeconds: 900 };

function snapshot({ headSha, rollupState }: { headSha: string; rollupState: string }): GithubChecksSnapshot {
  return {
    baseRef: "main",
    checks: [],
    headSha,
    mergeable: undefined,
    residue: [],
    rollupState,
    supersededChecks: [],
    truncated: false,
  };
}

/** Recording seams: every row the recorder wrote, in order. */
function recorders({ rows }: { rows: RowWitness[] }): Pick<RegisterRecorders, "recordChecksRead" | "recordWatching"> {
  return {
    recordChecksRead: ({ repo, number, headSha, rollup }) => rows.push({ headSha, kind: "read", number, repo, rollup }),
    recordWatching: ({ repo, number, headSha, mode, timeoutSeconds }) =>
      rows.push({ headSha, kind: "watching", mode, number, repo, timeoutSeconds }),
  };
}

describe("recordFirstRead", () => {
  it("records the first snapshot once, and a watch run's watching row names that same head", () => {
    const rows: RowWitness[] = [];
    const recorder = recordFirstRead({ deps: recorders({ rows }), mode: "wait", target: TARGET });
    recorder.recordRead({ snapshot: snapshot({ headSha: "aaa111", rollupState: "PENDING" }) });
    recorder.recordRead({ snapshot: snapshot({ headSha: "bbb222", rollupState: "SUCCESS" }) });
    expect(rows).toEqual([
      { headSha: "aaa111", kind: "read", number: 42, repo: "acme/widget", rollup: "PENDING" },
      { headSha: "aaa111", kind: "watching", mode: "wait", number: 42, repo: "acme/widget", timeoutSeconds: 900 },
    ]);
    expect(recorder.watchedHead()).toBe("aaa111");
  });

  it("writes no watching row for a one-shot read, and hands back no watched head", () => {
    const rows: RowWitness[] = [];
    const recorder = recordFirstRead({ deps: recorders({ rows }), mode: undefined, target: TARGET });
    recorder.recordRead({ snapshot: snapshot({ headSha: "aaa111", rollupState: "FAILURE" }) });
    expect(rows).toEqual([{ headSha: "aaa111", kind: "read", number: 42, repo: "acme/widget", rollup: "FAILURE" }]);
    expect(recorder.watchedHead()).toBeUndefined();
  });

  it("hands back no watched head before anything was read", () => {
    const recorder = recordFirstRead({ deps: recorders({ rows: [] }), mode: "merge", target: TARGET });
    expect(recorder.watchedHead()).toBeUndefined();
  });
});

describe("watchOutcome", () => {
  it("maps the loop's exit code onto the closed vocabulary the watchers fold reads", () => {
    expect(watchOutcome({ exit: EXIT_OK })).toBe("done");
    expect(watchOutcome({ exit: EXIT_EXPECTED_EMPTY })).toBe("stopped");
    expect(watchOutcome({ exit: EXIT_ERROR })).toBe(`failed (exit ${String(EXIT_ERROR)})`);
  });
});
