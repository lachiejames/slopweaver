import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveVantaCommandCredentials } from "../../../../atlas/vanta/credentialFiles.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { writeSecretFile } from "../../../../secrets/store.js";
import { secretFilePath } from "../../../../stateHome.js";

const NO_FILES = { clientIdFile: null, clientSecretFile: null } as const;

describe("resolveVantaCommandCredentials", () => {
  let dir: string;
  let home: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vanta-credfiles-"));
    home = join(dir, "home");
  });
  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** Populate the store under `home` the way `slopweaver secrets set` does — 0600 files in a 0700 dir. */
  function populateStore({ clientId, clientSecret }: { clientId: string; clientSecret: string }): void {
    unwrap(writeSecretFile({ home, name: "vanta-client-id", value: clientId }));
    unwrap(writeSecretFile({ home, name: "vanta-client-secret", value: clientSecret }));
  }

  it("falls back to the environment when neither file is given", () => {
    const result = resolveVantaCommandCredentials({
      env: { VANTA_CLIENT_ID: "a-client-id-value", VANTA_CLIENT_SECRET: "a-client-secret-value" },
      home,
      inputs: NO_FILES,
    });
    expect(unwrap(result)).toEqual({ clientId: "a-client-id-value", clientSecret: "a-client-secret-value" });
  });

  it("refuses when only one of the two files is given", () => {
    const result = resolveVantaCommandCredentials({
      env: {},
      home,
      inputs: { clientIdFile: join(dir, "id"), clientSecretFile: null },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("must be supplied together");
  });

  it("reads both credentials from owner-only files", () => {
    const idPath = join(dir, "client-id");
    const secretPath = join(dir, "client-secret");
    writeFileSync(idPath, "a-client-id-value\n", { mode: 0o600 });
    writeFileSync(secretPath, "a-client-secret-value\n", { mode: 0o600 });
    const result = resolveVantaCommandCredentials({
      env: {},
      home,
      inputs: { clientIdFile: idPath, clientSecretFile: secretPath },
    });
    expect(unwrap(result)).toEqual({ clientId: "a-client-id-value", clientSecret: "a-client-secret-value" });
  });

  it("refuses a credential file that is not owner-only", () => {
    const idPath = join(dir, "client-id");
    const secretPath = join(dir, "client-secret");
    writeFileSync(idPath, "a-client-id-value\n", { mode: 0o644 });
    writeFileSync(secretPath, "a-client-secret-value\n", { mode: 0o600 });
    const result = resolveVantaCommandCredentials({
      env: {},
      home,
      inputs: { clientIdFile: idPath, clientSecretFile: secretPath },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("owner-only");
  });

  it("refuses a missing credential file", () => {
    const idPath = join(dir, "nope");
    const secretPath = join(dir, "also-nope");
    const result = resolveVantaCommandCredentials({
      env: {},
      home,
      inputs: { clientIdFile: idPath, clientSecretFile: secretPath },
    });
    expect(unwrapErr(result)).toEqual([
      `could not read --client-id-file at ${idPath}: ENOENT: no such file or directory, open '${idPath}'`,
      `could not read --client-secret-file at ${secretPath}: ENOENT: no such file or directory, open '${secretPath}'`,
    ]);
  });

  describe("the secrets store under home", () => {
    it("is the route when the environment is empty and no file is named", () => {
      populateStore({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
      const result = resolveVantaCommandCredentials({ env: {}, home, inputs: NO_FILES });
      expect(unwrap(result)).toEqual({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
    });

    it("loses to the environment when both are populated", () => {
      populateStore({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
      const result = resolveVantaCommandCredentials({
        env: { VANTA_CLIENT_ID: "env-client-id", VANTA_CLIENT_SECRET: "env-client-secret" },
        home,
        inputs: NO_FILES,
      });
      expect(unwrap(result)).toEqual({ clientId: "env-client-id", clientSecret: "env-client-secret" });
    });

    it("loses to an explicit file pair even when the environment is empty", () => {
      populateStore({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
      const idPath = join(dir, "client-id");
      const secretPath = join(dir, "client-secret");
      writeFileSync(idPath, "file-client-id\n", { mode: 0o600 });
      writeFileSync(secretPath, "file-client-secret\n", { mode: 0o600 });
      const result = resolveVantaCommandCredentials({
        env: {},
        home,
        inputs: { clientIdFile: idPath, clientSecretFile: secretPath },
      });
      expect(unwrap(result)).toEqual({ clientId: "file-client-id", clientSecret: "file-client-secret" });
    });

    it("reports a half-set environment as an environment problem rather than reading the store", () => {
      populateStore({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
      const result = resolveVantaCommandCredentials({
        env: { VANTA_CLIENT_ID: "env-client-id" },
        home,
        inputs: NO_FILES,
      });
      expect(unwrapErr(result)).toEqual([
        "VANTA_CLIENT_SECRET is not set — export it, or run: slopweaver secrets set vanta-client-secret (Settings → Developer Console → your Manage Vanta application)",
      ]);
    });

    it("names the missing half of a half-populated store", () => {
      unwrap(writeSecretFile({ home, name: "vanta-client-id", value: "stored-client-id" }));
      const result = resolveVantaCommandCredentials({ env: {}, home, inputs: NO_FILES });
      expect(unwrapErr(result)).toEqual([
        "the secrets store holds vanta-client-id but not vanta-client-secret — the pair mints together, so run: slopweaver secrets set vanta-client-secret",
      ]);
    });

    it("refuses a store file whose mode has been loosened", () => {
      populateStore({ clientId: "stored-client-id", clientSecret: "stored-client-secret" });
      chmodSync(secretFilePath({ home, name: "vanta-client-secret" }), 0o644);
      const result = resolveVantaCommandCredentials({ env: {}, home, inputs: NO_FILES });
      expect(unwrapErr(result)[0]).toContain("secrets/vanta-client-secret must be owner-only");
    });

    it("grades a stored value the way an exported one is graded", () => {
      populateStore({ clientId: "short", clientSecret: "stored-client-secret" });
      const result = resolveVantaCommandCredentials({ env: {}, home, inputs: NO_FILES });
      expect(unwrapErr(result)[0]).toContain(
        "VANTA_CLIENT_ID is set (5 chars) but is not a plausible credential length",
      );
    });

    it("names both routes when neither the environment nor the store holds anything", () => {
      const result = resolveVantaCommandCredentials({ env: {}, home, inputs: NO_FILES });
      expect(unwrapErr(result)).toEqual([
        "VANTA_CLIENT_ID is not set — export it, or run: slopweaver secrets set vanta-client-id (Settings → Developer Console → your Manage Vanta application)",
        "VANTA_CLIENT_SECRET is not set — export it, or run: slopweaver secrets set vanta-client-secret (Settings → Developer Console → your Manage Vanta application)",
      ]);
    });
  });
});
