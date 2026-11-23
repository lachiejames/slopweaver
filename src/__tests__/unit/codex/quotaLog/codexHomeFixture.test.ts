/*
 * `findLatestRolloutPath` and `readLatestCodexQuotaEvidence` over a real temp `CODEX_HOME`: the rollout file a
 * day-directory tree holds, and the last matching line read out of it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestRolloutPath, readLatestCodexQuotaEvidence } from "../../../../codex/quotaLog.js";
import { CREDITS_OUT_LINE, HEALTHY_LINE, tempCodexHome, useTempCodexHomes } from "./harness.js";

function writeRollout({
  codexHome,
  dayPath,
  name,
  content,
}: {
  codexHome: string;
  dayPath: string;
  name: string;
  content: string;
}): void {
  const dir = join(codexHome, "sessions", dayPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf8");
}

useTempCodexHomes();

describe("findLatestRolloutPath (real temp CODEX_HOME fixture)", () => {
  it("returns undefined when the sessions directory does not exist", () => {
    expect(findLatestRolloutPath({ codexHome: tempCodexHome() })).toBeUndefined();
  });

  it("finds the one rollout file across a real day-directory tree", () => {
    const codexHome = tempCodexHome();
    writeRollout({ codexHome, content: `${HEALTHY_LINE}\n`, dayPath: "2026/08/14", name: "rollout-a.jsonl" });

    expect(findLatestRolloutPath({ codexHome })).toBe(
      join(codexHome, "sessions", "2026", "08", "14", "rollout-a.jsonl"),
    );
  });
});

describe("readLatestCodexQuotaEvidence (real temp CODEX_HOME fixture)", () => {
  it("returns undefined when no rollout file exists yet", () => {
    expect(readLatestCodexQuotaEvidence({ codexHome: tempCodexHome() })).toBeUndefined();
  });

  it("reads the last matching line in the only rollout file present", () => {
    const codexHome = tempCodexHome();
    const content = [HEALTHY_LINE, CREDITS_OUT_LINE].join("\n");
    writeRollout({ codexHome, content, dayPath: "2026/08/14", name: "rollout-only.jsonl" });

    expect(readLatestCodexQuotaEvidence({ codexHome })).toEqual({
      kind: "credits-out",
      observedAtIso: "2026-08-14T04:01:14.586Z",
    });
  });

  it("returns undefined when the only rollout file carries no matching line", () => {
    const codexHome = tempCodexHome();
    writeRollout({ codexHome, content: `${HEALTHY_LINE}\n`, dayPath: "2026/08/14", name: "rollout-healthy.jsonl" });

    expect(readLatestCodexQuotaEvidence({ codexHome })).toBeUndefined();
  });
});
