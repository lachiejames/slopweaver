/**
 * The steps `plans add --provider codex` runs around the register write, each over plain fake seams: which
 * request registers a Codex home, how the home's directory is ensured, where the install's lines go, and when a
 * failed register write still installs.
 */
import { describe, expect, it } from "vitest";

import {
  addedCodexHome,
  ensureCodexHome,
  syncAddedCodexHome,
  syncIfRowCommitted,
} from "../../../../../cli/commands/plans/codexAdd.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { CodexPluginSyncErrors } from "../../../../../codexPlugin/errors.js";
import type { SyncOutcome } from "../../../../../codexPlugin/plan.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import { row } from "./plansRunFixtures.js";

/** What one fake run recorded: the lines on each channel and every sync it was asked for. */
interface Seen {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly synced: { readonly codexHome: string; readonly home: string | undefined }[];
}

/** Fake seams that record every call, answering the given directory result and sync outcome. */
function fakeDeps({
  ensured = ok("created"),
  outcome = { did: "skipped", why: "nothing to do" },
}: {
  ensured?: Result<"created" | "existed", string>;
  outcome?: SyncOutcome;
} = {}): {
  readonly seen: Seen;
  readonly deps: Parameters<typeof syncAddedCodexHome>[0]["deps"];
} {
  const seen: Seen = { diagnostics: [], out: [], synced: [] };
  return {
    deps: {
      ensureStoreDir: () => ensured,
      syncCodexPluginHome: (input) => {
        seen.synced.push(input);
        return outcome;
      },
      writeDiagnostic: (line) => {
        seen.diagnostics.push(line);
      },
      writeOut: (line) => {
        seen.out.push(line);
      },
    },
    seen,
  };
}

const FAILED: SyncOutcome = { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: "boom" }) };

describe("which request registers a Codex home", () => {
  it("names the store directory of a Codex add", () => {
    const request = { row: row({ provider: "codex", storeDir: "/x/two" }), verb: "add" as const };

    expect(addedCodexHome({ request })).toBe("/x/two");
  });

  it("names none for a Claude add", () => {
    const request = { row: row({ provider: "claude", storeDir: "/s/one" }), verb: "add" as const };

    expect(addedCodexHome({ request })).toBeUndefined();
  });

  it("names none for a verb other than add", () => {
    const request = { alias: "codex-two", provider: "codex" as const, verb: "remove" as const };

    expect(addedCodexHome({ request })).toBeUndefined();
  });
});

describe("ensuring the Codex home before the row is written", () => {
  it("reports a directory it made as created", () => {
    const { deps } = fakeDeps({ ensured: ok("created") });

    expect(unwrap(ensureCodexHome({ deps, storeDir: "/x/two" }))).toBe("created");
  });

  it("reports a directory already there as found", () => {
    const { deps } = fakeDeps({ ensured: ok("existed") });

    expect(unwrap(ensureCodexHome({ deps, storeDir: "/x/two" }))).toBe("found");
  });

  it("refuses the add, naming the path and the cause, when the directory cannot be made", () => {
    const { deps } = fakeDeps({ ensured: err("EACCES: permission denied") });

    expect(unwrapErr(ensureCodexHome({ deps, storeDir: "/x/two" }))).toBe(
      "plans: /x/two could not be created (EACCES: permission denied), so no row was added — a Codex home " +
        "nobody can sign into takes no work. Fix the path, then add again",
    );
  });
});

describe("installing into the home the row just published", () => {
  it("prints a sync that did not fail on stdout and exits zero", () => {
    const { deps, seen } = fakeDeps();

    expect(syncAddedCodexHome({ codexHome: "/x/two", deps, diagnosticsOnly: false, home: "/h" })).toBe(EXIT_OK);
    expect(seen).toEqual({
      diagnostics: [],
      out: ["codex plugin-sync: skipped — nothing to do"],
      synced: [{ codexHome: "/x/two", home: "/h" }],
    });
  });

  it("keeps stdout clear under --json, sending even a success line to diagnostics", () => {
    const { deps, seen } = fakeDeps();

    expect(syncAddedCodexHome({ codexHome: "/x/two", deps, diagnosticsOnly: true, home: undefined })).toBe(EXIT_OK);
    expect(seen.out).toEqual([]);
    expect(seen.diagnostics).toEqual(["codex plugin-sync: skipped — nothing to do"]);
  });

  it("sends a failed install to diagnostics and exits non-zero", () => {
    const { deps, seen } = fakeDeps({ outcome: FAILED });

    expect(syncAddedCodexHome({ codexHome: "/x/two", deps, diagnosticsOnly: false, home: "/h" })).toBe(EXIT_ERROR);
    expect(seen.out).toEqual([]);
    expect(seen.diagnostics).toEqual(["codex plugin-sync: FAILED [CRASHED] — the refresh threw: boom"]);
  });
});

describe("installing after a register write that failed", () => {
  it("installs when the row committed and only its projection write failed", () => {
    const { deps, seen } = fakeDeps();
    const error = PlanRegisterErrors.projectionWriteFailed({
      cause: new Error("disk full"),
      committedRevision: 4,
      paths: ["/h/plans.md"],
    });

    syncIfRowCommitted({ codexHome: "/x/two", deps, error, home: "/h" });

    expect(seen).toEqual({
      diagnostics: ["codex plugin-sync: skipped — nothing to do"],
      out: [],
      synced: [{ codexHome: "/x/two", home: "/h" }],
    });
  });

  it("installs nothing when the write committed no row", () => {
    const { deps, seen } = fakeDeps();
    const error = PlanRegisterErrors.registerRevisionConflict({ expectedRevision: 3 });

    syncIfRowCommitted({ codexHome: "/x/two", deps, error, home: "/h" });

    expect(seen.synced).toEqual([]);
  });

  it("installs nothing for a request that registers no Codex home", () => {
    const { deps, seen } = fakeDeps();
    const error = PlanRegisterErrors.projectionWriteFailed({ cause: "x", committedRevision: 4, paths: ["/h/p"] });

    syncIfRowCommitted({ codexHome: undefined, deps, error, home: "/h" });

    expect(seen.synced).toEqual([]);
  });
});
