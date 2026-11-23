/**
 * `store backup --status`'s exit code: green only when bytes reached the destination on the last attempt, or when
 * nothing has ever run here, and red for a failed attempt, a last-attempt file that is not a record, or a night the
 * owner's protected paths now hold.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reportStatus } from "../../../../../cli/commands/store/backupProbes.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { destinationId } from "../../../../../store/backup/destinationConfig.js";
import { recordLastOutcome } from "../../../../../store/backup/lastOutcome.js";
import { NO_PROTECTION, type ReadBackupProtection } from "../../../../../store/backup/protectedPaths.js";
import { BackupProtectionErrors } from "../../../../../store/backup/protectedPathsErrors.js";
import { stagingRoot } from "../../../../../store/backup/staging.js";

const homes: string[] = [];

/** An empty registry, so no case reads the owner's own. */
const NOTHING_PROTECTED: ReadBackupProtection = () => ok(NO_PROTECTION);

/**
 * A throwaway home, removed after each test.
 *
 * @returns the home
 */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "backup-probes-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("reportStatus", () => {
  it("exits zero on an install that has never run a backup", () => {
    expect(reportStatus({ home: freshHome(), json: true, readProtection: NOTHING_PROTECTED })).toBe(EXIT_OK);
  });

  it("exits zero when the last attempt reached the destination", () => {
    const home = freshHome();
    recordGreen({ home });
    expect(reportStatus({ home, json: false, readProtection: NOTHING_PROTECTED })).toBe(EXIT_OK);
  });

  it("reads a green last attempt as held once the owner protects the staging root", () => {
    const home = freshHome();
    recordGreen({ home });
    const protectsStaging: ReadBackupProtection = () =>
      ok({
        entries: [
          { addedIso: "2026-11-01T00:00:00.000Z", mode: "no-access", path: stagingRoot({ home }), why: "fixture" },
        ],
      });
    expect(reportStatus({ home, json: false, readProtection: protectsStaging })).toBe(EXIT_ERROR);
  });

  it("reads a green last attempt as held once the owner protects a configured destination", () => {
    const home = freshHome();
    recordGreen({ home });
    const root = join(home, "destination");
    mkdirSync(root);
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(join(home, "secrets", "store-backup-directory"), `${root}\n`);
    expect(reportStatus({ home, json: false, readProtection: NOTHING_PROTECTED })).toBe(EXIT_OK);
    const protectsDestination: ReadBackupProtection = () =>
      ok({ entries: [{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path: root, why: "fixture" }] });
    expect(reportStatus({ home, json: false, readProtection: protectsDestination })).toBe(EXIT_ERROR);
  });

  it("reads as held when the registry does not parse", () => {
    const home = freshHome();
    recordGreen({ home });
    const malformed: ReadBackupProtection = () =>
      err(BackupProtectionErrors.malformed({ file: "/fixture/protected-paths.json", why: "fixture" }));
    expect(reportStatus({ home, json: true, readProtection: malformed })).toBe(EXIT_ERROR);
  });

  it("exits non-zero when the last attempt failed", () => {
    const home = freshHome();
    recordLastOutcome({
      home,
      outcome: { atIso: "2026-11-04T03:00:00.000Z", errors: ["destination unreachable"], status: "failed" },
    });
    expect(reportStatus({ home, json: false, readProtection: NOTHING_PROTECTED })).toBe(EXIT_ERROR);
  });

  it("exits non-zero when the last-attempt file is not a record", () => {
    const home = freshHome();
    mkdirSync(stagingRoot({ home }), { recursive: true });
    writeFileSync(join(stagingRoot({ home }), "last.json"), "not json");
    expect(reportStatus({ home, json: true, readProtection: NOTHING_PROTECTED })).toBe(EXIT_ERROR);
  });
});

/**
 * Record a last attempt that reached its one destination.
 *
 * @param home the throwaway home
 */
function recordGreen({ home }: { home: string }): void {
  recordLastOutcome({
    home,
    outcome: {
      atIso: "2026-11-04T03:00:00.000Z",
      destinations: [
        {
          id: destinationId({ root: "/backups" }),
          label: "this Mac",
          prefix: "slopweaver/2026-11-04T03-00-00-000Z/",
          root: "/backups",
          status: "succeeded",
        },
      ],
      directory: "/x",
      status: "destinations",
    },
  });
}
