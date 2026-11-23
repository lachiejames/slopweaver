/**
 * Lazy manifest for the `github` noun — slopweaver's third outbound surface, after Slack and Linear.
 *
 * `pr`, with `create` and `update` as sub-commands rather than as separate verbs, mirroring `linear issue`
 * and `slack poll`. Its meta declares `effect: "external-write"` + `doorRouted: true`, which the
 * door-coverage ratchet verifies, and `createsWorkItem: true` — opening a pull request puts something on a
 * human's queue. The command module (and with it the Octokit write client) loads only when the verb
 * dispatches.
 *
 * `push` is the missing governed Git transport edge. It can express only the checked-out branch to the
 * same-named remote branch, refuses the remote default branch, uses an exact force-with-lease when asked,
 * routes the write through the door and reads the remote ref back before reporting success.
 *
 * `merge` is the pre-merge guard from `AGENTS.md`'s doctrine-coherence work: it REPORTS findings (a probe
 * regression, a `git reset --soft` signature, an unmentioned deletion) and refuses while any stand
 * unacknowledged. `--admin` — an explicit option, never a default — follows a CLEAN report with a real
 * squash merge through the repository administrator's branch-protection bypass, which is why its meta is
 * `effect: "external-write"` + `doorRouted: true` + `requiresApproval: true` rather than the `local-state`
 * pair it carried while it could only report. `diagnostic` stays true: the overwhelming majority of its
 * non-zero exits are still findings it went looking for, not a broken tool. See
 * `../commands/github/mergeAdminCore.js` for why the bypass is a first-class path on a repository whose
 * sole codeowner is also its sole author, and `../commands/github/mergeCore.js` for the stated limit that a
 * merge made any other way still bypasses this guard entirely.
 *
 * `stack` rides GitHub's native, already-live Stacked PRs feature rather than a Slopweaver-owned membership
 * ledger — GitHub's own computed stack is the membership/order authority. `push` (this phase) amends,
 * pushes and creates a stacked entry, reusing `pr`'s own create path verbatim rather than reimplementing
 * it; `sync` and `adopt` are later phases, added to `stackCore.ts`'s dispatch additively.
 *
 * `attach` is the one verb here that does NOT authenticate with a token. GitHub publishes no API for
 * attaching media to a comment, and on a private repository `raw.githubusercontent.com` does not render
 * inline for another viewer — so the only URL that works is `user-attachments`, minted by the web app's own
 * internal asset pipeline against a cookied browser session. Its meta is nonetheless ordinary
 * (`effect: "external-write"` + `doorRouted: true`): the door polices what an action does to the world, not
 * how the caller authenticated, and the credential kind is recorded in the door artifact instead. `upload` is
 * four plain HTTP calls on a live session, and opens `attach login`'s own visible browser ITSELF when that
 * session has lapsed — an expired login is never a reason to deliver less than was asked for. `--no-login`
 * turns that into a loud non-zero exit for a caller with nobody watching.
 *
 * `hold`/`release` are the merge QUEUE, not a merge: `hold` names one pull request that may land while the
 * hold stands, and `merge` — report path and `--admin` path alike — refuses every other one in that
 * repository until `release` (or `--admin`'s own landing of the held pull request) clears it. Both are
 * `local-state`, since a hold is a document under the home and touches nothing outside the machine. See
 * `../../outbound/github/mergeHold.ts` for why a refusal at the merge step replaces a fan-out of messages.
 *
 * `enqueue` presses GitHub's own "Merge when ready" — it puts one pull request into its base branch's
 * NATIVE merge queue through the `enqueuePullRequest` mutation and reads `mergeQueueEntry` back to confirm
 * the position it took. It is the third and last of this noun's landing verbs and overlaps neither of the
 * others: `merge --admin` squash-merges NOW through the administrator bypass, `hold`/`release` govern
 * slopweaver's own advisory serial lane and reach no repository at all, and this one hands the landing to
 * GitHub. Its guard carries `merge`'s exact acknowledgement shape — every reason not to queue is printed as
 * a finding, an unacknowledged finding refuses the write, `--acknowledge <subject,...>` and
 * `--acknowledge-all --reason "…"` are the escapes — because queueing while the required checks still run
 * is the ordinary case a merge queue exists for, and this verb runs no model that could judge it. Three
 * states are refused outright instead: a pull request that is not open, one still a draft, and a base
 * branch with no merge queue, since acknowledging any of those could not make the write possible.
 *
 * `label` adds labels to one issue or pull request, and can only ADD: GitHub's own endpoint cannot remove,
 * so removal is unrepresentable rather than quietly absent. It reads the repository's DEFINED labels first
 * and refuses a name that is not among them — GitHub creates an unknown label instead of refusing it, which
 * turns one typo into a permanent repository label — and confirms the write by reading the issue back.
 *
 * `pr request-review` requests review from one or more colleagues and/or teams — the missing door three
 * sessions independently hit: no governed verb could add a reviewer at all, so one gave up naming
 * none, one called the API raw, one fell back to a comment asking by name. Each `--reviewer` login is
 * resolved against the derived identity directory FIRST (`../../outbound/github/reviewerIndex.js`) — a login
 * the roster does not confirm is refused by name rather than guessed, never constructed from an org-suffix
 * pattern. `--team` slugs are not roster-checked (GitHub itself refuses an unknown team). Additive only, like
 * `label`: GitHub's endpoint cannot remove a request. Its own parser and door request live in
 * `requestReviewCore.ts`/`requestReviewRun.ts` rather than folded into `create`/`update`'s shared machinery,
 * dispatched from `run.ts` before `parseGithubPrArgs` ever sees the argv tail.
 *
 * `pr retarget` changes a pull request's base branch — the one step of building a native GitHub stack no
 * other verb covers, hit twice with the documented `SLOPWEAVER_ALLOW_RAW=1` break-glass before this verb
 * shipped. `stack adopt` deliberately never retargets a base (see its own module doc), and `pr update` has
 * no `base` field because changing a base or head is a different pull request, not a description edit. It
 * refuses a base equal to the pull request's own head, reports a base matching the live one as a no-op, and
 * refuses a pull request that is already a member of a native GitHub stack — retargeting one of those
 * directly, outside the stack tooling that keeps GitHub's own base-must-match-the-entry-below invariant,
 * would orphan its membership. Its own parser and door request live in `retargetCore.ts`/`retargetRun.ts`,
 * dispatched the same way `request-review` is.
 *
 * `comment` is the plain top-level PR/issue comment — one endpoint for both, since GitHub treats a pull
 * request as an issue for this purpose. Distinct from `thread`, which answers a review THREAD pinned to a
 * diff line: `comment` is the activity-feed message a caller reaches for to address the whole pull request,
 * requesting a bot re-review say, rather than one finding. `create` posts a fresh comment; `edit` replaces
 * one already posted, by the numeric id `create` reports. Both go through the same above-the-fold gate the
 * pull-request body uses. Posted under the operator's own login — attributable, never authenticated.
 *
 * `thread` is the answer to somebody else's review, and the reason it exists rather than a dismiss verb:
 * a reviewer asking for something the repository forbids is answered IN their thread, with the reasoning,
 * and the thread is then resolved. `list` is a pure read that prints the node id the other two address;
 * `reply --resolve` sends the reply and the resolution as one operation, reply first, so a partial failure
 * leaves the thread open WITH the answer rather than resolved in silence.
 *
 * `checks`, `ci-timing`, `ci-runs`, `run-log`, `rerun` and `cycle` are declared in `./githubCi.ts` and
 * spread in here — one seam, cut when this file passed its size ratchet. That module's
 * own header carries why those six belong together and what each does; this one no longer describes them.
 *
 * `review-state` is the fleet READ behind "which of my open pull requests still needs a reviewer asked".
 * It answers seven questions per pull request — CI, CodeRabbit, draft, the CODEOWNERS-required approver, and
 * the three Slack ones (mentioned, asked, stale) — and its distinguishing property is that questions it cannot
 * bound answer `unknown` rather than `no`. Reviewers here are asked in SLACK and never on GitHub, which is why
 * the Slack legs are the load-bearing half and why `reviewRequests` is reported as context rather than as the
 * answer. A pure read: `effect: "external-read"` + `doorRouted: false`, like `read`/`search`/`checks`.
 *
 * `watchers` is the fold behind the pull-request page's watched column (which pull requests are watched
 * is part of the trust class): who holds `github checks --wait` on each pull request, read from the
 * checks-read register's `watching`/`watch-done` rows and nothing else. `effect: "local-state"` because it
 * reads one JSONL file under the home and reaches nothing external.
 *
 * `turn-path` classifies one pull request's head as turn-path or clean against the bot's own loop chain's
 * path set (`skills/loop`, `src/live`, `src/outbound`, …) — the governed replacement for a hand-rolled
 * `refs/prclass/<n>` shell recipe that lived only in a chain of runtime handover docs, copied forward
 * uncorrected through eight cuts, with three separate fail-opens found the same way each time (see
 * `handovers/prclass-ref-namespace-fail-open.md`). It fetches into a fresh, per-invocation private ref
 * (`gitAncestry.ts`'s `newPrivateFetchRef`, never the shared mutable namespace every worktree on a machine
 * reads and writes), refuses an empty `--head` before it ever reaches a refspec, and refuses a head that
 * resolves equal to the base — the witness for `git fetch origin ":<ref>"` accepting an empty-source refspec,
 * exiting 0, and resolving to the remote's own HEAD. A pure read: `effect: "external-read"` +
 * `doorRouted: false`, like `checks`/`review-state`.
 *
 * `alert` and `code-scanning` live in `./githubCodeScanning.ts`; `bottleneck` and `coderabbit-yield` in
 * `./githubReports.ts`; `close`, `comment`, `enqueue`, `hold`, `label`, `merge` and `pr` in
 * `./githubPullRequestActions.ts`.
 *
 * `close` is the missing door rule 3 in `AGENTS.md` names directly: no governed verb could close a pull
 * request, so an owner-ruled close dead-ended into a raw `gh` mutation or the web UI. It refuses an already
 * merged or already closed pull request, naming the live state either way (`mergedAtIso` is what tells the
 * two apart, since both read back `state: "closed"`). Open, it still refuses to close SILENTLY: the pull
 * request must already carry a comment — any author, from within the last hour — or `--why` must supply one,
 * posted before the close, in the same door-recorded action confirmed by a fresh read.
 */
import { githubBumpDriveUsage } from "../commands/github/bumpDriveUsage.js";
import { GITHUB_RELEASE_USAGE } from "../commands/github/holdUsage.js";
import { githubLandingUsage } from "../commands/github/landingUsage.js";
import { GITHUB_PRESS_RESEAL_USAGE } from "../commands/github/pressResealUsage.js";
import * as prUsage from "../commands/github/prUsage.js";
import * as reportUsage from "../commands/github/reportUsage.js";
import { GITHUB_REPO_USAGE } from "../commands/github/repoUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { githubCiManifest } from "./githubCi.js";
import { githubCodeScanningManifest } from "./githubCodeScanning.js";
import { READ_USAGE } from "./githubNounUsage.js";
import { githubProtectionManifest } from "./githubProtection.js";
import { githubPullRequestActionsManifest } from "./githubPullRequestActions.js";
import { githubRecutManifest } from "./githubRecut.js";
import { githubRefsManifest } from "./githubRefs.js";
import { githubReportsManifest } from "./githubReports.js";
import { githubReviewersManifest } from "./githubReviewers.js";
import { STACK_USAGE } from "./githubStackUsage.js";

export const githubManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ...githubCodeScanningManifest,
  attach: lazy({
    load: () => import("../commands/github/attachRun.js").then((m) => m.githubAttachCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github attach upload --file shot.png --repo owner/name --number 123 --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Upload an image or video to GitHub's own user-attachments host through the door and print the " +
        "URL that renders inline even on a private repository",
      usage: prUsage.GITHUB_ATTACH_USAGE,
    },
  }),
  // `bottleneck` and `coderabbit-yield` are declared in `./githubReports.ts`, spread in where `bottleneck` sat.
  ...githubReportsManifest,
  "bump-drive": lazy({
    load: () => import("../commands/github/bumpDriveRun.js").then((m) => m.githubBumpDriveCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github bump-drive --repo owner/name --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Drive every open DEPENDENCY BUMP one step closer to landing — enqueue the ready ones, UNDRAFT and " +
        "enqueue the ones only a draft flag holds back (the act `landing` had no word for, and what every " +
        "renovate bump here needs), and put a board row on the rest rather than rebasing a bot's branch " +
        "unattended. Every enqueue is written to the autonomy ledger; capped per pass, so a scheduled row " +
        "cannot become a landing wave",
      usage: githubBumpDriveUsage(),
    },
  }),
  // `checks`, `ci-timing`, `ci-runs` and `run-log` are declared in `./githubCi.ts` and spread in at the
  // exact position they were typed at, so `--help` and `catalog` read in the same order they always did.
  // They are one story — state, measurement, evidence — and moving them is what kept this file under its
  // size ratchet, the same seam `./githubStackUsage.ts` was cut on.
  ...githubCiManifest,
  // `close` through `pr` are declared in `./githubPullRequestActions.ts`, spread in where `close` sat.
  ...githubPullRequestActionsManifest,
  ...githubRefsManifest,
  ...githubRecutManifest,
  read: lazy({
    load: () => import("../commands/providerRead/run.js").then((m) => m.githubReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github read https://github.com/owner/repo/pull/<number> --json",
      parseRejectIsIoFree: true,
      summary: "Read one current issue, pull request or discussion with explicit activity bounds",
      usage: READ_USAGE,
    },
  }),
  release: lazy({
    load: () => import("../commands/github/holdRun.js").then((m) => m.githubReleaseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github release --pr <number> --repo owner/name --sha <commit-sha>",
      parseRejectIsIoFree: true,
      summary:
        "Clear the merge hold, so every pull request in the repository may merge again — `github merge " +
        "--admin` does it itself the moment it lands the held one",
      usage: GITHUB_RELEASE_USAGE,
    },
  }),
  ...githubProtectionManifest,
  repo: lazy({
    load: () => import("../commands/github/repoRun.js").then((m) => m.githubRepoCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver github repo --repo owner/name --description "new text" --dry-run',
      parseRejectIsIoFree: true,
      summary:
        "Replace a repository's description, or create, rename, transfer, archive, publish it or turn Actions on " +
        "under a stated policy on the preview's digest, through the door and confirmed by read-back",
      usage: GITHUB_REPO_USAGE,
    },
  }),
  actions: lazy({
    load: () => import("../commands/github/actionsRun.js").then((m) => m.githubActionsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github actions --repo owner/name --disable",
      parseRejectIsIoFree: true,
      summary:
        "Read whether hosted GitHub Actions runs on a repository and switch it off through the door, confirmed " +
        "by read-back; there is no switch on",
      usage: prUsage.GITHUB_ACTIONS_USAGE,
    },
  }),
  ready: lazy({
    load: () => import("../commands/github/readyRun.js").then((m) => m.githubReadyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github ready --repo owner/name --number 123 --dry-run",
      parseRejectIsIoFree: true,
      summary: "Mark one draft pull request ready through the door and confirm it by read-back",
      usage: prUsage.GITHUB_READY_USAGE,
    },
  }),
  landing: lazy({
    load: () => import("../commands/github/landingRun.js").then((m) => m.githubLandingCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github landing --repo owner/name --author someone --json",
      parseRejectIsIoFree: true,
      summary:
        "Break every open pull request into ONE next act — press, spawn for CI, spawn for CodeRabbit, answer " +
        "a reviewer, or wait on a named person — from six tests GitHub already published, plus the DISPATCH " +
        "verdict the supervisor acts on, the conversation counted for CodeRabbit and humans apart, how far " +
        "the head is behind its base and whether a chase is due, with --press queueing the ready ones " +
        "through `github enqueue` and recording each press with its subject",
      usage: githubLandingUsage(),
    },
  }),
  "press-reseal": lazy({
    load: () => import("../commands/github/pressResealRun.js").then((m) => m.githubPressResealCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github press-reseal --repo owner/name --json",
      parseRejectIsIoFree: true,
      summary:
        "Re-key press-register rows stored under a key their own fields do not hash to (a carried home's " +
        "sanitised slugs): preview by default, --apply in one digest-checked, read-back-proven transaction, " +
        "journalled to the home's ledgers",
      usage: GITHUB_PRESS_RESEAL_USAGE,
    },
  }),
  // `reviewer` and `review-state` are declared in `./githubReviewers.ts`, spread in where `review-state` sat.
  ...githubReviewersManifest,
  search: lazy({
    load: () => import("../commands/github/searchRun.js").then((m) => m.githubSearchCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github search CVE-2026-1234 --json",
      parseRejectIsIoFree: true,
      summary: "Find a matching issue or pull request by term, through GitHub's own search — no full read",
      usage: reportUsage.githubSearchUsage(),
    },
  }),
  "self-review": lazy({
    load: () => import("../commands/github/selfReviewDispatchRun.js").then((m) => m.githubSelfReviewCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github self-review release --repo owner/name --pr <number> --head <sha>",
      parseRejectIsIoFree: true,
      summary: "Release a stranded self-review reservation — the manual recovery path after a failed submit",
      usage: prUsage.GITHUB_SELF_REVIEW_RELEASE_USAGE,
    },
  }),
  stack: lazy({
    load: () => import("../commands/github/stackRun.js").then((m) => m.githubStackCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github stack push --form - --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Manage a native GitHub Stacked-PR entry — push, sync, restack the whole forest locally, submit it " +
        "all or nothing, adopt, remove one, or dissolve the whole stack, riding GitHub's own computed stack",
      usage: STACK_USAGE,
    },
  }),
  watchers: lazy({
    load: () => import("../commands/github/watchersRun.js").then((m) => m.githubWatchersCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github watchers --json",
      parseRejectIsIoFree: true,
      summary:
        "Who is watching each pull request — the sessions holding `github checks --wait` on it, stale ones " +
        "named — folded from the checks-read register with no GitHub call",
      usage: reportUsage.githubWatchersUsage(),
    },
  }),
  "turn-path": lazy({
    load: () => import("../commands/github/turnPathRun.js").then((m) => m.githubTurnPathCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github turn-path --head a-branch --number 145",
      parseRejectIsIoFree: true,
      summary:
        "Fetch a pull request's head into a private, per-invocation ref and classify it turn-path or clean " +
        "against the bot's own loop chain's path set — the governed replacement for the loop chain's " +
        "hand-rolled refs/prclass shell recipe, which had no code surface and no guard against an empty " +
        "--head silently resolving to the base's own commit",
      usage: reportUsage.githubTurnPathUsage(),
    },
  }),
  thread: lazy({
    load: () => import("../commands/github/threadRun.js").then((m) => m.githubThreadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github thread list --repo owner/name --number 123",
      parseRejectIsIoFree: true,
      summary:
        "Read a pull request's review threads, and answer or resolve one — the way to disagree with a " +
        "reviewer without dismissing them",
      usage: prUsage.GITHUB_THREAD_USAGE,
    },
  }),
  vuln: lazy({
    load: () => import("../commands/github/vulnRun.js").then((m) => m.githubVulnCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github vuln list --repo owner/name --severity critical",
      parseRejectIsIoFree: true,
      summary:
        "Read Dependabot alerts, derive where on the app a package is reached from a checkout's imports, and " +
        "compile a vulnerability-fix pull-request form whose alert citations are built rather than typed",
      usage: prUsage.GITHUB_VULN_USAGE,
    },
  }),
};
