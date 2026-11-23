/**
 * REPLAY LANE — the dead-Datadog-host answer, its reviewed draft re-sent through the SHIPPED Slack
 * write client.
 *
 * The bot answered a team thread about a temp PR's monitors, and two of the answer's citations opened
 * `app.ap2.datadoghq.com` — a host that serves no Datadog console. The owner's word: ban it from every outbound
 * write, with enforcement stronger than a review. The fixture (`fixtures/replay/dead-datadog-host-answered-24sep`)
 * is that ask's record set frozen `--through dispatched` with its clock just before the send, so it holds both
 * drafts the worker validated and both review rounds, and not the `answered` event the defect produced. The
 * freeze keeps a banned console host and blanks its path (`live/turn/freeze/redact.ts`), which is what leaves
 * this replay anything to refuse.
 *
 * **Why this re-sends in-process rather than spawning `turn answer`.** The spawned verb reaches the Slack client
 * only with a bot token, and a replay home deliberately carries none — a fake one would put a real request to
 * Slack on the path the moment the refusal failed to fire. So the test runs the same three shipped steps `turn
 * answer` does — parse the draft with the answer form, render it with `renderAssistantAnswer`, hand the payload
 * to `makeSlackWriteTransport`'s `postAssistantMessage`, the live send path — and the one it proves is the last:
 * the write client refuses before the SDK sends.
 *
 * **The falsifiable witness.** The refusal names `ap2.datadoghq.com` and the payload path it found the dead host
 * at. The binding below reddens if the fixture ever stops carrying the host, so an empty payload can never pass
 * this as silence.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { PLACEMENT_OUT_OF_SCOPE } from "../../../corpus/slack/writeGuardPlacement.js";
import { exactRecordedAskIdentity } from "../../../live/ask/identity.js";
import { checkpointDir, readCheckpointSet } from "../../../live/turn/checkpointStore.js";
import { type AnswerFormAnswer, answerFormSchema } from "../../../outbound/assistant/answerForm.js";
import { renderAssistantAnswer } from "../../../outbound/assistant/answerMessage.js";
import type { SlackCardChrome } from "../../../outbound/slack/types.js";
import { REPEAT_GUARD_OUT_OF_SCOPE } from "../../repeatGuardOutOfScope.js";
import { materialiseFixture } from "../../replayFixture.js";

/** The frozen ask, under the freeze's synthetic channel id. */
const ASK = { channel: "CFIXTUREAA", messageTs: "1790216303.662629", threadTs: "1790208337.731879" };

/** Neutral chrome — never a real operator's bot name. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#ABCDEF",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-dead-dd-host-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * The draft parsed through the answer form, as the send path parses it.
 *
 * @param text the draft file's text
 * @returns the answer arm
 */
function answerArmOf({ text }: { text: string }): AnswerFormAnswer {
  const form = answerFormSchema.parse(JSON.parse(text));
  if (form.kind !== "answer") {
    throw new Error(`the frozen draft parsed as a ${form.kind} form, not an answer`);
  }
  return form;
}

/**
 * The last draft the worker validated, as the file the freeze wrote.
 *
 * @returns the draft's raw text
 */
function lastDraftText(): string {
  const drafts = readCheckpointSet({ askIdentity: ASK, home }).drafts;
  const last = drafts.at(-1)!;
  return readFileSync(join(checkpointDir({ askIdentity: ASK, home }), last.draftFile), "utf8");
}

describe("replay: dead-datadog-host-answered-24sep", () => {
  it("binds: the frozen draft still carries the dead host the answer linked", () => {
    materialiseFixture({ into: home, slug: "dead-datadog-host-answered-24sep" });
    expect(readCheckpointSet({ askIdentity: ASK, home }).drafts.length).toBe(2);
    expect(lastDraftText()).toContain("https://app.ap2.datadoghq.com/[REDACTED]");
  });

  it("refuses the rendered answer at the Slack write client, naming ap2.datadoghq.com", async () => {
    materialiseFixture({ into: home, slug: "dead-datadog-host-answered-24sep" });
    const payload = renderAssistantAnswer({
      answer: answerArmOf({ text: lastDraftText() }),
      askIdentity: exactRecordedAskIdentity({ askIdentity: ASK }),
      chrome: CHROME,
      mentions: { groups: new Map(), people: new Map() },
    });
    const transport = makeSlackWriteTransport({
      home,
      placementSeams: PLACEMENT_OUT_OF_SCOPE,
      repeatSeams: REPEAT_GUARD_OUT_OF_SCOPE,
      token: "xoxb-not-a-real-token",
    });
    await expect(
      transport.postAssistantMessage({ channel: ASK.channel, payload, threadTs: ASK.threadTs }),
    ).rejects.toThrow(
      /^slack chat\.postMessage blocked because .*app\.ap2\.datadoghq\.com is not a Datadog console; use ap2\.datadoghq\.com — found at attachments\.0\.blocks\./u,
    );
  });
});
