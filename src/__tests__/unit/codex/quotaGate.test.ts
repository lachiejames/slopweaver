/**
 * {@link mostRecentEvidence} and {@link resolveCodexQuotaDecision} — the pure merge-and-decide logic that
 * lets a passed reset time clear a weekly-limit refusal without any manual step — plus {@link survivingEvidence},
 * which is what actually makes a fresher healthy snapshot self-heal a stale cached refusal. The header of
 * `quotaGate.ts` claimed that self-healing for a month while the reader it depended on could not report a
 * healthy reading at all, so these cases are the witness that the sentence is now true.
 */
import { describe, expect, it } from "vitest";
import {
  mostRecentEvidence,
  resolveCodexQuotaDecision,
  resolveCodexQuotaDecisionAcross,
  survivingEvidence,
} from "../../../codex/quotaGate.js";
import type { CodexQuotaEvidence, CodexQuotaObservation } from "../../../codex/quotaTypes.js";

describe("mostRecentEvidence", () => {
  it("returns undefined when every candidate is absent", () => {
    expect(mostRecentEvidence({ candidates: [undefined, undefined] })).toBeUndefined();
  });

  it("returns the sole candidate when only one is present", () => {
    const only: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T00:00:00.000Z" };

    expect(mostRecentEvidence({ candidates: [undefined, only] })).toEqual(only);
  });

  it("picks the candidate observed most recently, regardless of array order", () => {
    const older: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T00:00:00.000Z" };
    const newer: CodexQuotaEvidence = { kind: "window-limit", observedAtIso: "2026-08-14T05:00:00.000Z" };

    expect(mostRecentEvidence({ candidates: [newer, older] })).toEqual(newer);
    expect(mostRecentEvidence({ candidates: [older, newer] })).toEqual(newer);
  });
});

const RECOVERY_HINT = "bypass once with --force, or run `slopweaver codex quota clear` once it's confirmed fixed";

describe("resolveCodexQuotaDecision", () => {
  const NOW_ISO = "2026-08-14T12:00:00.000Z";

  it("allows a spawn when there is no evidence at all", () => {
    expect(resolveCodexQuotaDecision({ evidence: undefined, nowIso: NOW_ISO })).toEqual({ refuse: false });
  });

  it("refuses on credits-out, naming the detection time and how to recover", () => {
    const evidence: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T05:00:00.000Z" };

    expect(resolveCodexQuotaDecision({ evidence, nowIso: NOW_ISO })).toEqual({
      evidence,
      reason: `Codex is out of credits (detected 2026-08-14T05:00:00.000Z) — ${RECOVERY_HINT}`,
      refuse: true,
    });
  });

  it("refuses on a weekly-limit whose reset time has not yet passed", () => {
    const evidence: CodexQuotaEvidence = {
      kind: "window-limit",
      observedAtIso: "2026-08-14T05:00:00.000Z",
      resetAtIso: "2026-08-18T00:25:00.000Z",
    };

    expect(resolveCodexQuotaDecision({ evidence, nowIso: NOW_ISO })).toEqual({
      evidence,
      reason:
        `Codex exhausted a usage window (detected 2026-08-14T05:00:00.000Z, resets 2026-08-18T00:25:00.000Z) — ` +
        RECOVERY_HINT,
      refuse: true,
    });
  });

  it("allows a spawn once a weekly-limit's own reset time has passed", () => {
    const evidence: CodexQuotaEvidence = {
      kind: "window-limit",
      observedAtIso: "2026-08-10T05:00:00.000Z",
      resetAtIso: "2026-08-11T00:25:00.000Z",
    };

    expect(resolveCodexQuotaDecision({ evidence, nowIso: NOW_ISO })).toEqual({ refuse: false });
  });

  it("treats a reset time exactly equal to now as already passed", () => {
    const evidence: CodexQuotaEvidence = {
      kind: "window-limit",
      observedAtIso: "2026-08-10T05:00:00.000Z",
      resetAtIso: NOW_ISO,
    };

    expect(resolveCodexQuotaDecision({ evidence, nowIso: NOW_ISO })).toEqual({ refuse: false });
  });

  it("refuses a weekly-limit with no known reset time — there is nothing to compare against the clock", () => {
    const evidence: CodexQuotaEvidence = { kind: "window-limit", observedAtIso: "2026-08-14T05:00:00.000Z" };

    expect(resolveCodexQuotaDecision({ evidence, nowIso: NOW_ISO })).toEqual({
      evidence,
      reason: `Codex exhausted a usage window (detected 2026-08-14T05:00:00.000Z) — ${RECOVERY_HINT}`,
      refuse: true,
    });
  });
});

describe("survivingEvidence — the scoped self-healing the header promised and the code never had", () => {
  const premiumCap: CodexQuotaEvidence = {
    kind: "usage-limit",
    limitId: "premium",
    observedAtIso: "2026-09-11T07:31:24.319Z",
  };

  it("clears a cap once a LATER healthy reading of the SAME limit id arrives", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "2026-09-11T08:00:00.000Z" },
    ];

    expect(survivingEvidence({ candidates: [premiumCap], observations })).toEqual([]);
  });

  it("does NOT clear a premium cap with a healthy codex reading, however much newer", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "codex", observedAtIso: "2026-09-13T05:51:14.803Z" },
    ];

    expect(survivingEvidence({ candidates: [premiumCap], observations })).toEqual([premiumCap]);
  });

  it("does NOT clear a cap with an EARLIER healthy reading of the same scope", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "2026-09-11T07:00:00.000Z" },
    ];

    expect(survivingEvidence({ candidates: [premiumCap], observations })).toEqual([premiumCap]);
  });

  it("does NOT clear a cap on an identical instant, which cannot say which came second", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: premiumCap.observedAtIso },
    ];

    expect(survivingEvidence({ candidates: [premiumCap], observations })).toEqual([premiumCap]);
  });

  it("never clears UNSCOPED evidence, which no reading can be shown to be about", () => {
    const unscoped: CodexQuotaEvidence = { kind: "credits-out", observedAtIso: "2026-08-14T04:28:21.285Z" };
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "2026-09-13T05:51:14.803Z" },
      { evidence: undefined, limitId: "codex", observedAtIso: "2026-09-13T05:51:14.803Z" },
    ];

    expect(survivingEvidence({ candidates: [unscoped], observations })).toEqual([unscoped]);
  });

  it("keeps the most recent survivor when one candidate is cleared and another is not", () => {
    const codexWeekly: CodexQuotaEvidence = {
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-07-19T16:28:08.923Z",
    };
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "codex", observedAtIso: "2026-09-13T05:51:14.803Z" },
    ];

    expect(survivingEvidence({ candidates: [codexWeekly, premiumCap], observations })).toEqual([premiumCap]);
  });

  it("returns undefined when there is no evidence at all, which reads as healthy", () => {
    expect(survivingEvidence({ candidates: [undefined, undefined], observations: [] })).toEqual([]);
  });

  it("an observation that itself found an exhaustion clears nothing — only a HEALTHY one does", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: premiumCap, limitId: "premium", observedAtIso: "2026-09-12T00:00:00.000Z" },
    ];

    expect(survivingEvidence({ candidates: [premiumCap], observations })).toEqual([premiumCap]);
  });
});

describe("resolveCodexQuotaDecision for a usage-limit", () => {
  it("refuses, and says there is no reset to wait for rather than printing an empty clause", () => {
    const decision = resolveCodexQuotaDecision({
      evidence: { kind: "usage-limit", limitId: "premium", observedAtIso: "2026-09-11T07:31:24.319Z" },
      nowIso: "2026-09-13T00:00:00.000Z",
    });

    expect(decision.refuse).toBe(true);
    expect(decision.refuse === true ? decision.reason : "").toContain("no window, so there is no reset to wait for");
  });
});

describe("instants are parsed, never compared as text", () => {
  const cap: CodexQuotaEvidence = {
    kind: "usage-limit",
    limitId: "premium",
    observedAtIso: "2026-09-11T07:31:24.319Z",
  };

  it("does NOT clear a cap with an offset timestamp that sorts higher but is the EARLIER instant", () => {
    // The +01:00 offset reading is half an hour BEFORE the cap — while sorting above it as a string. A lexical
    // comparison cleared the cap here; found by a Codex review of this change on exactly this pair.
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "2026-09-11T08:00:00+01:00" },
    ];

    expect(survivingEvidence({ candidates: [cap], observations })).toEqual([cap]);
  });

  it("DOES clear a cap with an offset timestamp that is genuinely the later instant", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "2026-09-11T09:00:00+01:00" },
    ];

    expect(survivingEvidence({ candidates: [cap], observations })).toEqual([]);
  });

  it("clears nothing with an unparseable observation instant", () => {
    const observations: readonly CodexQuotaObservation[] = [
      { evidence: undefined, limitId: "premium", observedAtIso: "whenever" },
    ];

    expect(survivingEvidence({ candidates: [cap], observations })).toEqual([cap]);
  });

  it("keeps refusing when a window's reset instant will not parse, rather than reading it as passed", () => {
    const decision = resolveCodexQuotaDecision({
      evidence: { kind: "window-limit", observedAtIso: "2026-08-14T05:00:00.000Z", resetAtIso: "soon" },
      nowIso: "2026-09-13T00:00:00.000Z",
    });

    expect(decision.refuse).toBe(true);
  });

  it("names WHICH window closed, so five hours is not read as a week", () => {
    const decision = resolveCodexQuotaDecision({
      evidence: {
        kind: "window-limit",
        observedAtIso: "2026-06-29T08:01:29.724Z",
        resetAtIso: "2026-06-29T13:01:03.000Z",
        windowMinutes: 300,
      },
      nowIso: "2026-06-29T09:00:00.000Z",
    });

    expect(decision.refuse === true ? decision.reason : "").toContain("its 300-minute window");
  });
});

describe("a cap nothing has cleared cannot be hidden behind a fresher, weaker one", () => {
  // Found by a Codex review: `survivingEvidence` returned only the FRESHEST survivor, so an older cap that
  // no observation could clear vanished the moment a newer piece of evidence appeared — and when that newer
  // one was a window whose reset had passed, the gate allowed the spawn with the real cap still in force.
  const unscopedCreditsOut: CodexQuotaEvidence = {
    kind: "credits-out",
    observedAtIso: "2026-09-11T00:00:00.000Z",
  };
  const reopenedWindow: CodexQuotaEvidence = {
    kind: "window-limit",
    limitId: "codex",
    observedAtIso: "2026-09-12T00:00:00.000Z",
    resetAtIso: "2026-09-12T05:00:00.000Z",
    windowMinutes: 300,
  };

  it("keeps BOTH survivors, newest first", () => {
    expect(survivingEvidence({ candidates: [unscopedCreditsOut, reopenedWindow], observations: [] })).toEqual([
      reopenedWindow,
      unscopedCreditsOut,
    ]);
  });

  it("refuses on the uncleared credits-out even though the fresher window has reopened", () => {
    const decision = resolveCodexQuotaDecisionAcross({
      evidence: survivingEvidence({ candidates: [unscopedCreditsOut, reopenedWindow], observations: [] }),
      nowIso: "2026-09-13T00:00:00.000Z",
    });

    expect(decision.refuse).toBe(true);
    expect(decision.refuse === true ? decision.evidence : undefined).toEqual(unscopedCreditsOut);
  });

  it("allows when every survivor has reopened on its own terms", () => {
    expect(
      resolveCodexQuotaDecisionAcross({
        evidence: [reopenedWindow],
        nowIso: "2026-09-13T00:00:00.000Z",
      }),
    ).toEqual({ refuse: false });
  });

  it("allows when nothing survived at all", () => {
    expect(resolveCodexQuotaDecisionAcross({ evidence: [], nowIso: "2026-09-13T00:00:00.000Z" })).toEqual({
      refuse: false,
    });
  });
});
