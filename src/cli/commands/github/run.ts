/**
 * `slopweaver github pr` — the effectful shell. Every decision lives in `./core.ts`; this file resolves the
 * home and routes to the `update`/`request-review`/`retarget` sub-command. The bulk of the code — the
 * injectable edges, the self-review glue, the door-side mutations, and each sub-command's own flow — lives
 * in this directory's sibling modules; this file stays the one entry point the rest of the repo imports.
 *
 * ## `pr create` is REFUSED here, and that is the whole point
 *
 * Owner ruling: Slopweaver tooling uses the native GitHub PR stack verbs for every pull request creation.
 * A pull request Slopweaver opens is a native GitHub stack entry,
 * always — a base of the repository default is simply the bottom of a stack of one — so the only verb that
 * opens one is `github stack push`, which rides GitHub's own computed stack rather than a local ledger.
 * `runCreate` and its `createFlow.ts` are gone; every gate they ran (base freshness, already-landed, the
 * fleet-finding ruling) and every input mode they took (`--file`, the two shape
 * printers, the acknowledgement flags) moved to `./stackPushRun.ts` and `./stackPushGates.ts` intact, so
 * this redirect loses nothing. `./core.ts` carries no create arm at all: a parser that still accepted the
 * shape would read to the next session as though the door were open.
 *
 * ## The order is the contract
 *
 *   parse → validate → render → [dry-run stops here] → token → write preflight → ownership → door →
 *   reserve → mutate → read back → confirm → report
 *
 * Two points are load-bearing rather than incidental:
 *
 *  - **The dry run stops before ANY effect.** No door record, no ledger directory, no mutation. A preview
 *    that leaves a trace is not a preview.
 *  - **`update` refuses on a changed description.** The digest comparison is the whole reason this verb can
 *    be trusted with a body that took work to write.
 *
 * ## One residual risk, stated rather than buried
 *
 * **The digest check is not an atomic compare-and-swap.** It reads the live body, compares, then PATCHes. A
 * human editing the description in that window has their edit overwritten, because GitHub's REST API offers
 * no conditional update for a pull-request body — no ETag precondition, no `if-match`. The window is small
 * (one round trip) and the check still catches every edit made before the read, which is the realistic case:
 * somebody edits the description and comes back later. Closing it entirely is not possible with this API,
 * so the honest description is "narrows a wide race to a small one", not "prevents it". The Linear write
 * lane carries the identical residual and documents it the same way.
 */
import { defineCommand } from "../../defineCommand.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { parseGithubPrArgs } from "./core.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  DEFAULT_DEPS,
  type GithubPrDeps,
  productionGithubPrDeps,
  withholdingGithubPrDescriptionWriters,
} from "./prDeps.js";
import { runGithubPrReviewPrepare } from "./prDescriptionReviewPrepareRun.js";
import { productionGithubPrDescriptionReviewDeps, runGithubPrReviewRecord } from "./prDescriptionReviewRun.js";
import { productionGithubPrReviewersDeps, runGithubPrReviewers } from "./prReviewersRun.js";
import { productionGithubPrStandingDeps, runGithubPrStanding } from "./prStandingRun.js";
import { productionGithubPrSummaryDeps, runGithubPrSummary } from "./prSummaryRun.js";
import { productionGithubPrReleaseReservationDeps, runGithubPrReleaseReservation } from "./releaseReservationRun.js";
import { runGithubPrRequestReview } from "./requestReviewRun.js";
import { runGithubPrRetarget } from "./retargetRun.js";
import { runUpdate } from "./updateFlow.js";

export type { GithubPrDeps } from "./prDeps.js";
export { productionGithubPrDeps } from "./prDeps.js";

/**
 * Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb.
 *
 * Four, not two. `run` receives the FULL argv, not a pre-sliced tail — a detail no fixture disagrees with,
 * because a test constructs the array it expects. An earlier PR in this series shipped an argv index error
 * that survived seventy passing tests and was caught only by invoking the real binary.
 */
const VERB_ARG_OFFSET = 4;

/**
 * What `github pr create` prints instead of opening a pull request.
 *
 * It names the replacement, the one behavioural difference a caller has to know about (`stack push` amends
 * and pushes the checked-out branch itself, so there is no separate `github push` step first), and the fact
 * that nothing was lost in the move — otherwise the reader's next move is to look for the missing gate.
 */
const CREATE_REDIRECT_LINES: readonly string[] = [
  "refused: `github pr create` no longer opens pull requests. Use `github stack push` instead.",
  "",
  "  Owner ruling: every pull request Slopweaver opens is a native GitHub stack entry, so it is",
  "  opened by the native stack verb. A base of the repository default is the bottom of a stack of one; a",
  "  base naming another open pull request's branch joins that pull request's stack on GitHub's own",
  "  computed topology.",
  "",
  "  slopweaver github stack push --form - --dry-run   # same form, same gate, same exact body bytes",
  "  slopweaver github stack push --form -",
  "",
  "  Every flag create took is accepted there — --form, --file, --form-example, --file-example,",
  "  --self-review, --cwd, --remote, --acknowledge, --acknowledge-all, --reason, --home —",
  "  and every gate it ran still runs: base freshness, already-landed and the fleet-finding",
  "  ruling. One difference: `stack push` amends the worktree into the current commit and",
  "  pushes it itself, so there is no separate `github push` beforehand.",
];

/** The sub-verb dispatched before `parseGithubPrArgs`, run, or undefined when `tail` names none of them. */
function runSubverb({ deps, tail }: { deps: GithubPrDeps; tail: readonly string[] }): Promise<number> | undefined {
  // `request-review` is dispatched here, BEFORE `parseGithubPrArgs`, rather than folded into the parsed verb:
  // every switch built over that verb (outcomes, self-review, the stamp) is description-write machinery
  // this write has no use for, and widening it would force every one of those exhaustiveness checks to grow a
  // branch for a write they do not touch. See `requestReviewCore.ts`/`requestReviewRun.ts` for its own parser
  // and door request.
  if (tail[0] === "request-review") {
    return runGithubPrRequestReview({ deps, rest: tail.slice(1) });
  }
  // `retarget` is dispatched here for the same reason `request-review` is: it needs its own parser and door
  // request, and folding it into the parsed verb would force every switch built over it (outcomes,
  // self-review, the stamp) to grow a branch for a write they never touch.
  if (tail[0] === "retarget") {
    return runGithubPrRetarget({ deps, rest: tail.slice(1) });
  }
  // `release-reservation` is dispatched here for the same reason the two above are: it addresses the create
  // LEDGER rather than a pull request's description, so it has its own parser and needs none of the
  // description-write machinery every switch over the parsed verb carries.
  // `summary` is dispatched here for the same reason: it READS a pull request for a queue card and needs none of
  // the description-write machinery.
  if (tail[0] === "summary") {
    return runGithubPrSummary({ deps: productionGithubPrSummaryDeps(), rest: tail.slice(1) });
  }
  // `standing` likewise READS — review, base-branch rules, CI, CodeRabbit and merge state — for the console voice.
  if (tail[0] === "standing") {
    return runGithubPrStanding({ deps: productionGithubPrStandingDeps(), rest: tail.slice(1) });
  }
  // `reviewers` READS the diff and CODEOWNERS to derive the Who reviews what table, and writes nothing.
  if (tail[0] === "reviewers") {
    return runGithubPrReviewers({ deps: productionGithubPrReviewersDeps(), rest: tail.slice(1) });
  }
  // `review-prepare` and `review-record` are the description review's two halves: they build a packet and record a
  // verdict in the home, and write nothing to GitHub, so none of the description-write machinery applies.
  if (tail[0] === "review-prepare") {
    return runGithubPrReviewPrepare({ deps: productionGithubPrDescriptionReviewDeps(), rest: tail.slice(1) });
  }
  if (tail[0] === "review-record") {
    return runGithubPrReviewRecord({ deps: productionGithubPrDescriptionReviewDeps(), rest: tail.slice(1) });
  }
  if (tail[0] === "release-reservation") {
    return runGithubPrReleaseReservation({
      deps: productionGithubPrReleaseReservationDeps(),
      rest: tail.slice(1),
    });
  }
  return undefined;
}

/**
 * The whole verb, with its edges injected.
 *
 * @param argv the FULL process argv; this verb's own arguments start at {@link VERB_ARG_OFFSET}
 * @param deps the injectable edges — form reader, API factory, clock, sleeper and output sink
 * @returns the process exit code
 */
export async function runGithubPr({
  argv,
  deps = DEFAULT_DEPS,
}: {
  argv: readonly string[];
  deps?: GithubPrDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest: argv.slice(VERB_ARG_OFFSET), verb: "pr" });
  if (gated !== undefined) {
    return gated;
  }
  const tail = argv.slice(VERB_ARG_OFFSET);
  const subverb = runSubverb({ deps, tail });
  if (subverb !== undefined) {
    return subverb;
  }
  // Past the read-and-report subverbs everything printed is the description door's, so both writers withhold a
  // credential-shaped line from here on — by construction, not at each exit (`withholdingGithubPrDescriptionWriters`).
  return runDescriptionOperation({ deps: withholdingGithubPrDescriptionWriters({ deps }), tail });
}

/**
 * `github pr`'s description operation — the create redirect, the parse and `update` — over writers already
 * withholding a credential-shaped line.
 *
 * @param deps the edges, their `out` and `err` already filtered
 * @param tail this verb's own arguments
 * @returns the process exit code
 */
async function runDescriptionOperation({
  deps,
  tail,
}: {
  deps: GithubPrDeps;
  tail: readonly string[];
}): Promise<number> {
  // The redirect, dispatched before the parser for the reason the header states: `./core.ts` no longer has a
  // create arm to parse, so this is the one place that still knows the word.
  if (tail[0] === "create") {
    for (const line of CREATE_REDIRECT_LINES) {
      deps.out({ line });
    }
    return EXIT_USAGE;
  }
  const parsed = parseGithubPrArgs({ argv: tail });
  if (!parsed.isOk()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) {
      deps.out({ line });
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  return runUpdate({ args, deps, home });
}

/**
 * The registered command.
 *
 * Only `run`. Every other field of the contract — effect, doorRouted, usage, the example — is declared ONCE
 * in `src/cli/manifests/githubPullRequestActions.ts`; a second copy here would be read by nothing and compared
 * with nothing, which is how twenty of forty-four verb entries had already drifted apart before
 * `command-meta-residue` started refusing it.
 */
export const githubPrCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubPr({ argv, deps: productionGithubPrDeps() }),
});
