/**
 * The half of Codex seat routing a string comparison cannot reach: does the line `cmux spawn` sends actually
 * put the ROUTED home into the booted process's environment?
 *
 * The unit lane already asserts the exact text (`unit/cmux/spawn/spawnCodexBootLine.test.ts`), and that text
 * would be equally green if a shell ignored the assignment, if the prefix were quoted into the command word,
 * or if an exported ambient `CODEX_HOME` won. Each of those is a real way to route a seat onto the wrong account
 * while every unit test stays green, and each is only observable by running the line and asking the CHILD
 * what it sees. This is the lane that does that.
 *
 * The child is a throwaway `codex` executable first on `PATH` — never the real one, which would open a TUI
 * and spend an account. What is under test is the LINE, not the runner: a fake named `codex` proves the
 * shell hands the routed home and the pinned model to whatever `codex` resolves to, which is exactly the
 * contract `src/cmux/seatRoute.ts`'s `codexBootLine` claims.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NX_DAEMON_OFF_PREFIX } from "../../../cmux/fleetEnv.js";
import { codexBootLine } from "../../../cmux/seatRoute.js";
import { CODEX_MODEL } from "../../../codex/profiles.js";

/**
 * The overrides switching the ChatGPT app's browser and computer-use tools off, spelled out rather than
 * derived, so a change to `codex/browserSurface.ts` has to be seen reaching a real child to stay green.
 */
const BROWSER_OFF_ARGS =
  " -c plugins.browser@openai-bundled.enabled=false -c plugins.computer-use@openai-bundled.enabled=false" +
  " -c plugins.unified-computer-use@openai-bundled.enabled=false -c mcp_servers.node_repl.command=/usr/bin/false" +
  " -c mcp_servers.node_repl.enabled=false";

/** An ambient home the routed one must beat — never this machine's real `$CODEX_HOME`. */
const AMBIENT_HOME = "/state/ambient-codex-home-that-must-not-win";

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * A directory holding a fake `codex` that reports what it was actually given, ready to go first on `PATH`.
 *
 * @returns the directory to prepend to `PATH`
 */
function fakeCodexOnPath(): string {
  const dir = tempDir({ prefix: "codex-fake-bin-" });
  const script = [
    "#!/bin/sh",
    'echo "CODEX_HOME=${CODEX_HOME}"',
    'echo "NX_DAEMON=${NX_DAEMON}"',
    'echo "ARGS=$*"',
    "",
  ].join("\n");
  const path = join(dir, "codex");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return dir;
}

/**
 * Run one boot line through a real shell, with a CONFLICTING ambient `CODEX_HOME` and `NX_DAEMON` exported into it.
 *
 * @param line the exact line `codexBootLine` produced
 * @returns whatever the fake `codex` printed
 */
function runBootLine({ line }: { line: string }): string {
  // An honest assertion rather than a coalesce: `PATH` is set in every environment that can run this lane at
  // all, and substituting an empty one would leave the fake `codex` reachable while every other command in
  // the line silently stopped resolving — a green test over a shell that could no longer find anything.
  const inheritedPath = process.env["PATH"]!;
  return execFileSync("/bin/sh", ["-c", line], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: AMBIENT_HOME, NX_DAEMON: "true", PATH: `${fakeCodexOnPath()}:${inheritedPath}` },
  });
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("the line that boots a visible Codex seat", () => {
  it("puts the ROUTED home into the booted process, beating the exported ambient one", () => {
    const routed = tempDir({ prefix: "codex-routed-home-" });

    const observed = runBootLine({ line: codexBootLine({ codexHome: routed, envPrefix: "" }) });

    expect(observed).toContain(`CODEX_HOME=${routed}\n`);
    expect(observed).not.toContain(AMBIENT_HOME);
  });

  // The falsifiable partner: strip the routed home and the SAME child, in the same shell, reports the
  // ambient one. Without this, the case above would be green against a machine whose ambient home happened
  // to be unset, and would prove nothing about which value won.
  it("leaves an unrouted seat on the ambient home, so the prefix is what decides", () => {
    const observed = runBootLine({ line: codexBootLine({ codexHome: undefined, envPrefix: "" }) });

    expect(observed).toContain(`CODEX_HOME=${AMBIENT_HOME}\n`);
  });

  it("reaches the runner with the interactive flag and the repository's model pin, not `codex exec`", () => {
    const observed = runBootLine({
      line: codexBootLine({ codexHome: tempDir({ prefix: "codex-routed-home-" }), envPrefix: "" }),
    });

    expect(observed).toContain(`ARGS=--no-alt-screen --model ${CODEX_MODEL}${BROWSER_OFF_ARGS}\n`);
  });

  it("survives a home carrying a space, rather than running its second word as the command", () => {
    const parent = tempDir({ prefix: "codex-routed-home-" });
    const spaced = join(parent, "my codex home");

    const observed = runBootLine({ line: codexBootLine({ codexHome: spaced, envPrefix: "" }) });

    expect(observed).toContain(`CODEX_HOME=${spaced}\n`);
    expect(observed).toContain(`ARGS=--no-alt-screen --model ${CODEX_MODEL}${BROWSER_OFF_ARGS}\n`);
  });

  // A fleet-worktree seat must reach its child with nx's daemon off AND still carry its
  // routed home — the two prefixes share one local, so this is the case that proves neither ate the other.
  it("puts NX_DAEMON=false into a fleet-worktree seat's process beside its routed home", () => {
    const routed = tempDir({ prefix: "codex-routed-home-" });

    const observed = runBootLine({ line: codexBootLine({ codexHome: routed, envPrefix: NX_DAEMON_OFF_PREFIX }) });

    expect(observed).toContain("NX_DAEMON=false\n");
    expect(observed).toContain(`CODEX_HOME=${routed}\n`);
  });

  // The falsifiable partner: the shell exports NX_DAEMON=true, so an empty prefix must leave that value standing.
  it("leaves nx's daemon setting alone for a seat outside a fleet worktree", () => {
    const observed = runBootLine({ line: codexBootLine({ codexHome: undefined, envPrefix: "" }) });

    expect(observed).toContain("NX_DAEMON=true\n");
  });
});
