/**
 * `slopweaver reflect telemetry`'s shell, exercised only on the branches that reach neither Datadog nor a
 * clock: help, flag rejection, and the credentials-absent prerequisite. The reading itself is tested
 * against injected seams in `unit/reflect/telemetry.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TELEMETRY_DEFAULT_FROM } from "../../../../../cli/commands/reflect/core.js";
import { runReflectTelemetry } from "../../../../../cli/commands/reflect/telemetryRun.js";
import { REFLECT_TELEMETRY_USAGE } from "../../../../../cli/commands/reflect/usage.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { reflectManifest } from "../../../../../cli/manifests/reflect.js";

const CREDENTIAL_VARS = ["DD_API_KEY", "DD_APP_KEY", "DD_SITE"] as const;

describe("runReflectTelemetry", () => {
  it("--help prints usage and exits EXIT_OK without touching credentials", async () => {
    const code = await runReflectTelemetry(["node", "slopweaver", "reflect", "telemetry", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("rejects an unknown flag with EXIT_USAGE before anything is read", async () => {
    const code = await runReflectTelemetry(["node", "slopweaver", "reflect", "telemetry", "--since", "24h"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("rejects a --limit that is not a positive integer", async () => {
    const code = await runReflectTelemetry(["node", "slopweaver", "reflect", "telemetry", "--limit", "0"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("publishes one copy of its usage, shared with the manifest rather than duplicated", () => {
    expect(reflectManifest["telemetry"]?.meta.usage).toBe(REFLECT_TELEMETRY_USAGE);
    expect(REFLECT_TELEMETRY_USAGE).toContain(`[--from ${TELEMETRY_DEFAULT_FROM}]`);
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

    it("exits EXIT_EXPECTED_EMPTY rather than reporting an empty window", async () => {
      const code = await runReflectTelemetry(["node", "slopweaver", "reflect", "telemetry", "--json"]);
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
    });
  });
});
