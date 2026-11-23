/**
 * A dump file read off disk and folded: the lines a real file carries reach the fold intact, a CRLF dump reads the
 * same as an LF one, and a missing file is a named refusal rather than an empty load.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { OwnerTurnDumpErrors } from "../../../../store/ownerTurnDump/errors.js";
import { DUMP_SECTIONS } from "../../../../store/ownerTurnDump/project.js";
import { readOwnerTurnDump } from "../../../../store/ownerTurnDump/read.js";

const SHA = createHash("sha256").update("Merge it.").digest("hex");

/** A minimal dump holding one body at one location. */
const DUMP_LINES = [
  `COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;`,
  `${SHA}\tMerge it.\t9\t2026-09-25 12:18:54.838+00`,
  "\\.",
  `COPY public.owner_turn_location (${DUMP_SECTIONS.owner_turn_location}) FROM stdin;`,
  `handovers/archive/owner-turn-1-1.txt\t${SHA}\t1-1\tarchive-turn\t2026-09-05 01:41:34.805+00\t2026-09-22 22:25:43+00`,
  "\\.",
];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "owner-turn-dump-read-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readOwnerTurnDump", () => {
  it("folds every line of the file into its bodies and locations", async () => {
    const path = join(dir, "owner-tables.sql");
    writeFileSync(path, `${DUMP_LINES.join("\n")}\n`);

    const load = unwrap(await readOwnerTurnDump({ path }));

    expect(load.bodies.map((body) => body.body)).toEqual(["Merge it."]);
    expect(load.locations.map((location) => location.relativePath)).toEqual(["handovers/archive/owner-turn-1-1.txt"]);
    expect(load.refused).toEqual([]);
  });

  it("reads a CRLF dump exactly as an LF one, the carriage return never reaching a field", async () => {
    const path = join(dir, "owner-tables-crlf.sql");
    writeFileSync(path, `${DUMP_LINES.join("\r\n")}\r\n`);

    const load = unwrap(await readOwnerTurnDump({ path }));

    expect(load.bodies.map((body) => body.byteLength)).toEqual([9]);
    expect(load.refused).toEqual([]);
  });

  it("refuses a malformed UTF-8 byte rather than storing the U+FFFD a lossy decode would make of it", async () => {
    const path = join(dir, "owner-tables-malformed.sql");
    const replacementSha = createHash("sha256").update("�").digest("hex");
    writeFileSync(
      path,
      Buffer.concat([
        Buffer.from(`COPY public.owner_turn (${DUMP_SECTIONS.owner_turn}) FROM stdin;\n${replacementSha}\t`),
        Buffer.from([0x80]),
        Buffer.from("\t3\t2026-09-25 12:18:54.838+00\n\\.\n"),
      ]),
    );

    expect(unwrapErr(await readOwnerTurnDump({ path })).code).toBe("DUMP_UNREADABLE");
  });

  it("reads a bare CR as a line break, as COPY does", async () => {
    const path = join(dir, "owner-tables-cr.sql");
    writeFileSync(path, `${DUMP_LINES.join("\r")}\r`);

    expect(unwrap(await readOwnerTurnDump({ path })).bodies.map((body) => body.body)).toEqual(["Merge it."]);
  });

  it("refuses a file that is not there, naming it", async () => {
    const path = join(dir, "absent.sql");

    expect(unwrapErr(await readOwnerTurnDump({ path }))).toEqual(
      OwnerTurnDumpErrors.unreadable({ cause: "no such file", path }),
    );
  });

  it("refuses a file it cannot reach as unreadable, never as a file that is not there", async () => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    const path = join(locked, "owner-tables.sql");
    writeFileSync(path, `${DUMP_LINES.join("\n")}\n`);
    chmodSync(locked, 0o000);
    try {
      const refusal = unwrapErr(await readOwnerTurnDump({ path }));

      expect(refusal.code).toBe("DUMP_UNREADABLE");
      expect(refusal.message).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o700);
    }
  });
});
