import { describe, expect, it } from "vitest";

import { type E2eCallObserved, judgeCallScenario } from "../../../desktop/e2eCallOutcome.js";
import { callRequirementsOf } from "../../../desktop/e2eCallRequirements.js";
import { firstVoiceFinal, greetingFaults } from "../../../desktop/e2eGreetingJudge.js";
import type { CallSegment } from "../../../talk/callRecord.js";
import { CLEAN } from "./e2eCallObservedFixture.js";

/** The first final voice segment of a measured call that a greeting judge once passed wrongly, verbatim. */
const MEASURED_4_NOV =
  "Hey. I'm ChatGPT. I can talk through ideas, help write or plan things, or even work with what's on your screen. " +
  "What do you wanna tackle?";

/** A measured call's opening, verbatim from `src/talk/colleagueGreetingLines.ts`. */
const MEASURED_2_NOV =
  "Hi there. I'm ChatGPT. You can talk things through with me, work with what's on your screen, research stuff, " +
  "write, plan, whatever helps. What should we tackle?";

const segment = (over: Partial<CallSegment> & Pick<CallSegment, "id" | "who" | "text" | "final">): CallSegment => ({
  atIso: "2026-11-04T06:56:10.478Z",
  beganIso: "2026-11-04T06:56:00.976Z",
  open: undefined,
  ...over,
});

describe("greetingFaults", () => {
  it("names every fault in the first measured opening, with the words that tripped each", () => {
    expect(greetingFaults({ text: MEASURED_4_NOV })).toEqual([
      { kind: "product-name", words: "ChatGPT" },
      { kind: "self-introduction", words: "I'm ChatGPT" },
      { kind: "capability-list", words: "I can talk" },
      { kind: "long-opening", words: "26 words" },
    ]);
  });

  it("names every fault in the second measured opening, its list said as what the owner can do with it", () => {
    expect(greetingFaults({ text: MEASURED_2_NOV })).toEqual([
      { kind: "product-name", words: "ChatGPT" },
      { kind: "self-introduction", words: "I'm ChatGPT" },
      { kind: "capability-list", words: "You can talk things through with me" },
      { kind: "long-opening", words: "27 words" },
    ]);
  });

  it("names an enumeration as a capability list whatever introduces it, and not a comma in a greeting", () => {
    expect(
      [
        "Hey. I help with research, writing, and planning.",
        "One, two, three and four.",
        "Hey, Ada. Morning, all.",
        "Hey, Ada, what's up?",
        "Hey, Ada, Rosa here.",
        "Morning, you and the team good?",
        "Research, writing and planning.",
        "Research, writing, AND planning.",
      ].map((text) => greetingFaults({ text })),
    ).toEqual([
      [{ kind: "capability-list", words: "I help with research, writing, and planning" }],
      [{ kind: "capability-list", words: "One, two, three and four" }],
      [],
      [],
      [],
      [],
      [],
      [{ kind: "capability-list", words: "Research, writing, AND planning" }],
    ]);
  });

  it("names an opening past a few words, at 13 and not at 12", () => {
    expect([
      greetingFaults({ text: "one two three four five six seven eight nine ten eleven twelve" }),
      greetingFaults({ text: "one two three four five six seven eight nine ten eleven twelve thirteen" }),
    ]).toEqual([[], [{ kind: "long-opening", words: "13 words" }]]);
  });

  it("passes what the greeting lines ask for: a greeting back, and the line check's answer", () => {
    expect(
      [
        "Hey.",
        "Morning, what's up?",
        "Hey, good to hear you.",
        "Yep, I'm here.",
        "I'm good, you?",
        "Yep, I can hear you.",
        "Hey, I can see you.",
        "Hey—what are we diving into today?",
      ].map((text) => greetingFaults({ text })),
    ).toEqual([[], [], [], [], [], [], [], []]);
  });

  it("names an offer of help as a capability list", () => {
    expect(
      ["Hey! I'm here to help.", "Here to help.", "Hey! I’m here to help.", "Yep, I’m here."].map((text) =>
        greetingFaults({ text }),
      ),
    ).toEqual([
      [{ kind: "capability-list", words: "I'm here to help" }],
      [{ kind: "capability-list", words: "Here to help" }],
      [{ kind: "capability-list", words: "I’m here to help" }],
      [],
    ]);
  });

  it("names a capability whatever its verb, the counterexample a verb allowlist passed", () => {
    expect(
      [
        "Hey! I can summarize documents, translate text, and generate code.",
        "Hi, you can brainstorm with me.",
        "I can écrire.",
        "You can réfléchir à voix haute with me.",
        "I can  write.",
        "Hi, my\tname is Sol.",
        "You can co-write plans with me.",
        "I can co-write.",
      ].map((text) => greetingFaults({ text })),
    ).toEqual([
      [{ kind: "capability-list", words: "I can summarize" }],
      [{ kind: "capability-list", words: "you can brainstorm with me" }],
      [{ kind: "capability-list", words: "I can écrire" }],
      [{ kind: "capability-list", words: "You can réfléchir à voix haute with me" }],
      [{ kind: "capability-list", words: "I can write" }],
      [{ kind: "self-introduction", words: "my name is" }],
      [{ kind: "capability-list", words: "You can co-write plans with me" }],
      [{ kind: "capability-list", words: "I can co-write" }],
    ]);
  });

  it("names a self-introduction with no product name in it", () => {
    expect(
      [
        "Hi, I'm your assistant.",
        "Hello! I'm an AI.",
        "Hey, my name is Sol.",
        "Hi, I'm Juniper.",
        "Hi, I am Éva.",
        "Hi, I'm ǅuro.",
        "Hi, I’m your assistant.",
        "Hey, I’m Sol.",
        "Hi, my name’s Sol.",
        "I'm Okay Yılmaz.",
        "I'm Okay, you?",
        "I'm the assistant.",
        "Hey, I'm just a bot.",
        "I'm your friendly AI.",
        "I'm your‐friendly assistant.",
        "Hi, this is Sol.",
        "This is your assistant.",
        "Hey, this is fun.",
        "Hi, I'm a friendly, virtual assistant.",
        "I'm your 24/7 assistant.",
      ].map((text) => greetingFaults({ text })),
    ).toEqual([
      [{ kind: "self-introduction", words: "I'm your assistant" }],
      [{ kind: "self-introduction", words: "I'm an AI" }],
      [{ kind: "self-introduction", words: "my name is" }],
      [{ kind: "self-introduction", words: "I'm Juniper" }],
      [{ kind: "self-introduction", words: "I am Éva" }],
      [{ kind: "self-introduction", words: "I'm ǅuro" }],
      [{ kind: "self-introduction", words: "I’m your assistant" }],
      [{ kind: "self-introduction", words: "I’m Sol" }],
      [{ kind: "self-introduction", words: "my name’s" }],
      [{ kind: "self-introduction", words: "I'm Okay" }],
      [],
      [{ kind: "self-introduction", words: "I'm the assistant" }],
      [{ kind: "self-introduction", words: "I'm just a bot" }],
      [{ kind: "self-introduction", words: "I'm your friendly AI" }],
      [{ kind: "self-introduction", words: "I'm your‐friendly assistant" }],
      [{ kind: "self-introduction", words: "this is Sol" }],
      [{ kind: "self-introduction", words: "This is your assistant" }],
      [],
      [{ kind: "self-introduction", words: "I'm a friendly, virtual assistant" }],
      [{ kind: "self-introduction", words: "I'm your 24/7 assistant" }],
    ]);
  });

  it("names a provider or product name said alone, any case, and not a word merely containing one", () => {
    expect(
      [
        "Hey, OpenAI here.",
        "hi, chat gpt speaking",
        "Hey, Slopweaver here.",
        "Hey, it's GPT-6.",
        "Hey, it's gpt-4.1o.",
        "Hey, it's gpt4٣.",
        "Hey, egypt.",
        "éChatGPT",
        "Hey, ChatGPTé.",
        "Salut, éI'm an AI.",
      ].map((text) => greetingFaults({ text }).map((fault) => fault.words)),
    ).toEqual([["OpenAI"], ["chat gpt"], ["Slopweaver"], ["GPT-6"], ["gpt-4.1o"], ["gpt4٣"], [], [], [], []]);
  });
});

describe("firstVoiceFinal", () => {
  it("takes the first FINAL voice segment, skipping the owner's and a dropped one", () => {
    const segments = [
      segment({ final: true, id: "a", text: "Hello", who: "owner" }),
      segment({ final: false, id: "b", text: " Hey. I'm", who: "voice" }),
      segment({ final: true, id: "c", text: ` ${MEASURED_4_NOV}`, who: "voice" }),
      segment({ final: true, id: "d", text: " Later.", who: "voice" }),
    ];
    expect(firstVoiceFinal({ call: { segments } })).toBe(MEASURED_4_NOV);
  });

  it("is undefined when the voice finished nothing", () => {
    const segments = [segment({ final: true, id: "a", text: "Hello", who: "owner" })];
    expect(firstVoiceFinal({ call: { segments } })).toBe(undefined);
  });
});

describe("judgeCallScenario's greeting check", () => {
  const opened = ({ text }: { text: string | undefined }): E2eCallObserved => ({
    ...CLEAN,
    evidence: {
      ...CLEAN.evidence,
      openings: [{ callId: "cea0ef06", faults: text === undefined ? [] : greetingFaults({ text }), text }],
    },
  });

  it("judges the opening on call-live only", () => {
    expect([
      callRequirementsOf({ id: "call-live" }).greeting,
      callRequirementsOf({ id: "relaunch" }).greeting,
      judgeCallScenario({ id: "relaunch", observed: opened({ text: MEASURED_4_NOV }) }),
    ]).toEqual([true, false, { passed: true }]);
  });

  it("FAILS the run that wrongly reported PASS, naming each fault", () => {
    expect(judgeCallScenario({ id: "call-live", observed: opened({ text: MEASURED_4_NOV }) })).toEqual({
      detail:
        `the voice opened call cea0ef06 with "${MEASURED_4_NOV}": product-name "ChatGPT", ` +
        `self-introduction "I'm ChatGPT", capability-list "I can talk", long-opening "26 words"`,
      kind: "self-introduced",
      passed: false,
    });
  });

  it("passes a greeting back", () => {
    expect(judgeCallScenario({ id: "call-live", observed: opened({ text: "Hey." }) })).toEqual({ passed: true });
  });

  it("never passes a call with no opening to judge", () => {
    const masked: E2eCallObserved = {
      ...CLEAN,
      evidence: {
        ...CLEAN.evidence,
        openings: [
          { callId: "t1", faults: [], text: "Hey." },
          { callId: "t2", faults: [], text: undefined },
        ],
      },
    };
    expect([
      judgeCallScenario({ id: "call-live", observed: opened({ text: undefined }) }),
      judgeCallScenario({ id: "call-live", observed: { ...CLEAN, evidence: { ...CLEAN.evidence, openings: [] } } }),
      judgeCallScenario({ id: "call-live", observed: masked }),
    ]).toEqual([
      { detail: "call cea0ef06 holds no final voice segment to judge", kind: "evidence-missing", passed: false },
      {
        detail: "no call of this scenario holds a final voice segment to judge",
        kind: "evidence-missing",
        passed: false,
      },
      { detail: "call t2 holds no final voice segment to judge", kind: "evidence-missing", passed: false },
    ]);
  });

  it("names a missing answer before the opening", () => {
    expect(
      judgeCallScenario({ id: "call-live", observed: { ...opened({ text: MEASURED_4_NOV }), voiceAnswer: false } }),
    ).toEqual({ detail: "no final voice row followed the owner's", kind: "answer-missing", passed: false });
  });
});
