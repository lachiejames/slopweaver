/**
 * `slopweaver github landing`'s usage line and the bounds it quotes, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/github.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

import { DEFAULT_CADENCE_MINUTES, MAX_CADENCE_MINUTES } from "../../../review/readCadence.js";

/**
 * The label that opts a pull request out of any press.
 *
 * Owner ruling: sometimes a green pull request is open to start an argument, not to land. So an
 * opt-out exists BEFORE the first press rather than after the first surprise, and it is a GitHub label
 * because that is the only control a human can attach from GitHub's own interface without this machine.
 * Compared lower-cased, so `No-Auto-Merge` and `no-auto-merge` are one label.
 */
export const DEFAULT_OPT_OUT_LABEL = "no-auto-merge";

/** The default ceiling on how many pull requests one invocation reads. */
export const DEFAULT_LIMIT = 100;

/**
 * How many pressable rows that are NOT the owner's one repository presses in one invocation.
 *
 * The owner's own rows (an `--author @me` read) and every dependency bump are pressed uncapped: the owner's
 * standing rule already decides them, and a cap there only made the chair run the verb three times for seven
 * ready bumps (`../../../review/landingPressSelection.ts`). What this still bounds is a wide
 * `--repo` read reaching a colleague's green pull request — pressing a handful is the supervisor doing clicks
 * it had the information to make, pressing twenty would be a landing wave over other people's work.
 */
export const NON_OWNER_PRESS_CAP_PER_REPO = 3;

/**
 * How long one invocation keeps STARTING presses, counted from the start of its first row, that row's own
 * pre-press reads included, so the bound is on the press phase's wall time. The first row always presses, a press
 * already under way finishes, and every row still waiting after this is reported `not pressed`; the next pass
 * presses it.
 *
 * A BUDGET, set against the supervisor tick's: the tick kills the whole landing read at 300s
 * (`LANDING_TIMEOUT_MS`, `src/supervisor/scratch/tickCapture.ts`) and a killed read reports nothing — not the rows
 * it read, not the presses it made. Before the press each row is read and judged (MEASURED: 58s for both
 * repositories and eight pressable rows, `time slopweaver github landing --repo <a>,<b> --author @me --press
 * --dry-run --json`), and one press's two pairing-floor reads and one bump-witness read measured 17-20s and 14-19s
 * each after `src/codex/branchEvidenceRoots.ts`. So 150s of starts, plus the last press, plus the read, ends inside
 * the tick's budget with room for the register writes, where an eight-row backlog pressed end to end did not.
 *
 * **The residue, stated rather than discovered.** This bounds a BACKLOG, never one row: a single press, or one
 * row's own pre-press read (ledger, head, judgment), that itself stalls past the tick is still killed with the
 * read, because the budget is a check between calls and never a timer racing one (both found by Codex reviews).
 * For a press that is the price of never abandoning a write half made, and either way it is the same failure the
 * tick reported before this budget, never a new one. The check is asked before a row's pre-press reads and again immediately before its press, so a row whose reads
 * cross the line is reported `not pressed`. It reads a wall clock, so a rollback mid-pass can let one more row
 * start, costing one press past 150s, well inside the tick's remaining margin.
 */
export const PRESS_PASS_BUDGET_MS = 150_000;

/**
 * How many board rows one invocation will ever write.
 *
 * Unlike {@link NON_OWNER_PRESS_CAP_PER_REPO} this bounds a WRITE nobody has to undo — an unregistered row is
 * simply registered by the next read, minutes later — so it is set for the reader rather than for safety: one tick's board
 * write stays something a person can take in. MEASURED: twelve of the owner's 23 open pull requests were
 * dispatchable at once, which is more new rows than any briefing should grow in one tick.
 */
export const REGISTER_CAP = 10;

/**
 * How many ended pull requests one `--register` pass reads and settles — the rest are the next pass's.
 *
 * Each one is a GitHub read and a board write. Larger than {@link REGISTER_CAP} because a settle REMOVES a row
 * the reader would otherwise have to take in: MEASURED: 15 slopweaver landing rows sat open over
 * pull requests that had already ended, so a backlog drains in one tick rather than two.
 */
export const CLOSURE_CAP = 20;

/**
 * The usage text for `github landing`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubLandingUsage(): string {
  return (
    "usage: slopweaver github landing [--repo <owner/name,...>] [--author <login>] [--press [--dry-run]]\n" +
    "                                [--if-due [--cadence-minutes <n>]] [--register [--dry-run]]\n" +
    "                                [--include-drafts | --drafts-only] [--slack-live] [--limit <n>]\n" +
    "                                [--opt-out-label <name,...>] [--json] [--home <dir>]\n" +
    "                                [--record-reading <by>] [--full]\n" +
    "       slopweaver github landing --pr <number> --repo <owner/name> [--author <login>] [--home <dir>]\n" +
    "  Break every open pull request the selection matches into ONE next act, so a supervisor tick can press,\n" +
    "  register or wait without inferring anything. Read-only unless --press or --register is given.\n" +
    "  By default it prints ONE fact line per pull request, grouped by what the supervisor does about it: the\n" +
    "  verdict and act, CI with the failing checks named REQUIRED or advisory, CodeRabbit, who approved, the\n" +
    "  code owners for the paths touched (approved or pending), whether Slack holds an ask, and the title.\n" +
    "  --full prints every row's whole table entry instead; --pr prints one row whole.\n" +
    "  A head carrying more check contexts than one 100-context page is re-read whole, up to 500, so a big\n" +
    "  head is judged on every check it carries rather than reading `unknown`.\n" +
    "  Six tests decide whether a pull request can land, and every one is a fact GitHub published: it is not\n" +
    "  a draft; CI is green AND every context the base branch REQUIRES actually ran; GitHub reports it\n" +
    "  mergeable; no reviewer thread is waiting on us; GitHub holds no open code-owner request and either\n" +
    "  states APPROVED or, stating no decision, reports the merge CLEAN, UNSTABLE or HAS_HOOKS (BLOCKED fails\n" +
    "  once CI is green; UNKNOWN, BEHIND or an unread status is unknown, never a press); and its base is the\n" +
    "  default branch and has a merge queue to press.\n" +
    "  The code-owner test reads GITHUB's own answer, never the derived CODEOWNERS reading. MEASURED\n" +
    "  on a repository where `reviewDecision` is null: `github enqueue` called 20 of 29 open pull\n" +
    "  requests clean and three were ready, because an absent decision read as satisfied.\n" +
    "  Each row also names who is blocking it, which check failed, whether CodeRabbit is failing or stale,\n" +
    "  who is waiting on a thread, where it sits in a stack, its merge-queue entry, and whether the handover\n" +
    "  board already holds its branch (a row's declared `branch:` or its run's recorded one).\n" +
    landingFlagsUsage()
  );
}

/** The flag reference and the closing invariants of `github landing`'s usage text. */
function landingFlagsUsage(): string {
  return (
    "  --repo <owner/name,...>  one or more repositories, comma-separated; default the organisation's own\n" +
    "                     repositories (`slopweaver org show`) plus this build's own, refused with\n" +
    "                     ORG_NOT_CONFIGURED when no organisation is written\n" +
    "  --author <login>   only pull requests opened by this login; GitHub's own `@me` is the token's user\n" +
    `  --press            press GitHub's own 'Merge when ready' on every row this read calls \`press\`, through\n` +
    "                     the door, recording each with its subject and head. Every row of an `--author @me`\n" +
    "                     read and every dependency bump is pressed in the one pass; anybody else's is capped\n" +
    `                     at ${String(NON_OWNER_PRESS_CAP_PER_REPO)} per repository per invocation. No press STARTS\n` +
    `                     ${String(PRESS_PASS_BUDGET_MS / 1000)}s after the first: each row still waiting reads failed,\n` +
    "                     `not pressed`, and the next pass presses it, so a backlog never outlasts the tick's\n" +
    "                     300s read. With --author @me it\n" +
    "                     first re-requests every STUCK CodeRabbit review (every thread resolved, CHANGES_REQUESTED\n" +
    "                     still standing twenty seconds after the read), once per head\n" +
    "  --dry-run          with --press or --register, print exactly what would happen and write nothing\n" +
    "  --if-due           read only when this selection's cadence has elapsed; otherwise print one line and\n" +
    "                     make NO GitHub request. Exits 0 either way, so a sweep can run it every tick and a\n" +
    "                     non-zero exit stays a real fault. Under --json a skipped tick emits a\n" +
    `                     \`kind: "skipped"\` document, never an empty read\n` +
    `  --cadence-minutes <n>  how long one selection's read holds; default ${String(DEFAULT_CADENCE_MINUTES)}, at most\n` +
    `                     ${String(MAX_CADENCE_MINUTES)} (seven days), needs --if-due\n` +
    "  --register         write one handover board row per dispatchable row, so the sweep's own fill step\n" +
    "                     seats it against measured capacity. A `merge-now` row is never registered: it is\n" +
    "                     enqueued directly, and a seat lane is not a thing this fleet has. A row a live\n" +
    `                     board row already holds is skipped, at most ${String(REGISTER_CAP)} per invocation.\n` +
    "                     It also SETTLES `answered` every ready, unattended landing row whose pull request\n" +
    "                     the open census no longer lists and GitHub reads MERGED or CLOSED, the merge commit\n" +
    `                     or close instant its witness, at most ${String(CLOSURE_CAP)} reads per invocation\n` +
    "  --include-drafts   include draft pull requests, which are excluded by default\n" +
    "  --drafts-only      read ONLY draft pull requests (GitHub's `draft:true`), on an --if-due ration of their\n" +
    "                     own — the tick's second reading, so drafts never ride the press read. Refuses\n" +
    "                     --press and --record-reading\n" +
    "  --slack-live       also run the LIVE Slack search, one per pull request, on top of the corpus scan\n" +
    "                     that always runs. It needs a Slack USER token; with none the leg is skipped and the\n" +
    "                     run says so in its residue rather than reading as though it ran.\n" +
    "                     MEASURED over 30 open pull requests with the corpus 10 hours behind:\n" +
    "                     corpus alone answered `asked` on 15 and `bump due` on 1; with this flag, 27 and 9\n" +
    `  --limit <n>        stop after this many pull requests (default ${String(DEFAULT_LIMIT)})\n` +
    "  --opt-out-label <name,...>  labels that hold a pull request back from any press; default\n" +
    `                     \`${DEFAULT_OPT_OUT_LABEL}\`, compared lower-cased\n` +
    "  --json             emit one machine-readable document instead of the text; every row carries its fact\n" +
    "                     line as `facts`\n" +
    "  --full             print the two-line-per-row table and every residue line, not one fact line per row\n" +
    "  --pr <number>      read ONE pull request in the one --repo given and print it whole: every test and its\n" +
    "                     why, the dispatch reason, the conversations, the failing checks with the test files\n" +
    "                     their job logs name, and whether this pull request ADDED each one. A merged or\n" +
    "                     closed one prints its merge commit or close instant instead of a row. Read-only: it\n" +
    "                     refuses --press, --register, --if-due, --record-reading, --include-drafts,\n" +
    "                     --drafts-only, --full and --json\n" +
    "  --home <dir>       resolve the credentials, board and store (its press and read registers) from this state home\n" +
    "  --record-reading <by>  append the document this read produced to the readings ledger as <by>\n" +
    "                     (a tick label, a session, `sync-now`), so a console page shows this tick's own\n" +
    "                     bytes and says who took them; a skipped tick records nothing. Needs --author @me:\n" +
    "                     the ledger is the Queue's reading of the owner's pull requests\n" +
    "  A row never reads `press` while a test is `unknown`: a read that could not answer a test must not\n" +
    "  print what a read that answered it prints. A pull request this machine already pressed, whose head has\n" +
    "  not moved and which GitHub has no entry for, reads `pressed-not-queued` and is never pressed again."
  );
}
