/**
 * The voice gate every door-routed Slack write shares: a corrupt profile is the failure, and a rule match is
 * recorded on the lane the actor names, unless the caller is a dry run.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { slackVoiceGateInput } from "../../../../../cli/commands/slack/voiceGateRead.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-voice-gate-read-"));
  fixtureDirs.push(dir);
  return dir;
}

// A test fixture, never the operator's own rule — those stay in `profile.json`.
const BANNED: readonly ExactVoiceRule[] = [{ kind: "literal", value: "leverage" }];
const PROSE = [{ path: "status_text", text: "we leverage the window" }];

describe("slackVoiceGateInput", () => {
  it("answers a CORRUPT profile as the failure, and records nothing", () => {
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const recorded: string[] = [];
    const read = slackVoiceGateInput({
      actor: "me",
      env: {},
      home,
      nowIso: "2026-09-28T00:00:00.000Z",
      prose: PROSE,
      record: true,
      recordVoicePainPoints: ({ lane }) => recorded.push(lane),
      voiceRules: readExactVoiceRules,
    });
    expect(unwrapErr(read).code).toBe("PROFILE_UNREADABLE");
    expect(recorded).toEqual([]);
  });

  it("records a match on the lane the actor names, and hands the door the rules and the prose", () => {
    const recorded: string[] = [];
    const input = unwrap(
      slackVoiceGateInput({
        actor: "me",
        env: {},
        home: freshHome(),
        nowIso: "2026-09-28T00:00:00.000Z",
        prose: PROSE,
        record: true,
        recordVoicePainPoints: ({ findings, lane }) => recorded.push(`${lane}:${findings[0]!.path}`),
        voiceRules: () => ok(BANNED),
      }),
    );
    expect(recorded).toEqual(["as-me:status_text"]);
    expect(input).toEqual({ allowVoiceRules: false, prose: PROSE, rules: BANNED });
  });

  it("records a bot write's match on the as-bot lane", () => {
    const recorded: string[] = [];
    slackVoiceGateInput({
      actor: "bot",
      env: {},
      home: freshHome(),
      nowIso: "2026-09-28T00:00:00.000Z",
      prose: PROSE,
      record: true,
      recordVoicePainPoints: ({ lane }) => recorded.push(lane),
      voiceRules: () => ok(BANNED),
    });
    expect(recorded).toEqual(["as-bot"]);
  });

  it("records nothing for a dry run, which still gets the same gate input", () => {
    const recorded: string[] = [];
    const input = unwrap(
      slackVoiceGateInput({
        actor: "me",
        env: {},
        home: freshHome(),
        nowIso: "2026-09-28T00:00:00.000Z",
        prose: PROSE,
        record: false,
        recordVoicePainPoints: ({ lane }) => recorded.push(lane),
        voiceRules: () => ok(BANNED),
      }),
    );
    expect(recorded).toEqual([]);
    expect(input.rules).toEqual(BANNED);
  });
});
