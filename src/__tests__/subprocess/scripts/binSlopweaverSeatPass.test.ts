/**
 * `bin/slopweaver claude seat --from-payload` answers a seat holding a live cached pass in bash, and hands every
 * other payload to the full check unchanged.
 *
 * Two halves. The predicate (`hooks/lib/seat-pass.sh`) is driven through its argv against a throwaway
 * `$SLOPWEAVER_HOME` and `CLAUDE_CONFIG_DIR`, with THIS test process's pid as the live seat, so each miss is one
 * named input changed from a hit. The launcher's wiring is proven end to end through a fake tsx that prints what
 * the full check would have read on stdin: a hit reaches no CLI at all, and a miss reaches it with the payload
 * intact. Why the cache exists, and the measurement behind it, is that shell file's header.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedProfileDelivered } from "../../profileDeliveredFixture.js";
import { launcherNodeEnv, writeLauncherManifest } from "../launcherNode.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER = join(repoRoot, "bin", "slopweaver");
const HELPER = join(repoRoot, "hooks", "lib", "seat-pass.sh");

const SESSION = "71e77a67-7fb6-4cd8-8b77-df5a0b3cf615";
const PROC_START = "Tue Oct  6 04:17:25 2026";
const PAYLOAD = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "x", session_id: SESSION });

/** Prints a marker line, then exactly what the full check would have read on stdin. */
const FAKE_TSX = ["#!/bin/sh", "printf 'full check:'", "cat", ""].join("\n");

/** Seconds since the epoch the inputs are stamped at; the marker is stamped later unless a case says otherwise. */
const INPUTS_AT = 1_800_000_000;

let scratch: string;
let home: string;
let claudeHome: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "slop-seat-pass-")));
  home = join(scratch, "home");
  claudeHome = join(scratch, "claude");
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  mkdirSync(join(home, "live", "seat-pass"), { recursive: true });
  mkdirSync(join(claudeHome, "sessions"), { recursive: true });
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/**
 * Lay down a hit: the plan register and settings, then a marker newer than both naming a live pid whose registry
 * record carries the same session and start. Each override changes one input.
 *
 * @param markerPid the pid the marker names
 * @param markerStart the process start the marker names
 * @param registry what the registry record for `markerPid` says, or null for no record
 * @param markerAt the marker's mtime, in epoch seconds
 * @param usageFields the marker's fields after the process start: `-` for a plan with no usage limit, or a limited
 *   plan's alias and expiry
 * @param trailer bytes appended after the marker's one line, which the real writer never adds
 * @param pidField how the marker and the registry filename spell the pid, when not the writer's canonical digits
 */
function seat({
  markerPid = process.pid,
  registry = { pid: process.pid, procStart: PROC_START, sessionId: SESSION },
  markerAt = INPUTS_AT + 60,
  usageFields = ["-"],
  trailer = "",
  pidField = String(markerPid),
}: {
  markerPid?: number;
  registry?: { pid: number; procStart: string; sessionId: string } | null;
  markerAt?: number;
  usageFields?: readonly string[];
  trailer?: string;
  pidField?: string;
} = {}): void {
  const accounts = join(home, "claude-accounts", "accounts.json");
  const settings = join(claudeHome, "settings.json");
  writeFileSync(accounts, "[]\n");
  writeFileSync(settings, "{}\n");
  utimesSync(accounts, INPUTS_AT, INPUTS_AT);
  utimesSync(settings, INPUTS_AT, INPUTS_AT);
  if (registry !== null) {
    writeFileSync(join(claudeHome, "sessions", `${pidField}.json`), JSON.stringify(registry));
  }
  const marker = join(home, "live", "seat-pass", SESSION);
  writeFileSync(marker, `${[pidField, PROC_START, ...usageFields].join("\t")}\n${trailer}`);
  utimesSync(marker, markerAt, markerAt);
}

/**
 * Lay down plan-one's usage snapshot, stamped with the other inputs unless a case says otherwise.
 *
 * @param at the snapshot's mtime, in epoch seconds
 */
function snapshot({ at = INPUTS_AT }: { at?: number } = {}): void {
  const dir = join(home, "live", "claude-usage");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plan-one.json");
  writeFileSync(path, "{}\n");
  utimesSync(path, at, at);
}

/**
 * A limited plan's three marker fields around the real clock `/bin/date` reads — the reader's only clock.
 *
 * @param from seconds from now the reading was taken; negative is in the past
 * @param until seconds from now the pass expires
 * @returns the alias, the judged second and the expiry, as the writer would emit them
 */
function limitedFields({ from = -60, until = 3600 }: { from?: number; until?: number } = {}): readonly string[] {
  const now = Math.floor(Date.now() / 1000);
  return ["plan-one", String(now + from), String(now + until)];
}

/** The environment both halves run under: a throwaway home, Claude config dir and HOME. */
function seatEnv(): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    CLAUDE_CONFIG_DIR: claudeHome,
    HOME: scratch,
    PATH: process.env["PATH"]!,
    SLOPWEAVER_HOME: home,
  };
}

/**
 * Call the predicate under bash `set -euo pipefail`, the launcher's own mode.
 *
 * @param payload the hook payload it reads the session id out of
 * @param env overrides on top of {@link seatEnv}
 * @returns the predicate's exit status: 0 a cached pass, 1 a miss
 */
function cached({ payload = PAYLOAD, env = {} }: { payload?: string; env?: Record<string, string> } = {}): number {
  const result = spawnSync(
    "/bin/bash",
    ["-c", 'set -euo pipefail; source "$1"; seat_pass_cached "$2"', "_", HELPER, payload],
    { encoding: "utf8", env: { ...seatEnv(), ...env } },
  );
  return result.status!;
}

/** A pid that existed and has been reaped, so `kill -0` finds nothing. */
function deadPid(): number {
  return spawnSync("/usr/bin/true").pid;
}

describe("seat_pass_cached", () => {
  it("passes a live seat whose marker is newer than both inputs and matches its registry record", () => {
    seat();
    expect(cached()).toBe(0);
  });

  it("misses with no marker", () => {
    seat();
    rmSync(join(home, "live", "seat-pass", SESSION));
    expect(cached()).toBe(1);
  });

  it("misses on pid 0, which the writer never emits and `kill -0` would read as the caller's own group", () => {
    seat({ markerPid: 0, registry: { pid: 0, procStart: PROC_START, sessionId: SESSION } });
    expect(cached()).toBe(1);
  });

  it.each(['x","foo":"bar', "x\\u0022y", "bad\rstart"])(
    "misses on the process start %j, a character the writer refuses, quote and backslash because the match would reach past",
    (procStart) => {
      seat({ registry: null });
      // Raw, unescaped, so the registry's text holds the marker's start verbatim — the substring match the fix stops.
      const registry = `{"sessionId":"${SESSION}","procStart":"${procStart}"}`;
      writeFileSync(join(claudeHome, "sessions", `${String(process.pid)}.json`), registry);
      const marker = join(home, "live", "seat-pass", SESSION);
      writeFileSync(marker, `${String(process.pid)}\t${procStart}\t-\n`);
      utimesSync(marker, INPUTS_AT + 60, INPUTS_AT + 60);
      expect(cached()).toBe(1);
    },
  );

  it.each([
    ["a raw 0xFF byte, which the writer's UTF-8 encoding never emits", Buffer.from([0x78, 0xff, 0x79])],
    ["a non-ASCII character", Buffer.from("xéy", "utf8")],
    ["a bracket", Buffer.from("x[1]y", "utf8")],
  ])("misses on a process start carrying %s, under the C locale too", (_label, procStart) => {
    seat({ registry: null });
    const pid = Buffer.from(String(process.pid));
    const registry = Buffer.concat([
      Buffer.from(`{"sessionId":"${SESSION}","procStart":"`),
      procStart,
      Buffer.from('"}'),
    ]);
    writeFileSync(join(claudeHome, "sessions", `${String(process.pid)}.json`), registry);
    const marker = join(home, "live", "seat-pass", SESSION);
    writeFileSync(marker, Buffer.concat([pid, Buffer.from("\t"), procStart, Buffer.from("\t-\n")]));
    utimesSync(marker, INPUTS_AT + 60, INPUTS_AT + 60);
    expect(cached({ env: { LC_ALL: "C" } })).toBe(1);
    expect(cached({ env: { LC_ALL: "en_US.UTF-8" } })).toBe(1);
  });

  it("passes the writer's own process start under the C locale, so the byte list is not locale-bound", () => {
    seat();
    expect(cached({ env: { LC_ALL: "C" } })).toBe(0);
  });

  it("misses on a live pid spelled with leading zeros, a spelling `String(pid)` never writes", () => {
    seat({ pidField: `000${String(process.pid)}` });
    expect(cached()).toBe(1);
  });

  it("misses when the marker's pid is dead", () => {
    const pid = deadPid();
    seat({ markerPid: pid, registry: { pid, procStart: PROC_START, sessionId: SESSION } });
    expect(cached()).toBe(1);
  });

  it("misses when the registry's process start differs, as a reused pid's would", () => {
    seat({ registry: { pid: process.pid, procStart: "Wed Oct  7 09:00:00 2026", sessionId: SESSION } });
    expect(cached()).toBe(1);
  });

  it("misses when the registry names another session for that pid", () => {
    seat({ registry: { pid: process.pid, procStart: PROC_START, sessionId: "another-session" } });
    expect(cached()).toBe(1);
  });

  it("misses when the pid has no registry record", () => {
    seat({ registry: null });
    expect(cached()).toBe(1);
  });

  it("misses when the plan register is newer than the marker", () => {
    seat();
    const accounts = join(home, "claude-accounts", "accounts.json");
    utimesSync(accounts, INPUTS_AT + 120, INPUTS_AT + 120);
    expect(cached()).toBe(1);
  });

  it("misses when Claude's settings are newer than the marker, since an apiKeyHelper there meters the seat", () => {
    seat();
    const settings = join(claudeHome, "settings.json");
    utimesSync(settings, INPUTS_AT + 120, INPUTS_AT + 120);
    expect(cached()).toBe(1);
  });

  it("misses on a tie, because a write in the marker's own second may have followed it", () => {
    seat({ markerAt: INPUTS_AT });
    expect(cached()).toBe(1);
  });

  it.each(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])(
    "misses when %s has arrived in the hook's environment, since an API key outranks every store",
    (variable) => {
      seat();
      expect(cached({ env: { [variable]: "not-a-real-key" } })).toBe(1);
    },
  );

  it("still passes when an API-key variable holds only whitespace, which the CLI reads as absent", () => {
    seat();
    expect(cached({ env: { ANTHROPIC_API_KEY: "  " } })).toBe(0);
  });

  it("misses on a session id that is not one safe path segment", () => {
    seat();
    expect(cached({ payload: JSON.stringify({ session_id: `../seat-pass/${SESSION}` }) })).toBe(1);
  });

  it("misses on a payload naming no session", () => {
    seat();
    expect(cached({ payload: "{}" })).toBe(1);
  });

  it("misses when SLOPWEAVER_HOME is relative, which the CLI would resolve against a cwd this cannot know", () => {
    seat();
    expect(cached({ env: { SLOPWEAVER_HOME: "relative/home" } })).toBe(1);
  });

  it("misses when CLAUDE_CONFIG_DIR carries whitespace the CLI would trim", () => {
    seat();
    expect(cached({ env: { CLAUDE_CONFIG_DIR: `${claudeHome} ` } })).toBe(1);
  });
});

describe("seat_pass_cached on a plan with a usage limit", () => {
  it("passes a limited marker inside its window while the plan's snapshot is older than it", () => {
    snapshot();
    seat({ usageFields: limitedFields() });
    expect(cached()).toBe(0);
  });

  it.each(["C", "en_US.US-ASCII", "en_US.UTF-8"])(
    "misses an uppercase alias the writer never emits under the %s locale, whose ranges can fold case",
    (locale) => {
      snapshot();
      const [, from, until] = limitedFields();
      seat({ usageFields: ["Plan-one", from!, until!] });
      expect(cached({ env: { LC_ALL: locale } })).toBe(1);
    },
  );

  it("misses once the marker's expiry has passed", () => {
    snapshot();
    seat({ usageFields: limitedFields({ from: -7200, until: -1 }) });
    expect(cached()).toBe(1);
  });

  it("misses when the clock reads before the reading was taken, as a wall clock stepped back would", () => {
    snapshot();
    seat({ usageFields: limitedFields({ from: 600, until: 3600 }) });
    expect(cached()).toBe(1);
  });

  it("misses when a newer usage reading has landed since the pass", () => {
    snapshot({ at: INPUTS_AT + 120 });
    seat({ usageFields: limitedFields() });
    expect(cached()).toBe(1);
  });

  it("misses on a tie with the snapshot, the safe side exactly as with the register", () => {
    snapshot({ at: INPUTS_AT + 60 });
    seat({ usageFields: limitedFields() });
    expect(cached()).toBe(1);
  });

  it("passes an expiry at exactly the writer's safe-integer bound", () => {
    snapshot();
    seat({ usageFields: ["plan-one", limitedFields()[1]!, "9007199254740991"] });
    expect(cached()).toBe(0);
  });

  it("misses when the plan's snapshot cannot be read, which a chmod makes so without moving its mtime", () => {
    snapshot();
    chmodSync(join(home, "live", "claude-usage", "plan-one.json"), 0o000);
    seat({ usageFields: limitedFields() });
    expect(cached()).toBe(1);
  });

  it("misses when the plan has no snapshot at all", () => {
    seat({ usageFields: limitedFields() });
    expect(cached()).toBe(1);
  });

  it("misses on a two-field marker, written before the usage gate, which never said whether its plan was limited", () => {
    snapshot();
    seat({ usageFields: [] });
    expect(cached()).toBe(1);
  });

  it.each<[string, readonly string[]]>([
    ["two present but empty fields", ["", ""]],
    ["a no-limit marker with a trailing empty field", ["-", ""]],
    ["a no-limit marker that also carries a window", ["-", ...limitedFields().slice(1)]],
    ["an alias with no window", ["plan-one"]],
    ["an alias with only an expiry, the shape before the window", ["plan-one", "9999999999"]],
    ["a limited marker with a trailing empty field", [...limitedFields(), ""]],
    ["a limited marker with a sixth field", [...limitedFields(), "9999999999"]],
    ["an alias that leaves the directory", ["../plan-one", ...limitedFields().slice(1)]],
    ["an upper-case alias", ["Plan-One", ...limitedFields().slice(1)]],
    ["a `-` alias carrying a window", ["-", "1", "9999999999"]],
    ["a judged second that is not digits", ["plan-one", "earlier", "9999999999"]],
    ["a judged second of zero, which the writer refuses", ["plan-one", "0", "9999999999"]],
    ["a judged second with a leading zero", ["plan-one", "01", "9999999999"]],
    ["an expiry with a leading zero", ["plan-one", "1", "09999999999"]],
    ["an expiry that is not digits", ["plan-one", "1", "soon"]],
    ["an expiry one past the writer's safe-integer bound", ["plan-one", limitedFields()[1]!, "9007199254740992"]],
    ["an expiry wider than bash's 64-bit test", ["plan-one", limitedFields()[1]!, "99999999999999999999"]],
  ])("misses on %s", (_label, usageFields) => {
    snapshot();
    seat({ usageFields });
    expect(cached()).toBe(1);
  });

  it.each([
    ["a terminated second line", "JUNK\n"],
    ["an unterminated second line", "JUNK"],
    ["a blank second line", "\n"],
    ["a lone NUL byte, which bash's read drops", "\0"],
    ["a NUL then a newline", "\0\n"],
  ])("misses on a well-formed marker followed by %s, which the writer never writes", (_label, trailer) => {
    seat({ trailer });
    expect(cached()).toBe(1);
  });

  it("misses on a NUL byte inside the line, which bash's read would otherwise fold away", () => {
    seat({ usageFields: ["-\0"] });
    expect(cached()).toBe(1);
  });

  it("misses on a marker whose one line has no newline, which the writer always ends it with", () => {
    seat();
    const marker = join(home, "live", "seat-pass", SESSION);
    writeFileSync(marker, `${process.pid}\t${PROC_START}\t-`);
    utimesSync(marker, INPUTS_AT + 60, INPUTS_AT + 60);
    expect(cached()).toBe(1);
  });
});

describe("bin/slopweaver claude seat --from-payload", () => {
  /**
   * Run the real launcher against a fake CLI tree, with the payload on stdin.
   *
   * @param payload what the harness writes to the hook's stdin
   * @param extra environment layered last, over the pinned Node
   * @returns the launcher's exit status and stdout
   */
  function launch({
    payload = PAYLOAD,
    extra = {},
  }: { payload?: string; extra?: Readonly<Record<string, string>> } = {}): {
    readonly code: number;
    readonly out: string;
  } {
    const cli = join(scratch, "cli");
    mkdirSync(join(cli, "node_modules", ".bin"), { recursive: true });
    const tsx = join(cli, "node_modules", ".bin", "tsx");
    writeFileSync(tsx, FAKE_TSX);
    chmodSync(tsx, 0o755);
    writeLauncherManifest({ dir: cli });
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...launcherNodeEnv(),
      ...seatEnv(),
      SLOPWEAVER_CLI_DIR: cli,
      SLOPWEAVER_LAUNCHER_QUIET: "1",
      ...extra,
    };
    const out = execFileSync(LAUNCHER, ["claude", "seat", "--from-payload"], {
      cwd: scratch,
      encoding: "utf8",
      env,
      input: payload,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, out };
  }

  it("answers a cached pass itself when the owner's profile is delivered: exit 0, nothing on stdout, no CLI started", () => {
    seat();
    seedProfileDelivered({ home, sessionId: SESSION });
    expect(launch()).toStrictEqual({ code: 0, out: "" });
  });

  it("answers a cached pass before Node resolution, so a pin that would refuse never reaches it", () => {
    // The fast path is the one place the launcher starts no Node. A pin naming nothing refuses as [no-node] the
    // moment resolution runs, so exit 0 here proves the cached answer came first.
    seat();
    seedProfileDelivered({ home, sessionId: SESSION });
    expect(launch({ extra: { SLOPWEAVER_NODE: join(scratch, "absent", "node") } })).toStrictEqual({ code: 0, out: "" });
  });

  it("does not take the fast path on a cached pass whose session holds no profile: the full check runs", () => {
    // The only input changed from the hit above is the missing delivery marker. The full check is what carries
    // the profile into the session's prompt, so a hit here would leave it running without one.
    seat();
    expect(launch()).toStrictEqual({ code: 0, out: `full check:${PAYLOAD}\n` });
  });

  it("hands a miss to the full check with the payload intact on stdin", () => {
    seat({ registry: null });
    expect(launch()).toStrictEqual({ code: 0, out: `full check:${PAYLOAD}\n` });
  });
});
