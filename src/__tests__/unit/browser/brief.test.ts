/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  BRIEF_NO_VERB,
  BRIEF_NO_VERB_LABEL,
  BRIEF_VERBS,
  type ExtensionBrief,
  renderBrief,
} from "../../../browser/brief.js";

const brief: ExtensionBrief = {
  finish: "slopweaver datadog shot file --image /tmp/shot.png",
  lane: "datadog shot monitor",
  steps: [
    { tool: "slopweaver browser shot", what: "wait for the panel to settle" },
    {
      script: "document.title",
      tool: BRIEF_NO_VERB,
      what: "read the view back",
      wouldClose: "a declared relay operation beside `src/browser/datadogConsoleSnippet.ts`",
    },
  ],
  url: "https://ap1.datadoghq.com/monitors/1/edit",
};

describe("BRIEF_VERBS", () => {
  it("is a non-empty closed set, so every assertion below is over something", () => {
    expect(BRIEF_VERBS.length).toBeGreaterThan(0);
  });

  it("names only `slopweaver browser` verbs — a Claude-in-Chrome tool name cannot be one", () => {
    expect(BRIEF_VERBS.filter((verb) => !verb.startsWith("slopweaver browser "))).toEqual([]);
  });
});

describe("renderBrief", () => {
  it("leads with the lane and where to go, naming the verbs rather than the retired extension", () => {
    const lines = renderBrief({ brief });
    expect(lines[0]).toBe(
      "datadog shot monitor: this needs a rendered page, so it runs in YOUR Chrome through the slopweaver browser verbs.",
    );
    expect(lines[1]).toBe("open: https://ap1.datadoghq.com/monitors/1/edit");
  });

  it("numbers each step and names the verb it is done with", () => {
    const lines = renderBrief({ brief });
    expect(lines[2]).toBe("  1. slopweaver browser shot — wait for the panel to settle");
  });

  it("labels a gap step as a gap and says what would close it, so nobody reads it as an oversight", () => {
    const lines = renderBrief({ brief });
    expect(lines[3]).toBe(`  2. ${BRIEF_NO_VERB_LABEL} — read the view back`);
    expect(lines[4]).toBe(
      "     what would close it: a declared relay operation beside `src/browser/datadogConsoleSnippet.ts`",
    );
  });

  it("puts a script on its own line, because it is copied verbatim", () => {
    const lines = renderBrief({ brief });
    expect(lines[5]).toBe("     script: document.title");
  });

  it("omits the script line for a gap step that carries none", () => {
    const lines = renderBrief({
      brief: {
        ...brief,
        steps: [{ tool: BRIEF_NO_VERB, what: "read the network", wouldClose: "a CLI route to captured responses" }],
      },
    });
    expect(lines[3]).toBe("     what would close it: a CLI route to captured responses");
    expect(lines[4]).toBe("then: slopweaver datadog shot file --image /tmp/shot.png");
  });

  it("ends by naming the verb that judges what comes back", () => {
    expect(renderBrief({ brief }).at(-1)).toBe("then: slopweaver datadog shot file --image /tmp/shot.png");
  });

  it("renders a brief with no steps as an open-and-finish pair", () => {
    const lines = renderBrief({ brief: { ...brief, steps: [] } });
    expect(lines.length).toBe(3);
  });
});
