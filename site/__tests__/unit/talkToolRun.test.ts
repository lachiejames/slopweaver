/*
 * What one tool call hands the relay gate: every relay answer carries the relay verb's own text back to the model —
 * its delivery detail when it went out, its failure when not — so it counts as a read (Codex review r3, rounds 21-22).
 */
import { describe, expect, it } from "vitest";

import { openCardsSettingNote } from "../../components/voice/openCardsSettingNote";
import { runTalkTool } from "../../components/voice/talkToolRun";
import {
  relayOutwardOf,
  type StageSettingChange,
  stageSettingChangeOf,
  triageRulingOf,
} from "../../components/voice/talkToolRunArgs";
import { lookSurfaceOf, NATIVE_SURFACE } from "../../components/voice/talkToolRunScreen";
import type { ToolSeams } from "../../components/voice/talkToolRunTypes";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import { FRESH_WALK } from "../../lib/cardWalk";
import type { QueueRow } from "../../lib/queueRows";
import type { GateEntry } from "../../lib/relayGate";
import { TriageTurnFronts } from "../../lib/triageTurnFronts";
import { markTriageOpened, nextTriageCard, startTriageWalk } from "../../lib/triageWalk";
import { stopTriageWalk } from "../../lib/triageWalkClock";
import type { TriageFront, TriageWalk, TriageWalkRow } from "../../lib/triageWalkTypes";
import { FIXTURE_SELF_REPOSITORY } from "../organisationFixture";
import { seams, TOKEN } from "../talkToolSeams";
import { TRIAGE_ROW, triageSeams } from "../triageToolSeams";

/** A relay whose answer the page never heard begin. */
const UNSEEN = { seen: false } as const satisfies TriageFront;

describe("lookSurfaceOf", () => {
  it("names the owner's open share first, since a look reads it before the desktop app's own", () => {
    expect(lookSurfaceOf({ native: true, sharing: "Entire screen" })).toBe("Entire screen");
  });

  it("names the desktop app's whole-screen look with no share, and nothing when there is no way to see", () => {
    expect(lookSurfaceOf({ native: true, sharing: undefined })).toBe(NATIVE_SURFACE);
    expect(lookSurfaceOf({ native: false, sharing: undefined })).toBeUndefined();
  });
});

describe("runTalkTool — focus_screen", () => {
  it("hands the page's answer back as no read, lifted or refused, with the arguments it was called with", async () => {
    const asked: Record<string, unknown>[] = [];
    const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
    const outcomes = [
      { answer: { shown: "lifted" }, detail: "200×40 at 10,20", refused: false },
      { answer: { refused: "the owner has not asked to be shown" }, detail: "not asked", refused: true },
    ];
    const ran = [];
    for (const outcome of outcomes) {
      ran.push(
        await runTalkTool({
          answerId: undefined,
          requestId: TOKEN,
          name: "focus_screen",
          rawArguments: JSON.stringify({ height: 40, width: 200, x: 10, y: 20 }),
          seams: {
            ...base,
            screenFocus: async ({ args }) => {
              asked.push(args);
              return outcome;
            },
          },
        }),
      );
    }
    expect(asked).toEqual([
      { height: 40, width: 200, x: 10, y: 20 },
      { height: 40, width: 200, x: 10, y: 20 },
    ]);
    expect(ran.map((each) => [each.answer, each.refused, each.readText, each.image])).toEqual([
      [{ shown: "lifted" }, false, false, undefined],
      [{ refused: "the owner has not asked to be shown" }, true, false, undefined],
    ]);
  });
});

describe("runTalkTool — meeting_skip", () => {
  it("holds the meeting on the owner's word and answers as no read, held or refused", async () => {
    const written: unknown[] = [];
    const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
    const meetingSkip = ({ heard }: { heard: string | undefined }): ToolSeams["meetingSkip"] => ({
      heard: () => heard,
      nowMs: () => 1_000,
      read: () => [],
      write: ({ skips }) => {
        written.push(skips);
      },
    });
    const rawArguments = JSON.stringify({
      meetings: [{ calendarId: "primary", eventId: "retro_1", title: "Fixture team retro" }],
    });
    const held = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "meeting_skip",
      rawArguments,
      seams: { ...base, meetingSkip: meetingSkip({ heard: "I already had the retro" }) },
    });
    const refused = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "meeting_skip",
      rawArguments,
      seams: { ...base, meetingSkip: meetingSkip({ heard: undefined }) },
    });
    expect([held, refused].map((each) => [each.detail, each.refused, each.readText, each.image])).toEqual([
      ["skipped: Fixture team retro", false, false, undefined],
      [
        "the owner has said nothing on this call yet: a meeting is only skipped on their own words",
        true,
        false,
        undefined,
      ],
    ]);
    expect(written).toEqual([
      [{ calendarId: "primary", eventId: "retro_1", saidAtMs: 1_000, title: "Fixture team retro" }],
    ]);
  });
});

describe("runTalkTool — offer_copy", () => {
  it("hands the running list the arguments as called with the call's token, awaits it, and answers as no read, added or refused", async () => {
    const asked: { args: Record<string, unknown>; requestId: string }[] = [];
    const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
    const voiceRefusal =
      'text matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.';
    const outcomes = [
      {
        answer: { added: true, where: "the owner's running list, at the bottom" },
        detail: "added to the list",
        refused: false,
      },
      { answer: { refused: "text must be the message" }, detail: "not a message to copy", refused: true },
      { answer: { refused: voiceRefusal }, detail: "voice rule refused", refused: true },
    ];
    const ran = [];
    for (const [index, outcome] of outcomes.entries()) {
      ran.push(
        await runTalkTool({
          answerId: undefined,
          name: "offer_copy",
          rawArguments: JSON.stringify({ label: "reply", text: "*on it* — <https://example.com|the PR>" }),
          requestId: `call-token.${String(index)}`,
          seams: {
            ...base,
            offerCopy: async ({ args, requestId }) => {
              // Settled a tick later, so an answer read before the seam settles would not carry its outcome.
              await Promise.resolve();
              asked.push({ args, requestId });
              return outcome;
            },
          },
        }),
      );
    }
    expect(asked).toEqual([
      { args: { label: "reply", text: "*on it* — <https://example.com|the PR>" }, requestId: "call-token.0" },
      { args: { label: "reply", text: "*on it* — <https://example.com|the PR>" }, requestId: "call-token.1" },
      { args: { label: "reply", text: "*on it* — <https://example.com|the PR>" }, requestId: "call-token.2" },
    ]);
    expect(ran.map((each) => [each.answer, each.detail, each.refused, each.readText, each.image])).toEqual([
      [{ added: true, where: "the owner's running list, at the bottom" }, "added to the list", false, false, undefined],
      [{ refused: "text must be the message" }, "not a message to copy", true, false, undefined],
      [{ refused: voiceRefusal }, "voice rule refused", true, false, undefined],
    ]);
  });

  it("answers a seam that rejects as a refusal naming why, counted as a read", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      name: "offer_copy",
      rawArguments: JSON.stringify({ text: "on it" }),
      requestId: TOKEN,
      seams: {
        ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
        offerCopy: async () => {
          throw new Error("the list route answered 500");
        },
      },
    });
    expect([ran.refused, ran.readText, ran.answer]).toEqual([
      true,
      true,
      { refused: "offer_copy failed: the list route answered 500" },
    ]);
  });
});

describe("runTalkTool — running_list", () => {
  it("reads the list through the verb tool with no arguments, and counts it as a read", async () => {
    const asked: { args: Record<string, unknown>; name: string }[] = [];
    const listed = { answer: { items: [], newestSeq: 0 }, detail: "slopweaver talk list", refused: false };
    const ran = await runTalkTool({
      answerId: undefined,
      name: "running_list",
      rawArguments: "{}",
      requestId: TOKEN,
      seams: {
        ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
        verb: async ({ args, name }) => {
          asked.push({ args, name });
          return listed;
        },
      },
    });
    expect(asked).toEqual([{ args: {}, name: "running_list" }]);
    expect(ran).toEqual({ ...listed, image: undefined, partialFailures: [], readText: true });
  });
});

describe("runTalkTool — set_stage_setting", () => {
  /**
   * Seams recording every switch the call flips.
   *
   * @returns the seams and what they were asked
   */
  function recordingSeams({ heard = [] }: { heard?: readonly string[] } = {}): {
    readonly seams: ToolSeams;
    readonly flipped: StageSettingChange[];
  } {
    const flipped: StageSettingChange[] = [];
    const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
    return {
      flipped,
      seams: {
        ...base,
        gateLog: () => heard.map((text) => ({ kind: "heard", text }) as const),
        stageSetting: (change) => {
          flipped.push(change);
        },
      },
    };
  }

  it("flips the switch the owner named once, and hands the model no third-party text", async () => {
    const { seams: recording, flipped } = recordingSeams();
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "previews", state: "off" }),
      seams: recording,
    });
    expect(flipped).toEqual([{ setting: "previews", state: "off" }]);
    expect([ran.answer, ran.detail, ran.readText, ran.refused]).toEqual([
      { applies: "now", setting: "previews", state: "off" },
      "previews off",
      false,
      false,
    ]);
  });

  it("refuses a setting or state the stage does not have before any switch moves", async () => {
    const { seams: recording, flipped } = recordingSeams();
    const unknown = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "sounds", state: "off" }),
      seams: recording,
    });
    const sideways = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "activity", state: "dim" }),
      seams: recording,
    });
    expect(flipped).toEqual([]);
    expect([unknown.refused, unknown.readText, unknown.detail]).toEqual([true, false, "not a stage setting"]);
    expect(sideways.answer).toEqual({
      refused: "setting must be one of activity, previews, openCards, and state on or off",
    });
  });

  it("turns the owner's openCards switch off when they asked for cards in general, and says browser reads still open tabs", async () => {
    const { seams: recording, flipped } = recordingSeams({
      heard: [" Stop opening", " cards, I'll pull them up myself."],
    });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "openCards", state: "off" }),
      seams: recording,
    });
    expect(flipped).toEqual([{ setting: "openCards", state: "off" }]);
    expect(ran.answer).toEqual({
      applies: "now",
      note: "open_card opens nothing now, and never browser_open a card's links instead; browser reads still open tabs in the owner's Chrome while they read",
      setting: "openCards",
      state: "off",
    });
  });

  // A complaint about one thread turns the switch off for the next call too.
  it("refuses openCards off for a complaint about the thread in hand, and moves no switch", async () => {
    const { seams: recording, flipped } = recordingSeams({
      heard: [" Hey, I've already got the Slack thread in front of me, stop trying to open it"],
    });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "openCards", state: "off" }),
      seams: recording,
    });
    expect(flipped).toEqual([]);
    expect([ran.answer, ran.detail, ran.readText, ran.refused]).toEqual([
      {
        refused:
          "The owner's words were about the card, page or thread in hand, not cards in general, so the openCards switch stays on. " +
          "Skip just that card: do not open its page or thread again, and use read_card if you still need what it says.",
      },
      "openCards off refused: the owner's words named one card",
      false,
      true,
    ]);
  });

  // The switch goes on, the voice said the PR should be open now, and nothing had opened.
  it("turns the owner's openCards switch on and says nothing has opened yet", async () => {
    const { seams: recording, flipped } = recordingSeams();
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "set_stage_setting",
      rawArguments: JSON.stringify({ setting: "openCards", state: "on" }),
      seams: recording,
    });
    expect(flipped).toEqual([{ setting: "openCards", state: "on" }]);
    expect([ran.answer, ran.detail, ran.readText, ran.refused]).toEqual([
      {
        applies: "now",
        note: "nothing has opened yet; the card the call is on opens only if open_card's own rules would open it and you call open_card now",
        setting: "openCards",
        state: "on",
      },
      "openCards on",
      false,
      false,
    ]);
  });
});

describe("openCardsSettingNote", () => {
  it("names what each flip did not do", () => {
    expect([openCardsSettingNote({ state: "on" }), openCardsSettingNote({ state: "off" })]).toEqual([
      "nothing has opened yet; the card the call is on opens only if open_card's own rules would open it and you call open_card now",
      "open_card opens nothing now, and never browser_open a card's links instead; browser reads still open tabs in the owner's Chrome while they read",
    ]);
  });
});

describe("runTalkTool — read_card", () => {
  it("dispatches to the card reader, reaching the rows and nothing that moves the owner's screen", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "read_card",
      rawArguments: JSON.stringify({ key: "hand:gone" }),
      seams: {
        ...seams({ relayed: { answer: undefined, detail: "", refused: false } }),
        cards: () => ({
          alignment: NO_ALIGNMENT_CARDS,
          focuses: [],
          fromPath: "/queue",
          recentlyLeft: [],
          rows: [],
          unread: [],
        }),
      },
    });
    expect([ran.answer, ran.refused, ran.readText, ran.detail, ran.image]).toEqual([
      { refused: "no card on the owner's Queue or Alignment page, nor recently off it, answers to hand:gone" },
      true,
      false,
      "hand:gone not found",
      undefined,
    ]);
  });
});

describe("runTalkTool — open_card", () => {
  it("dispatches to the card opener, which refuses a blank key before anything moves", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "open_card",
      rawArguments: JSON.stringify({ key: "" }),
      seams: seams({ relayed: { answer: undefined, detail: "", refused: false } }),
    });
    expect([ran.refused, ran.readText, ran.detail, ran.image, ran.partialFailures]).toEqual([
      true,
      false,
      "no key",
      undefined,
      [],
    ]);
  });

  // A fresh call — a press, or a typed conversation's new call id — while the open was
  // in flight starts a walk and a call the open never belonged to.
  it("steps the walk only when neither the walk nor the call changed while the open was in flight", async () => {
    const writes = ["0:call-a", "1:call-a", "0:call-b"].map((after) => {
      const base = seams({ relayed: { answer: undefined, detail: "", refused: false } });
      const stamps = ["0:call-a", after];
      const written: unknown[] = [];
      const stamp = (): string => stamps.shift()!;
      const cardWalk = { ...base.cardWalk, stamp, write: ({ walk }: { walk: unknown }) => written.push(walk) };
      return runTalkTool({
        answerId: undefined,
        name: "open_card",
        rawArguments: JSON.stringify({ key: "" }),
        requestId: TOKEN,
        seams: { ...base, cardWalk },
      }).then(() => written.length);
    });
    expect(await Promise.all(writes)).toEqual([1, 0, 0]);
  });
});

// Measured: a request for the next cue card began a pass and its card clock the owner never asked for.
describe("runTalkTool — triage_next on the owner's heard words", () => {
  /**
   * Run `triage_next` with no pass on the page, over what the owner was heard saying.
   *
   * @param log the relay-gate record of what the owner was heard saying
   * @returns what it came to, and what the pass and its clock did
   */
  async function triageNextAfter({ log }: { log: readonly GateEntry[] }): Promise<{
    readonly ran: { readonly detail: string; readonly refused: boolean };
    readonly kept: { stops: number; started: number; walk: TriageWalk | undefined };
  }> {
    const { seams: held, kept } = triageSeams({ walk: undefined });
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "triage_next",
      rawArguments: "{}",
      seams: {
        ...held,
        gateLog: () => log,
        triage: { ...held.triage, mintId: () => "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c" },
      },
    });
    return { kept, ran };
  }

  /**
   * The owner's heard fragments alone, with no stretch steps beside them.
   *
   * @param texts the fragments, in order
   * @returns the record
   */
  function heardOnly({ texts }: { texts: readonly string[] }): readonly GateEntry[] {
    return texts.map((text) => ({ kind: "heard", text }) as const);
  }

  it("refuses the pass on a request for the next card, writing no pass and arming no clock", async () => {
    const { ran, kept } = await triageNextAfter({
      log: heardOnly({
        texts: [" Okay, where were we. I'm not sure what's left, so could you bring up the next cue card"],
      }),
    });
    expect([ran.refused, ran.detail, kept.walk, kept.started]).toEqual([
      true,
      "no triage pass: the owner has not asked to triage",
      undefined,
      0,
    ]);
  });

  it("begins the pass when the owner asks to triage", async () => {
    const { ran, kept } = await triageNextAfter({ log: heardOnly({ texts: [" Yo, it's triaging time"] }) });
    expect([ran.refused, ran.detail, kept.walk!.stoppedMs]).toEqual([false, "triage done, 0 of 0 seen", undefined]);
  });

  // Refusing twice, one toast each, because the owner kept talking after, is wrong.
  it("begins the pass on one long stretch, where the ask sat 282 characters from its end", async () => {
    const pieces = [
      " Okay, here is the plan. Let's turn on",
      " triage mode for this session. Let's start triage",
      ". The first card should go back to its session with a note asking it to",
      " list every step it still has to take first. Also why the change matters, what it would affect",
      " and what stopped it from shipping last week, because the card does not explain any of that yet, so I cannot judge it",
    ];
    const log: readonly GateEntry[] = [
      ...pieces.flatMap((text): GateEntry[] => [
        { kind: "heard", text },
        { final: false, grew: text, id: "turn_long_stretch", kind: "speech-segment" },
      ]),
      { final: true, id: "turn_long_stretch", kind: "speech-segment" },
    ];
    const { ran } = await triageNextAfter({ log });
    const { ran: unstepped } = await triageNextAfter({ log: heardOnly({ texts: pieces }) });
    expect([ran.refused, ran.detail, unstepped.refused]).toEqual([false, "triage done, 0 of 0 seen", true]);
  });
});

describe("stageSettingChangeOf", () => {
  it("names each of the three switches either way, and nothing else — the edge glow, which has none, included", () => {
    expect(stageSettingChangeOf({ args: { setting: "openCards", state: "on" } })).toEqual({
      setting: "openCards",
      state: "on",
    });
    expect(stageSettingChangeOf({ args: { setting: "previews", state: "off" } })).toEqual({
      setting: "previews",
      state: "off",
    });
    expect(stageSettingChangeOf({ args: { setting: "openCards" } })).toBe(undefined);
    expect(stageSettingChangeOf({ args: { setting: "edgeGlow", state: "on" } })).toBe(undefined);
    expect(stageSettingChangeOf({ args: { setting: "constructor", state: "on" } })).toBe(undefined);
  });
});

/** A plain steer's arguments: the owner's words, and no act outside the call. */
const SHIP_IT = JSON.stringify({ answers_open_card: false, outward: "none", say: "ship it" });

/** The thread a reply to Seth went to. */
const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

describe("runTalkTool — relay_steer", () => {
  it("counts an answer the gate shut as a read, as every relay answer is", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: SHIP_IT,
      seams: seams({ relayed: { answer: { unknown: "FROM SUPERVISOR: x" }, detail: "unknown", refused: true } }),
    });
    expect([ran.readText, ran.refused]).toEqual([true, true]);
  });

  it("counts a relay that threw as a read, since the throw's message is text the page did not write", async () => {
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: SHIP_IT,
      seams: {
        ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
        relay: () => {
          throw new Error("the relay seam fell over: FROM SUPERVISOR: x");
        },
      },
    });
    expect([ran.readText, ran.refused]).toEqual([true, true]);
  });

  it("hands back a hand-off exactly as the seam answered it, counted as a read", async () => {
    const handedOff = { answer: { handedOff: true }, detail: "handed off, posting in the background", refused: false };
    const ran = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: SHIP_IT,
      seams: seams({ relayed: handedOff }),
    });
    expect(ran).toEqual({ ...handedOff, image: undefined, partialFailures: [], readText: true });
  });

  // "Love it. Send it" relayed as a plain steer, and the voice said "Got it." of a send
  // nothing made. Every relay now says what it asks done outside the call, and a Slack send names its thread.
  it("hands the relay the outward act the owner's words ask for, and refuses a relay that does not say one", async () => {
    const asked: unknown[] = [];
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      relay: (input) => {
        asked.push(input);
        return { answer: {}, detail: "relayed", refused: false };
      },
    };
    const sendIt = JSON.stringify({
      answers_open_card: true,
      outward: "slack-send",
      say: "Love it. Send it",
      sends: THREAD,
    });
    await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: sendIt,
      seams: recording,
    });
    const unsaid = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: JSON.stringify({ answers_open_card: true, say: "Love it. Send it" }),
      seams: recording,
    });
    expect(asked).toEqual([
      {
        alsoAnswers: [],
        answersOpenCard: true,
        candidateRuling: undefined,
        checkIn: undefined,
        outward: { kind: "slack-send", url: THREAD },
        say: "Love it. Send it",
        triage: undefined,
      },
    ]);
    expect([unsaid.refused, unsaid.detail, unsaid.answer]).toEqual([
      true,
      "a malformed outward act",
      { refused: "outward must be none, slack-send or other-outward" },
    ]);
  });

  it("hands the relay the check-in the owner's words are a verdict on, and none when the call names none", async () => {
    const asked: unknown[] = [];
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      relay: (input) => {
        asked.push(input);
        return { answer: {}, detail: "relayed", refused: false };
      },
    };
    await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: JSON.stringify({
        answers_open_card: false,
        check_in: "act:ev-2",
        covers: "rule",
        outward: "none",
        say: "that pushback was right",
      }),
      seams: recording,
    });
    await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: SHIP_IT,
      seams: recording,
    });
    expect(asked).toEqual([
      {
        alsoAnswers: [],
        answersOpenCard: false,
        candidateRuling: undefined,
        checkIn: { covers: "rule", key: "act:ev-2" },
        outward: { kind: "none" },
        say: "that pushback was right",
        triage: undefined,
      },
      {
        alsoAnswers: [],
        answersOpenCard: false,
        candidateRuling: undefined,
        checkIn: undefined,
        outward: { kind: "none" },
        say: "ship it",
        triage: undefined,
      },
    ]);
  });

  // A ruling spoken on a candidate must reach the candidate.
  it("hands the relay the candidate the owner's words rule on, and refuses a malformed pair without relaying", async () => {
    const asked: unknown[] = [];
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      relay: (input) => {
        asked.push(input);
        return { answer: {}, detail: "relayed", refused: false };
      },
    };
    await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: JSON.stringify({
        answers_open_card: false,
        candidate: "c-105",
        outward: "none",
        reaction: "no",
        say: "not a workstream",
      }),
      seams: recording,
    });
    const refused = await runTalkTool({
      answerId: undefined,
      requestId: TOKEN,
      name: "relay_steer",
      rawArguments: JSON.stringify({
        answers_open_card: false,
        candidate: "c-105",
        outward: "none",
        say: "not a workstream",
      }),
      seams: recording,
    });
    expect(asked).toEqual([
      {
        alsoAnswers: [],
        answersOpenCard: false,
        candidateRuling: { candidate: "c-105", reaction: "no" },
        checkIn: undefined,
        outward: { kind: "none" },
        say: "not a workstream",
        triage: undefined,
      },
    ]);
    expect([refused.refused, refused.detail]).toEqual([true, "a malformed candidate ruling"]);
  });

  // The nudge is for a fix on a team repository; Slopweaver's own is never nudged.
  it("hands the relay the team fix the owner's words ask for, none for Slopweaver's own, and refuses a malformed one", async () => {
    const asked: unknown[] = [];
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      relay: (input) => {
        asked.push(input);
        return { answer: {}, detail: "relayed", refused: false };
      },
    };
    const relay = (args: Record<string, unknown>) =>
      runTalkTool({
        answerId: undefined,
        requestId: TOKEN,
        name: "relay_steer",
        rawArguments: JSON.stringify({
          answers_open_card: false,
          outward: "other-outward",
          say: "raise a fix",
          ...args,
        }),
        seams: recording,
      });
    await relay({ fix_repo: "Acme/acme-admin", fix_thread: THREAD });
    await relay({ fix_repo: FIXTURE_SELF_REPOSITORY });
    const refused = [
      await relay({ fix_thread: THREAD }),
      await relay({ fix_repo: "torvalds/linux" }),
      await relay({ fix_repo: "acme/acme-admin", fix_thread: "https://example.com/thread" }),
    ];
    expect(asked.map((input) => (input as { fix: unknown }).fix)).toEqual([
      { repository: "acme/acme-admin", thread: THREAD },
      undefined,
    ]);
    expect(refused.map((one) => [one.refused, one.detail])).toEqual([
      [true, "a malformed team fix"],
      [true, "a malformed team fix"],
      [true, "a malformed team fix"],
    ]);
  });

  // Measured: "Uh, good morning" took the open hand step off the owner's Queue.
  it("refuses a relay that does not say whether the owner's words answer the open card, and relays nothing", async () => {
    const asked: unknown[] = [];
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      relay: (input) => {
        asked.push(input);
        return { answer: {}, detail: "relayed", refused: false };
      },
    };
    const unjudged = await Promise.all(
      [{}, { answers_open_card: "yes" }].map((judged) =>
        runTalkTool({
          answerId: undefined,
          requestId: TOKEN,
          name: "relay_steer",
          rawArguments: JSON.stringify({ outward: "none", say: "good morning", ...judged }),
          seams: recording,
        }),
      ),
    );
    expect(asked).toEqual([]);
    expect(unjudged.map((one) => [one.refused, one.detail, one.answer])).toEqual(
      [0, 1].map(() => [
        true,
        "no judgement of the open card",
        {
          refused:
            "answers_open_card is required: true only when the owner's words answer the card they have open, false otherwise",
        },
      ]),
    );
  });

  // Four stale Queue cards were each answered aloud with another card open.
  it("hands the relay the other cards the owner's words answer, and refuses one the call never served them", async () => {
    const asked: unknown[] = [];
    let served: ReadonlySet<string> = new Set(["ask:split-files", "draft:abc-1"]);
    const rows = ["ask:split-files", "draft:abc-1", "ask:held-back"].map((key) => ({ key }) as QueueRow);
    const recording: ToolSeams = {
      ...seams({ relayed: { answer: {}, detail: "", refused: false } }),
      cards: () => ({
        alignment: NO_ALIGNMENT_CARDS,
        focuses: [],
        fromPath: "/queue",
        recentlyLeft: [],
        rows,
        unread: [],
      }),
      relay: (input) => {
        asked.push(input.alsoAnswers);
        return { answer: {}, detail: "relayed", refused: false };
      },
      servedCards: {
        read: () => served,
        write: ({ keys }) => {
          served = new Set(keys);
        },
      },
      view: () => ({ open: "ask:open-one", openBy: undefined, path: "/queue", shows: {}, title: "Queue" }),
    };
    const relay = (also: readonly string[] | undefined) =>
      runTalkTool({
        answerId: undefined,
        requestId: TOKEN,
        name: "relay_steer",
        rawArguments: JSON.stringify({
          answers_open_card: true,
          outward: "none",
          say: "always split oversized files",
          ...(also === undefined ? {} : { also_answers: also }),
        }),
        seams: recording,
      });
    await relay(undefined);
    await relay(["draft:abc-1", "ask:split-files"]);
    const refused = await relay(["ask:split-files", "ask:held-back"]);
    expect(asked).toEqual([[], ["draft:abc-1", "ask:split-files"]]);
    expect([refused.refused, refused.detail, refused.answer]).toEqual([
      true,
      "an also_answers card not served this call",
      {
        refused:
          "ask:held-back was neither in the action_items you last read the owner this call nor the card you put in front of them",
      },
    ]);
  });

  // The owner rules on a card from its linked report, with no card open on the page.
  it("lets the relay name the card the walk put in front of the owner once the page has left it", async () => {
    const asked: unknown[] = [];
    const rows = ["ask:final-cut", "ask:other"].map((key) => ({ key }) as QueueRow);
    const base = seams({ relayed: { answer: {}, detail: "", refused: false } });
    const recording: ToolSeams = {
      ...base,
      cardWalk: { ...base.cardWalk, read: () => ({ ...FRESH_WALK, front: "ask:final-cut" }) },
      cards: () => ({
        alignment: NO_ALIGNMENT_CARDS,
        focuses: [],
        fromPath: "/pages/final-cut-report",
        recentlyLeft: [],
        rows,
        unread: [],
      }),
      relay: (input) => {
        asked.push(input.alsoAnswers);
        return { answer: {}, detail: "relayed", refused: false };
      },
      servedCards: { read: () => new Set(), write: () => undefined },
      view: () => ({ open: undefined, openBy: undefined, path: "/pages/final-cut-report", shows: {}, title: "Report" }),
    };
    const relay = (also: readonly string[]) =>
      runTalkTool({
        answerId: undefined,
        name: "relay_steer",
        rawArguments: JSON.stringify({
          also_answers: also,
          answers_open_card: false,
          outward: "none",
          say: "I'll take the copy on the first",
        }),
        requestId: TOKEN,
        seams: recording,
      });
    const landed = await relay(["ask:final-cut"]);
    const refused = await relay(["ask:other"]);
    expect(asked).toEqual([["ask:final-cut"]]);
    expect([landed.refused, refused.refused]).toEqual([false, true]);
  });
});

// The owner's verdict on the card the triage pass has open, never on a card it does not.
describe("triageRulingOf", () => {
  const begun = startTriageWalk({
    focus: [],
    nowMs: 0,
    rows: [TRIAGE_ROW],
    walkId: "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c",
  });
  const opening = nextTriageCard({ focus: [], nowMs: 0, rows: [TRIAGE_ROW], walk: begun }).walk;
  const open = markTriageOpened({ visitId: opening.current!.visitId, walk: opening });
  const NO_CARD =
    "triage_card must be the key triage_next gave for the card in front of the owner, the one they ruled; with no such " +
    "card, relay again without triage";

  it("takes the owner's verdict with its label on the card they named, and none when the relay names none", () => {
    expect([
      triageRulingOf({
        front: UNSEEN,
        args: { label: "action-now", triage: "send-it", triage_card: "act:ev-9" },
        walk: open,
      }),
      triageRulingOf({ front: UNSEEN, args: { triage: "rewrite", triage_card: "act:ev-9" }, walk: open }),
      triageRulingOf({ front: UNSEEN, args: { say: "ship it" }, walk: undefined }),
    ]).toEqual([
      { triage: { key: "act:ev-9", ruling: { label: "action-now", verdict: "send-it" } } },
      { triage: { key: "act:ev-9", ruling: { label: undefined, verdict: "rewrite" } } },
      { triage: undefined },
    ]);
  });

  it("carries the owner's named feedback beside a verdict sending the card back, and refuses it anywhere else", () => {
    expect([
      triageRulingOf({
        front: UNSEEN,
        args: { feedback: "no-receipts", triage: "needs-more-info", triage_card: "act:ev-9" },
        walk: open,
      }),
      triageRulingOf({
        front: UNSEEN,
        args: { feedback: "no-receipts", triage: "send-it", triage_card: "act:ev-9" },
        walk: open,
      }),
      triageRulingOf({ front: UNSEEN, args: { feedback: "no-receipts", triage_card: "act:ev-9" }, walk: open }),
    ]).toEqual([
      {
        triage: { key: "act:ev-9", ruling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" } },
      },
      {
        why: "feedback names what to fix on a sent-back card, so it rides only beside needs-more-info or rewrite",
      },
      { why: "triage must be the owner's verdict on the triage card; label and feedback go only beside it" },
    ]);
  });

  it("refuses a label alone, a word not the owner's, a card the pass never showed them, and a second ruling beside it", () => {
    expect([
      triageRulingOf({ front: UNSEEN, args: { label: "action-now" }, walk: open }),
      triageRulingOf({ front: UNSEEN, args: { triage_card: "act:ev-9" }, walk: open }),
      triageRulingOf({
        front: UNSEEN,
        args: { label: "someday", triage: "send-it", triage_card: "act:ev-9" },
        walk: open,
      }),
      triageRulingOf({ front: UNSEEN, args: { triage: "send-it", triage_card: "act:ev-9" }, walk: undefined }),
      triageRulingOf({ front: UNSEEN, args: { triage: "send-it" }, walk: open }),
      triageRulingOf({ front: UNSEEN, args: { triage: "send-it", triage_card: "act:ev-1" }, walk: open }),
      triageRulingOf({ front: UNSEEN, args: { triage: "send-it", triage_card: "act:ev-9" }, walk: begun }),
      triageRulingOf({ front: UNSEEN, args: { triage: "send-it", triage_card: "act:ev-9" }, walk: opening }),
      triageRulingOf({
        front: UNSEEN,
        args: { candidate: "c-105", reaction: "no", triage: "send-it", triage_card: "act:ev-9" },
        walk: open,
      }),
    ]).toEqual([
      { why: "triage must be the owner's verdict on the triage card; label and feedback go only beside it" },
      { why: "triage must be the owner's verdict on the triage card; label and feedback go only beside it" },
      { why: "label must be one of the owner's inbox-zero labels" },
      { why: NO_CARD },
      { why: NO_CARD },
      { why: NO_CARD },
      { why: NO_CARD },
      { why: NO_CARD },
      { why: "a relay carries one ruling: triage, candidate or check_in, never two" },
    ]);
  });

  it("refuses a ruling on the card in front of the owner once triage_end has stopped the pass", () => {
    const args = { triage: "send-it", triage_card: "act:ev-9" };
    expect([
      triageRulingOf({ args, front: UNSEEN, walk: open }),
      triageRulingOf({ args, front: UNSEEN, walk: stopTriageWalk({ nowMs: 1, walk: open }) }),
    ]).toEqual([{ triage: { key: "act:ev-9", ruling: { label: undefined, verdict: "send-it" } } }, { why: NO_CARD }]);
  });

  /**
   * Relay the owner's ruling on one card through `relay_steer`, over a pass whose cards are all opened, recording clock stops.
   *
   * @param walk the pass on the page
   * @param card the card the ruling names
   * @param answerId the model's answer the relay was made in, none by default
   * @param fronts the card in front of the owner as each answer the page heard began, none by default
   * @returns the pass after it, how many times the clock was stopped, and the relay's own detail
   */
  async function relayRuling({
    walk,
    card,
    answerId = undefined,
    fronts = new TriageTurnFronts(),
  }: {
    walk: TriageWalk;
    card: string;
    answerId?: string | undefined;
    fronts?: TriageTurnFronts;
  }) {
    const kept = { detail: "", stops: 0, walk };
    const base = seams({ relayed: { answer: {}, detail: "relayed", refused: false } });
    const ran = await runTalkTool({
      answerId,
      name: "relay_steer",
      rawArguments: JSON.stringify({
        answers_open_card: true,
        label: "waiting-on-me",
        outward: "none",
        say: "needs more",
        triage: "needs-more-info",
        triage_card: card,
      }),
      requestId: TOKEN,
      seams: {
        ...base,
        triage: {
          ...base.triage,
          frontOf: ({ answerId: heard }) => fronts.frontOf({ answerId: heard }),
          read: () => kept.walk,
          stopClock: () => {
            kept.stops += 1;
          },
          write: ({ walk: next }) => {
            kept.walk = next!;
          },
        },
      },
    });
    kept.detail = ran.detail;
    return kept;
  }

  const WALK = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c";

  /**
   * A pass with two cards: `act:ev-10` in front of the owner, `act:ev-9` the card before, opened.
   *
   * @param openNow whether `act:ev-10`'s open has finished, as it has by default
   * @returns the pass
   */
  function twoCards({ openNow = true }: { openNow?: boolean } = {}): TriageWalk {
    const LATER: TriageWalkRow = { ...TRIAGE_ROW, key: "act:ev-10" };
    const rows = [TRIAGE_ROW, LATER];
    const first = startTriageWalk({ focus: [], nowMs: 0, rows, walkId: WALK });
    const one = nextTriageCard({ focus: [], nowMs: 0, rows, walk: first }).walk;
    const two = nextTriageCard({
      focus: [],
      nowMs: 0,
      rows,
      walk: markTriageOpened({ visitId: one.current!.visitId, walk: one }),
    }).walk;
    if (!openNow) {
      return two;
    }
    return markTriageOpened({ visitId: two.current!.visitId, walk: two });
  }

  /**
   * What the page heard: `answer-2` began with `act:ev-9` in front of the owner, `answer-3` with `act:ev-10`.
   *
   * @returns the fronts
   */
  function heardBegin(): TriageTurnFronts {
    const fronts = new TriageTurnFronts();
    const two = twoCards();
    fronts.started({ turnId: "answer-2", walk: { ...two, current: two.previous, previous: undefined } });
    fronts.started({ turnId: "answer-3", walk: two });
    return fronts;
  }

  // answer-4 began while act:ev-10 was still opening, so it was not yet in front of the owner.
  it("refuses a relay naming the card still opening as its answer began, after the open finishes", async () => {
    const fronts = heardBegin();
    fronts.started({ turnId: "answer-4", walk: twoCards({ openNow: false }) });
    const walk = twoCards();
    const kept = await relayRuling({ answerId: "answer-4", card: "act:ev-10", fronts, walk });
    expect([fronts.frontOf({ answerId: "answer-4" }), kept.detail, kept.walk, kept.stops]).toEqual([
      { seen: true, visitId: undefined },
      "a malformed triage ruling",
      walk,
      0,
    ]);
  });

  it("lands a relay on the card before when its answer began with that card in front of the owner, never on the current one", async () => {
    const kept = await relayRuling({ answerId: "answer-2", card: "act:ev-9", fronts: heardBegin(), walk: twoCards() });
    expect([
      kept.walk.rulings,
      kept.walk.previous!.ruled,
      kept.walk.current!.key,
      kept.walk.current!.ruled,
      kept.stops,
    ]).toEqual([
      [{ key: "act:ev-9", label: "waiting-on-me", verdict: "needs-more-info" }],
      true,
      "act:ev-10",
      false,
      0,
    ]);
  });

  // answer-2 began with act:ev-9 in front of the owner; whatever put act:ev-10 up after — this answer or one
  // running beside it — the owner's words in answer-2 were never about act:ev-10.
  it("refuses a relay naming a card put up after its answer began", async () => {
    const walk = twoCards();
    const kept = await relayRuling({ answerId: "answer-2", card: "act:ev-10", fronts: heardBegin(), walk });
    expect([kept.detail, kept.walk, kept.stops]).toEqual(["a malformed triage ruling", walk, 0]);
  });

  it("takes a relay whose answer began on the card in front of the owner on that card, and refuses it on the card before", () => {
    const walk = twoCards();
    const front = heardBegin().frontOf({ answerId: "answer-3" });
    expect([
      triageRulingOf({ args: { triage: "send-it", triage_card: "act:ev-10" }, front, walk }),
      triageRulingOf({ args: { triage: "send-it", triage_card: "act:ev-9" }, front, walk }),
    ]).toEqual([{ triage: { key: "act:ev-10", ruling: { label: undefined, verdict: "send-it" } } }, { why: NO_CARD }]);
  });

  it("refuses a relay on either of two unruled cards when the page never heard its answer begin", async () => {
    const walk = twoCards();
    const onBefore = await relayRuling({ answerId: "answer-9", card: "act:ev-9", fronts: heardBegin(), walk });
    const onNow = await relayRuling({ answerId: "answer-9", card: "act:ev-10", fronts: heardBegin(), walk });
    expect([onBefore.detail, onNow.detail, onBefore.walk, onNow.walk]).toEqual([
      "a malformed triage ruling",
      "a malformed triage ruling",
      walk,
      walk,
    ]);
  });

  it("records the owner's ruling on the pass once the relay carrying it is handed off, and stops that card's clock", async () => {
    const kept = await relayRuling({ card: "act:ev-9", walk: open });
    expect([kept.walk.rulings, kept.walk.current!.ruled, kept.stops]).toEqual([
      [{ key: "act:ev-9", label: "waiting-on-me", verdict: "needs-more-info" }],
      true,
      1,
    ]);
  });

  // The clock runs only for the card in front of the owner while they have not ruled it.
  it("leaves the clock running on the card in front of the owner when the ruling lands on the card before", async () => {
    const kept = await relayRuling({ answerId: "answer-2", card: "act:ev-9", fronts: heardBegin(), walk: twoCards() });
    expect([kept.walk.previous!.ruled, kept.walk.current!.key, kept.walk.current!.ruled, kept.stops]).toEqual([
      true,
      "act:ev-10",
      false,
      0,
    ]);
  });
});

describe("relayOutwardOf", () => {
  it("takes none and other-outward bare, and a slack-send with the Slack link of its thread", () => {
    expect([
      relayOutwardOf({ args: { outward: "none" } }),
      relayOutwardOf({ args: { outward: "other-outward" } }),
      relayOutwardOf({ args: { outward: "slack-send", sends: THREAD } }),
      relayOutwardOf({
        args: { outward: "slack-send", sends: `${THREAD}?thread_ts=1791351441.819519&cid=C0SYN000001` },
      }),
    ]).toEqual([
      { outward: { kind: "none" } },
      { outward: { kind: "other-outward" } },
      { outward: { kind: "slack-send", url: THREAD } },
      { outward: { kind: "slack-send", url: `${THREAD}?thread_ts=1791351441.819519&cid=C0SYN000001` } },
    ]);
  });

  it("refuses a missing or unknown kind, a link beside an act that is not a Slack send, and a Slack send with no real link", () => {
    const NEEDS_LINK =
      "outward: slack-send needs sends: the Slack link of the thread it goes to, read off the owner's screen or a tool, " +
      "never composed; with none, relay again with outward: other-outward";
    const NO_LINK_HERE = "sends goes only with outward: slack-send; drop it, or pass outward: slack-send";
    expect([
      relayOutwardOf({ args: {} }),
      relayOutwardOf({ args: { outward: "send" } }),
      relayOutwardOf({ args: { outward: "none", sends: THREAD } }),
      relayOutwardOf({ args: { outward: "other-outward", sends: THREAD } }),
      relayOutwardOf({ args: { outward: "slack-send" } }),
      relayOutwardOf({ args: { outward: "slack-send", sends: "the thread with Seth" } }),
      relayOutwardOf({ args: { outward: "slack-send", sends: "https://evil.example/archives/C1/p1791351441819519" } }),
    ]).toEqual([
      { why: "outward must be none, slack-send or other-outward" },
      { why: "outward must be none, slack-send or other-outward" },
      { why: NO_LINK_HERE },
      { why: NO_LINK_HERE },
      { why: NEEDS_LINK },
      { why: NEEDS_LINK },
      { why: NEEDS_LINK },
    ]);
  });
});
