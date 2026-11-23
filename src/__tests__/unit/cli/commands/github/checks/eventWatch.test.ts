/* The `--until` event loop and the required-context reader, driven directly rather than through argv. */
import { describe, expect, it } from "vitest";

import { makeRequiredGateReader, pollEvents } from "../../../../../../cli/commands/github/checksEventWatch.js";
import type { PollTarget } from "../../../../../../cli/commands/github/checksSeams.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { depsFor, PASSED_CHECK, RUNNING_CHECK, snapshot } from "./harness.js";

const SINCE = "2026-09-03T00:00:00Z";

/** A watched pull request on the harness's repository, its deadline the caller's. */
function targetFor({ deadlineMs }: { deadlineMs: number }): PollTarget {
  return { deadlineMs, home: undefined, limit: 100, number: 9, owner: "acme", repo: "widget", timeoutSeconds: 60 };
}

describe("pollEvents", () => {
  it("stays silent on the baseline poll, then ends a --until ci watch on the green verdict", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const heads: string[] = [];
    const deps = depsFor({
      diagnostic,
      fetches: [snapshot({ checks: [RUNNING_CHECK] }), snapshot({ checks: [PASSED_CHECK] })],
      out,
    });

    const code = await pollEvents({
      deps,
      recordRead: ({ snapshot: read }) => heads.push(read.headSha),
      since: SINCE,
      target: targetFor({ deadlineMs: 3_600_000 }),
      until: "ci",
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      `WATCH pr=9 repo=acme/widget until=ci since=${SINCE}`,
      "CI PASS 1/1 on abc123, main requires no status-check contexts",
      "WATCH-DONE ci-green",
    ]);
    expect(heads).toEqual(["abc123", "abc123"]);
    expect(diagnostic).toEqual([]);
  });

  it("times out a --until merge watch whose deadline is already here", async () => {
    const out: string[] = [];
    const heads: string[] = [];
    const deps = depsFor({ diagnostic: [], fetches: [snapshot({ checks: [RUNNING_CHECK] })], out });

    const code = await pollEvents({
      deps,
      recordRead: ({ snapshot: read }) => heads.push(read.headSha),
      since: SINCE,
      target: targetFor({ deadlineMs: 0 }),
      until: "merge",
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(out).toEqual([`WATCH pr=9 repo=acme/widget until=merge since=${SINCE}`, "WATCH-TIMEOUT pr=9 after 60s"]);
    expect(heads).toEqual(["abc123"]);
  });
});

describe("makeRequiredGateReader", () => {
  it("answers unreadable, naming the pull request, when GitHub reports no base branch", async () => {
    const deps = depsFor({ diagnostic: [], fetches: [snapshot()], out: [] });
    const readGate = makeRequiredGateReader({ deps, target: targetFor({ deadlineMs: 0 }) });

    const gate = await readGate({ snapshot: { ...snapshot(), baseRef: undefined } });

    expect(gate).toEqual({ kind: "unreadable", reason: "GitHub reported no base branch for #9" });
  });
});
