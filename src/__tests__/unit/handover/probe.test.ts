import { describe, expect, it } from "vitest";

import {
  codeBearing,
  commandProbeNote,
  computeState,
  evaluateProbes,
  type Probe,
  type ProbeSeams,
  parseProbes,
  probeMark,
  textContainsSymbol,
} from "../../../handover/probe.js";

/** Seams that read from a plain map, so every rule is exercised without a filesystem. */
function seams({
  files = {},
  unreadable = [],
  paths = [],
  commands,
}: {
  files?: Readonly<Record<string, string>>;
  unreadable?: readonly string[];
  paths?: readonly string[];
  commands?: Readonly<Record<string, number>>;
} = {}): ProbeSeams {
  return {
    fileContains: ({ file, symbol }) => {
      if (unreadable.includes(file)) {
        return undefined;
      }
      const text = files[file];
      return text === undefined ? false : text.includes(symbol);
    },
    pathExists: ({ path }) => paths.includes(path),
    runCommand:
      commands === undefined
        ? undefined
        : ({ command }) => ({
            launchFailure: undefined,
            signal: undefined,
            status: commands[command],
            timedOutAfterMs: undefined,
          }),
  };
}

describe("parseProbes", () => {
  it("reads each of the four kinds", () => {
    const parsed = parseProbes({
      value: [
        { present: "src/gold/distil.ts#latestRecords" },
        { absent: "src/retrieval/askPrompt.ts#.slice(0, 1200)" },
        { path: "docs/probes.md" },
        { command: "yarn typecheck" },
      ],
    });

    expect(parsed.problems).toEqual([]);
    expect(parsed.probes).toEqual([
      { file: "src/gold/distil.ts", kind: "present", symbol: "latestRecords" },
      { file: "src/retrieval/askPrompt.ts", kind: "absent", symbol: ".slice(0, 1200)" },
      { kind: "path", path: "docs/probes.md" },
      { command: "yarn typecheck", kind: "command" },
    ]);
  });

  it("keeps a symbol that itself contains a hash, splitting on the first only", () => {
    const parsed = parseProbes({ value: [{ present: "a.ts#tag#inner" }] });

    expect(parsed.probes).toEqual([{ file: "a.ts", kind: "present", symbol: "tag#inner" }]);
  });

  it("treats an absent doneWhen as no probes rather than a problem", () => {
    expect(parseProbes({ value: undefined })).toEqual({ probes: [], problems: [] });
    expect(parseProbes({ value: null })).toEqual({ probes: [], problems: [] });
  });

  it("reports a non-list doneWhen", () => {
    const parsed = parseProbes({ value: "present: a.ts#b" });

    expect(parsed.probes).toEqual([]);
    expect(parsed.problems).toEqual(["`doneWhen:` must be a list of `kind: value` entries"]);
  });

  it("reports an unknown kind and keeps the valid entries around it", () => {
    const parsed = parseProbes({ value: [{ present: "a.ts#x" }, { exists: "b.ts" }, { path: "c" }] });

    expect(parsed.probes).toEqual([
      { file: "a.ts", kind: "present", symbol: "x" },
      { kind: "path", path: "c" },
    ]);
    expect(parsed.problems).toEqual([
      "doneWhen[1] declares unknown probe kind `exists` — expected present/absent/path/command",
    ]);
  });

  it("reports a target with no symbol half", () => {
    const parsed = parseProbes({ value: [{ present: "src/a.ts" }] });

    expect(parsed.probes).toEqual([]);
    expect(parsed.problems).toEqual(["doneWhen[0] must be `file#symbol`, but got `src/a.ts`"]);
  });

  it("reports a target whose file half is empty", () => {
    const parsed = parseProbes({ value: [{ absent: "#justasymbol" }] });

    expect(parsed.problems).toEqual(["doneWhen[0] must be `file#symbol`, but got `#justasymbol`"]);
  });

  it("reports an entry declaring more than one kind, because which one is meant is unknowable", () => {
    const parsed = parseProbes({ value: [{ absent: "b.ts#y", present: "a.ts#x" }] });

    expect(parsed.probes).toEqual([]);
    expect(parsed.problems).toEqual([
      "doneWhen[0] must declare exactly one of present/absent/path/command, but declares 2",
    ]);
  });

  it("reports an entry with a blank value", () => {
    const parsed = parseProbes({ value: [{ command: "   " }] });

    expect(parsed.problems).toEqual(["doneWhen[0] declares `command` with no value"]);
  });

  it("reports a bare string entry", () => {
    const parsed = parseProbes({ value: ["present: a.ts#x"] });

    expect(parsed.problems).toEqual(["doneWhen[0] is not a `kind: value` entry"]);
  });
});

describe("evaluateProbes", () => {
  const PRESENT: Probe = { file: "a.ts", kind: "present", symbol: "needle" };
  const ABSENT: Probe = { file: "a.ts", kind: "absent", symbol: "needle" };

  it("passes a present probe when the file contains the symbol", () => {
    const [result] = evaluateProbes({ probes: [PRESENT], seams: seams({ files: { "a.ts": "has a needle here" } }) });

    expect(result!.outcome).toBe("pass");
    expect(result!.note).toBe("a.ts contains `needle`");
  });

  it("fails a present probe when the file lacks the symbol", () => {
    const [result] = evaluateProbes({ probes: [PRESENT], seams: seams({ files: { "a.ts": "empty" } }) });

    expect(result!.outcome).toBe("fail");
    expect(result!.note).toBe("a.ts does not contain `needle`");
  });

  it("passes an absent probe when the file lacks the symbol", () => {
    const [result] = evaluateProbes({ probes: [ABSENT], seams: seams({ files: { "a.ts": "empty" } }) });

    expect(result!.outcome).toBe("pass");
  });

  it("fails an absent probe when the symbol is still there", () => {
    const [result] = evaluateProbes({ probes: [ABSENT], seams: seams({ files: { "a.ts": "the needle" } }) });

    expect(result!.outcome).toBe("fail");
  });

  it("does NOT pass an absent probe over an unreadable file — the measured NUL-byte case", () => {
    const [result] = evaluateProbes({ probes: [ABSENT], seams: seams({ unreadable: ["a.ts"] }) });

    expect(result!.outcome).toBe("not-evaluated");
    expect(result!.note).toBe("could not read a.ts — nothing was checked");
  });

  it("does not fail a present probe over an unreadable file either", () => {
    const [result] = evaluateProbes({ probes: [PRESENT], seams: seams({ unreadable: ["a.ts"] }) });

    expect(result!.outcome).toBe("not-evaluated");
  });

  it("evaluates a path probe both ways", () => {
    const results = evaluateProbes({
      probes: [
        { kind: "path", path: "there" },
        { kind: "path", path: "missing" },
      ],
      seams: seams({ paths: ["there"] }),
    });

    expect(results.map((result) => result.outcome)).toEqual(["pass", "fail"]);
    expect(results[1]!.note).toBe("missing does not exist");
  });

  it("declines a command probe when no runner is supplied, rather than guessing", () => {
    const [result] = evaluateProbes({ probes: [{ command: "yarn x", kind: "command" }], seams: seams() });

    expect(result!.outcome).toBe("not-evaluated");
    expect(result!.note).toBe("command not evaluated — pass --probe to run it: yarn x");
  });

  it("reports a command the runner timed out as not-evaluated, never as a failure its exit status implies", () => {
    const [result] = evaluateProbes({
      probes: [{ command: "yarn lint", kind: "command" }],
      seams: {
        ...seams(),
        runCommand: () => ({ launchFailure: undefined, signal: undefined, status: 143, timedOutAfterMs: 30_000 }),
      },
    });

    expect(result!.outcome).toBe("not-evaluated");
    expect(result!.note.startsWith("command TIMED OUT at the 30s probe budget")).toBe(true);
  });

  it("runs a command probe when a runner is supplied", () => {
    const results = evaluateProbes({
      probes: [
        { command: "good", kind: "command" },
        { command: "bad", kind: "command" },
      ],
      seams: seams({ commands: { bad: 3, good: 0 } }),
    });

    expect(results.map((result) => result.outcome)).toEqual(["pass", "fail"]);
    expect(results[0]!.note).toBe("command exited 0: good");
    expect(results[1]!.note).toBe("command exited 3: bad");
  });

  it("returns one result per probe, in declaration order", () => {
    const results = evaluateProbes({
      probes: [{ kind: "path", path: "b" }, PRESENT, { kind: "path", path: "a" }],
      seams: seams({ files: { "a.ts": "needle" }, paths: ["a"] }),
    });

    expect(results.map((result) => result.outcome)).toEqual(["fail", "pass", "pass"]);
  });

  it("evaluates nothing for a doc with no probes", () => {
    expect(evaluateProbes({ probes: [], seams: seams() })).toEqual([]);
  });
});

describe("computeState", () => {
  const pass = { note: "n", outcome: "pass", probe: { kind: "path", path: "p" } } as const;
  const fail = { note: "n", outcome: "fail", probe: { kind: "path", path: "p" } } as const;
  const skipped = { note: "n", outcome: "not-evaluated", probe: { kind: "path", path: "p" } } as const;

  it("is landed when every evaluated probe passes", () => {
    expect(computeState({ commitsAhead: 0, results: [pass, pass] })).toBe("landed");
  });

  it("is partial when some pass and some fail — the state a boolean cannot hold", () => {
    expect(computeState({ commitsAhead: 0, results: [pass, fail] })).toBe("partial");
  });

  it("is not-started when all fail and no commits exist", () => {
    expect(computeState({ commitsAhead: 0, results: [fail, fail] })).toBe("not-started");
  });

  it("is in-flight when all fail but a branch carries commits", () => {
    expect(computeState({ commitsAhead: 1, results: [fail, fail] })).toBe("in-flight");
  });

  it("stays partial rather than in-flight when something already passes", () => {
    expect(computeState({ commitsAhead: 3, results: [pass, fail] })).toBe("partial");
  });

  it("is not computable when nothing was evaluated", () => {
    expect(computeState({ commitsAhead: 0, results: [skipped, skipped] })).toBeUndefined();
  });

  it("is not computable for a doc with no probes at all", () => {
    expect(computeState({ commitsAhead: 5, results: [] })).toBeUndefined();
  });

  /**
   * An adversarial pass refuted the earlier rule here, and it was right: a `not-evaluated` probe is a condition
   * the doc declared that nothing examined — a skipped `command:` probe, or a file nothing could read — so
   * calling that "landed" reports a partially checked doc as complete. This test previously codified the bug,
   * expecting `partial`.
   *
   * Measured: `partial` was itself too coarse. `boardState.ts`'s `probeStatusContradiction` reads
   * `partial` as "the repository shows probes failing", so a `done` doc with an unrun `command:` probe read as
   * CONTRADICTION on a bare `list` even though nothing had actually failed. `unevaluated` keeps "checked and
   * passing, rest unknown" distinct from a probe that was actually checked and failed.
   */
  it("is unevaluated, NOT landed and NOT partial, when a probe passed and another was never evaluated", () => {
    expect(computeState({ commitsAhead: 0, results: [pass, skipped] })).toBe("unevaluated");
  });

  it("stays partial, not unevaluated, when a probe genuinely fails alongside one that passes", () => {
    expect(computeState({ commitsAhead: 0, results: [pass, fail, skipped] })).toBe("partial");
  });

  it("is landed only when every declared probe was actually checked and passed", () => {
    expect(computeState({ commitsAhead: 0, results: [pass, pass] })).toBe("landed");
  });

  it("counts a fail alongside a skip as not-started, not partial", () => {
    expect(computeState({ commitsAhead: 0, results: [fail, skipped] })).toBe("not-started");
  });
});

describe("textContainsSymbol", () => {
  it("is false for an identifier that appears only inside a COMMENT in a .ts file — the whole point", () => {
    const text = "// this module used to call renderUpdateCard directly\nexport const x = 1;\n";
    expect(textContainsSymbol({ file: "src/a.ts", symbol: "renderUpdateCard", text })).toBe(false);
  });

  it("is true for an identifier that appears as a real import in a .ts file", () => {
    const text = 'import { renderUpdateCard } from "./render.js";\n';
    expect(textContainsSymbol({ file: "src/a.ts", symbol: "renderUpdateCard", text })).toBe(true);
  });

  it("is true for an identifier that appears as a real call in a .ts file", () => {
    const text = "renderUpdateCard({ card });\n";
    expect(textContainsSymbol({ file: "src/a.tsx", symbol: "renderUpdateCard", text })).toBe(true);
  });

  it("is false for an identifier that appears only inside a STRING LITERAL in a .ts file", () => {
    const text = 'const msg = "renderUpdateCard is deprecated";\n';
    expect(textContainsSymbol({ file: "src/a.ts", symbol: "renderUpdateCard", text })).toBe(false);
  });

  it("falls back to a raw substring match for a non-identifier symbol, even in a .ts file", () => {
    // `.slice(0, 1200)` has no AST equivalent to check structurally — a magic-number-shaped probe stays a
    // plain substring search, comments included, exactly as before this module could tell the two apart.
    const text = "// used to call text.slice(0, 1200) here\n";
    expect(textContainsSymbol({ file: "src/a.ts", symbol: ".slice(0, 1200)", text })).toBe(true);
  });

  it("falls back to a raw substring match for a non-TypeScript file, even for an identifier-shaped symbol", () => {
    // Prose has no comment/code distinction to make structural, so a markdown doc keeps plain substring —
    // the NUL-byte case in evaluate.test.ts already depends on exactly this fallback.
    const text = "renderUpdateCard is mentioned here in prose.\n";
    expect(textContainsSymbol({ file: "docs/notes.md", symbol: "renderUpdateCard", text })).toBe(true);
  });
});

describe("commandProbeNote", () => {
  const LONG = "cd /repo && ./bin/slopweaver codex watch --once --dry-run 2>&1 | head -1 | grep -qE 'verdict'";

  it("names the exit status and the command, so two command probes never read the same", () => {
    const note = commandProbeNote({
      command: LONG,
      outcome: { launchFailure: undefined, signal: undefined, status: 1, timedOutAfterMs: undefined },
    });

    expect(note).toBe(`command exited 1: ${LONG}`);
  });

  it("says a pass the same way, because a reader has to map a tick to a line too", () => {
    const note = commandProbeNote({
      command: "yarn typecheck",
      outcome: { launchFailure: undefined, signal: undefined, status: 0, timedOutAfterMs: undefined },
    });

    expect(note).toBe("command exited 0: yarn typecheck");
  });

  it("names the runner's budget for a timeout, and never the status a child that trapped SIGTERM chose", () => {
    const note = commandProbeNote({
      command: "yarn lint",
      outcome: { launchFailure: undefined, signal: undefined, status: 143, timedOutAfterMs: 30_000 },
    });

    expect(note).toBe(
      "command TIMED OUT at the 30s probe budget — the runner killed it, so it neither passed nor failed. " +
        "A whole-suite gate is the wrong probe shape: probe the one consequence the work changes " +
        "(skills/handover/reference/behavioural-probes.md): yarn lint",
    );
  });

  it("distinguishes a signal from an exit status", () => {
    const note = commandProbeNote({
      command: "sleep 600",
      outcome: { launchFailure: undefined, signal: "SIGTERM", status: undefined, timedOutAfterMs: undefined },
    });

    expect(note).toBe("command killed by SIGTERM: sleep 600");
  });

  it("distinguishes a shell that never launched from a command that ran and failed", () => {
    const note = commandProbeNote({
      command: "yarn x",
      outcome: {
        launchFailure: "spawn /bin/sh ENOENT",
        signal: undefined,
        status: undefined,
        timedOutAfterMs: undefined,
      },
    });

    expect(note).toBe("command could not run (spawn /bin/sh ENOENT): yarn x");
  });

  it("says so rather than printing an exit when nothing reported one", () => {
    const note = commandProbeNote({
      command: "yarn x",
      outcome: { launchFailure: undefined, signal: undefined, status: undefined, timedOutAfterMs: undefined },
    });

    expect(note).toBe("command ended with no exit status: yarn x");
  });

  it("prints the whole command, never a prefix of it", () => {
    const note = commandProbeNote({
      command: LONG,
      outcome: { launchFailure: undefined, signal: undefined, status: 7, timedOutAfterMs: undefined },
    });

    expect(note.endsWith("grep -qE 'verdict'")).toBe(true);
  });
});

describe("codeBearing", () => {
  /**
   * The four cells of the rule, so the discrimination is checkable without constructing file text. Both
   * halves are necessary: a symbol with no AST equivalent, and a file with no parse, each fall back to a
   * plain substring search.
   */
  it("requires a code occurrence only for an identifier-shaped symbol in a TypeScript file", () => {
    expect(codeBearing({ file: "src/a.ts", symbol: "flushWithinChannel" })).toBe(true);
    expect(codeBearing({ file: "src/a.tsx", symbol: "flushWithinChannel" })).toBe(true);
    expect(codeBearing({ file: "docs/notes.md", symbol: "flushWithinChannel" })).toBe(false);
    expect(codeBearing({ file: "src/a.ts", symbol: ".slice(0, 1200)" })).toBe(false);
  });

  /**
   * The measured defect, as its own case. `slack-oversized-channel-never-commits` declared
   * `present: src/corpus/slack/fetch.ts#flushWithinChannel`; a later change moved that function to
   * `channelRead.ts`, and the only occurrence left in `fetch.ts` is the comment below. The probe passed on
   * prose for days, which is the reason `codeBearing` has a name at all.
   */
  it("makes the probe that passed on a comment fail instead", () => {
    const text = "// See channelRead.ts's flushWithinChannel\nexport const x = 1;\n";
    expect(codeBearing({ file: "src/corpus/slack/fetch.ts", symbol: "flushWithinChannel" })).toBe(true);
    expect(textContainsSymbol({ file: "src/corpus/slack/fetch.ts", symbol: "flushWithinChannel", text })).toBe(false);
  });
});

describe("probeMark", () => {
  /** `–` is its own answer, not a quieter failure — the board spells the word out beside it for that reason. */
  it("gives a distinct mark to each of the three outcomes", () => {
    expect(probeMark({ outcome: "pass" })).toBe("✔");
    expect(probeMark({ outcome: "fail" })).toBe("✘");
    expect(probeMark({ outcome: "not-evaluated" })).toBe("–");
  });
});
