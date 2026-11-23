import { describe, expect, it } from "vitest";

import type { CodeOwnerSliceRead } from "../../../cli/commands/sessionStart/codeOwnerSliceRead.js";
import {
  type ViewerLoginRead,
  viewerLoginRead,
  withCodeOwnerSlice,
} from "../../../cli/commands/sessionStart/verifySlice.js";
import type { CodeOwnerSlice } from "../../../review/codeOwnerSlice.js";
import { slackMentionLeg } from "../../../sessionStart/slackLeg.js";

const NOW = "2026-10-20T23:00:00.000Z";

/** A teammate tagging the owner about one thirty-file pull request. */
const [INPUT] = slackMentionLeg({
  mentions: [
    {
      authorIsHuman: true,
      authorName: "Seth Tanner",
      channelId: "channel-one",
      channelName: "#dev",
      mentionedIso: "2026-10-20T22:00:00.000Z",
      permalink: "https://example.slack.com/archives/channel-one/p1787708973446169",
      pullRequests: [{ number: 18_649, owner: "acme", repo: "acme-admin" }],
      text: "could you take a look?",
      threadTs: "1787705115.489199",
    },
  ],
  nowIso: NOW,
});
const input = INPUT!;
const ID = input.item.nativeId;

/** The same ask, linking the given pull requests instead. */
const askLinking = ({
  pullRequests,
}: {
  pullRequests: readonly { number: number; owner: string; repo: string }[];
}): typeof input => {
  const [row] = slackMentionLeg({
    mentions: [
      {
        authorIsHuman: true,
        authorName: "Seth Tanner",
        channelId: "channel-one",
        channelName: "#dev",
        mentionedIso: "2026-10-20T22:00:00.000Z",
        permalink: "https://example.slack.com/archives/channel-one/p1787708973446169",
        pullRequests,
        text: "could you take a look at these?",
        threadTs: "1787705115.489199",
      },
    ],
    nowIso: NOW,
  });
  return row!;
};

const SLICE: CodeOwnerSlice = {
  additions: 1,
  deletions: 1,
  omittedPaths: 0,
  ownedFiles: 1,
  shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
  totalFiles: 30,
};

/** Seams answering a fixed viewer and slice, recording each slice read's arguments. */
const seams = ({
  viewer = { kind: "read", login: "octocat" },
  slice = { kind: "read", reads: 5, slice: SLICE },
}: { viewer?: ViewerLoginRead; slice?: CodeOwnerSliceRead } = {}) => {
  const calls: { maxReads: number; number: number; repo: string; viewerLogin: string }[] = [];
  return {
    calls,
    readSlice: async (args: { maxReads: number; number: number; repo: string; viewerLogin: string }) => {
      calls.push(args);
      return slice;
    },
    viewerOnce: async () => ({ cost: 1, read: viewer }),
  };
};

const RESOLVED = [{ number: 18_649, state: "OPEN", verdict: "resolved" as const }];

describe("withCodeOwnerSlice", () => {
  it("adds the owner's slice to the row and counts the viewer read and the slice reads", async () => {
    const { calls, readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out.kept.item.codeOwnerSlice).toStrictEqual(SLICE);
    expect(out.reads).toBe(6);
    expect(out.note).toBe(undefined);
    expect(calls).toStrictEqual([{ maxReads: 19, number: 18_649, repo: "acme/acme-admin", viewerLogin: "octocat" }]);
  });

  it("refuses a slice for an ask naming two pull requests, reading nothing", async () => {
    const { calls, readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: [...RESOLVED, { number: 19_060, state: "OPEN", verdict: "resolved" }],
      viewerOnce,
    });
    expect(out).toStrictEqual({
      kept: input,
      note: `${ID}: no code-owner slice, because this ask names 2 pull requests and a slice belongs to one`,
      reads: 0,
    });
    expect(calls).toStrictEqual([]);
  });

  it("refuses a slice for an ask that also links a pull request in another repository, reading nothing", async () => {
    const crossRepo = askLinking({
      pullRequests: [
        { number: 18_649, owner: "acme", repo: "acme-admin" },
        { number: 2, owner: "octo-self", repo: "slopweaver" },
      ],
    });
    const { calls, readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input: crossRepo,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out).toStrictEqual({
      kept: crossRepo,
      note: `${ID}: no code-owner slice, because this ask names 2 pull requests (acme/acme-admin#18649, octo-self/slopweaver#2) and a slice belongs to one`,
      reads: 0,
    });
    expect(calls).toStrictEqual([]);
  });

  it("refuses a slice when a second link's number is too long for the bare references to have read it", async () => {
    const longNumber = askLinking({
      pullRequests: [
        { number: 18_649, owner: "acme", repo: "acme-admin" },
        { number: 100_000, owner: "acme", repo: "acme-admin" },
      ],
    });
    const { calls, readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input: longNumber,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out).toStrictEqual({
      kept: longNumber,
      note: `${ID}: no code-owner slice, because this ask names 2 pull requests (acme/acme-admin#18649, acme/acme-admin#100000) and a slice belongs to one`,
      reads: 0,
    });
    expect(calls).toStrictEqual([]);
  });

  it("leaves a row whose one pull request did not resolve as it was, with no note", async () => {
    const { readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: [{ number: 18_649, verdict: "not-checked" }],
      viewerOnce,
    });
    expect(out).toStrictEqual({ kept: input, reads: 0 });
  });

  it("leaves a row with no reference at all as it was", async () => {
    const { readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: [],
      viewerOnce,
    });
    expect(out).toStrictEqual({ kept: input, reads: 0 });
  });

  it("says the bound ran out when no read is left, reading nothing", async () => {
    const { calls, readSlice, viewerOnce } = seams();
    const out = await withCodeOwnerSlice({
      budget: 0,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out.note).toBe(
      `${ID}: no code-owner slice for acme/acme-admin#18649, because the live check's bound of reads ran out`,
    );
    expect(out.reads).toBe(0);
    expect(calls).toStrictEqual([]);
  });

  it("names why when GitHub would not say whose the token is, charging the viewer read", async () => {
    const { calls, readSlice, viewerOnce } = seams({ viewer: { kind: "notChecked", reason: "Bad credentials" } });
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out.note).toBe(
      `${ID}: no code-owner slice, because GitHub could not say whose the token is: Bad credentials`,
    );
    expect(out.reads).toBe(1);
    expect(calls).toStrictEqual([]);
  });

  it("carries the slice read's reason and every read it spent when the slice was not checked", async () => {
    const { readSlice, viewerOnce } = seams({
      slice: { kind: "notChecked", reads: 4, reason: "the pull request moved" },
    });
    const out = await withCodeOwnerSlice({
      budget: 20,
      input,
      readSlice,
      repo: "acme/acme-admin",
      resolutions: RESOLVED,
      viewerOnce,
    });
    expect(out).toStrictEqual({
      kept: input,
      note: `${ID}: no code-owner slice for acme/acme-admin#18649: the pull request moved`,
      reads: 5,
    });
  });
});

describe("viewerLoginRead", () => {
  it("accepts a user login", () => {
    expect(viewerLoginRead({ login: "octocat" })).toStrictEqual({
      kind: "read",
      login: "octocat",
    });
  });

  it("refuses a team-shaped name, which would match a team rule as though the team were the owner", () => {
    expect(viewerLoginRead({ login: "org/team" })).toStrictEqual({
      kind: "notChecked",
      reason: `GitHub named the token's owner "org/team", which is not a user login`,
    });
  });
});
