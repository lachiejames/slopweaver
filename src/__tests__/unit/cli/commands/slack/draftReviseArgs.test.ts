/**
 * `draftReviseArgs.ts` — `slack draft revise | restore`'s flags, each checked as the register will read it back, so a
 * value the line reader would pass over is refused at the verb instead.
 */
import { describe, expect, it } from "vitest";

import { parseDraftRevision } from "../../../../../cli/commands/slack/draftReviseArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SHARED = { home: "/h", json: false };

describe("parseDraftRevision", () => {
  it("parses a revise with the owner's words, the voice's reading and the anchor", () => {
    const values = { anchor: "talk:turn_1", heard: "make it warmer", reading: '["warmer opening"]', text: "-" };
    expect(unwrap(parseDraftRevision({ id: "sd-1a2b3c4d", shared: SHARED, sub: "revise", values }))).toEqual({
      anchor: "talk:turn_1",
      heard: "make it warmer",
      home: "/h",
      id: "sd-1a2b3c4d",
      json: false,
      mode: "revise",
      reading: ["warmer opening"],
      textSource: "-",
    });
  });

  it("parses a restore by version number", () => {
    const values = { version: "1" };
    expect(unwrap(parseDraftRevision({ id: "sd-1a2b3c4d", shared: SHARED, sub: "restore", values }))).toEqual({
      home: "/h",
      id: "sd-1a2b3c4d",
      json: false,
      mode: "restore",
      version: 1,
    });
  });

  it("refuses a revise with no words and a restore with no whole version", () => {
    const revise = parseDraftRevision({ id: "sd-1", shared: SHARED, sub: "revise", values: { text: "  " } });
    expect(unwrapErr(revise).message).toBe("slack draft revise needs --text <the whole rewritten message|->");
    const restore = parseDraftRevision({ id: "sd-1", shared: SHARED, sub: "restore", values: { version: "1.5" } });
    expect(unwrapErr(restore).message).toContain("slack draft restore needs --version <n>");
  });

  it("refuses a reading the register would pass over: not an array, empty, or a blank line", () => {
    const refusedFor = ({ reading }: { reading: string }): string =>
      unwrapErr(parseDraftRevision({ id: "sd-1", shared: SHARED, sub: "revise", values: { reading, text: "-" } }))
        .message;
    const readings = ["warmer", "[]", '["  "]'];
    expect(readings.map((reading) => refusedFor({ reading }).slice(0, 35))).toEqual([
      "--reading is a JSON array of 1-5 sh",
      "--reading is a JSON array of 1-5 sh",
      "--reading is a JSON array of 1-5 sh",
    ]);
  });

  it("refuses words too long to keep and a blank anchor", () => {
    const values = { anchor: " ", heard: "x".repeat(601), text: "-" };
    expect(unwrapErr(parseDraftRevision({ id: "sd-1", shared: SHARED, sub: "revise", values })).message).toBe(
      "--heard carries their words, at most 600 characters; --anchor names where they said it",
    );
  });
});
