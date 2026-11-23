import { describe, expect, it } from "vitest";

import { inlineSegments, resolveInline } from "../../../lib/inlineCitations";
import { pr, WITH_PEOPLE } from "./fixtures";

describe("the people a sentence names: names, never Slack member ids", () => {
  it("draws a known member as a person segment between the words, and still links a reference beside it", () => {
    expect(
      inlineSegments({ references: WITH_PEOPLE, text: `<@U0QUINN> asked about #17560 (${pr({ n: 17560 })})` }),
    ).toEqual([
      { id: "U0QUINN", kind: "person", label: "Quinn Riley" },
      { kind: "text", text: " asked about " },
      { kind: "cite", label: "#17560", url: pr({ n: 17560 }) },
    ]);
  });

  it("reads an unknown labelled mention as its @label, even in a sentence naming nobody the roster knows", () => {
    expect(inlineSegments({ references: WITH_PEOPLE, text: "cc <@U0NOBODY|sadie> on it" })).toEqual([
      { kind: "text", text: "cc @sadie on it" },
    ]);
  });

  it("reports an unknown <@U…> as a mention with no target, the drawer's citation finding", () => {
    expect(resolveInline({ references: WITH_PEOPLE, text: "ask <@U0NOBODY>" }).unlinked).toEqual([
      { kind: "slack", label: "U0NOBODY" },
    ]);
  });
});
