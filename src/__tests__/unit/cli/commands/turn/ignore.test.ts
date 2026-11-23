/**
 * `slopweaver turn ignore` — permanently ignoring one exact ask. Every case here is a real temp-home round
 * trip rather than an injected fake.
 *
 * The verb also SETTLES the indicators of an ask that was already captured — a temp home has no captured
 * ask and no bot token, so every case below takes the "nothing was ever raised" path and stays a pure
 * local-state round trip. What that settling plans and applies is
 * `live/turn/convergesLifecycleReact/ignoreAfterCapture.test.ts`'s subject.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseTurnIgnoreArgs, runTurnIgnore, turnIgnoreCommand } from "../../../../../cli/commands/turn/ignore.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { currentlyIgnoredAsks, readIgnoredAsksText } from "../../../../../live/ask/ignoreStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-ignore-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("parseTurnIgnoreArgs", () => {
  it("does not mistake its own verb token for a stray argument", () => {
    const argv = ["node", "slopweaver", "turn", "ignore", "--channel", "C1", "--message-ts", "1.1"];
    const parsed = parseTurnIgnoreArgs({ rest: argv.slice(4) });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : ["not parsed"]).toEqual([]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnIgnoreArgs({ rest: ["--not-a-flag", "x"] }))).toEqual([
      "unknown flag: --not-a-flag",
      "unexpected argument: x",
    ]);
  });
});

describe("runTurnIgnore", () => {
  it("refuses with a usage code when every required flag is absent, before any effect", async () => {
    const home = tempHome();
    await expect(runTurnIgnore(["node", "slopweaver", "turn", "ignore", "--home", home])).resolves.toBe(EXIT_USAGE);
    expect(currentlyIgnoredAsks({ home }).size).toBe(0);
  });

  it("refuses with a usage code when only SOME required flags are given", async () => {
    const home = tempHome();
    await expect(
      runTurnIgnore(["node", "slopweaver", "turn", "ignore", "--channel", "C1", "--home", home]),
    ).resolves.toBe(EXIT_USAGE);
    expect(currentlyIgnoredAsks({ home }).size).toBe(0);
  });

  it("appends a real entry an entrance check can read straight back", async () => {
    const home = tempHome();
    const code = await runTurnIgnore([
      "node",
      "slopweaver",
      "turn",
      "ignore",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--reason",
      "already resolved elsewhere",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    const ignored = currentlyIgnoredAsks({ home });
    expect(ignored.size).toBe(1);
    const entry = [...ignored.values()][0]!;
    expect(entry.channel).toBe("C1");
    expect(entry.messageTs).toBe("1.1");
    expect(entry.reason).toBe("already resolved elsewhere");
  });

  it("is idempotent — repeating the same ask does not grow the registry", async () => {
    const home = tempHome();
    const argv = [
      "node",
      "slopweaver",
      "turn",
      "ignore",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--reason",
      "n/a",
      "--home",
      home,
    ];
    await runTurnIgnore(argv);
    await runTurnIgnore(argv);
    expect(currentlyIgnoredAsks({ home }).size).toBe(1);
  });

  it("--remove lifts an ignored ask so every entrance reads it normally again", async () => {
    const home = tempHome();
    const argv = ["node", "slopweaver", "turn", "ignore", "--channel", "C1", "--message-ts", "1.1", "--home", home];
    await runTurnIgnore([...argv, "--reason", "mistaken ignore"]);

    const code = await runTurnIgnore([...argv, "--reason", "the owner wants this answered", "--remove"]);

    expect(code).toBe(EXIT_OK);
    expect(currentlyIgnoredAsks({ home }).size).toBe(0);
    expect(readIgnoredAsksText({ home }).trim().split("\n").length).toBe(2);
  });

  it("--remove on an ask that is not ignored writes nothing and exits expected-empty", async () => {
    const home = tempHome();
    const code = await runTurnIgnore([
      "node",
      "slopweaver",
      "turn",
      "ignore",
      "--channel",
      "C1",
      "--message-ts",
      "1.1",
      "--reason",
      "n/a",
      "--remove",
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(readIgnoredAsksText({ home })).toBe("");
  });
});

describe("turn manifest — ignore", () => {
  /**
   * It USED to declare `local-state`/no door, and that stopped being true when ignoring became a real
   * terminal: settling an already-captured ask's checklist card edits a posted Slack message through the
   * real door, exactly as `dispatch`'s `no-response` cleanup does.
   */
  it("declares ignore as an external write through the door, because it settles a posted card", () => {
    expect(turnManifest["ignore"]!.meta.effect).toBe("external-write");
    expect(turnManifest["ignore"]!.meta.doorRouted).toBe(true);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnIgnoreCommand).toBe(runTurnIgnore);
  });
});
