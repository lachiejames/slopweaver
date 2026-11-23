/*
 * `rolloutsModifiedWithin` — where the modification window is anchored: at now, or at the newest file when every
 * file is older than now.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rolloutsModifiedWithin } from "../../../../codex/quotaLog.js";

describe("rolloutsModifiedWithin", () => {
  /** A Codex home with one rollout per entry, each in its named day-directory at its own mtime. */
  function homeWith({ files }: { files: readonly { day: string; mtimeSeconds: number }[] }): string {
    const home = mkdtempSync(join(tmpdir(), "rollouts-within-"));
    files.forEach(({ day, mtimeSeconds }) => {
      const dayDir = join(home, "sessions", "2026", "09", day);
      mkdirSync(dayDir, { recursive: true });
      const path = join(dayDir, "rollout-000.jsonl");
      writeFileSync(path, "{}\n", "utf8");
      utimesSync(path, mtimeSeconds, mtimeSeconds);
    });
    return home;
  }

  it("anchors the window at NOW, not at a file stamped in the future, so a current file is still returned", () => {
    const nowSeconds = 1_790_000_000;
    const home = homeWith({
      files: [
        { day: "21", mtimeSeconds: nowSeconds - 3_600 },
        { day: "22", mtimeSeconds: nowSeconds + 9 * 86_400 },
      ],
    });
    try {
      const within = rolloutsModifiedWithin({ codexHome: home, nowMs: nowSeconds * 1000, windowMs: 8 * 86_400_000 });
      expect(within.map((candidate) => candidate.path.split("/").at(-2))).toEqual(["22", "21"]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("anchors at the newest file when it is older than now, so an idle home still reports its last state", () => {
    const nowSeconds = 1_790_000_000;
    const home = homeWith({
      files: [
        { day: "01", mtimeSeconds: nowSeconds - 30 * 86_400 },
        { day: "02", mtimeSeconds: nowSeconds - 40 * 86_400 },
      ],
    });
    try {
      const within = rolloutsModifiedWithin({ codexHome: home, nowMs: nowSeconds * 1000, windowMs: 8 * 86_400_000 });
      expect(within.map((candidate) => candidate.path.split("/").at(-2))).toEqual(["01"]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
