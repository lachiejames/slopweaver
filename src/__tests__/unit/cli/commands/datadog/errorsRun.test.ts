import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { datadogErrorsCommand, runDatadogErrors } from "../../../../../cli/commands/datadog/errorsRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { datadogManifest } from "../../../../../cli/manifests/datadog.js";
import { datadogErrorTrackingManifest } from "../../../../../cli/manifests/datadogErrorTracking.js";
import { prodEnvFilter } from "../../../../../datadog/prodEnvFilter.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

describe("the datadog errors manifest entry", () => {
  it("is spread into the datadog noun as an undoored external read", () => {
    const entry = datadogErrorTrackingManifest["errors"]!;
    expect(datadogManifest["errors"]).toBe(entry);
    expect(entry.meta.effect).toBe("external-read");
    expect(entry.meta.doorRouted).toBe(false);
  });

  it("loads the command the runner module exports", async () => {
    expect(await datadogErrorTrackingManifest["errors"]!.load()).toBe(datadogErrorsCommand);
  });

  it("teaches both production spellings in the example a session copies, the filter prodEnvFilter renders", () => {
    expect(datadogErrorTrackingManifest["errors"]!.meta.example).toBe(
      `slopweaver datadog errors --query '${prodEnvFilter()}' --from 1d --state for-review --order count`,
    );
  });
});

describe("runDatadogErrors", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runDatadogErrors(["node", "slopweaver", "datadog", "errors", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("refuses an --order outside newest and count with EXIT_USAGE", async () => {
    const code = await runDatadogErrors(["node", "slopweaver", "datadog", "errors", "--order", "oldest"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a --state outside the five Error Tracking states with EXIT_USAGE", async () => {
    const code = await runDatadogErrors(["node", "slopweaver", "datadog", "errors", "--state", "closed"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an unparseable window with EXIT_USAGE", async () => {
    const code = await runDatadogErrors(["node", "slopweaver", "datadog", "errors", "--from", "yesterday"]);
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
      const code = await runDatadogErrors(["node", "slopweaver", "datadog", "errors", "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
