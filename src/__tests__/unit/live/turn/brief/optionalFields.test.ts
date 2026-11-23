/**
 * The brief's three ask-shaped optional fields end to end — `ridesOn`, `unprompted` and `stoodDown` built,
 * round-tripped through JSON, refused when malformed, and rendered to the judge only when present.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  buildTurnRoutingBrief,
  parseTurnRoutingBrief,
  renderTurnRoutingBrief,
} from "../../../../../live/turn/brief.js";
import { brief, ROUTING_INPUT, TAG_TREE } from "./harness.js";

describe("ridesOn — the same-thread ask whose card a sub-ask rides", () => {
  const riding = () =>
    buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1790141967.816599",
      question: "what is the ISO control for this?",
      ridesOn: "1790146101.489459",
      routingInput: ROUTING_INPUT,
      surface: "channel",
      threadTs: "1790137657.683209",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });

  it("is absent from a brief that rides nothing, and round-trips through JSON when present", () => {
    expect(Object.keys(brief({ question: "what did we decide?" }))).not.toContain("ridesOn");
    expect(unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(riding())) })).ridesOn).toBe(
      "1790146101.489459",
    );
  });

  it("refuses a ridesOn that is blank, not a string, or the ask's own ts", () => {
    for (const ridesOn of ["  ", 17, "1790141967.816599"]) {
      const error = unwrapErr(parseTurnRoutingBrief({ raw: { ...riding(), ridesOn } }));
      expect(error.code).toBe("BRIEF_INVALID_RIDES_ON");
    }
  });
});

describe("unprompted — an ask `witness help` opened rather than a tag", () => {
  const helped = () =>
    buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.2",
      question: "anything I can do to assist?",
      routingInput: ROUTING_INPUT,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      unprompted: true,
      userId: "U_ASKER",
    });

  it("is absent from a tagged brief, and round-trips through JSON as true when present", () => {
    expect(Object.keys(brief({ question: "what did we decide?" }))).not.toContain("unprompted");
    expect(unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(helped())) })).unprompted).toBe(true);
  });

  it("refuses any value but true", () => {
    for (const unprompted of [false, "true", 1]) {
      const error = unwrapErr(parseTurnRoutingBrief({ raw: { ...helped(), unprompted } }));
      expect(error.code).toBe("BRIEF_INVALID_UNPROMPTED");
    }
  });

  it("tells the judge nobody tagged the bot, and says nothing of it on a tagged brief", () => {
    const text = renderTurnRoutingBrief({
      brief: helped(),
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");
    const tagged = renderTurnRoutingBrief({
      brief: brief({ question: "x" }),
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");

    expect(text).toContain("UNPROMPTED — nobody tagged this bot in this message.");
    expect(text).toContain("Never do work a named person was asked to do.");
    expect(tagged).not.toContain("UNPROMPTED");
  });
});

describe("stoodDown — a tag in a thread that stood the bot down earlier", () => {
  const afterStandDown = () =>
    buildTurnRoutingBrief({
      channel: "C1",
      messageTs: "1.3",
      question: "fyi it's Melbourne now",
      routingInput: ROUTING_INPUT,
      stoodDown: true,
      surface: "channel",
      threadTs: "1.1",
      unavailableCapabilities: [],
      userId: "U_ASKER",
    });

  it("is absent from an ordinary brief, and round-trips through JSON as true when present", () => {
    expect(Object.keys(brief({ question: "what did we decide?" }))).not.toContain("stoodDown");
    expect(unwrap(parseTurnRoutingBrief({ raw: JSON.parse(JSON.stringify(afterStandDown())) })).stoodDown).toBe(true);
  });

  it("tells the judge a question is answered and a steer gets no-response, and says nothing on an ordinary brief", () => {
    const text = renderTurnRoutingBrief({ brief: afterStandDown(), briefPath: "/tmp/b.json", tagTree: TAG_TREE }).join(
      "\n",
    );
    const ordinary = renderTurnRoutingBrief({
      brief: brief({ question: "x" }),
      briefPath: "/tmp/b.json",
      tagTree: TAG_TREE,
    }).join("\n");

    expect(text).toContain("  - A genuine question to the bot: answer it, exactly as any tag.");
    expect(text).toContain("settles the tag to the acknowledged emoji and posts nothing.");
    expect(ordinary).not.toContain("STOOD DOWN");
  });
});
