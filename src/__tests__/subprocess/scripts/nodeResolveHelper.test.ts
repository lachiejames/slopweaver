/**
 * `hooks/lib/node-resolve.sh`'s two pure pieces, called through bash argv under the launcher's own `set -euo
 * pipefail`: the version comparison every tier leans on, and the pure-bash `engines.node` read — held to THIS
 * repository's own package.json and .nvmrc, so a changed engines shape the launcher cannot read fails here, in
 * CI, rather than as a refusal on every invocation.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const HELPER = join(repoRoot, "hooks", "lib", "node-resolve.sh");

/**
 * The exit status of `node_version_meets <have> <need>`.
 *
 * @param have the version
 * @param need the floor
 * @returns 0 meets, 1 below, 2 unparseable
 */
function meets({ have, need }: { have: string; need: string }): number | null {
  return spawnSync("/bin/bash", [
    "-c",
    'set -euo pipefail; source "$1"; node_version_meets "$2" "$3"',
    "_",
    HELPER,
    have,
    need,
  ]).status;
}

describe("node_version_meets", () => {
  it.each([
    { have: "v24.11.0", need: "24.11", want: 0 },
    { have: "v24.21.0", need: "24.11", want: 0 },
    { have: "v25.0.0", need: "24.11", want: 0 },
    { have: "24.11.1", need: "24.11.1", want: 0 },
    { have: "v24.10.9", need: "24.11", want: 1 },
    { have: "v23.99.99", need: "24.11", want: 1 },
    { have: "v18.19.0", need: "24", want: 1 },
    { have: "v24.12.0-nightly2026", need: "24.11", want: 1 },
    { have: "v24.11.0+build.7", need: "24.11", want: 0 },
    { have: "v24.11.0-", need: "24.11", want: 2 },
    { have: "v24.11.0+", need: "24.11", want: 2 },
    { have: "v25.0.0.999", need: "24.11", want: 2 },
    { have: "v24.", need: "24", want: 2 },
    { have: "v25", need: "24.11", want: 2 },
    { have: "v25.0", need: "24.11", want: 2 },
    { have: "v024.12.0", need: "24.11", want: 2 },
    { have: "v24.08.0", need: "24.8", want: 2 },
    { have: "v24.11.0", need: "24.011", want: 2 },
    { have: "v24.10.0", need: "24.10", want: 0 },
    { have: "v24.12.0-rc..1", need: "24.11", want: 2 },
    { have: "v24.11.0+build.", need: "24.11", want: 2 },
    { have: "v24.11.0.999", need: "24.11", want: 2 },
    { have: "v24.11.0", need: "24.11.0.1", want: 2 },
    { have: "not a version", need: "24.11", want: 2 },
    { have: "", need: "24.11", want: 2 },
    { have: "v24.11.0", need: "9223372036854775808", want: 2 },
    { have: "v9223372036854775808.0.0", need: "24.11", want: 2 },
    { have: "v24.1234567890.0", need: "24.11", want: 2 },
    { have: "v999999999.0.0", need: "24.11", want: 0 },
    { have: "v24.11.0", need: "999999999", want: 1 },
  ])("$have against >=$need exits $want", ({ have, need, want }) => {
    expect(meets({ have, need })).toBe(want);
  });
});

/**
 * `node_engines_floor` over one package.json body, written to a throwaway file.
 *
 * @param body the file's contents
 * @returns the exit status and the NODE_FLOOR it set
 */
function floorOf({ body }: { body: string }): { readonly status: number | null; readonly floor: string } {
  const dir = mkdtempSync(join(tmpdir(), "slop-engines-floor-"));
  try {
    const path = join(dir, "package.json");
    writeFileSync(path, body);
    const run = spawnSync(
      "/bin/bash",
      [
        "-c",
        'set -euo pipefail; s=0; source "$1"; node_engines_floor "$2" || s=$?; printf %s "$NODE_FLOOR"; exit "$s"',
        "_",
        HELPER,
        path,
      ],
      { encoding: "utf8" },
    );
    return { floor: run.stdout, status: run.status };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

describe("node_engines_floor", () => {
  it.each([
    { body: '{\n  "engines": {\n    "node": ">=24.11"\n  }\n}\n', floor: "24.11", status: 0 },
    { body: '{\n  "engines": {\n    "node": ">=24.11.0"\n  }\n}\n', floor: "24.11.0", status: 0 },
    { body: '{ "engines": { "node": ">= v24" } }', floor: "24", status: 0 },
    { body: '{\n  "engines": {\n    "node": "^24.11.0"\n  }\n}\n', floor: "", status: 1 },
    { body: '{\n  "engines": {\n    "node": ">=24.x"\n  }\n}\n', floor: "", status: 1 },
    { body: '{\n  "name": "x"\n}\n', floor: "", status: 1 },
    { body: '{"name":"x","version":"1.0.0","engines":{"node":">=9223372036854775808"}}\n', floor: "", status: 1 },
    { body: '{"engines":{"node":">=24.1234567890"}}\n', floor: "", status: 1 },
    { body: '{"engines":{"node":">=999999999"}}\n', floor: "999999999", status: 0 },
    { body: '{"engines":{"node":">=1.2.3.4"}}\n', floor: "", status: 1 },
    { body: '{"engines":{"node":">=24.11.1"}}\n', floor: "24.11.1", status: 0 },
    // A dependency's own `node` key OUTSIDE the engines block is never read as the floor.
    { body: '{\n  "x": {\n    "node": ">=18"\n  },\n  "engines": {}\n}\n', floor: "", status: 1 },
    // A counterexample: the STRING "engines" as a value never opens the block, so the dependency
    // below it is never read as the floor, and the real top-level one is.
    {
      body: '{\n  "description": "engines",\n  "dependencies": {\n    "node": ">=18"\n  },\n  "engines": {\n    "node": ">=24.11"\n  }\n}\n',
      floor: "24.11",
      status: 0,
    },
    // Depth, never indentation, decides top level: a nested `x.engines` laid out flush with the top-level keys
    // is not the package's own, and braces inside a string do not move the depth.
    {
      body: '{\n"engines": {"node": ">=24"},\n"x": {\n"engines": {"node": ">=18"}\n},\n"s": "}{ \\" }"\n}\n',
      floor: "24",
      status: 0,
    },
    // An `engines` key nested inside another object is not the package's own.
    { body: '{\n  "x": {\n    "engines": {\n      "node": ">=18"\n    }\n  }\n}\n', floor: "", status: 1 },
    // The `>=` read is the one after `"node"`, never the first on the line.
    { body: '{ "engines": { "npm": ">=9", "node": ">=24.11" } }', floor: "24.11", status: 0 },
    // A nested object inside `engines` is not npm's shape, so its `node` member is refused, never read.
    { body: '{"engines":{"npm":{"node":">=18"},"node":">=24.11"}}', floor: "", status: 1 },
    // `"node"` as a VALUE is not the key: the `">=` after it belongs to another engine.
    { body: '{ "engines": { "x": "node", "npm": ">=9" } }', floor: "", status: 1 },
    // Duplicate top-level `engines`: JSON.parse keeps the LAST, and so does this read.
    {
      body: '{\n  "engines": {\n    "node": ">=18"\n  },\n  "engines": {\n    "node": ">=24.11"\n  }\n}\n',
      floor: "24.11",
      status: 0,
    },
    { body: '{\n  "engines": {\n    "node": ">=24.11"\n  },\n  "engines": {}\n}\n', floor: "", status: 1 },
    // A duplicate `node` inside one block: the last wins, on a later line or the same one.
    {
      body: '{\n  "engines": {\n    "node": ">=18",\n    "node": ">=24"\n  }\n}\n',
      floor: "24",
      status: 0,
    },
    { body: '{\n  "engines": {\n    "node": ">=24",\n    "node": "^18"\n  }\n}\n', floor: "", status: 1 },
    { body: '{"engines":{"node":">=18","node":">=24"}}', floor: "24", status: 0 },
    // An array nests like an object: its `"engines"` element is never the key, and the real one still reads.
    {
      body: '{\n  "keywords": [\n    "engines"\n  ],\n  "engines": {\n    "node": ">=24"\n  }\n}\n',
      floor: "24",
      status: 0,
    },
    // A top-level key after the `}` that closes `engines` is a top-level key, never an engine.
    { body: '{\n  "engines": {\n    "node": ">=24"\n  }, "node": ">=18"\n}\n', floor: "24", status: 0 },
    { body: '{\n  "engines": {\n    "node": ">=24"\n  },\n  "node": ">=18"\n}\n', floor: "24", status: 0 },
    // A later top-level `engines` wins wherever it sits on its line: after another key, or after a
    // nested object's closing `}` (against the line reader this token scanner replaced).
    {
      body: '{\n  "engines": {"node": ">=18"},\n  "name": "x", "engines": {"node": ">=24"}\n}\n',
      floor: "24",
      status: 0,
    },
    {
      body: '{\n  "engines": {"node": ">=18"},\n  "x": {\n    "name": "nested"\n  }, "engines": {"node": ">=24"}\n}\n',
      floor: "24",
      status: 0,
    },
    // The word as a VALUE, or inside an escaped string, is not a key and leaves the real floor readable.
    {
      body: '{\n  "a": "\\"engines\\": 1", "b": "engines",\n  "engines": {\n    "node": ">=24"\n  }\n}\n',
      floor: "24",
      status: 0,
    },
    // A key spelled with an escape is one JSON decodes and a text match cannot, so it is refused;
    // an escape in a VALUE is not a key and leaves the floor readable.
    {
      body: '{\n  "engines": {\n    "node": ">=18"\n  },\n  "\\u0065ngines": {\n    "node": ">=24"\n  }\n}\n',
      floor: "",
      status: 1,
    },
    { body: '{\n  "engines": {\n    "\\u006eode": ">=18",\n    "node": ">=24"\n  }\n}\n', floor: "", status: 1 },
    // An escaped backslash or quote in a key is an escape too: never erased into a bare `engines`.
    { body: '{"engines":{"node":">=24"},"\\\\engines":{"node":">=18"}}', floor: "", status: 1 },
    { body: '{"engines":{"node":">=24"},"engi\\"nes":{"node":">=18"}}', floor: "", status: 1 },
    {
      body: '{\n  "description": "caf\\u00e9",\n  "engines": {\n    "node": ">=24"\n  }\n}\n',
      floor: "24",
      status: 0,
    },
    // Two on ONE line: still the last.
    { body: '{"engines":{"node":">=18"},"engines":{"node":">=24.11"}}', floor: "24.11", status: 0 },
    // An `engines` that is not an object is refused rather than scanned past.
    { body: '{\n  "engines": "node >=18",\n  "x": {\n    "node": ">=18"\n  }\n}\n', floor: "", status: 1 },
    // A `node` whose value is a bare literal, an unterminated string or unbalanced nesting refuses.
    { body: '{\n  "engines": {\n    "node": 24\n  }\n}\n', floor: "", status: 1 },
    { body: '{\n  "engines": {\n    "node": ">=24\n  }\n}\n', floor: "", status: 1 },
    { body: '{\n  "engines": {\n    "node": ">=24"\n  }\n', floor: "", status: 1 },
  ])("$body reads floor '$floor' with status $status", ({ body, floor, status }) => {
    expect(floorOf({ body })).toEqual({ floor, status });
  });
});

describe("node_engines_floor over this repository", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { engines: { node: string } };

  it("reads the same floor JSON.parse does", () => {
    const floor = execFileSync(
      "/bin/bash",
      [
        "-c",
        'set -euo pipefail; source "$1"; node_engines_floor "$2"; printf %s "$NODE_FLOOR"',
        "_",
        HELPER,
        join(repoRoot, "package.json"),
      ],
      { encoding: "utf8" },
    );
    expect(`>=${floor}`).toBe(pkg.engines.node);
  });

  it("pins an exact .nvmrc version that meets that floor, so the no-exec tier can serve it", () => {
    const nvmrc = readFileSync(join(repoRoot, ".nvmrc"), "utf8").trim();
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(meets({ have: nvmrc, need: pkg.engines.node.replace(/^>=/u, "") })).toBe(0);
  });
});

/**
 * `node_resolve`'s ambient tier, from a cwd holding `relbin/node`, over a checkout with no `.nvmrc`.
 *
 * @param pathEntry the one PATH entry ahead of /usr/bin:/bin that names the fake node
 * @returns the NODE_RESOLVED and NODE_PREPEND it set, and the cwd it ran in
 */
function ambientFrom({ pathEntry }: { pathEntry: (start: string) => string }): {
  readonly resolved: string;
  readonly prepend: string;
  readonly start: string;
} {
  const root = mkdtempSync(join(tmpdir(), "slop-ambient-"));
  try {
    const start = realpathSync(root);
    const cli = join(start, "cli");
    mkdirSync(join(start, "relbin"), { recursive: true });
    mkdirSync(cli);
    writeFileSync(join(cli, "package.json"), '{\n  "engines": {\n    "node": ">=24.11"\n  }\n}\n');
    writeFileSync(join(start, "relbin", "node"), "#!/bin/sh\necho v24.11.0\n", { mode: 0o755 });
    const run = execFileSync(
      "/bin/bash",
      [
        "-c",
        'set -euo pipefail; source "$1"; node_resolve "$2"; printf "%s\\n%s" "$NODE_RESOLVED" "$NODE_PREPEND"',
        "_",
        HELPER,
        cli,
      ],
      { cwd: start, encoding: "utf8", env: { PATH: `${pathEntry(start)}:/usr/bin:/bin` } },
    );
    const [resolved, prepend] = run.split("\n");
    return { prepend: prepend!, resolved: resolved!, start };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe("node_resolve's ambient tier", () => {
  // A node found through a RELATIVE entry was probed from the caller's cwd, then the
  // launcher cd'd into the checkout and a different `relbin/node` answered corepack's `env node`.
  it("makes a node found through a relative PATH entry absolute and puts its directory first", () => {
    const { resolved, prepend, start } = ambientFrom({ pathEntry: () => "relbin" });
    expect({ prepend, resolved }).toEqual({ prepend: `${start}/relbin`, resolved: `${start}/relbin/node` });
  });

  // An EARLIER relative entry naming no node from the caller's cwd can name an old one from the
  // checkout's, so an absolute find on such a PATH is put first too.
  it("puts an absolute find first when an earlier PATH entry is relative", () => {
    const { resolved, prepend, start } = ambientFrom({ pathEntry: (dir) => `nothere:${dir}/relbin` });
    expect({ prepend, resolved }).toEqual({ prepend: `${start}/relbin`, resolved: `${start}/relbin/node` });
  });

  it("leaves PATH alone for a node found on a PATH of absolute entries only", () => {
    const { resolved, prepend, start } = ambientFrom({ pathEntry: (dir) => `${dir}/relbin` });
    expect({ prepend, resolved }).toEqual({ prepend: "", resolved: `${start}/relbin/node` });
  });
});

describe("node_resolve's .nvmrc tier", () => {
  // `PROTO_HOME=relproto` found a v24 from the caller's cwd, then the launcher cd'd into the
  // checkout and a v18 under ITS `relproto` answered corepack's `env node`.
  it("makes a find under a relative manager home absolute before putting its directory first", () => {
    const root = mkdtempSync(join(tmpdir(), "slop-nvmrc-"));
    try {
      const start = realpathSync(root);
      const cli = join(start, "cli");
      const bin = join(start, "relproto", "tools", "node", "24.21.0", "bin");
      mkdirSync(bin, { recursive: true });
      mkdirSync(cli);
      writeFileSync(join(cli, "package.json"), '{\n  "engines": {\n    "node": ">=24"\n  }\n}\n');
      writeFileSync(join(cli, ".nvmrc"), "24.21.0\n");
      writeFileSync(join(bin, "node"), "#!/bin/sh\necho v24.21.0\n", { mode: 0o755 });
      const run = execFileSync(
        "/bin/bash",
        [
          "-c",
          'set -euo pipefail; source "$1"; node_resolve "$2"; printf "%s\\n%s" "$NODE_RESOLVED" "$NODE_PREPEND"',
          "_",
          HELPER,
          cli,
        ],
        { cwd: start, encoding: "utf8", env: { HOME: start, PATH: "/usr/bin:/bin", PROTO_HOME: "relproto" } },
      );
      expect(run.split("\n")).toEqual([`${bin}/node`, bin]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
