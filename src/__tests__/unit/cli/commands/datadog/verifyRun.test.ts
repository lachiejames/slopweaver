import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDatadogVerify } from "../../../../../cli/commands/datadog/verifyRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

describe("runDatadogVerify", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runDatadogVerify(["node", "slopweaver", "datadog", "verify", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("refuses an unknown flag with EXIT_USAGE", async () => {
    const code = await runDatadogVerify(["node", "slopweaver", "datadog", "verify", "--bogus"]);
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
      const code = await runDatadogVerify(["node", "slopweaver", "datadog", "verify", "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
