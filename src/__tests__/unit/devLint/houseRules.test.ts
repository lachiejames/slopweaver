import { describe, expect, it } from "vitest";
import { isScannablePath, scanHouseRules } from "../../../devLint/houseRules.js";

describe("scanHouseRules — always-on rules (production and test code)", () => {
  it('flags `x ?? ""`', () => {
    const hits = scanHouseRules({ content: 'const y = x ?? "";', path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-empty-string-coalesce"]);
  });

  it('does not flag `x ?? "fallback"`', () => {
    expect(scanHouseRules({ content: 'const y = x ?? "fallback";', path: "src/x.ts" })).toEqual([]);
  });

  it("flags `x ?? ``` (empty template)", () => {
    const hits = scanHouseRules({ content: "const y = x ?? ``;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-empty-template-coalesce"]);
  });

  it("does not flag a non-empty template fallback", () => {
    expect(scanHouseRules({ content: "const y = x ?? `fallback`;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags `xs.sort()`", () => {
    const hits = scanHouseRules({ content: "xs.sort();", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-in-place-sort"]);
  });

  it("flags `xs['sort']()`", () => {
    const hits = scanHouseRules({ content: "xs['sort']();", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-in-place-sort"]);
  });

  it("does not flag `xs.toSorted()`", () => {
    expect(scanHouseRules({ content: "xs.toSorted();", path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag a `.sort` member read that isn't called", () => {
    expect(scanHouseRules({ content: "const f = xs.sort;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags the bare identifier isDirectInvocation", () => {
    const hits = scanHouseRules({ content: "if (isDirectInvocation) { run(); }", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-is-direct-invocation"]);
  });

  it("flags process.argv[1]", () => {
    const hits = scanHouseRules({ content: "const p = process.argv[1];", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-process-argv-1"]);
  });

  it("does not flag process.argv[0] or process.argv.length", () => {
    expect(
      scanHouseRules({ content: "const p = process.argv[0]; const n = process.argv.length;", path: "src/x.ts" }),
    ).toEqual([]);
  });

  it("does not count a matching pattern inside a comment or string (real AST, not text)", () => {
    const content = ['// x ?? ""', '"process.argv[1]"', "const n = 1;"].join("\n");
    expect(scanHouseRules({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("still flags always-on rules inside a *.test.ts file", () => {
    const hits = scanHouseRules({ content: 'const y = x ?? "";', path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-empty-string-coalesce"]);
  });
});

describe("scanHouseRules — cast bans (production code only)", () => {
  it("flags `metadata as T`", () => {
    const hits = scanHouseRules({ content: "const m = metadata as Thing;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-metadata-cast"]);
  });

  it("flags `foo.metadata as T`", () => {
    const hits = scanHouseRules({ content: "const m = foo.metadata as Thing;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-metadata-cast"]);
  });

  it("flags `<T>metadata`", () => {
    const hits = scanHouseRules({ content: "const m = <Thing>metadata;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-metadata-cast"]);
  });

  it("does not flag casting an unrelated identifier", () => {
    expect(scanHouseRules({ content: "const m = payload as Thing;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags `x as any`", () => {
    const hits = scanHouseRules({ content: "const y = x as any;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-as-any"]);
  });

  it("flags `<any>x`", () => {
    const hits = scanHouseRules({ content: "const y = <any>x;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-as-any"]);
  });

  it("does not flag `x as SomeType`", () => {
    expect(scanHouseRules({ content: "const y = x as SomeType;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags a double cast `x as unknown as T`", () => {
    const hits = scanHouseRules({ content: "const y = x as unknown as Thing;", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-double-cast"]);
  });

  it("does not flag a single cast", () => {
    expect(scanHouseRules({ content: "const y = x as unknown;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags z.any()", () => {
    const hits = scanHouseRules({ content: "const s = z.any();", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-z-any"]);
  });

  it("does not flag z.string()", () => {
    expect(scanHouseRules({ content: "const s = z.string();", path: "src/x.ts" })).toEqual([]);
  });

  it("flags z.coerce.boolean()", () => {
    const hits = scanHouseRules({ content: "const s = z.coerce.boolean();", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-z-coerce-boolean"]);
  });

  it("does not flag z.coerce.number()", () => {
    expect(scanHouseRules({ content: "const s = z.coerce.number();", path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag any cast ban inside a *.test.ts file", () => {
    expect(scanHouseRules({ content: "const y = x as any;", path: "src/x.test.ts" })).toEqual([]);
  });
});

describe("scanHouseRules — the hand-rolled crash-durable-write ban", () => {
  it("flags a rename whose source is a temp file", () => {
    const hits = scanHouseRules({ content: "renameSync(tmp, path);", path: "src/corpus/watermark.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-hand-rolled-atomic-write"]);
  });

  it("flags the other spellings a staging file goes by", () => {
    const content = [
      "renameSync(tmpPath, path);",
      "renameSync(temporary, path);",
      "renameSync(staged, path);",
      "renameSync(temporaryRecord, recordPath);",
      "await rename(join(dir, `.x.${id}.partial`), path);",
    ].join("\n");
    const hits = scanHouseRules({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it("flags a rename reached through a namespace import", () => {
    const hits = scanHouseRules({ content: "fs.renameSync(tmp, path);", path: "src/x.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-hand-rolled-atomic-write"]);
  });

  it("does not flag a rename that moves a finished file or directory aside", () => {
    const content = ["renameSync(paths.verdict, archived);", "renameSync(archive, directory);"].join("\n");
    expect(scanHouseRules({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag a call to the primitive itself", () => {
    const content = 'writeFileAtomic({ contents: "{}\\n", path });';
    expect(scanHouseRules({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag the one module that IS the durable write", () => {
    const hits = scanHouseRules({ content: "renameSync(temporary, path);", path: "src/lib/writeAtomic.ts" });
    expect(hits).toEqual([]);
  });

  it("does not flag a rename that publishes a HARDLINK — there are no bytes of ours to fsync", () => {
    const content = [
      "function relink({ entry, path }: { entry: string; path: string }): void {",
      "  const temp = `${path}.tmp`;",
      "  linkSync(entry, temp);",
      "  renameSync(temp, path);",
      "}",
    ].join("\n");
    expect(scanHouseRules({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("still flags a written temp file in a module that also links one elsewhere", () => {
    const content = [
      "function relink({ entry, path }: { entry: string; path: string }): void {",
      "  const temp = `${path}.tmp`;",
      "  linkSync(entry, temp);",
      "  renameSync(temp, path);",
      "}",
      "function save({ path, bytes }: { path: string; bytes: Buffer }): void {",
      "  const temp = `${path}.tmp`;",
      "  writeFileSync(temp, bytes);",
      "  renameSync(temp, path);",
      "}",
    ].join("\n");
    const hits = scanHouseRules({ content, path: "src/x.ts" });
    expect(hits.map((hit) => hit.line)).toEqual([9]);
  });

  it("applies inside a *.test.ts file too", () => {
    const hits = scanHouseRules({ content: "renameSync(tmp, path);", path: "src/x.test.ts" });
    expect(hits.map((h) => h.id)).toEqual(["no-hand-rolled-atomic-write"]);
  });
});

describe("isScannablePath", () => {
  it("includes a source under src/, eval/ or hooks/", () => {
    expect(isScannablePath({ path: "src/cli/commands/distil/run.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/scoreboardRun.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse-main-checkout-dirty-guard.ts" })).toBe(true);
  });

  it("excludes a non-TS file and this gate's own sources", () => {
    expect(isScannablePath({ path: "eslint.config.js" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/houseRules.ts" })).toBe(false);
  });
});
