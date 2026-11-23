/*
 * `startListening` refuses a listener no visible session owns before it announces, wires or connects anything,
 * and exits as a prerequisite absent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startListening } from "../../../../../../cli/commands/listen/runLoop.js";
import { EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { UNSCOPED } from "../../../../../../live/listen/scope.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../../../../../../supervisor/session.js";
import { ADMITS_U0HUMAN } from "./harness.js";

const SESSION_KEYS: readonly string[] = [CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV];
const saved = new Map<string, string | undefined>(SESSION_KEYS.map((key) => [key, process.env[key]]));
const homes: string[] = [];
const NO_CHANNELS: readonly string[] = [];

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A one-shot listener's options, every seam it would reach left unreachable behind the refusal. */
function oneShot({ follow, queuePath }: { follow: boolean; queuePath: string | undefined }) {
  const home = mkdtempSync(join(tmpdir(), "sw-start-listening-"));
  homes.push(home);
  return {
    allowMultipleConnections: false,
    appToken: "app-token-under-test",
    botToken: "bot-token-under-test",
    deadlineMs: undefined,
    emit: true,
    follow,
    heartbeatArmId: undefined,
    home,
    json: true,
    once: true,
    queuePath,
    responderHatchOpen: () => false,
    responderWhitelist: ADMITS_U0HUMAN,
    scope: UNSCOPED,
    threadReplyChannels: NO_CHANNELS,
    witness: undefined,
  };
}

describe("startListening", () => {
  it("refuses a one-shot listener with no visible session", async () => {
    for (const key of SESSION_KEYS) {
      delete process.env[key];
    }
    expect(await startListening(oneShot({ follow: false, queuePath: undefined }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("refuses even the durable follow-plus-queue shape when two hosts both claim the session", async () => {
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = "session-under-test";
    process.env[CODEX_THREAD_ID_ENV] = "thread-under-test";
    const home = mkdtempSync(join(tmpdir(), "sw-start-listening-queue-"));
    homes.push(home);
    expect(await startListening(oneShot({ follow: true, queuePath: join(home, "mentions.jsonl") }))).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });
});
