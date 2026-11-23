import { describe, expect, it } from "vitest";

import {
  packageNameOf,
  RUNTIME_TOOLS,
  type RuntimeDependencyManifest,
  runtimeDependencyFindings,
} from "../../../devLint/runtimeDependencies.js";

const MANIFEST: RuntimeDependencyManifest = {
  dependencies: { "@acme/sdk": "1.0.0", "acme-client": "2.0.0", tsx: "4.0.0" },
  devDependencies: { "acme-lint": "3.0.0", typescript: "6.0.0" },
};

const NO_TOOLS: ReadonlyMap<string, string> = new Map();

describe("packageNameOf", () => {
  it("names an unscoped package, dropping a subpath", () => {
    expect(packageNameOf({ specifier: "acme-client" })).toBe("acme-client");
    expect(packageNameOf({ specifier: "drizzle-orm/pg-core" })).toBe("drizzle-orm");
  });

  it("names a scoped package by its first two segments", () => {
    expect(packageNameOf({ specifier: "@acme/sdk" })).toBe("@acme/sdk");
    expect(packageNameOf({ specifier: "@acme/sdk/lib/client.js" })).toBe("@acme/sdk");
  });

  it("names nothing for a builtin, a relative path, a subpath alias or a bare scope", () => {
    expect(packageNameOf({ specifier: "node:fs" })).toBe(undefined);
    expect(packageNameOf({ specifier: "fs" })).toBe(undefined);
    expect(packageNameOf({ specifier: "./local.js" })).toBe(undefined);
    expect(packageNameOf({ specifier: "#lib/result.js" })).toBe(undefined);
    expect(packageNameOf({ specifier: "@acme" })).toBe(undefined);
  });
});

describe("runtimeDependencyFindings", () => {
  it("finds nothing when every reached package is in dependencies", () => {
    const imports = [
      { from: "src/a.ts", specifier: "acme-client" },
      { from: "src/b.ts", specifier: "@acme/sdk/sub" },
      { from: "src/c.ts", specifier: "node:path" },
    ];

    expect(runtimeDependencyFindings({ imports, manifest: MANIFEST, runtimeTools: NO_TOOLS })).toEqual([]);
  });

  it("names a reached devDependency, from the first importing module in sorted order", () => {
    const imports = [
      { from: "src/z.ts", specifier: "typescript" },
      { from: "src/lib/ts.ts", specifier: "typescript" },
    ];

    expect(runtimeDependencyFindings({ imports, manifest: MANIFEST, runtimeTools: NO_TOOLS })).toEqual([
      { from: "src/lib/ts.ts", packageName: "typescript", reason: "dev-dependency" },
    ]);
  });

  it("names a reached package declared nowhere as unlisted", () => {
    const imports = [{ from: "src/a.ts", specifier: "acme-transitive/x" }];

    expect(runtimeDependencyFindings({ imports, manifest: MANIFEST, runtimeTools: NO_TOOLS })).toEqual([
      { from: "src/a.ts", packageName: "acme-transitive", reason: "unlisted-package" },
    ]);
  });

  it("holds a runtime tool no import reaches to dependencies too, citing its launch site", () => {
    const runtimeTools = new Map([
      ["acme-lint", "bin/acme spawns it"],
      ["tsx", "bin/acme execs it"],
    ]);

    expect(runtimeDependencyFindings({ imports: [], manifest: MANIFEST, runtimeTools })).toEqual([
      { from: "bin/acme spawns it", packageName: "acme-lint", reason: "dev-dependency" },
    ]);
  });

  it("reports several packages once each, sorted by name", () => {
    const imports = [
      { from: "src/a.ts", specifier: "typescript" },
      { from: "src/a.ts", specifier: "acme-lint" },
      { from: "src/b.ts", specifier: "acme-lint/sub" },
    ];

    expect(
      runtimeDependencyFindings({ imports, manifest: MANIFEST, runtimeTools: NO_TOOLS }).map(
        ({ packageName }) => packageName,
      ),
    ).toEqual(["acme-lint", "typescript"]);
  });
});

describe("RUNTIME_TOOLS", () => {
  it("names the packages reached by a spawn, a package script or createRequire", () => {
    expect(RUNTIME_TOOLS.size).toBeGreaterThan(0);
    expect([...RUNTIME_TOOLS.keys()]).toEqual(["drizzle-kit", "esbuild", "supabase", "tsx", "typescript"]);
  });
});
