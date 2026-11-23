/**
 * Generating a migration through `drizzle-kit`, with the process replaced by a typed fake: the sorted `.sql`
 * names in a directory, the exact command line (explicit dialect, schema and an out path RELATIVE to the
 * repository, with the store URL blanked), the before/after/created report, and the two failures — a launch
 * error, and a non-zero exit carrying the last twelve lines of output and no more.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { StoreErrors } from "../../../store/errors.js";
import { type GenerateCommand, generateMigrations, migrationFileNames } from "../../../store/generate.js";

let cwd: string;
let out: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "store-generate-"));
  out = join(cwd, "drizzle");
  mkdirSync(out);
});

afterEach(() => {
  rmSync(cwd, { force: true, recursive: true });
});

/** A command that exits cleanly having printed nothing. */
const cleanExit: GenerateCommand = () => ({ status: 0, stderr: "", stdout: "" });

describe("migrationFileNames", () => {
  it("is empty for a directory that does not exist yet", () => {
    expect(migrationFileNames({ dir: join(cwd, "absent") })).toEqual([]);
  });

  it("lists only the .sql names, sorted", () => {
    writeFileSync(join(out, "0002_b.sql"), "");
    writeFileSync(join(out, "0000_a.sql"), "");
    writeFileSync(join(out, "notes.md"), "");
    mkdirSync(join(out, "meta"));

    expect(migrationFileNames({ dir: out })).toEqual(["0000_a.sql", "0002_b.sql"]);
  });
});

describe("generateMigrations", () => {
  it("runs the repository's drizzle-kit with explicit dialect, schema and a relative out, the store URL blanked", () => {
    const calls: Parameters<GenerateCommand>[0][] = [];
    const runCommand: GenerateCommand = (input) => {
      calls.push(input);
      return { status: 0, stderr: "", stdout: "" };
    };

    unwrap(generateMigrations({ cwd, out, runCommand }));

    expect(
      calls.map(({ args, file, options }) => ({ args, cwd: options.cwd, encoding: options.encoding, file })),
    ).toEqual([
      {
        args: ["generate", "--dialect", "postgresql", "--schema", "src/store/schema.ts", "--out", "drizzle"],
        cwd,
        encoding: "utf8",
        file: join(cwd, "node_modules", ".bin", "drizzle-kit"),
      },
    ]);
    expect(calls[0]!.options.env!["SLOPWEAVER_STORE_URL"]).toBe("");
  });

  it("reports the files before and after, and only the new one as created", () => {
    writeFileSync(join(out, "0000_a.sql"), "");
    const runCommand: GenerateCommand = () => {
      writeFileSync(join(out, "0001_b.sql"), "");
      return { status: 0, stderr: "", stdout: "" };
    };

    expect(unwrap(generateMigrations({ cwd, out, runCommand }))).toEqual({
      after: ["0000_a.sql", "0001_b.sql"],
      before: ["0000_a.sql"],
      created: ["0001_b.sql"],
    });
  });

  it("creates nothing when the schema and the migrations already agree", () => {
    writeFileSync(join(out, "0000_a.sql"), "");

    expect(unwrap(generateMigrations({ cwd, out, runCommand: cleanExit }))).toEqual({
      after: ["0000_a.sql"],
      before: ["0000_a.sql"],
      created: [],
    });
  });

  it("is GENERATE_LAUNCH_FAILED when the process could not start", () => {
    const runCommand: GenerateCommand = () => ({
      error: new Error("spawn drizzle-kit ENOENT"),
      status: null,
      stderr: "",
      stdout: "",
    });

    const error = unwrapErr(generateMigrations({ cwd, out, runCommand }));

    expect(error.code).toBe("GENERATE_LAUNCH_FAILED");
    expect(error.message).toBe("drizzle-kit generate could not start: spawn drizzle-kit ENOENT");
    expect(error).toEqual(StoreErrors.generateLaunchFailed({ detail: "spawn drizzle-kit ENOENT" }));
  });

  it("is GENERATE_EXITED keeping twelve output lines whole and dropping the first of thirteen", () => {
    const lines = Array.from({ length: 13 }, (_, index) => `line ${String(index + 1)}`);
    const twelve: GenerateCommand = () => ({
      status: 7,
      stderr: lines.slice(7, 13).join("\n"),
      stdout: lines.slice(1, 7).join("\n"),
    });
    const thirteen: GenerateCommand = () => ({
      status: 7,
      stderr: lines.slice(7, 13).join("\n"),
      stdout: lines.slice(0, 7).join("\n"),
    });

    const kept = unwrapErr(generateMigrations({ cwd, out, runCommand: twelve }));
    const trimmed = unwrapErr(generateMigrations({ cwd, out, runCommand: thirteen }));

    expect(kept.code).toBe("GENERATE_EXITED");
    expect(kept).toEqual(StoreErrors.generateExited({ status: 7, tail: lines.slice(1) }));
    expect(kept).toMatchObject({ reasons: ["drizzle-kit generate exited 7", ...lines.slice(1)], status: 7 });
    expect(trimmed).toMatchObject({ code: "GENERATE_EXITED", status: 7 });
    expect(trimmed.code).toBe("GENERATE_EXITED");
    expect(trimmed.message).toBe(
      "drizzle-kit generate exited 7; line 2; line 3; line 4; line 5; line 6; line 7; line 8; line 9; line 10; line 11; line 12; line 13",
    );
  });
});
