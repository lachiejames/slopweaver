/**
 * The repo-relative path prefixes that make a change relevant to the bot's own loop chain — the loop, its
 * recipe/listen/turn CLI surface, its live provider reads, and the outbound renderer that composes what it
 * sends.
 *
 * Enumerated rather than derived. Each entry earns its place from the measurement that this list
 * exists to prevent a recurrence of: 74 commits a standing session was behind touched `skills/loop/**`,
 * `skills/loop-bot/**`, the then `recipe-scheduler` skill and `src/cli/commands/listen/**` — every one of
 * them a path on this list — while that session kept running the old code and the old skill prose. `src/live`
 * and `src/outbound` are here for the same reason: the live provider reads and the composed answer's own
 * renderer are exactly the invisible half of that failure when a fix to either lands and a standing session
 * does not pick it up.
 *
 * Two independent call sites judge "does this change matter to the loop chain" against this list —
 * `STANDING_SENSITIVE_PATHS` (`../live/standing/freshness.ts`, grading a standing session's drift) and
 * `TURN_PATH_PREFIXES` (`../cli/commands/github/turnPathCore.ts`, classifying a pull request as turn-path).
 * Both import this constant rather than each keeping its own copy, so the two can never silently disagree
 * about which paths matter — see `src/__tests__/unit/lib/loopChainPaths.test.ts`'s parity test.
 */
export const LOOP_CHAIN_PATHS: readonly string[] = [
  "skills/loop",
  "skills/loop-bot",
  "skills/recipe-scheduler",
  "src/cli/commands/listen",
  "src/cli/commands/automation",
  "src/cli/commands/turn",
  "src/live",
  "src/outbound",
];
