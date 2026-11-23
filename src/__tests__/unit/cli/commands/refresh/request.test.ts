/*
 * `resolveRefreshRequest` and `logErrorLines` driven directly over the shared `RefreshDeps` fake — the argv
 * resolution a refresh run does before any network or write.
 */
import { describe, expect, it } from "vitest";
import { missingTokenDiagnostics } from "../../../../../cli/commands/refresh/core.js";
import { REFRESH_USAGE } from "../../../../../cli/commands/refresh/flags.js";
import { logErrorLines, resolveRefreshRequest } from "../../../../../cli/commands/refresh/request.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { argv, fakeDeps } from "./runFakes.js";

describe("resolveRefreshRequest", () => {
  it("prints the usage and exits 0 on --help", () => {
    const cap = fakeDeps({ withHydration: false });

    const resolved = resolveRefreshRequest({ argv: argv({ tail: ["--help"] }), deps: cap.deps });

    expect(resolved).toEqual({ code: EXIT_OK, kind: "exit" });
    expect(cap.out).toEqual([REFRESH_USAGE]);
  });

  it("refuses a selected source with no token before anything runs", () => {
    const cap = fakeDeps({ withHydration: false });

    const resolved = resolveRefreshRequest({ argv: argv({ tail: ["--source", "slack"] }), deps: cap.deps });

    expect(resolved).toEqual({ code: EXIT_USAGE, kind: "exit" });
    expect(cap.errors).toEqual(missingTokenDiagnostics({ selectedSources: ["slack"], tokens: {} }));
  });

  it("resolves a GitHub-only run into a go-ahead request under the injected home", () => {
    const cap = fakeDeps({ withHydration: false });

    const resolved = resolveRefreshRequest({ argv: argv({ tail: ["--source", "github"] }), deps: cap.deps });

    expect(resolved).toMatchObject({ kind: "go", request: { home: "/home", selfRoots: [], sources: ["github"] } });
    expect(cap.errors).toEqual([]);
  });
});

describe("logErrorLines", () => {
  it("emits each line to the error sink, in order, with no usage tail", () => {
    const cap = fakeDeps({ withHydration: false });

    logErrorLines({ lines: ["first", "second"], sink: cap.deps.logger });

    expect(cap.errors).toEqual(["first", "second"]);
  });
});
