/** What a lifecycle verb publishes to the cmux sidebar — the row's own ref, and never a lane, checklist or bar. */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import type { CmuxCli } from "../../../cmux/sidebar.js";
import { insideCmuxWorkspace, publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { err, ok } from "../../../lib/result.js";

/**
 * A recording fake `cmux` binary that can be told to fail.
 *
 * `identify` is the one subcommand whose stdout is PARSED rather than ignored, so the fake answers it with a
 * real-shaped reply; everything else writes and returns nothing.
 */
function fakeCli({ fails = false }: { fails?: boolean } = {}): { calls: (readonly string[])[]; cli: CmuxCli } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    cli: {
      run: ({ argv }) => {
        calls.push(argv);
        if (fails) {
          return err(CmuxErrors.callFailed({ cmuxCode: "cli_failed", message: "cmux exited 1", method: "cmux" }));
        }
        return ok(argv[0] === "identify" ? JSON.stringify({ caller: { workspace_ref: "workspace:266" } }) : "");
      },
    },
  };
}

describe("insideCmuxWorkspace", () => {
  it("is true when cmux has exported a workspace id into this process", () => {
    expect(insideCmuxWorkspace({ env: { CMUX_WORKSPACE_ID: "7BFB" } })).toBe(true);
  });

  it("is false outside a cmux workspace, so a plain-terminal lifecycle verb stays quiet", () => {
    expect(insideCmuxWorkspace({ env: {} })).toBe(false);
  });

  it("treats a blank id as absent", () => {
    expect(insideCmuxWorkspace({ env: { CMUX_WORKSPACE_ID: "  " } })).toBe(false);
  });

  it("never publishes from a test, which inherits the developer's own workspace id", () => {
    expect(insideCmuxWorkspace({ env: { CMUX_WORKSPACE_ID: "7BFB", VITEST: "true" } })).toBe(false);
  });
});

describe("publishRunWorkspaceRef", () => {
  const INSIDE = { CMUX_WORKSPACE_ID: "7BFB" };

  it("publishes nothing at all when nothing is running inside cmux", () => {
    const { calls, cli } = fakeCli();

    publishRunWorkspaceRef({ cli, env: {}, verb: "handover start" });

    expect(calls).toEqual([]);
  });

  it("publishes the CALLER's own ref as a pill and nothing else — no lane, no checklist, no progress bar", () => {
    const { calls, cli } = fakeCli();

    publishRunWorkspaceRef({ cli, env: INSIDE, verb: "handover start" });

    expect(calls).toEqual([
      ["identify", "--json"],
      ["set-status", "ws", "workspace:266", "--icon", "number", "--priority", "100"],
    ]);
  });

  it("stops after a failed ref read and throws nothing — a sidebar publish never fails the run", () => {
    const { calls, cli } = fakeCli({ fails: true });

    publishRunWorkspaceRef({ cli, env: INSIDE, verb: "handover start" });

    expect(calls).toEqual([["identify", "--json"]]);
  });
});
