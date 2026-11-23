/** {@link namedTiers}, {@link spawnModelRefusal} and {@link modelTierAdvisory} — pure, no board and no spawn involved. */
import { describe, expect, it } from "vitest";

import {
  FABLE_OVERRIDE_ENV,
  isFableModel,
  isOpusModel,
  modelTierAdvisory,
  namedTiers,
  OPUS_SPAWN_EFFORT,
  opusSpawnEffort,
  spawnModelRefusal,
} from "../../../cmux/modelPin.js";

describe("isOpusModel", () => {
  it("recognises the alias and both dated Opus ids", () => {
    expect(isOpusModel({ model: "opus" })).toBe(true);
    expect(isOpusModel({ model: "claude-opus-5" })).toBe(true);
    expect(isOpusModel({ model: "claude-opus-5-5" })).toBe(true);
  });

  it("does not claim another tier, nor a word that merely contains opus", () => {
    expect(isOpusModel({ model: "sonnet" })).toBe(false);
    expect(isOpusModel({ model: "fable" })).toBe(false);
    expect(isOpusModel({ model: "magnumopus" })).toBe(false);
  });
});

describe("opusSpawnEffort", () => {
  it("pins high on an Opus spawn on a Claude Code host, alias or dated id", () => {
    expect(OPUS_SPAWN_EFFORT).toBe("high");
    expect(opusSpawnEffort({ host: "claude-code", model: "opus" })).toBe("high");
    expect(opusSpawnEffort({ host: "claude-code", model: "claude-opus-5-5" })).toBe("high");
  });

  it("leaves a Sonnet leaf on Claude Code's own default", () => {
    expect(opusSpawnEffort({ host: "claude-code", model: "sonnet" })).toBeUndefined();
  });

  it("never pins an effort on a codex host, which has no --effort at all", () => {
    expect(opusSpawnEffort({ host: "codex", model: "opus" })).toBeUndefined();
  });
});

describe("namedTiers", () => {
  it("finds a tier named in prose, whatever its case", () => {
    expect(namedTiers({ text: "Opus-sized for the design" })).toEqual(["opus"]);
  });

  it("reports every tier a doc names rather than picking one", () => {
    expect(namedTiers({ text: "sonnet for the sweep, opus for the design" })).toEqual(["opus", "sonnet"]);
  });

  it("deduplicates a tier named twice", () => {
    expect(namedTiers({ text: "Sonnet first, then more sonnet" })).toEqual(["sonnet"]);
  });

  it("does not match a tier inside a longer word", () => {
    expect(namedTiers({ text: "the opuscule and the sonneteer" })).toEqual([]);
  });

  it("finds nothing in prose that names no tier", () => {
    expect(namedTiers({ text: "land the measurement half first, then the policy half" })).toEqual([]);
  });

  it("finds nothing in empty prose", () => {
    expect(namedTiers({ text: "" })).toEqual([]);
  });
});

describe("isFableModel", () => {
  it("recognises the tier, the bracketed context variant and a dated id", () => {
    expect(isFableModel({ model: "fable" })).toBe(true);
    expect(isFableModel({ model: "fable[1m]" })).toBe(true);
    expect(isFableModel({ model: "claude-fable-5-1" })).toBe(true);
  });

  it("does not match opus or sonnet", () => {
    expect(isFableModel({ model: "opus" })).toBe(false);
    expect(isFableModel({ model: "sonnet" })).toBe(false);
  });
});

describe("spawnModelRefusal", () => {
  it("refuses a spawn that omitted --model, naming the heuristic and the re-run", () => {
    const refusal = spawnModelRefusal({ env: {}, model: undefined, slug: "a-doc" });

    expect(refusal).toBe(
      "--model is required: a spawn with no pin boots onto the launching user's saved default, which is how " +
        "every session on this machine ended up on Fable. Opus for anything that rebases, resolves " +
        "conflicts, lands a PR or investigates; sonnet for a mechanical leaf; fable roughly one in twenty, for a " +
        "deep investigation. Re-run: slopweaver cmux spawn a-doc --model <opus|sonnet>",
    );
  });

  it("refuses an empty --model the same way", () => {
    expect(spawnModelRefusal({ env: {}, model: "  ", slug: "a-doc" })).toContain("--model is required");
  });

  it("refuses --model fable with the owner's text, verbatim", () => {
    expect(spawnModelRefusal({ env: {}, model: "fable", slug: "a-doc" })).toBe(
      "use the right tool for the job, but if this is one of those few instances where fable is the right tool " +
        "for the job, then re-run with `ALLOW_FABLE_OVERRIDE=1 slopweaver cmux spawn a-doc --model fable`",
    );
  });

  it("refuses the bracketed and dated Fable spellings too", () => {
    expect(spawnModelRefusal({ env: {}, model: "fable[1m]", slug: "a-doc" })).toContain("use the right tool");
    expect(spawnModelRefusal({ env: {}, model: "claude-fable-5-1", slug: "a-doc" })).toContain("use the right tool");
  });

  it("lets fable through under the override", () => {
    expect(spawnModelRefusal({ env: { [FABLE_OVERRIDE_ENV]: "1" }, model: "fable", slug: "a-doc" })).toBe(undefined);
  });

  it("does not let an override value other than 1 count", () => {
    expect(spawnModelRefusal({ env: { [FABLE_OVERRIDE_ENV]: "yes" }, model: "fable", slug: "a-doc" })).toContain(
      "use the right tool",
    );
  });

  it("lets opus and sonnet through with no override", () => {
    expect(spawnModelRefusal({ env: {}, model: "opus", slug: "a-doc" })).toBe(undefined);
    expect(spawnModelRefusal({ env: {}, model: "sonnet", slug: "a-doc" })).toBe(undefined);
  });

  it("names the override by the owner's exact variable name", () => {
    expect(FABLE_OVERRIDE_ENV).toBe("ALLOW_FABLE_OVERRIDE");
  });
});

describe("modelTierAdvisory", () => {
  it("advises when the doc names a tier and the spawn pinned a different one", () => {
    expect(modelTierAdvisory({ model: "opus", slug: "a-doc", statusSummary: "Sonnet-sized, small diff" })).toBe(
      "a-doc's statusSummary names sonnet but this spawn pins opus; the doc's prose is advice, so this proceeds — " +
        "re-run with --model <tier> if the doc was right.",
    );
  });

  it("names every tier when the doc named more than one", () => {
    expect(
      modelTierAdvisory({ model: "haiku", slug: "a-doc", statusSummary: "opus to plan, sonnet to build" }),
    ).toContain("names opus and sonnet");
  });

  it("says nothing when the pin matches one of the tiers the doc named", () => {
    expect(modelTierAdvisory({ model: "sonnet", slug: "a-doc", statusSummary: "opus to plan, sonnet to build" })).toBe(
      undefined,
    );
  });

  it("says nothing when the doc names no tier", () => {
    expect(modelTierAdvisory({ model: "opus", slug: "a-doc", statusSummary: "small diff, land it today" })).toBe(
      undefined,
    );
  });

  it("says nothing when the doc declares no statusSummary at all", () => {
    expect(modelTierAdvisory({ model: "opus", slug: "a-doc", statusSummary: undefined })).toBe(undefined);
  });
});
