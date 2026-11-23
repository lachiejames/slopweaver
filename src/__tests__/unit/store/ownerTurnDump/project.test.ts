/**
 * A pg_dump of the owner-turn tables folded line by line: only the two exactly-declared sections are read, every
 * body is re-hashed, an orphan location is refused, and the stored instants are loaded as exactly what they were.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { OwnerTurnDumpErrors } from "../../../../store/ownerTurnDump/errors.js";
import { createOwnerTurnDumpFold, DUMP_SECTIONS } from "../../../../store/ownerTurnDump/project.js";

const BODY = "Merge it.\nPlease.";
const SHA = createHash("sha256").update(BODY).digest("hex");
const OTHER_SHA = "0".repeat(64);

/** A body's COPY line, escaped as pg_dump writes it. */
function bodyLine({ sha = SHA, length = 17 }: { sha?: string; length?: number } = {}): string {
  return `${sha}\tMerge it.\\nPlease.\t${String(length)}\t2026-09-25 12:18:54.838+00`;
}

/** A location's COPY line. */
function locationLine({ sha = SHA, family = "archive-turn" }: { sha?: string; family?: string } = {}): string {
  return `handovers/archive/owner-turn-1-1.txt\t${sha}\t1-1\t${family}\t2026-09-05 01:41:34.805+00\t2026-09-22 22:25:43+00`;
}

/** A whole dump's lines: an unrelated section first, then the two this fold reads. */
function dump({
  bodies = [bodyLine()],
  locations = [locationLine()],
}: { bodies?: string[]; locations?: string[] } = {}) {
  return [
    "--",
    "COPY public.owner_profile (revision, body) FROM stdin;",
    // A data line that looks like a header inside a section is still data.
    `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
    "\\.",
    "",
    `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
    ...bodies,
    "\\.",
    `COPY public.owner_turn_location (${DUMP_SECTIONS.owner_turn_location}) FROM stdin;`,
    ...locations,
    "\\.",
  ];
}

/** Fold every line and finish. */
function fold({ lines }: { lines: readonly string[] }) {
  const folder = createOwnerTurnDumpFold();
  lines.forEach((line, index) => {
    folder.feed({ line, lineNumber: index + 1 });
  });
  return folder.finish();
}

describe("createOwnerTurnDumpFold", () => {
  it("loads each body verbatim and each location, keeping the instants they were dumped with", () => {
    expect(unwrap(fold({ lines: dump() }))).toEqual({
      bodies: [{ body: BODY, bodySha256: SHA, byteLength: 17, firstImportedAt: new Date("2026-09-25T12:18:54.838Z") }],
      locations: [
        {
          bodySha256: SHA,
          family: "archive-turn",
          fileModifiedAt: new Date("2026-09-05T01:41:34.805Z"),
          recordedAt: new Date("2026-09-22T22:25:43.000Z"),
          relativePath: "handovers/archive/owner-turn-1-1.txt",
          turn: "1-1",
        },
      ],
      refused: [],
    });
  });

  it("refuses a body whose bytes do not hash to its row, or measure to its length", () => {
    const load = unwrap(fold({ lines: dump({ bodies: [bodyLine({ length: 18 })], locations: [] }) }));

    expect(load.refused).toEqual([
      OwnerTurnDumpErrors.bodyMismatch({
        bodySha256: SHA,
        lineNumber: 7,
        reason: "it is 17 bytes, not the 18 its row says",
      }),
    ]);
    const wrongHash = unwrap(fold({ lines: dump({ bodies: [bodyLine({ sha: OTHER_SHA })], locations: [] }) }));
    expect(wrongHash.refused[0]!.code).toBe("DUMP_BODY_MISMATCH");
    expect(wrongHash.refused[0]!.message).toContain(`its bytes hash to ${SHA}`);
  });

  it("refuses a location naming a body the dump does not carry", () => {
    const load = unwrap(fold({ lines: dump({ locations: [locationLine({ sha: OTHER_SHA })] }) }));

    expect(load.refused).toEqual([OwnerTurnDumpErrors.orphanLocation({ bodySha256: OTHER_SHA, lineNumber: 10 })]);
  });

  it("refuses a repeated body or location key, which the insert would otherwise drop in silence", () => {
    const load = unwrap(
      fold({
        lines: dump({
          bodies: [bodyLine(), bodyLine()],
          locations: [locationLine(), locationLine({ family: "voice" })],
        }),
      }),
    );

    expect(load.refused).toEqual([
      OwnerTurnDumpErrors.duplicateKey({ firstLineNumber: 7, lineNumber: 8, table: "owner_turn" }),
      OwnerTurnDumpErrors.rowMalformed({
        lineNumber: 12,
        reason: "its path, turn, sha or family is not the column's shape",
        table: "owner_turn_location",
      }),
    ]);
    const repeatedLocation = unwrap(
      fold({
        lines: dump({
          locations: [locationLine(), locationLine().replace("2026-09-22 22:25:43+00", "2026-09-23 22:25:43+00")],
        }),
      }),
    );
    expect(repeatedLocation.refused).toEqual([
      OwnerTurnDumpErrors.duplicateKey({ firstLineNumber: 10, lineNumber: 11, table: "owner_turn_location" }),
    ]);
  });

  it("refuses a location whose turn or family is not the one its path names", () => {
    const load = unwrap(
      fold({
        lines: dump({
          locations: [locationLine().replace("\t1-1\t", "\t1-2\t"), locationLine({ family: "scratch-turn" })],
        }),
      }),
    );

    expect(load.refused).toEqual(
      [10, 11].map((lineNumber) =>
        OwnerTurnDumpErrors.rowMalformed({
          lineNumber,
          reason: "its turn or family is not the one its path names",
          table: "owner_turn_location",
        }),
      ),
    );
  });

  it("refuses a location with a family the table does not hold, and a row with a null", () => {
    const load = unwrap(
      fold({ lines: dump({ locations: [locationLine({ family: "voice" }), `\\N\t${SHA}\tt\tarchive-turn\tx\ty`] }) }),
    );

    expect(load.refused.map((refusal) => refusal.message)).toEqual([
      "owner_turn_location line 10: its path, turn, sha or family is not the column's shape",
      "owner_turn_location line 11: field 1 is null",
    ]);
  });

  it("refuses a stored instant that is not UTC to the millisecond", () => {
    const line = locationLine().replace("2026-09-22 22:25:43+00", "2026-09-22 22:25:43+10");

    expect(unwrap(fold({ lines: dump({ locations: [line] }) })).refused[0]!.message).toContain(
      "its file_modified_at or recorded_at is not a UTC instant",
    );
  });

  it("fails the whole dump when a section is missing, unterminated, or declares other columns", () => {
    expect(unwrapErr(fold({ lines: dump().slice(0, -4) })).code).toBe("DUMP_SECTION_MISSING");
    expect(unwrapErr(fold({ lines: dump().slice(0, -1) })).message).toBe(
      "owner_turn_location: its last COPY section never reaches \\.",
    );
    expect(unwrapErr(fold({ lines: dump().slice(0, -3) })).message).toBe(
      "owner_turn_location: no COPY section reaches its \\. terminator",
    );
    const renamed = dump().map((line) => line.replace("first_imported_at", "imported_at"));
    expect(unwrapErr(fold({ lines: renamed })).message).toContain("its COPY declares");
  });

  it("fails a dump whose repeated section is left open at the end, though an earlier one for that table closed", () => {
    const truncated = [...dump(), `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`, bodyLine()];

    expect(unwrapErr(fold({ lines: truncated })).message).toBe("owner_turn: its last COPY section never reaches \\.");
  });

  it("fails a dump cut inside a section it steps over, and loads the same dump once that section closes", () => {
    const skipped = ["COPY public.owner_profile (revision, body) FROM stdin;", "1\tunfinished"];

    expect(unwrapErr(fold({ lines: [...dump(), ...skipped] })).message).toBe(
      "a table this load skips: the dump ends inside a COPY section this load steps over, so the file was cut",
    );
    expect(unwrap(fold({ lines: [...dump(), ...skipped, "\\."] })).bodies).toHaveLength(1);
  });

  it("steps over a section for any table name, a digit, a capital or a quoted one, never reading its rows as ours", () => {
    const clean = unwrap(fold({ lines: dump() }));
    for (const name of ["public.other2", 'public."Owner Turn"', "audit.owner_turn"]) {
      const skipped = [
        `COPY ${name} (payload) FROM stdin;`,
        `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
        "garbage",
        "\\.",
      ];

      expect(unwrap(fold({ lines: [...skipped, ...dump()] }))).toEqual(clean);
    }
  });

  it("reads every spelling of our own table as ours, so a quoted or capitalised copy's repeated row is refused", () => {
    for (const name of ['public."owner_turn"', "PUBLIC.OWNER_TURN", "owner_turn"]) {
      const repeated = [`COPY ${name} (${DUMP_SECTIONS.owner_turn}) FROM stdin;`, bodyLine(), "\\."];

      expect(unwrap(fold({ lines: [...dump(), ...repeated] })).refused).toEqual([
        OwnerTurnDumpErrors.duplicateKey({ firstLineNumber: 7, lineNumber: 13, table: "owner_turn" }),
      ]);
    }
  });

  it("refuses a dump with a COPY header whose table name will not parse, rather than stepping over it", () => {
    for (const header of [
      'COPY public."owner_turn (payload) FROM stdin;',
      `COPY\tU&"publ\\0069c".U&"owner\\005fturn" (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
    ]) {
      const unparsed = [header, bodyLine(), "\\."];

      expect(unwrapErr(fold({ lines: [...dump(), ...unparsed] })).message).toBe(
        `a COPY header: its table name will not parse as a PostgreSQL identifier: ${header}`,
      );
    }
  });
});
