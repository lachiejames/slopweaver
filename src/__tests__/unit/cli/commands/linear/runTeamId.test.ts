/**
 * `linear issue create` with a team KEY where the form wants the team's UUID: the dry run and the live write
 * must refuse it IDENTICALLY.
 *
 * Measured before this test existed: `--dry-run` printed `team: ABC` and exited 0, certifying a write the
 * provider then refused with an Argument Validation Error. Both paths now parse the form through the one
 * schema before they branch, so this asserts the parity itself — same exit, same refusal — and that the live
 * run reached no edge at all: no token, no API, no catalog, no roster.
 *
 * Every edge is a plain injected function. No mocks.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinearIssue } from "../../../../../cli/commands/linear/run.js";
import type { LinearWriteDeps } from "../../../../../cli/commands/linear/writeDeps.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const KEYED_FORM = JSON.stringify({
  artifact: {
    aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
  },
  fields: { teamId: "ABC", title: "A title" },
});

/** Deps whose every effectful edge records that it was reached, and whose output sinks collect lines. */
function recordingDeps(): { deps: LinearWriteDeps; calls: string[]; out: string[]; err: string[] } {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const reached = ({ edge }: { edge: string }): never => {
    calls.push(edge);
    throw new Error(`a form refused at parse must never reach ${edge}`);
  };
  return {
    calls,
    deps: {
      autonomy: memoryAutonomyLedgerPort(),
      bareRefContext: () => reached({ edge: "bareRefContext" }),
      doorLedger: memoryDoorLedger().port,
      env: () => undefined,
      err: (line) => err.push(line),
      makeApi: () => reached({ edge: "makeApi" }),
      nowIso: () => "2026-11-06T09:00:00.000Z",
      out: (line) => out.push(line),
      previewAssignee: () => reached({ edge: "previewAssignee" }),
      previewMentions: () => reached({ edge: "previewMentions" }),
      readForm: () => KEYED_FORM,
      resolveAssignee: () => reached({ edge: "resolveAssignee" }),
      resolveMentions: () => reached({ edge: "resolveMentions" }),
      resolveToken: () => reached({ edge: "resolveToken" }),
      stateCatalog: () => reached({ edge: "stateCatalog" }),
    },
    err,
    out,
  };
}

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Run `linear issue create` over the keyed form, with or without `--dry-run`, in a fresh home. */
async function createWithKey({ dryRun }: { dryRun: boolean }): Promise<{
  code: number;
  calls: string[];
  out: string[];
  err: string[];
}> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-teamid-"));
  fixtureDirs.push(home);
  const recorded = recordingDeps();
  const rest = ["create", "--form", "-", ...(dryRun ? ["--dry-run"] : []), "--home", home];
  const code = await runLinearIssue({ argv: ["node", "slopweaver", "linear", "issue", ...rest], deps: recorded.deps });
  return { calls: recorded.calls, code, err: recorded.err, out: recorded.out };
}

describe("a team key in place of the team UUID", () => {
  it("is refused by the dry run and the live write alike, before either reaches any edge", async () => {
    const dry = await createWithKey({ dryRun: true });
    const live = await createWithKey({ dryRun: false });

    expect([dry.code, live.code]).toEqual([EXIT_USAGE, EXIT_USAGE]);
    expect(live.err).toEqual(dry.err);
    expect(dry.err.join("\n")).toContain(
      "if ABC is a team's key, `slopweaver linear states --team ABC` prints its UUID",
    );
    // The dry run no longer prints a preview certifying `team: ABC`, and the live run built nothing.
    expect(dry.out).toEqual([]);
    expect([dry.calls, live.calls]).toEqual([[], []]);
  });
});
