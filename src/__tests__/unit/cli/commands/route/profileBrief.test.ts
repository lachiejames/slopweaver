/** `route profile-brief` scans real temp-fixture sources into a real pinned brief. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRouteProfileBriefArgs,
  routeProfileBriefCommand,
  runRouteProfileBrief,
} from "../../../../../cli/commands/route/profileBrief.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { routeManifest } from "../../../../../cli/manifests/route.js";
import { readJudgementMiningBrief } from "../../../../../judgement/miningStore.js";
import { JUDGEMENT_SELECTION_CONTRACT } from "../../../../../judgement/sourceSelection.js";
import { sha256Text } from "../../../../../lib/hash.js";
import { unwrapErr } from "../../../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-brief-home-"));
  fixtureDirs.push(dir);
  return dir;
}

function freshSourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-brief-source-"));
  fixtureDirs.push(root);
  writeFileSync(join(root, "note.md"), "first-person writing for the brief", "utf8");
  return root;
}

function writeSourcesManifest({ label, root }: { label: string; root: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-route-profile-brief-manifest-"));
  fixtureDirs.push(dir);
  const path = join(dir, "sources.json");
  writeFileSync(path, JSON.stringify([{ label, path: root }]), "utf8");
  return path;
}

describe("route profile-brief", () => {
  it("parses the required --sources flag", () => {
    expect(parseRouteProfileBriefArgs({ rest: ["--sources", "/tmp/sources.json", "--json"] }).isOk()).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseRouteProfileBriefArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", () => {
    expect(
      runRouteProfileBrief(["node", "slopweaver", "route", "profile-brief", "--sources", "/tmp/sources.json"]),
    ).toBe(EXIT_USAGE);
  });

  it("fails loudly when the sources manifest cannot be read", () => {
    expect(
      runRouteProfileBrief([
        "node",
        "slopweaver",
        "route",
        "profile-brief",
        "--sources",
        "/definitely/missing/sources.json",
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("scans a real source root and pins a real brief", () => {
    const home = freshHome();
    const sourcesPath = writeSourcesManifest({ label: "test-source", root: freshSourceRoot() });
    const exit = runRouteProfileBrief([
      "node",
      "slopweaver",
      "route",
      "profile-brief",
      "--sources",
      sourcesPath,
      "--home",
      home,
      "--json",
    ]);
    expect(exit).toBe(EXIT_OK);
    const brief = readJudgementMiningBrief({ home })!;
    const text = "first-person writing for the brief";
    expect(brief.sourceManifest).toEqual([
      {
        contentHash: sha256Text({ text }),
        coverage: {
          budgetSkippedFiles: 0,
          candidateChars: text.length,
          candidateFiles: 1,
          contract: JUDGEMENT_SELECTION_CONTRACT,
          selectedChars: text.length,
          selectedFiles: 1,
          strata: [{ candidateFiles: 1, selectedFiles: 1, stratum: "." }],
          truncatedFiles: 0,
        },
        fileCount: 1,
        label: "test-source",
        selected: [
          {
            candidateChars: text.length,
            contentHash: sha256Text({ text }),
            relativePath: "note.md",
            selectedChars: text.length,
            truncated: false,
          },
        ],
      },
    ]);
  });

  it("refuses a source it cannot read rather than pinning a brief without it", () => {
    const home = freshHome();
    const root = freshSourceRoot();
    const locked = join(root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    // Unlocked and removed before its parent, so the parent's recursive removal can read it.
    fixtureDirs.unshift(locked);
    const sourcesPath = writeSourcesManifest({ label: "test-source", root });
    const exit = runRouteProfileBrief([
      "node",
      "slopweaver",
      "route",
      "profile-brief",
      "--sources",
      sourcesPath,
      "--home",
      home,
      "--json",
    ]);
    expect(exit).toBe(EXIT_ERROR);
    expect(readJudgementMiningBrief({ home })).toBeUndefined();
  });

  it("exposes the manifest-selected command as a local-state write", () => {
    expect(routeProfileBriefCommand).toBe(runRouteProfileBrief);
    expect(routeManifest["profile-brief"]?.meta.effect).toBe("local-state");
  });
});
