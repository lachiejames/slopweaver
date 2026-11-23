import { describe, expect, it } from "vitest";
import { STDIN_SENTINEL } from "../../../../../../cli/commands/slack/coreTypes.js";
import { SlackLifecycleErrors } from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { heldRowOf } from "../../../../../../cli/commands/slack/releaseHeldRow.js";
import { resolveDraftRelease } from "../../../../../../cli/commands/slack/releaseRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";
import { FORM, heldRow, logOf, NO_BOT, releaseOf, VIDEO, verifiedOf } from "./fixtures.js";

/** A row recorded into a group DM, stamped and digested as an `--as me` recording stamps one. */
function groupDmRow(): ParkedSlackDraft {
  const { advisory, form, id, shape, tsIso, why } = heldRow();
  const content = {
    authorId: "U0ME",
    channel: "C0SYN000021",
    groupDm: true as const,
    mentions: [],
    payload: { form: "plain" as const, text: "hello", unfurl_links: false, unfurl_media: false },
  };
  // `message`, as a recording declares: a kind-less top-level channel row is held as a finding, a different proof.
  const kind = "message" as const;
  return { ...content, advisory, digest: parkedDraftDigest({ draft: content }), form, id, kind, shape, tsIso, why };
}

describe("resolveDraftRelease", () => {
  it("sends the row's own form to the row's channel, exempting a direct message from the bump gate", async () => {
    const row = heldRow();
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "direct-message",
        readDraftLog: () => logOf({ row }),
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrap(resolved).drip).toEqual({
      actor: "me",
      bumpExemption: "direct-message",
      channel: "D1",
      dryRun: false,
      home: "/unused",
      json: false,
      media: [],
      resendUnconfirmed: false,
      reviewer: "approved",
      shape: "top-level",
      source: { json: FORM, kind: "form" },
      verb: "post",
    });
    expect(unwrap(resolved).media.size).toBe(0);
  });

  it("re-reads a group-DM stamp live: a conversation still a group DM releases, one that no longer reads so refuses", async () => {
    const row = groupDmRow();
    const asked: string[] = [];
    const resolveWith = ({ answer }: { answer: true | undefined }) =>
      resolveDraftRelease({
        deps: {
          ...NO_BOT,
          conversationGroupDm: async ({ channel, token }) => {
            asked.push(`${channel}:${token}`);
            return answer;
          },
          conversationSurface: async () => "private-channel",
          readDraftLog: () => logOf({ row }),
          readDraftMedia: () => ok([]),
        },
        options: releaseOf({ approve: row.digest }),
        token: "xoxp-test",
      });
    const still = await resolveWith({ answer: true });
    const moved = await resolveWith({ answer: undefined });
    expect(unwrap(still).drip.channel).toBe("C0SYN000021");
    expect(unwrapErr(moved).message).toBe(
      "sd-1a2b3c4d is stamped a group DM, but C0SYN000021 does not read as one now, so it owes the first-message " +
        "proof: re-record it with --media <annotated screenshot> — nothing was sent.",
    );
    expect(asked).toEqual(["C0SYN000021:xoxp-test", "C0SYN000021:xoxp-test"]);
  });

  it("keys each verified attachment as the drip names it, in attach order, numbered so a repeat stays two", async () => {
    const row = heldRow({ media: [VIDEO, VIDEO] });
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "private-channel",
        readDraftLog: () => logOf({ row }),
        readDraftMedia: ({ media }) => ok(media.map((record) => verifiedOf({ record }))),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    const keys = [`draft-media/1/${VIDEO.sha256}/walkthrough.mp4`, `draft-media/2/${VIDEO.sha256}/walkthrough.mp4`];
    expect(unwrap(resolved).drip.media).toEqual(keys);
    expect([...unwrap(resolved).media.keys()]).toEqual(keys);
  });

  it("refuses a stored attachment the store cannot vouch for BEFORE the surface read", async () => {
    const row = heldRow({ media: [VIDEO] });
    const surfaces: string[] = [];
    const missing = SlackDraftErrors.mediaMissing({ name: VIDEO.name, path: "/h/blob", sha256: VIDEO.sha256 });
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async ({ channel }) => {
          surfaces.push(channel);
          return "private-channel";
        },
        readDraftLog: () => logOf({ row }),
        readDraftMedia: () => err(missing),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrapErr(resolved)).toEqual(
      SlackLifecycleErrors.draftMediaUnavailable({ draftId: row.id, reason: missing.message }),
    );
    expect(unwrapErr(resolved).code).toBe("DRAFT_MEDIA_UNAVAILABLE");
    expect(surfaces).toEqual([]);
  });

  it("refuses an approval naming other bytes before reading the surface", async () => {
    const row = heldRow();
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "public-channel",
        readDraftLog: () => logOf({ row }),
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: "0000000000000000" }),
      token: "xoxp-test",
    });

    expect(unwrapErr(resolved)).toEqual(
      SlackLifecycleErrors.draftApprovalMismatch({ approve: "0000000000000000", digest: row.digest, draftId: row.id }),
    );
    expect(unwrapErr(resolved).message).toContain("is not draft sd-1a2b3c4d's digest");
  });

  it("refuses a held row a line it passed over names, since that line may have spent it", async () => {
    const row = heldRow();
    const newer = JSON.stringify({ id: row.id, kind: "edited", schemaVersion: 1, tsIso: "2026-09-28T14:00:00Z" });
    const surfaces: string[] = [];
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async ({ channel }) => {
          surfaces.push(channel);
          return "direct-message";
        },
        readDraftLog: () => [...logOf({ row }), newer],
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrapErr(resolved).message).toBe(
      "1 line of the as-me draft register this version cannot read passed over, with every draft they name: " +
        "line 2 (edited sd-1a2b3c4d) — nothing was sent.",
    );
    expect(surfaces).toEqual([]);
  });

  it("refuses a held row when a line it passed over names no draft, since that line could be anything", async () => {
    const row = heldRow();
    const surfaces: string[] = [];
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async ({ channel }) => {
          surfaces.push(channel);
          return "direct-message";
        },
        readDraftLog: () => [...logOf({ row }), "{not json"],
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrapErr(resolved).message).toBe(
      "1 line of the as-me draft register this version cannot read passed over, with every draft they name: " +
        "line 2 (names no draft) — nothing was sent.",
    );
    expect(surfaces).toEqual([]);
  });

  it("releases a held row when the line it passed over names another", async () => {
    const row = heldRow();
    const newer = JSON.stringify({
      id: "sd-99999999",
      kind: "edited",
      schemaVersion: 1,
      tsIso: "2026-09-28T14:00:00Z",
    });
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "direct-message",
        readDraftLog: () => [...logOf({ row }), newer],
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrap(resolved).drip.channel).toBe("D1");
  });

  // A re-cut whose drop failed leaves two cards held, and their words need not match.
  it("refuses a second follow-up card for a finding once one went, whatever its words", () => {
    const sent: ParkedSlackDraft = { ...heldRow(), act: "bump", followupOf: "sd-aa000001", id: "sd-0dd0c0de" };
    const content = {
      ...heldRow(),
      payload: { form: "plain" as const, text: "other words", unfurl_links: false, unfurl_media: false },
    };
    const second: ParkedSlackDraft = {
      ...content,
      act: "bump",
      digest: parkedDraftDigest({ draft: content }),
      followupOf: "sd-aa000001",
    };
    const readDraftLog = () => [
      ...logOf({ row: sent }),
      slackDraftEventLine({
        event: {
          channel: "D1",
          id: sent.id,
          kind: "released",
          ts: "1790604264.247109",
          tsIso: "2026-09-28T14:01:00.000Z",
        },
      }),
      ...logOf({ row: second }),
    ];
    expect(unwrapErr(heldRowOf({ deps: { readDraftLog }, draftId: second.id, home: "/tmp/no-home" })).message).toBe(
      `${second.id} follows up sd-aa000001, whose one follow-up card sd-0dd0c0de already went; ` +
        `drop it with \`slopweaver slack draft drop ${second.id} --note "superseded by sd-0dd0c0de"\` — nothing was sent.`,
    );
  });

  // The Queue hides a held finding without its proof, so a release must not go round it.
  it("refuses a held finding with no screenshot, link or impact, and releases one carrying all three", () => {
    const bare: ParkedSlackDraft = { ...heldRow(), kind: "finding" };
    const refused = heldRowOf({ deps: { readDraftLog: () => logOf({ row: bare }) }, draftId: bare.id, home: "/tmp/x" });
    expect(unwrapErr(refused).message).toContain(`${bare.id} raises a finding and is missing screenshot, link, impact`);
    const proved: ParkedSlackDraft = {
      ...heldRow({ media: [VIDEO] }),
      impact: "12 users could not check out",
      kind: "finding",
      payload: {
        form: "plain",
        text: "12 users could not check out <https://grafana.example.com/d/pool|pool>",
        unfurl_links: false,
        unfurl_media: false,
      },
    };
    const released = heldRowOf({
      deps: { readDraftLog: () => logOf({ row: proved }) },
      draftId: proved.id,
      home: "/tmp/x",
    });
    expect(unwrap(released).row.id).toBe(proved.id);
  });

  // Two held cards for one finding refuse each other, so two releases racing past each other's read both
  // stop rather than both sending.
  it("refuses either of two held follow-up cards for one finding until one is dropped", () => {
    const first: ParkedSlackDraft = { ...heldRow(), act: "bump", followupOf: "sd-aa000001", id: "sd-0dd0c0de" };
    const content = {
      ...heldRow(),
      payload: { form: "plain" as const, text: "other words", unfurl_links: false, unfurl_media: false },
    };
    const second: ParkedSlackDraft = {
      ...content,
      act: "bump",
      digest: parkedDraftDigest({ draft: content }),
      followupOf: "sd-aa000001",
    };
    const readDraftLog = () => [...logOf({ row: first }), ...logOf({ row: second })];
    const reasonOf = ({ id }: { id: string }): string =>
      unwrapErr(heldRowOf({ deps: { readDraftLog }, draftId: id, home: "/tmp/no-home" })).message;
    const tail =
      `held too; one card per finding, so drop the one you do not want ` +
      `(\`slopweaver slack draft drop <id> --note "one card per finding"\`) and release the other — nothing was sent.`;
    expect(reasonOf({ id: first.id })).toBe(
      `${first.id} follows up sd-aa000001, and ${second.id} is a second card for it, ${tail}`,
    );
    expect(reasonOf({ id: second.id })).toBe(
      `${second.id} follows up sd-aa000001, and ${first.id} is a second card for it, ${tail}`,
    );
  });

  it("refuses a second release of the same message under a new id, naming where the first landed", async () => {
    const row = heldRow();
    const first: ParkedSlackDraft = { ...row, id: "sd-0dd0c0de", tsIso: "2026-09-28T14:00:00.000Z" };
    const permalink = "https://acme.slack.com/archives/D1/p1790604264247109";
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "direct-message",
        readDraftLog: () => [
          ...logOf({ row: first }),
          slackDraftEventLine({
            event: {
              channel: "D1",
              id: first.id,
              kind: "released",
              permalink,
              ts: "1790604264.247109",
              tsIso: "2026-09-28T14:01:00.000Z",
            },
          }),
          ...logOf({ row }),
        ],
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrapErr(resolved)).toEqual(
      SlackLifecycleErrors.draftNotFound({
        reason: SlackDraftErrors.releasedTwin({
          id: row.id,
          outcome: `D1 1790604264.247109 · ${permalink}`,
          twinId: first.id,
        }).message,
      }),
    );
    expect(unwrapErr(resolved).message).toContain(permalink);
  });

  it("names every other held cut of the same message, to spend once the release lands", async () => {
    const row = heldRow();
    const older: ParkedSlackDraft = { ...row, id: "sd-0dd0c0de", tsIso: "2026-09-22T12:00:00.000Z" };
    const resolved = await resolveDraftRelease({
      deps: {
        ...NO_BOT,
        conversationSurface: async () => "direct-message",
        readDraftLog: () => [...logOf({ row: older }), ...logOf({ row })],
        readDraftMedia: () => ok([]),
      },
      options: releaseOf({ approve: row.digest }),
      token: "xoxp-test",
    });

    expect(unwrap(resolved).heldCuts).toEqual(["sd-0dd0c0de"]);
  });

  it("refuses a row recorded from stdin until --form supplies the words", async () => {
    const row = heldRow({ form: STDIN_SENTINEL });
    const deps = {
      ...NO_BOT,
      conversationSurface: async () => "public-channel" as const,
      readDraftLog: () => logOf({ row }),
      readDraftMedia: () => ok([]),
    };

    const bare = await resolveDraftRelease({ deps, options: releaseOf({ approve: row.digest }), token: "x" });
    const supplied = await resolveDraftRelease({
      deps,
      options: releaseOf({ approve: row.digest, formSource: FORM }),
      token: "x",
    });

    expect(unwrapErr(bare)).toEqual(SlackLifecycleErrors.draftFormRequired({ draftId: row.id }));
    expect(unwrapErr(bare).message).toContain("Pass the form that renders it with --form");
    expect(unwrap(supplied).drip.source).toEqual({ json: FORM, kind: "form" });
    expect(unwrap(supplied).drip.bumpExemption).toBe(undefined);
  });
});
