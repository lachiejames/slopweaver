/**
 * Which run module a verb's manifest entry loads — parsed off manifest source, so an entry inside a comment or a
 * string is never read as a live one, and read only from the manifest the barrel binds to the verb's noun.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verbRunModule } from "../../../handover/manifestVerbs.js";

/** One noun's manifest file: the noun the barrel binds, the name the file exports, and its source. */
interface NounFile {
  readonly noun: string;
  readonly exported: string;
  readonly text: string;
}

/** The import every real manifest opens with, binding the CLI's own `lazy`. */
const LAZY = 'import { lazy } from "../manifest.js";\n';

/** A checkout's manifests: each noun's file, opened with {@link LAZY}, and a barrel binding each noun to its export. */
function checkout({ nouns }: { nouns: readonly NounFile[] }): ReadonlyMap<string, string> {
  const imports = nouns.map((each, index) => `import { ${each.exported} as b${index} } from "./n${index}.js";`);
  const rows = nouns.map((each, index) => `  { noun: "${each.noun}", summary: "s", verbs: b${index} },`);
  const barrel = `${imports.join("\n")}\nexport const MANIFEST_MODULES: readonly R[] = [\n${rows.join("\n")}\n];`;
  const files = nouns.map((each, index): [string, string] => [`n${index}.ts`, `${LAZY}${each.text}`]);
  return new Map([["index.ts", barrel], ...files]);
}

/** A checkout with one noun, `codex`, whose file is exactly `text` — no {@link LAZY} import added. */
function bareCodex({ text }: { text: string }): ReadonlyMap<string, string> {
  return new Map([...codexOnly({ text: "" }), ["n0.ts", text]]);
}

/** A checkout with one noun, `codex`, bound to the file's `exported` name. */
function codexOnly({ text, exported = "m" }: { text: string; exported?: string }): ReadonlyMap<string, string> {
  return checkout({ nouns: [{ exported, noun: "codex", text }] });
}

/** Two manifest entries in the two spellings the real manifests use, bare and quoted, across three nouns. */
const MANIFESTS = checkout({
  nouns: [
    {
      exported: "m",
      noun: "codex",
      text:
        'export const m = {\n  status: lazy({\n    load: () => import("../commands/codex/statusRun.js").then((x) => x.c),\n  }),\n' +
        '  "plan-fallback": lazy({\n    load: () => import("../commands/codex/fallbackPlanRun.js").then((x) => x.c),\n  }),\n};',
    },
    {
      exported: "s",
      noun: "slack",
      text: 'export const s = {\n  status: lazy({\n    load: () => import("../commands/slack/statusWiring.js").then((x) => x.c),\n  }),\n};',
    },
    {
      exported: "h",
      noun: "session-start",
      text: 'export const h = {\n  "set-repo": lazy({ load: () => import("../commands/sessionStart/readRun.js").then((x) => x.c) }),\n};',
    },
  ],
});

describe("verbRunModule", () => {
  it("resolves a bare verb key to its own noun's run module, never another noun's verb of the same name", () => {
    expect(verbRunModule({ manifests: MANIFESTS, ref: { noun: "codex", verb: "status" } })).toBe(
      "src/cli/commands/codex/statusRun.ts",
    );
    expect(verbRunModule({ manifests: MANIFESTS, ref: { noun: "slack", verb: "status" } })).toBe(
      "src/cli/commands/slack/statusWiring.ts",
    );
  });

  it("reads past an entry in a line comment, a block comment or a string to the live one", () => {
    const live = 'status: lazy({ load: () => import("../commands/codex/statusRun.js").then((m) => m.cmd) })';
    const dead = 'status: lazy({ load: () => import("../commands/codex/fakeRun.js").then((m) => m.old) })';
    const files = [
      { exported: "a", text: `export const a = {\n  // ${dead},\n  ${live},\n};` },
      { exported: "b", text: `export const b = { /* ${dead}, */ ${live} };` },
      { exported: "c", text: `export const usage = \`${dead}\`;\nexport const c = { ${live} };` },
      { exported: "d", text: `export const usage = "${dead.replaceAll('"', '\\"')}";\nexport const d = { ${live} };` },
    ];
    expect(
      files.map((file) => verbRunModule({ manifests: codexOnly(file), ref: { noun: "codex", verb: "status" } })),
    ).toEqual(Array.from({ length: 4 }, () => "src/cli/commands/codex/statusRun.ts"));
  });

  it("resolves nothing from an entry written only inside a template string", () => {
    const text = 'export const usage = `status: lazy({ load: () => import("../commands/codex/fakeRun.js") })`;';
    expect(
      verbRunModule({ manifests: codexOnly({ exported: "usage", text }), ref: { noun: "codex", verb: "status" } }),
    ).toBeUndefined();
  });

  it("resolves a quoted hyphenated verb key", () => {
    expect(verbRunModule({ manifests: MANIFESTS, ref: { noun: "codex", verb: "plan-fallback" } })).toBe(
      "src/cli/commands/codex/fallbackPlanRun.ts",
    );
  });

  it("resolves a hyphenated noun through the barrel's binding", () => {
    expect(verbRunModule({ manifests: MANIFESTS, ref: { noun: "session-start", verb: "set-repo" } })).toBe(
      "src/cli/commands/sessionStart/readRun.ts",
    );
  });

  it("resolves a verb whose loader imports another noun's command directory", () => {
    const text =
      'export const notionManifest = { read: lazy({ load: () => import("../commands/providerRead/run.js") }) };';
    const manifests = checkout({ nouns: [{ exported: "notionManifest", noun: "notion", text }] });
    expect(verbRunModule({ manifests, ref: { noun: "notion", verb: "read" } })).toBe(
      "src/cli/commands/providerRead/run.ts",
    );
  });

  it("routes a noun bound twice by its LAST row, as the CLI's Object.fromEntries does", () => {
    const first = 'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };';
    const second = 'export const n = { status: lazy({ load: () => import("../commands/codex/otherRun.js") }) };';
    const twice = ({ last }: { last: string }): ReadonlyMap<string, string> =>
      checkout({
        nouns: [
          { exported: "m", noun: "codex", text: first },
          { exported: "n", noun: "codex", text: last },
        ],
      });
    expect([
      verbRunModule({ manifests: twice({ last: second }), ref: { noun: "codex", verb: "status" } }),
      verbRunModule({ manifests: twice({ last: "export const n = {};" }), ref: { noun: "codex", verb: "status" } }),
    ]).toEqual(["src/cli/commands/codex/otherRun.ts", undefined]);
  });

  it("resolves a verb whose noun row lives in a family file the barrel spreads", () => {
    const manifests = new Map([
      ["index.ts", 'import { FAMILY } from "./family.js";\nexport const MANIFEST_MODULES = [...FAMILY];'],
      ["family.ts", 'import { m } from "./n0.js";\nexport const FAMILY = [{ noun: "codex", summary: "s", verbs: m }];'],
      ["n0.ts", `${LAZY}export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };`],
    ]);
    const unreadable = new Map([...manifests, ["family.ts", "export const FAMILY = makeRows();"]]);
    expect([
      verbRunModule({ manifests, ref: { noun: "codex", verb: "status" } }),
      verbRunModule({ manifests, ref: { noun: "slack", verb: "status" } }),
      verbRunModule({ manifests: unreadable, ref: { noun: "codex", verb: "status" } }),
    ]).toEqual(["src/cli/commands/codex/statusRun.ts", undefined, undefined]);
  });

  it("resolves a noun's earlier name to the noun dispatch routes it to", () => {
    const text = 'export const a = { status: lazy({ load: () => import("../commands/automation/status.js") }) };';
    const manifests = checkout({ nouns: [{ exported: "a", noun: "automation", text }] });
    expect([
      verbRunModule({ manifests, ref: { noun: "recipe", verb: "status" } }),
      verbRunModule({ manifests, ref: { noun: "automation", verb: "status" } }),
    ]).toEqual(["src/cli/commands/automation/status.ts", "src/cli/commands/automation/status.ts"]);
  });

  it("resolves nothing for a verb no manifest declares, no barrel, or none", () => {
    const noBarrel = new Map([...MANIFESTS].filter(([name]) => name !== "index.ts"));
    expect([
      verbRunModule({ manifests: MANIFESTS, ref: { noun: "codex", verb: "nonesuch" } }),
      verbRunModule({ manifests: noBarrel, ref: { noun: "codex", verb: "status" } }),
      verbRunModule({ manifests: new Map(), ref: { noun: "codex", verb: "status" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("resolves nothing for a noun the barrel binds by a type-only import, or does not bind at all", () => {
    const text = 'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };';
    const typeOnly = new Map([
      ["index.ts", 'import { type m } from "./n0.js";\nexport const MANIFEST_MODULES = [{ noun: "codex", verbs: m }];'],
      ["n0.ts", text],
    ]);
    expect([
      verbRunModule({ manifests: typeOnly, ref: { noun: "codex", verb: "status" } }),
      verbRunModule({ manifests: codexOnly({ text }), ref: { noun: "slack", verb: "status" } }),
    ]).toEqual([undefined, undefined]);
  });

  it("resolves a loader passed by name to the module its own const declaration imports", () => {
    const text =
      'const loadStatus = () => import("../commands/distil/status.js").then((m) => m.cmd);\n' +
      "export const m = { status: lazy({ load: loadStatus, meta: statusMeta }) };";
    const manifests = checkout({ nouns: [{ exported: "m", noun: "distil", text }] });
    expect(verbRunModule({ manifests, ref: { noun: "distil", verb: "status" } })).toBe(
      "src/cli/commands/distil/status.ts",
    );
  });

  it("resolves nothing for a loader name the manifest never declares, or declares with let or var", () => {
    const entry = "export const m = { status: lazy({ load: loadStatus }) };";
    const loader = '= () => import("../commands/distil/status.js");';
    const texts = [
      `import { loadStatus } from "./loaders.js";\n${entry}`,
      `let loadStatus ${loader}\n${entry}`,
      `var loadStatus ${loader}\n${entry}`,
    ];
    expect(
      texts.map((text) =>
        verbRunModule({
          manifests: checkout({ nouns: [{ exported: "m", noun: "distil", text }] }),
          ref: { noun: "distil", verb: "status" },
        }),
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  it("reads a loader only as `() => import(lit)` with `.then(…)` calls and no other import", () => {
    const fake = 'import("../commands/codex/fakeRun.js")';
    const real = 'import("../commands/codex/statusRun.js")';
    const loaders = [
      `() => { void ${fake}; return ${real}.then((m) => m.command); }`,
      `() => ${real}.then(() => ${fake})`,
      `() => (${fake}, ${real})`,
      `() => ${real}.catch(() => undefined)`,
      `() => ${real}.then((m) => m.statusCommand({ platform: "slack" }))`,
    ];
    expect(
      loaders.map((loader) =>
        verbRunModule({
          manifests: codexOnly({ text: `export const m = { status: lazy({ load: ${loader} }) };` }),
          ref: { noun: "codex", verb: "status" },
        }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, "src/cli/commands/codex/statusRun.ts"]);
  });

  it("reads only the exported object the barrel binds, directly or by spreading a same-file const", () => {
    const live = 'status: lazy({ load: () => import("../commands/codex/statusRun.js") })';
    const files = [
      { exported: "m", text: `const abandoned = { ${live} };\nexport const m = {};` },
      { exported: "m", text: `const rows = { ${live} };\nexport const m = { ...rows };` },
      { exported: "m", text: `const rows = { ${live} } satisfies Rows;\nexport const m = { ...rows } as const;` },
      { exported: "m", text: `const m = { ${live} };\nexport { m };` },
      { exported: "codexManifest", text: `const m = { ${live} };\nexport { m as codexManifest };` },
      { exported: "codexManifest", text: `const m = { ${live} };\nexport { m, m as codexManifest };` },
      {
        exported: "b",
        text: `const rows = { ${live} };\nexport const a = { ...rows };\nexport const b = { ...rows };`,
      },
      // A type-only element exports no value.
      { exported: "m", text: `type m = {};\nconst m = { ${live} };\nexport { type m };` },
      { exported: "other", text: `export const m = { ${live} };\nexport const other = {};` },
    ];
    const run = "src/cli/commands/codex/statusRun.ts";
    expect(
      files.map((file) => verbRunModule({ manifests: codexOnly(file), ref: { noun: "codex", verb: "status" } })),
    ).toEqual([undefined, run, run, run, run, run, run, undefined, undefined]);
  });

  it("follows a spread of a name imported from a sibling manifest, and ends an import cycle", () => {
    const live = 'recheck: lazy({ load: () => import("../commands/handover/recheckRun.js") })';
    const withRows = ({ rows }: { rows: string }): ReadonlyMap<string, string> =>
      new Map([
        ...checkout({
          nouns: [
            {
              exported: "handoverManifest",
              noun: "handover",
              text: 'import { asks } from "./rows.js";\nexport const handoverManifest = { ...asks };',
            },
          ],
        }),
        ["rows.ts", `${LAZY}${rows}`],
      ]);
    const ref = { noun: "handover", verb: "recheck" };
    expect([
      verbRunModule({ manifests: withRows({ rows: `export const asks = { ${live} };` }), ref }),
      verbRunModule({ manifests: withRows({ rows: `const a = { ${live} };\nexport { a as asks };` }), ref }),
      verbRunModule({ manifests: withRows({ rows: `const asks = { ${live} };` }), ref }),
      verbRunModule({
        manifests: withRows({
          rows: 'import { handoverManifest } from "./n0.js";\nexport const asks = { ...handoverManifest };',
        }),
        ref,
      }),
    ]).toEqual([
      "src/cli/commands/handover/recheckRun.ts",
      "src/cli/commands/handover/recheckRun.ts",
      undefined,
      undefined,
    ]);
  });

  it("resolves the last member setting a verb, as JavaScript reads an override, and nothing past one it cannot read", () => {
    const old = 'status: lazy({ load: () => import("../commands/codex/oldRun.js") })';
    const now = 'status: lazy({ load: () => import("../commands/codex/newRun.js") })';
    const base = `const base = { ${old} };\n`;
    const objects = [
      `${base}export const m = { ...base, ${now} };`,
      `${base}export const m = { ${now}, ...base };`,
      `${base}export const m = { ${now}, other: lazy({ load: () => import("../commands/codex/otherRun.js") }) };`,
      `import { rows } from "./elsewhere.js";\nexport const m = { ${now}, ...rows };`,
      `export const m = { ${now}, [key]: lazy({ load: () => import("../commands/codex/x.js") }) };`,
      `${base}export const m = { ...base, status };`,
      `import { DEFAULT_VERB } from "../manifest.js";\nexport const m = { ${now}, [DEFAULT_VERB]: lazy({ load: () => import("../commands/codex/x.js") }) };`,
      `import { OTHER as DEFAULT_VERB } from "../manifest.js";\nexport const m = { ${now}, [DEFAULT_VERB]: lazy({ load: () => import("../commands/codex/x.js") }) };`,
    ];
    expect(
      objects.map((text) => verbRunModule({ manifests: codexOnly({ text }), ref: { noun: "codex", verb: "status" } })),
    ).toEqual([
      "src/cli/commands/codex/newRun.ts",
      "src/cli/commands/codex/oldRun.ts",
      "src/cli/commands/codex/newRun.ts",
      undefined,
      undefined,
      undefined,
      "src/cli/commands/codex/newRun.ts",
      undefined,
    ]);
  });

  it("inlines an object literal spread where it sits, overrides and all", () => {
    const old = 'status: lazy({ load: () => import("../commands/codex/oldRun.js") })';
    const now = 'status: lazy({ load: () => import("../commands/codex/newRun.js") })';
    const objects = [
      `export const m = { ...{ ${now} } };`,
      `export const m = { ...({ ${old} }), ${now} };`,
      `export const m = { ${old}, ...{ ...{ ${now} } } };`,
      `export const m = { ${now}, ...{ ...rows } };`,
    ];
    expect(
      objects.map((text) => verbRunModule({ manifests: codexOnly({ text }), ref: { noun: "codex", verb: "status" } })),
    ).toEqual([
      "src/cli/commands/codex/newRun.ts",
      "src/cli/commands/codex/newRun.ts",
      "src/cli/commands/codex/newRun.ts",
      undefined,
    ]);
  });

  it("reads an entry only when its `lazy` is the CLI's own, imported from `../manifest.js`", () => {
    const entry = 'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };';
    const aliased = 'export const m = { status: load({ load: () => import("../commands/codex/statusRun.js") }) };';
    const texts = [
      `import { lazy as load } from "../manifest.js";\n${aliased}`,
      entry,
      `const lazy = (options: O) => options;\n${entry}`,
      `import { lazy } from "./mine.js";\n${entry}`,
      `import { type lazy } from "../manifest.js";\n${entry}`,
      `import type { lazy } from "../manifest.js";\n${entry}`,
      `import { DEFAULT_VERB as lazy } from "../manifest.js";\n${entry}`,
    ];
    expect(
      texts.map((text) => verbRunModule({ manifests: bareCodex({ text }), ref: { noun: "codex", verb: "status" } })),
    ).toEqual([
      "src/cli/commands/codex/statusRun.ts",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("resolves the real manifests' inline, named and shared loaders to the modules the CLI loads", () => {
    const dir = join(import.meta.dirname, "..", "..", "..", "cli", "manifests");
    const manifests = new Map(
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts"))
        .map((name): [string, string] => [name, readFileSync(join(dir, name), "utf8")]),
    );
    expect([
      verbRunModule({ manifests, ref: { noun: "codex", verb: "status" } }),
      verbRunModule({ manifests, ref: { noun: "distil", verb: "status" } }),
      verbRunModule({ manifests, ref: { noun: "notion", verb: "read" } }),
      verbRunModule({ manifests, ref: { noun: "handover", verb: "recheck" } }),
    ]).toEqual([
      "src/cli/commands/codex/statusRun.ts",
      "src/cli/commands/distil/status.ts",
      "src/cli/commands/providerRead/run.ts",
      "src/cli/commands/handover/recheckRun.ts",
    ]);
  });
});
