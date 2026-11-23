/**
 * The mining checkpoint's filesystem edge: read/write round-trip, absence, corruption, and that the
 * directory/file are tightened to owner-only on every write.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { JUDGEMENT_MINING_BRIEF_VERSION, JUDGEMENT_MINING_PROMPT_FINGERPRINT } from "../../../judgement/miningBrief.js";
import {
  readJudgementMiningBrief,
  readJudgementMiningCache,
  writeJudgementMiningBrief,
  writeJudgementMiningCache,
} from "../../../judgement/miningStore.js";
import { JUDGEMENT_SELECTION_CONTRACT } from "../../../judgement/sourceSelection.js";
import { stateHomePaths } from "../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-judgement-mining-cache-"));
  fixtureDirs.push(home);
  return home;
}

function modeOf({ path }: { path: string }): string {
  return (statSync(path).mode & 0o777).toString(8);
}

const ENTRY = {
  acceptedAt: "2026-08-11T00:00:00.000Z",
  manifestHash: `sha256:${"a".repeat(64)}`,
  promptFingerprint: "judgement-mining-v1",
};

describe("readJudgementMiningCache / writeJudgementMiningCache", () => {
  it("returns undefined when nothing has been written yet", () => {
    const home = freshHome();
    expect(readJudgementMiningCache({ home })).toBeUndefined();
  });

  it("round-trips a written entry", () => {
    const home = freshHome();
    writeJudgementMiningCache({ entry: ENTRY, home });
    expect(readJudgementMiningCache({ home })).toEqual(ENTRY);
  });

  it("returns undefined for corrupt JSON rather than throwing", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.miningCacheJson, "not json", "utf8");
    expect(readJudgementMiningCache({ home })).toBeUndefined();
  });

  it("returns undefined for a malformed but valid JSON value", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.miningCacheJson, JSON.stringify({ wrong: "shape" }), "utf8");
    expect(readJudgementMiningCache({ home })).toBeUndefined();
  });

  it("writes the directory and file at 0700/0600", () => {
    const home = freshHome();
    writeJudgementMiningCache({ entry: ENTRY, home });
    const paths = stateHomePaths({ home });
    expect(modeOf({ path: paths.judgement.root })).toBe("700");
    expect(modeOf({ path: paths.judgement.miningCacheJson })).toBe("600");
  });
});

const BRIEF = {
  heldOutSourceHashes: [],
  manifestHash: `sha256:${"a".repeat(64)}`,
  prompt: { system: "system text", user: "user text" },
  promptFingerprint: JUDGEMENT_MINING_PROMPT_FINGERPRINT,
  sourceManifest: [
    {
      contentHash: `sha256:${"b".repeat(64)}`,
      coverage: {
        budgetSkippedFiles: 3,
        candidateChars: 900,
        candidateFiles: 5,
        contract: JUDGEMENT_SELECTION_CONTRACT,
        selectedChars: 302,
        selectedFiles: 2,
        strata: [{ candidateFiles: 5, selectedFiles: 2, stratum: "." }],
        truncatedFiles: 0,
      },
      fileCount: 2,
      label: "test-source",
      selected: [
        {
          candidateChars: 150,
          contentHash: `sha256:${"c".repeat(64)}`,
          relativePath: "a.md",
          selectedChars: 150,
          truncated: false,
        },
        {
          candidateChars: 150,
          contentHash: `sha256:${"d".repeat(64)}`,
          relativePath: "b.md",
          selectedChars: 150,
          truncated: false,
        },
      ],
    },
  ],
  version: JUDGEMENT_MINING_BRIEF_VERSION,
};

/** Write a raw brief value where the store reads it. */
function writeRawBrief({ home, value }: { home: string; value: unknown }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.judgement.root, { recursive: true });
  writeFileSync(paths.judgement.miningBriefJson, JSON.stringify(value), "utf8");
}

describe("readJudgementMiningBrief / writeJudgementMiningBrief", () => {
  it("returns undefined when nothing has been written yet", () => {
    const home = freshHome();
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("round-trips a written brief", () => {
    const home = freshHome();
    writeJudgementMiningBrief({ brief: BRIEF, home });
    expect(readJudgementMiningBrief({ home })).toEqual(BRIEF);
  });

  it("returns undefined for corrupt JSON rather than throwing", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.miningBriefJson, "not json", "utf8");
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("returns undefined for a malformed but valid JSON value", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(paths.judgement.miningBriefJson, JSON.stringify({ wrong: "shape" }), "utf8");
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("reads a brief from another version as its envelope alone, so acceptance can refuse it by name", () => {
    const home = freshHome();
    const v1 = {
      ...BRIEF,
      promptFingerprint: "judgement-mining-v1",
      sourceManifest: [{ contentHash: `sha256:${"b".repeat(64)}`, fileCount: 2, label: "test-source" }],
      version: 1,
    };
    writeRawBrief({ home, value: v1 });
    expect(readJudgementMiningBrief({ home })).toEqual({ ...v1, sourceManifest: [] });
  });

  it("refuses a current-version brief whole when one manifest row is malformed", () => {
    const home = freshHome();
    const row = BRIEF.sourceManifest[0]!;
    writeRawBrief({ home, value: { ...BRIEF, sourceManifest: [row, { ...row, coverage: { contract: "x" } }] } });
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("refuses a count edited to negative zero, a distinct value no scan writes", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    const text = JSON.stringify(BRIEF).replace('"truncatedFiles":0', '"truncatedFiles":-0');
    expect(text).toContain('"truncatedFiles":-0');
    writeFileSync(paths.judgement.miningBriefJson, text, "utf8");
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it.each(['"fileCount":2.0', '"fileCount":2e0'])(
    "reads %s as the same brief, since a respelling of one value is the same manifest",
    (respelled) => {
      const home = freshHome();
      const paths = stateHomePaths({ home });
      mkdirSync(paths.judgement.root, { recursive: true });
      const text = JSON.stringify(BRIEF).replace('"fileCount":2', respelled);
      expect(text).toContain(respelled);
      writeFileSync(paths.judgement.miningBriefJson, text, "utf8");
      expect(readJudgementMiningBrief({ home })).toEqual(BRIEF);
    },
  );

  it("refuses a brief carrying a non-string held-out hash rather than dropping it", () => {
    const home = freshHome();
    writeRawBrief({ home, value: { ...BRIEF, heldOutSourceHashes: ["sha256:x", 7] } });
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("writes the directory and file at 0700/0600", () => {
    const home = freshHome();
    writeJudgementMiningBrief({ brief: BRIEF, home });
    const paths = stateHomePaths({ home });
    expect(modeOf({ path: paths.judgement.root })).toBe("700");
    expect(modeOf({ path: paths.judgement.miningBriefJson })).toBe("600");
  });
});
