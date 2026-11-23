/**
 * The mechanical half of loading the owner's context: the hook that puts it in front of every session.
 *
 * Things that must be loaded when they are needed want mechanical enforcement. The mechanism is ONE `SessionStart` hook in
 * `hooks/hooks.json`, which the plugin carries into every project it loads into — `acme-admin` as much as this
 * repository — and which Claude Code re-runs after every compaction with `source: "compact"`.
 *
 * ## What this proves, and what it deliberately does not
 *
 * It proves the REGISTRATION: the event, the script, the budget, and the shapes that would silently defeat it.
 * It does not prove DELIVERY — that a real Claude session received the text — and nothing under `src/` can,
 * because that is a property of the host. Delivery is proved by running a session outside this repository
 * and looking for `ALWAYS_LOADED_MARKER` in its context, with the registration removed as the negative
 * control. Asserting registration and calling it delivery is exactly the substitution
 * `a-check-that-cannot-fail-reports-clean` names, so the limit is written here rather than discovered.
 *
 * ## Why there is no PostCompact row
 *
 * MEASURED across 1581 Claude transcripts written over 14 days: 6558 hook records
 * named `SessionStart:compact` (1256 of them this hook) and ZERO named `PostCompact`, and `reachesContext` in
 * `src/context/loadLedger.ts` records that Claude Code reads no context from that event. A PostCompact row
 * delivered nothing and only competed for CPU at the one moment the compact-time load was already losing
 * its race. Repro: `grep -c '"hookName":"SessionStart:compact"' <a transcript that compacted>`.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The registered hook command, as it appears in `hooks.json`. */
const SCRIPT = "hooks/profile-context.sh";

/** Every command string registered under one hook event, or none for an event nothing registers. */
function commandsFor({ event }: { event: string }): readonly string[] {
  const config = JSON.parse(readFileSync(join(process.cwd(), "hooks", "hooks.json"), "utf8")) as {
    hooks: Record<string, { hooks: { command: string }[] }[] | undefined>;
  };
  const groups = config.hooks[event];
  if (groups === undefined) {
    return [];
  }
  return groups.flatMap((group) => group.hooks.map((entry) => entry.command));
}

describe("hooks.json", () => {
  it("runs the profile context hook at SessionStart, which a compaction re-runs as SessionStart:compact", () => {
    expect(commandsFor({ event: "SessionStart" }).filter((command) => command.includes(SCRIPT))).toHaveLength(1);
  });

  it("registers no PostCompact profile row, whose output reaches no context", () => {
    expect(commandsFor({ event: "PostCompact" }).length).toBeGreaterThan(0);
    expect(commandsFor({ event: "PostCompact" }).filter((command) => command.includes(SCRIPT))).toEqual([]);
  });

  it("reaches it at SessionStart from the plugin root with a 60s budget, never the mirror that event is still building", () => {
    const command = commandsFor({ event: "SessionStart" }).find((entry) => entry.includes(SCRIPT));
    // MEASURED once: from the mirror it exited 127 on a fresh root in most seats, because SessionStart
    // hooks start in parallel with `plugin-mirror-sync` (docs/hooks/mirrors-and-failure-policy.md).
    // 60, not 10: MEASURED once, every one of seven unloaded sessions was this hook killed "after 7s" while
    // node booted under load, and `hooks/lib/seat-pass.sh` measured that boot at 12.9-35.6s wall.
    expect(command).toBe(
      '"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/hook.sh" 60 profile-context "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/profile-context.sh"',
    );
  });
});

describe("hooks/profile-context.sh", () => {
  it("is executable, or the harness runs nothing at all", () => {
    // eslint-disable-next-line no-bitwise -- the owner-execute bit is a bitmask by definition
    expect(statSync(join(process.cwd(), SCRIPT)).mode & 0o100).toBe(0o100);
  });

  it("does NOT inherit the handover hook's no-runs fast path", () => {
    const source = readFileSync(join(process.cwd(), SCRIPT), "utf8");
    expect(source).not.toContain("RUNS_DIR");
  });

  it("exits zero on every path it can take, so a profile read can never break a session start", () => {
    const source = readFileSync(join(process.cwd(), SCRIPT), "utf8");
    expect(source).toContain("|| exit 0");
    expect(source).toContain("|| true");
  });

  it("clears the delivery marker before it resolves a root or starts node, so a killed load leaves none", () => {
    const source = readFileSync(join(process.cwd(), SCRIPT), "utf8");
    const clear = source.indexOf('profile_delivery_clear "$PAYLOAD"');
    expect(clear).toBeGreaterThan(0);
    expect(clear).toBeLessThan(source.indexOf("resolve_plugin_root"));
  });
});
