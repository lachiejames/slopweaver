/**
 * The backup verbs' shell on the paths that reach no Docker and no destination: `--help`, the parsers, the
 * refusal that carries a hatch, and the recipe row. The rendered lines and the sweep outcome are in
 * `backupVerbsLines.test.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runStoreBackup, runStoreBackupRegister } from "../../../cli/commands/store/backup.js";
import {
  BACKUP_RECIPE_ID,
  BACKUP_SWEEP_RECIPE_ID,
  backupRecipeDefinition,
  backupSweepRecipeDefinition,
  DEFAULT_BACKUP_CADENCE,
  parseStoreBackupArgs,
  parseStoreBackupRegisterArgs,
  parseStoreRestoreArgs,
} from "../../../cli/commands/store/backupCore.js";
import { runStoreRestore } from "../../../cli/commands/store/restoreRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseRecipeDefinition } from "../../../live/automation/definition.js";
import { planVerbRun } from "../../../live/automation/verbRun.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("--help touches nothing", () => {
  it("prints usage for all three verbs", async () => {
    expect(await runStoreBackup(["node", "cli", "store", "backup", "--help"])).toBe(EXIT_OK);
    expect(await runStoreRestore(["node", "cli", "store", "restore", "--help"])).toBe(EXIT_OK);
    expect(runStoreBackupRegister(["node", "cli", "store", "backup-register", "--help"])).toBe(EXIT_OK);
  });
});

/** The one refusal for two modes at once. */
const MODES_REFUSAL =
  "--check, --status, --local-only, --sweep-only, --create-key, --create-master-password, " +
  "--copy-master-password, --set-destination, --add-destination and --remove-destination are separate " +
  "modes — pass at most one";

describe("parseStoreBackupArgs", () => {
  it("defaults to a full backup keeping one local copy", () => {
    expect(unwrap(parseStoreBackupArgs({ rest: [] }))).toEqual({
      check: false,
      copyMasterPassword: false,
      createKey: false,
      createMasterPassword: false,
      destination: null,
      destinationChange: null,
      json: false,
      keepLocal: 1,
      localOnly: false,
      status: false,
      sweepOnly: false,
    });
  });

  it("reads each list change as its own mode, refused beside another mode or beside --destination", () => {
    expect(
      unwrap(parseStoreBackupArgs({ rest: ["--set-destination", "/Volumes/T7/backups"] })).destinationChange,
    ).toEqual({ address: "/Volumes/T7/backups", change: "set" });
    expect(unwrap(parseStoreBackupArgs({ rest: ["--add-destination", "/a"] })).destinationChange).toEqual({
      address: "/a",
      change: "add",
    });
    expect(unwrap(parseStoreBackupArgs({ rest: ["--remove-destination", "/a"] })).destinationChange).toEqual({
      address: "/a",
      change: "remove",
    });
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--set-destination", "/x", "--sweep-only"] }))).toEqual([
      MODES_REFUSAL,
    ]);
    expect(
      unwrapErr(parseStoreBackupArgs({ rest: ["--add-destination", "/x", "--remove-destination", "/y"] })),
    ).toEqual([MODES_REFUSAL]);
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--add-destination", "/x", "--destination", "/y"] }))).toEqual([
      "--add-destination changes the remembered list; --destination replaces it for a run — pass one of them",
    ]);
  });

  it("reads --sweep-only as its own mode", () => {
    expect(unwrap(parseStoreBackupArgs({ rest: ["--sweep-only", "--keep-local", "2"] })).sweepOnly).toBe(true);
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--sweep-only", "--local-only"] }))).toEqual([MODES_REFUSAL]);
  });

  it("reads --create-key as its own mode, refusing it beside any other", () => {
    const parsed = unwrap(parseStoreBackupArgs({ rest: ["--create-key"] }));
    expect(parsed.createKey).toBe(true);
    expect(parsed.check).toBe(false);
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--create-key", "--check"] }))).toEqual([MODES_REFUSAL]);
  });

  it("reads --create-master-password and --copy-master-password as modes of their own", () => {
    expect(unwrap(parseStoreBackupArgs({ rest: ["--create-master-password"] })).createMasterPassword).toBe(true);
    expect(unwrap(parseStoreBackupArgs({ rest: ["--copy-master-password"] })).copyMasterPassword).toBe(true);
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--create-master-password", "--copy-master-password"] }))).toEqual([
      MODES_REFUSAL,
    ]);
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--create-master-password", "--create-key"] }))).toEqual([
      MODES_REFUSAL,
    ]);
  });

  it("carries --destination over the remembered one, alongside a mode", () => {
    const parsed = unwrap(parseStoreBackupArgs({ rest: ["--destination", "/Volumes/backup", "--check"] }));
    expect(parsed.destination).toBe("/Volumes/backup");
    expect(parsed.check).toBe(true);
  });

  it("refuses two modes at once", () => {
    const result = parseStoreBackupArgs({ rest: ["--check", "--status"] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([MODES_REFUSAL]);
  });

  it("refuses a non-numeric --keep-local", () => {
    expect(unwrapErr(parseStoreBackupArgs({ rest: ["--keep-local", "many"] }))).toEqual([
      '--keep-local takes a whole number, not "many"',
    ]);
  });
});

describe("parseStoreRestoreArgs", () => {
  it("needs --from and a plain database name for --into", () => {
    const result = parseStoreRestoreArgs({ rest: [] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      "--from <staging directory | <destination>/<project>/<instant>> is required",
      "--into <database> is required — the database the restore creates",
    ]);
    expect(parseStoreRestoreArgs({ rest: ["--from", "/x", "--into", "Bad-Name"] }).isErr()).toBe(true);
  });

  it("refuses --storage without its hatch, printing the four-line refusal", () => {
    const result = parseStoreRestoreArgs({ rest: ["--from", "/x", "--into", "proof", "--storage"] });
    expect(result.isErr()).toBe(true);
    const lines = unwrapErr(result);
    expect(lines[0]).toContain("slopweaver store restore --storage blocked because");
    expect(lines[2]).toContain("--overwrite-storage");
  });

  it("accepts --storage with --overwrite-storage", () => {
    expect(
      unwrap(
        parseStoreRestoreArgs({
          rest: ["--from", "/x", "--into", "proof", "--storage", "--overwrite-storage", "--compare"],
        }),
      ),
    ).toEqual({
      compare: true,
      dropAfter: false,
      from: "/x",
      into: "proof",
      json: false,
      storage: true,
    });
  });

  it("exits usage from the verb itself", async () => {
    expect(await runStoreRestore(["node", "cli", "store", "restore", "--into", "proof"])).toBe(EXIT_USAGE);
  });
});

describe("the daily recipe row", () => {
  it("defaults to 03:00 local and refuses a cadence that is not five fields", () => {
    expect(unwrap(parseStoreBackupRegisterArgs({ rest: [] })).cadence).toBe(DEFAULT_BACKUP_CADENCE);
    expect(parseStoreBackupRegisterArgs({ rest: ["--cadence", "daily"] }).isErr()).toBe(true);
  });

  it("is a verb-run row the definition store parses and the executor routes to store backup", () => {
    const definition = unwrap(
      parseRecipeDefinition({ value: backupRecipeDefinition({ cadence: DEFAULT_BACKUP_CADENCE }) }),
    );
    expect(definition.recipeId).toBe(BACKUP_RECIPE_ID);
    const plan = unwrap(planVerbRun({ definition }));
    expect(plan.noun).toBe("store");
    expect(plan.verb).toBe("backup");
    expect(plan.verbEffect).toBe("external-write");
  });

  it("writes the row under the home's definitions directory", () => {
    const home = mkdtempSync(join(tmpdir(), "store-backup-register-"));
    homes.push(home);
    expect(
      runStoreBackupRegister(["node", "cli", "store", "backup-register", "--home", home, "--cadence", "30 2 * * *"]),
    ).toBe(EXIT_OK);
    const written = JSON.parse(
      readFileSync(join(home, "live", "recipe", "definitions", `${BACKUP_RECIPE_ID}.json`), "utf8"),
    ) as { cadence: string };
    expect(written.cadence).toBe("30 2 * * *");
  });

  it("keeps a hold standing on the row when it re-registers, rather than writing a fresh row over it", () => {
    const home = mkdtempSync(join(tmpdir(), "store-backup-register-"));
    homes.push(home);
    const argv = ["node", "cli", "store", "backup-register", "--home", home];
    const path = join(home, "live", "recipe", "definitions", `${BACKUP_RECIPE_ID}.json`);
    expect(runStoreBackupRegister(argv)).toBe(EXIT_OK);
    const hold = { askedIso: "2026-09-29T15:37:06.542Z", clearedBy: null, finding: "a-finding", reason: "failed" };
    const first = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...first, hold }));

    expect(runStoreBackupRegister([...argv, "--cadence", "30 2 * * *"])).toBe(EXIT_OK);
    const written = JSON.parse(readFileSync(path, "utf8")) as { cadence: string; hold: unknown };
    expect(written.cadence).toBe("30 2 * * *");
    expect(written.hold).toEqual(hold);
  });
});

describe("the hourly sweep row", () => {
  it("is a verb-run row the executor routes to store backup --sweep-only, at half past, skipping missed hours", () => {
    const definition = unwrap(parseRecipeDefinition({ value: backupSweepRecipeDefinition() }));
    expect(definition.recipeId).toBe(BACKUP_SWEEP_RECIPE_ID);
    expect(definition.cadence).toBe("30 * * * *");
    expect(definition.onMissed).toBe("skip");
    const plan = unwrap(planVerbRun({ definition }));
    expect(plan.noun).toBe("store");
    expect(plan.verb).toBe("backup");
    expect(plan.verbEffect).toBe("external-write");
    expect(plan.argv).toEqual(["store", "backup", "--sweep-only"]);
  });

  it("is written beside the daily row by backup-register, its cadence untouched by --cadence", () => {
    const home = mkdtempSync(join(tmpdir(), "store-backup-register-"));
    homes.push(home);
    expect(
      runStoreBackupRegister(["node", "cli", "store", "backup-register", "--home", home, "--cadence", "30 2 * * *"]),
    ).toBe(EXIT_OK);
    const directory = join(home, "live", "recipe", "definitions");
    const daily = JSON.parse(readFileSync(join(directory, `${BACKUP_RECIPE_ID}.json`), "utf8")) as {
      cadence: string;
    };
    const sweep = JSON.parse(readFileSync(join(directory, `${BACKUP_SWEEP_RECIPE_ID}.json`), "utf8")) as {
      cadence: string;
      params: { argv: readonly string[] };
    };
    expect(daily.cadence).toBe("30 2 * * *");
    expect(sweep.cadence).toBe("30 * * * *");
    expect(sweep.params.argv).toEqual(["store", "backup", "--sweep-only"]);
  });

  it("keeps a hold standing on the sweep row when it re-registers", () => {
    const home = mkdtempSync(join(tmpdir(), "store-backup-register-"));
    homes.push(home);
    const argv = ["node", "cli", "store", "backup-register", "--home", home];
    const path = join(home, "live", "recipe", "definitions", `${BACKUP_SWEEP_RECIPE_ID}.json`);
    expect(runStoreBackupRegister(argv)).toBe(EXIT_OK);
    const hold = { askedIso: "2026-11-07T15:37:06.542Z", clearedBy: null, finding: "a-finding", reason: "failed" };
    const first = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...first, hold }));

    expect(runStoreBackupRegister(argv)).toBe(EXIT_OK);
    const written = JSON.parse(readFileSync(path, "utf8")) as { hold: unknown };
    expect(written.hold).toEqual(hold);
  });
});
