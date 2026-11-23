/**
 * The owner-turn projection: which paths are a family, and that a file's bytes reach the row exactly or not
 * at all.
 */
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import {
  foldOwnerTurns,
  OWNER_TURN_FAMILIES,
  OWNER_TURN_ROOT_PREFIXES,
  ownerTurnFamily,
  ownerTurnLabel,
  projectOwnerTurnFile,
} from "../../../../store/fleet/ownerTurn.js";
import { ownerTurnLocationTable, ownerTurnTable } from "../../../../store/schema/ownerTurn.js";

const WHEN = new Date("2026-09-23T01:02:03.004Z");

/** The bytes of a string, as a file holding it would carry them. */
function bytesOf({ text }: { text: string }): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

describe("OWNER_TURN_ROOT_PREFIXES", () => {
  it("is exactly what stateHomePaths resolves for each root, so the two cannot drift", () => {
    const home = "/h/.slopweaver";
    const paths = stateHomePaths({ home });

    expect(OWNER_TURN_FAMILIES.length).toBeGreaterThan(0);
    expect(OWNER_TURN_ROOT_PREFIXES["archive-turn"]).toBe(relative(home, paths.handoverArchive).split(sep).join("/"));
    expect(OWNER_TURN_ROOT_PREFIXES["scratch-turn"]).toBe(relative(home, paths.supervisorScratch).split(sep).join("/"));
  });
});

describe("ownerTurnLabel", () => {
  it("reads the label verbatim off an owner-turn filename", () => {
    expect(ownerTurnLabel({ fileName: "owner-turn-257-1.txt" })).toBe("257-1");
  });

  it("answers undefined for any other file", () => {
    expect(ownerTurnLabel({ fileName: "turn-257-1.txt" })).toBe(undefined);
    expect(ownerTurnLabel({ fileName: "owner-turn-257-1.md" })).toBe(undefined);
  });
});

describe("ownerTurnFamily", () => {
  it("places a file directly under the archive in archive-turn", () => {
    expect(ownerTurnFamily({ relativePath: "handovers/archive/owner-turn-1-1.txt" })).toBe("archive-turn");
  });

  it("places a file one handoff folder under the scratch root in scratch-turn", () => {
    expect(ownerTurnFamily({ relativePath: "supervisor-scratch/handoff-9291/owner-turn-291-60.txt" })).toBe(
      "scratch-turn",
    );
  });

  it("places a file folders deep under the scratch root in scratch-turn, where handoff-9290 keeps two", () => {
    expect(ownerTurnFamily({ relativePath: "supervisor-scratch/handoff-9290/owner-turns/owner-turn-290-1.txt" })).toBe(
      "scratch-turn",
    );
  });

  it("refuses a path that climbs out through ..", () => {
    expect(ownerTurnFamily({ relativePath: "supervisor-scratch/../owner-turn-1-1.txt" })).toBe(undefined);
  });

  it("refuses a file under neither root", () => {
    expect(ownerTurnFamily({ relativePath: "handovers/owner-turn-1-1.txt" })).toBe(undefined);
  });
});

describe("projectOwnerTurnFile", () => {
  it("hashes the exact bytes and keeps the text byte for byte, trailing newline and all", () => {
    const text = "merge it — \u{1F44D}\n\n";
    const bytes = bytesOf({ text });

    const row = unwrap(
      projectOwnerTurnFile({
        bytes,
        fileModifiedAt: WHEN,
        relativePath: "supervisor-scratch/handoff-9291/owner-turn-291-60.txt",
      }),
    );

    expect(row.body.body).toBe(text);
    expect(row.body.byteLength).toBe(bytes.length);
    expect(row.body.bodySha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(row.location).toEqual({
      bodySha256: row.body.bodySha256,
      family: "scratch-turn",
      fileModifiedAt: WHEN,
      relativePath: "supervisor-scratch/handoff-9291/owner-turn-291-60.txt",
      turn: "291-60",
    });
  });

  it("keeps a leading byte-order mark in the text rather than dropping it", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);

    const row = unwrap(
      projectOwnerTurnFile({ bytes, fileModifiedAt: WHEN, relativePath: "handovers/archive/owner-turn-1-1.txt" }),
    );

    expect(row.body.body).toBe("\uFEFFhi");
    expect(row.body.byteLength).toBe(5);
  });

  it("refuses a NUL byte, naming the file, rather than storing a cleaned copy", () => {
    const error = unwrapErr(
      projectOwnerTurnFile({
        bytes: bytesOf({ text: "a\u0000b" }),
        fileModifiedAt: WHEN,
        relativePath: "handovers/archive/owner-turn-1-1.txt",
      }),
    );

    expect(error.code).toBe("UNSTORABLE_TURN_FILE");
    expect(error.message).toBe(
      "handovers/archive/owner-turn-1-1.txt cannot be stored as an owner turn verbatim: it contains a NUL byte, which a Postgres text column cannot hold",
    );
  });

  it("refuses bytes that are not UTF-8", () => {
    const error = unwrapErr(
      projectOwnerTurnFile({
        bytes: new Uint8Array([0x68, 0xff, 0x69]),
        fileModifiedAt: WHEN,
        relativePath: "handovers/archive/owner-turn-1-1.txt",
      }),
    );

    expect(error.code).toBe("UNSTORABLE_TURN_FILE");
    expect(error.message).toContain("not UTF-8");
  });

  it("refuses a path in no family", () => {
    const error = unwrapErr(
      projectOwnerTurnFile({ bytes: bytesOf({ text: "x" }), fileModifiedAt: WHEN, relativePath: "owner-turn-1-1.txt" }),
    );

    expect(error.code).toBe("UNSTORABLE_TURN_FILE");
    expect(error.message).toContain("not an owner-turn-*.txt file directly under handovers/archive/");
  });
});

describe("foldOwnerTurns", () => {
  it("keeps each body once and every location, first seen first", () => {
    const one = unwrap(
      projectOwnerTurnFile({
        bytes: bytesOf({ text: "same" }),
        fileModifiedAt: WHEN,
        relativePath: "supervisor-scratch/a/owner-turn-1-1.txt",
      }),
    );
    const copy = unwrap(
      projectOwnerTurnFile({
        bytes: bytesOf({ text: "same" }),
        fileModifiedAt: WHEN,
        relativePath: "supervisor-scratch/b/owner-turn-1-1.txt",
      }),
    );
    const other = unwrap(
      projectOwnerTurnFile({
        bytes: bytesOf({ text: "other" }),
        fileModifiedAt: WHEN,
        relativePath: "handovers/archive/owner-turn-1-2.txt",
      }),
    );

    const folded = foldOwnerTurns({ projected: [one, copy, other] });

    expect(folded.bodies.map((body) => body.body)).toEqual(["same", "other"]);
    expect(folded.locations.map((location) => location.relativePath)).toEqual([
      "supervisor-scratch/a/owner-turn-1-1.txt",
      "supervisor-scratch/b/owner-turn-1-1.txt",
      "handovers/archive/owner-turn-1-2.txt",
    ]);
  });

  it("folds nothing to nothing", () => {
    expect(foldOwnerTurns({ projected: [] })).toEqual({ bodies: [], locations: [] });
  });
});

describe("the owner_turn tables", () => {
  it("admit exactly the two families the projection writes, so a new family cannot land unstorable", () => {
    const familyCheck = getTableConfig(ownerTurnLocationTable).checks.find(
      (candidate) => candidate.name === "owner_turn_location_family",
    )!;

    expect(OWNER_TURN_FAMILIES.length).toBeGreaterThan(0);
    expect(new PgDialect().sqlToQuery(familyCheck.value).sql).toBe(
      `family in (${OWNER_TURN_FAMILIES.map((family) => `'${family}'`).join(", ")})`,
    );
  });

  it("key a body by its sha and a location by its path and body, so one path can hold every version", () => {
    const location = getTableConfig(ownerTurnLocationTable);

    expect(getTableName(ownerTurnTable)).toBe("owner_turn");
    expect(
      getTableConfig(ownerTurnTable)
        .columns.filter((column) => column.primary)
        .map((column) => column.name),
    ).toEqual(["body_sha256"]);
    expect(location.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ["relative_path", "body_sha256"],
    ]);
  });
});
