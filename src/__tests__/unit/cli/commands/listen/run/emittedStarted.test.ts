/** The emitted mention JSON carries a capture-time `started` ref through when, and only when, it has one. */
import { describe, expect, it } from "vitest";

import { emitOnly } from "../../../../../../cli/commands/listen/emit.js";
import type { Mention } from "../../../../../../live/listen/mention.js";

describe("emittedMention carries `started` through", () => {
  const WITHOUT_STARTED: Mention = {
    channel: "C_BOT",
    messageTs: "1785114398.557099",
    surface: "channel",
    text: "what are my open PRs?",
    threadTs: "1785114000.000100",
    userId: "U_ASKER",
  };

  const WITH_STARTED: Mention = {
    ...WITHOUT_STARTED,
    started: { turnId: "turn-1", workingTs: "1785114398.000900" },
  };

  it("includes `started` in the emitted JSON when the mention carries one", () => {
    const lines: string[] = [];
    void emitOnly({ json: true, sink: ({ line }) => lines.push(line) })(WITH_STARTED);

    expect(JSON.parse(lines[0]!).started).toEqual({ turnId: "turn-1", workingTs: "1785114398.000900" });
  });

  it("omits `started` entirely when the mention carries none", () => {
    const lines: string[] = [];
    void emitOnly({ json: true, sink: ({ line }) => lines.push(line) })(WITHOUT_STARTED);

    expect(Object.keys(JSON.parse(lines[0]!))).not.toContain("started");
  });
});
