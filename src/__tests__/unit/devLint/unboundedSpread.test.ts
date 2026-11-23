/**
 * The unbounded-spread gate's pure scanner, on inline fixtures — so the gate never scans itself and stays
 * falsifiable without touching the filesystem.
 */
import { describe, expect, it } from "vitest";
import { isScannablePath, readsFromDisk, scanUnboundedSpread } from "../../../devLint/unboundedSpread.js";

describe("readsFromDisk", () => {
  it("recognises each filesystem read that puts a module in scope", () => {
    expect(readsFromDisk({ content: "const x = readFileSync(p, 'utf8');" })).toBe(true);
    expect(readsFromDisk({ content: "const x = readdirSync(dir);" })).toBe(true);
    expect(readsFromDisk({ content: "statSync(full).isDirectory();" })).toBe(true);
  });

  it("leaves a module that only pages over the network out of scope", () => {
    expect(readsFromDisk({ content: "const page = await api.list({ cursor });" })).toBe(false);
  });
});

describe("scanUnboundedSpread", () => {
  it("flags a spread-append in a module that reads from disk", () => {
    const content = ["const raw = readFileSync(path, 'utf8');", "rows.push(...parsed.value);"].join("\n");

    const hits = scanUnboundedSpread({ content, path: "src/corpus/x.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.excerpt).toBe("rows.push(...parsed.value);");
    expect(hits[0]!.path).toBe("src/corpus/x.ts");
  });

  it("flags the exact shape that caused the outage", () => {
    const content = [
      "const parsed = parseCorpusRecords({ content: readFileSync(file, 'utf8') });",
      "      records.push(...parsed.value);",
    ].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/corpus/corpusStore.ts" })).toHaveLength(1);
  });

  it("flags a recursive-walk spread", () => {
    const content = ["entries = readdirSync(dir);", "files.push(...jsonlFiles({ dir: full }));"].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/corpus/y.ts" })).toHaveLength(1);
  });

  it("ignores a spread-append in a module that never touches disk", () => {
    const content = ["const page = await api.list({ cursor });", "items.push(...page.items);"].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/lib/paging.ts" })).toHaveLength(0);
  });

  it("accepts appendAll as the sanctioned replacement", () => {
    const content = ["const raw = readFileSync(path, 'utf8');", "appendAll({ from: parsed.value, into: rows });"].join(
      "\n",
    );

    expect(scanUnboundedSpread({ content, path: "src/corpus/x.ts" })).toHaveLength(0);
  });

  it("does not trip on prose describing the forbidden shape", () => {
    const content = [
      "const raw = readFileSync(path, 'utf8');",
      "// never `into.push(...from)` — the argument count is the spread source's size",
      " * A spread like `records.push(...parsed.value)` blows the argument limit.",
      "/* rows.push(...everything); */",
    ].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/corpus/x.ts" })).toHaveLength(0);
  });

  it("does not flag Math.max/min spreads, which are scoped out deliberately", () => {
    const content = ["const s = statSync(p);", "return Math.max(...times);"].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/silver/loadDerivedRoster.ts" })).toHaveLength(0);
  });

  it("reports every hit in a file, not just the first", () => {
    const content = ["readFileSync(p);", "rows.push(...read.rows);", "warnings.push(...read.warnings);"].join("\n");

    expect(scanUnboundedSpread({ content, path: "src/corpus/members/store.ts" })).toHaveLength(2);
  });
});

describe("isScannablePath", () => {
  it("scans src TypeScript", () => {
    expect(isScannablePath({ path: "src/corpus/corpusStore.ts" })).toBe(true);
  });

  it("skips tests, whose fixtures deliberately build large arrays", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/corpus/corpusStore.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/corpus/thing.test.ts" })).toBe(false);
  });

  it("skips the gate's own files", () => {
    expect(isScannablePath({ path: "src/devLint/unboundedSpread.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/unboundedSpread.entry.ts" })).toBe(false);
  });

  it("skips non-src and non-TypeScript paths", () => {
    expect(isScannablePath({ path: "scripts/check-hygiene.sh" })).toBe(false);
    expect(isScannablePath({ path: "src/corpus/data.json" })).toBe(false);
  });
});
