/*
 * A channel chip reads `#dev`, never `#C0123` (`../../lib/slackChannelLabels.ts`): the name the author wrote, else the
 * name the recording read gave the draft's own destination, else the id — and the id is always the hover.
 */

import { describe, expect, it } from "vitest";
import { channelChipLabel, channelNames } from "../../lib/slackChannelLabels";

describe("channelNames", () => {
  it("names nothing when nothing is known and nothing is written", () => {
    expect([...channelNames({ known: [], texts: [] })]).toEqual([]);
  });

  it("names the draft's own destination by the name the recording read gave it", () => {
    expect([...channelNames({ known: [{ id: "C0123", name: "dev" }], texts: [] })]).toEqual([["C0123", "dev"]]);
  });

  it("names nothing for a destination the recording could not name, or named empty", () => {
    const known = [
      { id: "C0123", name: undefined },
      { id: "C0456", name: "" },
    ];
    expect([...channelNames({ known, texts: [] })]).toEqual([]);
  });

  it("reads the name the author wrote into a channel link", () => {
    expect([...channelNames({ known: [], texts: ["see <#C0123|dev> for it"] })]).toEqual([["C0123", "dev"]]);
  });

  it("lets the author's written name win over the recording's for the same channel", () => {
    const names = channelNames({ known: [{ id: "C0123", name: "old-dev" }], texts: ["<#C0123|dev>"] });
    expect([...names]).toEqual([["C0123", "dev"]]);
  });

  it("takes a bare link, or a label that only repeats the id, as naming nothing", () => {
    const names = channelNames({ known: [{ id: "C0123", name: "dev" }], texts: ["<#C0123> and <#C0456|C0456>"] });
    expect([...names]).toEqual([["C0123", "dev"]]);
  });

  it("reads a channel link written inside bold or italic, over the recording's name", () => {
    const names = channelNames({
      known: [{ id: "C0123", name: "old-dev" }],
      texts: ["*see <#C0123|dev>* and _then <#C0456|ops>_"],
    });
    expect([...names]).toEqual([
      ["C0123", "dev"],
      ["C0456", "ops"],
    ]);
  });

  it("reads Slack's wire escapes in a written name once", () => {
    expect([...channelNames({ known: [], texts: ["<#C0123|r&amp;d>"] })]).toEqual([["C0123", "r&d"]]);
  });

  it("reads every text in order, and the first name written for a channel holds", () => {
    const names = channelNames({
      known: [],
      texts: ["<#C0123|dev> then <#C0456|ops>", "<#C0123|dev-team> and <#C0789|growth>"],
    });
    expect([...names]).toEqual([
      ["C0123", "dev"],
      ["C0456", "ops"],
      ["C0789", "growth"],
    ]);
  });
});

describe("channelChipLabel", () => {
  it("reads a known channel by its name, the id as the hover", () => {
    const channels = new Map([["C0123", "dev"]]);
    expect(channelChipLabel({ channelId: "C0123", channels })).toEqual({ text: "dev", title: "C0123" });
  });

  it("reads a channel nothing names by its id, never a guessed name", () => {
    const channels = new Map([["C0123", "dev"]]);
    expect(channelChipLabel({ channelId: "C0999", channels })).toEqual({ text: "C0999", title: "C0999" });
  });
});
