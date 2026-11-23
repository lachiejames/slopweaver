/*
 * `dripConfigFromProfile`: the as-me drip bounds fall back to working defaults with no profile, fail on a profile that
 * is not valid JSON, reach the same numbers through the schema, and carry every explicit drip preference and private
 * exact voice rule through.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dripConfigFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { freshHome, useFreshHomes } from "./harness.js";

useFreshHomes();

/** Write `$home/profile.json` exactly where `loadProfile` reads it. */
function writeProfile({ home, value }: { home: string; value: unknown }): void {
  writeFileSync(join(home, "profile.json"), JSON.stringify(value), "utf8");
}

/** The minimum a profile needs to parse at all, so a test can vary only the part it is about. */
const VALID_PROFILE = { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] };

describe("dripConfigFromProfile", () => {
  it("falls back to working bounds when there is no profile at all", () => {
    const home = freshHome({ prefix: "drip-absent-" });

    expect(unwrap(dripConfigFromProfile({ home }))).toEqual({
      exactVoiceRules: [],
      paragraphSpacing: false,
      intervalMs: 1500,
      maxMessages: 8,
      messageVisibleMax: 300,
      soleMessageVisibleMax: 1000,
      cardVisibleMax: 1000,
      maxBullets: 10,
      maxLines: 8,
    });
  });

  it("FAILS for a profile that exists but is not valid JSON, rather than sending under the defaults", () => {
    const home = freshHome({ prefix: "drip-corrupt-" });
    writeFileSync(join(home, "profile.json"), "{ not json", "utf8");

    const error = unwrapErr(dripConfigFromProfile({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(error.path).toBe(join(home, "profile.json"));
  });

  it("reaches the SAME numbers through the schema when a valid profile omits slackMe entirely", () => {
    const home = freshHome({ prefix: "drip-omitted-" });
    writeProfile({ home, value: VALID_PROFILE });

    // The two paths are compared against each other rather than each against a restated constant: that is
    // what "the duplicated defaults agree" actually means, and a comment once claimed it without any test.
    expect(unwrap(dripConfigFromProfile({ home }))).toEqual(
      unwrap(dripConfigFromProfile({ home: freshHome({ prefix: "drip-none-" }) })),
    );
  });

  it("uses an explicit messageVisibleMax while leaving cadence and count on their defaults", () => {
    const home = freshHome({ prefix: "drip-override-" });
    writeProfile({ home, value: { ...VALID_PROFILE, slackMe: { drip: { messageVisibleMax: 900 } } } });

    expect(unwrap(dripConfigFromProfile({ home }))).toEqual({
      exactVoiceRules: [],
      paragraphSpacing: false,
      intervalMs: 1500,
      maxMessages: 8,
      messageVisibleMax: 900,
      soleMessageVisibleMax: 1000,
      cardVisibleMax: 1000,
      maxBullets: 10,
      maxLines: 8,
    });
  });

  it("carries every explicit drip preference through, so the block is a real knob", () => {
    const home = freshHome({ prefix: "drip-full-" });
    writeProfile({
      home,
      value: {
        ...VALID_PROFILE,
        slackMe: {
          drip: {
            cardVisibleMax: 640,
            intervalMs: 0,
            maxBullets: 10,
            maxLines: 3,
            maxMessages: 2,
            messageVisibleMax: 120,
            soleMessageVisibleMax: 500,
          },
        },
      },
    });

    expect(unwrap(dripConfigFromProfile({ home }))).toEqual({
      exactVoiceRules: [],
      paragraphSpacing: false,
      intervalMs: 0,
      maxMessages: 2,
      messageVisibleMax: 120,
      soleMessageVisibleMax: 500,
      cardVisibleMax: 640,
      maxBullets: 10,
      maxLines: 3,
    });
  });

  it("loads private exact voice rules without changing the public mechanism", () => {
    const home = freshHome({ prefix: "drip-voice-" });
    const exactVoiceRules = [
      { kind: "literal", value: "§" },
      { kind: "word", value: "blockedword" },
      { kind: "phrase", value: "blocked phrase" },
    ] as const;
    writeProfile({ home, value: { ...VALID_PROFILE, slackMe: { voice: { exact: exactVoiceRules } } } });

    expect(unwrap(dripConfigFromProfile({ home })).exactVoiceRules).toEqual(exactVoiceRules);
  });
});
