/*
 * `codex gauge`'s rendering — why there is no reading, the observation's age, and a passed reset never shown as
 * a current cap.
 */
import { describe, expect, it } from "vitest";
import { parseGaugeLine } from "../../../../codex/gauge.js";
import { REAL_HEALTHY_WEEKLY_LINE, REAL_USAGE_LIMIT_REACHED_LINE } from "../../../codexRolloutLines.js";
import { renderCodexGauge } from "../defaultThresholds.js";
import { OPEN_WEEKLY_EXHAUSTED_LINE } from "./harness.js";

describe("renderCodexGauge", () => {
  it("says WHY there is no reading rather than implying the account is healthy", () => {
    const lines = renderCodexGauge({ gauge: undefined, nowIso: "2026-09-13T12:00:00.000Z" });

    expect(lines[0]).toBe("codex gauge: no rate-limit reading found.");
    expect(lines.join(" ")).toContain("not that the account is healthy");
  });

  it("prints the observation instant and its age, never the read instant alone", () => {
    const lines = renderCodexGauge({
      gauge: parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE }),
      nowIso: "2026-09-13T12:00:00.000Z",
    });

    expect(lines[0]).toBe(
      "codex gauge: observed 2026-09-13T05:51:14.803Z (6h old), limit codex, plan self_serve_business_prolite",
    );
  });

  it("says both windows are absent on an exhaustion event rather than printing 0%", () => {
    const lines = renderCodexGauge({
      gauge: parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE }),
      nowIso: "2026-09-13T12:00:00.000Z",
    });

    expect(lines).toContain("  no window was reported — an exhaustion event nulls both slots");
  });

  it("still calls an open 100% window unspendable before its reset", () => {
    const lines = renderCodexGauge({
      gauge: parseGaugeLine({ line: OPEN_WEEKLY_EXHAUSTED_LINE }),
      nowIso: "2026-09-27T09:06:39.000Z",
    });

    expect(lines.filter((line) => line.startsWith("  spendable: NO"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("has passed"))).toEqual([]);
  });

  it("drops a reached type beside a window whose reset has passed, rather than printing a current refusal", () => {
    const line = OPEN_WEEKLY_EXHAUSTED_LINE.replace(
      '"rate_limit_reached_type":null',
      '"rate_limit_reached_type":"workspace_member_usage_limit_reached"',
    );
    const before = renderCodexGauge({ gauge: parseGaugeLine({ line }), nowIso: "2026-09-27T09:06:39.000Z" });
    const after = renderCodexGauge({ gauge: parseGaugeLine({ line }), nowIso: "2026-09-27T09:06:40.000Z" });

    expect(before.filter((entry) => entry.startsWith("  reached: workspace_member_usage_limit_reached"))).toHaveLength(
      1,
    );
    expect(after.filter((entry) => entry.startsWith("  reached:"))).toEqual([]);
    expect(after).toContain("  spendable: yes");
  });

  it("names the kind a captured reached type classifies to, and calls a wording never captured unclassified", () => {
    const reachedAs = ({ wording }: { wording: string }): readonly string[] =>
      renderCodexGauge({
        gauge: parseGaugeLine({
          line: OPEN_WEEKLY_EXHAUSTED_LINE.replace(
            '"rate_limit_reached_type":null',
            `"rate_limit_reached_type":"${wording}"`,
          ),
        }),
        nowIso: "2026-09-27T09:06:39.000Z",
      }).filter((entry) => entry.startsWith("  reached:"));

    expect(reachedAs({ wording: "workspace_member_usage_limit_reached" })).toEqual([
      "  reached: workspace_member_usage_limit_reached (usage-limit)",
    ]);
    expect(reachedAs({ wording: "a_wording_never_captured" })).toEqual([
      "  reached: a_wording_never_captured (unclassified)",
    ]);
  });

  it("never renders a 100% window whose reset has passed as a current cap", () => {
    const lines = renderCodexGauge({
      gauge: parseGaugeLine({ line: OPEN_WEEKLY_EXHAUSTED_LINE }),
      nowIso: "2026-09-27T09:06:40.000Z",
    });

    expect(lines).toContain("  spendable: yes");
    expect(lines.filter((line) => line.includes("reset 2026-09-27T09:06:40.000Z has passed"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("  REACT NOW"))).toEqual([]);
  });
});
