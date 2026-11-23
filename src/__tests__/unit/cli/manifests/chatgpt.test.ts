/**
 * The `chatgpt` noun's manifest, checked for what its rows claim: five local-state verbs and one read no door routes,
 * quoting the usage leaf rather than the command modules the manifest must never load.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHATGPT_CONVERSATION_USAGE,
  CHATGPT_IMPORT_EXPORT_USAGE,
  CHATGPT_IMPORT_REQUEST_USAGE,
  CHATGPT_LIST_USAGE,
  CHATGPT_LIVE_SYNC_USAGE,
  CHATGPT_SYNC_USAGE,
} from "../../../../cli/commands/chatgpt/usage.js";
import { chatgptManifest } from "../../../../cli/manifests/chatgpt.js";

/** The manifest's own source, read so the eager-import property is checked on what ships. */
const MANIFEST_SOURCE = readFileSync(join(import.meta.dirname, "../../../../cli/manifests/chatgpt.ts"), "utf8");

describe("chatgptManifest", () => {
  it("declares exactly the conversation, import-export, import-request, live-sync, list and sync verbs", () => {
    expect(Object.keys(chatgptManifest)).toEqual([
      "conversation",
      "import-export",
      "import-request",
      "live-sync",
      "list",
      "sync",
    ]);
  });

  it("declares list a read that writes nothing and every other verb a local-state write, none door-routed", () => {
    const entries = Object.values(chatgptManifest);
    expect(entries.length).toBe(6);
    expect(entries.map((entry) => entry.meta.effect)).toEqual([
      "local-state",
      "local-state",
      "local-state",
      "local-state",
      "external-read",
      "local-state",
    ]);
    expect(entries.filter((entry) => entry.meta.doorRouted)).toEqual([]);
  });

  it("marks the export verbs not dry-parse safe, because a bare run looks in Downloads and refreshes", () => {
    expect(chatgptManifest["import-export"]!.meta.dryParseSafe).toBe(false);
    expect(chatgptManifest["sync"]!.meta.dryParseSafe).toBe(false);
    expect(chatgptManifest["sync"]!.meta.parseRejectIsIoFree).toBe(true);
  });

  it("marks live-sync not dry-parse safe, because a bare run reaches the account and writes the live copy", () => {
    expect(chatgptManifest["live-sync"]!.meta.dryParseSafe).toBe(false);
    expect(chatgptManifest["live-sync"]!.meta.parseRejectIsIoFree).toBe(true);
  });

  it("quotes the usage leaf itself, so the manifest and --help cannot drift", () => {
    expect(chatgptManifest["conversation"]!.meta.usage).toBe(CHATGPT_CONVERSATION_USAGE);
    expect(chatgptManifest["import-export"]!.meta.usage).toBe(CHATGPT_IMPORT_EXPORT_USAGE);
    expect(chatgptManifest["import-request"]!.meta.usage).toBe(CHATGPT_IMPORT_REQUEST_USAGE);
    expect(chatgptManifest["sync"]!.meta.usage).toBe(CHATGPT_SYNC_USAGE);
    expect(chatgptManifest["list"]!.meta.usage).toBe(CHATGPT_LIST_USAGE);
    expect(chatgptManifest["live-sync"]!.meta.usage).toBe(CHATGPT_LIVE_SYNC_USAGE);
  });

  it("imports its usage from the leaf and never from a command module", () => {
    expect(MANIFEST_SOURCE).toContain('from "../commands/chatgpt/usage.js"');
    expect(MANIFEST_SOURCE).not.toContain('from "../commands/chatgpt/run.js"');
    expect(MANIFEST_SOURCE).not.toContain('from "../commands/chatgpt/exportRun.js"');
  });
});
