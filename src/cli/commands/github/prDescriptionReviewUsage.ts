/**
 * The usage lines of the description-review pair, `slopweaver github pr review-prepare` and `review-record`.
 *
 * A LEAF, for the same reason as `./prUsage.ts`: the `github` manifests read these strings on every invocation, so a
 * command module holding them would put itself on every load path. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver github pr review-prepare`'s usage line. */
export const GITHUB_PR_REVIEW_PREPARE_USAGE =
  "usage: slopweaver github pr review-prepare --repo <owner/name> --base <branch> --title <text> --body-file <path>\n" +
  "                     --comments <path> (--new | --number <n>)\n" +
  "                     [--base-ref <ref>] [--head <ref>] [--branch <name>] [--cwd <dir>] [--images <path>]\n" +
  "                     [--evidence <file,...>] [--json] [--home <dir>]\n" +
  "  review-prepare     build the packet a FRESH reviewer reads before a description reaches GitHub: the exact\n" +
  "                     title and body, the inline comments the same write posts, every comment already on the\n" +
  "                     pull request, every image with the line it proves, the change set and the written\n" +
  "                     rules, committed as a repository. Prints the Codex review, the visible-Claude fallback\n" +
  "                     and the `review-record` that follow. Runs no model and writes nothing to GitHub\n" +
  "  --comments <path>  a JSON array of {path, line, body}, the exact inline comments the write posts ([] for none)\n" +
  "  --new              the description opens a pull request: no comments exist yet\n" +
  "  --number <n>       the open pull request it is for; every comment already on it is read and bound, each\n" +
  "                     thread resolved, or resolved by this write's round, shown to the reviewer as history\n" +
  "  --title <text>     the exact title the write verb will send\n" +
  "  --body-file <path>  a file holding the exact body bytes the write verb will send (its --dry-run prints them)\n" +
  "  --base-ref <ref>   the git ref the merge base is taken against (default origin/<base>)\n" +
  "  --head <ref>       the commit the description describes (default HEAD)\n" +
  "  --branch <name>    the pull request's head branch; when a fleet-finding row claims it, the packet's evidence/\n" +
  "                     opens with that finding's record (an agent observed it, the day it was registered)\n" +
  "  --cwd <dir>        the checkout holding the branch (default the working directory)\n" +
  "  --images <path>    a JSON array of {url, sha256, proves, receiptId, file}, one per image the body shows;\n" +
  "                     each file must hold exactly the bytes its sha256 names\n" +
  "  --evidence <file,...>  records behind any act the description credits to the owner\n" +
  "  --json             one JSON object: preparation, repoRoot and commands\n" +
  "  Refused when this exact packet already has its review: the lane takes one pass per distinct packet.";

/** `slopweaver github pr review-record`'s usage line. */
export const GITHUB_PR_REVIEW_RECORD_USAGE =
  "usage: slopweaver github pr review-record --review <artifact-or-receipt-id> [--json] [--home <dir>]\n" +
  "  review-record      turn a fresh reviewer's verdict on a `review-prepare` packet into the ONE receipt the\n" +
  "                     write verbs read. A Codex pass id or a Claude fallback receipt id. A fallback review is\n" +
  "                     recorded by the session that took it, and refused when that is the session that\n" +
  "                     prepared the packet. Exits 0 on CLEAN, 1 on BROKEN; only a CLEAN receipt opens a write\n" +
  "  --review <id>      the Codex artifact id, or the Claude fallback receipt or request id\n" +
  "  --json             the receipt as one JSON object";
