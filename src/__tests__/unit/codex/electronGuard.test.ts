/**
 * The Electron guard on every Codex pass thread (`codex/electronGuard.ts`) and the reading of its sandboxed
 * `printenv` (`codex/electronProbe.ts`): every arm over plain values — no `codex` process is started.
 */
import { describe, expect, it } from "vitest";

import type { CodexThreadPosture } from "../../../codex/client.js";
import {
  applyCodexElectronGuard,
  type CodexElectronGuardDecision,
  codexElectronGuardDecision,
} from "../../../codex/electronGuard.js";
import {
  type CodexElectronProbeError,
  CodexElectronProbeErrors,
  readPrintenvRun,
} from "../../../codex/electronProbe.js";
import type { CodexCli } from "../../../codex/vendoredCli.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const HOME = "/state/plan-six/.codex";
const VENDORED: CodexCli = { path: "/vendor/bin/codex", pathDirs: ["/vendor/codex-path"] };

type Refusal = Extract<CodexElectronGuardDecision, { kind: "refuse" }>;

describe("readPrintenvRun", () => {
  it("reads the value a zero exit printed", () => {
    expect(unwrap(readPrintenvRun({ failure: undefined, status: 0, stderr: "", stdout: "1\n" }))).toBe("1");
  });

  // printenv's own answer for an unset variable: exit 1 and nothing printed (Codex review r1's counterexample).
  it("reads a silent exit 1 as the variable unset", () => {
    expect(unwrap(readPrintenvRun({ failure: undefined, status: 1, stderr: "", stdout: "" }))).toBe("");
  });

  it("fails an exit 1 that printed a diagnostic, because the sandbox, not printenv, failed", () => {
    const read = readPrintenvRun({ failure: undefined, status: 1, stderr: "Error: bad config\n", stdout: "" });

    expect(unwrapErr(read)).toEqual({
      code: "SANDBOX_FAILED",
      message: "codex sandbox exited 1: Error: bad config",
      status: 1,
    });
  });

  it("fails a run killed by the timeout", () => {
    expect(unwrapErr(readPrintenvRun({ failure: undefined, status: null, stderr: "", stdout: "" }))).toEqual({
      code: "SANDBOX_FAILED",
      message: "codex sandbox exited null: ",
      status: null,
    });
  });

  it("fails a run that could not start", () => {
    expect(
      unwrapErr(readPrintenvRun({ failure: "spawnSync codex ENOENT", status: null, stderr: "", stdout: "" })),
    ).toEqual({ code: "SANDBOX_NOT_STARTED", message: "codex sandbox could not run: spawnSync codex ENOENT" });
  });
});

describe("codexElectronGuardDecision", () => {
  it("proceeds silently when the pass shell sees 1", () => {
    expect(codexElectronGuardDecision({ codexHome: HOME, hatchOpen: false, printed: ok("1") })).toEqual({
      kind: "proceed",
      notice: undefined,
    });
  });

  it("refuses a home whose pass shell drops the variable, in the four-line shape naming the fix", () => {
    const decision = codexElectronGuardDecision({ codexHome: HOME, hatchOpen: false, printed: ok("") });

    expect(decision.kind).toBe("refuse");
    const lines = (decision as Refusal).refusal.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("a codex plan/review pass thread launch blocked because");
    expect(lines[0]).toContain(`a shell a pass on ${HOME} runs would see ELECTRON_RUN_AS_NODE="", not "1"`);
    expect(lines[0]).toContain("add ELECTRON_RUN_AS_NODE to that list");
    expect(lines[2]).toContain("SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD=1");
  });

  it("refuses any value but 1", () => {
    expect(codexElectronGuardDecision({ codexHome: HOME, hatchOpen: false, printed: ok("0") }).kind).toBe("refuse");
  });

  // An unread environment is not a guarded one: the pass loads the same configuration the read failed on.
  it("refuses an unreadable environment rather than treating it as guarded", () => {
    const decision = codexElectronGuardDecision({
      codexHome: undefined,
      hatchOpen: false,
      printed: err(CodexElectronProbeErrors.sandboxNotStarted({ failure: "spawnSync codex ENOENT" })),
    });

    expect(decision.kind).toBe("refuse");
    expect((decision as Refusal).refusal).toContain(
      "the shell environment a pass on the ambient Codex home would run could not be read (codex sandbox could not run: spawnSync codex ENOENT)",
    );
  });

  it("proceeds past a finding when the hatch is open, and says what it let through", () => {
    expect(codexElectronGuardDecision({ codexHome: HOME, hatchOpen: true, printed: ok("") })).toEqual({
      kind: "proceed",
      notice:
        "codex pass: Codex Electron guard OVERRIDDEN by SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD=1 — " +
        `a shell a pass on ${HOME} runs would see ELECTRON_RUN_AS_NODE="", not "1"; most likely that home's ` +
        "config.toml declares a shell_environment_policy.include_only that omits it, so add ELECTRON_RUN_AS_NODE to that list",
    });
  });
});

describe("applyCodexElectronGuard", () => {
  it("probes the home, the directory and the binary it was given", () => {
    const asked: { codexHome: string | undefined; cwd: string; cli: CodexCli; posture: CodexThreadPosture }[] = [];
    const probe = (args: {
      codexHome: string | undefined;
      cwd: string;
      cli: CodexCli;
      posture: CodexThreadPosture;
    }): Result<string, CodexElectronProbeError> => {
      asked.push(args);
      return ok("1");
    };
    applyCodexElectronGuard({
      cli: VENDORED,
      codexHome: HOME,
      cwd: "/scratch/pass-1",
      env: {},
      posture: "sealed",
      probe,
    });

    expect(asked).toEqual([{ cli: VENDORED, codexHome: HOME, cwd: "/scratch/pass-1", posture: "sealed" }]);
  });

  it("reads the hatch from the environment it is handed, and only the value 1 opens it", () => {
    const decide = (env: NodeJS.ProcessEnv): string =>
      applyCodexElectronGuard({
        cli: VENDORED,
        codexHome: HOME,
        cwd: "/repo",
        env,
        posture: "pass",
        probe: () => ok(""),
      }).kind;

    expect(decide({ SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD: "1" })).toBe("proceed");
    expect(decide({ SLOPWEAVER_ALLOW_CODEX_ELECTRON_GUARD: "true" })).toBe("refuse");
    expect(decide({})).toBe("refuse");
  });
});
