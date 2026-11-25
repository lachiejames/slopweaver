/**
 * REPLAY LANE — the tag that got no card, re-run against the SHIPPED pure functions over the ask's
 * own frozen record set.
 *
 * The fixture (`fixtures/replay/long-link-label-refused-24sep`) is ask `C0SYN000001`/`1790222247.843029`
 * frozen `--through captured`: the moment before the capture-time checklist post, which is where the defect
 * fired. Its task label clamped `• close <https://linear.app/…|HELP-2878>` mid link markup, and the wire
 * guard refused the unclosed `<https://linear.app/acme/issue/HELP-…` it left as a raw URL in a plain TEXT
 * run — on the capture card and again on the dispatch card. The question itself is redacted out of the
 * fixture (no replay key reads a whole question), so it is reproduced here with the addressing id swapped for
 * a short synthetic one, exactly as `taskLabelSelfAddress.test.ts` does.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { dispatchedCardFrame, firstCardFrame } from "../../../live/listen/capture.js";
import { renderTurnMessage } from "../../../outbound/assistant/turnMessage.js";
import { typedRunsOnlyViolations } from "../../../outbound/slack/typedRunsOnly.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "long-link-label-refused-24sep";

/** What the owner tagged, as the socket path normalised it — redacted out of the fixture itself. */
const NORMALISED_QUESTION =
  "@(U1) • close <https://linear.app/acme/issue/HELP-2878/vanta-remediate-cloudflare-ip-access-rules-enabled-for-no-active|HELP-2878> • the Acme audit needs files to upload properly inside of Vanta, so if that's a feature that doesn't work, then it gets built as a new slopweaver PR and used here to upload the files properly (as well as dogfood).";

/** The wire guard's verdict on a card wearing `frame`, rendered exactly as the checklist post renders it. */
function wireViolations({
  frame,
}: {
  frame: { steps: Parameters<typeof renderTurnMessage>[0]["steps"]; task: string };
}): readonly string[] {
  const payload = renderTurnMessage({
    asOfEpochSeconds: 1790222248,
    asOfFallback: "just now",
    chrome: {
      authorEmoji: ":robot_face:",
      authorLabel: "replay-bot",
      bannerColor: "#8B5CF6",
      detailLabel: "*Details*",
      metadataEventType: "replay_turn_v1",
    },
    modelId: "claude",
    steps: frame.steps,
    task: frame.task,
    turnId: "turn-1",
  });
  return typedRunsOnlyViolations({ payload });
}

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-long-link-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

describe("replay: long-link-label-refused-24sep", () => {
  it("froze the ask at its capture, before the refused checklist post", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const { events } = parseAskLifecycleLog({ text: readFileSync(join(home, "live/slack/asks.jsonl"), "utf8") });
    const entry = foldAskLifecycle({ events }).get(
      askLifecycleKey({
        askIdentity: {
          channel: manifest.ask.channel,
          messageTs: manifest.ask.messageTs,
          threadTs: manifest.ask.threadTs,
        },
      }),
    );
    expect(entry!.channel).toBe(manifest.ask.channel);
    expect(manifest.withheldEventKinds).toEqual(["checklist-posted", "dispatched"]);
  });

  it("labels the incident's own question with the link's label, and both cards pass the wire guard", () => {
    const captured = firstCardFrame({ question: NORMALISED_QUESTION });
    expect(captured.task).toBe("answering: • close HELP-2878 • the Acme audit needs files …");
    expect(wireViolations({ frame: captured })).toEqual([]);
    expect(wireViolations({ frame: dispatchedCardFrame({ question: NORMALISED_QUESTION, timeline: [] }) })).toEqual([]);
  });
});
