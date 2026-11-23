/**
 * The old-file readers a one-time import consults: a file that is genuinely not there is `absent`, and
 * anything that only LOOKS missing — a symlink whose target is gone — is unreadable, so the import marker is
 * never stamped over a register nobody could read. And the connection wrapper every register shares, which never
 * lets a failed close mask the body's own refusal.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  confirmEmptyRead,
  ensureImported,
  homeFileWitnessVerdict,
  type ImportOnceRows,
  overConnection,
  readJsonImportSource,
  readJsonlImportSource,
  type StoreStepFailure,
} from "../../../store/registerImport.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway directory removed after the test.
 *
 * @returns its path
 */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "register-import-"));
  dirs.push(dir);
  return dir;
}

/** A line decoder that keeps a string field `id`. */
const decodeId: (value: unknown) => Result<string, string> = (value) => {
  if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") {
    return ok(value.id);
  }
  return err("carries no id");
};

/** A document decoder over an array of ids. */
const decodeIds: (value: unknown) => Result<readonly string[]> = (value) => {
  if (Array.isArray(value) && value.every((one) => typeof one === "string")) {
    return ok(value);
  }
  return err(["the document is not a list of ids"]);
};

describe("readJsonlImportSource", () => {
  it("answers absent when no file was ever written", () => {
    const path = join(freshDir(), "register.jsonl");
    expect(unwrap(readJsonlImportSource({ decodeLine: decodeId, path }))).toEqual({ state: "absent" });
  });

  it("reads every line in file order", () => {
    const path = join(freshDir(), "register.jsonl");
    writeFileSync(path, '{"id":"a"}\n\n{"id":"b"}\n');
    expect(unwrap(readJsonlImportSource({ decodeLine: decodeId, path }))).toEqual({
      records: ["a", "b"],
      state: "present",
    });
  });

  it("refuses a dangling symlink as unreadable rather than reading it as absent", () => {
    const dir = freshDir();
    const path = join(dir, "register.jsonl");
    symlinkSync(join(dir, "gone.jsonl"), path);
    const problem = unwrapErr(readJsonlImportSource({ decodeLine: decodeId, path }));
    expect(problem.kind).toBe("unreadable");
    expect(problem.path).toBe(path);
  });

  it("refuses a line holding a byte that is not UTF-8 rather than importing its repaired text", () => {
    const path = join(freshDir(), "register.jsonl");
    writeFileSync(
      path,
      Buffer.concat([Buffer.from('{"id":"a"}\n{"id":"acme/'), Buffer.from([0x96]), Buffer.from('"}\n')]),
    );
    expect(unwrapErr(readJsonlImportSource({ decodeLine: decodeId, path }))).toEqual({
      kind: "invalid",
      path,
      problems: ["line 2: is not JSON"],
    });
  });
});

describe("readJsonImportSource", () => {
  it("answers absent when no file was ever written", () => {
    const path = join(freshDir(), "register.json");
    expect(unwrap(readJsonImportSource({ decodeDocument: decodeIds, path }))).toEqual({ state: "absent" });
  });

  it("reads the document's records", () => {
    const path = join(freshDir(), "register.json");
    writeFileSync(path, '["a","b"]');
    expect(unwrap(readJsonImportSource({ decodeDocument: decodeIds, path }))).toEqual({
      records: ["a", "b"],
      state: "present",
    });
  });

  it("refuses a dangling symlink as unreadable rather than reading it as absent", () => {
    const dir = freshDir();
    const path = join(dir, "register.json");
    symlinkSync(join(dir, "gone.json"), path);
    const problem = unwrapErr(readJsonImportSource({ decodeDocument: decodeIds, path }));
    expect(problem.kind).toBe("unreadable");
    expect(problem.path).toBe(path);
  });

  it("refuses a document holding a byte that is not UTF-8, never importing its repaired text", () => {
    const path = join(freshDir(), "register.json");
    writeFileSync(path, Buffer.concat([Buffer.from('["acme/'), Buffer.from([0x96]), Buffer.from('"]')]));
    const problem = unwrapErr(readJsonImportSource({ decodeDocument: decodeIds, path }));
    expect(problem.kind).toBe("unreadable");
    expect(problem.path).toBe(path);
  });
});

describe("overConnection", () => {
  const failingClose = { close: (): Promise<void> => Promise.reject(new Error("socket close failed")) };
  const unavailable = ({ doing }: { doing: string }): string => `unavailable: ${doing}`;

  it("keeps the body's own refusal when the close fails too, so a lost race never reads as an outage", async () => {
    const answer = await overConnection({
      body: () => Promise.resolve(err("conflict")),
      connect: () => Promise.resolve(ok(failingClose)),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe("conflict");
  });

  it("refuses a close that fails after a body that succeeded", async () => {
    const answer = await overConnection({
      body: () => Promise.resolve(ok("written")),
      connect: () => Promise.resolve(ok(failingClose)),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe("unavailable: close its connection");
  });
});

describe("confirmEmptyRead", () => {
  const unavailable = ({ doing, reason }: StoreStepFailure): string => `unavailable: ${doing}: ${reason}`;

  /**
   * Marker operations whose marker read answers the given result; `claim` is never part of this check.
   *
   * @param marker what the marker read answers
   * @returns the rows seam
   */
  function rowsWith({
    marker,
  }: {
    marker: Result<{ records: number; tableHasRows: boolean; observedRows?: number } | undefined, StoreStepFailure>;
  }): ImportOnceRows<string> {
    return {
      claim: () => Promise.resolve(err({ doing: "claim", reason: "never called here" })),
      marker: () => Promise.resolve(marker),
    };
  }

  it("refuses an empty read whose marker still claims records, the rows deleted after the first probe", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: ok({ records: 2, tableHasRows: false }) }),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe(
      "unavailable: trust its import marker: the marker says 2 record(s) were imported from the old file, and the table holds none",
    );
  });

  it("lets an empty read stand when the import brought nothing in", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: ok({ records: 0, tableHasRows: false }) }),
      unavailable,
    });
    expect(unwrap(answer)).toBe(undefined);
  });

  it("never consults the marker for a read that returned rows", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 1,
      rows: rowsWith({ marker: err({ doing: "read its import marker", reason: "would have refused" }) }),
      unavailable,
    });
    expect(unwrap(answer)).toBe(undefined);
  });

  it("judges a COUNTED marker by its count, naming both counts, even over tables that hold rows", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: ok({ observedRows: 1, records: 3, tableHasRows: true }) }),
      unavailable: ({ markerInconsistency }: StoreStepFailure) => markerInconsistency,
    });
    expect(unwrapErr(answer)).toEqual({ expected: 3, observed: 1 });
  });

  it("lets an empty read stand over a counted marker its tables still cover — every version retired", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: ok({ observedRows: 2, records: 2, tableHasRows: true }) }),
      unavailable,
    });
    expect(unwrap(answer)).toBe(undefined);
  });

  it("refuses a counted marker over MORE imported rows than it records — a second import", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: ok({ observedRows: 4, records: 2, tableHasRows: true }) }),
      unavailable: ({ markerInconsistency }: StoreStepFailure) => markerInconsistency,
    });
    expect(unwrapErr(answer)).toEqual({ expected: 2, observed: 4 });
  });

  it("refuses an empty read when the marker cannot be read again", async () => {
    const answer = await confirmEmptyRead({
      rowCount: 0,
      rows: rowsWith({ marker: err({ doing: "read its import marker", reason: "connection reset" }) }),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe("unavailable: read its import marker: connection reset");
  });
});

describe("ensureImported", () => {
  const unavailable = ({ doing, reason }: StoreStepFailure): string => `unavailable: ${doing}: ${reason}`;
  const undecodable = (): Result<never, string> => err("PRESS_IMPORT_INVALID: line 2 is not JSON");

  /**
   * Marker operations whose successive marker reads answer the given results in turn; `claim` counts its calls.
   *
   * @param markers what each marker read answers, first to last
   * @param claims where each claim is recorded
   * @returns the rows seam
   */
  function rowsAnswering({
    claims,
    markers,
  }: {
    claims: string[];
    markers: readonly ({ records: number; tableHasRows: boolean; observedRows?: number } | undefined)[];
  }): ImportOnceRows<string> {
    const queue = [...markers];
    return {
      claim: () => {
        claims.push("claim");
        return Promise.resolve(ok(true));
      },
      marker: () => Promise.resolve(ok(queue.shift())),
    };
  }

  it("answers from the store when a racing importer committed the marker while this call's file read failed", async () => {
    const claims: string[] = [];
    const answer = await ensureImported({
      readSource: undecodable,
      rows: rowsAnswering({ claims, markers: [undefined, { records: 1, tableHasRows: true }] }),
      unavailable,
    });
    expect(unwrap(answer)).toBe(undefined);
    expect(claims).toEqual([]);
  });

  it("keeps the file's own refusal when no marker appeared while it was read", async () => {
    const claims: string[] = [];
    const answer = await ensureImported({
      readSource: undecodable,
      rows: rowsAnswering({ claims, markers: [undefined, undefined] }),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe("PRESS_IMPORT_INVALID: line 2 is not JSON");
    expect(claims).toEqual([]);
  });

  it("refuses a standing counted marker whose tables hold fewer rows, without reading the file", async () => {
    const answer = await ensureImported({
      readSource: undecodable,
      rows: rowsAnswering({ claims: [], markers: [{ observedRows: 1, records: 2, tableHasRows: true }] }),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe(
      "unavailable: trust its import marker: the marker says 2 record(s) were imported from the old file, and the tables hold 1",
    );
  });

  it("refuses a racing marker that claims records over an empty table, rather than the file's refusal", async () => {
    const answer = await ensureImported({
      readSource: undecodable,
      rows: rowsAnswering({ claims: [], markers: [undefined, { records: 3, tableHasRows: false }] }),
      unavailable,
    });
    expect(unwrapErr(answer)).toBe(
      "unavailable: trust its import marker: the marker says 3 record(s) were imported from the old file, and the table holds none",
    );
  });
});

describe("homeFileWitnessVerdict", () => {
  const witness = { bytes: 12, sha256: `sha256:${"a".repeat(64)}` } as const;

  it("reads a file gone as retired, the imported bytes as unchanged, and different bytes as changed", () => {
    expect(homeFileWitnessVerdict({ current: null, marked: { state: "present", witness } })).toBe("retired");
    expect(homeFileWitnessVerdict({ current: null, marked: { state: "absent" } })).toBe("retired");
    expect(homeFileWitnessVerdict({ current: witness, marked: { state: "present", witness } })).toBe("unchanged");
    expect(homeFileWitnessVerdict({ current: { ...witness, bytes: 13 }, marked: { state: "present", witness } })).toBe(
      "changed",
    );
    expect(
      homeFileWitnessVerdict({
        current: { ...witness, sha256: `sha256:${"b".repeat(64)}` },
        marked: { state: "present", witness },
      }),
    ).toBe("changed");
  });

  it("reads a file that appeared after an absent import, or a marker with no witness, as changed", () => {
    expect(homeFileWitnessVerdict({ current: witness, marked: { state: "absent" } })).toBe("changed");
    expect(homeFileWitnessVerdict({ current: witness, marked: { state: "present", witness: null } })).toBe("changed");
  });
});
