/**
 * The secrets-registry gate's four checks, each proved to FIRE as well as to pass.
 *
 * A gate that cannot fail reports clean forever, which is worse than no gate — so every check here has a
 * witness that trips it, not just a case that satisfies it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isReaderPath,
  renderDocTable,
  scanDocTable,
  scanReaderClaims,
  scanStore,
  TABLE_END,
  TABLE_START,
} from "../../../devLint/secretsRegistry.js";
import type { CredentialSpec } from "../../../secrets/registry.js";

const LIVE: CredentialSpec = {
  expiry: "none",
  lifecycle: "live",
  mintScope: "read-only",
  name: "test-line-token",
  platform: "TestCo",
  reader: "src/atlas/testco/credential.ts",
  readVerbs: "slopweaver atlas testco *",
  settable: true,
  shape: "line",
  usedFor: "reading TestCo",
  what: "a test token",
  writtenBy: "slopweaver secrets set test-line-token",
};

const RETIRED: CredentialSpec = {
  expiry: "none",
  lifecycle: "retired",
  mintScope: "not-a-credential",
  name: "test-old-token",
  platform: "TestCo",
  reader: null,
  readVerbs: "nothing",
  settable: false,
  shape: "line",
  usedFor: "NOTHING",
  what: "a superseded token",
  writtenBy: "placed by hand",
};

const dirs: string[] = [];

/** A seam no branch answers for — the stray file belongs to nobody. */
const NONE = (): readonly string[] => [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("isReaderPath", () => {
  it("counts a source module", () => {
    expect(isReaderPath({ path: "src/atlas/testco/credential.ts" })).toBe(true);
  });

  it("excludes the register itself, which names every credential in order to describe them", () => {
    expect(isReaderPath({ path: "src/secrets/registry.ts" })).toBe(false);
  });

  it("excludes every category file the register's rows live in, the retired one included", () => {
    expect(
      [
        "src/secrets/credentials/retired.ts",
        "src/secrets/credentials/connectors.ts",
        "src/secrets/credentials/spec.ts",
      ].map((path) => isReaderPath({ path })),
    ).toEqual([false, false, false]);
  });

  it("still counts a sibling of the register outside its category directory", () => {
    expect(isReaderPath({ path: "src/secrets/googleClients.ts" })).toBe(true);
  });

  it("excludes the gate and the status verb for the same reason", () => {
    expect(isReaderPath({ path: "src/devLint/secretsRegistry.ts" })).toBe(false);
    expect(isReaderPath({ path: "src/secrets/status.ts" })).toBe(false);
  });

  it("excludes the test tree, so a fixture naming a credential is not a reader", () => {
    expect(isReaderPath({ path: "src/__tests__/unit/secrets/status.test.ts" })).toBe(false);
  });

  it("excludes a non-source path and a non-TypeScript one", () => {
    expect(isReaderPath({ path: "docs/security.md" })).toBe(false);
    expect(isReaderPath({ path: "src/atlas/testco/notes.md" })).toBe(false);
  });
});

describe("scanReaderClaims", () => {
  it("passes when the declared reader names the credential", () => {
    const sources = new Map([["src/atlas/testco/credential.ts", 'const NAME = "test-line-token";']]);

    expect(scanReaderClaims({ sources, specs: [LIVE] })).toEqual([]);
  });

  it("fires `reader-missing` when the declared module is not a tracked source", () => {
    const hits = scanReaderClaims({ sources: new Map(), specs: [LIVE] });

    expect(hits.map((hit) => hit.check)).toEqual(["reader-missing"]);
    expect(hits[0]!.message).toContain("src/atlas/testco/credential.ts");
  });

  it("fires `reader-silent` when the declared module no longer names the credential", () => {
    const sources = new Map([["src/atlas/testco/credential.ts", 'const NAME = "something-else";']]);

    const hits = scanReaderClaims({ sources, specs: [LIVE] });

    expect(hits.map((hit) => hit.check)).toEqual(["reader-silent"]);
  });

  it("passes a retired credential nothing names", () => {
    const sources = new Map([["src/atlas/testco/credential.ts", 'const NAME = "unrelated";']]);

    expect(scanReaderClaims({ sources, specs: [RETIRED] })).toEqual([]);
  });

  it("fires `retired-has-reader` the moment something names it again", () => {
    const sources = new Map([["src/atlas/testco/credential.ts", 'const NAME = "test-old-token";']]);

    const hits = scanReaderClaims({ sources, specs: [RETIRED] });

    expect(hits.map((hit) => hit.check)).toEqual(["retired-has-reader"]);
    expect(hits[0]!.message).toContain("src/atlas/testco/credential.ts");
  });
});

describe("scanDocTable", () => {
  const fencedDoc = ({ body }: { body: string }): string => `intro\n${TABLE_START}\n${body}\n${TABLE_END}\nrest\n`;

  it("passes when the fenced table matches the register", () => {
    const doc = fencedDoc({ body: renderDocTable({ specs: [LIVE] }).join("\n") });

    expect(scanDocTable({ doc, specs: [LIVE] })).toEqual([]);
  });

  it("passes when Prettier has repadded every cell and widened the separator", () => {
    const doc = fencedDoc({
      body: [
        "| secret            | platform | used for      |",
        "| ----------------- | -------- | ------------- |",
        "| `test-line-token` | TestCo   | reading TestCo |",
      ].join("\n"),
    });

    expect(scanDocTable({ doc, specs: [LIVE] })).toEqual([]);
  });

  it("fires when a cell was hand-edited", () => {
    const doc = fencedDoc({
      body: [
        "| secret | platform | used for |",
        "| --- | --- | --- |",
        "| `test-line-token` | TestCo | reading something else entirely |",
      ].join("\n"),
    });

    const hits = scanDocTable({ doc, specs: [LIVE] });

    expect(hits.map((hit) => hit.check)).toEqual(["doc-drift"]);
    expect(hits[0]!.message).toContain("row 3");
  });

  it("fires when a register row has no table row at all", () => {
    const doc = fencedDoc({ body: renderDocTable({ specs: [] }).join("\n") });

    const hits = scanDocTable({ doc, specs: [LIVE] });

    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("row 3 drifted");
    expect(hits[0]!.message.endsWith(", got null")).toBe(true);
  });

  it("fires when the table carries a row the register does not", () => {
    const doc = fencedDoc({ body: renderDocTable({ specs: [LIVE, RETIRED] }).join("\n") });

    const hits = scanDocTable({ doc, specs: [LIVE] });

    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("row 4 drifted — want null, got [");
  });

  it("fires when the fence is missing entirely", () => {
    const hits = scanDocTable({ doc: "a doc with no fence at all\n", specs: [LIVE] });

    expect(hits.map((hit) => hit.check)).toEqual(["doc-drift"]);
    expect(hits[0]!.message).toContain("no");
  });
});

describe("scanStore", () => {
  it("finds nothing when the store directory is absent, which is every CI runner", () => {
    expect(scanStore({ declaredOn: NONE, dir: join(tmpdir(), "sw-no-such-store-dir"), specs: [LIVE] })).toEqual([]);
  });

  it("passes a store holding only declared files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-store-clean-"));
    dirs.push(dir);
    writeFileSync(join(dir, LIVE.name), "x", { mode: 0o600 });

    expect(scanStore({ declaredOn: NONE, dir, specs: [LIVE] })).toEqual([]);
  });

  it("fires on a file the register does not declare, naming the remedy", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-store-stray-"));
    dirs.push(dir);
    writeFileSync(join(dir, "hand-placed-token"), "x", { mode: 0o600 });

    const hits = scanStore({ declaredOn: NONE, dir, specs: [LIVE] });

    expect(hits.map((hit) => hit.check)).toEqual(["store-unregistered"]);
    expect(hits[0]!.message).toContain("src/secrets/credentials/");
  });

  it("ignores a subdirectory, which is not a credential", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-store-subdir-"));
    dirs.push(dir);
    mkdirSync(join(dir, "backups"));

    expect(scanStore({ declaredOn: NONE, dir, specs: [LIVE] })).toEqual([]);
  });

  it("names the unlanded branch that declares a stray file, rather than telling a bystander to delete it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-store-peer-"));
    dirs.push(dir);
    writeFileSync(join(dir, "store-url"), "x", { mode: 0o600 });

    const hits = scanStore({
      declaredOn: ({ name }) => (name === "store-url" ? ["supabase-slice-two"] : []),
      dir,
      specs: [LIVE],
    });

    expect(hits.map((hit) => hit.check)).toEqual(["store-unregistered"]);
    expect(hits[0]!.message).toContain("declared on supabase-slice-two");
    expect(hits[0]!.message).toContain("Do not add its row here or delete the file");
  });

  it("keeps the add-or-delete remedy when no branch declares the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-store-orphan-"));
    dirs.push(dir);
    writeFileSync(join(dir, "hand-placed-token"), "x", { mode: 0o600 });

    const hits = scanStore({ declaredOn: NONE, dir, specs: [LIVE] });

    expect(hits[0]!.message).toContain(
      "Add its row to its category file under src/secrets/credentials/, or delete the file",
    );
  });
});
