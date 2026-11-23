import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import { moduleFactsOf } from "../../../appSurfaces/moduleFacts.js";
import { isTainted, type ModuleTaint, PACKAGE, propagateTaint } from "../../../appSurfaces/taint.js";

/** Walk dompurify's taint over an in-memory set of modules whose relative specifiers name `<path>.ts`. */
function walk({ files }: { files: Readonly<Record<string, string>> }): ReadonlyMap<string, ModuleTaint> {
  const target = ({
    fromPath,
    specifier,
  }: {
    fromPath: string;
    specifier: string;
  }): string | typeof PACKAGE | undefined => {
    if (specifier === "dompurify") {
      return PACKAGE;
    }
    const path = `${posix.join(posix.dirname(fromPath), specifier)}.ts`;
    return path in files ? path : undefined;
  };
  const importers: (path: string) => readonly string[] = (path) =>
    Object.entries(files)
      .filter(([from, text]) => from !== path && text.includes(`"./${posix.basename(path, ".ts")}"`))
      .map(([from]) => from);
  return propagateTaint({
    graph: {
      factsOf: (path) => (path in files ? moduleFactsOf({ path, text: files[path]! }) : undefined),
      importersOf: importers,
      seeds: Object.keys(files).filter((path) => files[path]!.includes('"dompurify"')),
      target,
    },
  });
}

describe("propagateTaint", () => {
  it("forwards through a barrel only the name that leads to the package", () => {
    const state = walk({
      files: {
        "barrel.ts": 'export * from "./clean";\nexport * from "./date";',
        "clean.ts": 'import DOMPurify from "dompurify";\nexport const clean = (h) => DOMPurify.sanitize(h);',
        "date.ts": "export const formatDate = (d) => String(d);",
        "calendar.ts": 'import { formatDate } from "./barrel";\nexport const Calendar = () => formatDate(1);',
        "viewer.ts": 'import { clean } from "./barrel";\nexport const Viewer = () => clean("");',
      },
    });
    expect([...state.get("barrel.ts")!.exports]).toEqual(["clean"]);
    expect(state.get("viewer.ts")!.used).toBe(true);
    expect(state.has("calendar.ts")).toBe(false);
  });

  it("passes a module-scope use to every importer as a side effect, whatever it binds", () => {
    const state = walk({
      files: {
        "hooks.ts": 'import DOMPurify from "dompurify";\nDOMPurify.addHook("x", f);\nexport const unrelated = 1;',
        "app.ts": 'import { unrelated } from "./hooks";\nexport const App = () => unrelated;',
      },
    });
    expect(state.get("hooks.ts")!.sideEffect).toBe(true);
    expect(state.get("app.ts")!.sideEffect).toBe(true);
    expect([...state.get("app.ts")!.from]).toEqual(["hooks.ts"]);
  });

  it("taints the export that loads a tainted module at run time", () => {
    const state = walk({
      files: {
        "heavy.ts": 'import DOMPurify from "dompurify";\nexport default () => DOMPurify.sanitize("");',
        "lazy.ts": 'export const Lazy = lazy(() => import("./heavy"));\nexport const Other = 1;',
      },
    });
    expect([...state.get("lazy.ts")!.exports]).toEqual(["Lazy"]);
  });

  it("carries nothing through a type-only import, because a type does not run", () => {
    const state = walk({
      files: {
        "clean.ts": 'import DOMPurify from "dompurify";\nexport const clean = (h) => DOMPurify.sanitize(h);',
        "types.ts": 'import type { clean } from "./clean";\nexport const Viewer = () => null;',
      },
    });
    expect(state.has("types.ts")).toBe(false);
    expect(isTainted({ taint: state.get("clean.ts")! })).toBe(true);
  });
});
