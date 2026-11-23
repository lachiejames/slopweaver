/**
 * The witness for the fold: each guard that used to be its own `PreToolUse` process still REFUSES, through
 * the one shim that replaced all ten.
 *
 * The unit tests cover each guard's decision and `unit/context/hookTimeouts.test.ts` covers the registry's
 * shape. Neither can see the thing that actually goes wrong when ten entries become one — a check wired in
 * but never reached, a matcher that silently stopped applying, a refusal whose text no longer arrives on
 * stderr. So every case here feeds the SHIPPED `scripts/pretooluse.sh` a payload the old hook blocked and
 * asserts exit 2 plus a fragment of that refusal's own words.
 *
 * Two of the ten have their own neighbouring files rather than a case here, because each needs state this
 * one would duplicate: `pollGateHook.test.ts` and `browserDoorGuardHook.test.ts`. The three main-checkout
 * guards need a DECLARED main checkout, which is machine state a subprocess test must not mint, and
 * `session-depth-warning` has no refusal path at all — it is witnessed below by the advisory it injects.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { writeAgentToolBan } from "../../../sessions/agentToolBanStore.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { seedProfileDelivered } from "../../profileDeliveredFixture.js";
import { relayFixture } from "../../relayWordsFixture.js";
import { dispatchAsk, ENGINEER, freshHome, OWNER } from "../../unit/admit/botTurnFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHIM = join(repoRoot, "scripts", "pretooluse.sh");
const HOOK_TIMEOUT_MS = 60_000;
const SESSION = "folded-hook-witness";

/** A memory leaf carrying a wikilink no memory identity can ever answer — a defect the write gate refuses. */
const LEAF_WITH_BAD_LINK = [
  "---",
  "name: a-thing",
  "description: a leaf whose body links to something that is not a memory name",
  "metadata:",
  "  type: project",
  "---",
  "",
  "The body, which links to [[Not A Memory Name]].",
  "",
].join("\n");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test. */
function tempDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Run a shipped shim with a payload on stdin, in an isolated home and an empty plugin config. */
function runHook({
  payload,
  home = tempDir({ prefix: "sw-folded-home-" }),
  shim = SHIM,
}: {
  payload: unknown;
  home?: string;
  shim?: string;
}): {
  status: number | null;
  stderr: string;
  stdout: string;
} {
  // The owner's profile is delivered to this session, so `profile-held` (registered first) does not refuse before the check under test.
  seedProfileDelivered({ home, sessionId: SESSION });
  const run = spawnSync(shim, {
    encoding: "utf8",
    // An empty config dir, so the shim runs THIS tree's dispatcher rather than the installed plugin's.
    env: {
      CLAUDE_CONFIG_DIR: tempDir({ prefix: "sw-folded-config-" }),
      HOME: process.env["HOME"]!,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
    },
    input: JSON.stringify(payload),
    timeout: HOOK_TIMEOUT_MS,
  });
  return { status: run.status, stderr: run.stderr, stdout: run.stdout };
}

function bash({ command }: { command: string }): Record<string, unknown> {
  return { session_id: SESSION, tool_input: { command }, tool_name: "Bash" };
}

describe("every folded check still refuses through the one shim", { timeout: HOOK_TIMEOUT_MS }, () => {
  it("bot-live-write-guard: holds a colleague's bot turn rerunning a production migration", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: SESSION, asker: ENGINEER, home, messageTs: "1791000001.000100" });
    const { status, stderr } = runHook({ home, payload: bash({ command: "yarn prisma migrate deploy" }) });
    expect(status).toBe(2);
    expect(stderr).toContain(`this turn was asked by <@${ENGINEER}>, not the owner`);
  });

  it("admit: refuses a Python interpreter", () => {
    const { status, stderr } = runHook({ payload: bash({ command: "python3 -V" }) });
    expect(status).toBe(2);
    expect(stderr).toContain("blocked because it runs a Python interpreter");
  });

  it("whole-tree-check-guard: refuses a whole-tree typecheck in a Slopweaver checkout", () => {
    // `cwd` rides the payload: without it the runner has no directory to judge a script name in.
    const { status, stderr } = runHook({ payload: { ...bash({ command: "yarn typecheck" }), cwd: "/dev/slopweaver" } });
    expect(status).toBe(2);
    expect(stderr).toContain("yarn typecheck (tsc over the whole project)");
    expect(stderr).toContain("watch CI's `lint`, `typecheck`, `compile`, `unit` and `subprocess` jobs");
  });

  it("whole-tree-check-guard: refuses a whole vitest lane in a Slopweaver checkout", () => {
    const command = "yarn vitest run --config config/vitest/unit.ts";
    const { status, stderr } = runHook({ payload: { ...bash({ command }), cwd: "/dev/slopweaver" } });
    expect(status).toBe(2);
    expect(stderr).toContain("vitest (a whole test lane, no file named)");
  });

  it("run-due-deadline-guard: refuses a run-due under timeout, the chair tick's own spelling", () => {
    const { status, stderr } = runHook({
      payload: { ...bash({ command: "for r in a; do timeout 900 $B recipe run-due --recipe $r; done" }) },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("SLOPWEAVER_ALLOW_RUN_DUE_DEADLINE=1");
    expect(stderr).toContain("`timeout` would kill `$B recipe run-due --recipe $r`");
  });

  it("run-due-deadline-guard: refuses a background run-due with no timeout, the seats' spelling", () => {
    const { status, stderr } = runHook({
      payload: {
        session_id: SESSION,
        tool_input: { command: "slopweaver automation run-due --recipe store-backup-daily", run_in_background: true },
        tool_name: "Bash",
      },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("the Bash tool's background limit of 1800000 ms would kill");
  });

  it("run-due-deadline-guard: allows a background run-due at the tool's maximum timeout", () => {
    const { status } = runHook({
      payload: {
        session_id: SESSION,
        tool_input: {
          command: "slopweaver automation run-due --recipe store-backup-daily",
          run_in_background: true,
          timeout: 7_200_000,
        },
        tool_name: "Bash",
      },
    });
    expect(status).toBe(0);
  });

  it("admit: refuses a raw network tool", () => {
    const { status, stderr } = runHook({ payload: bash({ command: "curl -s https://example.com" }) });
    expect(status).toBe(2);
    expect(stderr).toContain("raw curl bypasses the door for external requests");
  });

  it("admit: refuses the Artifact tool, which is a different matcher on the same check", () => {
    const { status, stderr } = runHook({
      payload: { session_id: SESSION, tool_input: { command: "publish" }, tool_name: "Artifact" },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("blocked because");
  });

  it("cmux-send-supervisor-guard: refuses a send aimed at the pinned supervisor from another session", () => {
    const home = tempDir({ prefix: "sw-folded-home-" });
    writeSupervisorPin({
      home,
      record: {
        session: { host: "claude-code", id: "some-other-session" },
        pinnedAtIso: "2026-09-19T00:00:00.000Z",
        workspaceId: "936",
        workspaceRef: "workspace:936",
      },
    });
    const { status, stderr } = runHook({
      home,
      payload: bash({ command: "slopweaver cmux send --workspace workspace:936 hi" }),
    });
    expect(status).toBe(2);
    expect(stderr).toContain("SendMessage");
  });

  it("agent-tool-ban: refuses the Agent tool in a session that recorded a ban", () => {
    const home = tempDir({ prefix: "sw-folded-home-" });
    writeAgentToolBan({
      claudeSessionId: SESSION,
      home,
      nowIso: "2026-09-19T00:00:00.000Z",
      record: {
        claudeSessionId: SESSION,
        expiresAtIso: "2099-01-01T00:00:00.000Z",
        recordedAtIso: "2026-09-19T00:00:00.000Z",
        why: "the brief says this session spawns nothing",
      },
    });
    const { status, stderr } = runHook({
      home,
      payload: { session_id: SESSION, tool_input: { prompt: "go" }, tool_name: "Agent" },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("the brief says this session spawns nothing");
  });

  it("memory-write-guard: refuses a memory leaf carrying a wikilink nothing can answer", () => {
    const memory = join(tempDir({ prefix: "sw-folded-memory-" }), "memory");
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, "MEMORY.md"), "- [A thing](a-thing.md) — hook\n");
    const { status, stderr } = runHook({
      payload: {
        session_id: SESSION,
        tool_input: { content: LEAF_WITH_BAD_LINK, file_path: join(memory, "a-thing.md") },
        tool_name: "Write",
      },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("a-thing.md");
    expect(stderr).toContain("[[Not A Memory Name]]");
  });

  it("relay-words-guard: refuses rewording a throwaway relay row's words, and passes a status edit on it", () => {
    const made = relayFixture({ offered: undefined });
    dirs.push(made.home);
    const reworded = made.text.split(JSON.stringify(made.ask)).join('"[class: a reply steer]"');
    const refused = runHook({
      home: made.home,
      payload: { session_id: SESSION, tool_input: { content: reworded, file_path: made.path }, tool_name: "Write" },
    });
    const status = runHook({
      home: made.home,
      payload: {
        session_id: SESSION,
        tool_input: { file_path: made.path, new_string: "status: done", old_string: "status: ready" },
        tool_name: "Edit",
      },
    });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("the summary no longer rebuilds to the digest the relay turn stored");
    expect(refused.stderr).toContain("SLOPWEAVER_ALLOW_RELAY_WORDS=1");
    expect([status.status, status.stderr]).toEqual([0, ""]);
  });

  it("call-state-guard: refuses a hand rm of a call file in the home the hook runs under", () => {
    const home = tempDir({ prefix: "sw-folded-home-" });
    const { status, stderr } = runHook({
      home,
      // A real payload carries `cwd`, and `readBashToolCommand` fails open on one that does not.
      payload: { ...bash({ command: `rm ${home}/talk/calls/f1edcbb1-553c-4a21-a21b-a1bb8a62b630.jsonl` }), cwd: home },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("SLOPWEAVER_ALLOW_CALL_STATE_DELETE=1");
    expect(stderr).toContain("slopweaver talk quarantine <id>");
  });
});

describe("the order the ten were registered in still decides which refusal a caller sees", () => {
  it("gives the admit door's refusal, not the poll gate's, for a call both would refuse", () => {
    const home = tempDir({ prefix: "sw-folded-home-" });
    const log = "/private/tmp/claude-501/proj/0000/scratchpad/validate.log";
    // A first read the poll gate records, so the SECOND would be its refusal — with a Python interpreter in
    // front of it, so the admit door reaches the call first and the poll gate never runs.
    expect(runHook({ home, payload: bash({ command: `tail -c 400 ${log}` }) }).status).toBe(0);
    const { status, stderr } = runHook({ home, payload: bash({ command: `python3 -c 'print(1)' < ${log}` }) });
    expect(status).toBe(2);
    expect(stderr).toContain("Python interpreter");
    expect(stderr).not.toContain("poll-gate:");
  });

  it("gives a bot turn the owner's live-write ruling, not the raw-tool refusal and the hatches that one offers", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: SESSION, asker: ENGINEER, home, messageTs: "1791000002.000100" });
    const { status, stderr } = runHook({
      home,
      payload: bash({ command: "kubectl -n production delete pod api-7d9" }),
    });
    expect(status).toBe(2);
    expect(stderr).toContain("held because a bot turn never runs or reruns a migration");
    expect(stderr).not.toContain("SLOPWEAVER_ALLOW_RAW");
  });
});

describe("an allowed call", () => {
  it("exits 0 and prints nothing on stderr", () => {
    const { status, stderr } = runHook({ payload: bash({ command: "yarn format" }) });
    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("session-depth-warning: prints a parseable hook document, or nothing, but never two", () => {
    const { status, stdout } = runHook({ payload: bash({ command: "yarn format" }) });
    expect(status).toBe(0);
    expect(
      stdout
        .trimEnd()
        .split("\n")
        .filter((line) => line.trim() !== "").length,
    ).toBeLessThanOrEqual(1);
  });
});

describe("the ten compatibility shims", () => {
  /**
   * One old script path, which still has to resolve for as long as `main`'s `hooks.json` names it.
   *
   * @param id the check the shim runs, which is also the second half of its file name
   * @returns the shim's absolute path
   */
  function shimFor({ id }: { id: string }): string {
    return join(repoRoot, "scripts", `pretooluse-${id}.sh`);
  }

  it("runs ONE check, not the registry — the poll gate's shim lets a call the admit door refuses through", () => {
    // `curl` is the admit door's own refusal and the poll gate has no opinion about it, so exit 0 here is
    // only possible if `--only poll-gate` really did keep the other nine out. Run through the folded shim
    // the same payload exits 2, which is the case directly above this describe block.
    const { status, stderr } = runHook({
      payload: bash({ command: "curl https://example.com" }),
      shim: shimFor({ id: "poll-gate" }),
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("still refuses through its own check, so the shim is not merely inert", () => {
    const home = tempDir({ prefix: "sw-folded-home-" });
    const shim = shimFor({ id: "poll-gate" });
    const log = "/private/tmp/claude-501/proj/0000/scratchpad/validate.log";
    expect(runHook({ home, payload: bash({ command: `tail -c 400 ${log}` }), shim }).status).toBe(0);
    const second = runHook({ home, payload: bash({ command: `tail -c 400 ${log}` }), shim });
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("poll-gate:");
  });

  it("carries the admit door's refusal through the admit shim", () => {
    const { status, stderr } = runHook({
      payload: bash({ command: "curl https://example.com" }),
      shim: shimFor({ id: "admit" }),
    });
    expect(status).toBe(2);
    expect(stderr).toContain("raw curl bypasses the door");
  });
});
