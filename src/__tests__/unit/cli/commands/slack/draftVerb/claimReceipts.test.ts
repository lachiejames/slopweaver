/** `slopweaver slack draft record` of a card that makes a claim, which brings its receipts. */
import { describe, expect, it } from "vitest";

import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { SteerReceipt } from "../../../../../../outbound/slack/draftCorrections.js";
import { FIRST_MESSAGE_SHOT, oneCard, parkedIn, RECORD_FLAGS, RECORD_UNPROVEN, shown } from "./forms.js";
import { seededLog } from "./register.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft record — a card that makes a claim brings its receipts", () => {
  const THREAD_LINK = "https://acme.slack.com/archives/C0SYN000002/p1790485901702259";
  /** A claim the owner answered by asking where the receipt was, with no link and no screenshot. */
  const MFA = JSON.stringify(
    oneCard({ lines: ["Vanta's MFA test flipped to Needs attention today, on one account."] }),
  );
  /** A Claude cut whose link the owner called the receipt. */
  const LINKED = JSON.stringify({
    kind: "one-card",
    lines: [
      {
        runs: [
          { text: "this is where it started: ", type: "text" },
          { label: "agent CLI as an opt-in plugin", type: "link", url: THREAD_LINK },
        ],
      },
    ],
    opening: { asks: { kind: "nothing", text: "where it started" }, what: "this is" },
    problem: { kind: "none" },
  });
  /** The owner's relay on the row a re-cut supersedes, sending it back for its receipts. */
  const SENT_BACK: SteerReceipt = {
    about: "post:sd-11112222",
    anchor: "talk:00000000-0000-4000-8000-000000000000",
    heard: "where's the receipt?",
    stagedAtIso: "2026-10-13T02:25:00.000Z",
    triageRuling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" },
    words: "",
  };

  it("REFUSES the MFA claim with no link, no file and no declaration, before the conversation read and auth.test", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: RECORD_FLAGS }),
      deps: draftDeps({ recording: seen, stdin: MFA }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.filter((call) => call.startsWith("readConversation") || call === "whoAmI")).toEqual([]);
  });

  /**
   * The flags of a recording into a DM. These cases are about what a CARD declares for its claim, which a DM and a
   * channel read alike; at the top level of a channel the same card also owes a first message's screenshot and link
   * (a rule of the owner's), which would answer the claim for them, so they record where that proof is not owed.
   */
  const DM_FLAGS = RECORD_FLAGS.map((flag) => (flag === "C0ISO" ? "D0DM" : flag));

  it("parks a card carrying a link with no flag typed, the receipt read off the message", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: DM_FLAGS }),
      deps: draftDeps({ recording: seen, stdin: LINKED }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).receipts).toEqual({ kind: "attached", links: [THREAD_LINK], media: 0 });
  });

  it("parks a card that says what it tried, and one whose file is its receipt", async () => {
    const tried = freshRecording();
    const filed = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail: [...DM_FLAGS, "--tried", "Vanta's test page needs a sign-in the fleet lacks"] }),
      deps: draftDeps({ recording: tried, stdin: MFA }),
    });
    await runSlackDraftWithDeps({
      argv: argv({ tail: [...DM_FLAGS, "--media", "/tmp/still.png"] }),
      deps: draftDeps({ recording: filed, stdin: MFA }),
    });
    expect(parkedIn({ events: tried.appended }).receipts).toEqual({
      kind: "tried",
      tried: "Vanta's test page needs a sign-in the fleet lacks",
    });
    expect(parkedIn({ events: filed.appended }).receipts).toEqual({ kind: "attached", links: [], media: 1 });
  });

  it("REFUSES a re-cut calling itself self-evident when the owner sent the row it re-cuts back for its receipts", async () => {
    const refused = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_UNPROVEN, "--supersedes", "sd-11112222"] }),
      deps: draftDeps({ log: seededLog(), receipts: [SENT_BACK], recording: refused, stdin: MFA }),
    });
    const tried = freshRecording();
    const parked = await runSlackDraftWithDeps({
      argv: argv({
        tail: [
          ...RECORD_FLAGS,
          ...FIRST_MESSAGE_SHOT,
          "--supersedes",
          "sd-11112222",
          "--tried",
          "the page needs a sign-in",
        ],
      }),
      deps: draftDeps({
        log: seededLog(),
        receipts: [SENT_BACK],
        recording: tried,
        stdin: JSON.stringify(shown({ lines: ["Vanta's MFA test flipped to Needs attention today, on one account."] })),
      }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(refused.appended).toEqual([]);
    expect(parked).toBe(EXIT_OK);
  });

  it("owes no receipt on a bump, which asserts nothing new", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...RECORD_FLAGS, "--act", "bump"] }),
      deps: draftDeps({ recording: seen, stdin: MFA }),
    });
    expect(code).toBe(EXIT_OK);
    expect(parkedIn({ events: seen.appended }).receipts).toBe(undefined);
  });
});
