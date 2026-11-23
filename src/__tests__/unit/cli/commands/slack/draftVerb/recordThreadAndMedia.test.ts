/**
 * `slopweaver slack draft record` into a thread or a DM, with media, and over a message that names a colleague —
 * the half of the record cases that read the conversation a row lands in or the pictures it carries.
 *
 * Also covers replies into one thread, which are ONE queue card, and a PR-led draft to the prompt channel,
 * which parks only once the DM is proven the owner's.
 */
import { describe, expect, it } from "vitest";

import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import { ImageAdmissionErrors } from "../../../../../../visualEvidence/errors.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "../ownDmFakes.js";
import { JONAH_ROW, OWNER_ROW, RESOLUTION } from "./fixtures.js";
import { NO_CLAIM, oneCard, parkedIn, RECORD_FLAGS, RECORD_TAIL, RECORD_UNPROVEN, shown } from "./forms.js";
import { seededLog } from "./register.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft record", () => {
  it("parks a --thread-ts row as a thread reply, carrying the root it read, bound into the digest", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", "1789407961.767649"] }),
      deps: draftDeps({
        recording: seen,
        replies: [{ text: "staging pool exhausted", ts: "1789407961.767649", user: "U0JONAH" }],
        stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    const draft = parkedIn({ events: seen.appended });
    expect([draft.shape, draft.threadTs, draft.threadParent]).toEqual([
      "thread",
      "1789407961.767649",
      { text: "staging pool exhausted", userId: "U0JONAH" },
    ]);
    expect(seen.calls).toEqual(["loadMembers", "threadReplies:1789407961.767649", "whoAmI", "conversationInfo"]);
    expect(seen.lines).toContain(
      `to send it as shown: slopweaver slack reply --as me --draft sd-deadbeef --approve ${draft.digest}`,
    );
  });

  it("REFUSES a --thread-ts naming a reply rather than the root, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", "1789407999.000100"] }),
      deps: draftDeps({
        recording: seen,
        replies: [{ text: "the root", ts: "1789407961.767649", user: "U0JONAH" }],
        stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual(["loadMembers", "threadReplies:1789407999.000100"]);
  });

  it("REFUSES a --thread-ts naming no message in the channel, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", "1789407961.767649"] }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES a top-level post as the owner in their bot DM before any read, naming the direct send", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["record", "--channel", "D0PROMPT", "--form", "-", "--why", "gold witness half"] }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["check the ledger"] })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("REFUSES a reply as the owner under their own root in their bot DM, storing no media", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "D0PROMPT",
          "--form",
          "-",
          "--why",
          "gold witness half",
          "--thread-ts",
          "1789829999.819679",
          "--media",
          "/tmp/still.png",
        ],
      }),
      deps: draftDeps({
        recording: seen,
        replies: [{ text: "yo bot, is the ledger honest?", ts: "1789829999.819679", user: "U0SYNADAOWN" }],
        stdin: JSON.stringify(oneCard({ lines: ["proof reply"] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual(["loadMembers", "threadReplies:1789829999.819679", "whoAmI"]);
  });

  it("parks a reply as the owner under the BOT's own root in their bot DM, reading who they are once", async () => {
    const threaded = freshRecording();
    const parked = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          "D0PROMPT",
          "--form",
          "-",
          "--why",
          "reply to the bot's finding",
          "--thread-ts",
          "1789829999.819679",
          ...NO_CLAIM,
        ],
      }),
      deps: draftDeps({
        recording: threaded,
        replies: [{ text: "finding: the pool is exhausted", ts: "1789829999.819679", user: "U0BOT" }],
        stdin: JSON.stringify(oneCard({ lines: ["ok"] })),
      }),
    });
    expect(parked).toBe(EXIT_OK);
    expect(parkedIn({ events: threaded.appended }).threadParent).toEqual({
      text: "finding: the pool is exhausted",
      userId: "U0BOT",
    });
    expect(threaded.calls).toEqual(["loadMembers", "threadReplies:1789829999.819679", "whoAmI", "conversationInfo"]);
  });

  it("admits the whole batch, stores it, and parks the stored entries in attach order", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_FLAGS, "--media", "/tmp/walkthrough.mp4,/tmp/still.png"] }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(shown({ lines: ["Here is the flow, recorded."] })) }),
    });
    expect(code).toBe(EXIT_OK);
    // Admission before storage, both before the identity read, and still no edge that could send.
    expect(seen.calls).toEqual([
      "conversationInfo",
      "loadMembers",
      "readConversation:C0ISO:undefined:20:xoxp-test",
      "prepareMedia:/tmp/walkthrough.mp4,/tmp/still.png",
      "storeMedia:walkthrough.mp4,still.png",
      "whoAmI",
    ]);
    expect(parkedIn({ events: seen.appended }).media).toEqual([
      { bytes: 45, name: "walkthrough.mp4", sha256: "0".repeat(64) },
      { bytes: 31, name: "still.png", sha256: "1".repeat(64) },
    ]);
  });

  // Into a DM, where a first message's screenshot is not owed: at the top level of a channel the same words are refused
  // for want of one, so this case can only park a text-only row where no proof is asked.
  it("parks a draft with no --media with no media field at all, calling neither media edge", async () => {
    const seen = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_UNPROVEN.map((flag) => (flag === "C0ISO" ? "D0DM" : flag)) }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["Text only, no media."] })) }),
    });
    expect(Object.keys(parkedIn({ events: seen.appended })).includes("media")).toBe(false);
    expect(seen.calls).toEqual([
      "loadMembers",
      "readConversation:D0DM:undefined:20:xoxp-test",
      "whoAmI",
      "conversationInfo",
    ]);
  });

  // A top-level draft into the owner's group DM carries no file attachments, because none are needed there.
  it("parks a text-only first message into a group DM, stamped, and refuses the same C… id the read did not stamp", async () => {
    const tail = RECORD_UNPROVEN.map((flag) => (flag === "C0ISO" ? "C0SYN000021" : flag));
    const stdin = JSON.stringify(oneCard({ lines: ["Text only, no media."] }));
    const stamped = freshRecording();
    const stampedCode = await runSlackDraftWithDeps({
      argv: argv({ tail }),
      deps: draftDeps({ groupDm: true, recording: stamped, stdin }),
    });
    const unstamped = freshRecording();
    const unstampedCode = await runSlackDraftWithDeps({
      argv: argv({ tail }),
      deps: draftDeps({ recording: unstamped, stdin }),
    });
    expect([stampedCode, parkedIn({ events: stamped.appended }).groupDm]).toEqual([EXIT_OK, true]);
    expect([unstampedCode, unstamped.appended]).toEqual([EXIT_USAGE, []]);
  });

  it("REFUSES a batch admission rejects, storing and appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_FLAGS, "--media", "/tmp/walkthrough.mp4,/tmp/unread.png"] }),
      deps: draftDeps({
        admission: ImageAdmissionErrors.recordMissing({ digests: ["d".repeat(64)] }),
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["Here is the flow, recorded."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([
      "conversationInfo",
      "loadMembers",
      "readConversation:C0ISO:undefined:20:xoxp-test",
      "prepareMedia:/tmp/walkthrough.mp4,/tmp/unread.png",
    ]);
  });

  it("REFUSES when the store cannot keep the bytes, and appends nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["Here is the flow, recorded."] })),
        storage: SlackDraftErrors.mediaWriteFailed({ cause: new Error("EACCES"), path: "/home/queue/x" }),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([
      "conversationInfo",
      "loadMembers",
      "readConversation:C0ISO:undefined:20:xoxp-test",
      "prepareMedia:/tmp/control.png",
      "storeMedia:control.png",
    ]);
  });

  it("REFUSES a message naming a colleague it does not tag, before any media is stored", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_FLAGS, "--media", "/tmp/still.png"] }),
      deps: draftDeps({
        members: [OWNER_ROW, JONAH_ROW],
        recording: seen,
        stdin: JSON.stringify(shown({ lines: ["jonah approved it already"] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual(["conversationInfo", "loadMembers", "whoAmI"]);
  });

  it("parks a message naming a colleague its resolved mentions record as tagged", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_TAIL }),
      deps: draftDeps({
        members: [OWNER_ROW, JONAH_ROW],
        recording: seen,
        resolution: {
          ...RESOLUTION,
          resolved: new Map([["jonah", { origin: "member" as const, slackId: "U0JONAH" }]]),
        },
        stdin: JSON.stringify(shown({ lines: ["jonah approved it already"] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.calls).toEqual([
      "conversationInfo",
      "loadMembers",
      "readConversation:C0ISO:undefined:20:xoxp-test",
      "prepareMedia:/tmp/control.png",
      "storeMedia:control.png",
      "whoAmI",
    ]);
  });

  it("parks a message naming the other member of the DM it is going to, untagged", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["record", "--channel", "D0JONAH", "--form", "-", "--why", "thank jonah", ...NO_CLAIM] }),
      deps: draftDeps({
        dmUser: "U0JONAH",
        members: [OWNER_ROW, JONAH_ROW],
        recording: seen,
        stdin: JSON.stringify(oneCard({ lines: ["cheers jonah"] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.appended.map((event) => event.kind)).toEqual(["parked", "compared"]);
  });

  it("REFUSES a record with no --why, before it reads anything at all", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["record", "--channel", "C0ISO", "--form", "-"] }),
      deps: draftDeps({ recording: seen, stdin: JSON.stringify(oneCard({ lines: ["One line, nothing more."] })) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });
});

describe("slack draft record — one thread's replies are ONE queue card", () => {
  const THREAD = "1789407961.767649";
  const ROOT = [{ text: "staging pool exhausted", ts: THREAD, user: "U0JONAH" }];
  // Two replies as the owner already held in the thread, the way an earlier seat once left five.
  const TWO_HELD =
    seededLog({ over: { id: "sd-11112222", shape: "thread", threadTs: THREAD } }) +
    seededLog({ over: { id: "sd-33334444", shape: "thread", threadTs: THREAD, tsIso: "2026-09-22T10:01:00.000Z" } });

  it("REFUSES a third reply into the thread before any Slack read, appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", THREAD] }),
      deps: draftDeps({
        log: TWO_HELD,
        recording: seen,
        replies: ROOT,
        stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("REFUSES a merged reply that supersedes only one of the held replies", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", THREAD, "--supersedes", "sd-11112222"] }),
      deps: draftDeps({
        log: TWO_HELD,
        recording: seen,
        replies: ROOT,
        stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls).toEqual([]);
  });

  it("parks ONE merged reply superseding every held reply, dropping each in the same act", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", THREAD, "--supersedes", "sd-11112222,sd-33334444"] }),
      deps: draftDeps({
        log: TWO_HELD,
        recording: seen,
        replies: ROOT,
        stdin: JSON.stringify(oneCard({ lines: ["Looking now, and the pool size is the likely cause."] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.appended.map((event) => [event.kind, event.id])).toEqual([
      ["parked", "sd-deadbeef"],
      ["dropped", "sd-11112222"],
      ["dropped", "sd-33334444"],
      ["compared", "sd-deadbeef"],
    ]);
    expect(seen.appended.flatMap((event) => (event.kind === "dropped" ? [event.note] : []))).toEqual([
      "superseded by sd-deadbeef (recorded with --supersedes)",
      "superseded by sd-deadbeef (recorded with --supersedes)",
    ]);
    // The lineage a later drop proves its re-cut by: a note alone names any row.
    expect(parkedIn({ events: seen.appended }).recuts).toEqual(["sd-11112222", "sd-33334444"]);
  });

  it("parks a first reply into a thread whose only held row is top-level in the same channel", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--thread-ts", THREAD] }),
      deps: draftDeps({
        log: seededLog(),
        recording: seen,
        replies: ROOT,
        stdin: JSON.stringify(oneCard({ lines: ["Looking now."] })),
      }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).threadTs).toBe(THREAD);
  });
});

// The configured prompt channel is exempt from the PR-lead gate only when the bot-token read proved it the owner's: a
// colleague's DM configured there parks nothing, exactly as a channel would.
describe("slack draft record — a PR-led draft to the prompt channel parks only once it is proven the owner's", () => {
  const PR_LED = "Approve the fix PR for the gateway outage, so events recover.";
  it.each([
    {
      code: EXIT_OK,
      name: "parks it in the owner's own bot DM",
      ownDm: PROMPT_DM_IS_OWNERS,
      parked: ["parked", "compared"],
    },
    {
      code: EXIT_USAGE,
      name: "parks nothing in a colleague's DM configured as the owner's",
      ownDm: NOTHING_PROVEN,
      parked: [],
    },
  ])("as the owner: $name", async ({ code, ownDm, parked }) => {
    const seen = freshRecording();
    const seam = recordingOwnDm({ answer: ownDm });
    const exit = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--channel",
          PROMPT_DM,
          "--form",
          "-",
          "--why",
          "reply to the bot's finding",
          "--thread-ts",
          "1789829999.819679",
          ...NO_CLAIM,
        ],
      }),
      deps: draftDeps({
        ownDm: seam.verify,
        recording: seen,
        replies: [{ text: "finding: the pool is exhausted", ts: "1789829999.819679", user: "U0BOT" }],
        stdin: JSON.stringify(oneCard({ lines: [PR_LED] })),
      }),
    });
    expect(exit).toBe(code);
    expect(seam.asked).toEqual([PROMPT_DM]);
    expect(seen.appended.map((event) => event.kind)).toEqual(parked);
  });

  // A bot recording has no --dm-purpose to declare, so the DM-purpose hold refuses it before any proof would matter.
  it("as the bot: parks nothing even where the read would prove the DM the owner's, asking nothing", async () => {
    const seen = freshRecording();
    const seam = recordingOwnDm({ answer: PROMPT_DM_IS_OWNERS });
    const form = JSON.stringify({
      detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
      kind: "update",
      tldr: PR_LED,
    });
    const exit = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          "record",
          "--as",
          "bot",
          "--channel",
          PROMPT_DM,
          "--form",
          "-",
          "--why",
          "the proxy fix, for the owner",
          ...NO_CLAIM,
        ],
      }),
      deps: draftDeps({ ownDm: seam.verify, recording: seen, stdin: form }),
    });
    expect(exit).toBe(EXIT_USAGE);
    expect(seam.asked).toEqual([]);
    expect(seen.appended).toEqual([]);
  });
});
