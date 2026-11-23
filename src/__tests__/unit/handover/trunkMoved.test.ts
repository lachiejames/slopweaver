/**
 * The reconcile-time trunk-moved hold's pure core — whether the trunk changed what a ready finding names after
 * the instant the finding was asked or last rechecked. The commits are the real ones that answered the
 * measured rows (`src/handover/trunkMoved.ts`'s header).
 */
import { describe, expect, it } from "vitest";

import type { HandoverDoc } from "../../../handover/doc.js";
import { evidenceRefs } from "../../../handover/evidenceRefs.js";
import {
  isTrunkCheckCandidate,
  originSlug,
  parseTrunkLog,
  type TrunkCommit,
  trunkCheckFloor,
  trunkMovedLines,
  trunkMovesFor,
  unquoteGitPath,
} from "../../../handover/trunkMoved.js";

/** The settle-refuses row's fix, as the trunk log reads it. */
const FIX_1645: TrunkCommit = {
  committer: "noreply@github.com",
  iso: "2026-09-30T13:58:15Z",
  paths: ["src/cli/commands/handover/settleCardRun.ts", "src/handover/settleCardErrors.ts"],
  sha: "bee65d44be0000000000000000000000000000aa",
  subject: "A doc filed from a talk relay settles over the relay's anchor, and still owes the relay's card (#1645)",
};

/** A commit touching statusRun.ts, the run module of `codex status`. */
const STATUS_1701: TrunkCommit = {
  committer: "noreply@github.com",
  iso: "2026-10-01T15:19:22+00:00",
  paths: ["src/cli/commands/codex/statusRun.ts"],
  sha: "8056e9a10a0000000000000000000000000000bb",
  subject: "fix(codex): status --check asks the landing reader, and the refusal names a drifted review (#1701)",
};

const SETTLE_EVIDENCE = ["src/cli/commands/handover/settleCardRun.ts:74", "src/handover/settleCardErrors.ts:186"];
const ORIGIN = { name: "slopweaver", owner: "octo-self" };

describe("trunkMovesFor", () => {
  it("holds the settle-refuses row on the fix that answered it, a day after it was asked", () => {
    const moves = trunkMovesFor({
      commits: [FIX_1645],
      floorIso: "2026-09-29T15:38:16.738Z",
      origin: ORIGIN,
      refs: evidenceRefs({ evidence: SETTLE_EVIDENCE }),
      verbModules: new Map(),
    });
    expect(moves.map((move) => [move.ref, move.commits.map((commit) => commit.sha.slice(0, 10))])).toEqual([
      ["src/cli/commands/handover/settleCardRun.ts", ["bee65d44be"]],
      ["src/handover/settleCardErrors.ts", ["bee65d44be"]],
    ]);
  });

  it("holds on no commit the recheck's trunk tip already carried, however far in the future git dated it", () => {
    const future = { ...FIX_1645, iso: "2099-01-01T00:00:00Z" };
    const after = { ...FIX_1645, sha: "c".repeat(40) };
    const judge = ({ unseen }: { unseen: ReadonlySet<string> | undefined }): readonly string[] =>
      trunkMovesFor({
        commits: [future, after],
        floorIso: "2026-09-29T15:38:16.738Z",
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: ["src/handover/settleCardErrors.ts"] }),
        unseen,
        verbModules: new Map(),
      }).flatMap((move) => move.commits.map((commit) => commit.sha));
    expect([judge({ unseen: undefined }), judge({ unseen: new Set([after.sha]) })]).toEqual([
      [future.sha, after.sha],
      [after.sha],
    ]);
  });

  it("holds on a commit git dated to the floor's own second, and not on one the second before", () => {
    const judge = ({ iso }: { iso: string }): number =>
      trunkMovesFor({
        commits: [{ ...FIX_1645, iso }],
        floorIso: "2026-10-10T12:00:00.500Z",
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: SETTLE_EVIDENCE }),
        verbModules: new Map(),
      }).length;
    expect([judge({ iso: "2026-10-10T12:00:00+00:00" }), judge({ iso: "2026-10-10T11:59:59+00:00" })]).toEqual([2, 0]);
  });

  it("ignores a commit from before the floor — a finding about a file is not news to itself", () => {
    expect(
      trunkMovesFor({
        commits: [FIX_1645],
        floorIso: "2026-10-01T00:00:00.000Z",
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: SETTLE_EVIDENCE }),
        verbModules: new Map(),
      }),
    ).toEqual([]);
  });

  it("holds a verb row on its resolved run module, comparing an offset instant by time not text", () => {
    const moves = trunkMovesFor({
      commits: [STATUS_1701],
      floorIso: "2026-09-28T12:39:58.161Z",
      origin: ORIGIN,
      refs: evidenceRefs({ evidence: ["verb:codex status --check"] }),
      verbModules: new Map([["codex status", "src/cli/commands/codex/statusRun.ts"]]),
    });
    expect(moves.map((move) => move.ref)).toEqual(["verb codex status (src/cli/commands/codex/statusRun.ts)"]);
  });

  it("drops a verb that did not resolve rather than guessing a module for it", () => {
    expect(
      trunkMovesFor({
        commits: [STATUS_1701],
        floorIso: "2026-09-28T12:39:58.161Z",
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: ["verb:codex status --check"] }),
        verbModules: new Map(),
      }),
    ).toEqual([]);
  });

  it("holds on a named pull request of the checkout's own origin merging after the floor", () => {
    const moves = trunkMovesFor({
      commits: [{ ...FIX_1645, paths: [] }],
      floorIso: "2026-09-29T15:38:16.738Z",
      origin: ORIGIN,
      refs: evidenceRefs({ evidence: ["https://github.com/octo-self/slopweaver/pull/1645"] }),
      verbModules: new Map(),
    });
    expect(moves.map((move) => move.ref)).toEqual(["octo-self/slopweaver#1645"]);
  });

  it("matches GitHub's merge-commit subject too, and never a different number's", () => {
    const merge = { ...FIX_1645, paths: [], subject: "Merge pull request #1645 from acme/fix" };
    const other = { ...FIX_1645, paths: [], sha: "c0ffee", subject: "Merge pull request #16450 from acme/x" };
    const moves = trunkMovesFor({
      commits: [merge, other],
      floorIso: "2026-09-29T15:38:16.738Z",
      origin: ORIGIN,
      refs: evidenceRefs({ evidence: ["octo-self/slopweaver#1645"] }),
      verbModules: new Map(),
    });
    expect(moves.flatMap((move) => move.commits.map((commit) => commit.subject))).toEqual([merge.subject]);
  });

  it("never reads a direct push with a hand-written (#N) subject as that pull request landing", () => {
    const pushed = { ...FIX_1645, committer: "someone@example.com", paths: [], subject: "manual hotfix (#1645)" };
    const landed = { ...FIX_1645, paths: [], sha: "c0ffee" };
    const moves = trunkMovesFor({
      commits: [pushed, landed],
      floorIso: "2026-09-29T15:38:16.738Z",
      origin: ORIGIN,
      refs: evidenceRefs({ evidence: ["octo-self/slopweaver#1645"] }),
      verbModules: new Map(),
    });
    expect(moves.flatMap((move) => move.commits.map((commit) => commit.sha))).toEqual(["c0ffee"]);
  });

  it("never matches a pull request of another repository, nor one when the origin is unknown", () => {
    const base = {
      commits: [{ ...FIX_1645, paths: [] }],
      floorIso: "2026-09-29T15:38:16.738Z",
      verbModules: new Map<string, string>(),
    };
    expect(
      trunkMovesFor({ ...base, origin: ORIGIN, refs: evidenceRefs({ evidence: ["acme/acme-admin#1645"] }) }),
    ).toEqual([]);
    expect(
      trunkMovesFor({ ...base, origin: undefined, refs: evidenceRefs({ evidence: ["octo-self/slopweaver#1645"] }) }),
    ).toEqual([]);
  });
});

/** A ready finding ask, as `handover register --finding` writes one. */
function findingDoc(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: "2026-09-29T15:38:16.738Z",
    baseBranch: undefined,
    blastRadius: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: SETTLE_EVIDENCE,
    exampleGap: undefined,
    examples: [],
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    kind: "ask",
    lean: undefined,
    notDoneReason: undefined,
    observedBy: "a-session",
    options: [],
    origin: "finding",
    outputs: [],
    path: "/h/a-finding.md",
    pausedOn: undefined,
    pausedSince: undefined,
    priority: "p1",
    probeWaiver: undefined,
    problem: undefined,
    problems: [],
    registeredBy: undefined,
    registeredRun: undefined,
    repo: "/w/repo",
    risk: undefined,
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug: "a-finding",
    status: "ready",
    statusSummary: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    summary: "a finding",
    supervisorState: undefined,
    ...over,
  };
}

describe("isTrunkCheckCandidate", () => {
  it("judges an unsettled ready finding with a checkout", () => {
    expect(isTrunkCheckCandidate({ doc: findingDoc(), section: "RUN NOW" })).toBe(true);
  });

  it("leaves the owner's own ask, a settled finding, a repoless one and one not ready unjudged", () => {
    expect(isTrunkCheckCandidate({ doc: findingDoc({ origin: undefined }), section: "RUN NOW" })).toBe(false);
    expect(isTrunkCheckCandidate({ doc: findingDoc({ settlement: "answered" }), section: "RUN NOW" })).toBe(false);
    expect(isTrunkCheckCandidate({ doc: findingDoc({ repo: undefined }), section: "RUN NOW" })).toBe(false);
    expect(isTrunkCheckCandidate({ doc: findingDoc(), section: "IN FLIGHT" })).toBe(false);
  });
});

describe("trunkCheckFloor", () => {
  it("is the ask's own second until a recheck lands, then the second after it — so a recheck releases", () => {
    expect(trunkCheckFloor({ doc: findingDoc() })).toBe("2026-09-29T15:38:16.000Z");
    expect(trunkCheckFloor({ doc: findingDoc({ trunkRecheckedIso: "2026-10-10T12:00:00.000Z" }) })).toBe(
      "2026-10-10T12:00:01.000Z",
    );
    const floorIso = trunkCheckFloor({ doc: findingDoc({ trunkRecheckedIso: "2026-10-10T12:00:00.000Z" }) })!;
    expect(
      trunkMovesFor({
        commits: [FIX_1645],
        floorIso,
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: SETTLE_EVIDENCE }),
        verbModules: new Map(),
      }),
    ).toEqual([]);
  });

  it("is the recheck even when the ask instant is later, so a skewed askedIso cannot hide commits", () => {
    expect(
      trunkCheckFloor({
        doc: findingDoc({ askedIso: "2026-12-01T00:00:00.000Z", trunkRecheckedIso: "2026-10-10T12:00:00.000Z" }),
      }),
    ).toBe("2026-10-10T12:00:01.000Z");
  });

  it("releases a commit git dated to the recheck's own second, and holds one in the ask's", () => {
    const sameSecond = { ...FIX_1645, iso: "2026-10-10T12:00:00+00:00" };
    const held = ({ doc }: { doc: HandoverDoc }): number =>
      trunkMovesFor({
        commits: [sameSecond],
        floorIso: trunkCheckFloor({ doc })!,
        origin: ORIGIN,
        refs: evidenceRefs({ evidence: SETTLE_EVIDENCE }),
        verbModules: new Map(),
      }).length;
    expect([
      held({ doc: findingDoc({ askedIso: "2026-10-10T12:00:00.500Z" }) }),
      held({ doc: findingDoc({ trunkRecheckedIso: "2026-10-10T12:00:00.500Z" }) }),
    ]).toEqual([2, 0]);
  });

  it("is undefined for a row carrying no instant at all, which cannot be judged", () => {
    expect(trunkCheckFloor({ doc: findingDoc({ askedIso: undefined }) })).toBeUndefined();
  });
});

describe("parseTrunkLog", () => {
  it("reads git's record and field separators, paths below each header", () => {
    const text =
      "\u001ebee65d44be\u00002026-09-30T13:58:15+00:00\u0000noreply@github.com\u0000A fix (#1645)\n\nsrc/a.ts\nsrc/b.ts\n" +
      "\u001e8056e9a10a\u00002026-10-01T15:19:22+00:00\u0000a@example.com\u0000another (#1701)\n";
    expect(parseTrunkLog({ text })).toEqual([
      {
        committer: "noreply@github.com",
        iso: "2026-09-30T13:58:15+00:00",
        paths: ["src/a.ts", "src/b.ts"],
        sha: "bee65d44be",
        subject: "A fix (#1645)",
      },
      {
        committer: "a@example.com",
        iso: "2026-10-01T15:19:22+00:00",
        paths: [],
        sha: "8056e9a10a",
        subject: "another (#1701)",
      },
    ]);
  });

  it("decodes a path git C-quoted, letter and octal escapes alike", () => {
    expect(
      [
        String.raw`"src/a\".ts"`,
        String.raw`"src/back\\slash\tTab.ts"`,
        String.raw`"src/\303\251.ts"`,
        '"src/é\\".ts"',
        "src/plain.ts",
        String.raw`"src/bad\q.ts"`,
      ].map((line) => unquoteGitPath({ line })),
    ).toEqual([
      'src/a".ts',
      "src/back\\slash\tTab.ts",
      "src/é.ts",
      'src/é".ts',
      "src/plain.ts",
      String.raw`"src/bad\q.ts"`,
    ]);
  });

  it("keeps a subject carrying either old separator whole, with the paths under it", () => {
    const text =
      "\u001ebee65d44be\u00002026-09-30T13:58:15+00:00\u0000a@example.com\u0000fix\u001fextra \u001e tail\n\nsrc/a.ts\n" +
      "\u001enot-a-header\nsrc/orphan.ts\n";
    expect(parseTrunkLog({ text }).map((commit) => [commit.subject, commit.paths])).toEqual([
      ["fix\u001fextra \u001e tail", ["src/a.ts"]],
    ]);
  });
});

describe("originSlug", () => {
  it("reads both GitHub URL spellings", () => {
    expect(originSlug({ url: "git@github.com:octo-self/slopweaver.git\n" })).toEqual(ORIGIN);
    expect(originSlug({ url: "https://github.com/octo-self/slopweaver" })).toEqual(ORIGIN);
  });

  it("is undefined for a remote that is not GitHub", () => {
    expect(originSlug({ url: "https://gitlab.com/a/b.git" })).toBeUndefined();
  });

  it("is undefined for a host that merely ends in github.com", () => {
    expect([
      originSlug({ url: "git@evilgithub.com:octo-self/slopweaver.git" }),
      originSlug({ url: "https://evil.github.com/octo-self/slopweaver" }),
      originSlug({ url: "ssh://git@github.com/octo-self/slopweaver.git" }),
      originSlug({ url: "https://github.com.evil/github.com/octo-self/slopweaver" }),
      originSlug({ url: "https://x-access-token@github.com/octo-self/slopweaver.git" }),
    ]).toEqual([undefined, undefined, ORIGIN, undefined, ORIGIN]);
  });

  it("reads an explicit port, and still reads a numeric owner in the scp form as an owner", () => {
    expect([
      originSlug({ url: "https://github.com:443/octo-self/slopweaver.git" }),
      originSlug({ url: "ssh://git@github.com:22/octo-self/slopweaver.git" }),
      originSlug({ url: "git@github.com:1234/slopweaver.git" }),
    ]).toEqual([ORIGIN, ORIGIN, { name: "slopweaver", owner: "1234" }]);
  });

  it("reads a host and scheme in any case, as URLs do", () => {
    expect([
      originSlug({ url: "ssh://git@GITHUB.COM:22/octo-self/slopweaver.git" }),
      originSlug({ url: "HTTPS://GitHub.com/octo-self/slopweaver.GIT" }),
      originSlug({ url: "git@EvilGitHub.com:octo-self/slopweaver.git" }),
    ]).toEqual([ORIGIN, ORIGIN, undefined]);
  });

  it("reads a user:password userinfo after a scheme, never a path segment as the host", () => {
    expect([
      originSlug({ url: "https://user:token@github.com/octo-self/slopweaver.git" }),
      originSlug({ url: "https://evil.com:x@github.com/octo-self/slopweaver.git" }),
      originSlug({ url: "https://user:token@evil.com/github.com/octo-self/slopweaver" }),
      originSlug({ url: "user:token@github.com:octo-self/slopweaver.git" }),
    ]).toEqual([ORIGIN, ORIGIN, undefined, undefined]);
  });
});

describe("trunkMovedLines", () => {
  it("says nothing when nothing was held and every trunk was read", () => {
    expect(trunkMovedLines({ held: new Map(), maxRows: undefined, pullsUnchecked: [], unread: [] })).toEqual([]);
  });

  it("names a checkout whose origin left its rows' cited pull requests unchecked", () => {
    const pullsUnchecked = [{ repo: "/w/gl", slugs: ["x"], why: "its origin names no github.com repository" }];
    expect(trunkMovedLines({ held: new Map(), maxRows: undefined, pullsUnchecked, unread: [] })).toEqual([
      "(the pull requests 1 ready finding row(s) in /w/gl cite were not checked — its origin names no github.com " +
        "repository — but their paths and verbs were.)",
    ]);
  });

  it("names the count, the way back, each row's commits, and every unread trunk", () => {
    const held = new Map([
      [
        "/h/a-finding.md",
        { moves: [{ commits: [FIX_1645], ref: "src/handover/settleCardErrors.ts" }], slug: "a-finding" },
      ],
    ]);
    const unread = [{ repo: "/w/other", slugs: ["x", "y"], why: "no trunk" }];
    expect(trunkMovedLines({ held, maxRows: undefined, pullsUnchecked: [], unread })).toEqual([
      "(1 ready finding row(s) held — the trunk changed what their evidence names since they were asked. Read the " +
        'commits: settle a row they answered, or `slopweaver handover recheck <slug> --still-real "<what you re-ran>"` ' +
        "to offer it again.)",
      "  a-finding — src/handover/settleCardErrors.ts: bee65d44be A doc filed from a talk relay settles over the " +
        "relay's anchor, and still owes the relay's card (#1645)",
      "(the trunk of /w/other could not be read — no trunk — so 2 ready finding row(s) there are offered without " +
        "the trunk-moved check.)",
    ]);
  });

  it("names the first rows by slug under a cap, keeps the whole count in the header, and counts the rest", () => {
    const held = new Map(
      ["f-3", "f-1", "f-2"].map((slug) => [
        `/h/${slug}.md`,
        { moves: [{ commits: [FIX_1645], ref: "src/handover/settleCardErrors.ts" }], slug },
      ]),
    );
    const lines = trunkMovedLines({ held, maxRows: 2, pullsUnchecked: [], unread: [] });

    expect(lines[0]!.startsWith("(3 ready finding row(s) held")).toBe(true);
    expect(lines.slice(1).map((line) => line.split(" — ")[0])).toEqual([
      "  f-1",
      "  f-2",
      "  … and 1 more (--full or --json for all of them)",
    ]);
  });
});
