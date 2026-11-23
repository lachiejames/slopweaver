/**
 * `slack draft approve | hold | pick`'s flags (`cli/commands/slack/draftJudgementArgs.ts`): which draft the owner chose on a
 * comparison card, and an approve that names one.
 */
import { describe, expect, it } from "vitest";
import { parseDraftJudgement, parseDraftPick } from "../../../../../cli/commands/slack/draftJudgementArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SHARED = { home: "/home", json: false };

describe("parseDraftPick", () => {
  it("refuses a pick that names no variant", () => {
    expect(unwrapErr(parseDraftPick({ id: "d1", shared: SHARED, values: {} })).message).toBe(
      "--variant original|codex is required",
    );
  });

  it("refuses a variant outside the two a card offers", () => {
    expect(unwrapErr(parseDraftPick({ id: "d1", shared: SHARED, values: { variant: "gpt" } })).message).toBe(
      "--variant must be original or codex, not gpt",
    );
  });

  it("refuses an anchor that carries no words", () => {
    const parsed = parseDraftPick({ id: "d1", shared: SHARED, values: { anchor: "  ", variant: "codex" } });

    expect(unwrapErr(parsed).message).toBe("--anchor <where the owner chose> is required");
  });

  it("parses a pick with its variant and anchor", () => {
    const parsed = parseDraftPick({ id: "d1", shared: SHARED, values: { anchor: "call:1", variant: "codex" } });

    expect(unwrap(parsed)).toEqual({
      anchor: "call:1",
      home: "/home",
      id: "d1",
      json: false,
      mode: "pick",
      variant: "codex",
    });
  });
});

describe("parseDraftJudgement — approve", () => {
  it("carries the variant the owner's yes named", () => {
    const parsed = parseDraftJudgement({
      id: "d1",
      shared: SHARED,
      sub: "approve",
      values: { anchor: "call:1", variant: "original" },
    });

    expect(unwrap(parsed)).toEqual({
      anchor: "call:1",
      home: "/home",
      id: "d1",
      json: false,
      mode: "approve",
      variant: "original",
    });
  });

  it("refuses an approve with no anchor", () => {
    const parsed = parseDraftJudgement({ id: "d1", shared: SHARED, sub: "approve", values: {} });

    expect(unwrapErr(parsed).message).toBe("--anchor <the owner's yes> is required");
  });
});
