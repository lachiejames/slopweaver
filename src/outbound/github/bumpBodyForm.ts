/**
 * The DEPENDENCY-BUMP pull-request form — the C3 description `github bump-drive` writes over Renovate's own.
 *
 * The composer is the mechanical half, exactly as `./vulnerabilityForm.ts` is for a dependabot fix: the caller
 * supplies the landing row it already read and gets a draft whose rendered description is the C3 shape the gate
 * reads. `unit/outbound/github/bumpBodyForm.test.ts` renders and gates it, so this claim is checked rather than
 * asserted.
 *
 * ## The description has to clear TWO gates, and the second one was found LIVE
 *
 * `github pr update` runs the same above-the-fold voice pass every outbound surface runs
 * (`../../cli/commands/github/aboveFoldGate.ts`), and it refuses a colon that introduces a list. MEASURED on the
 * first live pass (`slopweaver github bump-drive --repo lachiejames/slopweaver`): both rewrites were refused, each on
 * a cell that opened with a colon and then listed two facts. The test feeds the composed cells to `aboveFoldFindings`
 * as well, so both gates are checked there rather than discovered by a refused write.
 *
 * ## Nothing on screen, so the proof is `tests only`
 *
 * A version bump changes nothing a screenshot could show, so both proof slots are one-line reasons and the form says
 * `nothing-on-screen`: the proof badge reads grey `tests only`, which is honest, rather than amber `not run yet`. The
 * evidence a bump carries is this repository's own checks over the lockfile diff, linked rather than quoted, because
 * the verdict changes under the reader while the link stays true.
 */

import type { LandingRow } from "../../review/landing.js";
import type { Content, PrFormDraft, WorstKind } from "./types.js";

/** The one thing a dependency bump can break, as the top risk item names it. */
export const BUMP_WORST_CASE = "a breaking release of the moved dependency";

/** A breaking release stops something that works, so the risk badge reads medium. */
const BUMP_WORST_KIND: WorstKind = "something-working-breaks";

/** The checks link: this repository's own CI over Renovate's diff. */
function checksLink({ row }: { row: LandingRow }): Content {
  return [
    { kind: "link", text: `this repository's own checks on ${row.headOid.slice(0, 7)}`, url: `${row.url}/checks` },
  ];
}

/** Both proof slots: one-line reasons, since a version bump changes nothing a screenshot could show. */
function proofSlotsOf({ row }: { row: LandingRow }): Pick<PrFormDraft, "problemProof" | "solutionProof"> {
  return {
    problemProof: {
      kind: "reason",
      reason: [
        { kind: "text", text: "A version behind shows nothing on screen. " },
        { kind: "link", text: "Renovate's pull request", url: row.url },
        { kind: "text", text: " names the release." },
      ],
    },
    solutionProof: {
      kind: "reason",
      reason: [
        { kind: "text", text: "Nothing on screen changes. " },
        ...checksLink({ row }),
        { kind: "text", text: " judge it." },
      ],
    },
  };
}

/**
 * Renovate's bump, as a C3 draft this repository's own gate accepts.
 *
 * The problem is SEEN on the day the pass that composes this saw the newer release, by an agent: a scheduled pass
 * runs in an agent's session.
 *
 * @param row the landing row already read for this pull request
 * @param observedIso when the pass that composes this saw it, as a UTC ISO-8601 instant — the seen day is its first
 *   ten characters, which is the calendar day and needs no Date
 * @param draft whether the pull request is still a draft — the form carries its current state, since composing a
 *   description is not the act that undrafts one
 * @returns the C3 draft, ready for `github pr update --form`
 */
export function prFormOfBump({
  row,
  observedIso,
  draft,
}: {
  row: LandingRow;
  observedIso: string;
  draft: boolean;
}): PrFormDraft {
  // A destructured default rather than `??` or a ternary: `no-silent-fallback` bans the first two spellings, and
  // oxlint's prefer-nullish-coalescing bans the third. The slug a landing row carries is always `a/b`, so both
  // defaults are unreachable and each names the whole slug rather than an empty string.
  const [owner = row.repoSlug, repo = row.repoSlug] = row.repoSlug.split("/");
  const day = observedIso.slice(0, 10);
  return {
    checks: [
      [
        { kind: "text", text: "Only this dependency's manifest and lockfile entries move, per " },
        { kind: "link", text: "Renovate's diff", url: `${row.url}/files` },
        { kind: "text", text: "." },
      ],
    ],
    draft,
    explainer: [
      { kind: "text", text: "The version this repository resolves is behind the one Renovate found in " },
      { kind: "code", text: row.title },
      {
        kind: "text",
        text: `, opened by ${row.authorLogin}. This is Renovate's own change, unedited. Nothing else moves.`,
      },
    ],
    notChecked: [
      {
        check: [{ kind: "text", text: "The release notes" }],
        why: [{ kind: "text", text: "No changelog was read, so only the linked checks judge the release." }],
      },
    ],
    ...proofSlotsOf({ row }),
    problemSeen: { by: "agent", kind: "seen", on: day, what: "the resolved version was behind the one Renovate found" },
    rerun: [],
    risk: {
      items: [
        {
          check: { check: `This repository's own checks ran on ${row.headOid.slice(0, 7)}`, kind: "checked" },
          worst: BUMP_WORST_CASE,
          worstKind: BUMP_WORST_KIND,
        },
      ],
    },
    target: { base: row.baseRefName, head: row.headRefName, owner, repo },
    title: row.title,
    visualProof: "nothing-on-screen",
  };
}
