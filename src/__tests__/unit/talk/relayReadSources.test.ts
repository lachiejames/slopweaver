/*
 * A dropped reading is said in words, never as a read's id. A relay line once named
 * "context_pack, web_search, code_mode, collaboration", the supervisor took that for the voice reciting a tool
 * inventory aloud, and `read_supervisor` hands the voice those same lines — so no id may ride the chair's line, the
 * board row or `talk log`.
 */
import { describe, expect, it } from "vitest";

import { relayAskText } from "../../../talk/relayAskText.js";
import { RELAY_READ_SOURCES } from "../../../talk/relayDraft.js";
import { droppedReadingWhy, RELAY_STANDING_READS, RELAY_TRANSIENT_READS } from "../../../talk/relayReadSources.js";
import { relayTurnLine } from "../../../talk/supervisorDelivery.js";

/** Every read id a relay may record, as a whole word in `text`. */
const idsIn = ({ text }: { text: string }): readonly string[] =>
  RELAY_READ_SOURCES.filter((id) => id.includes("_") && text.includes(id));

describe("droppedReadingWhy", () => {
  it("says the context pack as text in front of it and the built-ins as a reach, never as reads", () => {
    expect(droppedReadingWhy({ readsAfter: [...RELAY_STANDING_READS, ...RELAY_TRANSIENT_READS] })).toBe(
      "it had text the owner did not say in front of it: the context pack and the open card's draft; its web search, " +
        "code execution and sub-agents can reach it with no tool call the console sees",
    );
  });

  it("says a tool read's name as words, and no reach when none was recorded", () => {
    expect(droppedReadingWhy({ readsAfter: ["read_screen"] })).toBe(
      "it had text the owner did not say in front of it: read screen",
    );
  });

  it("says only the reach when nothing was in front of it", () => {
    expect(droppedReadingWhy({ readsAfter: ["web_search"] })).toBe(
      "its web search can reach it with no tool call the console sees",
    );
  });

  it("leaves no read id in what it says, for every read a relay may record", () => {
    expect(RELAY_READ_SOURCES.length).toBeGreaterThan(0);
    expect(idsIn({ text: droppedReadingWhy({ readsAfter: RELAY_READ_SOURCES }) })).toEqual([]);
    expect(droppedReadingWhy({ readsAfter: RELAY_READ_SOURCES })).not.toContain("collaboration");
  });
});

describe("a heard-only relay's text", () => {
  // The witness that the guard can fire: before this change the chair's line carried every one of these ids.
  it("names no read id on the chair's line, the line the voice reads back", () => {
    const line = relayTurnLine({
      turn: {
        answer: { triage: { kind: "none" }, voice: { kind: "not-found", why: "no relay line yet" } },
        callContext: { kind: "none" },
        heard: "fix the tab",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: RELAY_STANDING_READS,
        slug: "talk-82ea0250405a",
        typed: false,
        words: "",
        wordsAlone: false,
      },
    });
    expect(line).toContain(
      "voice reading dropped, only the owner's words here (it had text the owner did not say in front of it: the context pack; its web search",
    );
    expect(idsIn({ text: line })).toEqual([]);
    expect(line).not.toContain("collaboration");
  });

  it("names no read id on the board row", () => {
    const ask = relayAskText({
      about: "",
      heard: "fix the tab",
      quoteCut: undefined,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: RELAY_STANDING_READS,
      words: "",
      wordsAlone: false,
    });
    expect(idsIn({ text: ask })).toEqual([]);
    expect(ask).not.toContain("collaboration");
  });
});
