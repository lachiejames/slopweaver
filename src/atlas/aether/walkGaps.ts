/**
 * Which gaps one Aether portal walk raises — the standing pair every walk carries, each shortfall the walk
 * itself measured, and the single sign-in-wall gap a signed-out walk raises instead.
 *
 * Pure: it reads only the walk, its reduction and this run's timestamp, and minting each gap is `gaps.ts`'s.
 * `surface.ts` publishes what this decides.
 */
import type { AetherGap } from "./entities.js";
import { openAetherGap } from "./gaps.js";
import type { AetherReduction } from "./reduction.js";
import type { AetherWalkResult } from "./walk.js";

/** One gap a walk MIGHT raise, with the count that decides whether it did. `count: null` is always raised. */
interface GapCandidate {
  readonly condition: AetherGap["condition"];
  readonly kind: AetherGap["kind"];
  readonly count: number | null;
  readonly fields: readonly string[];
  readonly reason: string;
  readonly scope: string;
}

/**
 * The two gaps every walk raises, because they are true of every walk (`descriptor.ts` names why).
 *
 * `count: null` means always raised — the Risk Report is a print-to-PDF this atlas cannot fetch, and
 * `browser shot` has no adapter for this host, so the walk's own raw screenshot is the only picture.
 */
const STANDING_GAP_CANDIDATES: readonly GapCandidate[] = [
  {
    condition: "report-print-only",
    count: null,
    fields: [],
    kind: "finding",
    reason:
      "the portal's Risk Report at /risk-inbox/report is a print-to-PDF with no download endpoint this atlas found; its findings are reduced from the Risk Inbox instead, and getting the PDF out needs the owner to press print",
    scope: "risk-report",
  },
  {
    condition: "no-shot-adapter",
    count: null,
    fields: [],
    kind: "page",
    reason:
      "`slopweaver browser shot` carries no adapter for app.tryaether.ai, so a framed, source-owned proof capture is unavailable; the walk's own raw page screenshot is the only picture",
    scope: "aether-portal",
  },
];

/**
 * Every gap this walk could raise, with the count that decides whether it did.
 *
 * A table rather than five near-identical `if` blocks, so a sixth shortfall is one row. The standing pair is
 * {@link STANDING_GAP_CANDIDATES}; the rest are the walk's own shortfalls, raised only when their count is
 * above zero.
 */
function gapCandidates({
  walk,
  reduction,
}: {
  walk: AetherWalkResult;
  reduction: AetherReduction;
}): readonly GapCandidate[] {
  const unreachable = walk.pages.filter((page) => page.outcome !== "landed" && page.outcome !== "login-wall");
  return [
    ...STANDING_GAP_CANDIDATES,
    {
      condition: "page-unreachable",
      count: unreachable.length,
      fields: unreachable.map((page) => page.href),
      kind: "page",
      reason: `${String(unreachable.length)} of ${String(walk.pages.length)} declared route(s) did not render`,
      scope: "aether-portal",
    },
    {
      condition: "page-unphotographed",
      count: walk.unrenderedPages.length,
      fields: [...walk.unrenderedPages],
      kind: "page",
      reason: `${String(walk.unrenderedPages.length)} route(s) were reached but photographed mid-load`,
      scope: "aether-portal",
    },
    {
      condition: "response-body-lost",
      count: walk.incompletePages.length,
      fields: [...walk.incompletePages],
      kind: "finding",
      reason: `${String(walk.incompletePages.length)} route(s) lost at least one response body, so what they carried is reduced incompletely`,
      scope: "aether-portal",
    },
    {
      condition: "schema-drift",
      count: reduction.unprojectable.length,
      fields: reduction.unprojectable.slice(0, 8),
      kind: "finding",
      reason: `${String(reduction.unprojectable.length)} finding-anchored object(s) carried a severity or state this atlas does not know, so they were not stored`,
      scope: "finding",
    },
  ];
}

/**
 * The gaps this walk actually raised: the standing pair, plus every shortfall whose count is above zero.
 *
 * @returns the open, stamped gaps a walk that read the portal records
 */
export function walkGaps({
  walk,
  reduction,
  at,
}: {
  walk: AetherWalkResult;
  reduction: AetherReduction;
  at: string;
}): readonly AetherGap[] {
  return gapCandidates({ reduction, walk })
    .filter((candidate) => candidate.count === null || candidate.count > 0)
    .map((candidate) =>
      openAetherGap({
        at,
        condition: candidate.condition,
        fields: candidate.fields,
        kind: candidate.kind,
        reason: candidate.reason,
        scope: candidate.scope,
        surfaces: ["aether-portal"],
      }),
    );
}

/**
 * The single gap a signed-out walk raises: it reached the portal and landed on the sign-in form.
 *
 * @returns the one cross-kind login-wall gap, naming every route that hit the sign-in form
 */
export function loginWallGaps({ walk, at }: { walk: AetherWalkResult; at: string }): readonly AetherGap[] {
  return [
    openAetherGap({
      at,
      condition: "login-wall",
      fields: [...walk.loginWallPages],
      kind: null,
      reason:
        "the walk reached the portal but landed on the Aether sign-in form; the owner's Chrome holds no live session for app.tryaether.ai",
      scope: "aether-portal",
      surfaces: ["aether-portal"],
    }),
  ];
}
