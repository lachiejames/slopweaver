/**
 * The visible caps `slopweaver turn status` holds a worker to, and nothing else.
 *
 * A LEAF on purpose: `slopweaver turn status`'s usage line quotes them, and that line is read on every invocation through
 * the manifest barrel, while `liveStatus.ts` reaches zod. Keep it importing nothing
 * (`src/__tests__/unit/cli/manifestBarrelClosure.test.ts` pins it as a shared leaf).
 */

/**
 * How many characters of live status text the checklist's in-flight step may show.
 *
 * Exported: `../../cli/commands/turn/status.ts`'s self-reported push shares this exact cap, so an inline
 * turn's own status line and a `fresh-visible-session` screen-scrape read the same visible limit rather than
 * two independently-chosen numbers that could quietly drift apart.
 */
export const LIVE_STATUS_CAP = 120;

/**
 * The most steps one declared plan may hold — the card's whole outline, above the fold, so `turn status
 * --plan` REFUSES a longer one rather than clipping it (`./progressPlan.ts`).
 */
export const PLAN_STEPS_MAX = 7;

/** The longest one planned step's title may be, in characters — one outline line, never a wrapped one. */
export const PLAN_STEP_TITLE_MAX = 60;
