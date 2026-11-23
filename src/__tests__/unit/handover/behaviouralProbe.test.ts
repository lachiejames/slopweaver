import { describe, expect, it } from "vitest";

import {
  ALLOW_STRUCTURAL_PROBE,
  BEHAVIOURAL_PROBE_MODE,
  BEHAVIOURAL_PROBE_MODE_ENV,
  behaviouralProbeBlocks,
  behaviouralProbeGap,
  behaviouralProbeMode,
  describeBehaviouralProbeGap,
  isBehaviouralProbe,
  isStructuralCommand,
  ownerAskMarker,
} from "../../../handover/behaviouralProbe.js";
import type { Probe } from "../../../handover/probe.js";

/** The `command:` probe shape, so a test names only the shell string it is actually about. */
function command({ text }: { text: string }): Probe {
  return { command: text, kind: "command" };
}

/** Every former spelling a stored board summary may still carry, spelled as a pattern's source. */
const STORED_MARKERS = [/his ruling/u, /his words/u, /he asked/u, /he ruled/u, /he wants/u, /he told/u].map(
  (pattern) => pattern.source,
);

describe("ownerAskMarker", () => {
  it("matches the audit's own marker list, case-insensitively", () => {
    expect(ownerAskMarker({ summary: "OWNER ASK: the card froze" })).toBe("owner ask");
    expect(ownerAskMarker({ summary: "OWNER RULING, 28 Aug: refuse on the audit rule" })).toBe("owner ruling");
    expect(ownerAskMarker({ summary: "The owner asked for four screenshots" })).toBe("owner ask");
  });

  it("still reads every former spelling a stored board summary carries, in any case", () => {
    expect(STORED_MARKERS.length).toBeGreaterThan(0);
    expect(
      STORED_MARKERS.map((marker) => ownerAskMarker({ summary: `a stored row: ${marker.toUpperCase()} for this` })),
    ).toEqual(STORED_MARKERS);
  });

  it("matches the hyphenated and underscored spellings of a two-word marker", () => {
    expect(ownerAskMarker({ summary: "an owner-ask doc" })).toBe("owner ask");
    expect(ownerAskMarker({ summary: "an owner_ask doc" })).toBe("owner ask");
  });

  /**
   * Measured on the live board, and the reason the noun group exists: two docs the audit itself
   * counted write the phrase with the noun and a different tense — `local-deploy-torn-down-before-owner-
   * inspects` says "the owner asked", `review-loop-rounds-on-unrequested-scope` says "the owner asks".
   * Matching only the pronoun form would have excluded the exact rows the ruling was written about.
   */
  it("matches the noun spelling and its tenses, not only the pronoun", () => {
    expect(ownerAskMarker({ summary: "the owner asked for a local deploy so they could look at it" })).toBe(
      "owner ask",
    );
    expect(ownerAskMarker({ summary: "the owner asks for backtests ~daily" })).toBe("owner ask");
    expect(ownerAskMarker({ summary: "Owner wants a single canonical location per repo" })).toBe("owner wants");
  });

  it("does not fire on the ordinary uses of `owner` that a loose grep matches", () => {
    expect(ownerAskMarker({ summary: "the repo owner is the sole CODEOWNER" })).toBeUndefined();
    expect(ownerAskMarker({ summary: "this file is owned by the corpus module" })).toBeUndefined();
  });

  it("cannot match a marker sitting inside a longer word", () => {
    expect(ownerAskMarker({ summary: "the downloaded artifact" })).toBeUndefined();
  });

  it("reports no marker for a doc that declared no summary", () => {
    expect(ownerAskMarker({ summary: undefined })).toBeUndefined();
  });
});

describe("isStructuralCommand", () => {
  it("calls a bare grep, test or path check structural — nothing ran", () => {
    expect(isStructuralCommand({ command: "grep -qi 'never blocks on' skills/supervisor/SKILL.md" })).toBe(true);
    expect(isStructuralCommand({ command: "test -f src/handover/behaviouralProbe.ts" })).toBe(true);
    expect(isStructuralCommand({ command: "test -s ~/.slopweaver/morning/report.md" })).toBe(true);
  });

  /**
   * Measured on the live board: `context-hygiene-close-and-respawn`'s only probe is three greps behind a
   * `cd`. Without the shell-no-op list its leading `cd` made a purely structural probe read as behavioural,
   * exempting a doc the rule was written for.
   */
  it("sees through a leading cd to the greps behind it", () => {
    expect(isStructuralCommand({ command: "cd /repo && grep -rq 'bootModel' src/a.ts && grep -rq 'x' src/b.ts" })).toBe(
      true,
    );
  });

  it("calls a command that runs a verb or a test suite behavioural", () => {
    expect(isStructuralCommand({ command: "slopweaver turn status --help | grep -q fresh-visible-session" })).toBe(
      false,
    );
    expect(isStructuralCommand({ command: "yarn test:unit github/merge --coverage.enabled=false" })).toBe(false);
  });

  it("calls a command substitution behavioural, because what it runs cannot be read statically", () => {
    expect(isStructuralCommand({ command: '[ "$(gh pr view 15930 --json state -q .state)" = MERGED ]' })).toBe(false);
  });

  it("reads through an env prefix and a directory prefix to the tool actually invoked", () => {
    expect(isStructuralCommand({ command: "FOO=1 /usr/bin/grep -q x file.md" })).toBe(true);
    expect(isStructuralCommand({ command: "FOO=1 /usr/local/bin/slopweaver store read 'q'" })).toBe(false);
  });

  it("reads past a leading `!` to the tool whose exit status is being negated", () => {
    expect(isStructuralCommand({ command: "! grep -q 'gone' skills/x/SKILL.md" })).toBe(true);
    expect(isStructuralCommand({ command: "! slopweaver handover check --doc f.md | grep -q 'owner ask'" })).toBe(
      false,
    );
  });

  it("treats a command with nothing to resolve as structural, never as proof something ran", () => {
    expect(isStructuralCommand({ command: "   " })).toBe(true);
  });
});

describe("isBehaviouralProbe", () => {
  it("calls every declarative probe kind structural, because each one only matches text in a file", () => {
    expect(isBehaviouralProbe({ probe: { file: "src/a.ts", kind: "present", symbol: "runDrip" } })).toBe(false);
    expect(isBehaviouralProbe({ probe: { file: "src/a.ts", kind: "absent", symbol: "oldName" } })).toBe(false);
    expect(isBehaviouralProbe({ probe: { kind: "path", path: "docs/coverage/undocumented.md" } })).toBe(false);
  });

  it("calls a command probe that runs the product behavioural", () => {
    expect(isBehaviouralProbe({ probe: command({ text: "slopweaver doctor | grep -q main-checkout" }) })).toBe(true);
  });
});

describe("behaviouralProbeGap", () => {
  /** The refusing branch: an owner ask whose every probe passes while the behaviour underneath goes wrong. */
  it("refuses an owner-ask doc whose probes are all structural", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [
        { file: "skills/supervisor/SKILL.md", kind: "present", symbol: "never blocks on" },
        command({ text: "test -f src/a.ts" }),
      ],
      probeWaiver: undefined,
      summary: "OWNER ASK: the supervisor blocked on their keypress",
    });

    expect(gap!.marker).toBe("owner ask");
    expect(gap!.structural.length).toBe(2);
  });

  /** The refusing branch a doc reaches by declaring nothing — three of the audit's five failures. */
  it("refuses an owner-ask doc that declares no probes at all", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: undefined,
      summary: "the owner asks for backtests ~daily",
    });

    expect(gap!.marker).toBe("owner ask");
    expect(gap!.structural).toEqual([]);
  });

  /** The passing branch. Without this test the gate could refuse everything and look identical to working. */
  it("passes an owner-ask doc carrying one behavioural probe among structural ones", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [
        { file: "src/a.ts", kind: "present", symbol: "runDrip" },
        command({ text: "slopweaver turn status --help | grep -q fresh-visible-session" }),
      ],
      probeWaiver: undefined,
      summary: "OWNER RULING: the card must tell the truth",
    });

    expect(gap).toBeUndefined();
  });

  /**
   * The escape-hatch rule: fail loudly by default, with an escape hatch. A waived doc
   * still REPORTS — the gap is returned carrying the waiver rather than suppressed — because a waiver nobody
   * ever sees again is the silent `done` the rule exists to make visible.
   */
  it("carries a recorded waiver on the gap rather than suppressing it", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: "landed on the private work repo; no probe runnable from this checkout",
      summary: "OWNER ASK: the deploy was torn down before they could look at it",
    });

    expect(gap!.marker).toBe("owner ask");
    expect(gap!.waiver).toBe("landed on the private work repo; no probe runnable from this checkout");
    expect(behaviouralProbeBlocks({ gap: gap!, mode: "refuse" })).toBe(false);
  });

  /** The untouched branch: a doc nobody's complaint is behind is not this gate's business. */
  it("still finds a gap when no owner-ask marker matches — the trigger is unconditional", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [{ file: "src/a.ts", kind: "present", symbol: "runDrip" }],
      probeWaiver: undefined,
      summary: "the repo owner is the sole CODEOWNER, so a plain merge is refused",
    });

    expect(gap?.marker).toBeUndefined();
    expect(gap?.structural).toEqual([{ file: "src/a.ts", kind: "present", symbol: "runDrip" }]);
    expect(gap?.waiver).toBeUndefined();
  });

  it("leaves an ask row alone — a question makes no claim for a probe to falsify", () => {
    const gap = behaviouralProbeGap({
      doneWhen: [],
      kind: "ask",
      probeWaiver: undefined,
      summary: "OWNER ASK: should we bring the velocity ledger onto the board",
    });

    expect(gap).toBeUndefined();
  });

  it("clears a doc whose probe is behavioural, marker or not", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [{ command: "slopweaver handover lint", kind: "command" }],
      probeWaiver: undefined,
      summary: "a summary quoting nobody at all",
    });

    expect(gap).toBeUndefined();
  });
});

describe("describeBehaviouralProbeGap", () => {
  it("names the doc, the marker, every probe that does not count, and the break-glass", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [{ file: "skills/supervisor/SKILL.md", kind: "present", symbol: "never blocks on" }],
      probeWaiver: undefined,
      summary: "OWNER ASK: it blocked on their keypress",
    });
    const lines = describeBehaviouralProbeGap({
      gap: gap!,
      mode: "refuse",
      slug: "supervisor-never-blocks",
      verb: "handover finish",
    });

    expect(lines[0]).toBe(
      'handover finish: supervisor-never-blocks records an owner ask ("owner ask") with no behavioural probe.',
    );
    expect(lines.join("\n")).toContain("- present: skills/supervisor/SKILL.md#never blocks on");
    expect(lines.join("\n")).toContain(`${ALLOW_STRUCTURAL_PROBE}=1`);
    expect(lines.join("\n")).toContain("probeWaiver:");
  });

  it("says outright when a doc declares nothing, rather than printing an empty list", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: undefined,
      summary: "the owner ruled that this must refuse",
    });
    const lines = describeBehaviouralProbeGap({ gap: gap!, mode: "refuse", slug: "review-rounds", verb: "done" });

    expect(lines.join("\n")).toContain(
      "  it declares no `doneWhen:` probe at all, so nothing re-asks the question after today",
    );
  });

  it("names the claim rather than a marker when the summary quotes nobody, and offers both exits equally", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: undefined,
      summary: "tidy up the lexical index build",
    });
    const lines = describeBehaviouralProbeGap({
      gap: gap!,
      mode: "refuse",
      slug: "lexical-tidy",
      verb: "handover finish",
    });

    expect(lines[0]).toBe("handover finish: lexical-tidy declares no probe that would fail if its claim were false.");
    expect(lines[1]).toBe(
      "  two honest ways past this, and they are equal — write the probe, or record a waiver saying why one",
    );
  });

  it("reads a waiver as a first-class answer, not a failed one", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: "landed on the private work repo — no probe runnable from this checkout",
      summary: "tidy up the lexical index build",
    });
    const lines = describeBehaviouralProbeGap({
      gap: gap!,
      mode: "refuse",
      slug: "lexical-tidy",
      verb: "handover lint",
    });

    expect(lines[0]).toBe(
      "handover lint: lexical-tidy declares no probe that would fail if its claim were false — WAIVED.",
    );
    expect(lines.join("\n")).toContain("a waiver is a first-class answer, not a failed one");
    expect(behaviouralProbeBlocks({ gap: gap!, mode: "refuse" })).toBe(false);
  });
});

describe("behaviouralProbeMode", () => {
  /**
   * The owner has not settled refuse-vs-advise. `refuse` is what this code PROPOSES, so the switch has to be
   * one variable rather than a rewrite — and the default has to be asserted, or a silent flip to `advise`
   * would look exactly like a gate nobody noticed had stopped biting.
   */
  it("defaults to the mode the code proposes, and flips on exactly one value", () => {
    expect(BEHAVIOURAL_PROBE_MODE).toBe("refuse");
    expect(behaviouralProbeMode({ env: {} })).toBe("refuse");
    expect(behaviouralProbeMode({ env: { [BEHAVIOURAL_PROBE_MODE_ENV]: "advise" } })).toBe("advise");
    expect(behaviouralProbeMode({ env: { [BEHAVIOURAL_PROBE_MODE_ENV]: "ADVISE" } })).toBe("refuse");
    expect(behaviouralProbeMode({ env: { [BEHAVIOURAL_PROBE_MODE_ENV]: "off" } })).toBe("refuse");
  });
});

describe("behaviouralProbeBlocks", () => {
  it("blocks only an unwaived gap under the refuse mode", () => {
    const unwaived = behaviouralProbeGap({
      doneWhen: [],
      kind: "doc",
      probeWaiver: undefined,
      summary: "the owner asked for this",
    })!;
    const waived = behaviouralProbeGap({
      doneWhen: [],
      kind: "doc",
      probeWaiver: "no lane exists",
      summary: "the owner asked for this",
    })!;

    expect(behaviouralProbeBlocks({ gap: unwaived, mode: "refuse" })).toBe(true);
    expect(behaviouralProbeBlocks({ gap: unwaived, mode: "advise" })).toBe(false);
    expect(behaviouralProbeBlocks({ gap: waived, mode: "refuse" })).toBe(false);
  });
});

describe("describeBehaviouralProbeGap for a waived doc", () => {
  it("reads as a stated exception naming the reason, not as a refusal", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: "landed on the private work repo",
      summary: "OWNER ASK: the deploy was torn down",
    });
    const lines = describeBehaviouralProbeGap({
      gap: gap!,
      mode: "refuse",
      slug: "local-deploy",
      verb: "handover lint",
    });

    expect(lines[0]).toBe(
      'handover lint: local-deploy records an owner ask ("owner ask") with no behavioural probe — WAIVED.',
    );
    expect(lines[1]).toBe("  probeWaiver: landed on the private work repo");
  });
});

describe("describeBehaviouralProbeGap in advise mode", () => {
  it("prints the same finding, marked advisory, with no break-glass line to paste", () => {
    const gap = behaviouralProbeGap({
      kind: "doc",
      doneWhen: [],
      probeWaiver: undefined,
      summary: "the owner ruled that this must refuse",
    });
    const lines = describeBehaviouralProbeGap({
      gap: gap!,
      mode: "advise",
      slug: "review-rounds",
      verb: "handover lint",
    });

    expect(lines[0]).toBe(
      'handover lint: ADVISORY — review-rounds records an owner ask ("owner ruled") with no behavioural probe.',
    );
    expect(lines.at(-1)).toBe(
      `  advisory only — ${BEHAVIOURAL_PROBE_MODE_ENV} is set to advise, so nothing was refused`,
    );
  });
});
