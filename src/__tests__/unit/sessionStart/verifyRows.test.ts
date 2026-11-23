import { describe, expect, it } from "vitest";

import { unverifiedWithoutOrganisation } from "../../../cli/commands/sessionStart/unverifiedPass.js";
import type { VerifySeams } from "../../../cli/commands/sessionStart/verifyRows.js";
import {
  applyLiveVerification,
  refResolution,
  refVerdict,
  verifyRows,
} from "../../../cli/commands/sessionStart/verifyRows.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";
import {
  NO_SUCH_PULL_REQUEST,
  type PullRequestLiveState,
  pullRequestStateOf,
  saysNoSuchPullRequest,
} from "../../../live/github/pullRequestState.js";
import { OrganisationErrors } from "../../../organisation/errors.js";
import type { CodeOwnerSlice } from "../../../review/codeOwnerSlice.js";
import type { BoardEntry } from "../../../sessionStart/boardLeg.js";
import { boardLeg } from "../../../sessionStart/boardLeg.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import { rankAll } from "../../../sessionStart/rank.js";
import { type SlackMention, slackMentionLeg } from "../../../sessionStart/slackLeg.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const NOW = "2026-09-01T09:00:00.000Z";

/** Every seam refusing to answer — the shape a run with no credential gets. */
const NOTHING_READ: VerifySeams = {
  codeOwnerSlice: async () => ({ kind: "notChecked", reads: 0, reason: "no GitHub token is stored" }),
  linearStateType: async () => undefined,
  pullRequestState: async () => ({ kind: "notChecked" }),
  viewerLogin: async () => ({ kind: "notChecked", reason: "no GitHub token is stored" }),
};

/** A seam that answers with one fixed state for every number asked about. */
const alwaysPullRequest = ({ live }: { live: PullRequestLiveState }): VerifySeams => ({
  ...NOTHING_READ,
  pullRequestState: async () => live,
});

const started = ({ atIso }: { atIso: string }): RunEvent => ({
  atIso,
  branch: "a-branch",
  docHash: "0123456789abcdef",
  kind: "started",
});

const asked = ({ atIso, question }: { atIso: string; question: string }): RunEvent => ({
  atIso,
  kind: "question",
  question,
});

/**
 * A run stopped on the owner whose recorded question is about one pull request.
 *
 * It asks the owner to rule on a pull request that had already merged through the queue the previous day
 * with 21 checks passed, while the row said it could not merge.
 */
const merged: BoardEntry = {
  events: [
    started({ atIso: "2026-08-30T00:00:00.000Z" }),
    asked({
      atIso: "2026-08-31T00:00:00.000Z",
      question: "#16349 cannot merge — do you want me to force it through or retarget it?",
    }),
  ],
  holder: { kind: "live" },
  repo: "/repos/dev/work/acme-admin",
  slug: "a-run-about-a-landed-pull-request",
  summary: "Get the queue-blocked pull request in. It has been sitting behind a required check.",
};

describe("saysNoSuchPullRequest", () => {
  it("takes a NOT_FOUND at face value", () => {
    expect(saysNoSuchPullRequest({ error: GithubLiveErrors.notFound({ identity: "o/r#1", kind: "pull" }) })).toBe(true);
  });

  it("takes an issue answering a pull-request address as no pull request at that number", () => {
    const error = GithubLiveErrors.notAPullRequest({ identity: "o/r#1", issueUrl: "https://github.com/o/r/issues/1" });
    expect(saysNoSuchPullRequest({ error })).toBe(true);
  });

  it("reads GitHub's own no-such-object wording out of a READ_FAILED, which is how it really arrives", () => {
    const error = GithubLiveErrors.readFailed({
      message:
        "Request failed due to following response errors:\n - Could not resolve to an issue or pull request with the number of 505.",
    });
    expect(saysNoSuchPullRequest({ error })).toBe(true);
  });

  it("does NOT read a rate limit as a missing pull request", () => {
    const error = GithubLiveErrors.readFailed({ message: "API rate limit exceeded for user" });
    expect(saysNoSuchPullRequest({ error })).toBe(false);
  });

  it("does not read a transport failure as a missing pull request", () => {
    expect(saysNoSuchPullRequest({ error: GithubLiveErrors.readFailed({ message: "fetch failed" }) })).toBe(false);
  });

  it("matches case-insensitively, because the provider owns the casing", () => {
    const error = GithubLiveErrors.readFailed({ message: "COULD NOT RESOLVE TO AN ISSUE OR PULL REQUEST" });
    expect(saysNoSuchPullRequest({ error })).toBe(true);
  });

  it("states the wording it matches, so a provider change is one edit", () => {
    expect(NO_SUCH_PULL_REQUEST).toBe("could not resolve to an issue or pull request");
  });
});

describe("pullRequestStateOf — session-start's bare #N, either kind", () => {
  const either = "issue-or-pull-request" as const;

  it("reads MERGED as settled, carrying the provider's own word", () => {
    const state = pullRequestStateOf({ data: { number: 16_349, state: "MERGED" }, subject: either });
    expect(state.kind).toBe("settled");
    expect(state).toStrictEqual({ kind: "settled", state: "MERGED" });
  });

  it("reads CLOSED as settled too — a pull request closed while its row asked the owner to rule on it", () => {
    expect(pullRequestStateOf({ data: { state: "CLOSED" }, subject: either })).toStrictEqual({
      kind: "settled",
      state: "CLOSED",
    });
  });

  it("reads OPEN as open", () => {
    expect(pullRequestStateOf({ data: { state: "OPEN" }, subject: either })).toStrictEqual({ kind: "open" });
  });

  it("reads a node with no decodable state as not checked — never as finished, and never as proved open", () => {
    expect(pullRequestStateOf({ data: { number: 12 }, subject: either })).toStrictEqual({ kind: "notChecked" });
  });

  it("reads a state word GitHub does not use as not checked", () => {
    expect(pullRequestStateOf({ data: { state: "DRAFTISH" }, subject: either })).toStrictEqual({
      kind: "notChecked",
    });
  });

  it("reads a node that is not a record at all as not checked", () => {
    expect(pullRequestStateOf({ data: "unexpected", subject: either })).toStrictEqual({ kind: "notChecked" });
  });

  it("keeps an issue's own state when either kind counts", () => {
    expect(pullRequestStateOf({ data: { __typename: "Issue", state: "OPEN" }, subject: either })).toStrictEqual({
      kind: "open",
    });
  });
});

describe("refVerdict", () => {
  it("maps an absent pull request to unknown-to-canonical", () => {
    expect(refVerdict({ live: { kind: "absent" } })).toBe("unknown-to-canonical");
  });

  it("maps a read that never happened to not-checked, never to missing", () => {
    expect(refVerdict({ live: { kind: "notChecked" } })).toBe("not-checked");
  });

  it("maps an open pull request to resolved", () => {
    expect(refVerdict({ live: { kind: "open" } })).toBe("resolved");
  });

  it("maps a merged pull request to settled", () => {
    expect(refVerdict({ live: { kind: "settled", state: "MERGED" } })).toBe("settled");
  });
});

describe("refResolution", () => {
  it("carries the provider's state word on a settled reference", () => {
    expect(refResolution({ live: { kind: "settled", state: "MERGED" }, number: 16_349 })).toStrictEqual({
      number: 16_349,
      state: "MERGED",
      verdict: "settled",
    });
  });

  it("carries no state at all when nothing was read", () => {
    expect(refResolution({ live: { kind: "notChecked" }, number: 7 })).toStrictEqual({
      number: 7,
      verdict: "not-checked",
    });
  });
});

describe("verifyRows over a board row naming a merged pull request", () => {
  /** The merged-pull-request failure, end to end: the board leg's own output, verified, then ranked. */
  const rankedAfterVerifying = async ({ live }: { live: PullRequestLiveState }) => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams: alwaysPullRequest({ live }) });
    const kept = applyLiveVerification({
      resolved: inputs.map((input) => ({ input })),
      verified,
    });
    return { ranking: rankAll({ inputs: kept.map((one) => one.input) }), verified };
  };

  it("keeps the row off the list entirely once GitHub says the pull request has merged", async () => {
    const { ranking, verified } = await rankedAfterVerifying({ live: { kind: "settled", state: "MERGED" } });
    expect(ranking.ranked).toStrictEqual([]);
    expect(verified.inputs).toStrictEqual([]);
    expect(verified.settledLive).toStrictEqual([
      "a-run-about-a-landed-pull-request: #16349 is MERGED in acme/acme-admin, so the pull request this row asks about is already finished",
    ]);
  });

  it("ranks the very same row while the pull request is still open — the check is falsifiable", async () => {
    const { ranking, verified } = await rankedAfterVerifying({ live: { kind: "open" } });
    expect(ranking.ranked.length).toBe(1);
    expect(ranking.ranked[0]!.item.nativeId).toBe("a-run-about-a-landed-pull-request");
    expect(verified.settledLive).toStrictEqual([]);
  });

  it("keeps the row, unverified, when the pull request does not exist in the canonical repository", async () => {
    const { ranking, verified } = await rankedAfterVerifying({ live: { kind: "absent" } });
    expect(ranking.ranked.length).toBe(1);
    expect(ranking.ranked[0]!.unverified).toBe(true);
    expect(verified.settledLive).toStrictEqual([]);
  });

  it("keeps the row and says the check never ran when nothing could be read", async () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams: NOTHING_READ });
    expect(verified.inputs.length).toBe(1);
    expect(verified.settledLive).toStrictEqual([]);
    expect(verified.couldNotSee).toStrictEqual([
      "a-run-about-a-landed-pull-request: none of its 1 pull-request reference(s) could be checked against acme/acme-admin",
    ]);
  });
});

describe("unverifiedWithoutOrganisation", () => {
  const refusal = OrganisationErrors.notConfigured({ missing: "organisation" }).message;

  it("keeps every row as the corpus had it, settles none, reads nothing, and says the refusal on the list", () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    expect(unverifiedWithoutOrganisation({ inputs, refusal })).toStrictEqual({
      couldNotSee: [
        "no row was verified live: no organisation is configured in the store — write it once with `slopweaver org set`",
      ],
      cutShort: false,
      inputs,
      origins: inputs.map((input) => input.item),
      reads: 0,
      settledLive: [],
    });
  });

  it("still lists the row a merged pull request would have settled, rather than guessing a repository to check it in", () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const kept = applyLiveVerification({
      resolved: inputs.map((input) => ({ input })),
      verified: unverifiedWithoutOrganisation({ inputs, refusal }),
    });
    expect(rankAll({ inputs: kept.map((one) => one.input) }).ranked.map((one) => one.item.nativeId)).toStrictEqual([
      "a-run-about-a-landed-pull-request",
    ]);
  });
});

describe("verifyRows over a mixed set of references", () => {
  /** One row naming two pull requests, so the every-reference rule has something to be wrong about. */
  const twoRefs: BoardEntry = {
    ...merged,
    events: [
      started({ atIso: "2026-08-30T00:00:00.000Z" }),
      asked({ atIso: "2026-08-31T00:00:00.000Z", question: "#16349 and #16350 both need a ruling before I land" }),
    ],
    slug: "a-run-about-two-pull-requests",
  };

  it("holds the row back only when EVERY reference has settled", async () => {
    const inputs = boardLeg({ entries: [twoRefs], nowIso: NOW });
    const seams: VerifySeams = {
      ...NOTHING_READ,
      pullRequestState: async ({ number }) =>
        number === 16_349 ? { kind: "settled", state: "MERGED" } : { kind: "open" },
    };
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs.length).toBe(1);
    expect(verified.settledLive).toStrictEqual([]);
  });

  it("holds it back once the second one lands too", async () => {
    const inputs = boardLeg({ entries: [twoRefs], nowIso: NOW });
    const verified = await verifyRows({
      inputs,
      organisation: ACME_ORGANISATION,
      seams: alwaysPullRequest({ live: { kind: "settled", state: "MERGED" } }),
    });
    expect(verified.inputs).toStrictEqual([]);
    expect(verified.settledLive).toStrictEqual([
      "a-run-about-two-pull-requests: #16349 is MERGED, #16350 is MERGED in acme/acme-admin, so every pull request this row asks about is already finished",
    ]);
  });

  it("charges one read per reference", async () => {
    const inputs = boardLeg({ entries: [twoRefs], nowIso: NOW });
    const verified = await verifyRows({
      inputs,
      organisation: ACME_ORGANISATION,
      seams: alwaysPullRequest({ live: { kind: "open" } }),
    });
    expect(verified.reads).toBe(2);
  });
});

describe("applyLiveVerification", () => {
  const row = ({ input }: { input: RankInput }) => ({ input, tag: input.item.nativeId });

  it("returns the rows untouched when the pass did not run", () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const resolved = inputs.map((input) => row({ input }));
    expect(applyLiveVerification({ resolved, verified: undefined })).toStrictEqual(resolved);
  });

  it("drops a row the pass no longer returned", () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const resolved = inputs.map((input) => row({ input }));
    expect(applyLiveVerification({ resolved, verified: { inputs: [], origins: [] } })).toStrictEqual([]);
  });

  it("replaces a surviving row with what the pass found, keeping the caller's own fields", () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const resolved = inputs.map((input) => row({ input }));
    const applied = applyLiveVerification({
      resolved,
      verified: {
        inputs: inputs.map((input) => ({ ...input, unverified: true })),
        origins: inputs.map((input) => input.item),
      },
    });
    expect(applied.length).toBe(1);
    expect(applied[0]!.input.unverified).toBe(true);
    expect(applied[0]!.tag).toBe("a-run-about-a-landed-pull-request");
  });
});

describe("verifyRows on a Slack review ask", () => {
  /** A teammate tagging the owner about one thirty-file pull request. */
  const ask = ({
    numbers,
    threadTs = "1787705115.489199",
  }: {
    numbers: readonly number[];
    threadTs?: string;
  }): SlackMention => ({
    authorIsHuman: true,
    authorName: "Seth Tanner",
    channelId: "channel-one",
    channelName: "#dev",
    mentionedIso: "2026-10-20T22:00:00.000Z",
    permalink: "https://example.slack.com/archives/channel-one/p1787708973446169",
    pullRequests: numbers.map((number) => ({ number, owner: "acme", repo: "acme-admin" })),
    text: "could you take a look?",
    threadTs,
  });

  const SLICE: CodeOwnerSlice = {
    additions: 1,
    deletions: 1,
    omittedPaths: 0,
    ownedFiles: 1,
    shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
    totalFiles: 30,
  };

  /** Seams that read every pull request open, the owner's login, and the slice — recording what was calls. */
  const reading = () => {
    const calls: { viewer: number; slices: { number: number; maxReads: number; viewerLogin: string }[] } = {
      slices: [],
      viewer: 0,
    };
    const seams: VerifySeams = {
      codeOwnerSlice: async ({ number, maxReads, viewerLogin }) => {
        calls.slices.push({ maxReads, number, viewerLogin });
        return { kind: "read", reads: 5, slice: SLICE };
      },
      linearStateType: async () => undefined,
      pullRequestState: async () => ({ kind: "open" }),
      viewerLogin: async () => {
        calls.viewer += 1;
        return { kind: "read", login: "octocat" };
      },
    };
    return { calls, seams };
  };

  it("puts the owner's code-owner slice of the one pull request on the row, and charges every request it made", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649] })], nowIso: NOW });
    const { calls, seams } = reading();
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toStrictEqual(SLICE);
    expect(verified.reads).toBe(7);
    expect(calls.slices).toStrictEqual([{ maxReads: 38, number: 18_649, viewerLogin: "octocat" }]);
    expect(verified.couldNotSee).toStrictEqual([]);
  });

  it("keeps the sliced row through applyLiveVerification, which finds it by the item it came from", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649] })], nowIso: NOW });
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams: reading().seams });
    const applied = applyLiveVerification({ resolved: inputs.map((input) => ({ input })), verified });
    expect(applied.map((one) => one.input.item.codeOwnerSlice)).toStrictEqual([SLICE]);
  });

  it("asks whose the token is once a pass, however many asks it slices", async () => {
    const mentions = [ask({ numbers: [18_649] }), ask({ numbers: [19_060], threadTs: "1787705999.000100" })];
    const { calls, seams } = reading();
    const verified = await verifyRows({
      inputs: slackMentionLeg({ mentions, nowIso: NOW }),
      organisation: ACME_ORGANISATION,
      seams,
    });
    expect(calls.viewer).toBe(1);
    expect(verified.reads).toBe(13);
  });

  it("slices nothing on an ask naming two pull requests, and says why", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649, 19_060] })], nowIso: NOW });
    const { calls, seams } = reading();
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toBe(undefined);
    expect(calls.viewer).toBe(0);
    expect(verified.couldNotSee).toStrictEqual([
      "channel-one:1787705115.489199: no code-owner slice, because this ask names 2 pull requests (acme/acme-admin#18649, acme/acme-admin#19060) and a slice belongs to one",
    ]);
  });

  it("says why there is no slice when the ask's one link is not a reference the state check reads", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [100_000] })], nowIso: NOW });
    const { calls, seams } = reading();
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toBe(undefined);
    expect(calls.viewer).toBe(0);
    expect(verified.reads).toBe(0);
    expect(verified.couldNotSee).toStrictEqual([
      "channel-one:1787705115.489199: no code-owner slice, because the live check reads no reference to acme/acme-admin#100000",
    ]);
  });

  it("slices nothing when GitHub will not say whose the token is, and leaves the row's freshness as the state read left it", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649] })], nowIso: NOW });
    const seams: VerifySeams = {
      ...reading().seams,
      viewerLogin: async () => ({ kind: "notChecked", reason: "Bad credentials" }),
    };
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toBe(undefined);
    expect(verified.inputs[0]!.unverified).toBe(true);
    expect(verified.couldNotSee).toStrictEqual([
      "channel-one:1787705115.489199: no code-owner slice, because GitHub could not say whose the token is: Bad credentials",
    ]);
  });

  it("slices nothing when the slice read could not finish, and names the pull request", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649] })], nowIso: NOW });
    const seams: VerifySeams = {
      ...reading().seams,
      codeOwnerSlice: async () => ({
        kind: "notChecked",
        reads: 3,
        reason: "GitHub listed 29 of the 30 changed files",
      }),
    };
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toBe(undefined);
    expect(verified.reads).toBe(5);
    expect(verified.couldNotSee).toStrictEqual([
      "channel-one:1787705115.489199: no code-owner slice for acme/acme-admin#18649: GitHub listed 29 of the 30 changed files",
    ]);
  });

  it("never slices a pull request that has already landed — the row leaves the list instead", async () => {
    const inputs = slackMentionLeg({ mentions: [ask({ numbers: [18_649] })], nowIso: NOW });
    const seams: VerifySeams = {
      ...reading().seams,
      pullRequestState: async () => ({ kind: "settled", state: "MERGED" }),
    };
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs).toStrictEqual([]);
  });

  it("never slices a row that is not a Slack ask, even one naming a single open pull request", async () => {
    const inputs = boardLeg({ entries: [merged], nowIso: NOW });
    const { calls, seams } = reading();
    const verified = await verifyRows({ inputs, organisation: ACME_ORGANISATION, seams });
    expect(verified.inputs[0]!.item.codeOwnerSlice).toBe(undefined);
    expect(calls.viewer).toBe(0);
  });
});
