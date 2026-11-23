import { describe, expect, it } from "vitest";

import { type PollPostOptions, parsePollForm } from "../../../../../cli/commands/slack/pollCore.js";
import { composeAndProve, composePollPlan, emitPollDryRun } from "../../../../../cli/commands/slack/pollPreview.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { SlackCardChrome } from "../../../../../outbound/slack/types.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "./ownDmFakes.js";

const HOME = "/tmp/home";
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "unused_card_v1",
};
const PROFILE = { cardChrome: () => CHROME, pollEventType: () => "slopweaver_poll_v1" };

/** A poll whose question leads with a pull request, so only a proven own DM lets it through. */
const PR_LED = unwrap(
  parsePollForm({
    json: JSON.stringify({
      kind: "poll",
      options: ["Yes", "Not yet"],
      question: "Approve the fix PR for the gateway outage?",
      why: "Events are dropping until it lands.",
    }),
  }),
);

function postTo({ channel }: { channel: string }): PollPostOptions {
  return { channel, dryRun: true, formSource: "-", home: HOME, json: false, mode: "post" };
}

describe("composeAndProve", () => {
  it("composes the poll offline as a DM, then asks for the proof of exactly that destination", async () => {
    const seam = recordingOwnDm({ answer: PROMPT_DM_IS_OWNERS });
    const options = postTo({ channel: PROMPT_DM });

    const proved = await composeAndProve({
      artifact: PR_LED,
      deps: { ...PROFILE, verifiedOwnDm: seam.verify },
      options,
      pings: [],
    });

    expect(seam.asked).toEqual([PROMPT_DM]);
    expect(proved.surface).toBe("direct-message");
    expect(proved.verifiedOwnDm).toBe(PROMPT_DM);
    expect(proved.plan).toEqual(
      composePollPlan({ artifact: PR_LED, deps: PROFILE, options, pings: [], surface: "direct-message" }),
    );
  });

  it("proves nothing for a channel, composed as a shared channel", async () => {
    const seam = recordingOwnDm({ answer: PROMPT_DM_IS_OWNERS });

    const proved = await composeAndProve({
      artifact: PR_LED,
      deps: { ...PROFILE, verifiedOwnDm: seam.verify },
      options: postTo({ channel: "C1" }),
      pings: [],
    });

    expect(seam.asked).toEqual(["C1"]);
    expect(proved.surface).toBe("shared-channel");
    expect(proved.verifiedOwnDm).toBeUndefined();
  });
});

describe("emitPollDryRun", () => {
  it("holds a PR-led poll, printing no preview, when nothing proved the DM the owner's", async () => {
    const options = postTo({ channel: PROMPT_DM });
    const proved = await composeAndProve({
      artifact: PR_LED,
      deps: { ...PROFILE, verifiedOwnDm: NOTHING_PROVEN },
      options,
      pings: [],
    });
    const emitted: string[] = [];

    const exit = emitPollDryRun({ ...proved, emit: (line) => emitted.push(line), options });

    expect(exit).toBe(EXIT_EXPECTED_EMPTY);
    expect(emitted).toEqual([]);
  });

  it("previews it in the owner's proven own DM, naming the surface it assumed from the id last", async () => {
    const options = postTo({ channel: PROMPT_DM });
    const proved = await composeAndProve({
      artifact: PR_LED,
      deps: { ...PROFILE, verifiedOwnDm: PROMPT_DM_IS_OWNERS },
      options,
      pings: [],
    });
    const emitted: string[] = [];

    const exit = emitPollDryRun({ ...proved, emit: (line) => emitted.push(line), options });

    expect(exit).toBe(EXIT_OK);
    expect(emitted.at(-1)).toBe(
      `  the footer above assumes ${PROMPT_DM} is a DM, from its id. The real send confirms that with Slack and refuses if it cannot.`,
    );
  });
});
