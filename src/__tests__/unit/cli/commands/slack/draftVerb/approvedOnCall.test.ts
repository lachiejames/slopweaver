/**
 * `slopweaver slack draft record --approved`, where the owner's yes on a call is the send.
 *
 * Also covers `slopweaver slack draft record` of a question, which declares whether it was asked before and
 * what changed, and of review asks, where one person's asks in a day are ONE batch DM.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { RawWords } from "../../../../../../handover/hisWordsResolve.js";
import { ok } from "../../../../../../lib/result.js";
import { type ParkedPriorAsk, slackDraftEventLine } from "../../../../../../outbound/slack/draftRegister.js";
import type { PriorRead } from "../../../../../../outbound/slack/priorAsk.js";
import { landed } from "../../../../supervisor/draftItemFixture.js";
import { FIRST_MESSAGE_SHOT, parkedIn, RECORD_TAIL, shown } from "./forms.js";
import { receiptsIn, seededLog } from "./register.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft record — the owner's yes on a call is the send", () => {
  const ANCHOR = "talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt";
  const HEARD: RawWords = {
    atIso: "2026-10-07T05:52:59.000Z",
    context: { kind: "call-segment", open: undefined },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost: false,
    text: "Fuck, that is an excellent draft. Love it. Send it",
    where: "call",
  };
  const APPROVAL = { anchor: ANCHOR, atIso: HEARD.atIso, heard: HEARD.text };
  const FORM = JSON.stringify(shown({ lines: ["Four groups, one question.", "Which is the right state?"] }));

  it("parks a row carrying the owner's words at --approved, read before any Slack call", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
      deps: draftDeps({ hisWords: ok(HEARD), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).approval).toEqual(APPROVAL);
    expect(seen.calls[0]).toBe(`readOwnerWords:${ANCHOR}`);
    expect(seen.lines).toContain(`heard    ${HEARD.text}`);
  });

  it("parks NOTHING on a yes from a relay about no card, before any Slack call (incident C0SYN000001)", async () => {
    const seen = freshRecording();
    const cardless: RawWords = { ...HEARD, context: { about: "", kind: "relay", triageRuling: null } };
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
      deps: draftDeps({ hisWords: ok(cardless), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([`readOwnerWords:${ANCHOR}`]);
  });

  it("parks NOTHING when the anchor does not resolve to the owner's words", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
      deps: draftDeps({ recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([`readOwnerWords:${ANCHOR}`]);
  });

  it("parks NOTHING when the record holds only part of what the owner said there", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
      deps: draftDeps({ hisWords: ok({ ...HEARD, tailLost: true }), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("parks NOTHING on a relay that never recorded whether its start was cut", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR] }),
      deps: draftDeps({ hisWords: ok({ ...HEARD, headKnown: false }), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("carries the approval across a one-row re-cut, naming the row it came from", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--supersedes", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog({ over: { approval: APPROVAL } }), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).approval).toEqual({
      ...APPROVAL,
      inheritedFrom: "sd-11112222",
      judgedIso: "2026-09-22T10:00:00.000Z",
    });
    // An inherited yes stands on the boundary it carries, so the re-cut's park counts nothing of its own.
    expect(Object.keys(seen.appended.find((event) => event.kind === "parked")!)).not.toContain("landingsRead");
    expect(parkedIn({ events: seen.appended }).recuts).toEqual(["sd-11112222"]);
  });

  it("sets the approval down on a re-cut declaring --meaning-changed, so the new row waits for the owner", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [...RECORD_TAIL, "--supersedes", "sd-11112222", "--meaning-changed", "the thread asked for one thing"],
      }),
      deps: draftDeps({ log: seededLog({ over: { approval: APPROVAL } }), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_OK);
    const draft = parkedIn({ events: seen.appended });
    expect(draft.approval).toBe(undefined);
    expect(draft.meaningChanged).toBe("the thread asked for one thing");
    // A change is a judgement, so its park counts the landing ledger it read.
    expect(seen.appended.find((event) => event.kind === "parked")).toEqual(
      expect.objectContaining({ kind: "parked", landingsRead: 0 }),
    );
  });

  it("parks NOTHING judged while the card landings cannot be read, since uncounted it would answer a later-written yes", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [...RECORD_TAIL, "--supersedes", "sd-11112222", "--meaning-changed", "the thread asked for one thing"],
      }),
      deps: {
        ...draftDeps({ log: seededLog({ over: { approval: APPROVAL } }), recording: seen, stdin: FORM }),
        readLandedDrafts: () => ({ kind: "unreadable", why: "ledger line 3 is torn" }),
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("parks NOTHING under a minted id the register already holds, so no older row's release lands on it", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ log: seededLog({ over: { id: "sd-deadbeef" } }), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(seen.appended).toEqual([]);
  });

  describe("a re-cut of a row whose yes a hold on the yes itself set down, unseen", () => {
    const SET_DOWN =
      seededLog({ over: { approval: APPROVAL } }) +
      `${slackDraftEventLine({
        event: {
          id: "sd-11112222",
          kind: "held",
          reason: "not-owner-yes",
          tsIso: "2026-09-22T10:05:00.000Z",
          why: "they meant the other draft",
        },
      })}\n`;

    it("parks NOTHING bare, naming the reason the owner has not seen", async () => {
      const seen = freshRecording();
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--supersedes", "sd-11112222"] }),
        deps: draftDeps({ log: SET_DOWN, recording: seen, stdin: FORM }),
      });
      expect(code).toBe(EXIT_USAGE);
      expect(seen.appended).toEqual([]);
    });

    it("parks a re-cut that declares the change, which the owner's Queue card leads with", async () => {
      const seen = freshRecording();
      const code = await runSlackDraftWithDeps({
        argv: argv({
          tail: [...RECORD_TAIL, "--supersedes", "sd-11112222", "--meaning-changed", "they meant another"],
        }),
        deps: draftDeps({ log: SET_DOWN, recording: seen, stdin: FORM }),
      });
      expect(code).toBe(EXIT_OK);
      expect(parkedIn({ events: seen.appended }).meaningChanged).toBe("they meant another");
    });
  });

  it("parks NOTHING bare over a row the owner's words reached on a since-swept card, which no cut would bind", async () => {
    const seen = freshRecording();
    const swept = landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-09-22T10:30:00.000Z" });
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--supersedes", "sd-11112222"] }),
      deps: {
        ...draftDeps({ log: seededLog(), recording: seen, stdin: FORM }),
        readLandedDrafts: () => ({
          bindings: { bound: [], unreadable: [] },
          kind: "read",
          ledgerRows: 1,
          vanished: [{ landing: swept, ledgerRow: 0 }],
        }),
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES --meaning-changed when no row it supersedes carries an approval", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--supersedes", "sd-11112222", "--meaning-changed", "reworded"] }),
      deps: draftDeps({ log: seededLog(), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES a merge of an approved row with one the owner never heard, before any Slack read", async () => {
    const seen = freshRecording();
    const log =
      seededLog({ over: { approval: APPROVAL } }) +
      seededLog({ over: { id: "sd-33334444", tsIso: "2026-09-22T10:01:00.000Z" } });
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--supersedes", "sd-11112222,sd-33334444"] }),
      deps: draftDeps({ log, recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("REFUSES --approved beside --meaning-changed at parse", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--approved", ANCHOR, "--meaning-changed", "reworded"] }),
      deps: draftDeps({ hisWords: ok(HEARD), recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.calls).toEqual([]);
  });

  it("marks a held approved row APPROVED on the list", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-list-approved-"));
    try {
      const seen = freshRecording();
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: ["list", "--home", home] }),
        deps: draftDeps({ log: seededLog({ over: { approval: APPROVAL, ...receiptsIn({ home }) } }), recording: seen }),
      });
      expect(code).toBe(EXIT_OK);
      expect(seen.lines[0]).toContain("APPROVED · the ISO group question");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("slack draft record — an answered question is not asked again with nothing shown", () => {
  const PERMALINK = "https://acme.slack.com/archives/C0ISO/p1789000000000100";
  const ASKING = JSON.stringify(shown({ lines: ["Is the key spend expected?"] }));
  const TAIL: readonly string[] = [
    "record",
    "--channel",
    "C0ISO",
    "--form",
    "-",
    "--why",
    "the key spend question",
    "--kind",
    "message",
    ...FIRST_MESSAGE_SHOT,
  ];
  const OURS = { text: "Is the key spend expected?", ts: "1789000000.000100", userId: "U0SYNADAOWN" };
  const ANSWER = { text: "yeah, it's expected, the batch job", ts: "1789000100.000100", userId: "U0JONAH" };
  const ANSWERED: PriorRead = { addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS, ANSWER] };

  it("REFUSES a question that declares nothing, reading no earlier ask and appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: TAIL }),
      deps: draftDeps({ recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.filter((call) => call.startsWith("readPriorAsk"))).toEqual([]);
  });

  it("parks a message that asks nothing with no declaration and no priorAsk field", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: TAIL }),
      deps: draftDeps({
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["The key spend is the batch job."] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).priorAsk).toBe(undefined);
  });

  it("parks `--asked-before none` as a journalled claim, reading nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", "none"] }),
      deps: draftDeps({ recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).priorAsk).toEqual({ kind: "none" });
    expect(seen.calls.filter((call) => call.startsWith("readPriorAsk"))).toEqual([]);
  });

  it("REFUSES an ANSWERED earlier ask with nothing shown, under the owner's own token", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", PERMALINK] }),
      deps: draftDeps({ priorRead: ok(ANSWERED), recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.filter((call) => call.startsWith("readPriorAsk"))).toEqual([
      `readPriorAsk:${PERMALINK}:xoxp-test`,
    ]);
  });

  it("parks an answered ask with the change shown in a picture, our message and theirs on the row", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [...TAIL, "--asked-before", PERMALINK, "--changed", "spend tripled since", "--changed-media", "0.png"],
      }),
      deps: draftDeps({ image: true, priorRead: ok(ANSWERED), recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_OK);
    const prior = parkedIn({ events: seen.appended }).priorAsk as Extract<ParkedPriorAsk, { kind: "prior" }>;
    const { proof, ...rest } = prior;
    expect(rest).toEqual({
      answerCount: 1,
      answers: [ANSWER],
      changed: "spend tripled since",
      kind: "prior",
      ours: OURS,
      permalink: PERMALINK,
      readThroughTs: ANSWER.ts,
    });
    expect(proof!.map(({ name, sha256 }) => ({ name, sha256 }))).toEqual([{ name: "0.png", sha256: "0".repeat(64) }]);
    // The change's proof is kept first, then the first message's own screenshot; the image-mode
    // fake names each upload by the path it was given.
    expect(seen.calls.filter((call) => call.startsWith("storeMedia"))).toEqual([
      "storeMedia:0.png",
      "storeMedia:/tmp/control.png",
    ]);
  });

  it("REFUSES a change whose proof is a document, storing nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [...TAIL, "--asked-before", PERMALINK, "--changed", "spend tripled", "--changed-media", "clip.mp4"],
      }),
      deps: draftDeps({ priorRead: ok(ANSWERED), recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.filter((call) => call.startsWith("storeMedia"))).toEqual([]);
  });

  it("parks an answered ask whose replies were no answer, saying why", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", PERMALINK, "--not-answered", "they said they would look"] }),
      deps: draftDeps({ priorRead: ok(ANSWERED), recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_OK);
    const prior = parkedIn({ events: seen.appended }).priorAsk as Extract<ParkedPriorAsk, { kind: "prior" }>;
    expect(prior.notAnswered).toBe("they said they would look");
    expect(prior.proof).toBe(undefined);
  });

  it("parks an earlier ask nobody answered with nothing more to show", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", PERMALINK] }),
      deps: draftDeps({
        priorRead: ok({ addressedTs: OURS.ts, channelTopLevel: [], messages: [OURS] }),
        recording: seen,
        stdin: ASKING,
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).priorAsk).toEqual({
      answerCount: 0,
      answers: [],
      kind: "prior",
      ours: OURS,
      permalink: PERMALINK,
      readThroughTs: OURS.ts,
    });
  });

  it("REFUSES an earlier message somebody else wrote", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", PERMALINK, "--not-answered", "n/a"] }),
      deps: draftDeps({
        priorRead: ok({ addressedTs: OURS.ts, channelTopLevel: [], messages: [{ ...OURS, userId: "U0JONAH" }] }),
        recording: seen,
        stdin: ASKING,
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES when the earlier ask cannot be read, failing closed", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--asked-before", PERMALINK] }),
      deps: draftDeps({ recording: seen, stdin: ASKING }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });
});

describe("slack draft record — review asks to one person in a day are ONE batch DM", () => {
  const PR = "https://github.com/acme/acme-admin/pull";
  const ASK_TAIL: readonly string[] = [
    "record",
    "--form",
    "-",
    "--why",
    "a review ask",
    "--act",
    "review-ask",
    "--reviewer",
    "in-thread",
    "--asked-before",
    "none",
  ];
  // A single to Jasper went out at 09:00 Melbourne on the same local day as the deps' clock.
  const SENT_TODAY =
    seededLog({ over: { act: "review-ask", channel: "U0JASPER", id: "sd-55556666" } }) +
    `${slackDraftEventLine({
      event: {
        channel: "D0JASPER",
        id: "sd-55556666",
        kind: "released",
        ts: "1790000000.000100",
        tsIso: "2026-09-22T23:00:00.000Z",
      },
    })}\n`;
  const single = JSON.stringify({
    kind: "one-card",
    lines: [
      {
        runs: [
          { text: "hey, could I grab a review on ", type: "text" },
          { label: "#18247", type: "link", url: `${PR}/18247` },
          { text: " when you get a sec? no rush", type: "text" },
        ],
      },
    ],
    problem: { kind: "none" },
  });
  const batch = JSON.stringify({
    bullets: [
      [{ label: "#18249", type: "link", url: `${PR}/18249` }],
      [{ label: "#18247", type: "link", url: `${PR}/18247` }],
    ],
    kind: "one-list",
    lead: [{ text: "actually can you just review all these lol, could I grab a review on the lot", type: "text" }],
    problem: { kind: "none" },
    trailing: [[{ text: "no rush", type: "text" }]],
  });

  it("REFUSES a second single to the same person that day, appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...ASK_TAIL, "--channel", "U0JASPER"] }),
      deps: draftDeps({ log: SENT_TODAY, recording: seen, stdin: single, surface: "direct-message" }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES it addressed by the D… conversation too, joined through the member Slack names", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...ASK_TAIL, "--channel", "D0JASPER"] }),
      deps: draftDeps({
        dmUser: "U0JASPER",
        log: SENT_TODAY,
        recording: seen,
        stdin: single,
        surface: "direct-message",
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("parks the batch that takes its place", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...ASK_TAIL, "--channel", "U0JASPER"] }),
      deps: draftDeps({ log: SENT_TODAY, recording: seen, stdin: batch, surface: "direct-message" }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).act).toBe("review-ask");
  });

  it("parks a single to somebody else", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...ASK_TAIL, "--channel", "U0SYNSOMEONE"] }),
      deps: draftDeps({ log: SENT_TODAY, recording: seen, stdin: single, surface: "direct-message" }),
    });
    expect(code).toBe(EXIT_OK);
  });
});
