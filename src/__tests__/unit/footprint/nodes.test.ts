import { describe, expect, it } from "vitest";

import type { EntityKey } from "../../../footprint/entities.js";
import { type FootprintNode, isTeamVisible, quietHoursOf, statusOf } from "../../../footprint/nodes.js";

const NOW = "2026-09-04T04:00:00.000Z";

const slackNode = (over: Partial<FootprintNode> = {}): FootprintNode => ({
  asksForSomething: false,
  entities: new Set<EntityKey>(),
  hasDependentStep: false,
  hasResolution: false,
  id: "slack:C1:1788000000.000000",
  label: "a thread",
  lastMovedIso: "2026-09-01T04:00:00.000Z",
  ownerSpokeLast: true,
  provenance: {
    channel: "C1",
    channelName: "#dev-experience",
    citeUrl: "https://acme.slack.com/archives/C1/p1788000000000000",
    kind: "slack",
    threadTs: "1788000000.000000",
  },
  ...over,
});

describe("statusOf", () => {
  it("refuses the strong claim on owner-spoke-last alone", () => {
    const status = statusOf({ node: slackNode(), nowIso: NOW, quietHours: 24 });

    expect(status).toBe("status-check");
  });

  it("still refuses it when the owner asked something but nothing depends on the answer", () => {
    const status = statusOf({
      node: slackNode({ asksForSomething: true }),
      nowIso: NOW,
      quietHours: 24,
    });

    expect(status).toBe("status-check");
  });

  it("earns awaiting-decision only with all three facts", () => {
    const status = statusOf({
      node: slackNode({ asksForSomething: true, hasDependentStep: true }),
      nowIso: NOW,
      quietHours: 24,
    });

    expect(status).toBe("awaiting-decision");
  });

  it("reports moving inside the quiet window even with all three facts", () => {
    const status = statusOf({
      node: slackNode({
        asksForSomething: true,
        hasDependentStep: true,
        lastMovedIso: "2026-09-04T02:00:00.000Z",
      }),
      nowIso: NOW,
      quietHours: 24,
    });

    expect(status).toBe("moving");
  });

  it("reports resolved whatever else is true", () => {
    const status = statusOf({
      node: slackNode({ asksForSomething: true, hasDependentStep: true, hasResolution: true }),
      nowIso: NOW,
      quietHours: 24,
    });

    expect(status).toBe("resolved");
  });

  it("treats an unreadable instant as not moving rather than throwing", () => {
    const status = statusOf({ node: slackNode({ lastMovedIso: "not-a-date" }), nowIso: NOW, quietHours: 24 });

    expect(status).toBe("status-check");
  });
});

describe("quietHoursOf", () => {
  it("counts whole hours since the last movement", () => {
    expect(quietHoursOf({ node: slackNode(), nowIso: NOW })).toBe(72);
  });

  it("answers zero for an unreadable instant", () => {
    expect(quietHoursOf({ node: slackNode({ lastMovedIso: "" }), nowIso: NOW })).toBe(0);
  });

  it("never answers negative for a node moved after the clock", () => {
    expect(quietHoursOf({ node: slackNode({ lastMovedIso: "2026-09-05T04:00:00.000Z" }), nowIso: NOW })).toBe(0);
  });
});

describe("isTeamVisible", () => {
  it("admits a Slack node", () => {
    expect(isTeamVisible({ node: slackNode() })).toBe(true);
  });

  it("refuses a supervisor node, so private intent cannot compose text with an audience", () => {
    const node = slackNode({
      id: "supervisor:turn-1",
      provenance: { kind: "supervisor", quote: "the owner's exact words", saidAtIso: "2026-09-04T04:06:18.000Z" },
    });

    expect(isTeamVisible({ node })).toBe(false);
  });

  it("admits a board node", () => {
    const node = slackNode({ id: "board:some-slug", provenance: { kind: "board", slug: "some-slug" } });

    expect(isTeamVisible({ node })).toBe(true);
  });
});
