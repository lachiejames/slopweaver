import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { residueOf } from "../../../cli/commands/handover/finishRefusals.js";
import { forcedBy, structuralAllowedBy } from "../../../cli/commands/handover/lifecycle.js";
import {
  claimRefusal,
  HANDOVER_LIFECYCLE_FLAG_NAMES,
  lifecycleUsage,
  parseLifecycleArgs,
  routingFlagSuffix,
} from "../../../cli/commands/handover/lifecycleRun.js";
import { phaseRefusal } from "../../../cli/commands/handover/phaseRefusal.js";
import type { ProbeResult } from "../../../handover/probe.js";
import type { RunOwnership } from "../../../handover/runOwner.js";
import { shellValue } from "../../../handover/runOwner.js";
import { unwrapErr } from "../../../lib/result.js";

/** One probe result, for the residue rules. */
function result({ outcome }: { outcome: ProbeResult["outcome"] }): ProbeResult {
  return { note: `note-${outcome}`, outcome, probe: { kind: "path", path: "p" } };
}

describe("parseLifecycleArgs", () => {
  it("accepts a slug as a positional and returns it", () => {
    const parsed = parseLifecycleArgs({ rest: ["my-doc"], verb: "start" });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.positionals : []).toEqual(["my-doc"]);
  });

  it("accepts start's own --branch flag", () => {
    const parsed = parseLifecycleArgs({ rest: ["my-doc", "--branch", "feat/x"], verb: "start" });

    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.values["branch"] : undefined).toBe("feat/x");
  });

  it("rejects a flag the verb does not declare, rather than ignoring it", () => {
    expect(unwrapErr(parseLifecycleArgs({ rest: ["my-doc", "--branch", "x"], verb: "ask" }))).toEqual([
      "unknown flag: --branch",
    ]);
  });

  it("reads --probe as a boolean", () => {
    const parsed = parseLifecycleArgs({ rest: ["my-doc", "--probe"], verb: "finish" });

    expect(parsed.isOk() ? parsed.value.values["probe"] : undefined).toBe(true);
  });

  it("accepts a question containing spaces and punctuation", () => {
    const parsed = parseLifecycleArgs({ rest: ["my-doc", "--question", "which base, exactly?"], verb: "ask" });

    expect(parsed.isOk() ? parsed.value.values["question"] : undefined).toBe("which base, exactly?");
  });
});

describe("lifecycleUsage", () => {
  it("names the verb, the slug and every flag the parser accepts", () => {
    const usage = lifecycleUsage({ verb: "start" });

    expect(usage.startsWith("usage: slopweaver handover start <slug>")).toBe(true);
    for (const flag of HANDOVER_LIFECYCLE_FLAG_NAMES["start"]!) {
      expect(usage).toContain(flag);
    }
  });

  it("renders a value placeholder for a string flag and none for a boolean", () => {
    const usage = lifecycleUsage({ verb: "finish" });

    expect(usage).toContain("[--base <value>]");
    expect(usage).toContain("[--probe]");
  });

  it("declares --why for the two verbs that require a reason", () => {
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["amend"]).toContain("--why");
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["abandon"]).toContain("--why");
  });

  // `offer` derives its options from the action's destinations, so accepting a hand-written list would let a
  // card print their choice over a different message. `ask` is the witness that the absence is this verb's
  // own, not a spec the whole family is missing.
  it("gives `offer` the action and refuses the option list `ask` takes", () => {
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["offer"]).toEqual([
      "--action",
      "--base",
      "--blast-radius",
      "--dir",
      "--home",
      "--lean",
      "--problem",
      "--risk",
      "--still-real",
    ]);
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["ask"]).toContain("--options");
  });

  it("makes ownership transfer explicit and keeps the loud takeover flag claim-only", () => {
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["claim"]).toEqual(["--base", "--dir", "--force", "--home", "--why"]);
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["release"]).toEqual(["--base", "--dir", "--home", "--why"]);
  });
});

describe("claimRefusal", () => {
  const foreign: RunOwnership = {
    kind: "elsewhere",
    thisSession: "new-session",
    writer: {
      atIso: "2026-08-09T00:00:00.000Z",
      host: "claude-code",
      pid: 1,
      sessionId: "old-session",
      worktree: "/wt",
    },
  };

  it("accepts a foreign writer only when it is proven dead", () => {
    expect(claimRefusal({ forced: false, liveness: { kind: "dead" }, ownership: foreign })).toBeUndefined();
  });

  it("refuses a live writer without the loud takeover flag", () => {
    expect(claimRefusal({ forced: false, liveness: { kind: "live" }, ownership: foreign })).toContain("still live");
  });

  it("refuses unknown Codex liveness without the loud takeover flag", () => {
    expect(
      claimRefusal({
        forced: false,
        liveness: { kind: "unknown", why: "Codex exposes no registry" },
        ownership: foreign,
      }),
    ).toContain("liveness is unknown");
  });

  it("accepts an explicit forced takeover while leaving the reason to the journal event", () => {
    expect(claimRefusal({ forced: true, liveness: { kind: "live" }, ownership: foreign })).toBeUndefined();
  });
});

describe("residueOf", () => {
  it("is empty when every probe passed", () => {
    expect(residueOf({ results: [result({ outcome: "pass" }), result({ outcome: "pass" })] })).toEqual([]);
  });

  it("names each failing probe", () => {
    expect(residueOf({ results: [result({ outcome: "pass" }), result({ outcome: "fail" })] })).toEqual(["note-fail"]);
  });

  /** "Nothing looked" is not evidence of doneness, so it must not let a run close. */
  it("counts a not-evaluated probe as residue", () => {
    expect(residueOf({ results: [result({ outcome: "not-evaluated" })] })).toEqual(["note-not-evaluated"]);
  });
});

describe("phaseRefusal — a journal write that derivation would discard is refused", () => {
  /**
   * Found by an adversarial review pass: `ask` was reachable with no run open, so it appended a `question`
   * event and reported "recorded the question and paused the run" — while `runStateOf` discarded it, because
   * derivation reads only from the last `started`. Written to disk and simultaneously invisible.
   */
  it("refuses every journal verb when no run is open", () => {
    for (const verb of ["ask", "answer", "amend", "abandon"]) {
      expect(phaseRefusal({ dispatchPending: false, phase: "closed", verb })).toContain("no run is open");
    }
  });

  it("still refuses every journal verb on a dispatch-only journal EXCEPT abandon", () => {
    // A journal holding only a `dispatched` event derives phase `closed`, so without the exemption the
    // supervisor who dispatched cannot give up on its own dispatch and the entry poisons every later digest.
    // Measured live against a real `cmux spawn`.
    for (const verb of ["ask", "answer", "amend"]) {
      expect(phaseRefusal({ dispatchPending: true, phase: "closed", verb })).toContain("no run is open");
    }
    expect(phaseRefusal({ dispatchPending: true, phase: "closed", verb: "abandon" })).toBeUndefined();
  });

  it("does NOT exempt abandon when no dispatch is pending — a closed run stays closed", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "closed", verb: "abandon" })).toContain("no run is open");
  });

  it("refuses correct unless a question is waiting — there is nothing to restate", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "correct" })).toBe(
      "this run has no open question to correct — `handover ask` records one",
    );
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "correct" })).toBeUndefined();
  });

  it("allows ask on an open run", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "ask" })).toBeUndefined();
  });

  it("refuses answer when there is no recorded question", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "answer" })).toBe(
      "this run has no recorded question to answer",
    );
  });

  it("allows answer once a question is waiting", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "answer" })).toBeUndefined();
  });

  it("refuses a second ask while one is already waiting, naming the verbs that change a shaped one", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "ask" })).toContain(
      "already waiting on a question that carries a shape or a draft",
    );
  });

  it("allows abandoning a run that is waiting on the owner", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "waiting-on-owner", verb: "abandon" })).toBeUndefined();
  });
});

describe("finish is subject to the same no-run refusal as the other journal verbs", () => {
  /**
   * An adversarial pass found `finish` missing from this guard, and noted that the earlier test iterated only
   * ask/answer/amend/abandon — so the broken path passed the suite. `finish` on a never-started doc appended a
   * `finished` event that `runStateOf` then discarded.
   */
  it("refuses finish when no run is open", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "closed", verb: "finish" })).toContain("no run is open");
  });

  it("allows finish on an open run", () => {
    expect(phaseRefusal({ dispatchPending: false, phase: "open", verb: "finish" })).toBeUndefined();
  });
});

describe("shellValue", () => {
  it("leaves a plain path unquoted, so default suggestions are byte-stable", () => {
    expect(shellValue({ value: "/custom/handovers" })).toBe("/custom/handovers");
  });

  it("single-quotes a path containing a space, so a pasted command parses it as one literal argument", () => {
    expect(shellValue({ value: "/tmp/custom board" })).toBe("'/tmp/custom board'");
  });

  it("keeps dollar signs and backticks INERT — double quotes would let a pasted command expand them", () => {
    expect(shellValue({ value: "/tmp/$USER/handovers" })).toBe("'/tmp/$USER/handovers'");
  });

  it("single-quotes a literal tilde path, so a shell cannot expand it on paste", () => {
    expect(shellValue({ value: "~/custom/handovers" })).toBe("'~/custom/handovers'");
  });

  it("escapes embedded single quotes rather than truncating the argument", () => {
    expect(shellValue({ value: "a'b" })).toBe(String.raw`'a'\''b'`);
  });
});

describe("routingFlagSuffix", () => {
  const fixtureDirs: string[] = [];

  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("spells a relative --dir absolutely, so the recommendation reads the same board from any cwd", () => {
    const suffix = routingFlagSuffix({
      parsed: { positionals: [], values: { dir: "board" } },
    });

    expect(suffix.startsWith(" --dir /")).toBe(true);
    expect(suffix.endsWith("/board")).toBe(true);
  });

  it("resolves a symlinked relative --dir LEXICALLY — path.join's content reads are what decide a slug", () => {
    const base = mkdtempSync(join(tmpdir(), "sw-route-"));
    fixtureDirs.push(base);
    mkdirSync(join(base, "real", "sub"), { recursive: true });
    symlinkSync(join(base, "real", "sub"), join(base, "ln"));
    const suffix = routingFlagSuffix({ cwd: base, parsed: { positionals: [], values: { dir: "ln/.." } } });

    // scanBoard reads every doc via path.join, which collapses ln/.. lexically — the suffix must match
    // that, not the physical /real the raw readdir would list (the chimera is scanBoard's, not ours).
    expect(suffix.endsWith("/real")).toBe(false);
    expect(suffix.startsWith(" --dir /")).toBe(true);
  });

  it("resolves --home LEXICALLY — path.join collapses its dot-dot before any filesystem call", () => {
    const base = mkdtempSync(join(tmpdir(), "sw-home-"));
    fixtureDirs.push(base);
    mkdirSync(join(base, "real", "sub"), { recursive: true });
    symlinkSync(join(base, "real", "sub"), join(base, "ln2"));
    const suffix = routingFlagSuffix({ cwd: base, parsed: { positionals: [], values: { home: "ln2/.." } } });

    // The verbs join(home, "handovers"), collapsing ln2/.. lexically to <base> — the suffix must match that.
    expect(suffix.endsWith("/real")).toBe(false);
    expect(suffix.startsWith(" --home /")).toBe(true);
  });

  it("preserves an explicitly empty --dir literally — absolutizing it would invent a board the caller never read", () => {
    const suffix = routingFlagSuffix({ parsed: { positionals: [], values: { dir: "" } } });

    expect(suffix).toBe(" --dir ''");
  });

  it("absolutizes an explicitly empty --home — join('', 'handovers') is a cwd-relative read, not a failure", () => {
    const suffix = routingFlagSuffix({ parsed: { positionals: [], values: { home: "" } } });

    expect(suffix.startsWith(" --home /")).toBe(true);
    expect(suffix).not.toContain("''");
  });

  it("is empty on the defaults, so default-path suggestion text is unchanged", () => {
    expect(routingFlagSuffix({ parsed: { positionals: [], values: {} } })).toBe("");
  });
});

describe("structuralAllowedBy", () => {
  it("reads the behavioural-probe break-glass, and only its exact value", () => {
    expect(structuralAllowedBy({ env: { SLOPWEAVER_ALLOW_STRUCTURAL_PROBE: "1" } })).toBe(true);
    expect(structuralAllowedBy({ env: { SLOPWEAVER_ALLOW_STRUCTURAL_PROBE: "true" } })).toBe(false);
    expect(structuralAllowedBy({ env: {} })).toBe(false);
  });

  /**
   * One variable per risk: overriding "a probe still fails" must never silently also override "no probe
   * would ever fail". They are different admissions and the PR has to state which one was made.
   */
  it("is not satisfied by the unrelated failing-probe override", () => {
    expect(structuralAllowedBy({ env: { SLOPWEAVER_ALLOW_UNREVIEWED: "1" } })).toBe(false);
    expect(forcedBy({ env: { SLOPWEAVER_ALLOW_STRUCTURAL_PROBE: "1" } })).toBe(false);
  });
});
