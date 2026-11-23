/**
 * `slack probe`'s shell over plain fakes: each of the three refusals it can raise before a call keeps its own
 * exit code and prints its own lines, a transport failure names the method, and a Slack body is reported.
 */
import { describe, expect, it } from "vitest";

import { runSlackProbe, type SlackProbeDeps } from "../../../../../cli/commands/slack/probeRun.js";
import { SlackReadErrors } from "../../../../../cli/commands/slack/readErrors.js";
import { SLACK_PROBE_USAGE } from "../../../../../cli/commands/slack/verbUsage.js";
import { err, ok } from "../../../../../lib/result.js";

/** A fake edge bag recording what the shell printed, with the call and the token swappable per test. */
function fakeDeps({
  tokenless = false,
  call = async () => ok({ ok: true, user: "U1" }),
}: {
  tokenless?: boolean;
  call?: SlackProbeDeps["call"];
} = {}): { deps: SlackProbeDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: SlackProbeDeps = {
    call,
    nowMs: () => 1_000,
    token: () => (tokenless ? undefined : "xoxp-fake"),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, out };
}

describe("runSlackProbe", () => {
  it("refuses a missing --method as usage, printing the refusal then the usage", async () => {
    const { deps, diagnostics, out } = fakeDeps();

    expect(await runSlackProbe({ deps, rest: [] })).toBe(2);
    expect(diagnostics).toEqual(["--method is required: the dotted Web API method to call", SLACK_PROBE_USAGE]);
    expect(out).toEqual([]);
  });

  it("refuses a malformed --expect as usage, quoting what it was given", async () => {
    const { deps, diagnostics } = fakeDeps();

    expect(await runSlackProbe({ deps, rest: ["--method", "auth.test", "--expect", "nope"] })).toBe(2);
    expect(diagnostics).toEqual([
      '--expect needs <path>=<value>, e.g. --expect permalink=https://…; got "nope"',
      SLACK_PROBE_USAGE,
    ]);
  });

  it("refuses a missing user token as an error, naming how to set it", async () => {
    const { deps, diagnostics } = fakeDeps({ tokenless: true });

    expect(await runSlackProbe({ deps, rest: ["--method", "auth.test"] })).toBe(1);
    expect(diagnostics).toEqual([
      "no user token — set SLACK_USER_TOKEN or run `slopweaver secrets set slack-user-token`",
    ]);
  });

  it("names the method a transport failure could not call", async () => {
    const { deps, diagnostics, out } = fakeDeps({
      call: async () => err(SlackReadErrors.probeCallFailed({ method: "auth.test", reason: "socket hang up" })),
    });

    expect(await runSlackProbe({ deps, rest: ["--method", "auth.test"] })).toBe(1);
    expect(diagnostics).toEqual(["auth.test: socket hang up"]);
    expect(out).toEqual([]);
  });

  it("reports a successful body as JSON and exits clean", async () => {
    const { deps, diagnostics, out } = fakeDeps();

    expect(await runSlackProbe({ deps, rest: ["--method", "auth.test", "--json"] })).toBe(0);
    expect(diagnostics).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toEqual({
      elapsedMs: 0,
      fields: ["ok", "user"],
      hasMore: false,
      hasNextCursor: false,
      method: "auth.test",
      nested: {},
      ok: true,
    });
  });
});
