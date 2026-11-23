import { describe, expect, it } from "vitest";

import {
  explorerShotFilename,
  formatReadingLine,
  monitorShotFilename,
  parseBacktestPanel,
} from "../../../../datadog/shot/reading.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** The panel's own wording, as the console renders it. */
const REAL_PANEL =
  "Monitor behavior with this threshold The monitor would have transitioned 24 times " +
  "in the selected time frame. 12 Alert 0 Warn 12 Recover 0 No Data";

describe("parseBacktestPanel", () => {
  it("reads all five numbers out of the panel's own wording", () => {
    const parsed = parseBacktestPanel({ panelText: REAL_PANEL });
    expect(parsed.isOk()).toBe(true);
    const reading = unwrap(parsed);
    expect(reading.transitions).toBe(24);
    expect(reading.alert).toBe(12);
    expect(reading.warn).toBe(0);
    expect(reading.recover).toBe(12);
    expect(reading.noData).toBe(0);
  });

  it("normalises newlines and runs of whitespace the way the page-side reader does", () => {
    const parsed = parseBacktestPanel({
      panelText: "would have transitioned   7   times\n\n3 Alert\n1 Warn\n3 Recover\n0 No Data",
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).transitions).toBe(7);
    expect(unwrap(parsed).warn).toBe(1);
  });

  it("reads the singular 'transitioned 1 time' the console writes for a single transition", () => {
    const parsed = parseBacktestPanel({
      panelText: "would have transitioned 1 time. 1 Alert 0 Warn 0 Recover 0 No Data",
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).transitions).toBe(1);
  });

  it("refuses a panel missing a count, and names which one", () => {
    const parsed = parseBacktestPanel({
      panelText: "would have transitioned 4 times. 2 Alert 0 Warn 2 Recover",
    });
    expect(parsed.isErr()).toBe(true);
    const error = unwrapErr(parsed);
    expect(error.code).toBe("PANEL_UNREADABLE");
    expect(error.message).toContain("No Data");
  });

  it("refuses text that is not a backtest panel at all", () => {
    const parsed = parseBacktestPanel({ panelText: "Edit monitor" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("PANEL_UNREADABLE");
  });

  it("refuses a panel with counts but no transition sentence, so a partial read never passes", () => {
    const parsed = parseBacktestPanel({ panelText: "5 Alert 0 Warn 5 Recover 0 No Data" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("transition count");
  });

  it("keeps a genuine zero, which is the number the settling poll exists to protect", () => {
    const parsed = parseBacktestPanel({
      panelText: "would have transitioned 0 times. 0 Alert 0 Warn 0 Recover 0 No Data",
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).transitions).toBe(0);
    expect(unwrap(parsed).alert).toBe(0);
  });
});

describe("formatReadingLine", () => {
  it("renders the caption a pull request's Proof cell carries", () => {
    const line = formatReadingLine({
      reading: { alert: 12, noData: 0, recover: 12, transitions: 24, warn: 0 },
      windowLabel: "Past 1 Week",
    });
    expect(line).toBe("24 transitions over Past 1 Week — 12 Alert / 0 Warn / 12 Recover / 0 No Data");
  });
});

describe("monitorShotFilename", () => {
  it("names a monitor's shot by its id, so two monitors never collide", () => {
    expect(monitorShotFilename({ monitorId: "600101" })).toBe("monitor-600101-7d-backtest.png");
  });
});

describe("explorerShotFilename", () => {
  it("slugs the label and stamps the instant, so two shots of one query never overwrite", () => {
    expect(
      explorerShotFilename({
        label: "copilot.judge.result-by-instrumentation_scope",
        nowIso: "2026-09-02T02:08:36.000Z",
      }),
    ).toBe("explorer-copilot-judge-result-by-instrumentation-scope-2026-09-02T02-08-36-000Z.png");
  });

  it("falls back to a stated name when the label slugs to nothing", () => {
    expect(explorerShotFilename({ label: "///", nowIso: "2026-09-02T00:00:00.000Z" })).toBe(
      "explorer-view-2026-09-02T00-00-00-000Z.png",
    );
  });
});
