/**
 * A fully-typed {@link LandingRow}, so a test over one states only the fields it is about.
 *
 * Not a mock — a plain builder with a complete, green default and a `Partial` override, which is the shape
 * `.claude/rules/testing.md` calls a fake. It is shared rather than per-file because the type has forty
 * fields and every one of them has to be present for the compiler: a second copy drifts the moment a field
 * is added, and the copy nobody updated is the one whose test stops compiling for a reason unrelated to
 * what it asserts.
 */
import type { LandingRow } from "../review/landing.js";

/** The complete, green, unblocked row every fake starts from. */
const GREEN_ROW: LandingRow = {
  action: "press",
  approvedBy: [],
  authorLogin: "octocat",
  githubCodeowners: {
    owners: [],
    requestsTruncated: false,
    residue: [],
    sentence: "GitHub names no code owner for these paths",
    teams: [],
    users: [],
  },
  actionDetail: "every test passed and it is not queued — press 'Merge when ready'",
  baseDistance: { kind: "read", value: { aheadBy: 1, behindBy: 3, status: "DIVERGED" } },
  baseRefName: "staging",
  createdAtIso: "2026-09-01T00:00:00.000Z",
  blockedOn: [],
  boardRow: { kind: "none-declared", why: "no handover row declares this branch" },
  bump: { kind: "unknown", why: "nobody has been asked, so there is nothing to bump" },
  checksRead: { kind: "read" },
  checksTruncated: false,
  ci: "green",
  ciFailure: { kind: "not-red" },
  codeRabbit: "green",
  codeRabbitDetail: "no comments",
  conflict: { local: { kind: "not-requested" }, mergeable: "MERGEABLE" },
  conversations: {
    codeRabbit: { answeredOpen: 0, awaitingUs: 0, open: 0, resolved: 0, reviewerLastWord: 0 },
    humans: { answeredOpen: 0, awaitingUs: 0, open: 0, resolved: 0, reviewerLastWord: 0 },
  },
  dispatch: { kind: "act", verdict: "merge-now", why: "every test passed and it is not queued" },
  failingChecks: [],
  headOid: "1111111111111111111111111111111111111111",
  headRefName: "feature/one",
  humanWait: undefined,
  labels: [],
  number: 16378,
  openThreads: [],
  owedCodeowners: [],
  oursResolvable: 0,
  queue: { kind: "not-queued" },
  ready: true,
  repoSlug: "acme/widgets",
  residue: [],
  reviewsTruncated: false,
  slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
  askTrail: [],
  channelShare: undefined,
  stack: {
    baseRefName: "staging",
    chain: [16378],
    defaultBranch: "staging",
    grounded: true,
    position: 1,
    size: 1,
    stacked: false,
  },
  standingChangesRequested: [],
  tests: [],
  threads: [],
  threadsTruncated: false,
  title: "a change",
  updatedAtIso: "2026-09-09T12:00:00.000Z",
  url: "https://github.com/acme/widgets/pull/16378",
};

/**
 * One landing row, green and unblocked unless the caller says otherwise.
 *
 * @param over the fields this test is actually about
 * @returns a complete row with those fields replaced
 */
export function landingRowFake(over: Partial<LandingRow> = {}): LandingRow {
  return { ...GREEN_ROW, ...over };
}
