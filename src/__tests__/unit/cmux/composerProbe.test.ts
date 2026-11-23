/**
 * {@link decideClaudeBoot} — a failed grid read kept apart from a grid that read and held no composer, so a loaded
 * surface keeps its honest `unwitnessed` success while a zsh prompt fails the boot.
 */
import { describe, expect, it } from "vitest";

import {
  type ComposerProbe,
  decideClaudeBoot,
  failedBootClause,
  gridReadWithoutComposer,
  witnessedComposer,
} from "../../../cmux/composerProbe.js";

const EMPTY: ComposerProbe = { kind: "read", reading: { kind: "empty" } };
const NO_COMPOSER: ComposerProbe = { kind: "read", reading: { kind: "unreadable", reason: "no composer prompt row" } };
const FAILED: ComposerProbe = { kind: "read-failed", reason: "the styled grid could not be read: busy" };

describe("witnessedComposer", () => {
  it("names a recognised box, and nothing for a failed read or a grid with no composer", () => {
    expect([
      witnessedComposer({ probe: EMPTY }),
      witnessedComposer({ probe: NO_COMPOSER }),
      witnessedComposer({ probe: FAILED }),
    ]).toEqual([{ kind: "empty" }, undefined, undefined]);
  });
});

describe("gridReadWithoutComposer", () => {
  it("is true only for a grid that read and held no composer, never for a failed read or a box", () => {
    expect([
      gridReadWithoutComposer({ probe: NO_COMPOSER }),
      gridReadWithoutComposer({ probe: FAILED }),
      gridReadWithoutComposer({ probe: EMPTY }),
    ]).toEqual([true, false, false]);
  });
});

describe("decideClaudeBoot", () => {
  it("witnesses the boot on any recognised composer, however many reads failed before it", () => {
    expect(decideClaudeBoot({ bootWitnessed: false, missingConversationSeen: false, probes: [FAILED, EMPTY] })).toEqual(
      { kind: "composer", reading: { kind: "empty" } },
    );
  });

  it("fails a boot whose surface READ and showed no composer, even with SessionStart fired", () => {
    expect(
      decideClaudeBoot({ bootWitnessed: true, missingConversationSeen: false, probes: [FAILED, NO_COMPOSER] }),
    ).toEqual({ kind: "failed", reason: "readable-without-composer" });
  });

  it("keeps a witnessed boot whose every read failed an unwitnessed success on a loaded surface", () => {
    expect(decideClaudeBoot({ bootWitnessed: true, missingConversationSeen: false, probes: [FAILED, FAILED] })).toEqual(
      {
        kind: "unwitnessed",
      },
    );
  });

  it("fails a boot nothing vouched for and no read reached", () => {
    expect(decideClaudeBoot({ bootWitnessed: false, missingConversationSeen: false, probes: [] })).toEqual({
      kind: "failed",
      reason: "never-read",
    });
  });

  it("fails on the missing-conversation line before anything else, a composer included", () => {
    expect(decideClaudeBoot({ bootWitnessed: true, missingConversationSeen: true, probes: [EMPTY] })).toEqual({
      kind: "failed",
      reason: "missing-conversation",
    });
  });
});

describe("failedBootClause", () => {
  it("names the missing conversation in Claude's own words", () => {
    expect(failedBootClause({ reason: "missing-conversation" })).toContain("No conversation found with session ID");
  });
});
