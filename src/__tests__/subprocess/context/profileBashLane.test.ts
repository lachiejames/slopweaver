/**
 * The bash recovery lane (`hooks/lib/profile-delivered.sh`) — what a PreToolUse shim does when no node gate can run.
 *
 * Refusing a context with no marker on that path held it forever, because the node hold that
 * delivers the owner's profile is exactly what cannot run; and a bare existence check let a marker a compaction had
 * outdated release the call. So the lane checks a marker is CURRENT, and otherwise delivers the owner's profile from the plain-text
 * copy beside the cache and marks the context behind it. Each case drives the shipped `scripts/hook.sh` over a
 * target that is not there — the persistent failure — or a copy of `scripts/pretooluse.sh` in a tree with no
 * dispatcher, and the marker the lane writes is read back by node's own `profileWasDelivered`, so the two halves
 * cannot drift apart unnoticed.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { decodeProfileLoadRow } from "../../../context/loadLedger.js";
import { deliveryContextOf, profileWasDelivered } from "../../../context/profileDelivery.js";
import { unwrap } from "../../../lib/result.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** A line only the copy on disk carries, so its presence in a refusal proves the profile was delivered. */
const PROFILE_LINE = "The owner prefers plain answers — bash-lane fixture";

const BOUNDARY = `${JSON.stringify({ subtype: "compact_boundary", type: "system" })}\n`;
const USER = `${JSON.stringify({ message: { content: "go", role: "user" }, type: "user" })}\n`;

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-bash-lane-"));
  dirs.push(dir);
  return dir;
}

/** A home carrying the plain-text copy of the owner's profile, and a transcript holding one whole line. */
function homeWithCopy(): { home: string; transcript: string } {
  const home = tempDir();
  mkdirSync(join(home, "profile"), { recursive: true });
  writeFileSync(join(home, "profile", "context.txt"), `# Owner profile\n\n${PROFILE_LINE}\n`);
  const transcript = join(home, "session.jsonl");
  writeFileSync(transcript, USER);
  return { home, transcript };
}

/**
 * A home whose owner profile was written and no copy of it: configured, so the lane holds it rather than reading it as
 * a first boot — whatever the runner's own `~/.slopweaver` holds.
 */
function configuredHome(): string {
  const home = tempDir();
  mkdirSync(join(home, "profile"), { recursive: true });
  writeFileSync(join(home, "profile", "owner-written"), "");
  return home;
}

/** A main-thread Edit payload naming the transcript, as Claude Code writes one. */
function payloadFor({ transcript, agentId }: { transcript: string; agentId?: string }): Record<string, unknown> {
  return {
    session_id: "s-lane",
    transcript_path: transcript,
    ...(agentId === undefined ? {} : { agent_id: agentId }),
    tool_input: { file_path: "/tmp/x" },
    tool_name: "Edit",
  };
}

/**
 * Run the shipped envelope over a target that is not there, on the refusing policy.
 *
 * @param homeVia the variable that names the home: `SLOPWEAVER_HOME` itself, or the plugin option the launcher falls
 *   back to, with a config directory holding no env file so nothing else can name one
 */
function runMissingTarget({
  home,
  payload,
  path = process.env["PATH"]!,
  homeVia = "SLOPWEAVER_HOME",
}: {
  home: string;
  payload: Record<string, unknown>;
  path?: string;
  homeVia?: "SLOPWEAVER_HOME" | "CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME";
}): { status: number | null; stderr: string } {
  const homeEnv =
    homeVia === "SLOPWEAVER_HOME"
      ? { SLOPWEAVER_HOME: home }
      : { CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME: home, XDG_CONFIG_HOME: tempDir() };
  const run = spawnSync(join(repoRoot, "scripts", "hook.sh"), ["30", "pretooluse", "/nope/not-a-hook"], {
    encoding: "utf8",
    env: {
      HOME: process.env["HOME"]!,
      PATH: path,
      ...homeEnv,
      SLOPWEAVER_HOOK_GIVE_UP: "2",
    },
    input: JSON.stringify(payload),
    timeout: 30_000,
  });
  return { status: run.status, stderr: run.stderr };
}

/** Whether node's own reader accepts the marker the lane wrote for this payload. */
function nodeAccepts({ home, payload }: { home: string; payload: Record<string, unknown> }): boolean {
  return unwrap(profileWasDelivered({ context: deliveryContextOf({ payload })!, home }));
}

describe("the bash recovery lane, behind a dispatcher that is not there", () => {
  it("holds a context with no marker, hands it the owner's profile, and lets the retry through with nobody's hand on it", () => {
    const { home, transcript } = homeWithCopy();
    const payload = payloadFor({ transcript });
    const held = runMissingTarget({ home, payload });
    const retried = runMissingTarget({ home, payload });
    const marker = readFileSync(join(home, "profile", "delivered", "s-lane"), "utf8");
    const row = decodeProfileLoadRow({ value: JSON.parse(readFileSync(join(home, "profile", "loads.jsonl"), "utf8")) });

    expect([held.status, retried.status]).toEqual([2, 0]);
    expect(held.stderr).toContain(PROFILE_LINE);
    expect(held.stderr).toContain("make this\nsame call again: it goes through");
    expect(marker).toBe(`profile-delivered v1\n${String(Buffer.byteLength(USER))}\nsettled\n${transcript}\n`);
    expect([row!.origin, row!.event, row!.sessionId]).toEqual(["cache", "PreToolUse", "s-lane"]);
    expect(nodeAccepts({ home, payload })).toBe(true);
  });

  // The launcher's last resort for the home is the plugin option; a lane reading any other home would hold forever
  // against a copy and a marker it can never see.
  it("reads and marks the home the plugin option names when nothing else names one, as the launcher does", () => {
    const { home, transcript } = homeWithCopy();
    const payload = payloadFor({ transcript });
    const held = runMissingTarget({ home, homeVia: "CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME", payload });
    const retried = runMissingTarget({ home, homeVia: "CLAUDE_PLUGIN_OPTION_SLOPWEAVER_HOME", payload });

    expect([held.status, retried.status]).toEqual([2, 0]);
    expect(held.stderr).toContain(PROFILE_LINE);
    expect(nodeAccepts({ home, payload })).toBe(true);
  });

  it("refuses a marker a compaction outdated, and delivers again rather than trusting the file", () => {
    const { home, transcript } = homeWithCopy();
    const payload = payloadFor({ transcript });
    runMissingTarget({ home, payload });
    appendFileSync(transcript, BOUNDARY);
    const afterCompaction = runMissingTarget({ home, payload });
    const retried = runMissingTarget({ home, payload });

    expect([afterCompaction.status, retried.status]).toEqual([2, 0]);
    expect(afterCompaction.stderr).toContain(PROFILE_LINE);
  });

  // A `tail` that fails is the falsifying input: `grep -c` still prints 0, which a check reading only the count would
  // credit as current (reproduced against the shipped library).
  it("never credits a marker whose transcript scan failed", () => {
    const { home, transcript } = homeWithCopy();
    const payload = payloadFor({ transcript });
    runMissingTarget({ home, payload });
    const bin = tempDir();
    writeFileSync(join(bin, "tail"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(bin, "tail"), 0o755);
    const scanFailed = runMissingTarget({ home, path: `${bin}:${process.env["PATH"]!}`, payload });

    expect(scanFailed.status).toBe(2);
    expect(scanFailed.stderr).toContain(PROFILE_LINE);
  });

  it("keys a subagent's marker exactly as node does, so its first call is held and its retry passes", () => {
    const { home, transcript } = homeWithCopy();
    const payload = payloadFor({ agentId: "a20dee706bb25eb31", transcript });
    const held = runMissingTarget({ home, payload });
    const retried = runMissingTarget({ home, payload });

    expect([held.status, retried.status]).toEqual([2, 0]);
    expect(readdirSync(join(home, "profile", "delivered"))).toEqual(["s-lane-agent-6c58ea0bb6c913a4014d1f54e34a9aeb"]);
    expect(nodeAccepts({ home, payload })).toBe(true);
  });

  // Skipping the mark against a partial tail held every retry while the host stayed mid-record.
  // Marked at the last whole line instead, the retry passes, and the record still being written is judged once
  // it lands: a compaction finishing there holds the context again.
  it("marks at the last whole line against a transcript ending part-way through one, and judges that record once whole", () => {
    const { home, transcript } = homeWithCopy();
    appendFileSync(transcript, BOUNDARY.slice(0, 10));
    const payload = payloadFor({ transcript });
    const held = runMissingTarget({ home, payload });
    const marker = readFileSync(join(home, "profile", "delivered", "s-lane"), "utf8");
    const retried = runMissingTarget({ home, payload });
    appendFileSync(transcript, BOUNDARY.slice(10));
    const afterCompaction = runMissingTarget({ home, payload });

    expect([held.status, retried.status, afterCompaction.status]).toEqual([2, 0, 2]);
    expect(held.stderr).toContain(PROFILE_LINE);
    expect(marker).toBe(`profile-delivered v1\n${String(Buffer.byteLength(USER))}\nsettled\n${transcript}\n`);
    expect(afterCompaction.stderr).toContain(PROFILE_LINE);
  });

  // A partial record longer than one 64 KiB window: the walk back has to cross a window holding no newline at all.
  it("finds the last whole line behind a partial record longer than one read window", () => {
    const { home, transcript } = homeWithCopy();
    appendFileSync(transcript, "y".repeat(70_000));
    const payload = payloadFor({ transcript });
    runMissingTarget({ home, payload });
    const marker = readFileSync(join(home, "profile", "delivered", "s-lane"), "utf8");

    expect(marker).toBe(`profile-delivered v1\n${String(Buffer.byteLength(USER))}\nsettled\n${transcript}\n`);
  });

  it("refuses with no copy on disk, and writes no marker", () => {
    const home = configuredHome();
    const transcript = join(home, "session.jsonl");
    writeFileSync(transcript, USER);
    const held = runMissingTarget({ home, payload: payloadFor({ transcript }) });

    expect(held.status).toBe(2);
    expect(held.stderr).toContain("no copy of it is on disk");
    expect(existsSync(join(home, "profile", "delivered", "s-lane"))).toBe(false);
  });

  // A copy the lane cannot read is no copy: delivering it printed a header, failed, and marked nothing, so every retry
  // was held the same way with no way out named. A directory fails the read even for root.
  it("treats a copy it cannot read as no copy, naming the way out, and writes no marker", () => {
    const { home, transcript } = homeWithCopy();
    rmSync(join(home, "profile", "context.txt"));
    mkdirSync(join(home, "profile", "context.txt", "x"), { recursive: true });
    const held = runMissingTarget({ home, payload: payloadFor({ transcript }) });

    expect(held.status).toBe(2);
    expect(held.stderr).toContain("no copy of it is on disk");
    expect(existsSync(join(home, "profile", "delivered", "s-lane"))).toBe(false);
  });

  // The hold's one in-band exit, as node's: the command that writes the missing copy. Exact, so
  // a reload with anything chained to it is held like any other command.
  it("lets exactly the by-hand reload through a hold with no copy, and nothing chained to it", () => {
    const home = configuredHome();
    const transcript = join(home, "session.jsonl");
    writeFileSync(transcript, USER);
    const command = ({ text }: { text: string }): Record<string, unknown> => ({
      ...payloadFor({ transcript }),
      tool_input: { command: text },
      tool_name: "Bash",
    });
    const statuses = [
      "slopweaver profile context",
      "  slopweaver profile context --json ",
      "slopweaver profile context; echo hi",
      "slopweaver profile context\necho hi",
    ].map((text) => runMissingTarget({ home, payload: command({ text }) }).status);

    expect(statuses).toEqual([0, 0, 2, 2]);
  });

  // A directory at the transcript's path fails every read whoever runs the test, where a chmod would not stop root.
  it("spends an unread marker on one call while the transcript stays unreadable, then holds and delivers again", () => {
    const { home, transcript } = homeWithCopy();
    rmSync(transcript);
    mkdirSync(transcript);
    const payload = payloadFor({ transcript });
    const held = runMissingTarget({ home, payload });
    const marker = readFileSync(join(home, "profile", "delivered", "s-lane"), "utf8");
    const retried = runMissingTarget({ home, payload });
    const next = runMissingTarget({ home, payload });

    expect(marker).toBe(`profile-delivered v1\nunread\nsettled\n${transcript}\n`);
    expect([held.status, retried.status, next.status]).toEqual([2, 0, 2]);
    expect(next.stderr).toContain(PROFILE_LINE);
  });
});

describe("the post-kill print, which nothing else bounds", () => {
  /** Run the shipped library's `profile_print_copy` against a home, as `scripts/hook.sh` does after its own kill. */
  function printCopy({ home }: { home: string }): { status: number | null; stdout: string } {
    const run = spawnSync(
      "bash",
      ["-c", 'source "$0"; profile_print_copy', join(repoRoot, "hooks", "lib", "profile-delivered.sh")],
      { encoding: "utf8", env: { HOME: process.env["HOME"]!, SLOPWEAVER_HOME: home }, timeout: 30_000 },
    );
    return { status: run.status, stdout: run.stdout };
  }

  // A NUL is consumed by `read -n` and never stored, so a byte total kept from what was read undercounts it without
  // limit: on bash 3.2 a NUL-filled copy was read to its end, about 75 MiB of reads for a 12 KiB cap.
  // Bounded by the COUNT of reads, a 16 MiB one stops at 1024 reads of 256 bytes and says so; read to its
  // end, it would close with no cut-short line at all.
  it("stops a NUL-filled copy at its read count, cut short, under the pipe buffer", () => {
    const home = tempDir();
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "context.txt"), Buffer.alloc(16 * 1024 * 1024));
    const printed = printCopy({ home });

    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("# CUT SHORT — the rest did not fit before the declared timeout");
    expect(Buffer.byteLength(printed.stdout)).toBeLessThan(16 * 1024);
  });

  it("prints a whole small copy with no cut-short line", () => {
    const { home } = homeWithCopy();
    const printed = printCopy({ home });

    expect(printed.stdout).toContain(`\n${PROFILE_LINE}\n`);
    expect(printed.stdout).not.toContain("# CUT SHORT");
  });
});

describe("the bash recovery lane, in a dispatcher shim with no tree to run", () => {
  /** A copy of the shipped shim in a tree that carries no dispatcher entry, with every hook lib beside it. */
  function entrylessShim(): string {
    const root = tempDir();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "hooks", "lib"), { recursive: true });
    copyFileSync(join(repoRoot, "scripts", "pretooluse.sh"), join(root, "scripts", "pretooluse.sh"));
    chmodSync(join(root, "scripts", "pretooluse.sh"), 0o755);
    for (const lib of readdirSync(join(repoRoot, "hooks", "lib"))) {
      copyFileSync(join(repoRoot, "hooks", "lib", lib), join(root, "hooks", "lib", lib));
    }
    return join(root, "scripts", "pretooluse.sh");
  }

  /** Run the shim once over a payload, against a home. */
  function runShim({ home, payload, shim }: { home: string; payload: Record<string, unknown>; shim: string }): {
    status: number | null;
    stderr: string;
  } {
    const spawned = spawnSync(shim, {
      encoding: "utf8",
      env: {
        CLAUDE_CONFIG_DIR: tempDir(),
        CLAUDE_PLUGIN_ROOT: tempDir(),
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        SLOPWEAVER_HOME: home,
      },
      input: JSON.stringify(payload),
      timeout: 30_000,
    });
    return { status: spawned.status, stderr: spawned.stderr };
  }

  it("lets the by-hand reload through with no copy on disk, and holds the next command", () => {
    const home = configuredHome();
    const transcript = join(home, "session.jsonl");
    writeFileSync(transcript, USER);
    const shim = entrylessShim();
    const bash = ({ command }: { command: string }): Record<string, unknown> => ({
      ...payloadFor({ transcript }),
      tool_input: { command },
      tool_name: "Bash",
    });

    expect(runShim({ home, payload: bash({ command: "slopweaver profile context" }), shim }).status).toBe(0);
    expect(runShim({ home, payload: bash({ command: "echo hi" }), shim }).status).toBe(2);
  });

  it("holds a Bash call from a context with no marker, delivers, and passes the retry", () => {
    const { home, transcript } = homeWithCopy();
    const shim = entrylessShim();
    const payload = { ...payloadFor({ transcript }), tool_input: { command: "echo hi" }, tool_name: "Bash" };
    const held = runShim({ home, payload, shim });
    const retried = runShim({ home, payload, shim });

    expect([held.status, retried.status]).toEqual([2, 0]);
    expect(held.stderr).toContain("no gate can run on this Bash call");
    expect(held.stderr).toContain(PROFILE_LINE);
  });
});

describe("the bash lane's first-boot reader, the twin of node's readFirstBootEvidence", () => {
  /** Run one of the shipped library's functions with arguments, the store variable present only when given. */
  function call({ fn, args = [], storeUrl }: { fn: string; args?: readonly string[]; storeUrl?: string }): {
    status: number | null;
    stdout: string;
  } {
    const run = spawnSync(
      "bash",
      ["-c", 'source "$0"; set -u; "$@"', join(repoRoot, "hooks", "lib", "profile-delivered.sh"), fn, ...args],
      {
        encoding: "utf8",
        env: {
          HOME: process.env["HOME"]!,
          PATH: process.env["PATH"]!,
          ...(storeUrl === undefined ? {} : { SLOPWEAVER_STORE_URL: storeUrl }),
        },
        timeout: 30_000,
      },
    );
    return { status: run.status, stdout: run.stdout };
  }

  /** Whether `profile_first_boot_in` rules these homes never configured: 0 fresh, 1 configured or unknown. */
  function firstBootIn({ homes, storeUrl }: { homes: readonly string[]; storeUrl?: string }): number | null {
    return call({ args: homes, fn: "profile_first_boot_in", ...(storeUrl === undefined ? {} : { storeUrl }) }).status;
  }

  /**
   * Whether `profile_first_boot` rules this machine never configured under these two variables, with the account's
   * own home replaced by a plain fake function naming `account` — the real one is this machine's, configured or not.
   * `home` left out is `$HOME` UNSET, which node reads as the user database's home.
   */
  function firstBootWith({
    slopweaverHome,
    home,
    account,
    cwd = tempDir(),
  }: {
    slopweaverHome: string;
    home?: string;
    account: string;
    cwd?: string;
  }): number | null {
    const run = spawnSync(
      "bash",
      [
        "-c",
        'source "$0"; set -u; profile_account_home() { PROFILE_ACCOUNT_HOME="$FAKE_ACCOUNT"; }; profile_first_boot',
        join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
      ],
      {
        cwd,
        encoding: "utf8",
        env: {
          FAKE_ACCOUNT: account,
          PATH: process.env["PATH"]!,
          SLOPWEAVER_HOME: slopweaverHome,
          ...(home === undefined ? {} : { HOME: home }),
        },
        timeout: 30_000,
      },
    );
    return run.status;
  }

  /** A home with one file written under it. */
  function homeWith({ path, body }: { path: string; body: string }): string {
    const home = tempDir();
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), body);
    return home;
  }

  const noneRow = `${JSON.stringify({
    atIso: "2026-11-01T00:00:00.000Z",
    cwd: "/w",
    event: "SessionStart:startup",
    origin: "none",
    reason: "no database is selected",
    sessionId: "s-1",
    source: "hook",
  })}\n`;

  it("rules empty, missing and empty-delivery homes fresh", () => {
    const empty = tempDir();
    const missing = join(tempDir(), "not", "yet", ".slopweaver");
    const emptyDelivered = tempDir();
    mkdirSync(join(emptyDelivered, "profile", "delivered"), { recursive: true });

    expect(firstBootIn({ homes: [empty, missing, emptyDelivered] })).toBe(0);
  });

  it("rules a home configured on any one trace in any home named", () => {
    const traces = [
      homeWith({ body: "", path: "profile/owner-written" }),
      homeWith({ body: "{}", path: "profile/context.json" }),
      homeWith({ body: "# Owner profile\n", path: "profile/context.txt" }),
      homeWith({ body: "profile-delivered v1\n", path: "profile/delivered/s-old" }),
      // `$(ls -A)` stripped a newline-only marker name to nothing; a dotfile is an entry too.
      homeWith({ body: "profile-delivered v1\n", path: "profile/delivered/\n" }),
      homeWith({ body: "profile-delivered v1\n", path: "profile/delivered/.s-old" }),
      // Any ledger at all, even `none` rows only, which node reads as fresh: a first boot writes none, and a byte match
      // can pass a row node cannot decode.
      homeWith({ body: noneRow, path: "profile/loads.jsonl" }),
      homeWith({ body: "", path: "profile/loads.jsonl" }),
    ];
    const empty = tempDir();

    expect(traces.map((home) => firstBootIn({ homes: [empty, home] }))).toEqual(traces.map(() => 1));
    expect(traces.length).toBe(8);
    expect(firstBootIn({ homes: [] })).toBe(1);
  });

  it("reads a selected store as no trace, by variable or by secret, since onboarding selects one before any profile", () => {
    // Reading the selection as configuration held `store push` behind a reload that needs it.
    const empty = tempDir();
    const selected = homeWith({ body: "postgresql://x\n", path: "secrets/store-url" });

    expect([
      firstBootIn({ homes: [empty], storeUrl: "" }),
      firstBootIn({ homes: [empty], storeUrl: "postgresql://x" }),
      firstBootIn({ homes: [selected] }),
    ]).toEqual([0, 0, 0]);
  });

  it("sees a delivery marker whatever glob options the environment's shell carries", () => {
    // `GLOBIGNORE='*'` hid every marker from a glob, reading a configured home as fresh.
    const configured = homeWith({ body: "profile-delivered v1\n", path: "profile/delivered/s-old" });
    const run = ({ globignore }: { globignore: string }): number | null =>
      spawnSync(
        "bash",
        [
          "-c",
          'source "$0"; set -u; profile_first_boot_in "$1"',
          join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
          configured,
        ],
        { encoding: "utf8", env: { GLOBIGNORE: globignore, PATH: process.env["PATH"]! }, timeout: 30_000 },
      ).status;

    expect([run({ globignore: "" }), run({ globignore: "*" })]).toEqual([1, 1]);
  });

  it("marks the session it admits on a first boot in every home it read, and admits nothing on a configured one", () => {
    // The door holds a session so marked once a profile exists that it never loaded. Also, a call re-pointing its home at a default one missed a mark left in the resolved home alone.
    const account = tempDir();
    const home = tempDir();
    const admit = ({ slopweaverHome }: { slopweaverHome: string }): number | null =>
      spawnSync(
        "bash",
        [
          "-c",
          'source "$0"; set -u; profile_account_home() { PROFILE_ACCOUNT_HOME="$FAKE_ACCOUNT"; }; profile_first_boot_admit "$1"',
          join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
          '{"session_id":"s-9","tool_name":"Bash"}',
        ],
        {
          encoding: "utf8",
          env: { FAKE_ACCOUNT: account, HOME: home, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: slopweaverHome },
          timeout: 30_000,
        },
      ).status;
    const fresh = join(tempDir(), "state");
    const configured = homeWith({ body: "", path: "profile/owner-written" });
    const marked = [fresh, join(home, ".slopweaver"), join(account, ".slopweaver")];

    expect(admit({ slopweaverHome: fresh })).toBe(0);
    expect(marked.map((dir) => existsSync(join(dir, "profile", "first-boot", "s-9")))).toEqual([true, true, true]);
    expect(firstBootIn({ homes: marked })).toBe(0);
    expect(admit({ slopweaverHome: configured })).toBe(1);
    expect(existsSync(join(configured, "profile", "first-boot", "s-9"))).toBe(false);
  });

  it("reads a home named with a newline at itself, never at the name a command substitution would strip it to", () => {
    // `$(…)` stripped trailing newlines, so `configured\n` was checked as a clean `configured`.
    // Refusing every such name instead held a fresh machine node opens.
    const parent = tempDir();
    const clean = join(parent, "configured");
    const configured = `${clean}\n`;
    mkdirSync(clean);
    mkdirSync(join(configured, "profile"), { recursive: true });
    writeFileSync(join(configured, "profile", "owner-written"), "");
    const fresh = tempDir();

    expect([
      firstBootWith({ account: fresh, home: fresh, slopweaverHome: clean }),
      firstBootWith({ account: fresh, home: fresh, slopweaverHome: configured }),
      firstBootWith({ account: fresh, home: `${fresh}\n`, slopweaverHome: clean }),
      firstBootWith({ account: fresh, home: fresh, slopweaverHome: `${parent}/fresh\n` }),
    ]).toEqual([0, 1, 0, 0]);
  });

  it("folds a relative or `..` home exactly as node's resolve does, so either spelling of one home reads the same", () => {
    // A relative home was refused, then a `..` one, each holding a fresh machine.
    const cwd = tempDir();
    mkdirSync(join(cwd, "configured", "profile"), { recursive: true });
    writeFileSync(join(cwd, "configured", "profile", "owner-written"), "");
    const fresh = tempDir();

    expect([
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "state" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "configured" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "../state" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "unused/../state" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "unused/../configured" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: `${cwd}/unused/../configured/` }),
      firstBootWith({ account: fresh, cwd, home: `${cwd}/unused/..`, slopweaverHome: "" }),
    ]).toEqual([0, 1, 0, 0, 1, 1, 0]);
  });

  it("resolves every spelling to the path node's resolve names", () => {
    const cwd = tempDir();
    const spellings = [
      "state",
      "../state",
      "a/./b//c/",
      "a/../../..",
      "/x/../../y",
      "//x///y/.",
      "/",
      `${cwd}/a/../b`,
      "new\nline/../kept\n",
    ];
    const resolved = spellings.map((spelling) => {
      const run = spawnSync(
        "bash",
        [
          "-c",
          'source "$0"; set -u; profile_resolve_path "$1" && printf "%s" "$PROFILE_RESOLVED"',
          join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
          spelling,
        ],
        { cwd, encoding: "utf8", env: { PATH: process.env["PATH"]! }, timeout: 30_000 },
      );
      return run.stdout;
    });

    expect(spellings.length).toBe(9);
    expect(resolved).toEqual(spellings.map((spelling) => resolve(realpathSync(cwd), spelling)));
  });

  it("reads a plain file above a trace as absence, as node's ENOTDIR does, and fails closed on what it cannot read", () => {
    // A stray file where a directory belongs held a fresh machine on both lanes.
    const fileForDir = homeWith({ body: "", path: "profile" });
    const dangling = tempDir();
    symlinkSync(join(dangling, "gone"), join(dangling, "profile"));

    expect([fileForDir, dangling, "relative/home"].map((home) => firstBootIn({ homes: [home] }))).toEqual([0, 1, 1]);
  });

  it("reads a plain file where the delivery directory belongs as no delivery, as node's ENOTDIR does", () => {
    // Bash held a fresh machine on a stray `profile/delivered` file.
    const fileForDelivered = homeWith({ body: "", path: join("profile", "delivered") });
    const linkToFile = homeWith({ body: "", path: join("profile", "stray") });
    symlinkSync(join(linkToFile, "profile", "stray"), join(linkToFile, "profile", "delivered"));
    const dangling = tempDir();
    mkdirSync(join(dangling, "profile"));
    symlinkSync(join(dangling, "gone"), join(dangling, "profile", "delivered"));

    expect([fileForDelivered, linkToFile, dangling].map((home) => firstBootIn({ homes: [home] }))).toEqual([0, 0, 1]);
  });

  it("reads a delivery directory and the account's home with no command on `$PATH`, as node needs none", () => {
    // `find` missing from `$PATH` read an empty delivery directory as configured.
    const empty = tempDir();
    mkdirSync(join(empty, "profile", "delivered"), { recursive: true });
    const marked = homeWith({ body: "profile-delivered v1\n", path: join("profile", "delivered", "s-1") });
    const bare = ({ args }: { args: readonly string[] }): { status: number | null; stdout: string } => {
      const run = spawnSync("/bin/bash", ["-c", 'source "$0"; set -u; "$@"', ...args], {
        encoding: "utf8",
        env: { PATH: "/nonexistent" },
        timeout: 30_000,
      });
      return { status: run.status, stdout: run.stdout };
    };
    const lib = join(repoRoot, "hooks", "lib", "profile-delivered.sh");

    expect([empty, marked].map((home) => bare({ args: [lib, "profile_first_boot_in", home] }).status)).toEqual([0, 1]);
    expect(bare({ args: [lib, "eval", 'profile_account_home && printf "%s" "$PROFILE_ACCOUNT_HOME"'] })).toEqual({
      status: 0,
      stdout: userInfo().homedir,
    });
  });

  it("decides a blank home exactly as node's trim does, over every code point in the Basic Multilingual Plane", () => {
    // `[[:space:]]` missed U+FEFF, so a `$SLOPWEAVER_HOME` node reads as blank named a home here.
    const singles: Buffer[] = [];
    const expected: number[] = [];
    for (let code = 1; code <= 0xffff; code += 1) {
      if (code < 0xd800 || code > 0xdfff) {
        const char = String.fromCodePoint(code);
        singles.push(Buffer.from(char, "utf8"));
        expected.push(char.trim() === "" ? 0 : 1);
      }
    }
    // Whole runs, and one byte string whose removal of U+00A0 would join a U+2000 node never decoded.
    const runs = ["﻿　 \t", " x ", "​", "\u0085"].map((run) => Buffer.from(run, "utf8"));
    const joined = Buffer.from([0xe2, 0x80, 0xc2, 0xa0, 0x80]);
    const file = join(tempDir(), "values");
    writeFileSync(file, Buffer.concat([...singles, ...runs, joined].flatMap((value) => [value, Buffer.from([0])])));
    const run = spawnSync(
      "bash",
      [
        "-c",
        'source "$0"; set -u; while IFS= read -r -d "" v; do if profile_blank "$v"; then printf 0; else printf 1; fi; done <"$1"',
        join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
        file,
      ],
      { encoding: "utf8", env: { PATH: process.env["PATH"]! }, timeout: 120_000 },
    );

    expect(expected.filter((answer) => answer === 0).length).toBe(25);
    expect(run.stdout).toBe([...expected, 0, 1, 1, 1, 1].join(""));
  });

  it("reads a home node trims to blank as no home, a U+FEFF one included", () => {
    // Bash resolved `<cwd>/U+FEFF` where node read the default home.
    const cwd = tempDir();
    for (const name of ["﻿", "﻿x"]) {
      mkdirSync(join(cwd, name, "profile"), { recursive: true });
      writeFileSync(join(cwd, name, "profile", "owner-written"), "");
    }
    const fresh = tempDir();

    expect([
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "﻿" }),
      firstBootWith({ account: fresh, cwd, home: fresh, slopweaverHome: "﻿x" }),
    ]).toEqual([0, 1]);
  });

  it("names the account's own home exactly as node's user-database read does", () => {
    const named = spawnSync(
      "bash",
      [
        "-c",
        'source "$0"; set -u; profile_account_home && printf "%s" "$PROFILE_ACCOUNT_HOME"',
        join(repoRoot, "hooks", "lib", "profile-delivered.sh"),
      ],
      { encoding: "utf8", env: { HOME: tempDir(), PATH: process.env["PATH"]! }, timeout: 30_000 },
    );

    expect([named.status, named.stdout]).toEqual([0, userInfo().homedir]);
  });

  it("reads `$HOME` as node's homedir does: an empty one is the working directory, an unset one the account's", () => {
    // Bash read an empty `$HOME` as `/`, missing the `.slopweaver` node reads under cwd.
    const configuredCwd = tempDir();
    mkdirSync(join(configuredCwd, ".slopweaver", "profile"), { recursive: true });
    writeFileSync(join(configuredCwd, ".slopweaver", "profile", "owner-written"), "");
    const configuredAccount = homeWith({ body: "", path: join(".slopweaver", "profile", "owner-written") });
    const fresh = tempDir();

    expect([
      firstBootWith({ account: fresh, cwd: configuredCwd, home: "", slopweaverHome: "" }),
      firstBootWith({ account: fresh, cwd: fresh, home: "", slopweaverHome: "" }),
      firstBootWith({ account: configuredAccount, cwd: fresh, slopweaverHome: "" }),
      firstBootWith({ account: fresh, cwd: fresh, slopweaverHome: "" }),
    ]).toEqual([1, 0, 1, 0]);
  });

  it("reads an empty or relative account home under the working directory, as node's join does", () => {
    // Refusing a relative user-database home wedged a fresh machine node opens.
    const cwd = tempDir();
    mkdirSync(join(cwd, "configured", ".slopweaver", "profile"), { recursive: true });
    writeFileSync(join(cwd, "configured", ".slopweaver", "profile", "owner-written"), "");
    const configuredCwd = tempDir();
    mkdirSync(join(configuredCwd, ".slopweaver", "profile"), { recursive: true });
    writeFileSync(join(configuredCwd, ".slopweaver", "profile", "owner-written"), "");
    const fresh = tempDir();

    expect([
      firstBootWith({ account: "acct", cwd, home: fresh, slopweaverHome: "" }),
      firstBootWith({ account: "configured", cwd, home: fresh, slopweaverHome: "" }),
      firstBootWith({ account: "", cwd: fresh, home: fresh, slopweaverHome: "" }),
      firstBootWith({ account: "", cwd: configuredCwd, home: fresh, slopweaverHome: "" }),
    ]).toEqual([0, 1, 0, 1]);
  });

  it("reads an account home named with a newline at itself", () => {
    // Refusing a newline in the user database's home wedged a fresh machine.
    const parent = tempDir();
    const freshAccount = join(parent, "fresh\n");
    const configuredAccount = join(parent, "configured\n");
    mkdirSync(freshAccount);
    mkdirSync(join(configuredAccount, ".slopweaver", "profile"), { recursive: true });
    writeFileSync(join(configuredAccount, ".slopweaver", "profile", "owner-written"), "");
    mkdirSync(join(parent, "configured"));
    const fresh = tempDir();

    expect([
      firstBootWith({ account: freshAccount, home: fresh, slopweaverHome: "" }),
      firstBootWith({ account: configuredAccount, home: fresh, slopweaverHome: "" }),
    ]).toEqual([0, 1]);
  });
});
