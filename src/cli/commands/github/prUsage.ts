/**
 * The usage lines of `slopweaver github`'s pull-request verbs — attach, close, comment, enqueue, label, ready,
 * required-contexts, self-review-release, thread, vuln and the `pr` sub-verbs, and nothing else.
 *
 * A LEAF on purpose: the `github` manifests under `cli/manifests/` read these strings on EVERY invocation, because
 * `--help`, `catalog` and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

export const GITHUB_ATTACH_USAGE =
  "usage: slopweaver github attach <upload|status> [--file <path>] [--repo <owner/name>] [--number <n>] " +
  '[--proves "<line>"] [--alt <text>] [--acknowledge <reason>] [--org <slug>] [--dry-run] [--json] [--home <dir>]\n' +
  "  upload             upload one local image or video to GitHub's own user-attachments host and print\n" +
  "                     the permanent URL, plus the markdown that embeds it. The only URL that renders\n" +
  "                     inline on a PRIVATE repository — raw.githubusercontent.com does not. Only a file\n" +
  "                     browser console-shot wrote is sent; every other capture verb is held until a\n" +
  "                     figure check exists. It is found by its bytes' capture receipt, its frame text scanned,\n" +
  "                     its five image checks passed. The asset is then fetched back, and only bytes\n" +
  "                     identical to those checked earn the upload receipt (upl-<id>) a description cites\n" +
  '  --proves "<line>"  upload only, required: one line saying what the picture proves, scanned and\n' +
  "                     carried into the upload receipt\n" +
  "  status             report which account your own Chrome is signed in to github.com as, and how long\n" +
  "                     its cookies last. Offline by default, and offline it cannot tell you they are\n" +
  "                     still live. Pass --org to make it ask GitHub, which is the only way to see a\n" +
  "                     SAML grant at all\n" +
  "  --file <path>      upload only: the local file. Extension picks the content type; a capture verb\n" +
  "                     writes .png or .mp4, so those are the two a receipt can stand behind\n" +
  "  --repo <owner/name>  upload only: the repository the asset is filed against\n" +
  "  --number <n>       upload only: a pull-request or issue number in that repository. The token is read\n" +
  "                     off a pull request's classic page; an issue has none, so it falls back to the\n" +
  "                     repository's releases/new, which needs push access\n" +
  "  --alt <text>       upload only: alt text for the printed image markdown (default the file's name).\n" +
  "                     Ignored for a video, which GitHub embeds from a bare URL\n" +
  "  --acknowledge <reason>  upload only: send a visual the invented-visual gate refuses — a shot of a page\n" +
  "                     served from this machine, a page or vector handed to an image slot, or a chart a\n" +
  "                     plotting library drew. Takes the REASON the real surface was unavailable, in at\n" +
  "                     least four words; the door records that the gate was waived\n" +
  "  --org <slug>       status only: ask GitHub whether your browser's session is SAML-authorised for that\n" +
  "                     organisation, and exit non-zero when it is not. A session and an org grant are\n" +
  "                     SEPARATE authorisations, so being signed in leaves a SAML org still walled\n" +
  "  --dry-run          upload only: classify the file, check it against GitHub's measured size ceiling\n" +
  "                     and print the plan. Fully offline — no door record, no scrape, nothing uploaded\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home holding the recorded Chrome profile and the door ledger\n" +
  "  The session comes from the Chrome profile recorded by `slopweaver browser profile`. It is\n" +
  "  read at the moment of the call and never saved, so signing in to github.com in your own browser is\n" +
  "  the whole of the setup.\n" +
  "  Size ceilings are GitHub's, measured against its own policy endpoint and enforced\n" +
  "  locally before any byte is sent: 10 MiB for an image, 100 MiB for a video, both inclusive.";

/** `slopweaver github close`'s usage line. */
export const GITHUB_CLOSE_USAGE =
  'usage: slopweaver github close --repo <owner/name> --number <n> [--why "…"] [--expect-head <sha>] [--dry-run] ' +
  "[--json] [--home <dir>]\n" +
  "  Close an OPEN pull request through the door, then read it back to confirm.\n" +
  "  Refuses a merged pull request, and refuses one that is already closed — both name the live state.\n" +
  '  --why "…"           posted as a closing comment before the close; required unless the pull request\n' +
  "                      already carries a comment (any author) from within the last hour — a silent close\n" +
  "                      is refused rather than performed\n" +
  "  --expect-head <sha> the full head sha the caller judged the close on; a pull request whose live head\n" +
  "                      differs is refused before the comment or the close\n" +
  "  --dry-run           read the current state and print the transition, but perform no write or door record.\n" +
  "                      Resolves a token and performs GETs — never fully offline\n" +
  "  --json              machine-readable output\n" +
  "  --home <dir>        the state home whose door records the write";

/** `slopweaver github comment`'s usage line. */
export const GITHUB_COMMENT_USAGE =
  "usage: slopweaver github comment <create|edit> --repo <owner/name> [--number <n>|--comment-id <id>] " +
  "--form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "  create             post a new top-level comment on an issue or pull request — they share one endpoint,\n" +
  "                     and this is the plain activity-feed message, distinct from `github thread reply`\n" +
  "  edit               replace a comment already posted, addressed by the numeric id `create` reports\n" +
  "  --repo <owner/name>  the repository\n" +
  "  --number <n>       create only: the issue or pull-request number\n" +
  "  --comment-id <id>  edit only: the comment's numeric id\n" +
  '  --form <json|->    the comment body: {"summary":[{"kind":"text","text":"…"}],"detail":[…]}. `summary`\n' +
  "                     is the whole message above the fold; `detail` is optional and renders collapsed\n" +
  "  --dry-run          print the exact bytes and the gate's verdict, and send nothing; no door record\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose door records the write\n" +
  "  Posted under the operator's own GitHub login — attributable, not authenticated. See the github skill.";

/** `slopweaver github enqueue`'s usage line. */
export const GITHUB_ENQUEUE_USAGE =
  "usage: slopweaver github enqueue --pr <n> --repo <owner/name> [--dequeue] [--dry-run] [--json]\n" +
  "                                [--acknowledge <subject,...>] [--acknowledge-all --reason <text>] [--home <dir>]\n" +
  "  Press GitHub's own 'Merge when ready': put a pull request into its landing branch's native merge queue\n" +
  "  through the door, then read `mergeQueueEntry` back to confirm the position it took.\n" +
  "  A NATIVE-STACK member goes automatically down GitHub's asynchronous merge REST path instead, which is\n" +
  "  the only one that accepts it, and queues every unmerged member BELOW it at the same time. Its landing\n" +
  "  branch is the STACK's base, not its own base — which is the branch of the member beneath it.\n" +
  "  Distinct from `github merge`, which squash-merges NOW through the administrator bypass, and\n" +
  "  from `github hold`/`release`, which govern slopweaver's own advisory lane and reach no repository —\n" +
  "  though a standing hold refuses this verb too, before any read. `--dequeue` is exempt.\n" +
  "  Every reason not to queue is printed as a finding and REFUSES the write until it is acknowledged.\n" +
  "  A pull request that is closed, still a draft, or whose landing branch has no merge queue is refused\n" +
  "  outright, and so is one whose queue requires NO status-check contexts, since such a queue merges on\n" +
  "  arrival without testing the merged result — acknowledging any of those could not make the write SAFE.\n" +
  "  --pr <n>           the pull request to queue\n" +
  "  --repo <owner/name>  the repository that owns it\n" +
  "  --dequeue          the inverse: take it back out of the queue. Judged by no finding — leaving a queue\n" +
  "                     only ever narrows what happens next\n" +
  "  --dry-run          read the state and print the whole report, but perform no write and no door record\n" +
  "  --acknowledge <subject,...>  accept named findings by subject (codex-loop-incomplete, ci-not-green,\n" +
  "                     ci-rollup-superseded, required-context-missing, review-not-approved, not-mergeable)\n" +
  "                     so they stop refusing the write. A rollup pinned by a run a re-run already replaced\n" +
  "                     is ci-rollup-superseded, never ci-not-green — the two are separate so the routine\n" +
  "                     acknowledgement cannot reach a red still standing on the head.\n" +
  "                     codex-loop-incomplete needs --reason even on its own, and that reason is written to\n" +
  "                     the door ledger so a waived pairing floor stays countable\n" +
  '  --acknowledge-all  accept every finding at once; MUST be paired with --reason "…"\n' +
  "  --reason <text>    why every finding is accepted, printed verbatim in the report\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose door records the write";

/** `slopweaver github label`'s usage line. */
export const GITHUB_LABEL_USAGE =
  "usage: slopweaver github label --repo <owner/name> --number <n> --add <label,...> [--dry-run] [--json] " +
  "[--home <dir>]\n" +
  "  Add labels to one issue or pull request through the door, then read them back to confirm\n" +
  "  --number <n>       the issue or pull-request number; a pull request is an issue to this endpoint\n" +
  "  --add <label,...>  comma-separated label names to add. A label the repository does not already\n" +
  "                     DEFINE is refused by name — GitHub would otherwise create it, so a typo becomes a\n" +
  "                     permanent repository label. Removing a label is unrepresentable\n" +
  "  --dry-run          read the current labels and print the change, but perform no write or door record";

/** `slopweaver github ready`'s usage line. */
export const GITHUB_READY_USAGE =
  "usage: slopweaver github ready --repo <owner/name> --number <n> [--undo] [--dry-run] [--json] [--home <dir>]\n" +
  "  Mark one draft pull request ready for review through the door, then read it back to confirm\n" +
  "  --undo             the inverse: return one open pull request to draft, same door and same read-back\n" +
  "  --dry-run          read the current state and print the transition, but perform no write or door record";

/** `slopweaver github actions`'s usage line. */
export const GITHUB_ACTIONS_USAGE =
  "usage: slopweaver github actions --repo <owner/name> [--disable [--apply]] [--json] [--home <dir>]\n" +
  "  Read whether hosted GitHub Actions runs on a repository, and switch it OFF through the door\n" +
  "  (bare)             read the switch: enabled, and which actions may run when it is on\n" +
  "  --disable          preview switching Actions off: before and after, no write, no door record\n" +
  "  --disable --apply  switch it off once through the door, then read it back; only a read-back saying\n" +
  "                     enabled=false is success. There is no switch ON here: the github repo verb turns\n" +
  "                     Actions on, under a stated policy and an approved digest";

/** `slopweaver github push-restriction`'s usage line. */
export const GITHUB_PUSH_RESTRICTION_USAGE =
  "usage: slopweaver github push-restriction [--repo <owner/name>] [--branch <name>] [--allow <login,...>]\n" +
  "                                [--unrestrict] [--dry-run] [--json] [--home <dir>]\n" +
  "  Read, and govern, who may push to, merge into and enqueue onto a branch — its classic protection\n" +
  "  rule's push restriction. With no --allow/--unrestrict it READS and writes nothing.\n" +
  "  --branch <name>    the branch whose rule to read or write; its pattern must be exactly this (default main)\n" +
  "  --allow <a,b>      restrict the branch to EXACTLY these user logins, replacing any allowance list\n" +
  "  --unrestrict       lift the restriction and empty the allowance list\n" +
  "  --dry-run          read the rule and print the change, but perform no write and no door record";

/** `slopweaver github required-contexts`'s usage line. */
export const GITHUB_REQUIRED_CONTEXTS_USAGE =
  "usage: slopweaver github required-contexts [--repo <owner/name>] [--branch <name>] [--require <a,b>]\n" +
  "                                [--drop <a,b>] [--exact] [--entries <1..100>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Read, and govern, which status-check contexts a branch REQUIRES — the setting that decides whether a\n" +
  "  CI check gates a landing or is merely reported. With no --require/--drop it READS and writes nothing.\n" +
  "  --branch <name>    the branch whose protection to read or write (default main)\n" +
  "  --require <a,b>    context names to ADD to the required set, unioned with what is already there\n" +
  "  --drop <a,b>       context names to REMOVE from the required set\n" +
  "  --exact            make --require the WHOLE list rather than an addition; refuses an empty result,\n" +
  "                     since a queue requiring nothing merges every entry untested\n" +
  "  --entries <1..100>  how many recent merge-queue entries the safety read looks at (default 5)\n" +
  "  --dry-run          read everything and print the change, but perform no write and no door record";

/** `slopweaver github self-review release`'s usage line. */
export const GITHUB_SELF_REVIEW_RELEASE_USAGE =
  "usage: slopweaver github self-review release --repo <owner/name> --pr <n> [--head <sha>] [--home <dir>]\n" +
  "  release            release a stranded self-review reservation — the manual recovery path for the\n" +
  "                     ambiguous hold a failed submit-and-resolve mutation leaves behind. Read the pull\n" +
  "                     request back through `github read` first and confirm what actually landed; this\n" +
  "                     command trusts the caller's judgement rather than re-deriving it\n" +
  "  --repo <owner/name>  the repository the reservation belongs to\n" +
  "  --pr <n>           the pull-request number\n" +
  "  --head <sha>       only release a reservation held for exactly this head SHA; refuse a mismatch\n" +
  "                     instead of releasing a different, still-live reservation\n" +
  "  --home <dir>       the state home whose ledger holds the reservation";

/** `slopweaver github thread`'s usage line. */
export const GITHUB_THREAD_USAGE =
  "usage: slopweaver github thread <list|reply|resolve|reopen> --repo <owner/name> --number <n> [--thread <id>] " +
  "[--body <text|->] [--resolve] [--open] [--full] [--dry-run] [--json] [--home <dir>]\n" +
  "  list               every review thread on the pull request, with the id each other sub-verb addresses\n" +
  "                     — the start of what the opening comment says. The full text of a CodeRabbit\n" +
  "                     finding is what a judgement is made from, so read it with --open --full\n" +
  "  reply              post a reply INTO one reviewer's thread — the answer to a review you disagree with,\n" +
  "                     rather than a dismissal. With --resolve, the reply and the resolution are one\n" +
  "                     operation, reply first: a partial failure leaves the thread open WITH the answer\n" +
  "  resolve            mark one thread resolved and say nothing. Prefer `reply --resolve` when the thread\n" +
  "                     asked a question\n" +
  "  reopen             undo a resolve: put one resolved thread back where a reader sees it\n" +
  "  --repo <owner/name>  the repository\n" +
  "  --number <n>       the pull-request number\n" +
  "  --thread <id>      the thread's GraphQL node id, as `list` prints it. Required by reply, resolve, reopen\n" +
  "  --body <text|->    reply only: the reply text, or `-` to read it from stdin\n" +
  "  --resolve          reply only: resolve the thread in the same operation as the reply\n" +
  "  --open             list only: unresolved threads only\n" +
  "  --full             list only: print each thread's whole opening comment beneath its line\n" +
  "  --dry-run          print the exact plan and send nothing; no door record\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose door records the write";

/** `slopweaver github vuln`'s usage line. */
export const GITHUB_VULN_USAGE =
  "usage: slopweaver github vuln <list|get|body|surfaces> [--repo <owner/name>] [...] [--json] [--home <dir>]\n" +
  "  list               every Dependabot alert on the repository, open by default, worst CVSS first\n" +
  "  list --repo <owner/name> [--severity critical|high|medium|low] [--state open|dismissed|fixed|auto_dismissed]\n" +
  "  --severity <s>     list only: one of critical, high, medium, low — exactly GitHub's own enum\n" +
  "  --state <s>        list only: open (default), dismissed, fixed or auto_dismissed — GitHub's own enum\n" +
  "  get                one alert in full — everything the alert's own page shows\n" +
  "  get --repo <owner/name> --number <n>\n" +
  "  --number <n>       get only: the alert's own number, as `list` prints it — NOT a pull-request number\n" +
  "  body               compile a vulnerability-fix form into the pull-request form `stack push` takes;\n" +
  "                     every Dependabot citation is built from the alert numbers, never authored\n" +
  "  body [--form <json|->] [--file <path|->] [--out <path>]\n" +
  "  --form <json|->    the vulnerability-fix form as inline JSON, or `-` to read it from stdin\n" +
  "  --file <path|->    the same form from a file path, or `-` for stdin\n" +
  "  --out <path>       where the compiled pull-request form is written; default stdout\n" +
  "  surfaces           where ON THE APP a package is reached: walks a checkout's import graph up to the\n" +
  "                     routes and entry points, groups them by the component that pulls the package in,\n" +
  "                     and drafts the form's blastRadius — `everywhere` past the fan-in threshold\n" +
  "  surfaces --package <name> --checkout <dir> [--everywhere-at <n>]\n" +
  "  --package <name>   surfaces only: the package as a manifest names it, e.g. dompurify or @pdfme/ui\n" +
  "  --checkout <dir>   surfaces only: the local checkout to walk; only its git-tracked files are read\n" +
  "  --everywhere-at <n>  surfaces only: direct importers or features at which the answer is `everywhere`;\n" +
  "                     default 12\n" +
  "  --repo <owner/name>  the repository — required by list and get, taken from the form by body, refused by\n" +
  "                     surfaces\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose credential is resolved";

/** `slopweaver github pr release-reservation`'s usage line. */
export const GITHUB_PR_RELEASE_RESERVATION_USAGE =
  "usage: slopweaver github pr release-reservation --repo <owner/name> --base <ref> --head <ref> " +
  "[--home <dir>]\n" +
  "  release-reservation  settle a create reservation this machine is holding, by asking GitHub what is\n" +
  "                     actually on the branch pair. The operator's door for the case the create path\n" +
  "                     cannot settle itself — the verifying read failed there, or the pair is ambiguous —\n" +
  "                     so the recovery is never `rm` on a trust ledger\n" +
  "  It never opens, closes or edits a pull request: one GET, then at most one local record written.\n" +
  "  Zero pull requests on the pair RELEASES the reservation. Exactly one RECOVERS its number onto the\n" +
  "  record instead of releasing, so an open one keeps its guard and a closed one is released on the next\n" +
  "  attempt. Two or more is refused: which one the reservation meant cannot be decided.\n" +
  "  --repo <owner/name>  the repository the reservation belongs to\n" +
  "  --base <ref>       the branch being merged into — half of the reservation's key\n" +
  "  --head <ref>       the branch being merged from — the other half\n" +
  "  --home <dir>       the state home whose ledger holds the reservation";

/** `slopweaver github pr request-review`'s usage line. */
export const GITHUB_PR_REQUEST_REVIEW_USAGE =
  "usage: slopweaver github pr request-review --repo <owner/name> --number <n> " +
  "[--reviewer <login,...>] [--team <slug,...>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Request review from one or more colleagues (and/or teams) on a pull request through the door, then\n" +
  "  read the requested reviewers back to confirm. Give at least one of --reviewer or --team\n" +
  "  --reviewer <login,...>  comma-separated GitHub logins. Each is resolved against the derived identity\n" +
  "                     directory first — a login the roster does not confirm is refused BY NAME rather\n" +
  "                     than guessed, even when it looks like an obvious org-suffix pattern\n" +
  "  --team <slug,...>  comma-separated team slugs. Not roster-checked — GitHub itself refuses one that\n" +
  "                     is not a real team on the repository's organisation\n" +
  "  --dry-run          resolve every login and read the current reviewers, but perform no write or door\n" +
  "                     record. Resolves a token and performs GETs — never fully offline";

/** `slopweaver github pr retarget`'s usage line. */
export const GITHUB_PR_RETARGET_USAGE =
  "usage: slopweaver github pr retarget --repo <owner/name> --number <n> --base <ref> [--adopt] [--dry-run] " +
  "[--json] [--home <dir>]\n" +
  "  Change a pull request's base branch through the door, then read it back to confirm the new base stuck.\n" +
  "  --base <ref>       the new base branch to retarget onto — refused when it equals the pull request's own\n" +
  "                     head branch, reported as a no-op when it already matches the live base, and refused\n" +
  "                     when the pull request is a member of a native GitHub stack (retargeting it directly\n" +
  "                     would orphan that stack membership), and refused when it is another OPEN pull\n" +
  "                     request's head branch unless --adopt is passed\n" +
  "  --adopt            the base names another open pull request's head branch on purpose: retarget, then\n" +
  "                     register the native GitHub stack membership in the same invocation. Without it that\n" +
  "                     retarget is refused, since it would leave a chain GitHub does not know is a stack\n" +
  "  --dry-run          read the current state and print the transition, but perform no write or door record.\n" +
  "                     Resolves a token and performs GETs — never fully offline";

/** `slopweaver github pr summary`'s usage line. */
export const GITHUB_PR_SUMMARY_USAGE =
  "usage: slopweaver github pr summary <pull-request-url> [--json] [--home <dir>]\n" +
  "  summary            read one pull request down to what a queue card says about it: number, title, head\n" +
  "                     branch, state (open, draft, merged, closed) and its OWN Problem, Risk and Blast\n" +
  "                     radius cells, parsed back out of the description the renderer wrote. A description\n" +
  "                     the parser declines, or one missing a cell, prints as `declined` with the reason and\n" +
  "                     still exits 0 — the read answered. Read-only: one GraphQL read, nothing written\n" +
  "  --json             one JSON object: number, url, title, headRefName, crossRepository (the head is a\n" +
  "                     fork's), state, mergedAt, readAtIso and a form of kind `parsed` (problem, risk,\n" +
  "                     blastRadius) or `declined` (reason)\n" +
  "  --home <dir>       the state home whose credential is resolved";

/** `slopweaver github pr standing`'s usage line. */
export const GITHUB_PR_STANDING_USAGE =
  "usage: slopweaver github pr standing <pull-request-url> [--json] [--home <dir>]\n" +
  "  standing           what a person opens GitHub to see about one pull request: who approved it (people\n" +
  "                     apart from bots, so a CodeRabbit-only APPROVED never reads as a person's), who is\n" +
  "                     still asked (code owners flagged), what its base branch requires (classic protection\n" +
  "                     and rulesets, or that the rules could not be read) and whether GitHub calls it\n" +
  "                     protected, CI, CodeRabbit and GitHub's merge status, plus one sentence saying it\n" +
  "                     aloud. Read-only: one GraphQL read and three REST reads, nothing written, nothing\n" +
  "                     fetched into a checkout\n" +
  "  --json             one JSON object: number, url, title, author, draft, base {name, defaultBranch,\n" +
  "                     protected, review}, reviews {approvedBy, changesRequestedBy, botApprovedBy, requested,\n" +
  "                     reviewDecision, truncated}, ci, codeRabbit, merge, sentence and readAtIso\n" +
  "  --home <dir>       the state home whose credential is resolved";

/** `slopweaver github pr reviewers`'s usage line. */
export const GITHUB_PR_REVIEWERS_USAGE =
  "usage: slopweaver github pr reviewers <pull-request-url> [--pick @owner=@person]... [--apply] [--json]\n" +
  "                     [--home <dir>]\n" +
  "  reviewers          derive who reviews what: every changed file against the CODEOWNERS on the base\n" +
  "                     branch, the author taken off every rule, one row per set of reviewers listing their\n" +
  "                     files, and the catch-all named once as Everything else. Prints the rows for a review\n" +
  "                     ask. No table when one reviewer covers every file. REST reads only, nothing written\n" +
  "  --pick @owner=@person  the person the thread names for a team, standing in for that CODEOWNERS token on\n" +
  "                     its row; repeatable, roster-confirmed, refused when the token owns no changed file\n" +
  "  --apply            refused: a C3 description publishes no reviewer table, so there is nothing to write\n" +
  "  --json             one JSON object: url, codeownersPath, changedFiles, derived {kind, rows | who, unowned,\n" +
  "                     unusedPicks} and refusal\n" +
  "  --home <dir>       the state home whose credential and roster are read";
