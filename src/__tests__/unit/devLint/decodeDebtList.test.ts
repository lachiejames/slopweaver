import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeDebtList, readCommittedInput } from "../../../devLint/decodeDebtList.js";
import { DevLintInputErrors } from "../../../devLint/errors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const schema = z.object({ modules: z.array(z.string().min(1)) });
const shape = '{ modules: ["path", …] }';

describe("decodeDebtList", () => {
  it("decodes a well-formed list", () => {
    const result = decodeDebtList({ label: "a-gate baseline", schema, shape, text: '{"modules":["src/a.ts"]}' });
    expect(unwrap(result).modules).toEqual(["src/a.ts"]);
  });

  it("decodes an empty list", () => {
    const result = decodeDebtList({ label: "a-gate baseline", schema, shape, text: '{"modules":[]}' });
    expect(unwrap(result).modules).toEqual([]);
  });

  it("carries the caller's label into a parse failure", () => {
    const result = decodeDebtList({ label: "a-gate baseline", schema, shape, text: "not json" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(
      DevLintInputErrors.baselineMalformed({ detail: "invalid JSON", label: "a-gate baseline" }),
    );
    expect(unwrapErr(result).message).toBe("a-gate baseline: invalid JSON");
  });

  it("names the accepted shape when the JSON decodes but does not fit", () => {
    const result = decodeDebtList({ label: "a-gate baseline", schema, shape, text: "{}" });
    expect(unwrapErr(result)).toEqual(
      DevLintInputErrors.baselineShapeInvalid({ expected: shape, label: "a-gate baseline" }),
    );
    expect(unwrapErr(result).message).toBe('a-gate baseline: unexpected shape (expected { modules: ["path", …] })');
  });

  it("rejects an entry the schema refuses, not only a missing key", () => {
    const result = decodeDebtList({ label: "a-gate baseline", schema, shape, text: '{"modules":[""]}' });
    expect(unwrapErr(result).message).toBe('a-gate baseline: unexpected shape (expected { modules: ["path", …] })');
  });

  it("uses a different label for a different gate, so two lists never read as one", () => {
    const result = decodeDebtList({ label: "b-gate debt list", schema, shape, text: "{}" });
    expect(unwrapErr(result).message).toBe('b-gate debt list: unexpected shape (expected { modules: ["path", …] })');
  });
});

describe("readCommittedInput", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("returns a committed file's text unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "debt-list-"));
    dirs.push(dir);
    const path = join(dir, "baseline.json");
    writeFileSync(path, '{"modules":[]}\n');
    expect(unwrap(readCommittedInput({ kind: "debt list", path }))).toBe('{"modules":[]}\n');
  });

  it("names a floor file that is not there by its kind and path", () => {
    const dir = mkdtempSync(join(tmpdir(), "debt-list-"));
    dirs.push(dir);
    const path = join(dir, "absent.json");
    const refused = unwrapErr(readCommittedInput({ kind: "floor file", path }));
    expect(refused).toEqual(DevLintInputErrors.baselineUnreadable({ kind: "floor file", path }));
    expect(refused.message).toBe(`floor file missing or unreadable at ${path}`);
  });
});
