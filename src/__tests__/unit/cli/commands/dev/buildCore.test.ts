import { describe, expect, it } from "vitest";
import { BUILT_ENTRYPOINT, DEFAULT_OUT } from "../../../../../builtCli/layout.js";
import { SOURCE_ROOT } from "../../../../../builtCli/sourceScan.js";
import {
  buildIsFit,
  builtManifest,
  esbuildArgsFor,
  outsideRoot,
  parseDevBuildArgs,
  renderBuild,
  SMOKE_VERB,
} from "../../../../../cli/commands/dev/buildCore.js";
import { unwrap } from "../../../../../lib/result.js";

const report = (over: Partial<Parameters<typeof renderBuild>[0]["report"]> = {}) => ({
  emitMs: 1952,
  emitted: 4102,
  outDir: "/repo/dist",
  smokeExit: 0,
  smokeLine: "slopweaver — 508 commands across 77 nouns",
  ...over,
});

describe("parseDevBuildArgs", () => {
  it("defaults the output directory to dist-cli, which tsc's dist/ never shares", () => {
    expect(unwrap(parseDevBuildArgs({ rest: [] }))).toEqual({ json: false, out: DEFAULT_OUT });
    expect(DEFAULT_OUT).toBe("dist-cli");
  });

  it("takes an explicit output directory and the json flag", () => {
    expect(unwrap(parseDevBuildArgs({ rest: ["--out", "build", "--json"] }))).toEqual({ json: true, out: "build" });
  });

  it("refuses an unknown flag by name", () => {
    const parsed = parseDevBuildArgs({ rest: ["--outdir", "build"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--outdir");
  });
});

describe("esbuildArgsFor", () => {
  it("emits per file rather than bundling, so a lazy verb's dynamic import still names a real file", () => {
    const args = esbuildArgsFor({ files: ["src/cli/index.ts", "src/config.ts"], outDir: "/repo/dist" });
    expect(args).toEqual([
      "src/cli/index.ts",
      "src/config.ts",
      `--outbase=${SOURCE_ROOT}`,
      "--outdir=/repo/dist",
      "--format=esm",
      "--platform=node",
      "--target=node22",
      "--sourcemap",
      "--log-level=error",
    ]);
  });

  it("carries no bundle flag at all", () => {
    const args = esbuildArgsFor({ files: ["src/config.ts"], outDir: "/repo/dist" });
    expect(args.filter((arg) => arg.includes("bundle"))).toEqual([]);
  });
});

describe("builtManifest", () => {
  it("re-roots the subpath imports at the emitted tree, not at src", () => {
    const built = builtManifest({ manifest: { imports: { "#lib/*": "./src/lib/*" }, name: "slopweaver" } });
    expect(built["imports"]).toEqual({ "#lib/*": "./lib/*" });
  });

  it("drops scripts, which all name tsx paths the emitted tree does not have", () => {
    const built = builtManifest({
      manifest: { name: "slopweaver", scripts: { build: "tsx src/cli/index.ts dev build" } },
    });
    expect(built["scripts"]).toBe(undefined);
    expect(built["name"]).toBe("slopweaver");
  });
});

describe("buildIsFit", () => {
  it("passes when files were emitted and the smoke run exited 0", () => {
    expect(buildIsFit({ report: report() })).toBe(true);
  });

  it("fails an emit that wrote nothing, which is exactly what the heap death looked like", () => {
    expect(buildIsFit({ report: report({ emitted: 0 }) })).toBe(false);
  });

  it("fails an emit whose output does not run, which is what an unresolvable import map produced", () => {
    expect(buildIsFit({ report: report({ smokeExit: 1 }) })).toBe(false);
  });
});

describe("renderBuild", () => {
  it("names the count, the entrypoint and the verdict", () => {
    expect(renderBuild({ report: report() })).toEqual([
      "dev build: 4102 file(s) emitted to /repo/dist in 1952ms",
      `dev build: smoke run of ${BUILT_ENTRYPOINT} exited 0 — slopweaver — 508 commands across 77 nouns`,
      "dev build: PASS",
    ]);
  });

  it("says FAIL on a smoke run that did not exit 0", () => {
    expect(renderBuild({ report: report({ smokeExit: 1, smokeLine: "ERR_MODULE_NOT_FOUND" }) })[2]).toBe(
      "dev build: FAIL",
    );
  });
});

describe("the smoke verb", () => {
  it("is catalog, which exits 0 and folds every noun manifest", () => {
    expect(SMOKE_VERB).toBe("catalog");
  });
});

describe("outsideRoot", () => {
  it("passes the root itself", () => {
    expect(outsideRoot({ outDir: "/repo", root: "/repo" })).toBeUndefined();
  });

  it("passes a directory inside the checkout", () => {
    expect(outsideRoot({ outDir: "/repo/dist-cli", root: "/repo" })).toBeUndefined();
  });

  it("names the directory, the root and why an emit there cannot run", () => {
    expect(outsideRoot({ outDir: "/tmp/x", root: "/repo" })).toBe(
      "--out /tmp/x is outside /repo, and an emitted tree there cannot run: its bare imports resolve by " +
        "walking up to a `node_modules` that only exists inside the checkout",
    );
  });

  it("refuses a sibling whose path merely starts with the root's characters", () => {
    expect(outsideRoot({ outDir: "/repo-two/dist", root: "/repo" })).toContain("is outside /repo,");
  });
});
