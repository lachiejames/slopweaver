import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exitCodeForCompareEnvsRowCount,
  runDatadogCompareEnvs,
} from "../../../../../cli/commands/datadog/compareEnvsRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

/** The argv shape the router hands this verb, so a case only spells its own flags. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "datadog", "compare-envs", ...rest];
}

const QUERY = "p90:trace.http.server.request{*} by {resource_name}";
const SIDES = ["--before", "proof-before", "--after", "proof-after"];

describe("exitCodeForCompareEnvsRowCount", () => {
  it("returns EXIT_OK for at least one group", () => {
    expect(exitCodeForCompareEnvsRowCount({ rowCount: 1 })).toBe(EXIT_OK);
  });

  it("returns EXIT_EXPECTED_EMPTY when neither side reported a group", () => {
    expect(exitCodeForCompareEnvsRowCount({ rowCount: 0 })).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("runDatadogCompareEnvs", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    expect(await runDatadogCompareEnvs(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("requires --query, exiting EXIT_USAGE before touching credentials", async () => {
    expect(await runDatadogCompareEnvs(argv({ rest: SIDES }))).toBe(EXIT_USAGE);
  });

  it("requires both sides, exiting EXIT_USAGE", async () => {
    expect(await runDatadogCompareEnvs(argv({ rest: ["--query", QUERY] }))).toBe(EXIT_USAGE);
  });

  it("refuses a query that scopes env itself with EXIT_USAGE, before any network call", async () => {
    const code = await runDatadogCompareEnvs(
      argv({ rest: ["--query", "p90:trace.http.server.request{env:production}", ...SIDES] }),
    );
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable window with EXIT_USAGE", async () => {
    const code = await runDatadogCompareEnvs(argv({ rest: ["--query", QUERY, ...SIDES, "--from", "yesterday"] }));
    expect(code).toBe(EXIT_USAGE);
  });

  describe("with credentials genuinely absent", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const name of CREDENTIAL_VARS) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
    });
    afterEach(() => {
      for (const name of CREDENTIAL_VARS) {
        const value = saved[name];
        if (value !== undefined) {
          process.env[name] = value;
        }
      }
    });

    it("exits EXIT_EXPECTED_EMPTY rather than reaching Datadog", async () => {
      const code = await runDatadogCompareEnvs(argv({ rest: ["--query", QUERY, ...SIDES, "--json"] }));
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
