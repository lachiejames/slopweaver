/** {@link spawnCmuxSession}'s boot line: the plugin checkout, credential prefixes, and each host's own flags. */
import { describe, expect, it } from "vitest";

import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { codexBrowserOffFlags } from "../../../../codex/browserSurface.js";
import { CODEX_MODEL } from "../../../../codex/profiles.js";
import { fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

describe("spawnCmuxSession", () => {
  it("launches Claude with this plugin checkout explicitly named", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(`NX_DAEMON=false claude --plugin-dir /repo/slopweaver`);
  });

  it("PREFIXES the credential store on the boot line when the seat is pinned", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: { ...PLAN, credentialStoreDir: "/stores/three" } });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(
      `NX_DAEMON=false CLAUDE_SECURESTORAGE_CONFIG_DIR=/stores/three claude --plugin-dir /repo/slopweaver`,
    );
  });

  it("opens a setup token on a descriptor ahead of the command word, keeping the token out of argv", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.272 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({
      deps: spawnDeps,
      plan: { ...PLAN, credentialStoreDir: "/home/unbound/w1", credentialTokenPath: "/stores/two/setup-token" },
    });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(
      "NX_DAEMON=false CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/w1 3</stores/two/setup-token claude --plugin-dir /repo/slopweaver",
    );
  });

  it("leaves an UNPINNED boot line free of any credential prefix — a worktree seat carries only nx's switch", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).not.toContain("CLAUDE_SECURESTORAGE_CONFIG_DIR");
    expect(bootSend.text!.startsWith("NX_DAEMON=false claude ")).toBe(true);
  });

  it("appends --model to the claude boot line when the plan names one", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: { ...PLAN, model: "sonnet" } });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(`NX_DAEMON=false claude --plugin-dir /repo/slopweaver --model sonnet`);
  });

  it("appends --name to the claude boot line when the plan names the session", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booted…"] });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({
      deps: spawnDeps,
      plan: { ...PLAN, model: "opus", sessionName: "ask-C1-1787720788.183959" },
    });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(
      `NX_DAEMON=false claude --plugin-dir /repo/slopweaver --model opus --name ask-C1-1787720788.183959`,
    );
  });

  it("never appends --name to the codex boot line — codex has no such flag", async () => {
    const { calls, client } = fakeClient({
      screens: ["$ ", "OpenAI Codex (v0.145.0) starting…"],
    });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({
      deps: spawnDeps,
      plan: { ...PLAN, driver: "codex", host: "codex", sessionName: "ask-C1-1787720788.183959" },
    });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    expect(bootSend.text).toBe(`NX_DAEMON=false codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`);
  });

  it("boots a codex seat on the repository's pin, never the plan's own CLAUDE tier", async () => {
    const { calls, client } = fakeClient({
      screens: [
        "$ ",
        "OpenAI Codex (v0.145.0) starting…",
        `OpenAI Codex (v0.145.0) starting…\n> ${PLAN.pickupCommand}`,
      ],
    });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: { ...PLAN, host: "codex", model: "opus" } });

    const bootSend = calls.find((call) => call.op === "sendLine")!;
    // `--model` is Claude vocabulary and `codex -m opus` would be refused by the runner; the seat takes the
    // fleet-wide pin instead, and `cmux spawn` prints the substitution rather than absorbing it.
    expect(bootSend.text).toBe(`NX_DAEMON=false codex --no-alt-screen --model ${CODEX_MODEL}${codexBrowserOffFlags()}`);
    expect(bootSend.text).not.toContain("opus");
  });
});
