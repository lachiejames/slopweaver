/**
 * The checks that run immediately before `turn answer`'s first Slack write. The live thread re-read needs a
 * Slack read token, which these cases deliberately do not have — the documented posture is a loud log and a
 * post that goes ahead, while every flag refusal still fires BEFORE any read is attempted.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { answerPreflight, threadDeltaAtSend } from "../../../../../cli/commands/turn/sendPreflight.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { Mention } from "../../../../../live/listen/mention.js";

const MENTION: Mention = {
  channel: "C1",
  messageTs: "1785000000.000100",
  surface: "channel",
  text: "what are my open PRs?",
  threadTs: "1785000000.000100",
  userId: "U0OWNER",
};
const NOW = "2026-10-02T01:00:00.000Z";
const TOKEN_NAMES = ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN"] as const;

const fixtureDirs: string[] = [];
const exported: Record<string, string | undefined> = {};

beforeEach(() => {
  // The resolver reads the environment before the home's secret files, so a machine with a token exported
  // would send these cases to Slack. Absent has to hold for the environment too, not just the temp home.
  for (const name of TOKEN_NAMES) {
    exported[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOKEN_NAMES) {
    const value = exported[name];
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home with no Slack token in it. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-send-preflight-"));
  fixtureDirs.push(home);
  return home;
}

/** A clean, fully-supported verdict, as the reviewing session writes it. */
const CLEAN_VERDICT = {
  answerDigest: `sha256:${"a".repeat(64)}`,
  authorSession: "author claude-code session a",
  claims: [
    { evidence: "the table in the answer", impact: "high", support: "supported", text: "the row count matches" },
  ],
  outcome: "clean",
  reviewerSession: "reviewer workspace workspace:1 (workspace-uuid)",
  schemaVersion: 1,
} as const;

describe("threadDeltaAtSend", () => {
  it("posts anyway when no Slack read token is configured — a configuration gap must not break every answer", async () => {
    const result = await threadDeltaAtSend({
      cleared: false,
      home: emptyHome(),
      mention: MENTION,
      nowIso: NOW,
      readThrough: undefined,
    });

    expect(unwrap(result)).toEqual({ kind: "post" });
  });

  it("posts anyway with a named `--read-through` too, since nothing could be re-read to contradict it", async () => {
    const result = await threadDeltaAtSend({
      accountedForTs: ["1785000050.000300"],
      cleared: true,
      home: emptyHome(),
      mention: MENTION,
      nowIso: NOW,
      readThrough: "1785000010.000200",
    });

    expect(unwrap(result)).toEqual({ kind: "post" });
  });
});

describe("answerPreflight", () => {
  it("passes with no verdict and no note when no flag is given and no thread could be re-read", async () => {
    const outcome = await answerPreflight({ home: emptyHome(), mention: MENTION, nowIso: NOW, values: {} });

    expect(outcome).toEqual({ freshnessNote: undefined, verdict: undefined });
  });

  it("refuses a malformed `--read-through` with a failure exit code, before any read", async () => {
    const outcome = await answerPreflight({
      home: emptyHome(),
      mention: MENTION,
      nowIso: NOW,
      values: { "read-through": "yesterday" },
    });

    expect(outcome).toEqual({ code: EXIT_ERROR });
  });

  it("refuses a malformed `--accounted-for-ts` with a failure exit code", async () => {
    const outcome = await answerPreflight({
      home: emptyHome(),
      mention: MENTION,
      nowIso: NOW,
      values: { "accounted-for-ts": "1785000050.000300,nope" },
    });

    expect(outcome).toEqual({ code: EXIT_ERROR });
  });

  it("refuses a `--verdict` naming a file that is not there", async () => {
    const home = emptyHome();

    const outcome = await answerPreflight({
      home,
      mention: MENTION,
      nowIso: NOW,
      values: { verdict: join(home, "no-such-verdict.json") },
    });

    expect(outcome).toEqual({ code: EXIT_ERROR });
  });

  it("refuses a `--verdict` file that is not JSON", async () => {
    const home = emptyHome();
    const verdictPath = join(home, "verdict.json");
    writeFileSync(verdictPath, "{ not json", "utf8");

    const outcome = await answerPreflight({ home, mention: MENTION, nowIso: NOW, values: { verdict: verdictPath } });

    expect(outcome).toEqual({ code: EXIT_ERROR });
  });

  it("carries a readable verdict through to the door", async () => {
    const home = emptyHome();
    const verdictPath = join(home, "verdict.json");
    writeFileSync(verdictPath, JSON.stringify(CLEAN_VERDICT), "utf8");

    const outcome = await answerPreflight({ home, mention: MENTION, nowIso: NOW, values: { verdict: verdictPath } });

    expect(outcome).toMatchObject({ freshnessNote: undefined, verdict: { outcome: "clean", schemaVersion: 1 } });
  });

  it("is not tripped by the boolean `--delta-cleared` flag when nothing moved", async () => {
    const outcome = await answerPreflight({
      home: emptyHome(),
      mention: MENTION,
      nowIso: NOW,
      values: { "delta-cleared": true },
    });

    expect(outcome).toEqual({ freshnessNote: undefined, verdict: undefined });
  });
});
