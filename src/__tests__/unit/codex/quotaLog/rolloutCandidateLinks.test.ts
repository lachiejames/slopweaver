/*
 * A rollout candidate is a regular file with exactly one name: a symlink or a hard link planted beside the real
 * rollout, pointing at a credential file, is skipped.
 */
import { linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestRolloutPath, rolloutFilesIn } from "../../../../codex/quotaLog.js";
import { REAL_HEALTHY_WEEKLY_LINE } from "../../../codexRolloutLines.js";
import { tempCodexHome, useTempCodexHomes } from "./harness.js";

useTempCodexHomes();

describe("a rollout candidate is only ever a REGULAR file", () => {
  // A Codex review's reach: a `rollout-*.jsonl` symlinked at `auth.json` is read line by line, and
  // `JSON.parse` assembles the API key into an object before the event shape is checked. Codex writes these
  // files itself, so nothing legitimate here is a link and refusing the class closes the path outright.
  it("skips a symlink pointing at a credential file, and finds the real rollout beside it", () => {
    const codexHome = tempCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "13");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(codexHome, "auth.json"), '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-synthetic"}', "utf8");
    symlinkSync(join(codexHome, "auth.json"), join(dayDir, "rollout-linked.jsonl"));
    writeFileSync(join(dayDir, "rollout-real.jsonl"), `${REAL_HEALTHY_WEEKLY_LINE}\n`, "utf8");

    expect(rolloutFilesIn({ dayDir }).map((candidate) => candidate.path)).toEqual([join(dayDir, "rollout-real.jsonl")]);
  });

  it("finds nothing at all when the only candidate is a symlink", () => {
    const codexHome = tempCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "13");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(codexHome, "auth.json"), '{"OPENAI_API_KEY":"sk-synthetic"}', "utf8");
    symlinkSync(join(codexHome, "auth.json"), join(dayDir, "rollout-linked.jsonl"));

    expect(rolloutFilesIn({ dayDir })).toEqual([]);
    expect(findLatestRolloutPath({ codexHome })).toBeUndefined();
  });
});

describe("a rollout candidate has exactly ONE name", () => {
  // The hard-link round of the same finding: `isFile()` is satisfied by a hard link, which reaches the same
  // inode with no link to detect. A file Codex wrote has one name, so a second one means something else put
  // it there.
  it("skips a HARD LINK to a credential file, and finds the real rollout beside it", () => {
    const codexHome = tempCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "13");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(codexHome, "auth.json"), '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-synthetic"}', "utf8");
    linkSync(join(codexHome, "auth.json"), join(dayDir, "rollout-hardlinked.jsonl"));
    writeFileSync(join(dayDir, "rollout-real.jsonl"), `${REAL_HEALTHY_WEEKLY_LINE}\n`, "utf8");

    expect(rolloutFilesIn({ dayDir }).map((candidate) => candidate.path)).toEqual([join(dayDir, "rollout-real.jsonl")]);
  });

  it("finds nothing when the only candidate is a hard link", () => {
    const codexHome = tempCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "13");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(codexHome, "auth.json"), '{"OPENAI_API_KEY":"sk-synthetic"}', "utf8");
    linkSync(join(codexHome, "auth.json"), join(dayDir, "rollout-hardlinked.jsonl"));

    expect(rolloutFilesIn({ dayDir })).toEqual([]);
  });

  it("still accepts an ordinary rollout file, which has one name", () => {
    const codexHome = tempCodexHome();
    const dayDir = join(codexHome, "sessions", "2026", "09", "13");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, "rollout-plain.jsonl"), `${REAL_HEALTHY_WEEKLY_LINE}\n`, "utf8");

    expect(rolloutFilesIn({ dayDir }).length).toBe(1);
  });
});
