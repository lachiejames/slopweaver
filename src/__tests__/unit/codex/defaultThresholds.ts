/*
 * Test-only: the Codex gauge's render and verb with the register's DEFAULT thresholds supplied, so a case that is not
 * about a threshold reads as it did before the bars moved into the plan register. A case about a threshold calls the
 * real function with its own `thresholds`, or seeds the register (`gaugeRunThresholds.test.ts`).
 */
import { runCodexGaugeWith } from "../../../cli/commands/codex/gaugeRun.js";
import { renderCodexGauge as realRenderCodexGauge } from "../../../codex/gaugeRender.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

/* Re-exported beside its wrapped sibling, so a gauge case imports both from one place. */
export { readingAgeHours } from "../../../codex/gaugeRender.js";

/**
 * {@link realRenderCodexGauge} at the default Codex thresholds.
 *
 * @returns the human lines
 */
export function renderCodexGauge(
  options: Omit<Parameters<typeof realRenderCodexGauge>[0], "thresholds">,
): ReturnType<typeof realRenderCodexGauge> {
  return realRenderCodexGauge({ ...options, thresholds: DEFAULT_THRESHOLDS.codex });
}

/**
 * `slopweaver codex gauge <tail>` over an empty in-memory register, so its bars are the defaults.
 *
 * @param home the state home the register is read for, a throwaway directory the caller removes
 * @param tail the arguments after `codex gauge`
 * @returns the verb's exit code
 */
export async function runGauge({ home, tail }: { home: string; tail: readonly string[] }): Promise<number> {
  return runCodexGaugeWith({
    argv: ["node", "slopweaver", "codex", "gauge", ...tail],
    deps: { home, port: memoryPlanRegisterPort() },
  });
}
