/**
 * REPLAY LANE — the real-world tagging dogfood's first tag, re-run against the SHIPPED pure
 * functions over the ask's own frozen record set.
 *
 * The fixture (`fixtures/replay/task-label-self-address`) is that ask's own record set — `D0SYN000001/
 * 1787993553.285869`, the doc's own reproduction — frozen with no event withheld: the whole answered turn.
 * The raw Slack text a replay assertion needs is not itself in the allowlist (a whole question is not a key
 * any replay reads, so `turn freeze` redacts it), so it is reproduced from the handover doc here — with the
 * addressing id swapped for a short synthetic one, since the hygiene gate flags any real Slack-id-shaped
 * token regardless of secrecy — exactly as the `rc-live-status` fixture quotes its own measured screen: the
 * fixture proves the real ask's shape survived the freeze, the constant carries the real words that
 * triggered the defect.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { stripMentionTags } from "../../../live/listen/mention.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "task-label-self-address";

/** What the owner actually tagged, from the handover doc — redacted out of the fixture itself. */
const RAW_SLACK_TEXT =
  "<@U1> which of my open PRs in acme/acme-admin are waiting on someone else right now, and who is the blocker on each?";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-task-label-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

describe("replay: task-label-self-address", () => {
  it("labels the incident's own real ask without the raw addressing id, over the shipped pure functions", () => {
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
    expect(entry?.channel).toBe(manifest.ask.channel);

    const stripped = stripMentionTags({ text: RAW_SLACK_TEXT });
    expect(stripped.startsWith("@(")).toBe(true);
    expect(turnTaskLabel({ question: stripped })).toBe("answering: which of my open PRs in acme/acme-admin are wai…");
  });

  it("froze the whole answered turn, withholding nothing", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.withheldEventKinds).toEqual([]);
  });
});
