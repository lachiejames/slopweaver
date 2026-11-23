/**
 * The message LIFECYCLE verbs — `correct`, `delete` and `edit` — placed into `slackManifest` in `./slack.ts` and held
 * apart so that file stays under its file-size ceiling. Each acts on ONE message that is already posted, which is the
 * seam: none of them sends anything new.
 *
 * PR5.2. These are separate verbs rather than flags on `post`, and separate from `SlackWriteVerb`, because that union
 * dispatches on `--as` into the as-me DRIP lane — and editing a drip is explicitly out of scope ("which message of N
 * do you edit?" has no reference answer yet). Keeping them apart means the drip lane cannot reach them by
 * construction.
 *
 * Each entry is exported BY NAME rather than as one object to spread, because the noun's key order is what `--help`
 * lists: `./slack.ts` puts `delete` before `dm` and `edit` after it, exactly where they stood before this split, and
 * `correct` beside them. `slackCorrectVerb`, `slackDeleteVerb`, `slackEditVerb` and the shared `slackWriteMeta` are
 * exported from here only; `./slack.ts` imports all four, and this module imports nothing from it.
 */
import { CORRECT_USAGE, DELETE_USAGE, EDIT_USAGE } from "../commands/slack/slackUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared write meta — every field spelled out (CommandMeta requires it), only summary/example vary. */
export const slackWriteMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  effect: "external-write",
  parseRejectIsIoFree: true,
} as const;

/** `slack correct` — strike a claim Slopweaver sent, as the bot or as the owner, and add a bold Correction line under it. */
export const slackCorrectVerb: VerbManifestEntry = lazy({
  load: () => import("../commands/slack/correctRun.js").then((m) => m.slackCorrectCommand),
  meta: {
    ...slackWriteMeta,
    example:
      'slopweaver slack correct --channel C123 --ts 1712345678.000100 --wrong "10 failed" --correction "30 failed." --dry-run',
    summary:
      "Correct a claim Slopweaver sent, as the bot or (--as me) as you, in place: strike the wrong words and add " +
      "a bold Correction line under them, never a delete or a bare reply — through the door",
    usage: CORRECT_USAGE,
  },
});

/** `slack delete` — delete one message slopweaver or the owner posted. */
export const slackDeleteVerb: VerbManifestEntry = lazy({
  load: () => import("../commands/slack/lifecycleRun.js").then((m) => m.slackDeleteCommand),
  meta: {
    ...slackWriteMeta,
    example: "slopweaver slack delete --channel D123 --ts 1712345678.000100 --as me --dry-run",
    summary: "Delete a Slack message slopweaver or you posted (never anyone else's) — through the door",
    usage: DELETE_USAGE,
  },
});

/** `slack edit` — re-render a bot card, or rewrite one message the owner posted, in place. */
export const slackEditVerb: VerbManifestEntry = lazy({
  load: () => import("../commands/slack/lifecycleRun.js").then((m) => m.slackEditCommand),
  meta: {
    ...slackWriteMeta,
    example: "slopweaver slack edit --channel D123 --ts 1712345678.000100 --as me --body - --dry-run",
    summary:
      "Edit a Slack message in place — a bot card re-rendered from a new form, or ONE message you posted " +
      "yourself (--as me, --form or --body) — through the door",
    usage: EDIT_USAGE,
  },
});
