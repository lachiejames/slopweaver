import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  importsOf,
  loadsOf,
  reexportsIn,
  resolutionsOf,
  stemsOf,
  unresolvedImportsOf,
  withRepoResolver,
} from "../prLeadModules.js";
import { countCallers, importersOf, JUDGED, JUDGEMENT, PRODUCTION, ROWS, SOURCE } from "./prLeadSeamsHarness.js";

describe("PR_LEAD_PRODUCERS", () => {
  it("judges the authoring lanes a teammate opens on", () => {
    expect(JUDGED.map(({ file }) => basename(file))).toEqual([
      "cardSend.ts",
      "dripRun.ts",
      "dripSendPlan.ts",
      "lifecycleRunAsMe.ts",
      "lifecycleRunEdit.ts",
      "lifecycleRunEditPoll.ts",
      "pollRun.ts",
    ]);
  });

  it("has every judging file call the judgement, and every proof case named in its proof file", () => {
    expect(JUDGED.filter(({ row }) => !JUDGEMENT.test(readFileSync(row.judgedAt, "utf8")))).toEqual([]);
    expect(JUDGED.filter(({ row }) => !readFileSync(row.proof, "utf8").includes(`"${row.proofCase}"`))).toEqual([]);
  });

  it("resolves an import by the file the compiler loads, whatever its spelling: a path, a `#` alias, any statement", () => {
    const SLACK = "src/cli/commands/slack";
    const from = `${SLACK}/cardWriteRun.ts`;
    const text = [
      'import { sendCard } from "./cardSend.js";',
      "export * from '../slack/cardSend.js';",
      'const later = await import("#lib/result.js");',
      'import { z } from "zod";',
      'import { gone } from "./noSuchModule.js";',
    ].join("\n");
    expect(withRepoResolver({ use: (resolver) => importsOf({ path: from, resolver, text }) })).toEqual([
      { resolved: [`${SLACK}/cardSend.ts`], specifier: "./cardSend.js" },
      { resolved: [`${SLACK}/cardSend.ts`], specifier: "../slack/cardSend.js" },
      { resolved: ["src/lib/result.ts"], specifier: "#lib/result.js" },
      { resolved: [], specifier: "./noSuchModule.js" },
    ]);
  });

  it("finds what any literal local specifier could load: a `createRequire` loader, a helper's argument, module syntax", () => {
    const text = [
      'createRequire(import.meta.url)("./cardSend.js").sendCard({});',
      'const at = "#lib/result.js";',
      "const css = '#fff'; const none = `./${dynamic}.js`;",
    ].join("\n");
    const targets = ["src/cli/commands/slack/cardSend.ts", "src/lib/result.ts", "src/lib/paging.ts"];
    const loaded = withRepoResolver({
      use: (resolver) => [...loadsOf({ path: "src/cli/commands/slack/cardWriteRun.ts", resolver, targets, text })],
    });
    expect(loaded.toSorted()).toEqual(["src/cli/commands/slack/cardSend.ts", "src/lib/result.ts"]);
    expect(stemsOf({ file: "src/x/cards/index.ts" })).toEqual(["index", "cards"]);
  });

  it("finds a path literal in another case, which a case-folding Mac loads, on any filesystem", () => {
    const targets = ["src/cli/commands/slack/cardSend.ts", "src/x/cards/index.ts"];
    const loads = ({ text }: { text: string }): readonly string[] =>
      withRepoResolver({
        use: (resolver) => [...loadsOf({ path: "src/cli/commands/slack/cardWriteRun.ts", resolver, targets, text })],
      });
    expect([
      loads({ text: 'createRequire(import.meta.url)("./CardSend.js").sendCard({});' }),
      loads({ text: 'load("./CARDSEND");' }),
      loads({ text: 'createRequire(import.meta.url)("./CARDSEND.JS").sendCard({});' }),
      loads({ text: 'load("../../../x/Cards");' }),
      loads({ text: 'load("./cardSender.js");' }),
    ]).toEqual([
      ["src/cli/commands/slack/cardSend.ts"],
      ["src/cli/commands/slack/cardSend.ts"],
      ["src/cli/commands/slack/cardSend.ts"],
      ["src/x/cards/index.ts"],
      [],
    ]);
  });

  it("reads a literal off the syntax tree: a `$`, an escape and a neighbouring literal leave its value intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-lead-literal-"));
    try {
      const imports = { "#card$": "./dollar.js", "#esc": "./escaped.js", "#next": "./neighbour.js" };
      writeFileSync(join(dir, "package.json"), JSON.stringify({ imports, type: "module" }));
      for (const target of ["dollar.js", "escaped.js", "neighbour.js"]) {
        writeFileSync(join(dir, target), "export const sendCard = () => 1;\n");
      }
      const text = [
        'createRequire(import.meta.url)("#card$").sendCard({});',
        'const a = "\\u0023esc";',
        'const b = "x".concat("#next");',
      ].join("\n");
      const targets = ["dollar.js", "escaped.js", "neighbour.js", "unloaded.js"].map((name) => join(dir, name));
      const loaded = withRepoResolver({
        use: (resolver) => [...loadsOf({ path: join(dir, "caller.ts"), resolver, targets, text })],
      });
      expect(loaded.map((file) => basename(file)).toSorted()).toEqual(["dollar.js", "escaped.js", "neighbour.js"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("finds a `#` literal without parsing every file, never one in a comment, and a path spelled by an escape", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-lead-prefilter-"));
    try {
      const imports = { "#ne\nar": "./neighbour.js", "#near": "./neighbour.js" };
      writeFileSync(join(dir, "package.json"), JSON.stringify({ imports, main: "./entry.js", type: "module" }));
      for (const target of ["neighbour.js", "cardSend.js", "entry.js"]) {
        writeFileSync(join(dir, target), "export const sendCard = () => 1;\n");
      }
      const targets = ["neighbour.js", "cardSend.js", 'card"Send.js', "entry.js"].map((name) => join(dir, name));
      const loads = ({ path = "caller.ts", text }: { path?: string; text: string }): readonly string[] =>
        withRepoResolver({
          use: (resolver) => [...loadsOf({ path: join(dir, path), resolver, targets, text })],
        }).map((file) => basename(file));
      expect([
        loads({ text: "// it's \"#near\nconst b = 'x'.concat('#near');" }),
        loads({ text: "const c = `#near`;" }),
        loads({ text: 'load("./card\\u0053end.js");' }),
        loads({ text: 'load("./other.js"); const css = "#fff";' }),
        loads({ text: '// "#near"' }),
        loads({ text: 'load("./card\\"Send.js");' }),
        loads({ text: 'const x = "#near' }),
        loads({ path: "caller.tsx", text: 'const el = <a href="#ne\nar" />;' }),
        loads({ text: 'const x = ".";' }),
        loads({ text: 'const x = "the end.";' }),
      ]).toEqual([
        ["neighbour.js"],
        ["neighbour.js"],
        ["cardSend.js"],
        [],
        [],
        ['card"Send.js'],
        ["neighbour.js"],
        ["neighbour.js"],
        ["entry.js"],
        [],
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("resolves a conditional `imports` entry under both NodeNext modes, since the load's own syntax picks one", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-lead-modes-"));
    try {
      const imports = { "#card": { import: "./esm.js", require: "./cjs.js" } };
      writeFileSync(join(dir, "package.json"), JSON.stringify({ imports, type: "module" }));
      writeFileSync(join(dir, "esm.js"), "export const a = 1;\n");
      writeFileSync(join(dir, "cjs.js"), "export const b = 1;\n");
      writeFileSync(join(dir, "caller.cts"), 'const m = await import("#card");\n');
      const files = withRepoResolver({
        use: (resolver) => resolutionsOf({ from: join(dir, "caller.cts"), resolver, specifier: "#card" }),
      });
      expect(files.map((file) => basename(file)).toSorted()).toEqual(["cjs.js", "esm.js"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("calls a specifier unresolved only when neither mode places it, the second asked after the first finds nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-lead-unresolved-"));
    try {
      const imports = { "#both": "./both.js", "#esmOnly": { import: "./esm.js" }, "#cjsOnly": { require: "./cjs.js" } };
      writeFileSync(join(dir, "package.json"), JSON.stringify({ imports, type: "module" }));
      for (const target of ["both.js", "esm.js", "cjs.js", "near.js"]) {
        writeFileSync(join(dir, target), "export const a = 1;\n");
      }
      const text = [
        'import { a } from "#both";',
        'import { b } from "#esmOnly";',
        'import { c } from "#cjsOnly";',
        'import { d } from "#nowhere";',
        'import { e } from "./near.js";',
        'import { f } from "./far.js";',
        'import { z } from "zod";',
      ].join("\n");
      const path = join(dir, "caller.ts");
      const answers = withRepoResolver({
        use: (resolver) => ({
          placed: importsOf({ path, resolver, text }).map(({ resolved, specifier }) => ({
            files: resolved.map((file) => basename(file)).toSorted(),
            specifier,
          })),
          unresolved: unresolvedImportsOf({ path, resolver, text }),
        }),
      });
      expect(answers.unresolved).toEqual(["#nowhere", "./far.js"]);
      expect(answers.placed).toEqual([
        { files: ["both.js"], specifier: "#both" },
        { files: ["esm.js"], specifier: "#esmOnly" },
        { files: ["cjs.js"], specifier: "#cjsOnly" },
        { files: [], specifier: "#nowhere" },
        { files: ["near.js"], specifier: "./near.js" },
        { files: [], specifier: "./far.js" },
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("finds every local import in production resolved, so no caller hides behind a specifier the compiler cannot place", () => {
    const unresolved = withRepoResolver({
      use: (resolver) =>
        PRODUCTION.flatMap((path) =>
          unresolvedImportsOf({ path, resolver, text: SOURCE.get(path)! }).map((specifier) => `${path}: ${specifier}`),
        ),
    });
    expect(PRODUCTION.length).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  }, 60_000);

  // Parses every production file for its literals: 4.6s on a seat but 60.6s on a loaded CI unit-2 shard, which timed
  // out at a 60s bound on main and on a branch alike, so it gets three times that
  // (`yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/outbound/slack/prLeadSeams --reporter=verbose`;
  // CI: `slopweaver github run-log 39863061797 --lines 15`).
  it("counts every call to a judged producer's entry per file and function, so a new call through an existing import fails", () => {
    const counted = withRepoResolver({
      use: (resolver) => JUDGED.map(({ file, row }) => countCallers({ entry: row.entry, file, resolver })),
    });
    expect(counted).toEqual(JUDGED.map(({ row }) => row.callers));
  }, 180_000);

  it("reads every `export … from` off the syntax tree, a comment between its tokens included", () => {
    const text =
      'export /* seam */ * from "./cardSend.js"; export { a } from "./b.js"; export * as c from "./c.js"; export const d = 1;';
    expect(reexportsIn({ path: "barrel.ts", text })).toEqual(["./cardSend.js", "./b.js", "./c.js"]);
  });

  it("finds no re-export of a judged producer's file, so every caller of its entry loads that file itself", () => {
    const reexports = withRepoResolver({
      use: (resolver) =>
        JUDGED.flatMap(({ file }) =>
          importersOf({ file, resolver }).flatMap((path) =>
            reexportsIn({ path, text: SOURCE.get(path)! })
              .filter((specifier) => resolutionsOf({ from: path, resolver, specifier }).includes(file))
              .map((specifier) => `${path}: ${specifier}`),
          ),
        ),
    });
    expect(JUDGED.length).toBeGreaterThan(0);
    expect(reexports).toEqual([]);
  }, 60_000);

  it("says why every exempt producer has no opening the fleet chose", () => {
    const exempt = ROWS.flatMap(([file, row]) => (row.kind === "exempt" ? [{ file, why: row.why }] : []));
    expect(exempt.length).toBeGreaterThan(0);
    expect(exempt.filter(({ why }) => why.trim().length === 0)).toEqual([]);
    expect(ROWS.filter(([file]) => !existsSync(file)).map(([file]) => file)).toEqual([]);
  });
});
