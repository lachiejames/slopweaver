import { describe, expect, it } from "vitest";

import {
  blockerKey,
  carriedHistory,
  parseBlockerSteps,
  parseRecipeBlockerArgs,
} from "../../../../../cli/commands/automation/blocker.js";
import { RecipeCommandErrors } from "../../../../../cli/commands/automation/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ResyncAttempt, ResyncState } from "../../../../../live/resync/outcome.js";

const HOME = "/tmp/home";

describe("parseBlockerSteps", () => {
  it("reads a JSON array as the ordered steps", () => {
    expect(unwrap(parseBlockerSteps({ value: '["open it, then wait","sign in"]' }))).toEqual([
      "open it, then wait",
      "sign in",
    ]);
  });

  it("reads one plain step as a single-step list, because quoting an array to say one thing is ceremony", () => {
    expect(unwrap(parseBlockerSteps({ value: "  sign in  " }))).toEqual(["sign in"]);
  });

  it("refuses an empty value", () => {
    expect(unwrapErr(parseBlockerSteps({ value: "   " }))).toEqual(RecipeCommandErrors.stepsEmpty({ got: "   " }));
    expect(unwrapErr(parseBlockerSteps({ value: "   " })).message).toBe(
      "--steps needs at least one step; a blocker with no way to clear it is the thing this avoids",
    );
  });

  it("refuses an empty JSON array", () => {
    expect(unwrapErr(parseBlockerSteps({ value: "[]" }))).toEqual(RecipeCommandErrors.stepsNotArray({ got: "[]" }));
  });

  it("refuses a JSON array holding anything that is not a real step", () => {
    expect(unwrapErr(parseBlockerSteps({ value: '["ok", 3]' })).message).toBe(
      "every entry of --steps must be a non-empty string",
    );
    expect(unwrapErr(parseBlockerSteps({ value: '["ok", "  "]' }))).toEqual(
      RecipeCommandErrors.stepEntryEmpty({ got: '["ok", "  "]' }),
    );
  });

  it("refuses a value that opened as JSON and is not", () => {
    const refused = unwrapErr(parseBlockerSteps({ value: "[not json" }));
    expect(refused.code).toBe("INVALID_FLAG_VALUE");
    expect(refused.message).toContain("was read as JSON");
  });
});

describe("blockerKey", () => {
  it("derives the same key from the same observation, so re-recording updates rather than piles up", () => {
    expect(blockerKey({ reason: "The signed-in session is GONE." })).toBe(
      blockerKey({ reason: "the signed-in session is gone" }),
    );
  });

  it("derives a different key from a different failure", () => {
    expect(blockerKey({ reason: "the token returned HTTP 401" })).not.toBe(
      blockerKey({ reason: "the signed-in session is gone" }),
    );
  });

  it("holds the key to a slug of bounded length", () => {
    expect(blockerKey({ reason: "x".repeat(200) }).length).toBe(60);
  });
});

describe("carriedHistory", () => {
  it("carries no history for a target with no previous state", () => {
    expect(carriedHistory({ previous: null })).toStrictEqual({ lastAttempt: null, lastSuccessAtIso: null });
  });

  it("carries the previous attempt and last success forward, so a blocker never erases them", () => {
    const lastAttempt: ResyncAttempt = {
      afterClock: null,
      beforeClock: null,
      exitCode: 1,
      finishedAtIso: "2026-09-02T00:01:00.000Z",
      outcome: "failed",
      problems: ["the signed-in session is gone"],
      recipeId: "resync-atlas-slack",
      startedAtIso: "2026-09-02T00:00:00.000Z",
    };
    const previous: ResyncState = {
      blocker: null,
      lastAttempt,
      lastSuccessAtIso: "2026-09-01T00:00:00.000Z",
      recipeId: "resync-atlas-slack",
    };
    expect(carriedHistory({ previous })).toStrictEqual({ lastAttempt, lastSuccessAtIso: "2026-09-01T00:00:00.000Z" });
  });
});

describe("parseRecipeBlockerArgs", () => {
  it("resolves an atlas target with its reason, steps and linked finding", () => {
    const parsed = parseRecipeBlockerArgs({
      defaultHome: HOME,
      rest: ["--atlas", "trelica", "--reason", "signed out", "--steps", "sign in", "--finding", "a-row"],
    });
    expect(unwrap(parsed).target).toEqual({ kind: "atlas", platform: "trelica" });
    expect(unwrap(parsed).blocker).toEqual({
      findingSlug: "a-row",
      key: "signed-out",
      reason: "signed out",
      steps: ["sign in"],
    });
  });

  it("resolves a corpus target", () => {
    const parsed = parseRecipeBlockerArgs({
      defaultHome: HOME,
      rest: ["--source", "gmail", "--reason", "consent lapsed", "--steps", "re-consent"],
    });
    expect(unwrap(parsed).target).toEqual({ kind: "corpus", source: "gmail" });
  });

  it("records no finding slug when none was given", () => {
    const parsed = parseRecipeBlockerArgs({
      defaultHome: HOME,
      rest: ["--atlas", "trelica", "--reason", "signed out", "--steps", "sign in"],
    });
    expect(unwrap(parsed).blocker!.findingSlug).toBe(null);
  });

  it("reads --clear as the instruction to drop the standing blocker", () => {
    const parsed = parseRecipeBlockerArgs({ defaultHome: HOME, rest: ["--atlas", "trelica", "--clear"] });
    expect(unwrap(parsed).blocker).toBe(null);
  });

  it("takes the home the caller named over the default", () => {
    const parsed = parseRecipeBlockerArgs({
      defaultHome: HOME,
      rest: ["--atlas", "trelica", "--clear", "--home", "/elsewhere"],
    });
    expect(unwrap(parsed).home).toBe("/elsewhere");
  });

  it("refuses an invocation naming no target", () => {
    const parsed = parseRecipeBlockerArgs({ defaultHome: HOME, rest: ["--reason", "x", "--steps", "y"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.targetMissing());
    expect(unwrapErr(parsed).message).toBe("name a target: --atlas <platform>, or --source <corpus source>");
  });

  it("refuses an invocation naming both kinds of target", () => {
    const parsed = parseRecipeBlockerArgs({
      defaultHome: HOME,
      rest: ["--atlas", "trelica", "--source", "notion", "--clear"],
    });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.targetsAmbiguous());
    expect(unwrapErr(parsed).message).toBe("--atlas and --source name two different targets — pass exactly one");
  });

  it("refuses a corpus source this build does not have", () => {
    const parsed = parseRecipeBlockerArgs({ defaultHome: HOME, rest: ["--source", "nowhere", "--clear"] });
    expect(unwrapErr(parsed).code).toBe("CORPUS_SOURCE_UNKNOWN");
    expect(unwrapErr(parsed).message).toContain("`nowhere` is not a corpus source");
  });

  it("refuses a blocker with no steps, because one with no way out is not actionable", () => {
    const parsed = parseRecipeBlockerArgs({ defaultHome: HOME, rest: ["--atlas", "trelica", "--reason", "x"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.stepsMissing());
    expect(unwrapErr(parsed).message).toBe(
      "--steps is required unless --clear: a blocker with no way to clear it is not actionable",
    );
  });

  it("refuses a blocker with no reason", () => {
    const parsed = parseRecipeBlockerArgs({ defaultHome: HOME, rest: ["--atlas", "trelica", "--steps", "y"] });
    expect(unwrapErr(parsed)).toEqual(RecipeCommandErrors.reasonMissing());
    expect(unwrapErr(parsed).message).toBe(
      "--reason is what was observed, in the verb's own words — it is required unless --clear",
    );
  });
});
