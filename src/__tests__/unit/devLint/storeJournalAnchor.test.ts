/**
 * The store-journal-anchor gate's pure half: both arms of its criterion, and the two shapes it must NOT
 * flag. The scope predicate is asserted directly rather than inferred from a clean whole-repo run, because
 * a scope that is wrong fails silently — it reports clean over the files it never selected.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanStoreJournalAnchor } from "../../../devLint/storeJournalAnchor.js";

describe("arm 1 — process.cwd() under src/store/", () => {
  it("flags the call, at its own line", () => {
    const hits = scanStoreJournalAnchor({
      content: ["export function root(): string {", "  return process.cwd();", "}", ""].join("\n"),
      path: "src/store/lifecycle.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.path).toBe("src/store/lifecycle.ts");
    expect(hits[0]!.message).toContain("anchors the committed migration journal");
  });

  it("leaves the identical call alone outside the store tree", () => {
    const hits = scanStoreJournalAnchor({
      content: "export const here = process.cwd();\n",
      path: "src/cli/commands/store/run.ts",
    });
    expect(hits).toEqual([]);
  });
});

describe("arm 2 — a cwd argument to the journal family", () => {
  it("flags a cwd built from the operator's directory", () => {
    const hits = scanStoreJournalAnchor({
      content: "const r = await verifyStore({ cwd: process.cwd(), url });\n",
      path: "src/cli/commands/store/run.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.message).toContain("`verifyStore` resolves the committed migration journal");
  });

  it("flags a cwd reached through a local name, because the gate cannot see what that name holds", () => {
    const hits = scanStoreJournalAnchor({
      content: ["const root = somewhereElse();", "const r = await connectStore({ cwd: root });", ""].join("\n"),
      path: "src/cli/commands/knowledge/recall.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
  });

  it("flags a shorthand forward", () => {
    const hits = scanStoreJournalAnchor({
      content: "const r = await pushStore({ cwd, generate, url });\n",
      path: "src/cli/commands/store/lifecycleRun.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("`pushStore` resolves the committed migration journal");
  });

  it("accepts the anchor call, parenthesised or not", () => {
    const hits = scanStoreJournalAnchor({
      content: [
        "const a = await verifyStore({ cwd: installedTreeRoot({ importMetaUrl: import.meta.url }), url });",
        "const b = await resetStore({ acknowledged, cwd: (installedTreeRoot({ importMetaUrl: import.meta.url })), url });",
        "",
      ].join("\n"),
      path: "src/cli/commands/store/lifecycleRun.ts",
    });
    expect(hits).toEqual([]);
  });

  it("accepts the ordinary spelling, which passes no cwd at all", () => {
    const hits = scanStoreJournalAnchor({
      content: "const opened = await connectStore({ max: 4, home });\n",
      path: "src/cli/commands/refresh/storeLeg.ts",
    });
    expect(hits).toEqual([]);
  });

  it("leaves a cwd on a function outside the family alone", () => {
    const hits = scanStoreJournalAnchor({
      content: "const r = generateMigrations({ cwd: process.cwd(), out: scratch });\n",
      path: "src/devLint/drizzleMigrationsRun.ts",
    });
    expect(hits).toEqual([]);
  });

  it("does not apply arm 2 inside the store, where a cwd is a forward of an already-resolved root", () => {
    const hits = scanStoreJournalAnchor({
      content: "const state = await readMigrationState({ cwd, sql });\n",
      path: "src/store/client.ts",
    });
    expect(hits).toEqual([]);
  });
});

describe("the stated blind spots are real, so the header cannot drift from the code", () => {
  it("cannot see a cwd carried in through a spread", () => {
    const hits = scanStoreJournalAnchor({
      content: "const opened = await connectStore({ ...opts });\n",
      path: "src/cli/commands/knowledge/recall.ts",
    });
    expect(hits).toEqual([]);
  });

  it("cannot see an argument that is not an object literal", () => {
    const hits = scanStoreJournalAnchor({
      content: "const opened = await connectStore(home === undefined ? {} : { home });\n",
      path: "src/cli/commands/knowledge/record.ts",
    });
    expect(hits).toEqual([]);
  });

  it("cannot see a family member reached through an alias", () => {
    const hits = scanStoreJournalAnchor({
      content: ["const open = connectStore;", "const opened = await open({ cwd: process.cwd() });", ""].join("\n"),
      path: "src/cli/commands/knowledge/list.ts",
    });
    expect(hits).toEqual([]);
  });
});

describe("scope", () => {
  it.each([
    ["src/store/lifecycle.ts", true],
    ["src/cli/commands/knowledge/recall.ts", true],
    ["src/__tests__/unit/store/lifecycle.test.ts", false],
    ["src/__tests__/subprocess/cli/commands/store/journalFromTree.test.ts", false],
    ["docs/store.md", false],
    ["src/devLint/storeJournalAnchor.ts", false],
    ["src/devLint/storeJournalAnchor.entry.ts", false],
  ])("%s is scannable: %s", (path, expected) => {
    expect(isScannablePath({ path })).toBe(expected);
  });
});
