/**
 * `slopweaver github bump-drive`'s usage line and the bounds it quotes, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/github.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

import { DEFAULT_OPT_OUT_LABEL } from "./landingUsage.js";

/** The default ceiling on how many pull requests one pass reads. */
export const DEFAULT_LIMIT = 100;

/**
 * How many pull requests one pass will ever enqueue.
 *
 * A pass that queued ten bumps at once would be an unattended landing wave nobody asked for, and a recipe row
 * fires again, so nothing is lost by stopping at three. `github landing --press` no longer caps a bump at all
 * (`./landingUsage.ts`'s `NON_OWNER_PRESS_CAP_PER_REPO`), so a chair that wants every ready bump queued now
 * runs that verb rather than waiting on this one's next firing.
 */
export const BUMP_ENQUEUE_CAP = 3;

/**
 * How many board rows one pass will ever write.
 *
 * Set for the READER rather than for safety, exactly as the landing register's cap is: an unregistered bump
 * is registered by the next firing. MEASURED on `lachiejames/slopweaver`, ten open renovate pull
 * requests were all behind `main` at once, which is more new rows than one firing should grow the board by.
 */
export const BUMP_SEAT_CAP = 5;

/**
 * How many pull-request descriptions one pass will ever rewrite.
 *
 * Its own cap rather than a share of the enqueue one, because it is a different act on a different surface:
 * a rewrite is an outbound WRITE to somebody else's pull request, taken under two escape hatches, and the
 * number that bounds a queue press says nothing about how many of those an unattended firing should make.
 * Lower than both the others on purpose — a rewrite that is wrong is wrong in public.
 */
export const BUMP_REWRITE_CAP = 2;

/**
 * How many of the owner's superseded bumps one pass will ever close.
 *
 * Above the others because a close is an act to take within hours and is undone
 * with one reopen; still a bound, so a matching rule that is wrong closes ten at most before a person sees it.
 */
export const BUMP_CLOSE_CAP = 10;

/** The `close-superseded` act's lines, held apart so the usage function stays one screen. */
const CLOSE_SUPERSEDED_USAGE =
  "    close-superseded     one of the OWNER'S OWN bumps (read whole off `viewer.pullRequests`, past the --limit)\n" +
  "                         that a Renovate pull request merged into the same base after it opened already did —\n" +
  "                         same subject, a target at least as new — or whose merge into the base would\n" +
  "                         change nothing, per GitHub's test merge at the base's current tip. Closed through\n" +
  "                         `github close` with a comment naming the Renovate merge or the empty merge\n" +
  "                         (hours, never days). Never a bot's or a colleague's pull request\n";

/**
 * The usage text for `github bump-drive`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubBumpDriveUsage(): string {
  return (
    "usage: slopweaver github bump-drive [--repo <owner/name,...>] [--limit <n>] [--opt-out-label <name,...>]\n" +
    "                                   [--dry-run] [--json] [--home <dir>]\n" +
    "  Drive every open DEPENDENCY BUMP pull request one step closer to landing, through the door, and put a\n" +
    "  board row on the one board for each one that needs a session instead. Written to be run by a recipe\n" +
    "  row as well as by hand.\n" +
    "  A pull request is a bump when its author is a bump BOT, its head is `renovate/`- or `dependabot/`-\n" +
    "  prefixed, or its TITLE is a bump — three signals because no one of them covers the population, and\n" +
    "  each row says which one selected it.\n" +
    "  ONE act per bump, and only acts this verb can finish in one pass:\n" +
    CLOSE_SUPERSEDED_USAGE +
    "    enqueue              every one of the six landing tests passed — press 'Merge when ready'\n" +
    "    undraft-and-enqueue  every test BUT the draft flag passed, so mark it ready and then queue it.\n" +
    "                         This is the act the fleet had no word for: `renovate.json` sets `draftPR: true`,\n" +
    "                         and MEASURED, four of ten renovate drafts would have landed at once\n" +
    "    rewrite-body         `dev-gate` is the ONLY failing check on a NON-RENOVATE bot's bump, so the\n" +
    "                         description is the whole problem: the origin rule wants an origin in the Problem cell and\n" +
    "                         that template names none. A Renovate body is never written over (the owner's rule),\n" +
    "                         so a Renovate bump red only there is a seat. The body is recomposed from the\n" +
    "                         typed bump form (silver, since a bot force-pushes its own rebases) and sent\n" +
    "                         through `github pr update`, which re-reads the live one and diffs it first. ONE\n" +
    "                         rewrite per head, ever: the autonomy row it writes is the guard, so a `dev-gate`\n" +
    "                         still red afterwards becomes a seat instead of a loop\n" +
    "    review-withheld      a RENOVATE bump GitHub is holding only for a code owner it names. Its review is\n" +
    "                         the owner's, never a colleague's, and the owner is withholding it while the Eng\n" +
    "                         Security discussion runs. Nothing is written, no board row and no\n" +
    "                         Queue card\n" +
    "    awaiting-human-review  any OTHER bump GitHub is holding for a code owner it NAMES. The owner's ruling:\n" +
    "                         a bump is pressed the moment it is mergeable, and `acme-admin` branch\n" +
    "                         protection wanting a human review is the gap to name rather than route around.\n" +
    "                         Nothing is written and no board row is opened, and the pass that approval lands\n" +
    "                         presses it\n" +
    "    seat                 a rebase, a red check or a reviewer thread — real work, so a board row, never a\n" +
    "                         retry and never a card (`AGENTS.md` rule 10)\n" +
    "    held                 an opt-out label stands on it\n" +
    "    nothing              GitHub already holds a queue entry for it\n" +
    "  Every enqueue is written to the AUTONOMY ledger with its subject, so an act taken unasked is visible in\n" +
    "  the owner's briefing rather than only in a transcript. A press nobody can see is a press nobody made.\n" +
    "  A BOT-authored bump's press acknowledges `codex-loop-incomplete` and nothing else, with its reason in the\n" +
    "  door ledger: no session authored it, so no pairing pass can ever exist for it. A red rollup, a missing\n" +
    "  required context, an unapproved review and a non-mergeable head each still refuse.\n" +
    "  --repo <owner/name,...>  one or more repositories, comma-separated; default the current checkout's\n" +
    "                     `origin` remote\n" +
    `  --limit <n>        stop after this many pull requests (default ${String(DEFAULT_LIMIT)})\n` +
    "  --opt-out-label <name,...>  labels that hold a bump back from every act; default\n" +
    `                     \`${DEFAULT_OPT_OUT_LABEL}\`, compared lower-cased. This is how a bump no rebase will\n` +
    "                     ever fix is taken out of the rotation — a label a human can attach from GitHub's own\n" +
    "                     interface, never an attempt counter this machine keeps\n" +
    "  --dry-run          print exactly what would happen and write nothing at all\n" +
    "  --json             emit one machine-readable document instead of the report\n" +
    "  --home <dir>       resolve the credentials, board and ledger from this Slopweaver state home\n" +
    `  Capped at ${String(BUMP_ENQUEUE_CAP)} enqueue(s), ${String(BUMP_REWRITE_CAP)} description rewrite(s), ${String(BUMP_SEAT_CAP)} board row(s), ${String(BUMP_CLOSE_CAP)} close(s) per pass, so an\n` +
    "  unattended firing cannot become a landing wave. It fires again; nothing is lost by stopping.\n" +
    "  A rewrite adds SLOPWEAVER_ALLOW_FOREIGN_PR and SLOPWEAVER_ALLOW_PR_REPLACE to that one child call — the\n" +
    "  pull request belongs to a bot and the whole description is replaced — and each outcome says so."
  );
}
