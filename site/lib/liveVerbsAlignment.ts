/**
 * The Alignment page's rows of the console's read allowlist, kept beside `./liveVerbs.ts` and spread into it whole, so
 * that list stays the one place a slug resolves and this file is only where these rows are written — the same shape
 * as `./liveVerbsPlans.ts`. Every rule `./liveVerbs.ts`'s header states applies here unchanged.
 */
import type { LiveVerb } from "./liveVerbs";

/**
 * Alignment's reads: the owner's measured voice, their voice rules, their answers, and their named feedback on drafts.
 *
 * @param slowTimeoutMs the slow lane's timeout, passed in so the lane has one number
 * @returns the rows, in the order the page draws them
 */
export function alignmentLiveVerbs({ slowTimeoutMs }: { slowTimeoutMs: number }): readonly LiveVerb[] {
  return [
    // The Alignment page's three reads, MEASURED on this machine's home: 1.91s, 2.60s and 1.69s, each
    // startup-bound. The owner's measured voice and their voice rules are SLOW for cadence: one moves when a re-measure lands,
    // the other when a ruling does. Reproduce with `time ./bin/slopweaver profile voice --json` and the titles below.
    {
      argv: ["profile", "voice", "--json"],
      format: "json",
      lane: "slow",
      slug: "voice-profile",
      stampsItsOwnTime: false,
      timeoutMs: slowTimeoutMs,
      title: "slopweaver profile voice --json",
    },
    {
      argv: ["slack", "voice-rules", "--json"],
      format: "json",
      lane: "slow",
      slug: "voice-rules",
      stampsItsOwnTime: false,
      timeoutMs: slowTimeoutMs,
      title: "slopweaver slack voice-rules --json",
    },
    {
      // The owner's answers are FAST: an answer can land from a call or the supervisor rather than a press on the page, and no
      // `settle` re-reads this slug, so read once it would stay stale until a remount. The sidebar polls it too, on
      // its one-minute cadence; the page that is open governs (`useLive`'s shortest wins).
      argv: ["talk", "log", "--about-prefix", "align:", "--json"],
      format: "json",
      lane: "fast",
      slug: "alignment-answers",
      stampsItsOwnTime: false,
      timeoutMs: slowTimeoutMs,
      title: "slopweaver talk log --about-prefix align: --json",
    },
    // The owner's named feedback on drafts they sent back, which the Alignment page counts into "make it a general ruling?" —
    // the same relay ledger as the answers above, so the same timeout; an open Alignment or Queue page re-reads it each
    // minute (`../components/console/useAlignmentWaiting.ts`).
    {
      argv: ["talk", "log", "--about-prefix", "post:", "--json"],
      format: "json",
      lane: "slow",
      slug: "triage-feedback",
      stampsItsOwnTime: false,
      timeoutMs: slowTimeoutMs,
      title: "slopweaver talk log --about-prefix post: --json",
    },
    // Every source of the owner's guidance, ranked: SLOW, since a ruling, a memory or a class steer moves it rarely, and
    // the read opens the store and walks the run journals. Reproduce with `time ./bin/slopweaver profile guidance --json`.
    {
      argv: ["profile", "guidance", "--json"],
      format: "json",
      lane: "slow",
      slug: "guidance",
      stampsItsOwnTime: false,
      timeoutMs: slowTimeoutMs,
      title: "slopweaver profile guidance --json",
    },
  ];
}
