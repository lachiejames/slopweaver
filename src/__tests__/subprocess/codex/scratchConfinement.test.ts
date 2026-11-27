/**
 * The kernel proof that a Codex pass writes inside its own scratch and NOWHERE in the temp folder, where every
 * snapshot pool slot a review reads lives — run through the real vendored `codex sandbox` with the exact launch a
 * pass thread gets (`codex/electronProbe.ts`'s `runSandboxedPassShell`, over `codex/client.ts`'s
 * `codexThreadLaunch`), and no model call.
 *
 * Why darwin alone: Codex's seatbelt sandbox is what a local lap runs, and its Linux sandbox is not established on
 * hosted `ubuntu-latest`. **On darwin a missing vendored binary FAILS this file**, loudly, rather than skipping it:
 * a proof that quietly does not run reads exactly like one that passed. The always-running halves are the unit
 * tests over the same launch (`unit/codex/threadLaunch.test.ts`, `capabilities.test.ts`).
 *
 * The control case is the falsifiable witness: the same binary under a plain `workspace-write` launch, with
 * `TMPDIR` naming the temp parent the pool canary sits in, DOES write there. Without it, a refused canary would
 * prove only that the path was unwritable for some other reason.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPassScratch } from "../../../codex/artifactStore.js";
import { codexClientEnvironment } from "../../../codex/client.js";
import { runSandboxedPassShell } from "../../../codex/electronProbe.js";
import { applyCodexScratchShellGuard } from "../../../codex/scratchShellGuard.js";
import { type CodexCli, vendoredCodexCli, withCodexPathDirs } from "../../../codex/vendoredCli.js";

/** Every directory and `/tmp` canary this file minted, removed after each case whatever it proved. */
const minted: string[] = [];

afterEach(() => {
  for (const path of minted.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

/**
 * The vendored CLI, or a thrown error naming why there is none — the loud failure, never a skip.
 *
 * @returns the CLI this machine's passes run
 */
function requireVendoredCli(): CodexCli {
  const cli = vendoredCodexCli();
  if ("reason" in cli) {
    throw new Error(`the scratch-confinement proof cannot run on darwin without the vendored Codex CLI: ${cli.reason}`);
  }
  return cli;
}

/** One case's fixture: a real pass scratch, an empty Codex home, and a pool-shaped directory beside them. */
function fixture(): { scratch: string; codexHome: string; poolSlot: string } {
  const root = mkdtempSync(join(tmpdir(), "sw-conf-"));
  minted.push(root);
  const codexHome = join(root, "codex-home");
  const scratch = createPassScratch({ artifactId: "confined", orchestrationRoot: join(root, "orchestration") });
  const poolSlot = mkdtempSync(join(tmpdir(), "slopweaver-snap-pool-"));
  minted.push(poolSlot);
  mkdirSync(codexHome);
  return { codexHome, poolSlot, scratch: scratch._unsafeUnwrap() };
}

describe.runIf(process.platform === "darwin")("a pass's sandbox, on the real vendored codex", () => {
  it("runs a heredoc, mktemp and an answer in scratch, and refuses a write under the temp folder or /tmp", () => {
    const cli = requireVendoredCli();
    const { codexHome, poolSlot, scratch } = fixture();
    const poolCanary = join(poolSlot, "slot-0", "tree-canary");
    const slashTmpCanary = join("/tmp", `sw-conf-canary-${randomUUID()}`);
    minted.push(slashTmpCanary);
    const script = [
      "cat > heredoc.txt <<'EOF'",
      "heredoc-body",
      "EOF",
      "made=$(mktemp) || exit 11",
      "print -r -- $made > mktemp-path.txt",
      "print -r -- answer-body > answer.txt",
      `mkdir -p '${dirname(poolCanary)}' 2>/dev/null && print -r -- x > '${poolCanary}' 2>/dev/null && exit 21`,
      `print -r -- x > '${slashTmpCanary}' 2>/dev/null && exit 22`,
      "exit 0",
    ].join("\n");

    const run = runSandboxedPassShell({
      cli,
      codexHome,
      command: ["/bin/zsh", "-f", "-c", script],
      cwd: scratch,
      posture: "pass",
    });

    expect({ failure: run.failure, status: run.status }).toEqual({ failure: undefined, status: 0 });
    expect(readFileSync(join(scratch, "heredoc.txt"), "utf8")).toBe("heredoc-body\n");
    expect(readFileSync(join(scratch, "answer.txt"), "utf8")).toBe("answer-body\n");
    expect(dirname(readFileSync(join(scratch, "mktemp-path.txt"), "utf8").trim())).toBe(join(scratch, ".tmp"));
    expect(existsSync(dirname(poolCanary))).toBe(false);
    expect(existsSync(slashTmpCanary)).toBe(false);
  });

  it("admits a pass thread through the scratch-shell guard, read with `env -0` on the real sandbox", () => {
    const cli = requireVendoredCli();
    const { codexHome, scratch } = fixture();

    expect(applyCodexScratchShellGuard({ cli, codexHome, cwd: scratch, env: {} })).toEqual({
      kind: "proceed",
      notice: undefined,
    });
  });

  it("CONTROL: a plain workspace-write launch with TMPDIR at that temp parent does write there", () => {
    const cli = requireVendoredCli();
    const { codexHome, poolSlot, scratch } = fixture();
    const canary = join(poolSlot, "control-canary");
    const env = withCodexPathDirs({
      env: { ...codexClientEnvironment({ codexHome, env: process.env }), TMPDIR: poolSlot },
      pathDirs: cli.pathDirs,
    });

    const run = spawnSync(
      cli.path,
      ["sandbox", "-c", 'sandbox_mode="workspace-write"', "--", "/bin/zsh", "-f", "-c", `print -r -- x > '${canary}'`],
      { cwd: scratch, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
    );

    expect(run.status).toBe(0);
    expect(readFileSync(canary, "utf8")).toBe("x\n");
  });
});
