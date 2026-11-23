/**
 * `supervisor tick open`'s bump-drive selection over a real temp home: the store's own drive rows, judged by their
 * own cadence, decide which landing repositories the tick drives itself (a row absent from the store
 * once left nine bumps unpressed for a day).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tickBumpDriveSelection } from "../../../../../cli/commands/supervisor/tickBumpDrive.js";
import { teamStandingRows } from "../../../../../live/automation/teamStandingRows.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-10-30T01:30:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tick-bump-drive-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Store one drive row for `acme/widgets`, shaped exactly as the build declares one. */
function storeDriveRow({
  enabled = true,
  argv = ["github", "bump-drive", "--repo", "acme/widgets"],
  cadence,
}: { enabled?: boolean; argv?: readonly string[]; cadence?: string } = {}): void {
  const declared = teamStandingRows({ repository: "acme/widgets" }).find((row) =>
    row.definition.recipeId.startsWith("bump-drive-"),
  )!;
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  const definition = {
    ...declared.definition,
    ...(cadence === undefined ? {} : { cadence }),
    enabled,
    params: { argv },
    recipeId: "bump-drive-widgets",
  };
  writeFileSync(join(dir, "bump-drive-widgets.json"), JSON.stringify(definition));
}

/** Stamp the drive row's last run with the given watermark. */
function storeRun({ watermarkIso }: { watermarkIso: string }): void {
  const run = { exitCode: 0, lastRunAtIso: watermarkIso, watermarkIso };
  writeFileSync(
    stateHomePaths({ home }).live.recipe.definitionRunsJson,
    JSON.stringify({ runs: { "bump-drive-widgets": run }, schemaVersion: 1 }),
  );
}

describe("tickBumpDriveSelection", () => {
  it("drives a landing repository the store holds no drive row for — the measured defect", () => {
    const selection = tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW });

    expect(selection.repos).toEqual(["acme/widgets"]);
    expect(selection.lines).toEqual([
      "bump-drive acme/widgets: driven by this tick — no bump-drive row is stored for it",
    ]);
  });

  it("drives a repository whose row ran at this instant and so is between firings", () => {
    storeDriveRow();
    storeRun({ watermarkIso: NOW });

    expect(tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW }).repos).toEqual([
      "acme/widgets",
    ]);
  });

  it("leaves a row that has never run — so is DUE — to the automation pass", () => {
    storeDriveRow();

    const selection = tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW });

    expect(selection.repos).toEqual([]);
    expect(selection.lines).toEqual([
      "bump-drive acme/widgets: not driven by this tick — bump-drive-widgets is due, so the automation pass fires it",
    ]);
  });

  it("respects a disabled row", () => {
    storeDriveRow({ enabled: false });
    storeRun({ watermarkIso: NOW });

    expect(tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW }).lines).toEqual([
      "bump-drive acme/widgets: not driven by this tick — bump-drive-widgets is disabled",
    ]);
  });

  it("drives a repository whose stored row has a cadence the calculus refuses, which never fires", () => {
    storeDriveRow({ cadence: "not-a-cron" });

    const selection = tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW });

    expect(selection.repos).toEqual(["acme/widgets"]);
    expect(selection.lines[0]!).toContain("bump-drive-widgets's cadence was refused (");
  });

  it("is not stopped by a stored row with `--dry-run`, which is a worklist rather than a drive", () => {
    storeDriveRow({ argv: ["github", "bump-drive", "--repo", "acme/widgets", "--dry-run"] });

    expect(tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW }).repos).toEqual([
      "acme/widgets",
    ]);
  });

  it("judges every stored drive row due when the runs file will not parse, and says why", () => {
    storeDriveRow();
    writeFileSync(stateHomePaths({ home }).live.recipe.definitionRunsJson, "{ torn");

    const selection = tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW });

    expect(selection.repos).toEqual([]);
    expect(selection.lines[0]!).toContain("every stored drive row is judged never run, so due");
  });

  it("drives nothing when a stored drive-row file cannot be read, since it may be a disabled row", () => {
    const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bump-drive-widgets.json"), "{ torn");

    expect(tickBumpDriveSelection({ home, landingRepos: ["acme/widgets"], nowIso: NOW })).toEqual({
      lines: [
        "bump-drive: driving no repository — bump-drive-widgets.json could not be read, so its repository and state are unknown",
      ],
      repos: [],
    });
  });

  it("reads nothing and drives nothing when the seat lands no repository", () => {
    expect(tickBumpDriveSelection({ home, landingRepos: [], nowIso: NOW })).toEqual({ lines: [], repos: [] });
  });
});
