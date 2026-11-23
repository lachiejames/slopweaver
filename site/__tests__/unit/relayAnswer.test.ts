/*
 * What the voice is handed when a relay is accepted, and what the page journals once its row is written. The
 * journal's failing case is an incident: five relays recorded `failed` while the voice said
 * the supervisor had them, so each line case carries the delivery the verb really recorded.
 */
import { describe, expect, it } from "vitest";

import { DISCUSS_FIRST_QUESTION, type DiscussFirstDecision } from "../../lib/discussFirst";
import {
  cutWhy,
  discussFirstNote,
  type HandOffRuling,
  handedOffAnswer,
  RELAY_WHY_MAX,
  type RelayOutward,
  type RelayReport,
  relayedLine,
  relayReportOf,
  SILENT_RELAY,
  SLACK_SEND_PENDING,
} from "../../lib/relayAnswer";
import { standingReads } from "../../lib/relayGate";

const FAILED_OUT = [
  "handover register: wrote talk-bdcd1d89a735",
  JSON.stringify({
    delivery: {
      atIso: "2026-09-23T23:22:09.395Z",
      detail:
        "cmux could not list workspaces: cmux control socket unavailable at /x/cmux-501.sock: the connection closed",
      kind: "failed",
    },
    ruling: null,
    slug: "talk-bdcd1d89a735",
  }),
].join("\n");

/** One report, no ruling unless a case gives one. */
const report = (over: Partial<RelayReport>): RelayReport => ({
  candidateRuling: undefined,
  deliveryDetail: undefined,
  deliveryKind: undefined,
  ruling: undefined,
  slug: undefined,
  ...over,
});

describe("relayReportOf", () => {
  it("reads the slug and delivery off the LAST JSON line, past register's own output", () => {
    expect(relayReportOf({ out: FAILED_OUT })).toEqual({
      candidateRuling: undefined,
      deliveryDetail:
        "cmux could not list workspaces: cmux control socket unavailable at /x/cmux-501.sock: the connection closed",
      deliveryKind: "failed",
      ruling: undefined,
      slug: "talk-bdcd1d89a735",
    });
  });

  it("reports every field absent when no line is a JSON object", () => {
    expect(relayReportOf({ out: "no json here\n" })).toEqual({
      candidateRuling: undefined,
      deliveryDetail: undefined,
      deliveryKind: undefined,
      ruling: undefined,
      slug: undefined,
    });
  });

  it("reads a check-in ruling the verb recorded, and one it refused", () => {
    const recorded = JSON.stringify({
      delivery: { detail: "typed", kind: "typed" },
      ruling: {
        cleared: 3,
        covers: "rule",
        kind: "push-back-on-coderabbit",
        place: "acme/acme-admin",
        recorded: true,
      },
      slug: "talk-1",
    });
    expect(relayReportOf({ out: recorded }).ruling).toEqual({
      cleared: 3,
      kind: "push-back-on-coderabbit",
      place: "acme/acme-admin",
      recorded: true,
    });
    const refused = JSON.stringify({ ruling: { recorded: false, why: "act ev-2 already carries the owner's word" } });
    expect(relayReportOf({ out: refused }).ruling).toEqual({
      recorded: false,
      why: "act ev-2 already carries the owner's word",
    });
  });

  it("reads a candidate ruling the verb wrote, and one it refused", () => {
    const recorded = JSON.stringify({
      candidateRuling: { candidate: "c-105", reaction: "no", recorded: true, written: true },
      delivery: { detail: "typed", kind: "typed" },
      slug: "talk-1",
    });
    expect(relayReportOf({ out: recorded }).candidateRuling).toEqual({
      candidate: "c-105",
      reaction: "no",
      recorded: true,
    });
    const refused = JSON.stringify({
      candidateRuling: { candidate: "c-999", reaction: "no", recorded: false, why: "no candidate has the id c-999" },
    });
    expect(relayReportOf({ out: refused }).candidateRuling).toEqual({
      candidate: "c-999",
      recorded: false,
      why: "no candidate has the id c-999",
    });
  });
});

describe("handedOffAnswer", () => {
  const HAND_OFF =
    " The owner's steer is handed to the supervisor in the background: nothing comes back to wait for, so carry on at once, " +
    "never a lookup to confirm it. If they ask whether the steer landed, recent_steers says where it went; one it does " +
    "not list yet has no known outcome, so say it may still be going through, never that it failed or landed. Never " +
    "read an id or a link aloud, never add that nothing has been done yet, and never say anything was sent, passed " +
    "along, delivered, done or handled, or that the supervisor has it. Never say whether it reached the supervisor " +
    "chat or only the board, in this answer or any later one, unless they ask whether it landed.";
  // An unclear annoyance's one question is the whole answer, so "a few words first" yields to it.
  const NO_ACT =
    " It asks for no act outside the call: answer what the owner said in a few words, then the next thing, unless the " +
    "note above makes one question the whole answer, or a card is open on their screen, where the answer ends " +
    "on their words.";
  const SINCE = "2026-10-07T05:52:56.000Z";
  const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";
  const NONE: RelayOutward = { kind: "none" };
  const NO_FIX: DiscussFirstDecision = { kind: "none" };

  // A steer that asks for no act is answered "yep, got it", then the next thing, with no one-minute delay in between.
  it("tells the voice nothing comes back to wait for, and to answer a steer that asks for no act and go on", () => {
    expect(handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: undefined, sinceIso: SINCE })).toEqual({
      handedOff: true,
      note: `${SILENT_RELAY}${HAND_OFF}${NO_ACT}`,
      performed: false,
    });
  });

  // Measured: "Love it. Send it", then "Got it." and "Yep, got it. You approved the reply to Seth" — while the as-me
  // gates held the reply. A Slack send is pending, and the voice says it will be told.
  it("has a Slack send said as pending, with the read that tells what became of it", () => {
    expect(
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: { kind: "slack-send", url: THREAD },
        ruling: undefined,
        sinceIso: SINCE,
      }),
    ).toEqual({
      checkSend: { since: SINCE, url: THREAD },
      handedOff: true,
      note:
        `${SILENT_RELAY}${HAND_OFF} The owner asked for a Slack send: say only "${SLACK_SEND_PENDING}" ` +
        "and go on. Never say it was sent, approved or done, and never 'got it' alone. You will be told only if it is " +
        "held or fails, and you tell them then; a send that goes is never said unasked. If they ask, read " +
        "slack_send_outcome with the url and since in checkSend.",
      performed: false,
    });
    expect(SLACK_SEND_PENDING).toBe("On it. I'll tell you if it doesn't go.");
  });

  it("has any other act said as pending, with no promise to report it", () => {
    expect(
      handedOffAnswer({ discussFirst: NO_FIX, outward: { kind: "other-outward" }, ruling: undefined, sinceIso: SINCE }),
    ).toEqual({
      handedOff: true,
      note:
        `${SILENT_RELAY}${HAND_OFF} The owner asked for an act outside the call: say only 'On it' and ` +
        "go on. Never say it was sent, done, merged, approved or handled, never 'got it' alone, and never promise to " +
        "tell them when it is done: nothing reports it back to you.",
      performed: false,
    });
  });

  it("never tells the voice to answer with 'got it' on any arm", () => {
    const arms: readonly RelayOutward[] = [NONE, { kind: "other-outward" }, { kind: "slack-send", url: THREAD }];
    const notes = arms.map(
      (outward) => handedOffAnswer({ discussFirst: NO_FIX, outward, ruling: undefined, sinceIso: SINCE }).note,
    );
    expect(notes.filter((note) => note.includes("('got it')"))).toEqual([]);
    expect(notes.filter((note) => note.includes("never say anything was sent, passed along, delivered"))).toEqual(
      notes,
    );
  });

  // The voice walks the owner's check-ins and goes on to the next without a push.
  it("has a check-in verdict spoken as the cards its rule covers, never a count cleared, then the next check-in", () => {
    expect([
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { covers: "rule", kind: "check-in" },
        sinceIso: SINCE,
      }).note,
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { covers: "this", kind: "check-in" },
        sinceIso: SINCE,
      }).note,
    ]).toEqual([
      // An owed question ENDS the answer — never the first alignment question and the next check-in both.
      `${SILENT_RELAY}${HAND_OFF}${NO_ACT} The owner's verdict is being recorded on every card its rule covers, in the ` +
        "background. When the note above puts a question first (an unclear annoyance's one question, or an " +
        "alignment question their words left owed), that question ends this answer and the rest waits for their " +
        "answer to the last of them. Otherwise say in a few words how many cards the rule covers, from what you " +
        "read them (never a count of cards cleared), then read them the next check-in without waiting to be asked. " +
        "If none is left, say 'that's the last one' instead.",
      `${SILENT_RELAY}${HAND_OFF}${NO_ACT} The owner's verdict is being recorded on that one card, in the background. When ` +
        "the note above puts a question first (an unclear annoyance's one question, or an alignment question their " +
        "words left owed), that question ends this answer and the rest waits for their answer to the last of them. " +
        "Otherwise read them the next check-in without waiting to be asked. If none is left, say 'that's the last " +
        "one' instead.",
    ]);
  });

  // Measured: the voice re-offered candidates the owner had already ruled on. A fresh list
  // can now be read before the post writes the ruling, so the call itself holds it ruled.
  it("has a candidate ruling counted as ruled for the rest of the call, even when a fresh list shows it open", () => {
    expect(
      handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: { kind: "candidate" }, sinceIso: SINCE }).note,
    ).toBe(
      `${SILENT_RELAY}${HAND_OFF}${NO_ACT} The owner's ruling is being written onto the candidate in the background: count it ` +
        "as ruled for the rest of this call, even if a fresh list still shows it open, and never offer it to them as " +
        "open again.",
    );
  });

  // The owner never waits on a rewrite, and the pass walks on after every call made.
  it("has a triage ruling walk on to triage_next at once, and a rewrite go on without waiting for it", () => {
    expect([
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { kind: "triage", rewrite: false },
        sinceIso: SINCE,
      }).note,
      handedOffAnswer({
        discussFirst: NO_FIX,
        outward: NONE,
        ruling: { kind: "triage", rewrite: true },
        sinceIso: SINCE,
      }).note,
    ]).toEqual([
      `${SILENT_RELAY}${HAND_OFF}${NO_ACT} The owner's triage call is on that card. Say a word or two, then call triage_next ` +
        "at once and give them the next card.",
      `${SILENT_RELAY}${HAND_OFF}${NO_ACT} The card goes to be rewritten from the owner's words in the background; the pass ` +
        "does not wait for it. Say a word or two, then call triage_next at once: it brings the card back first as soon " +
        "as it is rewritten.",
    ]);
  });

  // Measured: the voice read a row's slug aloud off a note that named it. A hand-off has no row yet.
  it("carries no row, delivery or outcome for the voice to read aloud or claim", () => {
    const told = handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: undefined, sinceIso: SINCE });
    expect(Object.keys(told).toSorted()).toEqual(["handedOff", "note", "performed"]);
    expect(told.note).not.toMatch(/talk-[0-9a-f]/u);
  });

  // Measured: a relay line naming context_pack, web_search, code_mode and collaboration was taken
  // for the voice reciting them. Whatever the voice is handed for a relay names none of them.
  it("names no read the gate records, for every ruling a hand-off carries", () => {
    const rulings: readonly (HandOffRuling | undefined)[] = [
      undefined,
      { covers: "rule", kind: "check-in" },
      { covers: "this", kind: "check-in" },
      { kind: "candidate" },
      { kind: "triage", rewrite: false },
      { kind: "triage", rewrite: true },
    ];
    const notes = rulings
      .map((ruling) => handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling, sinceIso: SINCE }).note)
      .join("\n");
    const reads = standingReads({ packed: true });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((read) => notes.includes(read))).toEqual([]);
  });

  // A nudge asking whether this was discussed first: the question is the whole answer, and nothing about the relay or
  // the next item rides it.
  it("has a relay that puts the discuss-first question answer with that question alone, and wait", () => {
    const put = (thread: string | undefined) =>
      handedOffAnswer({
        discussFirst: { kind: "put", repository: "acme/acme-admin", thread },
        outward: { kind: "other-outward" },
        ruling: undefined,
        sinceIso: SINCE,
      });
    const told = [put(undefined), put(THREAD)];
    expect(told).toEqual([
      { handedOff: true, note: discussFirstNote({ thread: false }), performed: false },
      { handedOff: true, note: discussFirstNote({ thread: true }), performed: false },
    ]);
    expect(told[0].note).toBe(
      "Say nothing about this relay. The owner asked for a fix on a team repository and nothing on this call says the team " +
        `has discussed it, so your whole answer is this, said exactly once and lightly: "Quick check. ${DISCUSS_FIRST_QUESTION}" ` +
        "Then stop and wait for the owner. Never read a link or an id aloud, never say anything was started, sent or done, and " +
        "never add the next item to this answer. The owner's answer stands either way: when the owner says go ahead, relay that with the " +
        "same fix_repo and it is not asked again; when the owner says they will raise it with the team first, relay that instead.",
    );
    // Exact, so the thread's link is proven absent from both notes without a substring test on a URL.
    expect(told[1].note).toBe(
      told[0].note.replace(
        `${DISCUSS_FIRST_QUESTION}"`,
        `${DISCUSS_FIRST_QUESTION} That thread is the place to start it."`,
      ),
    );
  });

  it("has a relay that carries the owner's answer past the question handed off as any other", () => {
    expect(
      handedOffAnswer({
        discussFirst: {
          kind: "override",
          priorTurnId: "turn-1",
          repository: "acme/acme-admin",
          thread: undefined,
        },
        outward: NONE,
        ruling: undefined,
        sinceIso: SINCE,
      }),
    ).toEqual(handedOffAnswer({ discussFirst: NO_FIX, outward: NONE, ruling: undefined, sinceIso: SINCE }));
  });
});

describe("SILENT_RELAY", () => {
  // Measured: with "answer what the owner said, OR go on to the next item", relay after relay ended on an
  // acknowledgement and the owner had to say "next" six times. Every note now carries the walk on.
  it("tells the voice to read the next item in the same answer after ANY relay, not only a check-in verdict", () => {
    expect(SILENT_RELAY).toContain("end this same answer by putting something to them");
    expect(SILENT_RELAY).toContain("the next item or question they have not answered");
    expect(SILENT_RELAY).toContain("or the current one again if they have not answered it yet.");
    expect(SILENT_RELAY).toContain("Never end on an acknowledgement while items remain");
    expect(SILENT_RELAY).toContain(
      "never on a further question about the item they just settled or on whether they are ready for the next",
    );
    expect(SILENT_RELAY).toContain("say 'that's the last one' when none do.");
    expect(SILENT_RELAY).not.toContain("or go on to the next item");
  });

  // A few alignment questions come before the owner starts reacting to a different thing. The relay note is what the
  // thinking model reads after every steer, so it carries the exception.
  it("lets a steer on what something should become take its next alignment question before the next item", () => {
    expect(SILENT_RELAY).toContain(
      "The one exception: a steer on what something should become is followed by its next alignment question, a " +
        "concrete choice they left open, before the next item",
    );
    // Every alignment answer is itself a steer, so without a cap the relay note asked a fourth question.
    // The cap is the count said, never a fixed fourth: a run the owner asked for has none, and "stop asking" holds
    // for the rest of the call.
    expect(SILENT_RELAY).not.toContain("never a fourth");
    expect(SILENT_RELAY).toContain(
      // A check-in verdict on its rule held its card count back for the questions; the last answer says it.
      "never past the count you said on one thing unless they asked for more themselves (a steer in an answer on a " +
        "different thing starts its own), and never once they said 'stop asking' or 'move on' on this call: the answer " +
        "to the last one says the card count a " +
        "check-in verdict on its rule held back, if one did, then the current item again if it is still " +
        "unanswered, else the next item.",
    );
    // "Pick A. Also, that last answer annoyed me." — the annoyance's one question comes before either.
    expect(SILENT_RELAY).toContain(
      "If the owner also said an answer annoyed them and you cannot tell why, your one question about it is this whole " +
        "answer, and the rest waits for their reply.",
    );
  });

  // Measured, a preference interview: a recap, a silent relay, then nothing until the owner asked why it had not
  // asked the next question. A run of questions is held to the same rule as a walk through items.
  it("holds a run of questions to the same rule, so a silent relay never silences the next question", () => {
    expect(SILENT_RELAY).toContain("if you are walking them through items or asking them a run of questions");
    expect(SILENT_RELAY).toContain("Silence about the relay never silences the next question.");
  });

  // Measured: a relay while the owner read a card aloud was followed by "The next rule proposes…", and the owner asked
  // whether it had listened to a word. The owner's own reading is never a walk. A steer relayed while the owner says they are still reading, or on a card just
  // opened, may not end on the walk's next card either.
  it("ends the answer on the owner's reaction, never the next section or card, while a card is the owner's", () => {
    expect(SILENT_RELAY).toContain(
      "A card open on their screen, however they read it, is not a walk: answer what they just said and stop, never its " +
        "next section, rule, question or another card until, since it opened, they rule it, ask what is next, or say " +
        "they are done with it, whatever this note says after.",
    );
    expect(SILENT_RELAY).not.toContain("section by section, is not a walk");
  });

  // The voice does not say whether the supervisor has it, nor whether it is relaying.
  it("never tells the voice to say the supervisor has it", () => {
    expect(SILENT_RELAY).not.toContain("Say only that the supervisor has it");
  });
});

describe("relayedLine", () => {
  it("journals a failed cmux hop as on the board and NOT in the chat", () => {
    expect(relayedLine({ report: relayReportOf({ out: FAILED_OUT }) })).toEqual({
      detail:
        "on the board as talk-bdcd1d89a735, NOT in the supervisor's chat: cmux could not list workspaces: cmux " +
        "control socket unavailable at /x/cmux-501.sock: the connection closed",
      reachedChat: false,
    });
  });

  it("journals the chat as reached only for a line cmux typed or queued", () => {
    expect([
      relayedLine({ report: report({ deliveryDetail: "typed", deliveryKind: "typed", slug: "talk-1" }) }),
      relayedLine({ report: report({ deliveryDetail: "queued", deliveryKind: "queued", slug: "talk-2" }) }),
    ]).toEqual([
      { detail: "relayed into the supervisor's chat as talk-1: typed", reachedChat: true },
      { detail: "relayed into the supervisor's chat as talk-2: queued", reachedChat: true },
    ]);
  });

  it.each(["stranded", "unconfirmed", "skipped", "attempting"])(
    "journals a %s delivery as not reached, naming what happened",
    (kind) => {
      expect(
        relayedLine({ report: report({ deliveryDetail: `the ${kind} detail`, deliveryKind: kind, slug: "talk-3" }) }),
      ).toEqual({
        detail: `on the board as talk-3, NOT in the supervisor's chat: the ${kind} detail`,
        reachedChat: false,
      });
    },
  );

  it("journals a held relay as not reached yet, waiting for the chair's quiet batch rather than lost", () => {
    expect(
      relayedLine({ report: report({ deliveryDetail: "held for the batch", deliveryKind: "held", slug: "talk-5" }) }),
    ).toEqual({
      detail:
        "on the board as talk-5, held for the chair's next quiet batch, two minutes after the owner's last word: held for the batch",
      reachedChat: false,
    });
  });

  it("journals what a check-in verdict cleared, or why it recorded nothing", () => {
    const ruling = {
      cleared: 3,
      kind: "push-back-on-coderabbit",
      place: "acme/acme-admin",
      recorded: true,
    } as const;
    expect([
      relayedLine({ report: report({ deliveryDetail: "typed", deliveryKind: "typed", ruling, slug: "talk-1" }) })
        .detail,
      relayedLine({
        report: report({
          deliveryDetail: "stranded",
          deliveryKind: "stranded",
          ruling: { recorded: false, why: "act ev-2 already carries the owner's word" },
        }),
      }).detail,
    ]).toEqual([
      "relayed into the supervisor's chat as talk-1: typed; the owner's word on 3 check-in card(s)",
      "on the board as a board row, NOT in the supervisor's chat: stranded; no ruling recorded: act ev-2 already carries the owner's word",
    ]);
  });

  it("journals a candidate ruling written, or the candidate still open and why", () => {
    expect([
      relayedLine({
        report: report({
          candidateRuling: { candidate: "c-105", reaction: "no", recorded: true },
          deliveryDetail: "typed",
          deliveryKind: "typed",
          slug: "talk-1",
        }),
      }).detail,
      relayedLine({
        report: report({
          candidateRuling: { candidate: "c-999", recorded: false, why: "no candidate has the id c-999" },
          deliveryDetail: "stranded",
          deliveryKind: "stranded",
        }),
      }).detail,
    ]).toEqual([
      "relayed into the supervisor's chat as talk-1: typed; the owner's ruling on c-105",
      "on the board as a board row, NOT in the supervisor's chat: stranded; c-999 still open: no candidate has the id c-999",
    ]);
  });

  it("bounds cmux's reason, so an enormous refusal cannot swamp the line", () => {
    expect(
      relayedLine({ report: report({ deliveryDetail: "x".repeat(13_000), deliveryKind: "failed", slug: "talk-4" }) })
        .detail,
    ).toBe(`on the board as talk-4, NOT in the supervisor's chat: ${"x".repeat(RELAY_WHY_MAX)}…`);
  });

  it("journals a report carrying no delivery as not reached, and says so", () => {
    expect(relayedLine({ report: report({}) })).toEqual({
      detail: "on the board as a board row, NOT in the supervisor's chat: the relay reported no delivery",
      reachedChat: false,
    });
  });
});

describe("cutWhy", () => {
  // The cut counts characters, never UTF-16 units: counting units brought 401 emoji back as 200.
  it("cuts a reason to its first characters counted as characters, never splitting an emoji", () => {
    expect(cutWhy({ why: "😀".repeat(RELAY_WHY_MAX) })).toBe("😀".repeat(RELAY_WHY_MAX));
    expect(cutWhy({ why: "😀".repeat(RELAY_WHY_MAX + 1) })).toBe(`${"😀".repeat(RELAY_WHY_MAX)}…`);
    const out = JSON.stringify({ candidateRuling: { candidate: "c-105", recorded: false, why: "😀".repeat(401) } });
    expect(relayReportOf({ out }).candidateRuling).toEqual({
      candidate: "c-105",
      recorded: false,
      why: `${"😀".repeat(RELAY_WHY_MAX)}…`,
    });
  });
});
