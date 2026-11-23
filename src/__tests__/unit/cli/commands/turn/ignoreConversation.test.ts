/**
 * `slopweaver turn ignore-conversation` — permanently ignoring (or un-ignoring, or listing) every tag in one
 * whole conversation. Every case here is a real temp-home round trip rather than an injected fake, the same
 * posture `ignore.test.ts` takes for its exact-ask sibling.
 *
 * A temp home has no captured ask and no bot token, so every add case below takes the "nothing was ever
 * raised" settling path and stays a pure local-state round trip.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseTurnIgnoreConversationArgs,
  runTurnIgnoreConversation,
  turnIgnoreConversationCommand,
} from "../../../../../cli/commands/turn/ignoreConversation.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { currentlyIgnoredConversations } from "../../../../../live/ask/ignoredConversationStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-ignore-conversation-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("parseTurnIgnoreConversationArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "ignore-conversation", "--channel", "C1"];
    const parsed = parseTurnIgnoreConversationArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnIgnoreConversationArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
    ]);
  });
});

describe("runTurnIgnoreConversation — add", () => {
  it("refuses with a usage code when every required flag is absent, before any effect", async () => {
    const home = tempHome();
    await expect(
      runTurnIgnoreConversation(["node", "slopweaver", "turn", "ignore-conversation", "--home", home]),
    ).resolves.toBe(EXIT_USAGE);
    expect(currentlyIgnoredConversations({ home }).size).toBe(0);
  });

  it("refuses with a usage code when only SOME required flags are given", async () => {
    const home = tempHome();
    await expect(
      runTurnIgnoreConversation([
        "node",
        "slopweaver",
        "turn",
        "ignore-conversation",
        "--channel",
        "C1",
        "--home",
        home,
      ]),
    ).resolves.toBe(EXIT_USAGE);
    expect(currentlyIgnoredConversations({ home }).size).toBe(0);
  });

  it("appends a real entry an entrance check can read straight back", async () => {
    const home = tempHome();
    const code = await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--channel",
      "D0SYN000001",
      "--reason",
      "every tag here is ignorable",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    const ignored = currentlyIgnoredConversations({ home });
    expect(ignored.size).toBe(1);
    const entry = ignored.get("D0SYN000001")!;
    expect(entry.channel).toBe("D0SYN000001");
    expect(entry.kind).toBe("ignore");
    expect(entry.reason).toBe("every tag here is ignorable");
  });

  it("is idempotent — repeating the same channel does not grow the registry beyond its own latest entry", async () => {
    const home = tempHome();
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--channel",
      "C1",
      "--reason",
      "n/a",
      "--home",
      home,
    ];
    await runTurnIgnoreConversation(argv);
    await runTurnIgnoreConversation(argv);
    expect(currentlyIgnoredConversations({ home }).size).toBe(1);
  });
});

describe("runTurnIgnoreConversation — remove", () => {
  it("lifts a standing suppression — the channel reads as no longer ignored", async () => {
    const home = tempHome();
    await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--channel",
      "C1",
      "--reason",
      "blanket suppression",
      "--home",
      home,
    ]);

    const code = await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--channel",
      "C1",
      "--reason",
      "was too broad",
      "--remove",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    const entry = currentlyIgnoredConversations({ home }).get("C1")!;
    expect(entry.kind).toBe("unignore");
  });
});

describe("runTurnIgnoreConversation — list", () => {
  it("reports no conversation ignored when the registry is empty", async () => {
    const home = tempHome();
    const code = await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--list",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
  });

  it("lists an ignored channel and exits OK", async () => {
    const home = tempHome();
    await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--channel",
      "C1",
      "--reason",
      "n/a",
      "--home",
      home,
    ]);

    const code = await runTurnIgnoreConversation([
      "node",
      "slopweaver",
      "turn",
      "ignore-conversation",
      "--list",
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_OK);
  });
});

describe("turn manifest — ignore-conversation", () => {
  it("declares ignore-conversation as an external write through the door, because it settles posted cards", () => {
    expect(turnManifest["ignore-conversation"]!.meta.effect).toBe("external-write");
    expect(turnManifest["ignore-conversation"]!.meta.doorRouted).toBe(true);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnIgnoreConversationCommand).toBe(runTurnIgnoreConversation);
  });
});
