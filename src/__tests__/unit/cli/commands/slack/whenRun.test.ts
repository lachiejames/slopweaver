/**
 * `slack when`'s shell — the routing between the two write channels and the exit codes.
 *
 * The verb takes no token, no network and no home, so the only injected edges are the writers. That is the
 * point of the verb: there is never an environmental reason it cannot be run.
 */
import { describe, expect, it } from "vitest";

import { runSlackWhen, type SlackWhenDeps } from "../../../../../cli/commands/slack/whenRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** A recording pair of write edges, so stdout and stderr stay separable in the assertions. */
function recorder(): { deps: SlackWhenDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runSlackWhen", () => {
  it("writes the derived instant to stdout and nothing to stderr", () => {
    const { deps, out, diagnostics } = recorder();
    expect(runSlackWhen({ deps, rest: ["1788220579.306599"] })).toBe(EXIT_OK);
    expect(out).toEqual(["1788220579.306599\t2026-08-31T23:56:19.000Z"]);
    expect(diagnostics).toEqual([]);
  });

  it("emits exactly ONE document in --json mode, so `| jq` works", () => {
    const { deps, out } = recorder();
    expect(runSlackWhen({ deps, rest: ["--json", "1788220579.306599"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      conversions: [{ input: "1788220579.306599", iso: "2026-08-31T23:56:19.000Z", ts: "1788220579.306599" }],
      kind: "slopweaver.slack.when",
      schemaVersion: 1,
    });
  });

  it("prints usage on --help without converting anything", () => {
    const { deps, out } = recorder();
    expect(runSlackWhen({ deps, rest: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver slack when");
  });

  it("refuses an empty invocation with the usage, on stderr", () => {
    const { deps, out, diagnostics } = recorder();
    expect(runSlackWhen({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(diagnostics[0]).toBe("slack when: name at least one Slack ts or permalink");
  });

  it("refuses an input that is not a timestamp, naming it", () => {
    const { deps, out, diagnostics } = recorder();
    expect(runSlackWhen({ deps, rest: ["sometime tuesday"] })).toBe(EXIT_USAGE);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual(["slack when: sometime tuesday: not a Slack ts and carries no permalink timestamp"]);
  });
});
