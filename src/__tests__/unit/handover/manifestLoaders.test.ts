import { describe, expect, it } from "vitest";
import { ts, withSourceFile } from "#lib/tsSyntax.js";

import { keyText, lazyEntry, topLevelConsts, unwrapped } from "../../../handover/manifestLoaders.js";

/** The first member of `export const m = { … }` in `text`, read beside that file's top-level consts. */
function firstMember({
  text,
  lazyNames = new Set(["lazy"]),
}: {
  text: string;
  lazyNames?: ReadonlySet<string>;
}): ReturnType<typeof lazyEntry> {
  return withSourceFile({
    fileName: "m.ts",
    scriptKind: ts.ScriptKind.TS,
    text,
    use: (source) => {
      const consts = topLevelConsts({ source });
      const object = unwrapped({ node: consts.get("m")! });
      const [member] = (object as ts.ObjectLiteralExpression).properties;
      return lazyEntry({ lazyNames, loaders: consts, node: member! });
    },
  });
}

describe("lazyEntry", () => {
  it("reads an inline loader, a `.then` chain, a quoted key, a same-file named const, and each through `as`, `satisfies` and parentheses", () => {
    const texts = [
      'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };',
      'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js").then((x) => x) }) };',
      'export const m = { "status": lazy({ load: () => import("../commands/codex/statusRun.js") }) };',
      'const loadIt = () => import("../commands/codex/statusRun.js");\nexport const m = { status: lazy({ load: loadIt }) } as const;',
      'export const m = { status: lazy(({ load: () => import("../commands/codex/statusRun.js") } satisfies O)) };',
      'const loadIt = () => import("../commands/codex/statusRun.js");\nexport const m = { status: (lazy({ load: (loadIt as L) })) };',
    ];
    expect(texts.map((text) => firstMember({ text }))).toEqual([
      { dir: "codex", file: "statusRun", verb: "status" },
      { dir: "codex", file: "statusRun", verb: "status" },
      { dir: "codex", file: "statusRun", verb: "status" },
      { dir: "codex", file: "statusRun", verb: "status" },
      { dir: "codex", file: "statusRun", verb: "status" },
      { dir: "codex", file: "statusRun", verb: "status" },
    ]);
  });

  it("reads the LAST `load` the options set, as JavaScript reads `{ load, ...override }`", () => {
    const old = '() => import("../commands/codex/oldRun.js")';
    const now = '() => import("../commands/codex/newRun.js")';
    const texts = [
      `export const m = { status: lazy({ load: ${old}, ...{ load: ${now} } }) };`,
      `export const m = { status: lazy({ ...{ load: ${old} }, load: ${now} }) };`,
      `const load = ${now};\nexport const m = { status: lazy({ load }) };`,
      `const override = { load: ${now} };\nexport const m = { status: lazy({ load: ${old}, ...override }) };`,
      `export const m = { status: lazy({ load: ${old}, [key]: ${now} }) };`,
      `export const m = { status: lazy({ load: ${old}, load() { return 1; } }) };`,
    ];
    expect(texts.map((text) => firstMember({ text }))).toEqual([
      { dir: "codex", file: "newRun", verb: "status" },
      { dir: "codex", file: "newRun", verb: "status" },
      { dir: "codex", file: "newRun", verb: "status" },
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads a call only to a name bound to the CLI's `lazy`", () => {
    const text = 'export const m = { status: lazy({ load: () => import("../commands/codex/statusRun.js") }) };';
    expect([
      firstMember({ lazyNames: new Set(["lazy"]), text }),
      firstMember({ lazyNames: new Set(), text }),
      firstMember({ lazyNames: new Set(["load"]), text }),
    ]).toEqual([{ dir: "codex", file: "statusRun", verb: "status" }, undefined, undefined]);
  });

  it("reads nothing off any other loader shape", () => {
    const texts = [
      'export const m = { status: lazy({ load: () => { return import("../commands/codex/statusRun.js"); } }) };',
      'export const m = { status: lazy({ load: () => import("../commands/codex/a.js").then(() => import("../commands/codex/b.js")) }) };',
      'let loadIt = () => import("../commands/codex/statusRun.js");\nexport const m = { status: lazy({ load: loadIt }) };',
      'export const m = { status: lazy({ load: () => import("./elsewhere/statusRun.js") }) };',
      'export const m = { status: eager({ load: () => import("../commands/codex/statusRun.js") }) };',
      "export const m = { status: lazy({ load: () => import(`../commands/codex/statusRun.js`) }) };",
    ];
    expect(texts.map((text) => firstMember({ text }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("keyText", () => {
  it("reads a bare or quoted key and nothing for a computed or numeric one", () => {
    withSourceFile({
      fileName: "k.ts",
      text: 'const k = { a: 1, "b": 2, [c]: 3, 4: 5 };',
      scriptKind: ts.ScriptKind.TS,
      use: (source) => {
        const object = topLevelConsts({ source }).get("k") as ts.ObjectLiteralExpression;
        expect(
          object.properties.filter(ts.isPropertyAssignment).map((property) => keyText({ name: property.name })),
        ).toEqual(["a", "b", undefined, undefined]);
      },
    });
  });
});
