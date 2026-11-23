/**
 * `slopweaver slack draft record`, driven whole over a world built from plain functions.
 *
 * The property every case here exists to hold down is ONE sentence: recording a draft writes a register row
 * and posts nothing. The dependency bag carries no send edge at all, so "it did not post" is the compiler's
 * answer rather than a test's — what these assert instead is the half a type cannot prove, that a REFUSAL
 * appends nothing and that the row a success writes carries the exact bytes a release would send.
 *
 * It also covers a chase that links a pull request, which never parks once GitHub closed it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rowDocMissing } from "../../../../../../cli/commands/slack/draftRowDoc.js";
import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { dripConfigFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import { grantedEnv, grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { EM_DASH_RULED } from "./fixtures.js";
import {
  drip,
  oneCard,
  parkedIn,
  RECORD_FLAGS,
  RECORD_TAIL,
  RECORD_UNPROVEN,
  SHOWN_LINK_TEXT,
  shown,
} from "./forms.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft record", () => {
  it("parks one row carrying the exact bytes a release would post, and calls nothing that could send", async () => {
    const seen = freshRecording();
    const deps = draftDeps({
      recording: seen,
      stdin: JSON.stringify(shown({ lines: ["Four groups, one question.", "Which is the right state?"] })),
    });
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: RECORD_TAIL,
      }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    const draft = parkedIn({ events: seen.appended });
    expect(draft.id).toBe("sd-deadbeef");
    expect(draft.channel).toBe("C0ISO");
    expect(draft.channelName).toBe("iso-27001");
    expect(draft.authorId).toBe("U0SYNADAOWN");
    expect(draft.shape).toBe("top-level");
    expect(draft.why).toBe("the ISO group question");
    // A one-card's two lines are ONE message with the paragraph gap between them — the fallback text is
    // what Slack sends to a push notification, so it carries both.
    expect(draft.payload.text).toBe(`Four groups, one question.\n\nWhich is the right state?\n\n${SHOWN_LINK_TEXT}`);
    // The mentions are flattened off the resolution's Maps, which do not survive JSON — a release that lost
    // them would post the handles as plain text while this row still looked correct.
    expect(draft.mentions).toEqual([
      { key: "ada", kind: "person", target: "U0SYNADAOWN" },
      { key: "@security", kind: "group", target: "S0SEC" },
    ]);
    // Exactly three live calls, all reads: the channel tail the row snapshots for its release, the channel's own
    // info (which the surface gate shares) and `auth.test` — beside member bronze, read on disk for the
    // untagged-name hold, and the first message's one picture, admitted and kept before the identity read. The
    // conversation read comes first because a first channel message needs it to know whether it is a group DM. A
    // further entry here would be a seam this verb is not supposed to have.
    expect(seen.calls).toEqual([
      "conversationInfo",
      "loadMembers",
      "readConversation:C0ISO:undefined:20:xoxp-test",
      "prepareMedia:/tmp/control.png",
      "storeMedia:control.png",
      "whoAmI",
    ]);
  });

  it("snapshots a top-level row's channel tail, so its release sees a person's edit or removal there", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({
        conversation: ok({
          hasMore: true,
          rows: [
            { bot_id: "B0BOT", text: "ack", ts: "1790000300.000300", user: "U0SYNBOTUSER" },
            { edited: { ts: "1790000250.000000" }, text: "second", ts: "1790000200.000200", user: "U0OTHER" },
            { text: "first", ts: "1790000100.000100", user: "U0SYNADAOWN" },
          ],
          workspaceUrl: "https://acme.slack.com/",
        }),
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["Four groups, one question.", "Which is the right state?"] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    // Every message is kept whoever wrote it, the bot's ack included; only the release judges whose a change is.
    expect(parkedIn({ events: seen.appended }).readThrough).toEqual({
      seen: [
        { ts: "1790000100.000100" },
        { editedTs: "1790000250.000000", ts: "1790000200.000200" },
        { ts: "1790000300.000300" },
      ],
      throughTs: "1790000300.000300",
    });
  });

  it("parks nothing when a top-level row's channel cannot be read for its snapshot", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({
        conversation: err(SlackDraftErrors.contextUnreadable({ cause: "not_in_channel", channel: "C0ISO" })),
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["Four groups, one question.", "Which is the right state?"] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("names the console deep link on the report, because that is where the owner reads a draft", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: RECORD_TAIL,
      }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["One line, nothing more."] })) }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.lines.join("\n")).toContain("http://localhost:3000/queue?open=post%3Asd-deadbeef");
    expect(seen.lines[0]).toBe("parked sd-deadbeef — NOTHING was sent.");
  });

  it("REFUSES a multi-message drip and appends nothing, because a parked draft is one message", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["record", "--channel", "C0ISO", "--form", "-", "--why", "a drip", "--kind", "message"] }),
      deps: draftDeps({ recording: seen, stdin: drip({ texts: ["One.", "Two."] }) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.lines).toEqual([]);
  });

  it("exits 1 over a corrupt profile before Slack is asked anything, and appends nothing", async () => {
    const corrupt = mkdtempSync(join(tmpdir(), "draft-record-corrupt-"));
    try {
      writeFileSync(join(corrupt, "profile.json"), "{", "utf8");
      const seen = freshRecording();
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--home", corrupt] }),
        deps: {
          ...draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Morning all."] })) }),
          dripConfig: ({ home }) => dripConfigFromProfile({ home }),
        },
      });
      expect(code).toBe(EXIT_ERROR);
      expect(seen.appended).toEqual([]);
      expect(seen.calls).toEqual([]);
    } finally {
      rmSync(corrupt, { force: true, recursive: true });
    }
  });

  it("parks --row onto the row when a board doc holds the slug, outside the digest", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-record-row-"));
    try {
      mkdirSync(join(home, "handovers"));
      writeFileSync(
        join(home, "handovers", "thread-chase-daily.md"),
        "---\nslug: thread-chase-daily\nstatus: ready\n---\n",
      );
      const withRow = freshRecording();
      const without = freshRecording();
      const stdin = JSON.stringify(shown({ lines: ["Four groups, one question."] }));
      const codes = [
        await runSlackDraftWithDeps({
          argv: argv({ tail: [...RECORD_TAIL, "--row", "thread-chase-daily", "--home", home] }),
          deps: draftDeps({ recording: withRow, stdin }),
        }),
        await runSlackDraftWithDeps({
          argv: argv({ tail: [...RECORD_TAIL, "--home", home] }),
          deps: draftDeps({ recording: without, stdin }),
        }),
      ];
      expect(codes).toEqual([EXIT_OK, EXIT_OK]);
      const parked = parkedIn({ events: withRow.appended });
      expect(parked.row).toBe("thread-chase-daily");
      expect(parked.digest).toBe(parkedIn({ events: without.appended }).digest);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("REFUSES a --row no board doc holds, naming the file it looked for, and appends nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-record-row-missing-"));
    try {
      const seen = freshRecording();
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--row", "no-such-row", "--home", home] }),
        deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Four groups, one question."] })) }),
      });
      expect(code).toBe(EXIT_USAGE);
      expect(seen.appended).toEqual([]);
      expect(seen.calls).toEqual([]);
      expect(rowDocMissing({ home, row: "no-such-row" })).toBe(
        `slack draft record --row no-such-row: no board row holds it — looked for ${join(home, "handovers", "no-such-row.md")} and its archive`,
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("REFUSES a form the as-me checks reject, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: ["record", "--channel", "C0ISO", "--form", "-", "--why", "bold markers", "--kind", "message"],
      }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["*not actually bold*"] })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    // The identity read is never reached: a form that was never going to park costs no `auth.test` call.
    expect(seen.calls).toEqual([]);
  });

  it("REFUSES a form declaring no `problem`, and appends nothing", async () => {
    const seen = freshRecording();
    const undeclared = { kind: "one-card", lines: [{ runs: [{ text: "Looking now.", type: "text" }] }] };
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(undeclared) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES a possible problem whose first line does not say how many it affects, and parks one that does", async () => {
    const refusedSeen = freshRecording();
    const unsized = {
      ...oneCard({ lines: ["Checkout is failing."] }),
      problem: { affects: "a few", kind: "possible" },
    };
    const refused = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ recording: refusedSeen, stdin: JSON.stringify(unsized) }),
    });
    const parkedSeen = freshRecording();
    // A possible problem raises a finding, so the one that parks brings its proof too.
    const sized = {
      ...oneCard({ lines: ["Checkout is failing for a few customers, 3 so far.", "https://grafana.example.com/d/co"] }),
      problem: unsized.problem,
    };
    const proof = ["--media", "/tmp/still.png", "--impact", "3 customers could not check out"];
    const parked = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_FLAGS, ...proof] }),
      deps: draftDeps({ recording: parkedSeen, stdin: JSON.stringify(sized) }),
    });
    expect(refused).toBe(EXIT_USAGE);
    expect(refusedSeen.appended).toEqual([]);
    expect(parked).toBe(EXIT_OK);
    // The park alone: a row carrying media owes no Codex comparison.
    expect(parkedSeen.appended.map((event) => event.kind)).toEqual(["parked"]);
    expect(parkedIn({ events: parkedSeen.appended }).impact).toBe("3 customers could not check out");
  });

  it("REFUSES a top-level channel post declaring no opening, and parks the one that opens with it", async () => {
    const refusedSeen = freshRecording();
    const detailFirst = oneCard({ lines: ["Five MFA asks."] });
    const refused = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ recording: refusedSeen, stdin: JSON.stringify(detailFirst) }),
    });
    const parkedSeen = freshRecording();
    const framed = {
      ...shown({ lines: ["This is a pilot of the MFA bot. React on anything off."] }),
      opening: { asks: { kind: "react", text: "react on anything off" }, what: "a pilot of the MFA bot" },
    };
    const parked = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ recording: parkedSeen, stdin: JSON.stringify(framed) }),
    });
    // The same detail-first form into a DM parks: the refusal above is the channel opening's, nothing else.
    const dmSeen = freshRecording();
    const dmTail = RECORD_UNPROVEN.map((flag) => (flag === "C0ISO" ? "D0DM" : flag));
    const inDm = await runSlackDraftWithDeps({
      argv: argv({ tail: dmTail }),
      deps: draftDeps({ recording: dmSeen, stdin: JSON.stringify(detailFirst) }),
    });
    expect(refused).toBe(EXIT_USAGE);
    expect(refusedSeen.appended).toEqual([]);
    expect(parked).toBe(EXIT_OK);
    // A first message in a channel carries its picture, and a row carrying media owes no Codex comparison.
    expect(parkedSeen.appended.map((event) => event.kind)).toEqual(["parked"]);
    expect(inDm).toBe(EXIT_OK);
    expect(dmSeen.appended.map((event) => event.kind)).toEqual(["parked", "compared"]);
  });

  it("REFUSES a draft past the shape the owner trims every draft to, before any read, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({
        recording: seen,
        stdin: JSON.stringify(oneCard({ lines: ["One.", "Two.", "Three.", "Four."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("parks that draft under a live earns-its-place grant, carrying the advisory that it went past", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-record-earns-"));
    try {
      const seen = freshRecording();
      const env = grantedEnv({ hatchIds: ["earns-its-place"], home, issuedAtIso: "2026-09-23T01:02:03.000Z" });
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--home", home] }),
        deps: {
          ...draftDeps({
            recording: seen,
            stdin: JSON.stringify(shown({ lines: ["One idea, one ask.", "Two.", "Three.", "Four."] })),
          }),
          doorEnv: () => env,
        },
      });
      expect(code).toBe(EXIT_OK);
      expect(parkedIn({ events: seen.appended }).advisory).toContain(
        "parked past the earns-its-place gate under its hatch: broke paragraphs",
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("still REFUSES that draft with only the retired earns-its-place variable set, because it opens nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-record-earns-var-"));
    try {
      const seen = freshRecording();
      const env = { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_EARNS_ITS_PLACE: "1" };
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--home", home] }),
        deps: {
          ...draftDeps({
            recording: seen,
            stdin: JSON.stringify(oneCard({ lines: ["One.", "Two.", "Three.", "Four."] })),
          }),
          doorEnv: () => env,
        },
      });
      expect(code).toBe(EXIT_USAGE);
      expect(seen.appended).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  // Words as the owner carried an em dash their rules ban, and only the owner's eye caught it.
  it("REFUSES a draft breaking the owner's exact voice rules, before any read, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: {
        ...draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Looking now — back shortly."] })) }),
        dripConfig: () => ok(EM_DASH_RULED),
      },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("parks that draft under a live voice-rules grant, its words unchanged", async () => {
    const home = mkdtempSync(join(tmpdir(), "draft-record-voice-"));
    try {
      const seen = freshRecording();
      // Issued now: `prepareDrip` judges the grant's thirty minutes on the wall clock.
      const env = grantedEnv({ hatchIds: ["voice-rules"], home });
      const code = await runSlackDraftWithDeps({
        argv: argv({ tail: [...RECORD_TAIL, "--home", home] }),
        deps: {
          ...draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["Looking now — back shortly."] })) }),
          dripConfig: () => ok(EM_DASH_RULED),
          doorEnv: () => env,
        },
      });
      expect(code).toBe(EXIT_OK);
      expect(JSON.stringify(parkedIn({ events: seen.appended }).payload)).toContain("Looking now — back shortly.");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("slack draft record — a chase on a closed pull request never parks", () => {
  const PR = "https://github.com/acme/acme-admin/pull/18404";
  /** sd-e484ecce's shape: a bump asking whether a pull request may be closed, linking it. */
  const CHASE = JSON.stringify({
    ...oneCard({ lines: ["is the dd-trace call the only one left to make?"] }),
    lines: [
      { runs: [{ text: "is the dd-trace call the only one left to make?", type: "text" }] },
      { runs: [{ label: "the DBM sample pull request", type: "link", url: PR }] },
    ],
  });

  it("refuses a bump whose linked pull request GitHub already closed, before any Slack read of the thread", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--act", "bump"] }),
      deps: draftDeps({ pullRequestState: { kind: "settled", state: "CLOSED" }, recording: seen, stdin: CHASE }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toContain("pullRequestState:acme/acme-admin#18404");
    expect(seen.calls).not.toContain("whoAmI");
  });

  it("parks the same bump once its pull request is open", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--act", "bump"] }),
      deps: draftDeps({ pullRequestState: { kind: "open" }, recording: seen, stdin: CHASE }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).act).toBe("bump");
    expect(seen.calls).toContain("pullRequestState:acme/acme-admin#18404");
  });

  it("refuses a bump whose linked pull request could not be read, rather than parking it unproved", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_TAIL, "--act", "bump"] }),
      deps: draftDeps({ pullRequestState: { kind: "notChecked" }, recording: seen, stdin: CHASE }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toContain("pullRequestState:acme/acme-admin#18404");
  });

  it("holds a bot-lane bump on a merged pull request before the bot reads where it lands", async () => {
    const form = JSON.stringify({
      detail: [{ runs: [{ label: "the DBM sample pull request", type: "link", url: PR }], type: "paragraph" }],
      kind: "update",
      problem: { kind: "none" },
      tldr: "is the dd-trace call the only one left to make?",
    });
    const tail = ["record", "--as", "bot", "--channel", "C0TEAM", "--form", "-", "--why", "chase", "--act", "bump"];
    tail.push("--thread-ts", "1791260530.408199");
    const merged = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail }),
      deps: draftDeps({ pullRequestState: { kind: "settled", state: "MERGED" }, recording: merged, stdin: form }),
    });
    const open = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail }),
      deps: draftDeps({ pullRequestState: { kind: "open" }, recording: open, stdin: form }),
    });
    expect(merged.appended).toEqual([]);
    expect(merged.calls).toContain("pullRequestState:acme/acme-admin#18404");
    expect(merged.calls).not.toContain("conversationInfo");
    expect(open.calls).toContain("pullRequestState:acme/acme-admin#18404");
    expect(open.calls).toContain("conversationInfo");
  });

  it("reads nothing for a row that is not a chase or a review ask, closed pull request or not", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({ pullRequestState: { kind: "settled", state: "CLOSED" }, recording: seen, stdin: CHASE }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.calls.filter((call) => call.startsWith("pullRequestState:"))).toEqual([]);
  });
});
