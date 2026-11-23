/** `pane pr-status` — the one-shot JSON wrapper around `collectPrStatus`. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  panePrStatusCommand,
  parsePanePrStatusArgs,
  runPanePrStatus,
} from "../../../../../cli/commands/pane/prStatus.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { paneManifest } from "../../../../../cli/manifests/pane.js";
import { unwrapErr } from "../../../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory that is not a git repository at all. */
function freshNonGitDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-pane-pr-status-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("pane pr-status", () => {
  it("parses --pr-repos and --json", () => {
    expect(parsePanePrStatusArgs({ rest: ["--pr-repos", "owner/name", "--json"] }).isOk()).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parsePanePrStatusArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", () => {
    expect(runPanePrStatus(["node", "slopweaver", "pane", "pr-status", "--pr-repos", "owner/name"])).toBe(EXIT_USAGE);
  });

  it("refuses when no --pr-repos is given and --repo names a directory with no git origin", () => {
    const repo = freshNonGitDir();
    expect(runPanePrStatus(["node", "slopweaver", "pane", "pr-status", "--repo", repo, "--json"])).toBe(EXIT_ERROR);
  });

  it("refuses a malformed --pr-repos value", () => {
    expect(
      runPanePrStatus(["node", "slopweaver", "pane", "pr-status", "--pr-repos", "not-a-valid-spec!!", "--json"]),
    ).toBe(EXIT_ERROR);
  });

  it("exposes the manifest-selected command as an external read", () => {
    expect(panePrStatusCommand).toBe(runPanePrStatus);
    expect(paneManifest["pr-status"]?.meta.effect).toBe("external-read");
  });
});
