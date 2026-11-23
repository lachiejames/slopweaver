/**
 * The permanent conversation-ignore registry's durability path: a real round-trip against a temp home,
 * because this function's whole job IS a filesystem effect — there is no pure core to extract it into and
 * test instead. The channel-keyed sibling of `ignoreStore.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import {
  appendIgnoredConversation,
  currentlyIgnoredConversations,
  ignoredConversationsPath,
  readIgnoredConversationsText,
} from "../../../../live/ask/ignoredConversationStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-ignore-conversation-"));
  fixtureDirs.push(dir);
  return dir;
}

const ENTRY: IgnoredConversation = {
  channel: "D0SYN000001",
  ignoredAtIso: "2026-08-31T22:40:00.000Z",
  kind: "ignore",
  reason: "the owner said every tag in their own DM is ignorable",
  schemaVersion: 1,
};

describe("ignoredConversationsPath", () => {
  it("resolves under live/slack/ignored-conversations.jsonl beneath the given home", () => {
    const home = tempHome();

    expect(ignoredConversationsPath({ home })).toBe(join(home, "live", "slack", "ignored-conversations.jsonl"));
  });
});

describe("appendIgnoredConversation / readIgnoredConversationsText", () => {
  it("creates the file and its parent directory when neither exists", () => {
    const home = tempHome();

    appendIgnoredConversation({ entry: ENTRY, home });

    expect(readIgnoredConversationsText({ home })).toBe(`${JSON.stringify(ENTRY)}\n`);
  });

  it("appends rather than overwrites — one JSONL line per call, in call order", () => {
    const home = tempHome();
    const second: IgnoredConversation = { ...ENTRY, channel: "C_OTHER" };

    appendIgnoredConversation({ entry: ENTRY, home });
    appendIgnoredConversation({ entry: second, home });

    expect(readIgnoredConversationsText({ home })).toBe(`${JSON.stringify(ENTRY)}\n${JSON.stringify(second)}\n`);
  });

  it("reads an absent registry as the empty string, not an error", () => {
    const home = tempHome();

    expect(readIgnoredConversationsText({ home })).toBe("");
  });
});

describe("currentlyIgnoredConversations", () => {
  it("survives a restart — a fresh read off disk still finds an entry an earlier process wrote", () => {
    const home = tempHome();

    appendIgnoredConversation({ entry: ENTRY, home });

    // A brand-new read, exactly what a fresh process does — nothing cached across this call.
    const ignored = currentlyIgnoredConversations({ home });
    expect(ignored.get(ENTRY.channel)).toEqual(ENTRY);
  });

  it("reads an absent registry as an empty map", () => {
    const home = tempHome();

    expect(currentlyIgnoredConversations({ home }).size).toBe(0);
  });
});
