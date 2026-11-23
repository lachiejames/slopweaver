import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "../ownDmFakes.js";
import { argv, freshHome, harness, removeFixtureDirs } from "./harness.js";
import { homeWithShot, logOf, parkedRow, postedPayload, releaseArgv } from "./release.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me — the opening leads with the discussion, never a pull request", () => {
  const PR_LED = JSON.stringify({
    kind: "one-card",
    lines: [{ runs: [{ text: "Approve the fix PR for the gateway outage, so events recover.", type: "text" }] }],
  });
  /** The same opening with its evidence link on a line of its own, so a parked row owes the channel's first-message proof only its picture. */
  const PR_LED_LINKED = JSON.stringify({
    kind: "one-card",
    lines: [
      { runs: [{ text: "Approve the fix PR for the gateway outage, so events recover.", type: "text" }] },
      { runs: [{ label: "the outage", type: "link", url: "https://fixture.example/pool" }] },
    ],
  });
  const MOVED = [{ text: "never mind, already fixed it", ts: "1790200000.000100", user: "U0PERSON" }];

  it("refuses a fresh send to a teammate, posting nothing — not even the render proof", async () => {
    const h = harness({ stdin: PR_LED });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("sends the same words to the owner's own bot DM, which no teammate reads", async () => {
    const h = harness({ stdin: PR_LED });

    const code = await runSlackWrite({
      argv: argv({ channel: "D0PROMPT", home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual([
      "Approve the fix PR for the gateway outage, so events recover.",
    ]);
  });

  it("refuses the same words to a colleague's DM configured as the owner's prompt channel, posting nothing", async () => {
    const ownDm = recordingOwnDm({ answer: NOTHING_PROVEN });
    const h = harness({ ownDm: ownDm.verify, stdin: PR_LED });

    const code = await runSlackWrite({
      argv: argv({ channel: PROMPT_DM, home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(ownDm.asked).toEqual([PROMPT_DM]);
    expect(h.sends).toEqual([]);
  });

  it.each([
    { code: EXIT_OK, name: "previews it cleanly once the read proves the DM the owner's", ownDm: PROMPT_DM_IS_OWNERS },
    { code: EXIT_USAGE, name: "refuses the preview when the read names somebody else", ownDm: NOTHING_PROVEN },
  ])("a dry run to the prompt channel $name, exactly as the send would", async ({ code, ownDm }) => {
    const asked: string[] = [];
    const h = harness({
      ownDm: async (args) => {
        asked.push(args.channel);
        return ownDm(args);
      },
      stdin: PR_LED,
    });

    const exit = await runSlackWrite({
      argv: argv({ channel: PROMPT_DM, extra: ["--dry-run"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(exit).toBe(code);
    expect(asked).toEqual([PROMPT_DM]);
    expect(h.sends).toEqual([]);
  });

  it("refuses to release a row parked before the gate existed, sending nothing", async () => {
    const { home, media } = homeWithShot();
    const row = parkedRow({
      form: PR_LED_LINKED,
      media,
      payload: await postedPayload({ channel: "D0PROMPT", form: PR_LED_LINKED }),
    });
    const h = harness({ draftLog: logOf({ row }) });

    const code = await runSlackWrite({
      argv: releaseArgv({ approve: row.digest, home, id: row.id }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
    expect(h.draftEvents).toEqual([]);
  });

  it("judges a --thanks-instead release on the thanks line it sends, never the row's words", async () => {
    const { home, media } = homeWithShot();
    const row = parkedRow({
      form: PR_LED_LINKED,
      media,
      payload: await postedPayload({ channel: "D0PROMPT", form: PR_LED_LINKED }),
    });
    const h = harness({ draftLog: logOf({ row }), releaseConversation: MOVED });

    const code = await runSlackWrite({
      argv: releaseArgv({
        approve: row.digest,
        extra: ["--thanks-instead", "Thanks for the review.", "--thread-moved-cleared", "1790200000.000100"],
        home,
        id: row.id,
      }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual(["Thanks for the review."]);
  });
});
