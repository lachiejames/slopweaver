/**
 * The backup directory's typed failures print exactly what the `readonly string[]` they replaced printed: one
 * line per manifest issue, digest disagreement or foreign step line, and the message otherwise.
 */
import { describe, expect, it } from "vitest";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";

describe("backupErrorLines", () => {
  it("gives each schema issue of a refused manifest its own line", () => {
    const reasons = ["version: Invalid input", "dump.sha256: Invalid string"];
    expect(backupErrorLines({ error: BackupErrors.manifestInvalid({ manifest: "backup", reasons }) })).toEqual(reasons);
  });

  it("keeps a files mismatch's summary first and every difference after it", () => {
    expect(
      backupErrorLines({
        error: BackupErrors.filesMismatched({
          differences: ["a: digest differs"],
          manifest: "files.json",
          restored: 2,
        }),
      }),
    ).toEqual(["1 of 2 restored file(s) do not match files.json", "a: digest differs"]);
  });

  it("gives a foreign step's lines back unchanged", () => {
    const reasons = ["no credential", "no bucket"];
    expect(backupErrorLines({ error: BackupErrors.stepFailed({ reasons }) })).toEqual(reasons);
  });

  it("gives a single-message variant its message", () => {
    expect(backupErrorLines({ error: BackupErrors.databaseNameInvalid({ name: "Proof" }) })).toEqual([
      '"Proof" is not a database name this verb will create — lower-case letters, digits and _ only',
    ]);
  });
});

describe("BackupErrors", () => {
  it("names an exited command's status and what it said", () => {
    expect(BackupErrors.commandExited({ label: "pg_dump db", status: 1, stderr: "no such database" }).message).toBe(
      "pg_dump db exited 1: no such database",
    );
  });

  it("says nothing after the status when the command said nothing", () => {
    expect(BackupErrors.commandExited({ label: "createdb x", status: 2, stderr: "" }).message).toBe(
      "createdb x exited 2",
    );
  });
});
