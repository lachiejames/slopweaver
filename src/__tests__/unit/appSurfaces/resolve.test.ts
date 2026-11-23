import { describe, expect, it } from "vitest";

import { buildResolveIndex, resolveSpecifier, splitBare } from "../../../appSurfaces/resolve.js";

/** A checkout held in memory: its tracked paths are the keys. */
function checkout({ files }: { files: Readonly<Record<string, string>> }) {
  return buildResolveIndex({ read: (path) => files[path], tracked: Object.keys(files) });
}

describe("resolveSpecifier relative", () => {
  const index = checkout({
    files: { "src/a.ts": "", "src/b.tsx": "", "src/dir/index.ts": "", "src/c.ts": "" },
  });

  it("tries the source extensions, an index file, and a .js specifier's .ts file", () => {
    expect(resolveSpecifier({ fromPath: "src/a.ts", index, specifier: "./b" })).toBe("src/b.tsx");
    expect(resolveSpecifier({ fromPath: "src/a.ts", index, specifier: "./dir" })).toBe("src/dir/index.ts");
    expect(resolveSpecifier({ fromPath: "src/a.ts", index, specifier: "./c.js" })).toBe("src/c.ts");
  });

  it("names nothing for a path that is not tracked", () => {
    expect(resolveSpecifier({ fromPath: "src/a.ts", index, specifier: "./generated/graphql" })).toBeUndefined();
  });
});

describe("resolveSpecifier workspace packages", () => {
  const index = checkout({
    files: {
      "packages/utils/package.json": JSON.stringify({
        exports: {
          ".": { default: "./dist/index.js", development: "./src/index.ts" },
          "./*": { default: "./dist/*.js", development: "./src/*.ts" },
        },
        name: "@acme/utils",
      }),
      "packages/utils/src/index.ts": "",
      "packages/utils/src/email.ts": "",
      "packages/ui/package.json": JSON.stringify({ exports: { "./core/*": "./src/core/*" }, name: "@acme/ui" }),
      "packages/ui/src/core/html/Viewer.tsx": "",
      "packages/plain/package.json": JSON.stringify({ name: "plain" }),
      "packages/plain/src/index.ts": "",
      "apps/web/src/a.ts": "",
    },
  });

  it("takes whichever exports condition points at a tracked file, not the untracked dist", () => {
    expect(resolveSpecifier({ fromPath: "apps/web/src/a.ts", index, specifier: "@acme/utils" })).toBe(
      "packages/utils/src/index.ts",
    );
    expect(resolveSpecifier({ fromPath: "apps/web/src/a.ts", index, specifier: "@acme/utils/email" })).toBe(
      "packages/utils/src/email.ts",
    );
  });

  it("substitutes a wildcard subpath and still tries the extensions", () => {
    expect(resolveSpecifier({ fromPath: "apps/web/src/a.ts", index, specifier: "@acme/ui/core/html/Viewer" })).toBe(
      "packages/ui/src/core/html/Viewer.tsx",
    );
  });

  it("falls back to src/index for a package with no exports field", () => {
    expect(resolveSpecifier({ fromPath: "apps/web/src/a.ts", index, specifier: "plain" })).toBe(
      "packages/plain/src/index.ts",
    );
  });

  it("names nothing for a third-party package", () => {
    expect(resolveSpecifier({ fromPath: "apps/web/src/a.ts", index, specifier: "react" })).toBeUndefined();
  });
});

describe("resolveSpecifier tsconfig paths", () => {
  it("resolves an alias from the nearest tsconfig, following a relative extends", () => {
    const index = checkout({
      files: {
        "apps/web/tsconfig.base.json": '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } } // comment',
        "apps/web/tsconfig.json": '{ "extends": "./tsconfig.base.json" }',
        "apps/web/src/pages/Page.tsx": "",
        "apps/web/src/lib/format.ts": "",
      },
    });
    expect(resolveSpecifier({ fromPath: "apps/web/src/pages/Page.tsx", index, specifier: "~/lib/format" })).toBe(
      "apps/web/src/lib/format.ts",
    );
  });
});

describe("splitBare", () => {
  it("takes two segments for a scoped name and one otherwise", () => {
    expect(splitBare({ specifier: "@pdfme/ui/dist/x" })).toEqual({ name: "@pdfme/ui", subpath: "./dist/x" });
    expect(splitBare({ specifier: "lodash" })).toEqual({ name: "lodash", subpath: "." });
  });
});
