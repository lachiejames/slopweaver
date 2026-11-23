import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { readSlackSendFailures } from "../../../../../admit/slackSendFailureStore.js";
import type { SlackDraftReleaseOptions } from "../../../../../cli/commands/slack/coreTypes.js";
import { markDraftReleased } from "../../../../../cli/commands/slack/releaseRow.js";
import { resolveDraftRelease } from "../../../../../cli/commands/slack/releaseRun.js";
import { releaseAsThanks } from "../../../../../cli/commands/slack/releaseThanks.js";
import type { SlackWriteDeps } from "../../../../../cli/commands/slack/run.js";
import { dripConfigFromProfile } from "../../../../../cli/commands/slack/wiring.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";

/** One held row in a direct message, its digest computed the way the recorder computes it. */
function heldRow(): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: "D1",
    mentions: [],
    payload: { form: "plain" as const, text: "hello", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"hello"}]}',
    id: "sd-1a2b3c4d",
    shape: "top-level",
    tsIso: "2026-09-23T12:00:00.000Z",
    why: "the thanks release under test",
  };
}

let home = "";

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("releaseAsThanks", () => {
  it("journals and holds a throw in its thread re-read, then lets it propagate, sending nothing", async () => {
    home = mkdtempSync(join(tmpdir(), "release-thanks-"));
    const row = heldRow();
    const log = [slackDraftEventLine({ event: { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso } })];
    const options: SlackDraftReleaseOptions = {
      actor: "me",
      dryRun: false,
      home,
      json: false,
      release: { approve: row.digest, draftId: row.id },
      resendUnconfirmed: false,
      thanksInstead: "Thanks for the review",
      verb: "post",
    };
    const events: SlackDraftEvent[] = [];
    const known = {
      appendDraftEvent: ({ event }: { event: SlackDraftEvent }) => {
        events.push(event);
        return ok(undefined);
      },
      botMembership: async () => "unknown" as const,
      botToken: () => undefined,
      conversationSurface: async () => "direct-message" as const,
      readDraftLog: () => log,
      readDraftMedia: () => ok([]),
      whoAmI: async () => ({ userId: "U1" }),
    };
    // The thread re-read is no known dependency, so it throws; every send seam would throw the same way if reached.
    const deps = new Proxy(known, {
      get: (target, property) =>
        property in target
          ? (target as unknown as Record<string, unknown>)[property as string]
          : () => {
              throw new Error("the thread read failed");
            },
    }) as unknown as SlackWriteDeps;
    const resolved = unwrap(await resolveDraftRelease({ deps, options, token: "xoxp-test" }));

    await expect(
      releaseAsThanks({
        config: unwrap(dripConfigFromProfile({ home })),
        deps,
        options,
        resolved,
        thanks: "Thanks for the review",
        token: "xoxp-test",
      }),
    ).rejects.toThrow("the thread read failed");
    const why = "the release stopped on an error before sending: the thread read failed";
    expect(unwrap(readSlackSendFailures({ home })).map(({ channel, error }) => ({ channel, error }))).toEqual([
      { channel: "D1", error: why },
    ]);
    expect(events.map((event) => ({ id: event.id, kind: event.kind }))).toEqual([{ id: row.id, kind: "held" }]);
  });
});

describe("markDraftReleased", () => {
  /** The released event one call journals. */
  function releasedWith({ thanksInstead }: { thanksInstead: string | undefined }): SlackDraftEvent {
    home = mkdtempSync(join(tmpdir(), "release-thanks-"));
    const events: SlackDraftEvent[] = [];
    const appendDraftEvent = ({
      event,
    }: {
      event: SlackDraftEvent;
    }): ReturnType<SlackWriteDeps["appendDraftEvent"]> => {
      events.push(event);
      return ok(true);
    };
    const code = markDraftReleased({
      deps: { appendDraftEvent },
      draft: heldRow(),
      heldCuts: [],
      home,
      permalink: undefined,
      thanksInstead,
      ts: "1790000000.000100",
    });
    expect(code).toBe(0);
    return events[0]!;
  }

  it("journals the digest the words it sent carry, so a revision landing mid-send cannot claim the release", () => {
    expect(releasedWith({ thanksInstead: undefined })).toMatchObject({ digest: heldRow().digest, kind: "released" });
  });

  it("journals no digest when a thanks line went out instead, since none of the row's words did", () => {
    const event = releasedWith({ thanksInstead: "Thanks for the review" });
    expect(event).toMatchObject({ kind: "released", thanksInstead: "Thanks for the review" });
    expect(Object.keys(event)).not.toContain("digest");
  });
});
