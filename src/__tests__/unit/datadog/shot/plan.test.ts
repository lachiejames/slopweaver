/**
 * A monitor capture is no longer briefed. `datadog shot monitor` takes it through the relay, and its cases
 * live in `datadogMonitorBacktest.test.ts` and `monitorShot.test.ts`.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { BRIEF_NO_VERB, type BriefGapStep, renderBrief } from "../../../../browser/brief.js";
import { explorerBrief, relayExplorerPlan } from "../../../../datadog/shot/plan.js";

const HOST = "ap1.datadoghq.com";

describe("explorerBrief", () => {
  const seeded = explorerBrief({
    imagePath: "/tmp/a.png",
    requiredFragments: ["copilot.judge.result", "env:staging"],
    url: `https://${HOST}/metric/x`,
  });

  it("opens the address it was given", () => {
    expect(seeded.url).toBe(`https://${HOST}/metric/x`);
  });

  it("names what a SEEDED view must be read back as carrying", () => {
    expect(seeded.steps[2]!.what).toContain("copilot.judge.result, env:staging");
  });

  it("keeps the read-back as the one gap, and says what would close it", () => {
    const gaps = seeded.steps.filter((s) => s.tool === BRIEF_NO_VERB);
    expect(gaps.length).toBe(1);
    expect((gaps[0] as BriefGapStep).wouldClose).toContain("datadogConsoleSnippet.ts");
  });

  it("asks for NO preview URLs, because an Explorer view has no backtest window to prove", () => {
    expect(seeded.finish).not.toContain("--preview-url");
  });

  it("names no retired Claude-in-Chrome tool anywhere in what it prints", () => {
    const rendered = renderBrief({ brief: seeded }).join("\n");
    expect(rendered).not.toContain("computer (screenshot)");
    expect(rendered).not.toContain("javascript_tool");
    expect(rendered).not.toContain("read_network_requests");
  });
});

describe("relayExplorerPlan", () => {
  const lines = relayExplorerPlan({ imagePath: "/tmp/a.png", url: `https://${HOST}/metric/x` });

  it("says a supplied address has nothing to read back", () => {
    expect(lines[0]).toContain("nothing to read back");
  });

  it("names no session leg at all, because there is none", () => {
    expect(lines[1]).toBe(
      "and the whole capture runs through the relay in YOUR Chrome — no extension, no session leg.",
    );
  });

  it("emits the exact `browser shot` invocation, with the image path both halves agree on", () => {
    expect(lines[2]).toBe(
      `  1. slopweaver browser shot --url 'https://${HOST}/metric/x' --out /tmp/a.png --raw --settle 12000`,
    );
    expect(lines[3]).toBe("then: slopweaver datadog shot file --image /tmp/a.png");
  });

  it("names no Claude-in-Chrome tool anywhere, which is the whole point of this route", () => {
    expect(lines.join("\n")).not.toContain("computer (screenshot)");
    expect(lines.join("\n")).not.toContain("javascript_tool");
  });
});
