import { describe, expect, it } from "vitest";

import {
  CALL_HOLD_DEFAULT_MINUTES,
  CALL_LIVE_PROMPT,
  CALL_STEP_IDS,
  callLegCheckout,
  cardIdWords,
  cardReadChallenge,
  DRAFT_READ_BACK_PROMPT,
  e2eCallSteps,
  FLEET_ASK_PROMPT,
  parseHoldMinutes,
  pickDesktopE2eSteps,
  queueSearchQuestion,
  typedMarker,
  typedProbe,
} from "../../../desktop/e2eCallPlan.js";
import { HEAP_GROWTH_BOUND_BYTES, heapPolicyFor, judgeHeapTrend } from "../../../desktop/e2eHeapTrend.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** The twelve call scenarios the leg places beside the per-card ones, in leg order. */
const WITHOUT_CARD = [
  "call-live",
  "queue-search",
  "call-holds",
  "long-task-mid-call",
  "fleet-ask",
  "draft-read-back",
  "launcher-voice",
  "renderer-killed",
  "typing-after-drop",
  "relaunch",
  "update-swap-resume",
  "renderer-killed-twice",
  "renderer-killed-connecting",
  "call-reopen",
];

describe("e2eCallSteps", () => {
  it("places every scenario but the card ones in leg order, each one a call carrying no card", () => {
    const steps = e2eCallSteps({ holdMinutes: CALL_HOLD_DEFAULT_MINUTES });
    // The paired microphone comparison is the one call scenario no default leg places: it runs only when named.
    expect(CALL_STEP_IDS.filter((id) => !id.startsWith("card-"))).toEqual([...WITHOUT_CARD, "transcription-fidelity"]);
    expect(steps.map((step) => step.id)).toEqual(WITHOUT_CARD);
    expect(steps.filter((step) => step.kind !== "call" || step.cardKey !== undefined)).toEqual([]);
  });

  // Asked for a briefing, the voice must hand the work to the fleet rather than say "I'll get you that briefing".
  it("asks for fleet work on fleet-ask, with the long task's room to run", () => {
    const ask = e2eCallSteps({ holdMinutes: 5 }).find((step) => step.id === "fleet-ask")!;
    expect([ask.prompt, ask.capMs, ask.silenceMs, ask.holdMs]).toEqual([FLEET_ASK_PROMPT, 240_000, 180_000, 0]);
    expect(ask.prompt).toBe(
      "This is an automated end to end test. I want a briefing on what the lint rules in the Slopweaver source " +
        "actually enforce. Look at the lint configuration, then tell me in two sentences what you found and who will " +
        "write that briefing.",
    );
  });

  // A draft dictated "in my voice" must not draw the voice speaking AS the owner.
  it("dictates a draft in the owner's register on draft-read-back and asks to hear it, with the long task's room to run", () => {
    const back = e2eCallSteps({ holdMinutes: 5 }).find((step) => step.id === "draft-read-back")!;
    expect([back.prompt, back.capMs, back.silenceMs, back.holdMs]).toEqual([
      DRAFT_READ_BACK_PROMPT,
      240_000,
      180_000,
      0,
    ]);
    expect(back.prompt).toBe(
      "This is an automated end to end test. Um, can you draft me a two line Slack message to a colleague, like, " +
        "with the words test and no rush in it, saying the end to end test of the desktop app ran, and, yeah, " +
        "there's no rush on their review. Keep it concise and in my voice, then read the draft back to me.",
    );
  });

  it("holds only call-holds, for the minutes asked", () => {
    const holds = e2eCallSteps({ holdMinutes: 7 }).map((step) => [step.id, step.holdMs]);
    expect(holds.filter(([, holdMs]) => holdMs !== 0)).toEqual([["call-holds", 420_000]]);
  });

  it("says on every prompt but call-live's that it is an automated test", () => {
    const steps = e2eCallSteps({ holdMinutes: 5 });
    const unannounced = steps.filter((step) => !step.prompt.includes("automated end to end test"));
    expect(unannounced.map((step) => step.id)).toEqual(["call-live"]);
  });

  // A bare "Hello" must not be answered with "Hi there. I'm ChatGPT…".
  // The step waits one cap to go live and a second for the answer, so the loop's silence
  // has to outlast both or the greeting is said again mid-wait.
  it("greets on call-live alone, once, with silence past both waits so the greeting is never said twice", () => {
    const live = e2eCallSteps({ holdMinutes: 5 }).find((step) => step.id === "call-live")!;
    expect([CALL_LIVE_PROMPT, live.prompt, live.capMs, live.silenceMs, live.holdMs]).toEqual([
      "Hello.",
      "Hello.",
      90_000,
      200_000,
      0,
    ]);
    expect(live.silenceMs).toBeGreaterThan(2 * live.capMs);
  });

  it("still picks the greeting with --only call-live", () => {
    const pick = pickDesktopE2eSteps({
      call: true,
      carded: false,
      holdMinutes: CALL_HOLD_DEFAULT_MINUTES,
      only: ["call-live"],
    });
    expect(pick.calls.map((step) => [step.id, step.prompt])).toEqual([["call-live", "Hello."]]);
  });

  it("gives the long task room to run", () => {
    const long = e2eCallSteps({ holdMinutes: 5 }).find((step) => step.id === "long-task-mid-call")!;
    expect([long.capMs, long.silenceMs]).toEqual([240_000, 180_000]);
  });

  it("names a card by its id's words only, every '-', '_' and '.' a space, never its kind", () => {
    expect([
      cardIdWords({ cardKey: "hand:acme-sample-note" }),
      cardIdWords({ cardKey: "ask:acme_sample.note-2" }),
    ]).toEqual(["acme sample note", "acme sample note 2"]);
  });

  it("places the Queue search second, a short step with the longer cap a typed search needs", () => {
    const steps = e2eCallSteps({ holdMinutes: 5 });
    const search = steps.find((step) => step.id === "queue-search")!;
    const killed = steps.find((step) => step.id === "renderer-killed")!;
    expect(steps.map((step) => step.id).slice(0, 2)).toEqual(["call-live", "queue-search"]);
    expect([search.capMs, search.silenceMs, search.holdMs]).toEqual([120_000, 20_000, 0]);
    expect(search.prompt).toBe(killed.prompt);
  });
});

describe("queueSearchQuestion", () => {
  it("opens on the nonce its turn is found by and asks for one of three words", () => {
    const question = queueSearchQuestion({ nonce: "abc123" });
    expect(question.startsWith("E2E typed abc123: ")).toBe(true);
    expect(
      ["Queue card", "talk find-card", "FOUND", "NONE", "FAILED"].filter((word) => !question.includes(word)),
    ).toEqual([]);
  });
});

describe("cardReadChallenge", () => {
  it("opens on the typed marker and pushes back without naming a tool or saying to re-read", () => {
    const challenge = cardReadChallenge({ nonce: "abc123" });
    expect(challenge).toBe("E2E typed abc123: I don't think that problem is real. What does the card actually claim?");
    expect([challenge.startsWith(typedMarker({ nonce: "abc123" })), typedMarker({ nonce: "abc123" })]).toEqual([
      true,
      "E2E typed abc123",
    ]);
  });
});

describe("pickDesktopE2eSteps", () => {
  const NO_CARD = { carded: false, holdMinutes: 5 };

  it("is the whole walk and no call without --call", () => {
    const pick = pickDesktopE2eSteps({ ...NO_CARD, call: false, only: [] });
    expect([pick.walk.length, pick.calls.length, pick.cardSurfaces]).toEqual([16, 0, []]);
  });

  it("adds every call scenario with --call, and both card surfaces only when a card is named", () => {
    const without = pickDesktopE2eSteps({ ...NO_CARD, call: true, only: [] });
    const withCard = pickDesktopE2eSteps({ call: true, carded: true, holdMinutes: 5, only: [] });
    expect([without.walk.length, without.calls.length, without.cardSurfaces]).toEqual([16, 14, []]);
    expect([withCard.calls.length, withCard.cardSurfaces]).toEqual([14, ["card-read", "card-read-typed"]]);
  });

  it("picks the Queue search alone with --call, and names it without", () => {
    const only = ["queue-search"];
    expect(pickDesktopE2eSteps({ ...NO_CARD, call: true, only }).calls.map((step) => step.id)).toEqual(only);
    expect(pickDesktopE2eSteps({ ...NO_CARD, call: false, only }).needsCall).toEqual(only);
  });

  it("picks one card surface alone with a card, and says it needs one without", () => {
    const only = ["card-read-typed"];
    const picked = pickDesktopE2eSteps({ call: true, carded: true, holdMinutes: 5, only });
    const bare = pickDesktopE2eSteps({ ...NO_CARD, call: true, only });
    expect([picked.calls, picked.cardSurfaces, picked.needsCard]).toEqual([[], only, []]);
    expect([bare.cardSurfaces, bare.needsCard]).toEqual([[], only]);
  });

  it("places the reading hold and the next-card ask only when --only names them, never in a whole card leg", () => {
    const only = ["card-reading-hold", "card-next"];
    const picked = pickDesktopE2eSteps({ call: true, carded: true, holdMinutes: 5, only });
    const bare = pickDesktopE2eSteps({ ...NO_CARD, call: true, only });
    const whole = pickDesktopE2eSteps({ call: true, carded: true, holdMinutes: 5, only: [] });
    expect([picked.cardSurfaces, picked.needsCard, bare.needsCard]).toEqual([only, [], only]);
    expect(whole.cardSurfaces).toEqual(["card-read", "card-read-typed"]);
  });

  it("asks for no card when no card scenario is picked, nor when there is no --call", () => {
    const other = pickDesktopE2eSteps({ ...NO_CARD, call: true, only: ["call-live"] });
    const noCall = pickDesktopE2eSteps({ ...NO_CARD, call: false, only: ["card-read"] });
    expect([other.needsCard, noCall.needsCard, noCall.needsCall]).toEqual([[], [], ["card-read"]]);
  });

  it("takes walk and call ids together, each in its own order", () => {
    const pick = pickDesktopE2eSteps({ ...NO_CARD, call: true, only: ["relaunch", "voice", "call-live"] });
    expect([pick.walk.map((step) => step.id), pick.calls.map((step) => step.id)]).toEqual([
      ["voice"],
      ["call-live", "relaunch"],
    ]);
  });

  it("names a call id given without --call, placing nothing", () => {
    const pick = pickDesktopE2eSteps({ ...NO_CARD, call: false, only: ["call-live"] });
    expect([pick.calls, pick.needsCall, pick.needsCard, pick.unknown]).toEqual([[], ["call-live"], [], []]);
  });

  it("names an id that is neither", () => {
    expect(pickDesktopE2eSteps({ ...NO_CARD, call: true, only: ["phone"] }).unknown).toEqual(["phone"]);
  });

  it("expands transcription-fidelity into its six scheduled calls against the named candidate", () => {
    const pick = pickDesktopE2eSteps({
      ...NO_CARD,
      call: true,
      micCandidate: "auto-gain-off",
      only: ["transcription-fidelity"],
    });
    expect(pick.calls.map((step) => [step.id, step.fidelity!.round, step.fidelity!.variant, step.capMs])).toEqual([
      ["transcription-fidelity", 1, "control", 420_000],
      ["transcription-fidelity", 1, "auto-gain-off", 420_000],
      ["transcription-fidelity", 2, "auto-gain-off", 420_000],
      ["transcription-fidelity", 2, "control", 420_000],
      ["transcription-fidelity", 3, "control", 420_000],
      ["transcription-fidelity", 3, "auto-gain-off", 420_000],
    ]);
    expect(pick.needsCandidate).toEqual([]);
  });

  it("places no fidelity call without a candidate, and none in a default leg even with one", () => {
    const bare = pickDesktopE2eSteps({ ...NO_CARD, call: true, only: ["transcription-fidelity"] });
    const whole = pickDesktopE2eSteps({ ...NO_CARD, call: true, micCandidate: "both-off", only: [] });
    expect([bare.calls, bare.needsCandidate]).toEqual([[], ["transcription-fidelity"]]);
    expect(whole.calls.filter((step) => step.fidelity !== undefined)).toEqual([]);
  });
});

describe("parseHoldMinutes", () => {
  it("takes a whole number from one to thirty", () => {
    expect([unwrap(parseHoldMinutes({ text: "1" })), unwrap(parseHoldMinutes({ text: "30" }))]).toEqual([1, 30]);
  });

  it("refuses zero, past thirty, a fraction and words", () => {
    for (const text of ["0", "31", "2.5", "five", ""]) {
      expect(unwrapErr(parseHoldMinutes({ text }))).toEqual([
        `--call-hold-minutes takes a whole number from 1 to 30, not ${text}`,
      ]);
    }
  });
});

describe("callLegCheckout", () => {
  const MAIN = "/repo/slopweaver";
  const WORKTREE = "/repo/slopweaver/.claude/worktrees.noindex/leg";

  const OTHER = "/repo/clone-b";

  it("takes the owner's checkout for the call leg, however it is spelled", () => {
    expect(unwrap(callLegCheckout({ calling: true, checkout: `${MAIN}/`, declared: [MAIN] }))).toBe(`${MAIN}/`);
  });

  it("takes any checkout the owner declares, not only the first", () => {
    expect(unwrap(callLegCheckout({ calling: true, checkout: MAIN, declared: [OTHER, MAIN] }))).toBe(MAIN);
  });

  it("refuses a worktree's console for the call leg, before a call is placed", () => {
    const refused = unwrapErr(callLegCheckout({ calling: true, checkout: WORKTREE, declared: [MAIN, OTHER] }));
    expect([refused.code, refused.message]).toEqual([
      "CALL_CONSOLE_NOT_HIS",
      `--call places real calls on ${WORKTREE}'s console, which is not one the owner's profile declares (${MAIN}, ${OTHER}): ` +
        "`talk transcript` refuses a console that is not the owner's writing the live talk store, so the call's transcript " +
        "would never end and the leg would STOP on it — nothing was launched; drop --checkout to run the call leg on " +
        "the owner's console",
    ]);
  });

  it("refuses every checkout for the call leg when the owner declares none", () => {
    expect(unwrapErr(callLegCheckout({ calling: true, checkout: MAIN, declared: [] })).message).toContain(
      "(none declared)",
    );
  });

  it("takes a worktree for a walk with no call", () => {
    expect(unwrap(callLegCheckout({ calling: false, checkout: WORKTREE, declared: [MAIN] }))).toBe(WORKTREE);
  });
});

describe("typedProbe", () => {
  it("carries the run's nonce and says it is a test", () => {
    expect(typedProbe({ nonce: "ab12cd34" })).toBe(
      "E2E typed ab12cd34: this is an automated end to end test, reply with acknowledged",
    );
  });
});

describe("judgeHeapTrend", () => {
  const MIB = 1024 * 1024;
  const fiveMinutes = heapPolicyFor({ holdMs: 300_000 });
  /** One sample every ten seconds to 300s, each window's floor the given base plus a rising saw. */
  const samples = ({ floors }: { floors: readonly number[] }): { elapsedMs: number; usedBytes: number }[] =>
    Array.from({ length: 31 }, (_, index) => {
      const elapsedMs = index * 10_000;
      const floor = floors[Math.min(Math.floor(elapsedMs / 60_000), floors.length - 1)]!;
      return { elapsedMs, usedBytes: floor + (index % 6) * MIB };
    });

  it("passes a heap whose floor holds, reading one minimum per window after the warm-up", () => {
    const verdict = judgeHeapTrend({
      policy: fiveMinutes,
      samples: samples({ floors: [100 * MIB, 90 * MIB, 95 * MIB, 92 * MIB, 94 * MIB] }),
    });
    expect(verdict).toEqual({ growthBytes: 4 * MIB, minima: [90 * MIB, 95 * MIB, 92 * MIB, 94 * MIB], passed: true });
  });

  it("fails a floor that rises every window past the bound", () => {
    const floors = [50, 60, 80, 100, 130].map((value) => value * MIB);
    const verdict = judgeHeapTrend({ policy: fiveMinutes, samples: samples({ floors }) });
    expect(verdict.passed).toBe(false);
    expect(verdict).toEqual({
      detail: "the heap's window minima rose every window, 70.0 MiB in all, past the 32.0 MiB bound",
      growthBytes: 70 * MIB,
      kind: "monotonic-growth",
      minima: [60 * MIB, 80 * MIB, 100 * MIB, 130 * MIB],
      passed: false,
    });
  });

  it("passes a rise within the bound", () => {
    const floors = [50, 51, 52, 53, 54].map((value) => value * MIB);
    expect(judgeHeapTrend({ policy: fiveMinutes, samples: samples({ floors }) }).passed).toBe(true);
  });

  it("fails too few windows as too little to judge", () => {
    const verdict = judgeHeapTrend({ policy: fiveMinutes, samples: [{ elapsedMs: 70_000, usedBytes: MIB }] });
    expect(verdict).toEqual({
      detail: "0 complete window(s) of heap samples; 2 needed",
      growthBytes: 0,
      kind: "insufficient-samples",
      minima: [],
      passed: false,
    });
  });

  it("judges a short hold on one window and no warm-up", () => {
    expect(heapPolicyFor({ holdMs: 60_000 })).toEqual({
      maxGrowthBytes: HEAP_GROWTH_BOUND_BYTES,
      minimumWindows: 1,
      warmupMs: 0,
      windowMs: 60_000,
    });
  });
});
