/*
 * Which evidence target a capture photographs: the one `--target` named, else the one the address implies, else
 * none when no adapter covers the address.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_READINESS_TIMEOUT_MS } from "../../../../../../browser/evidenceCaptureSnippet.js";
import { evidenceShotTarget } from "../../../../../../cli/commands/browser/shotCore.js";

describe("evidenceShotTarget", () => {
  const mode = { caption: null, kind: "evidence", readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS } as const;

  it("takes the target --target named over the one the address implies", () => {
    const named = { adapterId: "datadog-apm-traces-v1", targetId: "timeseries" } as const;
    expect(
      evidenceShotTarget({ mode: { ...mode, target: named }, url: "https://app.datadoghq.com/logs?viz=timeseries" }),
    ).toEqual(named);
  });

  it("infers the target from the address when none was named", () => {
    expect(
      evidenceShotTarget({ mode: { ...mode, target: null }, url: "https://app.datadoghq.com/logs?viz=timeseries" }),
    ).toEqual({ adapterId: "datadog-logs-v1", targetId: "timeseries" });
  });

  it("answers null when none was named and no adapter covers the address", () => {
    expect(evidenceShotTarget({ mode: { ...mode, target: null }, url: "https://example.com/" })).toBe(null);
  });
});
