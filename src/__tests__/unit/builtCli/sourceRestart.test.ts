/**
 * The source restart's command and its preconditions: the exact argv a stale build execs into, every path inside the
 * manifest's own checkout, and each missing piece named rather than exec'd into (an exec of a missing file aborts).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { builtRootOf, runsFromSource } from "../../../builtCli/guard.js";
import {
  isReadableFile,
  SourceLaunchErrors,
  sourceLaunchAvailable,
  sourceRestartArgv,
} from "../../../builtCli/sourceRestart.js";

const ROOT = "/work/seat 50%";

describe("sourceRestartArgv", () => {
  it("keeps the Node and its flags, swaps the built entry for the checkout's source, and keeps the verb's words once", () => {
    const argv = sourceRestartArgv({
      argv: ["/usr/bin/node", "/work/seat 50%/dist-cli/cli/index.js", "handover", "list", "--json"],
      execArgv: ["--max-old-space-size=12288", "--env-file=/tmp/console.env"],
      execPath: "/usr/bin/node",
      root: ROOT,
    });

    expect(argv).toEqual([
      "/usr/bin/node",
      "--max-old-space-size=12288",
      "--env-file=/tmp/console.env",
      "--require",
      "/work/seat 50%/node_modules/tsx/dist/preflight.cjs",
      "--import",
      "file:///work/seat%2050%25/node_modules/tsx/dist/loader.mjs",
      "/work/seat 50%/src/cli/index.ts",
      "handover",
      "list",
      "--json",
    ]);
    expect(pathToFileURL("/work/seat 50%/node_modules/tsx/dist/loader.mjs").href).toBe(
      "file:///work/seat%2050%25/node_modules/tsx/dist/loader.mjs",
    );
  });

  it("carries no verb words when the invocation had none", () => {
    expect(
      sourceRestartArgv({ argv: ["/n", "/w/dist-cli/cli/index.js"], execArgv: [], execPath: "/n", root: "/w" }),
    ).toEqual([
      "/n",
      "--require",
      "/w/node_modules/tsx/dist/preflight.cjs",
      "--import",
      "file:///w/node_modules/tsx/dist/loader.mjs",
      "/w/src/cli/index.ts",
    ]);
  });
});

describe("sourceLaunchAvailable", () => {
  it("is available when this Node can exec and the checkout holds the preflight, the loader and the source entry", () => {
    const asked: string[] = [];

    const launch = sourceLaunchAvailable({
      execveAvailable: true,
      readableFile: ({ path }) => {
        asked.push(path);
        return true;
      },
      root: ROOT,
      version: "v24.21.0",
    });

    expect(unwrap(launch)).toEqual({ root: ROOT });
    expect(asked).toEqual([
      "/work/seat 50%/node_modules/tsx/dist/preflight.cjs",
      "/work/seat 50%/node_modules/tsx/dist/loader.mjs",
      "/work/seat 50%/src/cli/index.ts",
    ]);
  });

  it("names a Node with no execve before it looks at a single file", () => {
    const asked: string[] = [];

    const launch = sourceLaunchAvailable({
      execveAvailable: false,
      readableFile: ({ path }) => {
        asked.push(path);
        return true;
      },
      root: ROOT,
      version: "v22.0.0",
    });

    expect(unwrapErr(launch)).toEqual(SourceLaunchErrors.noExecve({ version: "v22.0.0" }));
    expect(unwrapErr(launch).message).toBe(
      "this Node (v22.0.0) has no process.execve, so it cannot restart on the source",
    );
    expect(asked).toEqual([]);
  });

  it("names the first missing file of the three, each by its own code", () => {
    const missing = ({ absent }: { absent: string }) =>
      unwrapErr(
        sourceLaunchAvailable({
          execveAvailable: true,
          readableFile: ({ path }) => path !== absent,
          root: "/w",
          version: "v24.21.0",
        }),
      );

    expect([
      missing({ absent: "/w/node_modules/tsx/dist/preflight.cjs" }),
      missing({ absent: "/w/node_modules/tsx/dist/loader.mjs" }),
      missing({ absent: "/w/src/cli/index.ts" }),
    ]).toEqual([
      {
        code: "NO_TSX_PREFLIGHT",
        message: "/w/node_modules/tsx/dist/preflight.cjs is not a readable file to restart on",
        path: "/w/node_modules/tsx/dist/preflight.cjs",
      },
      {
        code: "NO_TSX_LOADER",
        message: "/w/node_modules/tsx/dist/loader.mjs is not a readable file to restart on",
        path: "/w/node_modules/tsx/dist/loader.mjs",
      },
      {
        code: "NO_SOURCE_ENTRY",
        message: "/w/src/cli/index.ts is not a readable file to restart on",
        path: "/w/src/cli/index.ts",
      },
    ]);
  });
});

describe("isReadableFile", () => {
  it("takes a readable regular file and nothing else — not a directory where a file should be, not an absent path", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-restart-"));
    try {
      writeFileSync(join(dir, "preflight.cjs"), "");
      mkdirSync(join(dir, "loader.mjs"));

      expect([
        isReadableFile({ path: join(dir, "preflight.cjs") }),
        isReadableFile({ path: join(dir, "loader.mjs") }),
        isReadableFile({ path: join(dir, "index.ts") }),
      ]).toEqual([true, false, false]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("the source restart cannot loop", () => {
  it("looks for the manifest beside `src/` once running the source, and knows it is running the source", () => {
    expect([
      builtRootOf({ moduleUrl: "file:///w/src/builtCli/guard.ts" }),
      builtRootOf({ moduleUrl: "file:///w/dist-cli/builtCli/guard.js" }),
    ]).toEqual(["/w/src", "/w/dist-cli"]);
    expect([
      runsFromSource({ moduleUrl: "file:///w/src/cli/main.ts" }),
      runsFromSource({ moduleUrl: "file:///w/dist-cli/cli/main.js" }),
    ]).toEqual([true, false]);
  });
});
