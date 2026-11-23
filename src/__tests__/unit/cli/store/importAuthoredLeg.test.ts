/**
 * The `authored` leg of `store import-fleet`, run dry over a real temp home: it reads only the directories
 * classified authored, refuses a body carrying a credential by name, and states its binary coverage.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { absenceOutweighsWalk, absenceWithheldBecause } from "../../../../cli/commands/store/importAuthoredAbsence.js";
import { runAuthoredLeg, unclassifiedNotes } from "../../../../cli/commands/store/importAuthoredLeg.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "authored-leg-"));
  homes.push(home);
  return home;
}

/** Write one file under the home, making its directory. */
function put({ home, path, bytes }: { home: string; path: string; bytes: Buffer }): void {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, bytes);
}

describe("runAuthoredLeg, dry", () => {
  it("projects the authored directories only, refuses a credential by name, and writes nothing", async () => {
    const home = freshHome();
    const token = `ghp_${"a".repeat(36)}`;
    put({ bytes: Buffer.from("a brief\n"), home, path: "briefs/a.md" });
    put({ bytes: Buffer.from([0, 1, 2, 3]), home, path: "artifacts/shot.bin" });
    put({ bytes: Buffer.from(`export T=${token}\n`), home, path: "judgement/leak.md" });
    put({ bytes: Buffer.from(token), home, path: "secrets/github-token" });

    const outcome = await runAuthoredLeg({ client: undefined, home });

    expect(outcome).toEqual({
      absentSource: undefined,
      leg: "authored",
      notes: [
        "3 authored director(ies), 12 byte(s) read",
        "1 binary file(s) scanned as raw bytes, 0 of them git bundles also scanned object by object — a secret inside an image's compressed data is not seen",
        "retention: not reconciled — a dry run opens no store connection",
      ],
      projected: 2,
      refused: [
        FleetImportErrors.unstorableAuthoredFile({
          path: "judgement/leak.md",
          reason: "line 1 trips the github-oauth-token secret class, and the store's dump leaves this machine",
        }),
      ],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("reads handover-evidence at any depth and refuses the one settings backup carrying a Slack token", async () => {
    const home = freshHome();
    const slackToken = `xoxb-${"1".repeat(12)}-${"a".repeat(24)}`;
    put({ bytes: Buffer.from("{}\n"), home, path: "handover-evidence/ruling-backfill-39.json" });
    put({ bytes: Buffer.from('{"k":1}\n'), home, path: "handover-evidence/backfill-proof.x/before/runs/r/a.jsonl" });
    put({
      bytes: Buffer.from(`{"SLACK_BOT_TOKEN": "${slackToken}"}\n`),
      home,
      path: "handover-evidence/backfill-proof.x/before/runs/r/settings.json.before",
    });

    const outcome = await runAuthoredLeg({ client: undefined, home });

    expect(outcome.projected).toBe(2);
    expect(outcome.written).toBe(0);
    expect(outcome.refused).toEqual([
      FleetImportErrors.unstorableAuthoredFile({
        path: "handover-evidence/backfill-proof.x/before/runs/r/settings.json.before",
        reason: "line 1 trips the slack-token secret class, and the store's dump leaves this machine",
      }),
    ]);
  });

  it("reads nothing from a home with no authored directory", async () => {
    const home = freshHome();
    put({ bytes: Buffer.from("x"), home, path: "secrets/github-token" });

    const outcome = await runAuthoredLeg({ client: undefined, home });

    expect(outcome.projected).toBe(0);
    expect(outcome.refused).toEqual([]);
    expect(outcome.notes).toEqual([
      "0 authored director(ies), 0 byte(s) read",
      "0 binary file(s) scanned as raw bytes, 0 of them git bundles also scanned object by object — a secret inside an image's compressed data is not seen",
      "retention: not reconciled — a dry run opens no store connection",
    ]);
  });

  it("plans the auto-memory mirror without writing it, and names the corpus it would carry", async () => {
    const home = freshHome();
    const projects = freshHome();
    const still = new Date("2026-09-01T00:00:00.000Z");
    put({ bytes: Buffer.from("- [a](a.md)\n"), home: projects, path: "-u-repo/memory/MEMORY.md" });
    utimesSync(join(projects, "-u-repo/memory/MEMORY.md"), still, still);

    const outcome = await runAuthoredLeg({
      claudeProjects: projects,
      client: undefined,
      home,
      now: still.getTime() + 3_600_000,
    });

    expect(outcome.refused).toEqual([]);
    expect(outcome.notes).toContain(
      "1 Claude auto-memory corpus(es) mirrored into claude-memory: 1 file(s) would be written, 0 would be removed, 0 replaced version(s) would be kept in an attic",
    );
    expect(existsSync(join(home, "claude-memory"))).toBe(false);
  });
});

describe("runAuthoredLeg over live/", () => {
  it("projects the turn state, leaves the provider copies, and names an entry nobody classified", async () => {
    const home = freshHome();
    put({ bytes: Buffer.from("{}\n"), home, path: "live/slack/asks.jsonl" });
    put({ bytes: Buffer.from("{}"), home, path: "live/slack/turn-markers/C1-1.json" });
    put({ bytes: Buffer.from("png"), home, path: "live/slack/thread-files/F1/a.png" });
    put({ bytes: Buffer.from("x"), home, path: "live/slack/new-kind.jsonl" });

    const outcome = await runAuthoredLeg({ client: undefined, home });

    expect(outcome.projected).toBe(2);
    expect(outcome.refused).toEqual([]);
    expect(outcome.notes!.at(-1)).toBe(
      "1 unclassified entr(ies) under a split directory, not read until authoredDirectories.ts names them: live/slack/new-kind.jsonl",
    );
  });
});

describe("absenceWithheldBecause", () => {
  it("allows the rewrite only for a whole walk of the store's own home after a clean write", () => {
    expect(absenceWithheldBecause({ ownSelection: true, unreadable: 0, writeFailed: false })).toBe(undefined);
  });

  it("withholds it when the write failed, a directory would not read, or the environment chose the store", () => {
    expect(absenceWithheldBecause({ ownSelection: true, unreadable: 0, writeFailed: true })).toBe(
      "absent paths not recorded — the write failed",
    );
    expect(absenceWithheldBecause({ ownSelection: true, unreadable: 2, writeFailed: false })).toBe(
      "absent paths not recorded — 2 director(ies) would not read, so the walk is not the whole home",
    );
    expect(absenceWithheldBecause({ ownSelection: false, unreadable: 0, writeFailed: false })).toBe(
      "absent paths not recorded — the store was not selected by this home's own secrets/store-url, so its paths are not known to come from this home",
    );
  });
});

describe("absenceOutweighsWalk", () => {
  it("records deletions that are a share of the home, and refuses a set larger than the walk", () => {
    expect(absenceOutweighsWalk({ absent: 22, listed: 17_945 })).toBe(undefined);
    expect(absenceOutweighsWalk({ absent: 3, listed: 3 })).toBe(undefined);
    expect(absenceOutweighsWalk({ absent: 17_945, listed: 2 })).toBe(
      "absent paths not recorded — 17945 stored path(s) missing against 2 on disk reads as another home, not deletions",
    );
  });
});

describe("unclassifiedNotes", () => {
  it("says nothing when every entry is classified", () => {
    expect(unclassifiedNotes({ unclassified: [] })).toEqual([]);
  });
});
