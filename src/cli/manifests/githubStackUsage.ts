/**
 * `github stack`'s own usage text.
 *
 * Split out of `./github.ts` when that manifest crossed the 600-code-line ratchet: this one verb's help is a
 * third of the file, and it grows with every sub-verb rather than with the manifest's own job.
 */

/** The whole `github stack` usage block, one sub-verb after another. */
export const STACK_USAGE =
  "usage: slopweaver github stack <push|sync|restack|submit|adopt|audit|remove|dissolve> [...] [--cwd <dir>] " +
  "[--remote <name>] " +
  "[--dry-run] [--pr <n>] [--orphan-above <n,n>] [--home <dir>]\n" +
  "  push               THE verb that opens a pull request — every one Slopweaver\n" +
  "                     opens is a native GitHub stack entry. It amends the worktree into the current\n" +
  "                     commit, pushes it, opens the pull request from the form, then registers it against\n" +
  "                     the parent named by the form's target.base — GitHub's own computed stack, never a\n" +
  "                     local ledger, is the membership/order authority. A target.base of the repository\n" +
  "                     default is the bottom of a stack of one and needs no registration. Re-run on a\n" +
  "                     branch whose pull request is already open, it UPDATES that pull request instead,\n" +
  "                     through every gate `pr update --form` applies, each checked before the amend\n" +
  "  push --form <json|-> | --file <path|-> | --form-example | --file-example\n" +
  "       [--self-review <json|->] [--dry-run] [--wait] [--timeout-seconds <n>]\n" +
  "       [--acknowledge <base-moved,base-unmeasurable,already-landed>] [--acknowledge-all --reason <text>]\n" +
  "  --form <json|->    the whole pull-request form as inline JSON, or `-` to read it from stdin.\n" +
  "                     target.head must be the checked-out branch; target.base is the parent stack entry's\n" +
  "                     branch, or the repo default for the bottom of a fresh stack. A form carrying a\n" +
  "                     review is refused: the grade is set afterwards with an edit on `github pr update`\n" +
  "  --form-example     print the advisory PR voice brief, a complete, already-valid --form, then the\n" +
  "                     review a reviewer later sets on it, and exit. No git, no token, no network. Run\n" +
  "                     this FIRST if you have not filled this form before\n" +
  "  --file <path|->    the whole form as a markdown+frontmatter authoring file (a real path, or `-` for\n" +
  "                     stdin) — the human-editable alternative to --form's JSON\n" +
  "  --file-example     print the advisory PR voice brief and a complete, already-valid --file, and exit.\n" +
  "                     No git, no token, no network\n" +
  "  --self-review <json|->  post a fresh reviewer walkthrough after the stack entry is confirmed\n" +
  "  --wait             hold at the repository's operation lock until the stack verb already running there\n" +
  "                     finishes, instead of refusing so you retry the whole verb in a loop. A timeout\n" +
  "                     prints that verb's own refusal, naming the holding pid, its age and the stale\n" +
  "                     threshold — which is longer than this default, so a healthy holder can outlast it\n" +
  "  --timeout-seconds <n>  how long --wait may hold for the lock (default 540, inside the 600s ceiling a\n" +
  "                     foreground Bash call gets); a longer wait belongs in the background\n" +
  "  --acknowledge <a,b>  accept a named creation finding (base-moved, base-unmeasurable, already-landed).\n" +
  "                     already-landed additionally REQUIRES --reason, naming which deliberate re-land\n" +
  "                     this is\n" +
  "  --acknowledge-all  accept every finding — MUST be paired with --reason\n" +
  "  --reason <text>    why --acknowledge-all (or --acknowledge already-landed) is justified; printed in\n" +
  "                     the report\n" +
  "  --orphan-above <n,n>  push accepts orphaning EXACTLY these stacked pull requests. A push of a branch\n" +
  "                     that is already a mid-stack entry carries everything above it — rebased and pushed\n" +
  "                     in the same invocation — or refuses and names each one it cannot carry. This is the\n" +
  "                     break-glass, and it must name every one of them and nothing else\n" +
  "  sync               walk every native stack you're part of, repo-wide across worktrees, and rebase each\n" +
  "                     entry whose base is no longer a git ancestor of its head — plus everything above it\n" +
  "                     in the same stack — pushing each with an exact force-with-lease as it goes. Refuses,\n" +
  "                     per-stack, at the first merged, unregistered, worktree-less or not-exactly-one-\n" +
  "                     commit entry it meets — GitHub's own reported commit count decides that last one,\n" +
  "                     never a local guess\n" +
  "  restack            rebase EVERY open pull request you authored onto its latest base — the whole forest,\n" +
  "                     bottom-up, entirely LOCALLY. The whole restack happens on\n" +
  "                     this machine and only then does anything get force-pushed, so a stack whose PR two\n" +
  "                     moved while PR three did not cannot be produced. Scope is your open pull requests,\n" +
  "                     not the members of a native stack, so a pull request based straight on the trunk is\n" +
  "                     restacked like any other. Each branch is replayed in a scratch worktree, so it needs\n" +
  "                     no checkout and may be any number of commits; the result is staged at\n" +
  "                     refs/slopweaver/restack/<branch> and the local branch is moved onto it when nothing\n" +
  "                     has it checked out. A conflict stops that tree, names the conflicting paths, aborts\n" +
  "                     its own rebase, and leaves every other tree restacked. It NEVER pushes\n" +
  "  restack [--cwd <dir>] [--remote <name>] [--dry-run] [--home <dir>]\n" +
  "\n" +
  "  submit             push what the last `restack` prepared, in tree order, ALL OR NOTHING.\n" +
  "                     A stack in a bad state refuses the whole submit rather than leaving half\n" +
  "                     a stack behind. Every check runs before the first transport: your local state must\n" +
  "                     still describe every open pull request you have, every prepared ref must still hold\n" +
  "                     what it prepared, and every remote head must still be the one your state recorded.\n" +
  "                     If someone else pushed to one of your pull requests it FAILS and names it; only\n" +
  "                     --force accepts that, and it accepts nothing else. GitHub moves one ref at a time, so\n" +
  "                     a transport that fails part way names the pushed prefix, the failure and the\n" +
  "                     untouched suffix, and leaves your local state alone\n" +
  "  submit [--force] [--cwd <dir>] [--remote <name>] [--dry-run] [--home <dir>]\n" +
  "  --force            accept that a branch moved on the remote since your state recorded it, and push over\n" +
  "                     it with an exact lease against what it holds NOW\n" +
  "\n" +
  "  adopt              pull an EXISTING, already-open pull request into local stack state and GitHub's own\n" +
  "                     native stack: rebase and force-push its one commit onto its base's fresh tip, using\n" +
  "                     the exact safe primitive `sync` trusts, then register it — locally, and natively\n" +
  "                     against the parent named by its own base branch. Refuses a PR that is not open, not\n" +
  "                     in this repository, not checked out, not exactly one commit (GitHub's own reported\n" +
  "                     count), or whose local HEAD does not match GitHub's reported head SHA — those three\n" +
  "                     replay refusals name --register-only as the way past them. Never retargets a base,\n" +
  "                     never inserts at a position, never touches the description\n" +
  "  adopt --pr <n> [--register-only]\n" +
  "  --pr <n>           the pull-request number to adopt; its head branch must already be checked out,\n" +
  "                     unless --register-only is passed\n" +
  "  --register-only    register the native stack membership and the local enrolment, and replay NOTHING: no\n" +
  "                     rebase, no push, no commit count read, no checked-out branch required. The mode for a\n" +
  "                     DRIFTED chained pull request, which push refuses as chained-not-native while adopt\n" +
  "                     refuses its multi-commit replay — a deadlock no local rewrite can break. Reports\n" +
  "                     membership only: the branch is still not rebased, `sync` still cannot replay it, and\n" +
  "                     pushing the PARENT may now refuse on carry (--orphan-above is that route)\n" +
  "\n" +
  "  audit              list every OPEN pull request in a repository whose base branch is another open pull\n" +
  "                     request's head branch WITHOUT both of them sitting in the same native GitHub stack —\n" +
  "                     the chained-not-native class the creation, push and retarget doors refuse. Reads\n" +
  "                     only; it never adopts, retargets or writes anything, because most violations in a\n" +
  "                     busy repository belong to other authors\n" +
  "  audit --repo <owner/name> [--mine] [--check] [--json] [--home <dir>]\n" +
  "  --repo <owner/name>  the repository to audit — never derived from a checked-out remote, since auditing\n" +
  "                     another repository from this one is the ordinary case\n" +
  "  --mine             report only violations involving a pull request this token authored\n" +
  "  --check            exit non-zero when any reported violation survives — how CI fails a chain that was\n" +
  "                     routed around the doors\n" +
  "  --json             emit the violations as one machine-readable document\n" +
  "  --cwd <dir>        the repository to operate from (default: current directory)\n" +
  "  --remote <name>    the configured Git remote (default: origin)\n" +
  "  --dry-run          print the exact plan; no rebase, no door record, no push, no network write\n" +
  "  --home <dir>       the state home whose door ledger records the write\n" +
  "\n" +
  "  remove             drop ONE pull request out of its native stack, leaving every other entry\n" +
  "                     registered and every pull request open — the escape hatch `pr retarget` names when\n" +
  "                     it refuses a stacked pull request. GitHub exposes no per-entry removal, so this\n" +
  "                     unstacks the whole native stack, then re-forms the remaining entries (when two or\n" +
  "                     more survive) as a new stack, in their original order. Refuses a stack with any\n" +
  "                     merged entry — unstack would leave it in place, which this composite cannot tell\n" +
  "                     apart from nothing needing removal\n" +
  "  remove --repo <owner/name> --pr <n> [--dry-run] [--home <dir>]\n" +
  "  --repo <owner/name>  the repository the pull request lives in — this verb never touches Git, so it is\n" +
  "                     never derived from a checked-out remote\n" +
  "  --pr <n>           the pull request to remove from its native stack\n" +
  "\n" +
  "  dissolve           unregister every entry in a native stack through GitHub's own removal endpoint,\n" +
  '                     leaving every pull request open and its base untouched — "the stack is upside\n' +
  "                     down, start again.\" A locked or already-merged entry survives (GitHub's own\n" +
  "                     documented behaviour); the report names exactly what did\n" +
  "  dissolve --repo <owner/name> --stack <n> [--dry-run] [--home <dir>]\n" +
  "  --repo <owner/name>  the repository the stack lives in\n" +
  "  --stack <n>        the native stack number to dissolve";
