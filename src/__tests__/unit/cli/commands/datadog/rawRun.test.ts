import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDatadogRaw } from "../../../../../cli/commands/datadog/rawRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

describe("runDatadogRaw", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runDatadogRaw(["node", "slopweaver", "datadog", "raw", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("requires --path, exiting EXIT_USAGE before touching credentials", async () => {
    const code = await runDatadogRaw(["node", "slopweaver", "datadog", "raw"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("rejects an unsupported --method with EXIT_USAGE", async () => {
    const code = await runDatadogRaw(["node", "slopweaver", "datadog", "raw", "--path", "/p", "--method", "DELETE"]);
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

    it("exits EXIT_EXPECTED_EMPTY", async () => {
      const code = await runDatadogRaw([
        "node",
        "slopweaver",
        "datadog",
        "raw",
        "--path",
        "/api/v1/logs-analytics/list",
        "--json",
      ]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
