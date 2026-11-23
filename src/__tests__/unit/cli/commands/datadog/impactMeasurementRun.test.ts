/** The impact reads' shell: no target is no read, and no warning. */
import { describe, expect, it } from "vitest";

import { measureImpactTargets } from "../../../../../cli/commands/datadog/impactMeasurementRun.js";
import type { DatadogConfig } from "../../../../../datadog/config.js";

const CONFIG: DatadogConfig = {
  apiHost: "api.us3.datadoghq.com",
  apiKey: "0123456789abcdef0123456789abcdef",
  appKey: "A".repeat(40),
  consoleHost: "us3.datadoghq.com",
  site: "us3.datadoghq.com",
};

describe("measureImpactTargets", () => {
  it("measures nothing and warns nothing when there are no targets", async () => {
    const measured = await measureImpactTargets({ config: CONFIG, targets: [], window: { fromMs: 0, toMs: 1 } });
    expect([...measured.impacts]).toEqual([]);
    expect(measured.warnings).toEqual([]);
  });
});
