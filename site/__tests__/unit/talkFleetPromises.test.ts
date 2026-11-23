/**
 * The fleet-promise check replayed over the voice's own FINAL segments, with the leading space the call record keeps,
 * and the subject matter of a line invented wherever it described a real system. Positives are every sentence the check finds over four calls' FINAL voice segments, each one
 * fleet work promised as the voice's own; the misses and negatives are lines from the same calls, each named for why
 * it stays silent. The handed answer each line of one call paraphrased:
 * `slopweaver talk fidelity --call <call-id> --json`.
 */
import { describe, expect, it } from "vitest";

import { fleetPromiseClaimsOf } from "../../lib/talkFleetPromises";

/** The offsets of every claim found in one segment. */
function startsOf({ text }: { text: string }): readonly number[] {
  return fleetPromiseClaimsOf({ text }).map((claim) => claim.start);
}

describe("fleetPromiseClaimsOf — the lines that promised fleet work as the voice's own", () => {
  it.each([
    { at: "a short acknowledgement", start: 7, text: " Okay, I'll take it from there." },
    {
      at: "the end of a long comparison",
      start: 315,
      text: " It doesn't look like option A proves that the sample service's tokens never reach the cache, just that we don't keep a spare one. The briefing needs to trace that, and measure latency, and compare caching and offline access, including what survives a restarted worker. Your final decision waits for that evidence. I'll bring that briefing back.",
    },
    {
      at: "a briefing promised on what the rules enforce",
      start: 1,
      text: " I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them. I haven't found evidence that three hundred was ever raised to a thousand. The code still contains both.",
    },
    {
      at: "a full sweep taken",
      start: 38,
      text: " Taking the full sweep you asked for. I'll come back with a clear briefing on what’s enforced, what's not, and where the gaps are.",
    },
    { at: "a request folded in", start: 7, text: " Okay, I'll fold that into the briefing request." },
    { at: "a firm requirement added", start: 9, text: " Got it, I'll make sure that goes in as a firm requirement." },
    {
      at: "a threat model written into the briefing",
      start: 7,
      text: " Okay, I’ll write that threat model comparison into the revised briefing. That finishes the storage section. What’s left looks at limiting the damage from a bad deploy of the sample app. What stands out to you there?",
    },
    {
      at: "a proposal promise, a question after it",
      start: 1,
      text: " I’ll include that in both the trial and the general proposal so you can see findings, evidence, changes, and open disputes. Do you want anything else added before I draft them?",
    },
    {
      at: "a briefing and bug list, before a call-ending line that is the call's own",
      start: 199,
      text: " I see the blank answer and screen capture errors, and the missing Fleet transcript. You want those expandable Fleet details back and similar visibility into commands and results for voice activity. I’ll carry that into the briefing and bug list. About the call, I’ll end it now.",
    },
  ])("finds the one promise at $at", ({ start, text }) => {
    expect(startsOf({ text })).toEqual([start]);
  });

  it("finds both promises of one rule statement, curly apostrophes and all, one claim per sentence", () => {
    const text =
      " I’ll treat that as a rule for all future changes too. One concept, one name everywhere; different concepts, different names. I’ll ask for that to be enforced in the fleet's briefings going forward.";
    expect(fleetPromiseClaimsOf({ text })).toEqual([
      { kind: "fleet-promise", start: 1, words: "I’ll treat that as a rule for all future changes too." },
      {
        kind: "fleet-promise",
        start: 126,
        words: "I’ll ask for that to be enforced in the fleet's briefings going forward.",
      },
    ]);
  });

  it("keeps a claim's words as the whole sentence said", () => {
    const text =
      " I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them. I haven't found evidence that three hundred was ever raised to a thousand. The code still contains both.";
    expect(fleetPromiseClaimsOf({ text })).toEqual([
      {
        kind: "fleet-promise",
        start: 1,
        words:
          "I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them.",
      },
    ]);
  });
});

describe("fleetPromiseClaimsOf — fleet promises missed on purpose, naming no deliverable", () => {
  it.each([
    {
      why: "an ack also said before a reflect-back the owner asked for",
      text: " Thanks. That gives me a solid brief.",
    },
    { why: "names nothing", text: " Understood. I'll fold that in." },
    { why: "names nothing", text: " Okay, I'll get that sorted." },
    { why: "names nothing", text: " Mm-hmm. Yeah, okay, I'll work that in." },
    { why: "names nothing", text: " I'll work through that and come back to you." },
    {
      why: "the map is named a sentence earlier; the same ack preceded a reflect-back",
      text: " That thousand-line lint limit still sits beside a separate three-hundred-line ratchet, but it also documents exceptions that let oversized files through. That's why it feels off. What would actually help now is a short map of what truly blocks violations, and who approved exceptions. I'll pull that together.",
    },
  ])("stays silent: $why — $text", ({ text }) => {
    expect(startsOf({ text })).toEqual([]);
  });
});

describe("fleetPromiseClaimsOf — lines that are the call's own work", () => {
  it.each([
    " I'll take a look.",
    " I'll check.",
    " Thanks, I'll check that.",
    " Okay, I'll grab that.",
    " On it, I'll pull up the next card.",
    " Thanks, I'll look there.",
    " I'll double-check what I actually looked at.",
    " Sure, I'll pull that together.",
    " Sure, I'll fit them together.",
    " Thanks, I'll straighten that out.",
    " Understood, I'll say it that way. The fleet produces the briefings, and I help you work through them and convey your decisions. I'll stick to that.",
  ])("stays silent on %j", (text) => {
    expect(startsOf({ text })).toEqual([]);
  });
});

describe("fleetPromiseClaimsOf — boundaries", () => {
  it("is silent when the fleet is the subject", () => {
    expect(startsOf({ text: "The fleet will produce that briefing." })).toEqual([]);
  });

  it("is silent when the seat is the subject", () => {
    expect(startsOf({ text: "The seat will carry that into the next cut." })).toEqual([]);
  });

  it("is silent on a question", () => {
    expect(startsOf({ text: "I’ll get you that briefing?" })).toEqual([]);
  });

  it("is silent on a quoted promise", () => {
    expect(startsOf({ text: "I said, “I’ll get you that briefing.”" })).toEqual([]);
  });

  it("is silent on a negated future", () => {
    expect(startsOf({ text: "I'll never write that briefing myself." })).toEqual([]);
  });

  it("is silent when a read verb takes the deliverable as its object", () => {
    expect(startsOf({ text: "I'll check the briefing." })).toEqual([]);
  });

  it("is silent on a read its verb list never named, since only a verb that makes or carries counts", () => {
    expect(startsOf({ text: "I'll inspect the report now and tell you what it says." })).toEqual([]);
  });

  it("is silent on a look said with a producing verb", () => {
    expect(
      startsOf({
        text: "I'll take a quick look at the briefing. I'll get a look at that report. I'll take a closer look at the report.",
      }),
    ).toEqual([]);
  });

  it("is silent on putting a deliverable on screen, the particle before or after its object", () => {
    expect(
      startsOf({
        text: "I'll bring up the report on screen and read it to you now. I'll bring that briefing up. I'll put the report on screen. I'll put that report up. I'll put the detailed quarterly report up. I'll bring the whole revised lint briefing up. I'll put the report on this screen. I'll put the briefing onscreen. I'll put the report on the big screen.",
      }),
    ).toEqual([]);
  });

  it("keeps a decomposed accent inside its word, so a look three words on stays a look", () => {
    expect(startsOf({ text: "I'll take a very bríef look at the report." })).toEqual([]);
  });

  it("still finds a promise whose look comes after the deliverable", () => {
    expect(startsOf({ text: "I'll get you that briefing and look at it with you." })).toEqual([0]);
  });

  it("still finds 'put up' raising a deliverable, the particle before its object", () => {
    expect(startsOf({ text: "I'll put up a PR for that." })).toEqual([0]);
  });

  it("still finds 'bring' carrying a deliverable back", () => {
    expect(startsOf({ text: "I'll bring that briefing back to you when it's updated." })).toEqual([0]);
  });

  it("finds the promise an 'and' joins after a read, said on the real app", () => {
    expect(
      startsOf({ text: " On it—I'll check the repo config and come back with a tight two-sentence briefing." }),
    ).toEqual([7]);
  });

  it("finds the promise a 'then' joins after a read", () => {
    expect(startsOf({ text: "I'll read the config, then write up the briefing." })).toEqual([0]);
  });

  it("is silent when the joined verb is a read, a look or carries nothing", () => {
    expect(
      startsOf({
        text: "I'll check the briefing and the report. I'll read the report and get back to you. I'll check the rules and take a look at the report. I'll check the config and then tell you what the briefing says.",
      }),
    ).toEqual([]);
  });

  it("is silent on a joined check or the voice's own part", () => {
    expect(
      startsOf({
        text: "I'll inspect the config and make sure it matches the report. I'll read it and work through the briefing with you. I'll read it and work carefully through the briefing with you. I'll read it and work this draft briefing through with you. I'll read it and take you through the report. I'll get you through the briefing. I'll take you carefully through the report. I'll take you all carefully through the briefing. I'll check it and make really sure the report matches.",
      }),
    ).toEqual([]);
  });

  it("is silent when the joined verb's deliverable sits in a later clause", () => {
    expect(
      startsOf({ text: "I'll check the config and get you an answer, since the fleet already has a report." }),
    ).toEqual([]);
  });

  it("still finds a deliverable taken through a process, which is a seat's work", () => {
    expect(startsOf({ text: "I'll take the briefing through review." })).toEqual([0]);
  });

  it("finds a promise joined by 'and then' once", () => {
    expect(startsOf({ text: "I'll read it and then write the briefing." })).toEqual([0]);
  });

  it("is silent when the voice asks the fleet, which names who does the work", () => {
    expect(startsOf({ text: "I'll ask the fleet for that briefing." })).toEqual([]);
  });

  it("finds a producing verb after a filler", () => {
    expect(startsOf({ text: "I'll just go and write the report." })).toEqual([0]);
  });

  it("is silent when the deliverable word is the verb", () => {
    expect(startsOf({ text: "I'll map that out." })).toEqual([]);
  });

  it("finds a curly-apostrophe promise", () => {
    expect(startsOf({ text: "I’ll get you that briefing." })).toEqual([0]);
  });

  it("finds 'I will' and 'I'm going to' too", () => {
    expect(startsOf({ text: "I will write the report. I'm going to raise a PR." })).toEqual([0, 25]);
  });

  it("finds two promises in one segment at their exact offsets", () => {
    expect(startsOf({ text: " I'll take it from there. I'll get you that briefing." })).toEqual([1, 26]);
  });

  it("finds nothing in an empty segment", () => {
    expect(startsOf({ text: "" })).toEqual([]);
  });
});
