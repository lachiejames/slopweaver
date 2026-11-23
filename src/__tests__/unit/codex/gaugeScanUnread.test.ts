/**
 * `scanCodexGauge` counts every place its walk of `sessions/` passed over — an unreadable rollout, a locked or
 * unsearchable day directory, a hard link it refuses, a directory or rollout outside Codex's layout — rather than
 * reporting an older reading as the current one. Over real throwaway homes, per testing.md's fixture allowance.
 * Split by scenario from the gauge tests, whose `gaugeRun/scanStoppingRollouts.test.ts` and
 * `gaugeRun/scanStoppingDayDirs.test.ts` keep the scan's stopping rule.
 */
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CodexGaugeScan, scanCodexGauge } from "../../../codex/gaugeScan.js";
import { REAL_WEEKLY_EXHAUSTED_LINE } from "../../codexRolloutLines.js";

const tempDirs: string[] = [];

/** A Codex home that exists and holds nothing. */
function emptyCodexHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-gauge-unread-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** The real weekly-exhausted line with its reset moved later, so a re-dated copy reads an OPEN window. */
const OPEN_WEEKLY_EXHAUSTED_LINE = REAL_WEEKLY_EXHAUSTED_LINE.replace("1784998696", "1790500000");

/** The scan instant the locked-directory and horizon cases share: before the fixture window's reset. */
const SCAN_NOW_SECONDS = 1_790_499_000;

/** The open weekly line re-dated to `observedIso`. */
function lineObservedAt({ observedIso }: { observedIso: string }): string {
  return OPEN_WEEKLY_EXHAUSTED_LINE.replace("2026-07-19T16:28:08.923Z", observedIso);
}

const OLDER = lineObservedAt({ observedIso: "2026-09-22T19:49:00.000Z" });
const NEWER = lineObservedAt({ observedIso: "2026-09-23T10:00:00.000Z" });

/** A Codex home with one day-directory of rollout files, newest first, one line each. */
function homeWithRollouts({ lines }: { lines: readonly string[] }): string {
  const home = emptyCodexHome();
  const dayDir = join(home, "sessions", "2026", "09", "23");
  mkdirSync(dayDir, { recursive: true });
  const newestSeconds = 1_790_000_000;
  lines.forEach((line, index) => {
    const path = join(dayDir, `rollout-${String(index).padStart(3, "0")}.jsonl`);
    writeFileSync(path, `${line}\n`, "utf8");
    utimesSync(path, newestSeconds - index, newestSeconds - index);
  });
  return home;
}

/** Scan a home holding one readable reading beside a locked day directory last modified at `lockedMtimeSeconds`. */
function scanBesideLockedDay({
  lockedMode = 0o000,
  lockedMtimeSeconds,
}: {
  lockedMode?: number;
  lockedMtimeSeconds: number;
}): CodexGaugeScan {
  const codexHome = homeWithRollouts({ lines: [OLDER] });
  const locked = join(codexHome, "sessions", "2026", "09", "24");
  mkdirSync(locked);
  writeFileSync(join(locked, "rollout-newer.jsonl"), `${OLDER}\n`, "utf8");
  utimesSync(locked, lockedMtimeSeconds, lockedMtimeSeconds);
  chmodSync(locked, lockedMode);
  try {
    return scanCodexGauge({ codexHome, nowMs: SCAN_NOW_SECONDS * 1000 });
  } finally {
    chmodSync(locked, 0o700);
  }
}

describe("scanCodexGauge counts a place it could not read rather than passing it over as empty", () => {
  it("counts a newer rollout file it cannot read rather than passing it over as empty", () => {
    const codexHome = homeWithRollouts({ lines: [NEWER, OLDER] });
    const newest = join(codexHome, "sessions", "2026", "09", "23", "rollout-000.jsonl");
    chmodSync(newest, 0o000);

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(2);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a session directory that will not list, whose files it never saw", () => {
    const scan = scanBesideLockedDay({ lockedMtimeSeconds: SCAN_NOW_SECONDS - 86_400 });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a locked session directory untouched for longer than the horizon, since a resumed session appends inside it", () => {
    const scan = scanBesideLockedDay({ lockedMtimeSeconds: SCAN_NOW_SECONDS - 9 * 86_400 });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a session directory that lists but cannot be searched, whose files no stat can reach", () => {
    const scan = scanBesideLockedDay({ lockedMode: 0o400, lockedMtimeSeconds: SCAN_NOW_SECONDS - 86_400 });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a hard-linked rollout it refuses to read, without reading it", () => {
    const codexHome = homeWithRollouts({ lines: [NEWER, OLDER] });
    const dayDir = join(codexHome, "sessions", "2026", "09", "23");
    linkSync(join(dayDir, "rollout-000.jsonl"), join(codexHome, "second-name.jsonl"));

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a directory nested inside a day directory, which it does not descend into, and not a stray non-rollout file", () => {
    const codexHome = homeWithRollouts({ lines: [OLDER] });
    const dayDir = join(codexHome, "sessions", "2026", "09", "23");
    const nested = join(dayDir, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "rollout-newer.jsonl"), `${NEWER}\n`, "utf8");
    writeFileSync(join(dayDir, "notes.txt"), "not a rollout\n", "utf8");

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("counts a rollout file sitting above the day directories, outside the layout it reads", () => {
    const codexHome = homeWithRollouts({ lines: [OLDER] });
    writeFileSync(join(codexHome, "sessions", "2026", "rollout-misplaced.jsonl"), `${NEWER}\n`, "utf8");

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("follows a symlinked sessions root, the walk's own starting point, rather than counting it as a passed-over link", () => {
    const codexHome = homeWithRollouts({ lines: [OLDER] });
    const moved = join(emptyCodexHome(), "sessions-on-another-volume");
    renameSync(join(codexHome, "sessions"), moved);
    symlinkSync(moved, join(codexHome, "sessions"));

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(0);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("treats a sessions root that is a regular file as a home with no sessions, not a place passed over", () => {
    const codexHome = emptyCodexHome();
    const sessions = join(codexHome, "sessions");
    writeFileSync(sessions, "not a directory\n", "utf8");
    chmodSync(sessions, 0o700);

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(0);
    expect(scan.filesRead).toBe(0);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge).toBeUndefined();
  });

  it("counts a sessions root it cannot reach through an unsearchable Codex home, rather than reading it as absent", () => {
    const codexHome = homeWithRollouts({ lines: [OLDER] });
    chmodSync(codexHome, 0o000);
    let scan: CodexGaugeScan;
    try {
      scan = scanCodexGauge({ codexHome });
    } finally {
      chmodSync(codexHome, 0o700);
    }

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(0);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge).toBeUndefined();
  });

  it("counts a symlink above the day directories whatever it points at, since telling means following it", () => {
    const codexHome = homeWithRollouts({ lines: [OLDER] });
    const target = join(codexHome, "target.txt");
    writeFileSync(target, "not a rollout\n", "utf8");
    symlinkSync(target, join(codexHome, "sessions", "2026", "notes"));

    const scan = scanCodexGauge({ codexHome });

    expect(scan.filesUnreadable).toBe(1);
    expect(scan.filesRead).toBe(1);
    expect(scan.filesSkipped).toBe(0);
    expect(scan.gauge!.observedAtIso).toBe("2026-09-22T19:49:00.000Z");
  });

  it("reads past the eight-day horizon while a file there was modified after the reading it would show", () => {
    const codexHome = emptyCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "27");
    mkdirSync(dayDir, { recursive: true });
    const rollouts = [
      { mtimeSeconds: 1_790_467_200, name: "a-newest", observedIso: "2026-09-10T00:00:00.000Z" },
      { mtimeSeconds: 1_789_689_600, name: "b-past-horizon-later-reading", observedIso: "2026-09-17T00:00:00.000Z" },
      { mtimeSeconds: 1_789_603_200, name: "c-modified-as-it-was-read", observedIso: "2026-09-16T00:00:00.000Z" },
      { mtimeSeconds: 1_789_516_800, name: "d-past-horizon-before-it", observedIso: "2026-09-15T00:00:00.000Z" },
    ];
    for (const { mtimeSeconds, name, observedIso } of rollouts) {
      const path = join(dayDir, `rollout-${name}.jsonl`);
      writeFileSync(path, `${lineObservedAt({ observedIso })}\n`, "utf8");
      utimesSync(path, mtimeSeconds, mtimeSeconds);
    }

    const scan = scanCodexGauge({ codexHome, nowMs: SCAN_NOW_SECONDS * 1000 });

    expect(scan.gauge!.observedAtIso).toBe("2026-09-17T00:00:00.000Z");
    expect(scan.filesRead).toBe(3);
    expect(scan.filesSkipped).toBe(1);
    expect(scan.filesUnreadable).toBe(0);
  });
});
