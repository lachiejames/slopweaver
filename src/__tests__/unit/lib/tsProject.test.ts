/**
 * The TypeScript project seam over a throwaway directory: a config read into its files, and a specifier resolved
 * under both load modes exactly as the compiler resolves it.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import {
  memoisedTsModuleResolver,
  readConfigText,
  TsProjectErrors,
  tsConfigFileNames,
  withTsModuleResolver,
} from "#lib/tsProject.js";

let root: string;

/** Write one file under the fixture root, creating its directory. */
function put({ path, text }: { path: string; text: string }): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

beforeEach(() => {
  // Realpathed because the compiler realpaths a package it finds under node_modules (darwin's tmpdir is a symlink).
  root = realpathSync(mkdtempSync(join(tmpdir(), "ts-project-")));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("readConfigText", () => {
  it("reads comments, trailing commas and every JavaScript literal spelling the compiler accepts", () => {
    const text = [
      "// a line comment",
      "{",
      '  "hex": 0x10, /* a block comment */',
      '  "leadingDot": .5,',
      '  "separated": 1_000,',
      '  "escaped": "\\x41",',
      '  "list": [1, 2,],',
      "}",
    ].join("\n");
    expect(unwrap(readConfigText({ configFileName: "tsconfig.json", text }))).toEqual({
      escaped: "A",
      hex: 16,
      leadingDot: 0.5,
      list: [1, 2],
      separated: 1000,
    });
  });

  it("refuses a text the compiler reports a diagnostic for, naming the file", () => {
    const refused = unwrapErr(readConfigText({ configFileName: "pkg/tsconfig.json", text: "{ 'single': 1 }" }));
    expect(refused.code).toBe("TS_CONFIG_DIAGNOSTICS");
    expect(refused.configFileName).toBe("pkg/tsconfig.json");
    expect(refused.message).toContain("pkg/tsconfig.json: ");
  });
});

describe("tsConfigFileNames", () => {
  it("applies include, exclude and extends", () => {
    put({ path: "base.json", text: '{ "compilerOptions": { "strict": true }, "exclude": ["src/skip"] }' });
    put({ path: "tsconfig.json", text: '{ "extends": "./base.json", "include": ["src"] }' });
    put({ path: "src/a.ts", text: "export const a = 1;" });
    put({ path: "src/skip/b.ts", text: "export const b = 2;" });
    put({ path: "other/c.ts", text: "export const c = 3;" });
    const result = tsConfigFileNames({ configFileName: join(root, "tsconfig.json") });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([join(root, "src/a.ts")]);
  });

  it("names the config when it cannot be read at all", () => {
    const error = unwrapErr(tsConfigFileNames({ configFileName: join(root, "missing.json") }));
    expect(error.code).toBe("TS_CONFIG_DIAGNOSTICS");
    expect(error.configFileName).toBe(join(root, "missing.json"));
    expect(error.message).toContain("missing.json");
  });
});

describe("withTsModuleResolver", () => {
  it("resolves a NodeNext import to its source and a bare name to nothing", () => {
    put({
      path: "tsconfig.json",
      text: '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
    });
    put({ path: "package.json", text: '{ "type": "module" }' });
    put({ path: "src/a.ts", text: 'import { b } from "./b.js";' });
    put({ path: "src/b.ts", text: "export const b = 1;" });
    const fromFile = join(root, "src/a.ts");
    const resolved = unwrap(
      withTsModuleResolver({
        configFileName: join(root, "tsconfig.json"),
        currentDirectory: root,
        use: (resolver) => [
          resolver.resolve({ fromFile, mode: "import", specifier: "./b.js" }),
          resolver.resolve({ fromFile, mode: "require", specifier: "./b.js" }),
          resolver.resolve({ fromFile, mode: "import", specifier: "not-installed" }),
        ],
      }),
    );
    expect(resolved).toEqual([join(root, "src/b.ts"), join(root, "src/b.ts"), undefined]);
  });

  it("answers from a snapshot for its life, so a file written mid-use is found only by the next resolver", () => {
    put({
      path: "tsconfig.json",
      text: '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
    });
    put({ path: "package.json", text: '{ "type": "module" }' });
    const lookup = { fromFile: join(root, "src/a.ts"), mode: "import", specifier: "./b.js" } as const;
    const lent = { configFileName: join(root, "tsconfig.json"), currentDirectory: root };
    const during = unwrap(
      withTsModuleResolver({
        ...lent,
        use: (resolver) => {
          const before = resolver.resolve(lookup);
          put({ path: "src/b.ts", text: "export const b = 1;" });
          return [before, resolver.resolve(lookup)];
        },
      }),
    );
    const next = unwrap(withTsModuleResolver({ ...lent, use: (resolver) => resolver.resolve(lookup) }));
    expect([...during, next]).toEqual([undefined, undefined, join(root, "src/b.ts")]);
  });

  it("picks the package export that matches the load mode", () => {
    put({
      path: "tsconfig.json",
      text: '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
    });
    put({
      path: "node_modules/dual/package.json",
      text: '{ "name": "dual", "exports": { "import": "./esm.d.ts", "require": "./cjs.d.ts" } }',
    });
    put({ path: "node_modules/dual/esm.d.ts", text: "export {};" });
    put({ path: "node_modules/dual/cjs.d.ts", text: "export {};" });
    put({ path: "src/a.ts", text: "" });
    const fromFile = join(root, "src/a.ts");
    const resolved = unwrap(
      withTsModuleResolver({
        configFileName: join(root, "tsconfig.json"),
        currentDirectory: root,
        use: (resolver) => [
          resolver.resolve({ fromFile, mode: "import", specifier: "dual" }),
          resolver.resolve({ fromFile, mode: "require", specifier: "dual" }),
        ],
      }),
    );
    expect(resolved).toEqual([join(root, "node_modules/dual/esm.d.ts"), join(root, "node_modules/dual/cjs.d.ts")]);
  });

  it("answers exactly what `use` answers", () => {
    put({ path: "tsconfig.json", text: '{ "compilerOptions": { "module": "NodeNext" } }' });
    const answer = withTsModuleResolver({
      configFileName: join(root, "tsconfig.json"),
      currentDirectory: root,
      use: () => 42,
    });
    expect(unwrap(answer)).toBe(42);
  });

  it("refuses at compile time a `use` answering the resolver, bare or held in a record", () => {
    put({ path: "tsconfig.json", text: '{ "compilerOptions": { "module": "NodeNext" } }' });
    const at = { configFileName: join(root, "tsconfig.json"), currentDirectory: root };
    // Typechecked and never CALLED, so the test itself never lets the resolver escape.
    const typecheckedNeverRun = (): void => {
      // @ts-expect-error the resolver itself — the typecheck fails if this ever compiles
      withTsModuleResolver({ ...at, use: (resolver) => resolver });
      // @ts-expect-error the resolver held in a record
      withTsModuleResolver({ ...at, use: (resolver) => ({ resolver }) });
    };
    void typecheckedNeverRun;
    const plain = withTsModuleResolver({
      ...at,
      use: (resolver) => ({
        absent: resolver.resolve({ fromFile: join(root, "a.ts"), mode: "import", specifier: "x" }),
      }),
    });
    expect(unwrap(plain)).toEqual({ absent: undefined });
  });

  it("refuses a config with no compilerOptions, and never calls `use`", () => {
    put({ path: "tsconfig.json", text: '{ "include": ["src"] }' });
    const configFileName = join(root, "tsconfig.json");
    const lent: string[] = [];
    const error = unwrapErr(
      withTsModuleResolver({
        configFileName,
        currentDirectory: root,
        use: () => {
          lent.push("called");
        },
      }),
    );
    expect(error).toEqual(TsProjectErrors.noCompilerOptions({ configFileName }));
    expect(error.message).toContain("declares no compilerOptions");
    expect(lent).toEqual([]);
  });
});

describe("memoisedTsModuleResolver", () => {
  it("asks once per mode, directory and specifier, a miss remembered as surely as a hit", () => {
    const asked: string[] = [];
    const resolver = memoisedTsModuleResolver({
      resolve: ({ containingDirectory, mode, specifier }) => {
        asked.push(`${mode} ${containingDirectory} ${specifier}`);
        return containingDirectory === "/repo/empty" ? undefined : `${containingDirectory}/b.ts`;
      },
    });
    const lookups = [
      { fromFile: "/repo/src/a.ts", mode: "import", specifier: "./b.js" },
      { fromFile: "/repo/other/c.ts", mode: "import", specifier: "./b.js" },
      { fromFile: "/repo/src/d.ts", mode: "import", specifier: "./b.js" },
      { fromFile: "/repo/src/a.ts", mode: "require", specifier: "./b.js" },
      { fromFile: "/repo/src/a.ts", mode: "import", specifier: "./c.js" },
      { fromFile: "/repo/empty/e.ts", mode: "import", specifier: "./b.js" },
      { fromFile: "/repo/empty/f.ts", mode: "import", specifier: "./b.js" },
    ] as const satisfies readonly Parameters<typeof resolver.resolve>[0][];
    expect(lookups.map((lookup) => resolver.resolve(lookup))).toEqual([
      "/repo/src/b.ts",
      "/repo/other/b.ts",
      "/repo/src/b.ts",
      "/repo/src/b.ts",
      "/repo/src/b.ts",
      undefined,
      undefined,
    ]);
    expect(asked).toEqual([
      "import /repo/src ./b.js",
      "import /repo/other ./b.js",
      "require /repo/src ./b.js",
      "import /repo/src ./c.js",
      "import /repo/empty ./b.js",
    ]);
  });

  it("keeps two lookups apart however their fields could be joined, a NUL inside one included", () => {
    const resolver = memoisedTsModuleResolver({
      resolve: ({ containingDirectory, specifier }) => `${containingDirectory}|${specifier}`,
    });
    expect([
      resolver.resolve({ fromFile: "/a/x.ts", mode: "import", specifier: "b\u0000c" }),
      resolver.resolve({ fromFile: "/a\u0000b/x.ts", mode: "import", specifier: "c" }),
    ]).toEqual(["/a|b\u0000c", "/a\u0000b|c"]);
  });
});
