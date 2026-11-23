/*
 * The record path's register refusals, before any Slack read: a re-cut naming a row the register does not hold as held
 * parks nothing. The record run itself is driven end to end through `runSlackDraftWithDeps` in `./draftVerb/`.
 */

import { describe, expect, it } from "vitest";

import type { DraftRecordOptions } from "../../../../../cli/commands/slack/draftCore.js";
import { parseSlackDraftArgs } from "../../../../../cli/commands/slack/draftCore.js";
import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import { registerRefusals } from "../../../../../cli/commands/slack/draftRecordRegister.js";
import { draftUsageExit } from "../../../../../cli/commands/slack/draftRecordRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";

/** A parsed `slack draft record` carrying these extra flags. */
function recordOptions({ extra }: { extra: readonly string[] }): DraftRecordOptions {
  const parsed = unwrap(
    parseSlackDraftArgs({
      defaultHome: "/tmp/no-home",
      rest: ["record", "--channel", "C1", "--form", "-", "--why", "w", "--asked-before", "none", ...extra],
    }),
  );
  expect(parsed.mode).toBe("record");
  return parsed as DraftRecordOptions;
}

describe("registerRefusals", () => {
  it("lets a top-level recording that re-cuts nothing through without reading the register", () => {
    expect(registerRefusals({ deps: { readLog: () => [] }, options: recordOptions({ extra: [] }) })).toEqual([]);
  });

  it("refuses a re-cut naming a row the register does not hold", () => {
    const refused = registerRefusals({
      deps: { readLog: () => [] },
      options: recordOptions({ extra: ["--supersedes", "sd-11112222"] }),
    });

    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("--supersedes sd-11112222: ");
    expect(refused[0]).toContain("— nothing was parked. Name the cut that is still held.");
  });

  it("refuses a second follow-up card for one finding before any Slack read, and parks the first", () => {
    const content = {
      authorId: "U0SYNBOT12345",
      channel: "C1",
      mentions: [],
      payload: { form: "plain" as const, text: "the finding", unfurl_links: false, unfurl_media: false },
    };
    const finding: ParkedSlackDraft = {
      ...content,
      advisory: [],
      digest: parkedDraftDigest({ draft: content }),
      form: "{}",
      id: "sd-aa000001",
      kind: "finding",
      shape: "top-level",
      tsIso: "2026-10-14T17:00:00.000Z",
      why: "the finding",
    };
    const shared: readonly SlackDraftEvent[] = [
      { draft: finding, id: finding.id, kind: "parked", tsIso: finding.tsIso },
      { channel: "C1", id: finding.id, kind: "released", ts: "1792000000.000100", tsIso: "2026-10-14T18:00:00.000Z" },
    ];
    const card: SlackDraftEvent = {
      draft: { ...finding, act: "bump", followupOf: finding.id, id: "sd-bb000001", kind: "message" },
      id: "sd-bb000001",
      kind: "parked",
      tsIso: "2026-10-16T00:00:00.000Z",
    };
    const options = recordOptions({
      extra: ["--act", "bump", "--followup-of", finding.id, "--thread-ts", "1792000000.000100"],
    });
    const lines =
      ({ events }: { events: readonly SlackDraftEvent[] }) =>
      () =>
        events.map((event) => slackDraftEventLine({ event }));

    expect(registerRefusals({ deps: { readLog: lines({ events: shared }) }, options })).toEqual([]);
    expect(registerRefusals({ deps: { readLog: lines({ events: [...shared, card] }) }, options })).toEqual([
      "slack draft record --followup-of sd-aa000001: that finding's one follow-up card is already spent by sd-bb000001 — held, sent or dropped, it was the owner's to decide once; re-cut it with --supersedes while it is held",
      NOTHING_PARKED,
    ]);
    // The spending park carries a reviewer this version does not know, so the line does not read.
    const unread = JSON.stringify({ ...card, draft: { ...card.draft, reviewer: "future-context" } });
    const withUnread = () => [...lines({ events: shared })(), unread];
    expect(registerRefusals({ deps: { readLog: withUnread }, options })).toEqual([
      "slack draft record --followup-of sd-aa000001: 1 draft register line(s) (line 3) did not read and may be this finding's follow-up card — nothing parks until they read",
      NOTHING_PARKED,
    ]);
  });
});

describe("draftUsageExit", () => {
  it("exits as a caller mistake, so a harness never counts a refusal as a fault", () => {
    expect(draftUsageExit({ errors: ["the message's first block leads with a pull request"] })).toBe(EXIT_USAGE);
  });
});
