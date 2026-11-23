/**
 * The voice half of admitting a bot card: three answers, and only a rule that fired leaves a ledger row.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { aboveFoldVerdictFor } from "../../../../../cli/aboveFoldDoor.js";
import { unreadableProfileExit, voiceRefusalsOrWarned } from "../../../../../cli/commands/slack/voiceAdmission.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A temp state home whose profile.json holds `text` verbatim. */
function homeWithProfile({ text }: { text: string }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-voiceadmit-"));
  fixtureDirs.push(home);
  writeFileSync(join(home, "profile.json"), text, "utf8");
  return home;
}

/** A temp state home carrying one exact voice rule: the em dash. */
function emDashHome(): string {
  return homeWithProfile({
    text: JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackMe: { userId: "U_OWNER", voice: { exact: [{ kind: "literal", value: "—" }] } },
      sources: ["github"],
    }),
  });
}

/** The gate's read of one card cell, as `./runAdmit.ts` hands it over. */
function readFor({ home, text }: { home: string; text: string }): ReturnType<typeof aboveFoldVerdictFor> {
  return aboveFoldVerdictFor({
    belowFoldCells: [],
    cells: [{ path: "headline", text }],
    env: () => undefined,
    home,
    surface: "slack",
  });
}

describe("voiceRefusalsOrWarned", () => {
  it("stops a corrupt profile with its own message and writes no ledger", async () => {
    const home = homeWithProfile({ text: "{" });
    const read = readFor({ home, text: "Fast and safe." });
    const door = memoryDoorLedger();
    expect(await voiceRefusalsOrWarned({ dryRun: false, home, ledger: door.port, read })).toStrictEqual([
      unwrapErr(read).message,
    ]);
    expect(door.records()).toStrictEqual([]);
    expect(existsSync(stateHomePaths({ home }).ledgers)).toBe(false);
  });

  it("hands back a refusing verdict's refusals without recording them on a dry run", async () => {
    const home = emDashHome();
    const read = readFor({ home, text: "Fast — and safe." });
    const refusals = unwrap(read).refusals;
    const door = memoryDoorLedger();
    expect(refusals.length).toBe(1);
    expect(await voiceRefusalsOrWarned({ dryRun: true, home, ledger: door.port, read })).toStrictEqual(refusals);
    expect(door.records()).toStrictEqual([]);
  });

  it("records a refusing verdict in the door ledger when the send is live", async () => {
    const home = emDashHome();
    const read = readFor({ home, text: "Fast — and safe." });
    const door = memoryDoorLedger();
    expect(await voiceRefusalsOrWarned({ dryRun: false, home, ledger: door.port, read })).toStrictEqual(
      unwrap(read).refusals,
    );
    expect(door.records().length).toBe(1);
  });

  it("lets a card the rules pass through, with nothing recorded", async () => {
    const home = emDashHome();
    const read = readFor({ home, text: "Fast and safe." });
    const door = memoryDoorLedger();
    expect(await voiceRefusalsOrWarned({ dryRun: false, home, ledger: door.port, read })).toBe(undefined);
    expect(door.records()).toStrictEqual([]);
  });
});

describe("unreadableProfileExit", () => {
  it("stops the write with the error exit and leaves no ledger behind", () => {
    const home = homeWithProfile({ text: "{" });
    const error = unwrapErr(readExactVoiceRules({ home }));
    expect(error.code).toBe("PROFILE_UNREADABLE");
    expect(unreadableProfileExit({ error, nothingHappened: "nothing was posted." })).toBe(EXIT_ERROR);
    expect(existsSync(stateHomePaths({ home }).ledgers)).toBe(false);
  });
});
