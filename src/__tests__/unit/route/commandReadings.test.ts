/**
 * The effectful half: what the host actually establishes about each executable a capability table names.
 *
 * Every case builds its own throwaway tree and its own `PATH`, so nothing here depends on what happens to be
 * installed on the machine running the suite — which is the same property that made `rg` a measurement rather
 * than an anecdote. Filesystem use is the genuine-fixture kind `testing.md` allows: a temp dir written and
 * read back, never a shared service.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { commandRouteReadings } from "../../../route/commandReadings.js";
import type { SourceCapability } from "../../../route/profile.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test that minted it. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cmdread-"));
  dirs.push(dir);
  return dir;
}

/** A tree whose `package.json` declares exactly the named scripts. */
function treeWithScripts({ scripts }: { scripts: readonly string[] }): string {
  const root = tempDir();
  const declared = Object.fromEntries(scripts.map((name) => [name, "tsx src/cli/index.ts"]));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: declared }), "utf8");
  return root;
}

/** A directory holding one executable file, as a `PATH` entry would. */
function binDirWith({ name }: { name: string }): string {
  const dir = tempDir();
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\n", "utf8");
  chmodSync(path, 0o755);
  return dir;
}

/** One row carrying the argv under test; every other field is irrelevant to this module. */
function row({ command, id }: { command: readonly string[]; id: string }): SourceCapability {
  return {
    availability: { kind: "available" },
    command,
    coverage: { detail: "declared", kind: "bounded" },
    effect: "read",
    freshness: { detail: "declared", kind: "cached" },
    id,
    owner: "slopweaver",
    sourceClass: "provider",
    terms: ["term"],
    truthMode: "current",
    what: "something",
  };
}

describe("commandRouteReadings", () => {
  it("resolves a `yarn <script>` pair the tree's own package.json declares", () => {
    const treeRoot = treeWithScripts({ scripts: ["slopweaver"] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["yarn", "slopweaver", "atlas", "vanta", "read"], id: "vanta" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "package.json"),
      treeRoot,
    });
    expect(readings.get("yarn slopweaver")!.resolution).toBe("resolved");
    expect(readings.get("yarn slopweaver")!.because).toContain("runs the `slopweaver` script");
  });

  it("calls a `yarn <token>` pair MISSING when all three of Yarn's namespaces miss — the measured failure", () => {
    const treeRoot = treeWithScripts({ scripts: ["slopweaver", "lint"] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["yarn", "work-console", "datadog", "reach"], id: "telemetry" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "package.json"),
      treeRoot,
    });
    const reading = readings.get("yarn work-console")!;
    expect(reading.resolution).toBe("missing");
    expect(reading.because).toBe(
      `\`yarn work-console\` names no script in ${join(treeRoot, "package.json")}, no binary in node_modules/.bin, and no Yarn command`,
    );
  });

  it("resolves BOTH keys a `bash -c` row yields — the head and the yarn pair inside its script", () => {
    const treeRoot = treeWithScripts({ scripts: ["lint"] });
    const readings = commandRouteReadings({
      capabilities: [
        row({
          command: ["bash", "-c", "EVJSON=$(yarn work-console github vulnerability-evidence --json); echo done"],
          id: "github-vulnerability-evidence",
        }),
      ],
      pathEntries: [binDirWith({ name: "bash" })],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    expect([...readings.keys()]).toEqual(["bash", "yarn work-console"]);
    expect(readings.get("bash")!.resolution).toBe("resolved");
    expect(readings.get("yarn work-console")!.resolution).toBe("missing");
  });

  it("resolves a `yarn <token>` pair naming a workspace binary rather than a script", () => {
    const treeRoot = treeWithScripts({ scripts: ["lint"] });
    const binDir = join(treeRoot, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "drizzle-kit"), "#!/bin/sh\n", "utf8");
    chmodSync(join(binDir, "drizzle-kit"), 0o755);
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["yarn", "drizzle-kit", "check"], id: "migrations" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    expect(readings.get("yarn drizzle-kit")!.resolution).toBe("resolved");
  });

  it("resolves a `yarn <token>` pair naming one of Yarn's OWN commands, which no package declares", () => {
    const treeRoot = treeWithScripts({ scripts: ["lint"] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["yarn", "dlx", "some-tool"], id: "tool" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    const reading = readings.get("yarn dlx")!;
    expect(reading.resolution).toBe("resolved");
    expect(reading.because).toBe("`yarn dlx` is one of Yarn's own commands");
  });

  it("calls a `yarn <token>` pair UNPROVABLE when the package itself cannot be read", () => {
    const treeRoot = tempDir();
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["yarn", "work-console"], id: "telemetry" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    expect(readings.get("yarn work-console")!.resolution).toBe("unprovable");
  });

  it("grades a `slopweaver` head against the bundled launcher, never against PATH", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const launcher = join(binDirWith({ name: "slopweaver" }), "slopweaver");
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["slopweaver", "atlas", "datadog", "read"], id: "telemetry" })],
      pathEntries: [],
      slopweaverCommand: launcher,
      treeRoot,
    });
    expect(readings.get("slopweaver")!.resolution).toBe("resolved");
    expect(readings.get("slopweaver")!.because).toContain(launcher);
  });

  it("calls a `slopweaver` head MISSING when the bundled launcher is not an executable file", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["slopweaver", "atlas", "datadog", "read"], id: "telemetry" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "bin", "slopweaver"),
      treeRoot,
    });
    expect(readings.get("slopweaver")!.resolution).toBe("missing");
  });

  it("resolves a bare name found on one of the PATH entries it was given", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const binDir = binDirWith({ name: "rg" });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["rg", "-n", "pattern"], id: "artifact-index" })],
      pathEntries: [tempDir(), binDir],
      slopweaverCommand: join(binDir, "rg"),
      treeRoot,
    });
    expect(readings.get("rg")!.resolution).toBe("resolved");
    expect(readings.get("rg")!.because).toBe(`\`rg\` resolves to ${join(binDir, "rg")}`);
  });

  it("calls a bare name off PATH UNPROVABLE, because a shell function is invisible to this lookup", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["rg", "-n", "pattern"], id: "artifact-index" })],
      pathEntries: [tempDir()],
      slopweaverCommand: join(treeRoot, "bin", "slopweaver"),
      treeRoot,
    });
    const reading = readings.get("rg")!;
    expect(reading.resolution).toBe("unprovable");
    expect(reading.because).toContain("is on none of this host's 1 PATH entries");
  });

  it("grades an ABSOLUTE path as MISSING when the filesystem does not hold it", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const absent = join(treeRoot, "nested", "tool");
    const readings = commandRouteReadings({
      capabilities: [row({ command: [absent, "--json"], id: "tool" })],
      pathEntries: [],
      slopweaverCommand: absent,
      treeRoot,
    });
    expect(readings.get(absent)!.resolution).toBe("missing");
  });

  it("grades a RELATIVE path as UNPROVABLE — it resolves against the cwd of whoever runs the row", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["./bin/tool", "--json"], id: "tool" })],
      pathEntries: [],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    expect(readings.get("./bin/tool")!.resolution).toBe("unprovable");
  });

  it("refuses to call a DIRECTORY an executable, which a bare access(X_OK) check would have", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const binDir = tempDir();
    mkdirSync(join(binDir, "rg"), { recursive: true });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["rg", "-n", "pattern"], id: "artifact-index" })],
      pathEntries: [binDir],
      slopweaverCommand: join(treeRoot, "nothing"),
      treeRoot,
    });
    expect(readings.get("rg")!.resolution).toBe("unprovable");
  });

  it("grades a bare `slopweaver` head UNPROVABLE when the caller passed no absolute launcher", () => {
    const treeRoot = treeWithScripts({ scripts: [] });
    const readings = commandRouteReadings({
      capabilities: [row({ command: ["slopweaver", "atlas", "datadog", "read"], id: "telemetry" })],
      pathEntries: [],
      slopweaverCommand: "slopweaver",
      treeRoot,
    });
    expect(readings.get("slopweaver")!.resolution).toBe("unprovable");
  });

  it("resolves one reading per DISTINCT executable, and none at all for a row with no command", () => {
    const treeRoot = treeWithScripts({ scripts: ["slopweaver"] });
    const binDir = binDirWith({ name: "sed" });
    mkdirSync(join(treeRoot, "unused"), { recursive: true });
    const readings = commandRouteReadings({
      capabilities: [
        row({ command: ["yarn", "slopweaver", "atlas", "vanta", "read"], id: "one" }),
        row({ command: ["yarn", "slopweaver", "atlas", "hex", "read"], id: "two" }),
        row({ command: ["sed", "-n", "1,320p", "notes.md"], id: "three" }),
        row({ command: [], id: "four" }),
      ],
      pathEntries: [binDir],
      slopweaverCommand: join(binDir, "sed"),
      treeRoot,
    });
    expect([...readings.keys()]).toEqual(["yarn slopweaver", "sed"]);
  });
});
