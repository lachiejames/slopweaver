/*
 * The page's word gate on a triage pass: only the owner's own newest words asking to triage begin one, so asking for
 * the next cue card never begins a pass and its card clock.
 */
import { describe, expect, it } from "vitest";

import { TRIAGE_COMMAND_WORDS } from "../../components/voice/triageCommandRun";
import type { GateEntry } from "../../lib/relayGate";
import { heardTriageAsked, TRIAGE_ASK_WINDOW } from "../../lib/triageAskGuard";

/**
 * A relay-gate record of the owner's heard fragments, in order.
 *
 * @param texts what the owner was heard saying, fragment by fragment
 * @returns the record
 */
function heard({ texts }: { texts: readonly string[] }): readonly GateEntry[] {
  return texts.map((text) => ({ kind: "heard", text }));
}

/**
 * A relay-gate record of the owner's speech as the page logs it: each fragment heard, then its stretch's open step growing by
 * exactly that fragment, then the stretch's final.
 *
 * @param stretches each stretch's id and its fragments, in order
 * @returns the record
 */
function spoken({
  stretches,
}: {
  stretches: readonly { readonly id: string; readonly pieces: readonly string[] }[];
}): readonly GateEntry[] {
  return stretches.flatMap(({ id, pieces }): GateEntry[] => [
    ...pieces.flatMap((text): GateEntry[] => [
      { kind: "heard", text },
      { final: false, grew: text, id, kind: "speech-segment" },
    ]),
    { final: true, id, kind: "speech-segment" },
  ]);
}

/** A long stretch that asks for triage after its first fragment, then runs on past the window, as deltas. */
const ASK_THEN_RUN_ON = [
  " triage mode for this session. Let's start triage",
  ". The first card should go back to its session with a note asking it to",
  " list every step it still has to take",
  " first. Also why",
  " the change matters, what it would affect",
  " and what stopped it from shipping last week",
  ", because the card does not explain any of that yet, so I cannot judge it",
];

describe("heardTriageAsked", () => {
  it("refuses words that asked for the next card and never named triage", () => {
    const log = heard({
      texts: [
        " Hi, I'm back",
        " Okay, where were we. I'm not sure what's left, so could you bring up the next cue card",
      ],
    });
    expect(heardTriageAsked({ log })).toBe(false);
  });

  it("refuses a correction that names triage only to say it is off", () => {
    const log = heard({
      texts: [" Wait a second, I really didn't turn on triage mode. And we are not in triage mode at the moment"],
    });
    expect(heardTriageAsked({ log })).toBe(false);
  });

  it("asks on the owner's own words for starting a pass", () => {
    const asks = [
      " Yo, it's triaging time",
      " Okay, let's triage",
      " no worries, let's triage my queue",
      " can we triage?",
      " turn on triage mode",
      " let's do some triage",
      " start triaging",
      " triage mode on",
      " Let’s triage",
    ].map((text) => heardTriageAsked({ log: heard({ texts: [" Hey there.", text] }) }));
    expect(asks).toEqual([true, true, true, true, true, true, true, true, true]);
  });

  it("refuses a triage word the owner says about something else, which is no ask", () => {
    const refusals = [
      " Is that a triage card?",
      " how do triage cards work",
      " the triage pass yesterday was useful",
      " triage",
      " let's triage. Wait, is that a triage card?",
      " Yesterday's triage time was useful.",
      " I triage my queue on Mondays",
      " the triage mode on my phone",
    ].map((text) => heardTriageAsked({ log: heard({ texts: [text] }) }));
    expect(refusals).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("refuses a triage word turned off by what is around it", () => {
    const refusals = [
      " stop triaging",
      " no triage today",
      " triage mode off",
      " let's not triage",
      " triage mode is off",
      " triage isn't on",
    ].map((text) => heardTriageAsked({ log: heard({ texts: [text] }) }));
    expect(refusals).toEqual([false, false, false, false, false, false]);
  });

  it("lets the owner's last mention decide, so a take-back refuses", () => {
    const log = heard({ texts: [" let's triage.", " Actually no, not triage, just show me the next card"] });
    expect(heardTriageAsked({ log })).toBe(false);
  });

  it("refuses an ask that has scrolled out of the owner's newest words, and is empty-safe", () => {
    const later = ` ${"and then some other talk about the build ".repeat(Math.ceil(TRIAGE_ASK_WINDOW / 40))}`;
    const old = heardTriageAsked({ log: heard({ texts: [" let's triage", later] }) });
    const fresh = heardTriageAsked({ log: heard({ texts: [later, " let's triage"] }) });
    expect([old, fresh, heardTriageAsked({ log: [] })]).toEqual([false, true, false]);
  });

  it("asks on a stretch where the owner kept talking about 280 characters after asking", () => {
    const log = spoken({
      stretches: [{ id: "a", pieces: [" Okay, here is the plan. Let's turn on", ...ASK_THEN_RUN_ON] }],
    });
    expect(heardTriageAsked({ log })).toBe(true);
  });

  it("refuses that same ask once a newer stretch of theirs has begun, however briefly an older one grew after it", () => {
    const old = { id: "old", pieces: [" Let's start triage", ...ASK_THEN_RUN_ON.slice(1)] };
    const alone = spoken({ stretches: [old] });
    const newer = spoken({ stretches: [old, { id: "new", pieces: [" Right, and one more thing."] }] });
    // The older stretch's delayed delta lands after the newer one opened (`heardTailOf`'s ordering caveat).
    const lateDelta: readonly GateEntry[] = [
      ...newer,
      { kind: "heard", text: " right now" },
      { final: false, grew: " right now", id: "old", kind: "speech-segment" },
    ];
    // A newer fragment heard before its stretch opens, so the older stretch is still the last one opened.
    const unopened: readonly GateEntry[] = [...alone, { kind: "heard", text: " New utterance" }];
    // A typed turn repeating the stretch word for word is not the stretch.
    const typedRepeat: readonly GateEntry[] = [...alone, { kind: "heard", text: old.pieces.join(""), typed: true }];
    // A mention straddling the stretch's first word is not inside it.
    const tail = `age ${"x".repeat(250)}`;
    const straddling: readonly GateEntry[] = [
      { kind: "heard", text: " Let's tri" },
      { kind: "heard", text: tail },
      { final: false, grew: tail, id: "new", kind: "speech-segment" },
    ];
    // A spoken fragment repeating the closed stretch word for word, heard before its own stretch opens:
    // no later step of the old stretch vouches for it, with or without the audio each covers.
    const words = ` Let us start triage ${"x".repeat(300)}`;
    const first = { endMs: 1000, startMs: 0 };
    const spokenRepeat: readonly GateEntry[] = [
      { kind: "heard", span: first, text: words },
      { final: false, grew: words, id: "old", kind: "speech-segment", span: first },
      { final: true, id: "old", kind: "speech-segment" },
      { kind: "heard", span: { endMs: 3000, startMs: 2000 }, text: words },
    ];
    const unspannedRepeat: readonly GateEntry[] = [
      { kind: "heard", text: words },
      { final: false, grew: words, id: "old", kind: "speech-segment" },
      { final: true, id: "old", kind: "speech-segment" },
      { kind: "heard", text: words },
    ];
    const logs = [alone, newer, lateDelta, unopened, typedRepeat, straddling, spokenRepeat, unspannedRepeat];
    expect(logs.map((log) => heardTriageAsked({ log }))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("keeps the stretch's last mention deciding, and a typed turn or a rewritten stretch to the 240 characters", () => {
    const takenBack = spoken({
      stretches: [
        { id: "a", pieces: [" Let's start triage", ...ASK_THEN_RUN_ON.slice(1), ". Actually no, not triage"] },
      ],
    });
    const typed: readonly GateEntry[] = [
      { kind: "heard", text: [" Let's start triage", ...ASK_THEN_RUN_ON.slice(1)].join(""), typed: true },
    ];
    // The stretch is rewritten after the ask, so only what grew after the rewrite is known of it.
    const rewritten: readonly GateEntry[] = [
      { kind: "heard", text: " Let's start triage" },
      { final: false, grew: " Let's start triage", id: "a", kind: "speech-segment" },
      { final: false, id: "a", kind: "speech-segment" },
      ...ASK_THEN_RUN_ON.slice(1).flatMap((text): GateEntry[] => [
        { kind: "heard", text },
        { final: false, grew: text, id: "a", kind: "speech-segment" },
      ]),
    ];
    const verdicts = [takenBack, typed, rewritten].map((log) => heardTriageAsked({ log }));
    expect(verdicts).toEqual([false, false, false]);
  });

  it("asks on the menu bar's Start triage and Resume timer presses, typed into the call as the owner's turn, never Pause or Off", () => {
    const presses = (["start", "resume", "pause", "off"] as const).map((command) =>
      heardTriageAsked({ log: heard({ texts: [TRIAGE_COMMAND_WORDS[command]] }) }),
    );
    expect(presses).toEqual([true, true, false, false]);
  });

  it("reads only what the owner said, never a read or a relay beside it", () => {
    const log: readonly GateEntry[] = [{ kind: "read", tool: "triage: let's triage" }, { kind: "relayed" }];
    expect(heardTriageAsked({ log })).toBe(false);
  });
});
