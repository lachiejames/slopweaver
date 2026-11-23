/**
 * The committed table is the one the generator wrote: strictly sorted by id, and hashing — with the lock's
 * per-file `declared` counts and unpublished list — to the digest the generator pinned in the lock.
 *
 * Each counterexample is one an adversarial review made against the committed files while every census
 * check and the census-only `--verify` still passed: a changed path, a changed scope list, a reordered row,
 * and two count moves between files that kept every total. Each is built here from a COPY of the imports —
 * the committed files are never touched — and each copy is first asserted to carry the edit, so a refusal
 * cannot pass because the edit silently missed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GOOGLE_SECOPS_REGENERATE_COMMAND,
  type GoogleSecopsInventoryError,
  GoogleSecopsInventoryErrors,
} from "../../../../atlas/googleSecops/errors.js";
import {
  GOOGLE_SECOPS_INVENTORY_CENSUS,
  GOOGLE_SECOPS_INVENTORY_SHA256,
  GOOGLE_SECOPS_PINS,
  GOOGLE_SECOPS_PROTO_COMMIT,
  GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
} from "../../../../atlas/googleSecops/generated/protoLock.js";
import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import type { GoogleSecopsSurfaceRow } from "../../../../atlas/googleSecops/surfaceRow.js";
import { renderGoogleSecopsLock, renderGoogleSecopsSurfaces } from "../../../../atlas/googleSecops/surfacesRender.js";
import {
  compareGoogleSecopsIds,
  type GoogleSecopsDigestInput,
  googleSecopsInventoryDigest,
  googleSecopsInventoryMatchesLock,
} from "../../../../atlas/googleSecops/tableIntegrity.js";
import { unwrapErr } from "../../../../lib/result.js";

const GET_RULE = "google.cloud.chronicle.v1.RuleService.GetRule";
const LIST_RULES = "google.cloud.chronicle.v1.RuleService.ListRules";
const GET_DATA_TABLE = "google.cloud.chronicle.v1.DataTableService.GetDataTable";
const GET_REFERENCE_LIST = "google.cloud.chronicle.v1.ReferenceListService.GetReferenceList";
const CHRONICLE_SCOPE = "https://www.googleapis.com/auth/chronicle";

/** The committed inventory, exactly as imported. */
const COMMITTED: GoogleSecopsDigestInput = {
  declared: GOOGLE_SECOPS_PINS,
  rows: GOOGLE_SECOPS_SURFACES,
  unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
};

/**
 * Check an edited copy of the committed inventory against the committed digest.
 *
 * @param edit the fields of the committed inventory to replace
 * @returns the refusal
 */
function refusalOf({ edit }: { edit: Partial<GoogleSecopsDigestInput> }): GoogleSecopsInventoryError {
  return unwrapErr(
    googleSecopsInventoryMatchesLock({ ...COMMITTED, ...edit, pinnedSha256: GOOGLE_SECOPS_INVENTORY_SHA256 }),
  );
}

/**
 * A copy of the committed table with one row replaced.
 *
 * @param id the row to replace
 * @param edit what to change on it
 * @returns the edited copy
 */
function withRow({
  id,
  edit,
}: {
  id: string;
  edit: (row: GoogleSecopsSurfaceRow) => GoogleSecopsSurfaceRow;
}): readonly GoogleSecopsSurfaceRow[] {
  return GOOGLE_SECOPS_SURFACES.map((row) => (row.id === id ? edit(row) : row));
}

/**
 * The row with this id in a table.
 *
 * @param rows the table
 * @param id the row's id
 * @returns the row
 */
function rowOf({ rows, id }: { rows: readonly GoogleSecopsSurfaceRow[]; id: string }): GoogleSecopsSurfaceRow {
  return rows.find((row) => row.id === id)!;
}

describe("the committed inventory against its pinned digest", () => {
  it("is sorted and hashes to exactly the digest the lock pins", () => {
    expect(GOOGLE_SECOPS_SURFACES.length).toBeGreaterThan(0);
    expect(GOOGLE_SECOPS_INVENTORY_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(googleSecopsInventoryDigest(COMMITTED)).toBe(GOOGLE_SECOPS_INVENTORY_SHA256);
    expect(
      googleSecopsInventoryMatchesLock({ ...COMMITTED, pinnedSha256: GOOGLE_SECOPS_INVENTORY_SHA256 }).isOk(),
    ).toBe(true);
  });

  it("refuses a copy with one path changed, naming the regenerate command", () => {
    const rows = withRow({
      edit: (row) => ({ ...row, pathTemplate: row.pathTemplate.replace("rules/*", "rulez/*") }),
      id: GET_RULE,
    });
    expect(rowOf({ id: GET_RULE, rows }).pathTemplate).toBe("/v1/{name=projects/*/locations/*/instances/*/rulez/*}");
    const error = refusalOf({ edit: { rows } });
    expect(error).toStrictEqual(
      GoogleSecopsInventoryErrors.tableDigestMismatch({
        pinned: GOOGLE_SECOPS_INVENTORY_SHA256,
        read: googleSecopsInventoryDigest({ ...COMMITTED, rows }),
      }),
    );
    expect(error.message).toContain(GOOGLE_SECOPS_REGENERATE_COMMAND);
  });

  it("refuses a copy with one scope dropped from a row's list", () => {
    const rows = withRow({
      edit: (row) => ({ ...row, scopes: row.scopes.filter((scope) => scope !== CHRONICLE_SCOPE) }),
      id: GET_DATA_TABLE,
    });
    expect(rowOf({ id: GET_DATA_TABLE, rows: GOOGLE_SECOPS_SURFACES }).scopes).toContain(CHRONICLE_SCOPE);
    expect(rowOf({ id: GET_DATA_TABLE, rows }).scopes).toStrictEqual([
      "https://www.googleapis.com/auth/chronicle.readonly",
      "https://www.googleapis.com/auth/cloud-platform",
    ]);
    expect(refusalOf({ edit: { rows } }).code).toBe("TABLE_DIGEST_MISMATCH");
  });

  it("refuses a copy with ListRules moved above GetRule as unsorted, and its digest moves too", () => {
    const listRules = rowOf({ id: LIST_RULES, rows: GOOGLE_SECOPS_SURFACES });
    const without = GOOGLE_SECOPS_SURFACES.filter((row) => row.id !== LIST_RULES);
    const at = without.findIndex((row) => row.id === GET_RULE);
    const rows = [...without.slice(0, at), listRules, ...without.slice(at)];
    expect(rows.length).toBe(GOOGLE_SECOPS_SURFACES.length);
    expect(rows.findIndex((row) => row.id === LIST_RULES)).toBe(rows.findIndex((row) => row.id === GET_RULE) - 1);
    expect(refusalOf({ edit: { rows } })).toStrictEqual(
      GoogleSecopsInventoryErrors.tableUnsorted({ after: GET_RULE, before: LIST_RULES }),
    );
    expect(googleSecopsInventoryDigest({ ...COMMITTED, rows })).not.toBe(GOOGLE_SECOPS_INVENTORY_SHA256);
  });

  it("refuses a changed path even when the row carries a toJSON serving the digest the old one", () => {
    const original = rowOf({ id: GET_REFERENCE_LIST, rows: GOOGLE_SECOPS_SURFACES });
    const rows = withRow({
      edit: (row) => ({
        ...row,
        pathTemplate: row.pathTemplate.replace("referenceLists/*", "dataTables/*"),
        toJSON: (): GoogleSecopsSurfaceRow => original,
      }),
      id: GET_REFERENCE_LIST,
    });
    const edited = rowOf({ id: GET_REFERENCE_LIST, rows });
    expect(edited.pathTemplate).toBe("/v1/{name=projects/*/locations/*/instances/*/dataTables/*}");
    expect(JSON.parse(JSON.stringify(edited))).toStrictEqual(JSON.parse(JSON.stringify(original)));
    expect(refusalOf({ edit: { rows } }).code).toBe("TABLE_DIGEST_MISMATCH");
  });

  it("refuses a duplicated row as unsorted, because the order is strict", () => {
    const first = GOOGLE_SECOPS_SURFACES[0]!;
    const rows = [first, ...GOOGLE_SECOPS_SURFACES];
    expect(refusalOf({ edit: { rows } })).toStrictEqual(
      GoogleSecopsInventoryErrors.tableUnsorted({ after: first.id, before: first.id }),
    );
  });

  it("refuses a copy with one declared count moved between two pins, every total kept", () => {
    const moves = new Map([
      ["data_table.proto", -1],
      ["rule.proto", 1],
    ]);
    const declared = GOOGLE_SECOPS_PINS.map((pin) =>
      moves.has(pin.id) ? { ...pin, declared: pin.declared + moves.get(pin.id)! } : pin,
    );
    const total = ({ pins }: { pins: readonly { declared: number }[] }): number =>
      pins.reduce((sum, pin) => sum + pin.declared, 0);
    expect(declared.filter((pin) => moves.has(pin.id)).map((pin) => [pin.id, pin.declared])).toStrictEqual([
      ["data_table.proto", 14],
      ["rule.proto", 14],
    ]);
    expect(total({ pins: declared })).toBe(total({ pins: GOOGLE_SECOPS_PINS }));
    expect(refusalOf({ edit: { declared } }).code).toBe("TABLE_DIGEST_MISMATCH");
  });

  it("refuses a copy with one rpc moved between two unpublished services, every total kept", () => {
    const unpublished = GOOGLE_SECOPS_UNPUBLISHED_SERVICES.map((entry, index) => {
      const shift = [-1, 1, 0][index]!;
      return { ...entry, rpcs: entry.rpcs + shift };
    });
    expect(unpublished.map((entry) => entry.rpcs)).toStrictEqual([2, 3, 2]);
    expect(refusalOf({ edit: { unpublished } }).code).toBe("TABLE_DIGEST_MISMATCH");
  });
});

/** The generated directory, resolved from this file. */
const GENERATED = fileURLToPath(new URL("../../../../atlas/googleSecops/generated/", import.meta.url));

/**
 * A committed generated module's text.
 *
 * @param name the file under `atlas/googleSecops/generated/`
 * @returns its text
 */
function generatedText({ name }: { name: string }): string {
  return readFileSync(join(GENERATED, name), "utf8");
}

describe("the committed generated files against the renderer", () => {
  it("holds only the two rendered modules, so no hand-written sibling can rewrite one at import", () => {
    expect(readdirSync(GENERATED).toSorted()).toStrictEqual(["protoLock.ts", "surfaces.ts"]);
  });

  it("surfaces.ts is byte for byte the literal text the generator renders for its own rows", () => {
    const text = generatedText({ name: "surfaces.ts" });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toBe(renderGoogleSecopsSurfaces({ rows: GOOGLE_SECOPS_SURFACES }));
  });

  it("protoLock.ts is byte for byte the literal text the generator renders for its own values", () => {
    const text = generatedText({ name: "protoLock.ts" });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toBe(
      renderGoogleSecopsLock({
        census: GOOGLE_SECOPS_INVENTORY_CENSUS,
        commit: GOOGLE_SECOPS_PROTO_COMMIT,
        digest: GOOGLE_SECOPS_INVENTORY_SHA256,
        pins: GOOGLE_SECOPS_PINS,
        unpublished: GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
      }),
    );
  });
});

describe("the canonical serialisation", () => {
  it("does not depend on the order a row's keys were written in", () => {
    const first = GOOGLE_SECOPS_SURFACES[0]!;
    const { service, scopes, ...rest } = first;
    const reordered: GoogleSecopsSurfaceRow = { service, scopes, ...rest };
    expect([Object.keys(first)[0], Object.keys(reordered)[0]]).toStrictEqual(["disposition", "service"]);
    expect(googleSecopsInventoryDigest({ declared: [], rows: [reordered], unpublished: [] })).toBe(
      googleSecopsInventoryDigest({ declared: [], rows: [first], unpublished: [] }),
    );
  });

  it("orders ids by code unit, never by locale, so capitals sort before lower case", () => {
    expect(compareGoogleSecopsIds({ left: "a.ListFeedSchemas", right: "a.ListFeeds" })).toBe(-1);
    expect(compareGoogleSecopsIds({ left: "a.ListFeeds", right: "a.ListFeedSchemas" })).toBe(1);
    expect(compareGoogleSecopsIds({ left: "a.B", right: "a.B" })).toBe(0);
  });
});
