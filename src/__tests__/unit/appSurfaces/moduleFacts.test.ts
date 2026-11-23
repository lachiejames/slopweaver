import { describe, expect, it } from "vitest";

import { DEFAULT_LOCAL, moduleFactsOf, ROOT_ROUTE } from "../../../appSurfaces/moduleFacts.js";

describe("moduleFactsOf imports", () => {
  it("records default, named, renamed and namespace bindings, and drops type-only ones", () => {
    const facts = moduleFactsOf({
      path: "a.ts",
      text: [
        'import DOMPurify from "dompurify";',
        'import { a, b as c, type T } from "./x";',
        'import * as ns from "./y";',
        'import type { U } from "./z";',
        'import "./styles";',
      ].join("\n"),
    });
    expect(facts.imports).toEqual([
      { imported: "default", local: "DOMPurify", specifier: "dompurify" },
      { imported: "a", local: "a", specifier: "./x" },
      { imported: "b", local: "c", specifier: "./x" },
      { imported: "*", local: "ns", specifier: "./y" },
    ]);
    expect(facts.sideEffectImports).toEqual(["./styles"]);
  });
});

describe("moduleFactsOf exports", () => {
  it("separates a barrel's re-exports from a module's own exports", () => {
    const facts = moduleFactsOf({
      path: "index.ts",
      text: [
        'export * from "./email";',
        'export * as knock from "./knock";',
        'export { format as formatDate } from "./date";',
        "const local = 1;",
        "export { local as renamed };",
        "export type { V } from './types';",
      ].join("\n"),
    });
    expect(facts.reExports).toEqual([
      { exported: "*", imported: "*", specifier: "./email" },
      { exported: "knock", imported: "*", specifier: "./knock" },
      { exported: "formatDate", imported: "format", specifier: "./date" },
    ]);
    expect(facts.localExports).toEqual([{ exported: "renamed", local: "local" }]);
  });

  it("maps export default, named and anonymous, onto the default export", () => {
    const named = moduleFactsOf({ path: "a.tsx", text: "export default function Viewer() { return null; }" });
    const anonymous = moduleFactsOf({ path: "b.ts", text: "export default makeThing(x);" });
    expect(named.localExports).toEqual([{ exported: "default", local: "Viewer" }]);
    expect(anonymous.localExports).toEqual([{ exported: "default", local: DEFAULT_LOCAL }]);
    expect(anonymous.topLevels[0]!.refs).toEqual(["makeThing", "x"]);
  });
});

describe("moduleFactsOf references", () => {
  it("counts a JSX tag as a reference and a property name or attribute as not one", () => {
    const facts = moduleFactsOf({
      path: "a.tsx",
      text: "export const View = () => <HTMLViewer sanitize={props.sanitize} />;",
    });
    expect(facts.topLevels[0]!.names).toEqual(["View"]);
    expect(facts.topLevels[0]!.refs.toSorted()).toEqual(["HTMLViewer", "View", "props"]);
  });

  it("records a dynamic import and a require as run-time loads of the statement that holds them", () => {
    const facts = moduleFactsOf({
      path: "a.ts",
      text: 'export const Lazy = lazy(() => import("./Heavy"));\nconst legacy = require("./old");',
    });
    expect(facts.topLevels.map((statement) => statement.dynamicSpecifiers)).toEqual([["./Heavy"], ["./old"]]);
  });

  it("records a module loaded by URL relative to import.meta.url, and not a URL built any other way", () => {
    const facts = moduleFactsOf({
      path: "a.ts",
      text: [
        'const w = new Worker(new URL("./worker.ts", import.meta.url));',
        'const page = new URL("./worker.ts", location.href);',
        'const pkg = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url);',
      ].join("\n"),
    });
    expect(facts.topLevels.map((statement) => statement.dynamicSpecifiers)).toEqual([["./worker.ts"], [], []]);
  });

  it("gives a bare module-scope statement no names, which is what makes it a side effect", () => {
    const facts = moduleFactsOf({
      path: "a.ts",
      text: 'import DOMPurify from "dompurify";\nDOMPurify.addHook("x", f);',
    });
    expect(facts.topLevels).toEqual([{ dynamicSpecifiers: [], names: [], refs: ["DOMPurify", "f"] }]);
  });
});

describe("moduleFactsOf routes", () => {
  it("reads a TanStack file route's path literal", () => {
    const facts = moduleFactsOf({
      path: "routes/x.tsx",
      text: "export const Route = createFileRoute('/_auth/_admin/model-view/$modelName/$id')({ component: Page });",
    });
    expect(facts.routePath).toBe("/_auth/_admin/model-view/$modelName/$id");
  });

  it("marks a root route, which carries no path, with the root marker", () => {
    const facts = moduleFactsOf({
      path: "routes/__root.tsx",
      text: "export const Route = createRootRouteWithContext<Ctx>()({ component: Shell });",
    });
    expect(facts.routePath).toBe(ROOT_ROUTE);
  });

  it("leaves a module that declares no route without one", () => {
    expect(moduleFactsOf({ path: "a.ts", text: "export const x = 1;" }).routePath).toBeUndefined();
  });
});
