/*
 * `threadDeltaAtSend`'s one branch testable without a Slack transport: with no read token configured it posts.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mentionFromBrief, threadDeltaAtSend } from "../../../../../../cli/commands/turn/run.js";
import { unwrap } from "../../../../../../lib/result.js";
import { BRIEF, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * `threadDeltaAtSend` itself opens a real Slack transport for anything past the token check, so only the
 * "no read token configured" branch is testable here — the same boundary this file draws everywhere else in
 * this suite (effectful Slack calls are proven live, not faked). The DECISION it returns is pure and is
 * covered exhaustively in `unit/live/turn/threadFreshness.test.ts`.
 */
describe("threadDeltaAtSend", () => {
  it("posts — returns an empty delta — when no Slack read token is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-freshness-"));
    fixtureDirs.push(home);

    const delta = await threadDeltaAtSend({
      cleared: false,
      home,
      mention: mentionFromBrief({ brief: BRIEF }),
      nowIso: "2026-09-15T03:17:29.508Z",
      readThrough: undefined,
    });

    expect(delta.isOk()).toBe(true);
    expect(unwrap(delta)).toEqual({ kind: "post" });
  });
});
