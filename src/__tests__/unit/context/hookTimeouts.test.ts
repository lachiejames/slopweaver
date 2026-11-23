/**
 * Every hook the plugin registers carries an explicit timeout, and `PreToolUse` runs ONE process per call.
 *
 * MEASURED once: with no `timeout` on any PreToolUse entry the harness default
 * is 600 seconds, all ten entries run in parallel, and each is a tsx boot. Twenty seats issuing tool calls
 * produced two hundred concurrent TypeScript compiles; the chair sat 27 minutes on hook 6 of 7 and seven
 * seats sat 50 minutes to 2h19m on the same line at a 1-minute load of 15. A hook that cannot finish in its
 * timeout is a starved boot, not a verdict, and the harness kills it. Repro:
 * `jq '.hooks | to_entries[] | {(.key): [.value[].hooks[].timeout]}' hooks/hooks.json`.
 *
 * PreToolUse's timeout is 30 rather than the 20 every other tool hook keeps, and that is runway, not
 * budget. MEASURED once: a harness timeout RUNS the tool call, and at 20 a load episode
 * handed it ~22 `PreToolUse:Bash` calls (`hook_cancelled`, 20004–20823 ms) before the inner verdict (then 15+2)
 * or the envelope (then 18/19) could refuse them. The inner budget is still 15; the extra ten seconds only give
 * our own fail-closed ending room to land before the harness's fail-open one. Repro:
 * `grep -rh '"hook_cancelled"' ~/.claude/projects/ | grep PreToolUse`.
 *
 * The timeout is only half of it, and the half that does NOT reduce the work. Ten entries folded into one
 * process (`src/admit/preToolUseChecks.ts`), so this file also holds the fold down: two registrations that
 * could BOTH select a call, a matcher that drifts from the registry's own union, or a guard quietly dropped
 * out of the registry are each a way back to the incident, and none of them is visible in a diff that only
 * reads `hooks.json`. The two registrations exist only so the envelope can end a door-gated call closed
 * and a tripwire-only one open — they are disjoint, so a call still starts exactly one dispatcher.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hookMatcherSelects } from "../../../admit/hookMatcher.js";
import {
  PRE_TOOL_USE_DOOR_GATED_MATCHER,
  PRE_TOOL_USE_MATCHER,
  PRE_TOOL_USE_READ_MATCHER,
  PRE_TOOL_USE_TRIPWIRE_MATCHER,
  preToolUseChecks,
} from "../../../admit/preToolUseChecks.js";
import { HOOK_MANIFESTS } from "../../../canon/hookManifests.js";
import { PRE_FOLD_PRETOOLUSE_COMMANDS } from "../../liveHookCommands.js";

/** The longest a single TOOL-CALL hook may hold a tool call, in seconds. */
const TOOL_HOOK_TIMEOUT_CEILING_SECONDS = 20;

/**
 * PreToolUse's own ceiling: the inner 15-second verdict, its two-second escalation, and the runway the
 * header measures before the harness's fail-open ending. Still seconds, never minutes.
 */
const PRE_TOOL_USE_TIMEOUT_CEILING_SECONDS = 30;

/**
 * The longest any other hook may run. `SessionStart` legitimately installs dependencies, which is minutes on
 * a cold plugin data dir — it blocks a session's own boot rather than every tool call in it, so the ceiling
 * is looser. What it is not is ABSENT: the harness default of 600 seconds applied to all three of these too.
 */
const LIFECYCLE_HOOK_TIMEOUT_CEILING_SECONDS = 300;

/** The tool-call events, whose entries are the ones a running session pays on every single call. */
const TOOL_EVENTS = ["PreToolUse", "PostToolUse"];

interface HookEntry {
  readonly command: string;
  readonly timeout?: number;
}

interface HookMatcher {
  readonly matcher?: string;
  readonly hooks: readonly HookEntry[];
}

/** Every event's matcher groups across every shipped manifest — the Codex-only one's timeouts count too. */
function manifest(): Record<string, readonly HookMatcher[]> {
  const merged: Record<string, HookMatcher[]> = {};
  for (const path of HOOK_MANIFESTS) {
    const parsed = JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as {
      hooks: Record<string, readonly HookMatcher[]>;
    };
    for (const [event, groups] of Object.entries(parsed.hooks)) {
      const earlier = merged[event];
      merged[event] = earlier === undefined ? [...groups] : [...earlier, ...groups];
    }
  }
  return merged;
}

function entriesOf({ events }: { events: readonly string[] }): readonly { event: string; entry: HookEntry }[] {
  return events.flatMap((event) =>
    manifest()[event]!.flatMap((matcher) => matcher.hooks.map((entry) => ({ entry, event }))),
  );
}

/** Every event the manifest registers, so a NEW event cannot be added without a timeout. */
function allEvents(): readonly string[] {
  return Object.keys(manifest());
}

function lifecycleEvents(): readonly string[] {
  return allEvents().filter((event) => !TOOL_EVENTS.includes(event));
}

/**
 * Every `scripts/pretooluse-*.sh` that delegates to the folded dispatcher, by the check it names.
 *
 * Selected by CARRYING `--only`, not by filename: `pretooluse-supervisor-depth-guard.sh` has sat in
 * `scripts/` unregistered by any `hooks.json` entry since before the fold, and it is not a compatibility
 * shim. A real shim that LOST its `--only` is not quietly excused by that — it stops covering its check, and
 * the case below is what reddens.
 */
function compatibilityShims(): readonly { file: string; id: string }[] {
  return readdirSync(join(process.cwd(), "scripts"))
    .filter((file) => file.startsWith("pretooluse-") && file.endsWith(".sh"))
    .map((file) => ({
      file,
      id: /--only ([a-z0-9-]+)/u.exec(readFileSync(join(process.cwd(), "scripts", file), "utf8"))?.[1],
    }))
    .filter((row): row is { file: string; id: string } => row.id !== undefined);
}

describe("hook timeouts", () => {
  it("registers tool-call hooks at all, so the guards below are over a real list", () => {
    expect(entriesOf({ events: TOOL_EVENTS }).length).toBeGreaterThan(0);
  });

  it("registers lifecycle hooks at all, so the guard below is over a real list", () => {
    expect(entriesOf({ events: lifecycleEvents() }).length).toBeGreaterThan(0);
  });

  it("gives every PostToolUse entry an explicit timeout at or under the tool ceiling", () => {
    const over = entriesOf({ events: ["PostToolUse"] }).filter(
      ({ entry }) => typeof entry.timeout !== "number" || entry.timeout > TOOL_HOOK_TIMEOUT_CEILING_SECONDS,
    );
    expect(over.map(({ event, entry }) => `${event}: ${entry.command}`)).toEqual([]);
  });

  it("gives every PreToolUse entry an explicit timeout at or under its own ceiling", () => {
    const over = entriesOf({ events: ["PreToolUse"] }).filter(
      ({ entry }) => typeof entry.timeout !== "number" || entry.timeout > PRE_TOOL_USE_TIMEOUT_CEILING_SECONDS,
    );
    expect(over.map(({ event, entry }) => `${event}: ${entry.command}`)).toEqual([]);
  });

  it("gives every OTHER event's entry an explicit timeout too, at or under the lifecycle ceiling", () => {
    const over = entriesOf({ events: lifecycleEvents() }).filter(
      ({ entry }) => typeof entry.timeout !== "number" || entry.timeout > LIFECYCLE_HOOK_TIMEOUT_CEILING_SECONDS,
    );
    expect(over.map(({ event, entry }) => `${event}: ${entry.command}`)).toEqual([]);
  });

  it("keeps the tool ceilings themselves short enough that a starved boot cannot hold a call for minutes", () => {
    expect(TOOL_HOOK_TIMEOUT_CEILING_SECONDS).toBeLessThanOrEqual(20);
    expect(PRE_TOOL_USE_TIMEOUT_CEILING_SECONDS).toBeLessThanOrEqual(30);
  });
});

/** Every tool name a folded check applies to, spelled as the harness passes it. */
const COVERED_TOOLS = [
  "Bash",
  "Monitor",
  "Artifact",
  "TaskOutput",
  "Edit",
  "Write",
  "Agent",
  "Task",
  "mcp__claude-in-chrome__navigate",
  "Read",
  "Grep",
  "Glob",
  "NotebookEdit",
];

/** The tools only the protected-path guard's read-side row covers. */
const READ_SIDE_TOOLS = ["Read", "Grep", "Glob", "NotebookEdit"];

describe("PreToolUse is three disjoint rows running one process per call", () => {
  it("registers exactly three matcher groups, each one command: two the dispatcher, one the read-side shim", () => {
    const registered = manifest()["PreToolUse"]!;
    expect(registered.length).toBe(3);
    expect(registered.map((group) => group.hooks.length)).toEqual([1, 1, 1]);
    expect(registered.map((group) => /scripts\/(pretooluse[a-z-]*\.sh)/u.exec(group.hooks[0]!.command)![1])).toEqual([
      "pretooluse.sh",
      "pretooluse.sh",
      "pretooluse-protected-paths.sh",
    ]);
  });

  it("carries the registry's own door-gated, tripwire and read-side matchers, so none can drift", () => {
    expect(manifest()["PreToolUse"]!.map((group) => group.matcher)).toEqual([
      PRE_TOOL_USE_DOOR_GATED_MATCHER,
      PRE_TOOL_USE_TRIPWIRE_MATCHER,
      PRE_TOOL_USE_READ_MATCHER,
    ]);
  });

  it("runs ONLY the protected-path guard on a read-side tool, so no other check ever judges a read", () => {
    expect(READ_SIDE_TOOLS.length).toBeGreaterThan(0);
    const judging = preToolUseChecks({ env: {} })
      .filter((check) => READ_SIDE_TOOLS.some((toolName) => check.appliesTo({ toolName })))
      .map((check) => check.id);
    expect(judging).toEqual(["protected-path-guard"]);
    expect(readFileSync(join(process.cwd(), "scripts", "pretooluse-protected-paths.sh"), "utf8")).toContain(
      'pretooluse.sh" --only protected-path-guard',
    );
  });

  it("hands every covered tool to EXACTLY one row, so no call starts two dispatchers", () => {
    const matchers = manifest()["PreToolUse"]!.map((group) => group.matcher!);
    expect(COVERED_TOOLS.length).toBeGreaterThan(0);
    const counts = COVERED_TOOLS.map(
      (toolName) => matchers.filter((matcher) => hookMatcherSelects({ matcher, toolName })).length,
    );
    expect(counts).toEqual(COVERED_TOOLS.map(() => 1));
  });

  it("selects through its two dispatcher rows exactly what the registry's union selects, and no wider", () => {
    const rows = manifest()["PreToolUse"]!;
    const matchers = rows.slice(0, 2).map((group) => group.matcher!);
    const probes = [...COVERED_TOOLS, "Read", "Grep", "Glob", "WebFetch", "BashOutput", "TodoWrite", "NotebookEdit"];
    const disagree = probes.filter(
      (toolName) =>
        matchers.some((matcher) => hookMatcherSelects({ matcher, toolName })) !==
        hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName }),
    );
    expect(disagree).toEqual([]);
  });

  // A call the envelope has to kill is REFUSED on both rows: a kill reads no payload, so it cannot tell a context
  // holding the owner's profile from one that lacks it, and the `profile-held` hold covers the tripwire row too
  // (doing nothing beats acting misaligned).
  it("refuses at the envelope on both dispatcher rows", () => {
    const rows = manifest()["PreToolUse"]!;
    const [door, tripwire] = rows;
    expect(rows.length).toBe(3);
    expect(door!.hooks[0]!.command.startsWith('SLOPWEAVER_HOOK_GIVE_UP=2 "')).toBe(true);
    expect(tripwire!.hooks[0]!.command.startsWith('SLOPWEAVER_HOOK_GIVE_UP=2 "')).toBe(true);
    expect(door!.hooks[0]!.command).toContain('scripts/hook.sh" 30 pretooluse ');
    expect(tripwire!.hooks[0]!.command).toContain('scripts/hook.sh" 30 pretooluse ');
  });

  // The read-side row is a tripwire no door or profile hold covers, so a kill there RELEASES the read: refusing every
  // `Read` on a loaded machine would stop a session to protect against a read no gate judged.
  it("releases at the envelope on the read-side row", () => {
    const read = manifest()["PreToolUse"]![2]!;
    expect(read.hooks[0]!.command.startsWith('SLOPWEAVER_HOOK_GIVE_UP=0 "')).toBe(true);
    expect(read.hooks[0]!.command).toContain('scripts/hook.sh" 30 protected-paths ');
  });

  it("gives every row the same 30-second timeout, so no half is starved sooner than another", () => {
    expect(manifest()["PreToolUse"]!.map((group) => group.hooks[0]!.timeout)).toEqual([30, 30, 30]);
  });

  it("selects every tool at least one check applies to", () => {
    const covered = ["Bash", "Monitor", "Artifact", "TaskOutput", "Edit", "Write", "Agent", "Task"];
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.filter((toolName) => !hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName }))).toEqual([]);
    expect(hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName: "mcp__claude-in-chrome__navigate" })).toBe(
      true,
    );
  });

  it("stays NARROW: the read-only tools that pay nothing today never reach the dispatcher", () => {
    const readOnly = ["Read", "Grep", "Glob", "WebFetch"];
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.filter((toolName) => hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName }))).toEqual([]);
  });

  // The union has to spell `^(?:…)$` around the exact names, and this is the case that says why. One
  // alternative needs `.`/`*`, which puts the WHOLE string on the harness's unanchored-regex path — so an
  // unanchored `Bash|…|Edit|Write|Task` would select four tools no entry of the ten ever saw, and the
  // dispatcher would pay its cost on every one of them.
  it("stays NARROW against the names its own alternatives are prefixes of", () => {
    const prefixed = ["BashOutput", "TodoWrite", "NotebookEdit", "NotebookRead"];
    expect(prefixed.length).toBeGreaterThan(0);
    expect(prefixed.filter((toolName) => hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName }))).toEqual([]);
  });

  it("applies every check to something the union lets through", () => {
    const reachable = [
      "Bash",
      "Monitor",
      "Artifact",
      "TaskOutput",
      "Edit",
      "Write",
      "Agent",
      "Task",
      "mcp__claude-in-chrome__navigate",
    ];
    expect(reachable.filter((toolName) => !hookMatcherSelects({ matcher: PRE_TOOL_USE_MATCHER, toolName }))).toEqual(
      [],
    );
    const checks = preToolUseChecks({ env: {} });
    expect(checks.length).toBeGreaterThan(0);
    const unreachable = checks
      .filter((check) => !reachable.some((toolName) => check.appliesTo({ toolName })))
      .map((check) => check.id);
    expect(unreachable).toEqual([]);
  });

  it("still carries a check for every guard that used to be its own entry", () => {
    expect(preToolUseChecks({ env: {} }).map((check) => check.id)).toEqual([
      // `profile-held` is FIRST: no check after it should judge a call from a session whose context
      // lacks the owner's profile, and its refusal is what delivers that profile.
      "profile-held",
      // `bot-live-write-guard` sits AHEAD of `admit`, so a bot turn's migration or live write
      // meets its own rule rather than the generic raw-tool refusal and the hatches that one offers.
      "bot-live-write-guard",
      "admit",
      "main-checkout-guard",
      "main-checkout-dirty-guard",
      // `home-git-guard` sits with the main-checkout guards — which repository a git lands in —
      // and before the poll gate, so a call it refuses is never recorded as a poll.
      "home-git-guard",
      // `call-state-guard` beside it: it protects the same state home, and must not be a poll either.
      "call-state-guard",
      "session-depth-warning",
      "cmux-send-supervisor-guard",
      // `protected-path-guard` before the poll gate, so a call refused for reaching an owner-protected path is
      // never recorded as a poll.
      "protected-path-guard",
      "poll-gate",
      // `disk-scan-guard` is the first row that was never one of the ten. It is asserted HERE, in
      // the same list and in its real position, because the order is load-bearing — the dispatcher stops at
      // the first refusal — and a row appended without a reader noticing where it landed is the drift this
      // list exists to catch.
      "disk-scan-guard",
      // `whole-tree-check-guard` sits beside its sibling spend guard, both fail-open.
      "whole-tree-check-guard",
      // `run-due-deadline-guard` follows it, fail-open like every workflow tripwire.
      "run-due-deadline-guard",
      // `raw-bash-gate` sits after every narrower Bash check, so each of their refusals is seen first.
      "raw-bash-gate",
      "main-checkout-edit-guard",
      // `relay-words-guard` beside its sibling `Edit|Write` tripwire, fail-open like it.
      "relay-words-guard",
      "browser-door-guard",
      "agent-tool-ban",
      "memory-write-guard",
    ]);
  });

  // The ten old script paths survive as one-line shims because the plugin mirror is ONE tree shared by every
  // worktree while each seat runs its OWN checkout's `hooks.json` (once, a sync from one
  // branch took every PreToolUse guard off seven `main` seats at once). A shim naming an id the registry
  // does not carry would silently run no check at all, which is the same outage in a smaller box.
  it("gives every compatibility shim's --only id a row in the registry", () => {
    const ids = new Set(preToolUseChecks({ env: {} }).map((check) => check.id));
    const shims = compatibilityShims();
    expect(shims.length).toBeGreaterThan(0);
    expect(shims.filter(({ id }) => !ids.has(id)).map(({ file }) => file)).toEqual([]);
  });

  // The subject is the TEN, not every row the registry will ever carry. A shim exists so a seat still
  // holding a PRE-FOLD `hooks.json` keeps running the guards THAT FILE names; a check registered after the
  // fold appears in no pre-fold `hooks.json`, so a shim for it would be a path nothing ever invokes — dead
  // scaffolding added to a set whose own header says delete all ten. Asserting it over the whole registry
  // would therefore demand a file that buys nothing, and would keep demanding one per row forever.
  it("covers every PRE-FOLD check with a shim, so a seat on the old hooks.json loses none of them", () => {
    const shimIds = new Set(compatibilityShims().map(({ id }) => id));
    const preFold = PRE_FOLD_PRETOOLUSE_COMMANDS.map((command) =>
      command.replace("scripts/pretooluse-", "").replace(".sh", ""),
    );
    const registered = new Set(preToolUseChecks({ env: {} }).map((check) => check.id));
    expect(shimIds.size).toBeGreaterThan(0);
    expect(preFold.length).toBeGreaterThan(0);
    expect(preFold.filter((id) => !shimIds.has(id))).toEqual([]);
    expect(preFold.filter((id) => !registered.has(id))).toEqual([]);
  });
});
