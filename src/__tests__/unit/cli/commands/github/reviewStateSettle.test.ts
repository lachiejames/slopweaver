import { describe, expect, it } from "vitest";

import { settleMergeable } from "../../../../../cli/commands/github/reviewStateSettle.js";
import { DISTANCE_NOT_REQUESTED } from "../../../../../live/github/baseDistance.js";
import type { GithubChecksSnapshot } from "../../../../../live/github/checks.js";
import type {
  MergeableAnswer,
  MergeableRecheck,
  MergeableSubject,
} from "../../../../../live/github/mergeableRecheck.js";
import type { PrLiveState } from "../../../../../live/github/reviewState.js";

/** A head's checks snapshot, whole and green. */
const snapshot = (over: Partial<GithubChecksSnapshot> = {}): GithubChecksSnapshot => ({
  baseRef: undefined,
  checks: [],
  headSha: "head-1",
  mergeable: undefined,
  residue: [],
  rollupState: "SUCCESS",
  supersededChecks: [],
  truncated: false,
  ...over,
});

/** One live pull request, mergeable unless told otherwise. */
const pr = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "author-login",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "staging",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: snapshot({ baseRef: "staging", mergeable: "MERGEABLE" }),
  checksRead: { kind: "read" },
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-10-01T00:00:00Z",
  defaultBranch: "staging",
  githubMergeStatus: { kind: "mergeable", status: "CLEAN" },
  headOid: "head-1",
  headRefName: "feature/one",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 7,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [],
  reviewsTruncated: false,
  threadCount: 0,
  threads: [],
  threadsTruncated: false,
  title: "a title",
  updatedAtIso: "2026-10-01T01:00:00Z",
  url: "https://github.com/acme/widgets/pull/7",
  ...over,
});

type Answers = Awaited<ReturnType<MergeableRecheck>>;

/** A recheck seam answering `answers` in order, recording every home it was built for and every subject list it was asked. */
function recheckSeam({ answers }: { answers: Answers }): {
  deps: Parameters<typeof settleMergeable>[0]["deps"];
  homes: (string | undefined)[];
  asked: (readonly MergeableSubject[])[];
} {
  const homes: (string | undefined)[] = [];
  const asked: (readonly MergeableSubject[])[] = [];
  return {
    asked,
    deps: {
      mergeableRecheck:
        ({ home }) =>
        ({ subjects }) => {
          homes.push(home);
          asked.push(subjects);
          return Promise.resolve(answers);
        },
    },
    homes,
  };
}

/** A recheck answer that read `mergeable` of `headOid`. */
const read = ({ mergeable, headOid }: MergeableAnswer): Answers[number] => ({
  kind: "read",
  value: { headOid, mergeable },
});

describe("settleMergeable", () => {
  it("returns the very same array, without asking, when nothing is UNKNOWN", async () => {
    const seam = recheckSeam({ answers: [] });
    const prs = [pr({ mergeable: "MERGEABLE" }), pr({ mergeable: "CONFLICTING", number: 8 })];
    const settled = await settleMergeable({ deps: seam.deps, home: undefined, prs });
    expect(settled).toBe(prs);
    expect(seam.asked).toStrictEqual([]);
    expect(seam.homes).toStrictEqual([]);
  });

  it("asks only about the UNKNOWN rows, for the given home, and settles each on the same head", async () => {
    const seam = recheckSeam({
      answers: [
        read({ headOid: "head-1", mergeable: "CONFLICTING" }),
        read({ headOid: "head-9", mergeable: "MERGEABLE" }),
      ],
    });
    const known = pr({ mergeable: "MERGEABLE", number: 1 });
    const unknownA = pr({ headOid: "head-1", mergeable: "UNKNOWN", number: 2 });
    const unknownB = pr({ headOid: "head-9", mergeable: "UNKNOWN", number: 3 });
    const settled = await settleMergeable({ deps: seam.deps, home: "/some/home", prs: [known, unknownA, unknownB] });
    expect(seam.homes).toStrictEqual(["/some/home"]);
    expect(seam.asked.map((subjects) => subjects.map((subject) => subject.number))).toStrictEqual([[2, 3]]);
    expect(settled.map((row) => row.mergeable)).toStrictEqual(["MERGEABLE", "CONFLICTING", "MERGEABLE"]);
    expect(settled[0]).toBe(known);
  });

  it("keeps UNKNOWN when the recheck answered a different head", async () => {
    const seam = recheckSeam({ answers: [read({ headOid: "head-moved", mergeable: "MERGEABLE" })] });
    const settled = await settleMergeable({
      deps: seam.deps,
      home: undefined,
      prs: [pr({ headOid: "head-1", mergeable: "UNKNOWN" })],
    });
    expect(settled.map((row) => row.mergeable)).toStrictEqual(["UNKNOWN"]);
  });

  it("keeps UNKNOWN when the recheck itself answered UNKNOWN", async () => {
    const seam = recheckSeam({ answers: [read({ headOid: "head-1", mergeable: "UNKNOWN" })] });
    const settled = await settleMergeable({ deps: seam.deps, home: undefined, prs: [pr({ mergeable: "UNKNOWN" })] });
    expect(settled.map((row) => row.mergeable)).toStrictEqual(["UNKNOWN"]);
  });

  it("keeps UNKNOWN when the recheck could not read the row, and settles the rows it could", async () => {
    const seam = recheckSeam({
      answers: [{ kind: "unread", why: "GitHub answered 502" }, read({ headOid: "head-1", mergeable: "MERGEABLE" })],
    });
    const settled = await settleMergeable({
      deps: seam.deps,
      home: undefined,
      prs: [pr({ mergeable: "UNKNOWN", number: 1 }), pr({ mergeable: "UNKNOWN", number: 2 })],
    });
    expect(settled.map((row) => row.mergeable)).toStrictEqual(["UNKNOWN", "MERGEABLE"]);
  });

  it("keeps UNKNOWN when the recheck returned fewer answers than rows asked", async () => {
    const seam = recheckSeam({ answers: [] });
    const settled = await settleMergeable({ deps: seam.deps, home: undefined, prs: [pr({ mergeable: "UNKNOWN" })] });
    expect(settled.map((row) => row.mergeable)).toStrictEqual(["UNKNOWN"]);
  });

  it("settles two pull requests sharing a number in different repositories independently", async () => {
    const seam = recheckSeam({
      answers: [
        read({ headOid: "head-1", mergeable: "CONFLICTING" }),
        read({ headOid: "head-1", mergeable: "MERGEABLE" }),
      ],
    });
    const settled = await settleMergeable({
      deps: seam.deps,
      home: undefined,
      prs: [
        pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/bad" }),
        pr({ mergeable: "UNKNOWN", number: 7, repoSlug: "acme/good" }),
      ],
    });
    expect(settled.map((row) => `${row.repoSlug}:${row.mergeable}`)).toStrictEqual([
      "acme/bad:CONFLICTING",
      "acme/good:MERGEABLE",
    ]);
  });
});
