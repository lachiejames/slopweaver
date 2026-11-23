/**
 * `src/admit/profileHeld.ts` and its runner — a session whose context lacks the owner's profile is held on its next guarded
 * call, and that refusal delivers the profile; with no copy anywhere it is held outright, the reload let through.
 * The runner half reads and writes a real marker and ledger in a temp home, with a plain fake for the cache read.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { firstBootSessionSeen } from "../../../admit/firstBootSession.js";
import { type FirstBootReadError, FirstBootReadErrors } from "../../../admit/profileFirstBoot.js";
import {
  type FirstBootEvidence,
  isProfileReload,
  neverConfigured,
  PROFILE_HELD_ANONYMOUS_LINES,
  PROFILE_HELD_HEADLINE,
  type ProfileHeldDecision,
  profileHeldDecision,
} from "../../../admit/profileHeld.js";
import { runProfileHeld } from "../../../admit/profileHeldRunner.js";
import type { LoadedContext } from "../../../context/cachedContext.js";
import { UNLOADED_HEADLINE } from "../../../context/loadLedger.js";
import {
  type DeliveryContext,
  deliveryContextOf,
  markProfileDelivered,
  profileWasDelivered,
} from "../../../context/profileDelivery.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";

const CACHED: LoadedContext = { lines: ["## About the owner", "- a fact"], origin: "cache", reason: "r" };
const NOTHING: LoadedContext = { lines: ["## About the owner", "unavailable: gone"], origin: "none", reason: "gone" };
/** A machine with no trace of the owner's profile: a first boot. */
const FRESH: FirstBootEvidence = { cacheExists: false, everLoaded: false, ownerWritten: false };
/** A machine the owner's profile was written on: installed, whatever else is missing. */
const INSTALLED: FirstBootEvidence = { cacheExists: false, everLoaded: false, ownerWritten: true };

/** The refusal lines of a decision that holds; throws on a pass, so a wrong kind fails the test loudly. */
function linesOf({ decision }: { decision: ProfileHeldDecision }): readonly string[] {
  if (decision.kind === "pass" || decision.kind === "first-boot") {
    throw new Error(`expected a held call, got ${decision.kind}`);
  }
  return decision.lines;
}

/** An environment selecting a store, the one the cache read fingerprints. */
const INSTALLED_ENV = { SLOPWEAVER_STORE_URL: "postgresql://postgres:x@127.0.0.1:54322/postgres" };

/** Leave `profile set`'s owner-written mark in a home, so it reads as one the owner's profile was written on. */
function markOwnerWritten({ home }: { home: string }): void {
  mkdirSync(join(home, "profile"), { recursive: true });
  writeFileSync(join(home, "profile", "owner-written"), "");
}

/** A thunk that fails the test if it is ever called. */
function never<T>(): () => T {
  return () => {
    throw new Error("read when it must not be");
  };
}

describe("neverConfigured", () => {
  it("is true only when no profile was written, no cache exists and no load was ever held", () => {
    const all = [false, true].flatMap((ownerWritten) =>
      [false, true].flatMap((cacheExists) =>
        [false, true].map((everLoaded) => neverConfigured({ evidence: { cacheExists, everLoaded, ownerWritten } })),
      ),
    );
    expect(all).toEqual([true, false, false, false, false, false, false, false]);
  });
});

describe("isProfileReload", () => {
  it("lets through the by-hand reload on PATH, bare or with --json", () => {
    expect(
      ["slopweaver profile context", "slopweaver profile context --json", "  slopweaver  profile context  "].map(
        (command) => isProfileReload({ command }),
      ),
    ).toEqual([true, true, true]);
  });

  it("lets through no path to a launcher, nothing chained onto it, nothing else, and no non-Bash call", () => {
    expect(
      [
        "/tmp/x/slopweaver profile context",
        "./slopweaver profile context --json",
        "slopweaver profile context && slopweaver slack post",
        "slopweaver profile show",
        "echo slopweaver profile context",
        undefined,
      ].map((command) => isProfileReload({ command })),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("lets through no reload split by a newline, which the shell runs as two commands", () => {
    expect(
      ["slopweaver profile\ncontext", "slopweaver\nprofile context", "slopweaver profile context\n--json"].map(
        (command) => isProfileReload({ command }),
      ),
    ).toEqual([false, false, false]);
  });
});

describe("profileHeldDecision", () => {
  it("passes a session that holds its profile, without reading anything", () => {
    const decision = profileHeldDecision({
      command: undefined,
      delivered: true,
      firstBoot: never(),
      load: never(),
    });
    expect(decision).toEqual({ kind: "pass" });
  });

  it("delivers a cached profile even on a machine that otherwise reads as fresh, never asking about first boot", () => {
    const decision = profileHeldDecision({
      command: "git status",
      delivered: false,
      firstBoot: never(),
      load: () => CACHED,
    });
    expect(decision).toEqual({
      kind: "deliver",
      lines: [
        PROFILE_HELD_HEADLINE,
        "",
        "The owner's profile is below, delivered now. Read it, then make this same call again: it goes through. Nothing else is",
        "needed and the owner is asked for nothing; this is the automatic recovery, and it happened because the session-start",
        "load did not reach this context (a killed hook, usually at a compaction under load).",
        "There is no escape hatch for this one: doing nothing beats acting misaligned for the owner.",
        "",
        "## About the owner",
        "- a fact",
      ],
      loaded: CACHED,
    });
  });

  it("stops outright, the STOP block first, when no copy exists on an installed machine", () => {
    const decision = profileHeldDecision({
      command: undefined,
      delivered: false,
      firstBoot: () => INSTALLED,
      load: () => NOTHING,
    });
    expect(decision.kind).toBe("stop");
    expect(linesOf({ decision })[0]).toBe(UNLOADED_HEADLINE);
  });

  it("runs a first boot's call, and stops on any one trace of configuration or an unreadable read", () => {
    const kinds = [FRESH, INSTALLED, { ...FRESH, cacheExists: true }, { ...FRESH, everLoaded: true }, undefined].map(
      (evidence) =>
        profileHeldDecision({
          command: "supabase start",
          delivered: false,
          firstBoot: () => evidence,
          load: () => NOTHING,
        }).kind,
    );
    expect(kinds).toEqual(["first-boot", "stop", "stop", "stop", "stop"]);
  });

  it("runs every call on a first boot whatever its command, and holds the same calls on an installed machine", () => {
    const commands = [
      "brew install supabase && supabase start",
      'git commit -m "first commit"',
      "printf x | slopweaver secrets set store-url --stdin",
      undefined,
    ];
    const kindsOn = ({ evidence }: { evidence: FirstBootEvidence }): readonly string[] =>
      commands.map(
        (command) =>
          profileHeldDecision({ command, delivered: false, firstBoot: () => evidence, load: () => NOTHING }).kind,
      );
    expect(kindsOn({ evidence: FRESH })).toEqual(["first-boot", "first-boot", "first-boot", "first-boot"]);
    expect(kindsOn({ evidence: INSTALLED })).toEqual(["stop", "stop", "stop", "stop"]);
  });

  it("passes the reload itself even when nothing could be read", () => {
    expect(
      profileHeldDecision({
        command: "slopweaver profile context",
        delivered: false,
        firstBoot: never(),
        load: never(),
      }),
    ).toEqual({ kind: "pass" });
  });
});

describe("deliveryContextOf", () => {
  it("names a main thread by its session, a subagent apart from it, and nothing for a payload with no usable session", () => {
    expect(
      [
        { session_id: "s-1" },
        { agent_id: "a20dee706bb25eb31", session_id: "s-1" },
        { agent_id: "x/y", session_id: "s-1" },
        { agent_id: "", session_id: "s-1" },
        { session_id: " " },
        { session_id: "../up" },
        { session_id: "s".repeat(129) },
        { tool_name: "Bash" },
        "not an object",
      ].map((payload) => deliveryContextOf({ payload })),
    ).toEqual([
      contextOf({ id: "s-1" }),
      contextOf({ id: "s-1-agent-6c58ea0bb6c913a4014d1f54e34a9aeb" }),
      contextOf({ id: "s-1-agent-bd3c9047d6816c3172f52ddb42bf77c7" }),
      contextOf({ id: "s-1" }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("names any agent id, however long, in a fixed-length file name", () => {
    const ids = ["a".repeat(10_000), "b".repeat(10_000)].map(
      (agentId) => deliveryContextOf({ payload: { agent_id: agentId, session_id: "s-1" } })!.id,
    );
    expect([ids[0]!.length, ids[1]!.length, ids[0] === ids[1]]).toEqual([42, 42, false]);
  });

  it("carries the transcript, and expects a boundary only at a compaction's SessionStart", () => {
    expect(
      [
        { hook_event_name: "SessionStart", session_id: "s-1", source: "compact", transcript_path: "/t.jsonl" },
        { hook_event_name: "SessionStart", session_id: "s-1", source: "startup", transcript_path: "/t.jsonl" },
        { hook_event_name: "PreToolUse", session_id: "s-1", transcript_path: null },
      ].map((payload) => deliveryContextOf({ payload })),
    ).toEqual([
      { awaitsBoundary: true, id: "s-1", transcriptPath: "/t.jsonl" },
      { awaitsBoundary: false, id: "s-1", transcriptPath: "/t.jsonl" },
      { awaitsBoundary: false, id: "s-1", transcriptPath: undefined },
    ]);
  });
});

/** The context a payload with no transcript names, for the runner cases below. */
function contextOf({ id }: { id: string }): DeliveryContext {
  return { awaitsBoundary: false, id, transcriptPath: undefined };
}

describe("runProfileHeld", () => {
  let home = "";
  let refusal: string[] = [];
  let queued: (() => void)[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "profile-held-"));
    markOwnerWritten({ home });
    refusal = [];
    queued = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * Run the check over a payload, with the cache read faked to `loaded`, then do what the dispatcher does once the
   * refusal is printed — unless `emitted` is false, standing for a refusal that never left the process.
   */
  async function run({
    payload,
    loaded,
    emitted = true,
  }: {
    payload: unknown;
    loaded: LoadedContext;
    emitted?: boolean;
  }): Promise<number> {
    const code = await runProfileHeld({
      afterEmit: (commit) => queued.push(commit),
      defaultHomes: ok([home]),
      env: INSTALLED_ENV,
      home,
      load: () => loaded,
      nowIso: "2026-10-14T03:00:00.000Z",
      readStdin: () => Promise.resolve(JSON.stringify(payload)),
      writeError: (line) => refusal.push(line),
    });
    const commits = queued;
    queued = [];
    if (emitted) {
      commits.forEach((commit) => commit());
    }
    return code;
  }

  it("holds once, delivers, records the load and marks the session — and the retried call goes through", async () => {
    const payload = { cwd: "/w", session_id: "s-1", tool_input: { command: "ls" }, tool_name: "Bash" };
    const first = await run({ loaded: CACHED, payload });
    const second = await run({ loaded: CACHED, payload });
    expect([first, second]).toEqual([2, 0]);
    expect(refusal).toHaveLength(1);
    expect(refusal[0]!.startsWith(PROFILE_HELD_HEADLINE)).toBe(true);
    expect(unwrap(profileWasDelivered({ context: contextOf({ id: "s-1" }), home }))).toBe(true);
    const row = JSON.parse(readFileSync(join(home, "profile", "loads.jsonl"), "utf8").trim()) as Record<string, string>;
    expect([row["event"], row["origin"], row["sessionId"], row["cwd"]]).toEqual(["PreToolUse", "cache", "s-1", "/w"]);
  });

  it("writes no marker until the refusal is printed, so a refusal lost on the way out holds the retry too", async () => {
    const payload = { session_id: "s-5", tool_name: "Edit" };
    const lost = await run({ emitted: false, loaded: CACHED, payload });
    const markedAfterLoss = existsSync(join(home, "profile", "delivered", "s-5"));
    const retried = await run({ loaded: CACHED, payload });
    const after = await run({ loaded: CACHED, payload });
    expect([lost, markedAfterLoss, retried, after]).toEqual([2, false, 2, 0]);
  });

  it("holds a subagent whose parent holds the profile, and delivers into the subagent's own context", async () => {
    unwrap(markProfileDelivered({ context: contextOf({ id: "s-6" }), home }));
    const subagent = { agent_id: "a20dee706bb25eb31", session_id: "s-6", tool_name: "Edit" };
    const parent = await run({ loaded: CACHED, payload: { session_id: "s-6", tool_name: "Edit" } });
    const first = await run({ loaded: CACHED, payload: subagent });
    const retried = await run({ loaded: CACHED, payload: subagent });
    const other = await run({ loaded: CACHED, payload: { ...subagent, agent_id: "x/y" } });
    expect([parent, first, retried, other]).toEqual([0, 2, 0, 2]);
    expect(existsSync(join(home, "profile", "delivered", "s-6-agent-6c58ea0bb6c913a4014d1f54e34a9aeb"))).toBe(true);
  });

  it("records a delivery whose marker cannot be written as a failed load, and holds the retry", async () => {
    // A FILE where the marker directory belongs: the profile is printed, but nothing can say so.
    mkdirSync(join(home, "profile"), { recursive: true });
    writeFileSync(join(home, "profile", "delivered"), "");
    const payload = { session_id: "s-7", tool_name: "Edit" };
    const first = await run({ loaded: CACHED, payload });
    const retried = await run({ loaded: CACHED, payload });
    const rows = readFileSync(join(home, "profile", "loads.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    expect([first, retried, rows.map((row) => row["origin"])]).toEqual([2, 2, ["none", "none"]]);
    expect(rows[0]!["reason"]).toContain("delivered, but the profile delivery marker");
  });

  it("holds every call and writes no marker when there is no copy, letting only the reload through", async () => {
    const edit = await run({ loaded: NOTHING, payload: { session_id: "s-2", tool_name: "Edit" } });
    const again = await run({ loaded: NOTHING, payload: { session_id: "s-2", tool_name: "Write" } });
    const reload = await run({
      loaded: NOTHING,
      payload: { session_id: "s-2", tool_input: { command: "slopweaver profile context" }, tool_name: "Bash" },
    });
    // The reload's command on any other tool is that tool's call, held like the rest.
    const monitor = await run({
      loaded: NOTHING,
      payload: { session_id: "s-2", tool_input: { command: "slopweaver profile context" }, tool_name: "Monitor" },
    });
    expect([edit, again, reload, monitor]).toEqual([2, 2, 0, 2]);
    expect(existsSync(join(home, "profile", "delivered", "s-2"))).toBe(false);
  });

  it("holds with the STOP block when the cache read throws", async () => {
    const code = await runProfileHeld({
      afterEmit: (commit) => queued.push(commit),
      defaultHomes: ok([home]),
      env: INSTALLED_ENV,
      home,
      load: () => {
        throw new Error("disk on fire");
      },
      nowIso: "2026-10-14T03:00:00.000Z",
      readStdin: () => Promise.resolve(JSON.stringify({ session_id: "s-3", tool_name: "Bash" })),
      writeError: (line) => refusal.push(line),
    });
    expect([code, queued]).toEqual([2, []]);
    expect(refusal[0]).toContain("disk on fire");
  });

  it("passes a session already marked, and refuses a payload naming no session", async () => {
    unwrap(markProfileDelivered({ context: contextOf({ id: "s-4" }), home }));
    const marked = await run({ loaded: CACHED, payload: { session_id: "s-4", tool_name: "Bash" } });
    const anonymous = await run({ loaded: CACHED, payload: { tool_name: "Bash" } });
    expect([marked, anonymous, refusal]).toEqual([0, 2, [`${PROFILE_HELD_ANONYMOUS_LINES.join("\n")}\n`]]);
  });
});

describe("runProfileHeld on a first boot, with the real cache read", () => {
  let home = "";
  let defaultHome = "";
  let refusal: string[] = [];
  let queued: (() => void)[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "profile-first-boot-"));
    defaultHome = mkdtempSync(join(tmpdir(), "profile-default-home-"));
    refusal = [];
    queued = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(defaultHome, { force: true, recursive: true });
  });

  /**
   * One guarded `supabase start` against the real cache-only loader and the real evidence read, the machine's default
   * homes standing as `defaultHome` unless `defaultHomes` replaces them.
   */
  async function run({
    env,
    defaultHomes = ok([defaultHome]),
  }: {
    env: Readonly<Record<string, string | undefined>>;
    defaultHomes?: Result<readonly string[], FirstBootReadError>;
  }): Promise<number> {
    return runProfileHeld({
      afterEmit: (commit) => queued.push(commit),
      defaultHomes,
      env,
      home,
      nowIso: "2026-10-31T10:00:00.000Z",
      readStdin: () =>
        Promise.resolve(
          JSON.stringify({ session_id: "s-fresh", tool_input: { command: "supabase start" }, tool_name: "Bash" }),
        ),
      writeError: (line) => refusal.push(line),
    });
  }

  it("runs the call on an empty home, printing, queueing, delivering and recording nothing", async () => {
    const code = await run({ env: {} });
    expect([
      code,
      refusal,
      queued.length,
      existsSync(join(home, "profile", "delivered")),
      existsSync(join(home, "profile", "loads.jsonl")),
    ]).toEqual([0, [], 0, false, false]);
  });

  it("still runs it after the session-start hook recorded its failed load, as it does on every first boot", async () => {
    mkdirSync(join(home, "profile"), { recursive: true });
    const row = { atIso: "2026-10-31T09:59:00.000Z", cwd: "/w", event: "SessionStart:startup", origin: "none" };
    writeFileSync(
      join(home, "profile", "loads.jsonl"),
      `${JSON.stringify({ ...row, reason: "no database is selected", sessionId: "s-fresh", source: "hook" })}\n`,
    );
    expect([await run({ env: {} }), refusal]).toEqual([0, []]);
  });

  it("runs every onboarding call while only a store is selected, and holds once the owner's profile is written", async () => {
    // Reading the selection as configuration held `store push`, the call the reload needs.
    const byEnv = await run({ env: { SLOPWEAVER_STORE_URL: "postgresql://postgres:x@127.0.0.1:54322/postgres" } });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(join(home, "secrets", "store-url"), "postgresql://postgres:x@127.0.0.1:54322/postgres\n");
    const bySecret = await run({ env: {} });
    markOwnerWritten({ home });
    const written = await run({ env: {} });
    expect([byEnv, bySecret, written]).toEqual([0, 0, 2]);
    expect(refusal.map((text) => text.startsWith(UNLOADED_HEADLINE))).toEqual([true]);
  });

  it("marks a session it lets through on a first boot, and leaves the home a first boot", async () => {
    // The door holds a marked session once a profile exists that it never loaded.
    const status = await run({ env: {} });
    expect([
      status,
      firstBootSessionSeen({ homes: [home], sessionIds: ["s-fresh"] }),
      firstBootSessionSeen({ homes: [defaultHome], sessionIds: ["s-fresh"] }),
    ]).toEqual([0, true, true]);
    expect(await run({ env: {} })).toBe(0);
  });

  it("holds an empty home on a machine whose default home once held the owner's profile", async () => {
    mkdirSync(join(defaultHome, "profile", "delivered"), { recursive: true });
    writeFileSync(join(defaultHome, "profile", "delivered", "s-old"), "profile-delivered v1\n");
    expect(await run({ env: {} })).toBe(2);
  });

  it("reads every default home named, so a trace in the second one holds the empty home too", async () => {
    const second = mkdtempSync(join(tmpdir(), "profile-account-home-"));
    markOwnerWritten({ home: second });
    const code = await run({ defaultHomes: ok([defaultHome, second]), env: {} });
    rmSync(second, { force: true, recursive: true });
    expect(code).toBe(2);
  });

  it("runs a chained Bash or Monitor call on a first boot, since there is no profile its command could bypass", async () => {
    const codes = await Promise.all(
      ["Bash", "Monitor"].map((tool_name) =>
        runProfileHeld({
          afterEmit: (commit) => queued.push(commit),
          defaultHomes: ok([defaultHome]),
          env: {},
          home,
          nowIso: "2026-10-31T10:00:00.000Z",
          readStdin: () =>
            Promise.resolve(
              JSON.stringify({
                session_id: "s-fresh",
                tool_input: { command: "slopweaver secrets set store-url --stdin < /tmp/u && slopweaver store push" },
                tool_name,
              }),
            ),
          writeError: (line) => refusal.push(line),
        }),
      ),
    );
    expect([codes, refusal]).toEqual([[0, 0], []]);
  });

  it("holds when the account's own home cannot be named, since that machine cannot be ruled fresh", async () => {
    const unknown = err(FirstBootReadErrors.accountUnknown({ cause: new Error("no passwd entry") }));
    expect([await run({ defaultHomes: unknown, env: {} }), refusal.length]).toEqual([2, 1]);
  });

  it("holds when a trace cannot be read, rather than reading it as absent", async () => {
    // A dangling link where the profile directory belongs hides every path under it.
    symlinkSync(join(home, "gone"), join(home, "profile"));
    expect(await run({ env: {} })).toBe(2);
  });
});
