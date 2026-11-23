/**
 * The Vault leg's pure framing: the export statement's encoding, the import's one-transaction commands, the CSV
 * row count, and the judges that refuse undecryptable rows and a count that did not come back. The docker half is
 * proven on a throwaway stack, never here.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  countCsvRows,
  judgeVaultCount,
  judgeVaultRows,
  restoreVault,
  VAULT_EXPORT_STATEMENT,
  vaultImportCommands,
} from "../../../store/backup/vault.js";
import { VaultErrors } from "../../../store/backup/vaultErrors.js";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("restoreVault's scratch", () => {
  it("clears what a killed restore left in the backup directory, even when the backup sealed no rows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "vault-scratch-"));
    minted.push(directory);
    const stale = join(directory, ".vault-restore.partial");
    mkdirSync(stale);
    writeFileSync(join(stale, "vault.csv"), "YWxwaGE=,,c2VjcmV0\n");
    writeFileSync(join(stale, ".partial-vault.csv-0000"), "c2VjcmV0\n");
    const restored = await restoreVault({
      artefact: { bytes: 0, keyFingerprint: "0000000000000000", rows: 0, sha256: "0".repeat(64) },
      container: "never-reached",
      database: "never-reached",
      directory,
      key: Buffer.alloc(32, 1),
    });
    expect(restored.isOk()).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("VAULT_EXPORT_STATEMENT", () => {
  it("reads the decrypted view, base64 per field with line breaks removed, oldest first, as CSV", () => {
    expect(VAULT_EXPORT_STATEMENT).toBe(
      "copy (select " +
        "translate(encode(convert_to(name, 'UTF8'), 'base64'), E'\\n', ''), " +
        "translate(encode(convert_to(description, 'UTF8'), 'base64'), E'\\n', ''), " +
        "translate(encode(convert_to(decrypted_secret, 'UTF8'), 'base64'), E'\\n', '') " +
        "from vault.decrypted_secrets order by created_at, id) to stdout with (format csv)",
    );
  });
});

describe("vaultImportCommands", () => {
  const commands = vaultImportCommands();

  it("opens a transaction, guards an empty target and stages a temp table in the first command", () => {
    expect(commands.length).toBe(3);
    expect(
      commands[0]!.startsWith(
        "begin isolation level read committed; create extension if not exists supabase_vault cascade;",
      ),
    ).toBe(true);
    expect(commands[0]).toContain(
      "supabase_vault cascade; lock table vault.secrets in share row exclusive mode; do $$ begin if exists (select 1 from vault.secrets) then raise exception",
    );
    expect(commands[0]).toContain(
      "create temp table vault_import (name text, description text, secret text) on commit drop;",
    );
  });

  it("reads the CSV from psql's own stdin, then creates each secret and commits in the last command", () => {
    expect(commands[1]).toBe("\\copy vault_import from pstdin with (format csv)");
    expect(commands[2]).toBe(
      "select count(vault.create_secret(" +
        "convert_from(decode(secret, 'base64'), 'UTF8'), " +
        "convert_from(decode(name, 'base64'), 'UTF8'), " +
        "convert_from(decode(description, 'base64'), 'UTF8'))) from vault_import; commit;",
    );
  });
});

describe("countCsvRows", () => {
  it.each([
    ["an empty export", "", 0],
    ["one row with a null name", ',"",c2VjcmV0\n', 1],
    ["three rows", 'YQ==,Yg==,Yw==\nZA==,ZQ==,Zg==\n,"",Zw==\n', 3],
  ])("counts %s", (_label, text, rows) => {
    expect(countCsvRows({ bytes: Buffer.from(text) })).toBe(rows);
  });
});

describe("judgeVaultRows", () => {
  it("returns the row count when every row opens", () => {
    expect(unwrap(judgeVaultRows({ out: "0,4\n" }))).toBe(4);
    expect(unwrap(judgeVaultRows({ out: "0,0" }))).toBe(0);
  });

  it("refuses when any row's plaintext is missing", () => {
    expect(unwrapErr(judgeVaultRows({ out: "2,5" }))).toEqual(VaultErrors.undecryptable({ rows: 2 }));
  });

  it("names output that is not two counts", () => {
    const refused = unwrapErr(judgeVaultRows({ out: "ERROR" }));
    expect(refused.code).toBe("VAULT_STEP_FAILED");
    expect(refused.message).toBe('the Vault leg could not count secrets: unreadable counts "ERROR"');
  });
});

describe("judgeVaultCount", () => {
  it("accepts the recorded count", () => {
    expect(unwrap(judgeVaultCount({ expected: 3, out: "3\n" }))).toBe(undefined);
  });

  it("refuses a different or missing count", () => {
    expect(unwrapErr(judgeVaultCount({ expected: 3, out: "2" }))).toEqual(
      VaultErrors.countMismatch({ expected: 3, found: "2" }),
    );
    expect(unwrapErr(judgeVaultCount({ expected: 3, out: "" })).message).toBe(
      'the Vault leg expected 3 secret(s) and found ""',
    );
  });
});

describe("VaultErrors.stepFailed", () => {
  it("quotes a typed cause's own message rather than printing an object", () => {
    const typed = VaultErrors.countMismatch({ expected: 1, found: "0" });
    expect(VaultErrors.stepFailed({ cause: typed, step: "import the Vault" }).message).toBe(
      'the Vault leg could not import the Vault: the Vault leg expected 1 secret(s) and found "0"',
    );
    expect(VaultErrors.stepFailed({ cause: new Error("boom"), step: "x" }).message).toBe(
      "the Vault leg could not x: boom",
    );
  });
});
