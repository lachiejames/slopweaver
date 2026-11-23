/**
 * Effectful shell for `slopweaver github self-review release` — the manual stranded-reservation recovery
 * path. Dispatched by `selfReviewDispatchRun.ts`, which owns the `self-review` sub-verb's own offset.
 */
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import {
  readSelfReviewReservation,
  releaseSelfReviewReservation,
  selfReviewLocus,
} from "../../../outbound/github/selfReviewLedger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { GITHUB_SELF_REVIEW_RELEASE_USAGE } from "./prUsage.js";
import { type GithubSelfReviewReleaseArgs, parseGithubSelfReviewReleaseArgs } from "./selfReviewReleaseCore.js";

/** Injectable edges for a no-network unit test. */
export interface GithubSelfReviewReleaseDeps {
  readonly home: () => string;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubSelfReviewReleaseArgs; deps: GithubSelfReviewReleaseDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/**
 * Release the held reservation for one pull request, or refuse a `--head` mismatch instead of releasing a
 * different, still-live reservation. Never contacts GitHub: it decides purely from the local ledger, which
 * is why this command trusts the caller to have already read the pull request back and confirmed what
 * actually landed there — see `GITHUB_SELF_REVIEW_RELEASE_USAGE`.
 *
 * @param rest argv after `github self-review release`
 * @param deps the home resolver and output seams
 * @returns the process exit code
 */
export function runGithubSelfReviewRelease({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubSelfReviewReleaseDeps;
}): number {
  const parsed = parseGithubSelfReviewReleaseArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_SELF_REVIEW_RELEASE_USAGE);
    return EXIT_USAGE;
  }
  const args: GithubSelfReviewReleaseArgs = parsed.value;
  const home = stateHomeOf({ args, deps });
  const locus = selfReviewLocus({ number: args.number, owner: args.owner, repo: args.repo });
  const held = readSelfReviewReservation({ home, locus });
  if (held.isErr()) {
    for (const problem of held.error) {
      deps.writeDiagnostic(`self-review release: refused — ${problem}`);
    }
    return EXIT_ERROR;
  }
  const pending = held.value;
  if (pending === null) {
    deps.out(`self-review release: no held reservation for ${locus}`);
    return EXIT_OK;
  }
  if (args.head !== undefined && pending.headSha !== args.head) {
    deps.writeDiagnostic(
      `self-review release: refused — ${locus} is held for head ${pending.headSha}, not the requested ${args.head}`,
    );
    return EXIT_ERROR;
  }
  releaseSelfReviewReservation({ home, locus });
  deps.out(
    `self-review release: released ${locus} — held for head ${pending.headSha}, reserved at ${pending.reservedIso}`,
  );
  return EXIT_OK;
}

/**
 * Production home and output seams.
 *
 * @returns the real state-home resolver and output edges for the release command
 */
export function productionGithubSelfReviewReleaseDeps(): GithubSelfReviewReleaseDeps {
  return {
    home: slopweaverHome,
    out: (line) => {
      logger.out({ line });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}
