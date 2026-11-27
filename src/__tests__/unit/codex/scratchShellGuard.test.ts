/**
 * The scratch-shell guard on every pass-posture Codex thread (`codex/scratchShellGuard.ts`) and the reading of its
 * sandboxed `/usr/bin/env`: every arm over plain values — no `codex` process is started.
 */
import { describe, expect, it } from "vitest";

import { type CodexElectronProbeError, CodexElectronProbeErrors } from "../../../codex/electronProbe.js";
import {
  applyCodexScratchShellGuard,
  type CodexScratchShellGuardDecision,
  codexScratchShellGuardDecision,
  readEnvRun,
  type ScratchShellReading,
} from "../../../codex/scratchShellGuard.js";
import type { CodexCli } from "../../../codex/vendoredCli.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const HOME = "/state/plan-six/.codex";
const SCRATCH = "/o/p1.scratch";
const VENDORED: CodexCli = { path: "/vendor/bin/codex", pathDirs: ["/vendor/codex-path"] };
const MOVED: ScratchShellReading = { TMPDIR: "/o/p1.scratch/.tmp", TMPPREFIX: "/o/p1.scratch/.tmp/zsh" };

type Refusal = Extract<CodexScratchShellGuardDecision, { kind: "refuse" }>;

/** Decide over one reading with the hatch shut. */
function decide({
  reading,
}: {
  reading: Result<ScratchShellReading, CodexElectronProbeError>;
}): CodexScratchShellGuardDecision {
  return codexScratchShellGuardDecision({ codexHome: HOME, hatchOpen: false, reading, workingDirectory: SCRATCH });
}

describe("readEnvRun", () => {
  it("reads both temp variables out of a zero exit, ignoring every other entry", () => {
    const stdout = "PATH=/usr/bin\0TMPDIR=/o/p1.scratch/.tmp\0TMPPREFIX=/o/p1.scratch/.tmp/zsh\0HOME=/h\0";
    expect(unwrap(readEnvRun({ run: { failure: undefined, status: 0, stderr: "", stdout } }))).toEqual(MOVED);
  });

  it("reads a variable the shell never saw as absent", () => {
    expect(
      unwrap(readEnvRun({ run: { failure: undefined, status: 0, stderr: "", stdout: "PATH=/usr/bin\0" } })),
    ).toEqual({});
  });

  it("never reads a temp variable forged by newlines inside another variable's value", () => {
    const stdout = "PATH=/usr/bin\0PROBE_SPOOF=x\nTMPDIR=/o/p1.scratch/.tmp\nTMPPREFIX=/o/p1.scratch/.tmp/zsh\0";
    expect(unwrap(readEnvRun({ run: { failure: undefined, status: 0, stderr: "", stdout } }))).toEqual({});
  });

  it("fails any non-zero exit, since env itself exits 0 whatever is set", () => {
    const read = readEnvRun({ run: { failure: undefined, status: 1, stderr: "Error: bad config\n", stdout: "" } });
    expect(unwrapErr(read)).toEqual(
      CodexElectronProbeErrors.sandboxFailed({ status: 1, stderr: "Error: bad config\n" }),
    );
  });

  it("fails a run that never started", () => {
    const read = readEnvRun({ run: { failure: "spawn ENOENT", status: null, stderr: "", stdout: "" } });
    expect(unwrapErr(read).code).toBe("SANDBOX_NOT_STARTED");
  });
});

describe("codexScratchShellGuardDecision", () => {
  it("proceeds silently when both variables point inside the thread's own scratch", () => {
    expect(decide({ reading: ok(MOVED) })).toEqual({ kind: "proceed", notice: undefined });
  });

  it("refuses a shell whose TMPPREFIX was dropped, naming what it saw and the fix", () => {
    const decision = decide({ reading: ok({ TMPDIR: "/o/p1.scratch/.tmp" }) });
    expect(decision.kind).toBe("refuse");
    const { refusal } = decision as Refusal;
    expect(refusal).toContain('TMPDIR="/o/p1.scratch/.tmp", TMPPREFIX=undefined');
    expect(refusal).toContain("add TMPDIR and TMPPREFIX to that list");
    expect(refusal).toContain("SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD=1");
  });

  it("refuses a temp pointing into ANOTHER scratch, not just an absent one", () => {
    const decision = decide({ reading: ok({ TMPDIR: "/o/p2.scratch/.tmp", TMPPREFIX: "/o/p2.scratch/.tmp/zsh" }) });
    expect(decision.kind).toBe("refuse");
  });

  it("refuses an unread environment", () => {
    const decision = decide({ reading: err(CodexElectronProbeErrors.sandboxNotStarted({ failure: "spawn ENOENT" })) });
    expect((decision as Refusal).refusal).toContain("could not be read (codex sandbox could not run: spawn ENOENT)");
  });

  it("proceeds with a notice when the hatch is open", () => {
    const decision = codexScratchShellGuardDecision({
      codexHome: undefined,
      hatchOpen: true,
      reading: ok({}),
      workingDirectory: SCRATCH,
    });
    expect(decision).toEqual({
      kind: "proceed",
      notice:
        "codex pass: Codex scratch-shell guard OVERRIDDEN by SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD=1 — " +
        "a shell a pass on the ambient Codex home runs would see TMPDIR=undefined, TMPPREFIX=undefined, not " +
        '"/o/p1.scratch/.tmp" and "/o/p1.scratch/.tmp/zsh"; most likely that home\'s config.toml declares a ' +
        "shell_environment_policy.include_only that omits them, so add TMPDIR and TMPPREFIX to that list",
    });
  });
});

describe("applyCodexScratchShellGuard", () => {
  it("probes the home, the directory and the binary it was given, and judges against that directory", () => {
    const asked: { codexHome: string | undefined; cwd: string; cli: CodexCli }[] = [];
    const decision = applyCodexScratchShellGuard({
      cli: VENDORED,
      codexHome: HOME,
      cwd: SCRATCH,
      env: {},
      probe: (args) => {
        asked.push(args);
        return ok(MOVED);
      },
    });
    expect(asked).toEqual([{ cli: VENDORED, codexHome: HOME, cwd: SCRATCH }]);
    expect(decision.kind).toBe("proceed");
  });

  it("reads the hatch from the environment it is handed, and only the value 1 opens it", () => {
    const kind = (env: NodeJS.ProcessEnv): string =>
      applyCodexScratchShellGuard({ cli: VENDORED, codexHome: HOME, cwd: SCRATCH, env, probe: () => ok({}) }).kind;
    expect(kind({ SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD: "1" })).toBe("proceed");
    expect(kind({ SLOPWEAVER_ALLOW_CODEX_SCRATCH_SHELL_GUARD: "true" })).toBe("refuse");
    expect(kind({})).toBe("refuse");
  });
});
