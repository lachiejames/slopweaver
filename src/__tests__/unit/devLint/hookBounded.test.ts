/**
 * The four properties `hook-bounded` holds, each driven by a manifest that breaks exactly one of them, and
 * the SHIPPED manifest asserted clean beside them.
 *
 * The shipped half is the case that matters: every entry standing today is wrapped, and the five that were
 * once not are the reason the gate exists. Asserting only the synthetic cases would leave the
 * gate green over a repository that had quietly unregistered the entry point.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { envelopeMinDeclaredSeconds, hookBoundedFindings } from "../../../devLint/hookBounded.js";

/** The floor the shipped `bounded-run.sh` declares, so these cases are judged by the same number it is. */
const FLOOR = 4;

const MIRROR = "${PLUGIN_DATA}/mirror/current";

/** One manifest carrying a single `PreToolUse` entry, spelled exactly as `hooks.json` spells one. */
const manifest = ({ command, timeout }: { command: string; timeout?: number }): string =>
  JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ command, timeout, type: "command" }], matcher: "^Bash$" }],
    },
  });

const wrapped = ({ declared, timeout }: { declared: number; timeout: number }): string =>
  manifest({
    command: `"${MIRROR}/scripts/hook.sh" ${String(declared)} pretooluse "${MIRROR}/scripts/pretooluse.sh"`,
    timeout,
  });

const findings = ({ manifestText }: { manifestText: string }) =>
  hookBoundedFindings({ floorSeconds: FLOOR, manifestText })!;

describe("hook-bounded, over the shipped manifest", () => {
  it("passes every registered entry, and reads a real list rather than an empty one", () => {
    const manifestText = readFileSync(join(process.cwd(), "hooks/hooks.json"), "utf8");
    const parsed = JSON.parse(manifestText) as { hooks: Record<string, readonly { hooks: readonly unknown[] }[]> };
    const registered = Object.values(parsed.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks));

    expect(registered.length).toBeGreaterThan(0);
    expect(findings({ manifestText })).toEqual([]);
  });

  it("judges the shipped manifest against the floor the shipped shell declares, not a copy of it", () => {
    const text = readFileSync(join(process.cwd(), "hooks/lib/bounded-run.sh"), "utf8");

    expect(envelopeMinDeclaredSeconds({ text })).toBe(FLOOR);
  });

  it("answers undefined for a shell that declares no floor, rather than inventing one", () => {
    expect(envelopeMinDeclaredSeconds({ text: "HOOK_BUDGET_SECONDS_DEFAULT=15\n" })).toBeUndefined();
  });
});

describe("hook-bounded, over a manifest that breaks one property", () => {
  // The shape every unbounded entry once had: a bare command, with no shell in front of it to
  // source anything.
  it("refuses a command that runs its target directly", () => {
    const found = findings({
      manifestText: manifest({ command: `"${MIRROR}/scripts/plugin-mirror-sync.sh"`, timeout: 60 }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs `${PLUGIN_DATA}/mirror/current/scripts/plugin-mirror-sync.sh` directly");
  });

  it("refuses an entry that declares no timeout at all", () => {
    const found = findings({ manifestText: wrapped({ declared: 20, timeout: undefined as unknown as number }) });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("declares no `timeout`");
  });

  // The property the gate exists for: `hooks.json` cannot read its own field, so the declared timeout is
  // duplicated into argv, and a drift between the two is a bound computed against a ceiling that is not there.
  it("refuses an entry point passed a timeout that is not the declared one", () => {
    const found = findings({ manifestText: wrapped({ declared: 20, timeout: 10 }) });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("is passed `20` while the entry declares 10");
  });

  it("refuses a declared timeout too short for the ladder to fit inside", () => {
    // One second under the floor: a TERM, the escalation and the runway leave the hook no time of its own.
    const found = findings({ manifestText: wrapped({ declared: FLOOR - 1, timeout: FLOOR - 1 }) });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("leaves no room for the ladder");
  });

  // The door-gated PreToolUse row's spelling: a policy an older `hook.sh` ignores rather than misreads.
  it("reads past the give-up assignment to the entry point and the timeout after it", () => {
    const command = `SLOPWEAVER_HOOK_GIVE_UP=2 "${MIRROR}/scripts/hook.sh" 30 pretooluse "${MIRROR}/scripts/pretooluse.sh"`;

    expect(findings({ manifestText: manifest({ command, timeout: 30 }) })).toEqual([]);
    expect(findings({ manifestText: manifest({ command, timeout: 20 }) })[0]!.line).toContain(
      "is passed `30` while the entry declares 20",
    );
  });

  // A prefix is evaluated before the entry point arms anything, so one that can carry work is unbounded.
  it("refuses an assignment whose value could run a command in front of the entry point", () => {
    const found = findings({
      manifestText: manifest({
        command: `X=$(slow) "${MIRROR}/scripts/hook.sh" 30 pretooluse "${MIRROR}/scripts/pretooluse.sh"`,
        timeout: 30,
      }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs `X=$(slow)` directly");
  });

  // An integer value is not enough: bash sources `$BASH_ENV` before the script's first line.
  it("refuses an integer assignment to any name but the give-up policy", () => {
    const found = findings({
      manifestText: manifest({
        command: `BASH_ENV=1 "${MIRROR}/scripts/hook.sh" 30 pretooluse "${MIRROR}/scripts/pretooluse.sh"`,
        timeout: 30,
      }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs `BASH_ENV=1` directly");
  });

  // The right suffix is not enough when the path itself forks first.
  it("refuses an entry-point path built from a command substitution", () => {
    const found = findings({
      manifestText: manifest({
        command: `"$(/tmp/prefix)/scripts/hook.sh" 30 pretooluse "${MIRROR}/scripts/pretooluse.sh"`,
        timeout: 30,
      }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs a command substitution");
  });

  // Arguments are expanded before the entry point starts, so the substitution need not be in its path.
  it("refuses a command substitution in an argument after the entry point", () => {
    const found = findings({
      manifestText: manifest({ command: `"${MIRROR}/scripts/hook.sh" 30 pretooluse "$(sleep 120)/x"`, timeout: 30 }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs a command substitution");
  });

  it("refuses a command chained into the entry point's own word", () => {
    const found = findings({
      manifestText: manifest({ command: "true;sleep;/p/scripts/hook.sh 30 pretooluse /p/x", timeout: 30 }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("chains a command into `true;sleep;/p/scripts/hook.sh`");
  });

  // The shipped `init` and `seat-check` rows end this way, and it runs after the bound has ended.
  it("accepts a redirection and an || true after the call", () => {
    const command = `"${MIRROR}/scripts/hook.sh" 30 init "${MIRROR}/bin/slopweaver" init >/dev/null 2>&1 || true`;

    expect(findings({ manifestText: manifest({ command, timeout: 30 }) })).toEqual([]);
  });

  it("refuses a give-up value the entry point does not know", () => {
    const found = findings({
      manifestText: manifest({
        command: `SLOPWEAVER_HOOK_GIVE_UP=7 "${MIRROR}/scripts/hook.sh" 30 pretooluse "${MIRROR}/scripts/pretooluse.sh"`,
        timeout: 30,
      }),
    });

    expect(found.length).toBe(1);
    expect(found[0]!.line).toContain("runs `SLOPWEAVER_HOOK_GIVE_UP=7` directly");
  });

  it("names both properties when an entry breaks two at once", () => {
    const found = findings({
      manifestText: manifest({ command: `"${MIRROR}/hooks/handover-run.sh"`, timeout: 1 }),
    });

    expect(found.map((one) => one.event)).toEqual(["PreToolUse", "PreToolUse"]);
    expect(found[0]!.line).toContain("directly");
    expect(found[1]!.line).toContain("leaves no room for the ladder");
  });
});

describe("hook-bounded, over a manifest it cannot walk", () => {
  // "No entry broke a rule" and "no entry was ever checked" must not be the same answer: the second is a
  // reading the gate did not take, which `runHookBounded` reports as a fact instead of a policy refusal.
  it("answers undefined rather than clean for text that is not JSON", () => {
    expect(hookBoundedFindings({ floorSeconds: FLOOR, manifestText: "{ not json" })).toBeUndefined();
  });

  it("answers undefined for JSON that is not the event to matcher to hooks shape", () => {
    expect(
      hookBoundedFindings({ floorSeconds: FLOOR, manifestText: '{"hooks":{"PreToolUse":"nope"}}' }),
    ).toBeUndefined();
  });

  it("answers undefined for an entry whose command is not a string", () => {
    const text = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 7, timeout: 10 }] }] } });

    expect(hookBoundedFindings({ floorSeconds: FLOOR, manifestText: text })).toBeUndefined();
  });
});
