/**
 * The four long usage blocks of the `github` noun's own verbs, in one place.
 *
 * Split out of `./github.ts` for the reason `./githubStackUsage.ts` was, and on the same ratchet: a usage
 * string grows with a verb's flags rather than with the manifest's job of naming verbs, so it crowds out the
 * thing a reader opens that file for. Every other verb here already keeps its usage beside its core module
 * and is imported; these four have no core module of their own to sit in.
 */

import {
  GITHUB_PR_REVIEW_PREPARE_USAGE,
  GITHUB_PR_REVIEW_RECORD_USAGE,
} from "../commands/github/prDescriptionReviewUsage.js";
import {
  GITHUB_PR_RELEASE_RESERVATION_USAGE,
  GITHUB_PR_REQUEST_REVIEW_USAGE,
  GITHUB_PR_RETARGET_USAGE,
  GITHUB_PR_REVIEWERS_USAGE,
  GITHUB_PR_STANDING_USAGE,
  GITHUB_PR_SUMMARY_USAGE,
} from "../commands/github/prUsage.js";

export const USAGE =
  "usage: slopweaver github pr <update|request-review|retarget|release-reservation|summary|standing|reviewers|" +
  "review-prepare|review-record> " +
  "[--form <json|->] " +
  "[--file <path|->] " +
  "[--edit <json|->] [--pull] [--convert-c3] [--out <path>] " +
  "[--self-review <json|->] [--repo <owner/name>] " +
  "[--number <n>] [--base <ref>] [--head <ref>] [--expect-head <sha>] [--dry-run] [--json] " +
  "[--home <dir>]\n" +
  "  create           REFUSED. Every pull request Slopweaver opens is a native GitHub stack entry, so\n" +
  "                     `github stack push` opens it. Same form, same gates, and\n" +
  "                     it amends and pushes the checked-out branch itself, so no separate `github push`\n" +
  "  update             with --edit, change NAMED fields only: the rest is re-rendered from the description\n" +
  "                     already on GitHub, so nothing unnamed can be lost. With --form or --file, replace\n" +
  "                     the whole description. With --pull, read the live description into an editable\n" +
  "                     file instead of sending anything\n" +
  "  request-review     request review from one or more colleagues and/or teams — see its own usage below\n" +
  "  retarget           change a pull request's base branch through the door — see its own usage below\n" +
  "  release-reservation  settle a create reservation this machine is holding against what GitHub reports on\n" +
  "                     the branch pair — the operator's door instead of deleting a ledger record by hand.\n" +
  "                     See its own usage below\n" +
  "  summary            read one pull request down to its number, title, state and own Problem, Risk and\n" +
  "                     Blast radius cells, for a queue card. See its own usage below\n" +
  "  standing           read one pull request's approvals, open requests, base-branch rules, CI, CodeRabbit\n" +
  "                     and merge state, for the console voice. See its own usage below\n" +
  "  reviewers          derive who reviews what from the diff and CODEOWNERS, for a review ask; nothing is\n" +
  "                     written. See its own usage below\n" +
  "  review-prepare     build the packet a fresh reviewer reads before a description reaches GitHub — see below\n" +
  "  review-record      record that reviewer's verdict as the receipt the write verbs read — see below\n" +
  "  --form <json|->    the whole form as inline JSON, or `-` to read it from stdin. It REPLACES the\n" +
  "                     description and prints the diff first\n" +
  "  --file <path|->    the whole form as a markdown+frontmatter authoring file (a real path, or `-` for\n" +
  "                     stdin) — the human-editable alternative to --form's JSON. Same rules as --form\n" +
  "                     otherwise. A file produced by --pull also carries a digest of the description it was\n" +
  "                     pulled from; a push is refused if the live description has since changed\n" +
  "  --pull             exclusive with every other input: read the live description into an\n" +
  "                     editable authoring file (see --file), print the advisory PR voice brief with\n" +
  "                     the body's current explainer, and exit. Nothing is sent\n" +
  "  --convert-c3       with --pull, read a pre-C3 description and write a C3 authoring file plus a\n" +
  "                     conversion report (<out>.report.txt) naming every field still to write. Nothing\n" +
  "                     is sent; push the file back with --file once it is filled in\n" +
  "  --out <path>       where --pull writes its file. Defaults to pr-<number>.md in the working directory\n" +
  "  --edit <json|->    the fields to change, as inline JSON, or `-` to read them from stdin. An undeclared\n" +
  "                     field is refused by name rather than ignored\n" +
  "  --self-review <json|->  optional strict {comments:[{kind,path,line,body}]} reviewer walkthrough. kind is\n" +
  "                     behaviour-change|moved-unchanged|risk|test|explanation and renders the comment's emoji.\n" +
  "                     Each body is at most 50 words, names files in backticks, links no pinned blob, and\n" +
  "                     passes the configured exact voice rules and the publication scan\n" +
  "  --repo <owner/name>  the repository, with either --number or the --base/--head pair\n" +
  "  --number <n>       the pull-request number — the direct way, and the only one that still works once\n" +
  "                     the branches have been deleted or renamed\n" +
  "  --base <ref>       the branch being merged into\n" +
  "  --head <ref>       the branch being merged from; resolved against GitHub, and refused when two pull\n" +
  "                     requests share the pair\n" +
  "  --expect-head <sha>  the full head sha the edit was derived at; refused, nothing sent, when the pull\n" +
  "                     request's live head is another one\n" +
  "  --dry-run        print the exact body bytes and the gate's verdict, and send nothing. It resolves a\n" +
  "                     token and performs GETs, never a PATCH\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home to use\n" +
  "  Self-review comments orient a cold reviewer in plain English beside the code that matters. They are\n" +
  "  reviewer wayfinding, not author receipts or a second long-form pull-request description.\n\n" +
  GITHUB_PR_REQUEST_REVIEW_USAGE +
  "\n\n" +
  GITHUB_PR_RETARGET_USAGE +
  "\n\n" +
  GITHUB_PR_RELEASE_RESERVATION_USAGE +
  "\n\n" +
  GITHUB_PR_SUMMARY_USAGE +
  "\n\n" +
  GITHUB_PR_STANDING_USAGE +
  "\n\n" +
  GITHUB_PR_REVIEWERS_USAGE +
  "\n\n" +
  GITHUB_PR_REVIEW_PREPARE_USAGE +
  "\n\n" +
  GITHUB_PR_REVIEW_RECORD_USAGE;

export const MERGE_USAGE =
  'usage: slopweaver github merge --repo <owner/name> --base <ref> --head <ref> --description <text|"-"> ' +
  "[--admin --number <n> [--dry-run]] [--remote <name>] [--cwd <dir>] [--deletion-threshold <n>] " +
  "[--acknowledge <subject,...>] [--acknowledge-all --reason <text>] [--home <dir>]\n" +
  "  Measures the diff, the base branch's own history since the fork, and every orchestration-doc probe,\n" +
  "  then refuses (non-zero exit) while any finding stands unacknowledged.\n" +
  "  WITHOUT --admin it REPORTS ONLY: no token, no GitHub call, nothing merged, closed or pushed.\n" +
  "  WITH --admin a CLEAN report is followed by a real squash merge through the repository\n" +
  "  administrator's branch-protection bypass, recorded by the door. It refuses, naming which one\n" +
  "  failed, when the token is not an admin or the base branch's protection has enforce_admins=true.\n" +
  "  Base freshness is remeasured against a freshly fetched remote tip first, so a base that moved\n" +
  "  since the last push refuses here rather than landing unvalidated.\n" +
  "  A merge made any other way — `gh pr merge`, the GitHub UI — still bypasses this guard entirely;\n" +
  "  it is a discipline, not a fence.\n" +
  "  While `slopweaver github hold` stands over this repository, every pull request it does not name is\n" +
  "  REFUSED here — on this path too, which is why a report may name itself with --number.\n" +
  "  --repo <owner/name>  the report's label, the repository addressed by --admin, and the key deciding\n" +
  "                     which standing merge hold, if any, governs this invocation\n" +
  "  --base <ref>       the branch being merged into, as a ref THIS repository can already resolve\n" +
  "  --head <ref>       the branch being merged from, as a ref this repository can already resolve\n" +
  '  --description <text|"-">  the pull request\'s body text, or "-" to read it from stdin\n' +
  "  --cwd <dir>        the git repository to inspect (default: the current directory)\n" +
  "  --deletion-threshold <n>  removed lines above which a modified, unnamed file is also reported (default 40)\n" +
  "  --admin            merge for real once the report is clean, using the administrator bypass\n" +
  "  --dry-run          with --admin: make every check the merge makes, in order, then print `would merge`\n" +
  "                     and write nothing (no door record, no merge, no hold released). A required context\n" +
  "                     not yet on the head is a note here, since a lap posts it; a standing hold is a note\n" +
  "                     too. A native stack member is refused in both modes, since GitHub's merge\n" +
  "                     endpoint does not merge one: the refusal names `enqueue` or `stack remove`\n" +
  "  --number <n>       the pull request this invocation is for. Required by --admin, which merges it;\n" +
  "                     without it, how the report says which pull request a standing hold should let\n" +
  "                     through\n" +
  "  --remote <name>    the Git remote --admin refetches the base branch from (default: origin)\n" +
  "  --acknowledge <a,b>  comma-separated finding subjects (a path, an orchestration-doc slug, or\n" +
  "                     base-moved/base-unmeasurable from the --admin freshness remeasure) to accept\n" +
  "  --acknowledge-all  accept every finding — MUST be paired with --reason\n" +
  "  --reason <text>    why --acknowledge-all is justified; printed in the report\n" +
  "  --home <dir>       the state home whose handovers/ board is swept for probe regressions";

export const PUSH_USAGE =
  "usage: slopweaver github push [--cwd <dir>] [--remote <name>] [--force-with-lease] " +
  "[--self-review <json|->] [--dry-run] [--acknowledge <base-moved,base-unmeasurable>] " +
  "[--acknowledge-all --reason <text>] [--orphan-above <n,n>] [--home <dir>]\n" +
  "  Push the CHECKED-OUT pull-request branch to the same-named branch on the configured Git remote.\n" +
  "  Arbitrary refspecs and the remote's default branch are unrepresentable. The write runs through the\n" +
  "  admit door, streams the repository's pre-push hook, and is reported successful only after the remote\n" +
  "  branch reads back at the exact local SHA.\n" +
  "  Before writing anything, the remote's default branch is fetched and checked for ancestry against the\n" +
  "  exact local commit being pushed. A base that has moved (or a check that could not be completed) REFUSES\n" +
  "  loudly — rebase onto the current base, rerun the full gate, and retry — unless acknowledged.\n" +
  "  The streamed pre-push hook is the repository's own gate, not this door's — in a repository whose gate\n" +
  "  runs a full constraints set (acme-admin, measured), expect roughly five minutes, not seconds. A caller\n" +
  "  that times out first has pushed NOTHING: the remote stays at the pre-push SHA, so the safe recovery is\n" +
  "  to re-read the remote and retry, never to assume a partial push.\n" +
  "  --cwd <dir>          the repository to push (default: current directory)\n" +
  "  --remote <name>      the configured Git remote (default: origin)\n" +
  "  --force-with-lease   for a rebased branch, use an exact lease against the SHA read from the remote\n" +
  "  --self-review <json|->  post a fresh reviewer walkthrough after the exact pushed SHA is confirmed\n" +
  "  --dry-run            read and print the exact plan, including the base-freshness measurement; no door\n" +
  "                       record and no push\n" +
  "  --acknowledge <a,b>  accept a named base-freshness finding (base-moved, base-unmeasurable) and proceed\n" +
  "  --acknowledge-all    accept every finding — MUST be paired with --reason\n" +
  "  --reason <text>      why --acknowledge-all is justified; printed in the report\n" +
  "  --orphan-above <n,n>  accept orphaning EXACTLY these stacked pull requests. A push of a branch with\n" +
  "                       open pull requests stacked on it carries them — rebased and pushed in the same\n" +
  "                       invocation — or refuses and names each one it cannot carry. This is the\n" +
  "                       break-glass, and it must name every one of them and nothing else\n" +
  "  --home <dir>         the state home whose door ledger records the write";

export const READ_USAGE =
  "usage: slopweaver github read <github-object-url> [--limit <1..100>] [--media-out <dir>] [--files] [--json] [--home <dir>]\n" +
  "  Reads one named object from the provider now; it does not search the workspace or consult history\n" +
  "  --limit           cap each selected activity connection (default 25, maximum 100)\n" +
  "  --media-out       download the pictures and videos an issue or pull request body embeds into this\n" +
  "                    directory, numbered in body order, and list each file's path, size and sha256.\n" +
  "                    Absent means none were asked for; an empty list means the body embeds none\n" +
  "  --files           pull requests only: also read the files it changes, each with its patch, at\n" +
  "                    data.files (every page, up to GitHub's 3000-file cap; a cut is named in the\n" +
  "                    residue with how many files it left out). An un-merged one\n" +
  "                    also carries data.diffOnBase: whether every change is already on its base\n" +
  "                    branch's current tip (on-base, partly, not-on-base, unknown with a reason), and\n" +
  "                    each file's own answer at data.diffOnBaseFiles\n" +
  "  --json            emit one machine-readable document with freshness, coverage and residue\n" +
  "  --home            resolve the credential from this Slopweaver state home";
