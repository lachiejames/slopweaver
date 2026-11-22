/**
 * `slopweaver github stack push`'s injectable edges, and the one adapter that widens them.
 *
 * Split out of {@link ./stackPushRun.js} (the file-size ratchet, step 3), which now states the ORDER the
 * verb runs its steps in and nothing about what an edge is. `StackPushGateDeps` is EXTENDED rather than
 * restated so the gates and this verb can never drift into two different ideas of what a measurement edge
 * is, and {@link toGithubPrDeps} is here for the same reason: it exists only to satisfy a shape a reused
 * step declares.
 */

import { readFileSync } from "node:fs";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { captureStagedContentTree } from "../../../codex/snapshot.js";
import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { withholdingCredentialWriter } from "../../../outbound/github/descriptionWords.js";
import {
  type InstallationIdentifiersReader,
  readInstallationIdentifiers,
} from "../../../outbound/github/installationIdentifiersRead.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import type { DescriptionReviewCheck } from "./descriptionReviewCheck.js";
import { DEFAULT_DEPS as DEFAULT_PR_DEPS, type GithubPrDeps, withholdingGitWriter } from "./prDeps.js";
import { type GithubPushDeps, productionGithubPushDeps } from "./pushRun.js";
import { readQueueGate } from "./queueGateRun.js";
import type { StackPushGateDeps } from "./stackPushGates.js";

/**
 * The injectable edges — Git through `pushRun.ts`'s deps, plus the write API, the creation-gate measurements
 * and the output sink. `StackPushGateDeps` is EXTENDED rather than restated so the gates and this verb can
 * never drift into two different ideas of what a measurement edge is.
 */
export interface GithubStackPushDeps extends StackPushGateDeps {
  readonly git: GithubPushDeps;
  /** The door ledger the stack write's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /**
   * Pin the tree `git add --all` would stage right now, without staging it — the one thing the amend may
   * commit (`./stackPushTree.ts`). Its own edge rather than a `GithubPushDeps` read because it needs a
   * scratch index, which `readGit`'s `{ cwd, args }` cannot select.
   */
  readonly captureAmendTree: (input: { readonly repoRoot: string }) => Result<string, string>;
  /**
   * One environment variable, injected for the same reason `GithubPrDeps` injects it: the above-the-fold
   * override is a DECISION, and a decision reached through ambient state is one no test can make.
   */
  readonly env: (input: { readonly name: string }) => string | undefined;
  readonly readForm: (input: { readonly source: string }) => string;
  /**
   * `--file`'s reader: `source` is a real file PATH (or `-` for stdin), never inline text. A separate dep
   * from `readForm` for the reason `prDeps.ts` states — the two contracts must never quietly merge.
   */
  readonly readFileSource: (input: { readonly source: string }) => string;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly sleep: (input: { readonly ms: number }) => Promise<void>;
  readonly out: (input: { readonly line: string }) => void;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
  /** The installation's own identifiers the PR gate forgives on the target (`../../../outbound/github/installationIdentifiersRead.ts`). */
  readonly installationIdentifiers: InstallationIdentifiersReader;
  /** A CLEAN review must cover the exact description, checked before the push and again before the create. */
  readonly descriptionReview: DescriptionReviewCheck;
}

/**
 * The production edges.
 *
 * @returns the real Git primitives, form reader, API factory, clock, sleeper and output sink
 */
export function productionGithubStackPushDeps(): GithubStackPushDeps {
  return {
    autonomy: autonomyLedgerPort(),
    captureAmendTree: ({ repoRoot }) => captureStagedContentTree({ repoRoot }).mapErr((error) => error.message),
    cwd: DEFAULT_PR_DEPS.cwd,
    descriptionReview: DEFAULT_PR_DEPS.descriptionReview,
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    git: productionGithubPushDeps(),
    installationIdentifiers: readInstallationIdentifiers,
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    measureAlreadyLanded: DEFAULT_PR_DEPS.measureAlreadyLanded,
    measureBaseFreshness: DEFAULT_PR_DEPS.measureBaseFreshness,
    now: () => new Date(),
    readQueueGate,
    out: logger.out,
    readFileSource: DEFAULT_PR_DEPS.readFileSource,
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    sleep: ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms)),
    token: ({ home }) => githubToken({ home }),
  };
}

/**
 * The same edges with every writer withholding a credential-shaped line — the verb's own `out` and the Git edges'
 * `out`, which prints the amend and pre-push progress — so `runGithubStackPush` filters each line it prints here,
 * once, rather than at each exit an audit found. `toGithubPrDeps` carries the wrapped `out` into `performCreate`.
 *
 * Its limit, stated: a Git write (`commit --amend`, the push) runs with its stdio inherited
 * (`../../../admit/gitTransport.ts`), so Git's and a hook's own bytes reach the terminal without passing any writer.
 * This filters every line the verb itself prints, not every byte a child process does.
 *
 * @param deps the edges the push was given, every other one carried by identity
 * @returns the edges whose two writers the secret scan's credential classes never match a forwarded line on
 */
export function withholdingGithubStackPushDescriptionWriters({
  deps,
}: {
  deps: GithubStackPushDeps;
}): GithubStackPushDeps {
  return {
    ...deps,
    git: withholdingGitWriter({ git: deps.git }),
    out: withholdingCredentialWriter({ write: deps.out }),
  };
}

/** The identity roster `performCreate` never touches: it requests no reviewer, so it neither reads nor writes one. */
const UNREACHABLE_ROSTER: GithubPrDeps["identityRoster"] = {
  peek: () => {
    throw new Error("unreachable: performCreate requests no review, so it never reads the identity roster");
  },
  read: () => {
    throw new Error("unreachable: performCreate requests no review, so it never reads the identity roster");
  },
  replace: () => {
    throw new Error("unreachable: performCreate never writes the identity roster");
  },
};

/**
 * Adapt this verb's own deps to `performCreate`'s full `GithubPrDeps` shape.
 *
 * `performCreate` only ever calls `now`, `out`, `cwd` and `descriptionReview` internally (confirmed by reading
 * it: the clock stamps the description and times the reservation, and the review is checked against the
 * checkout) — the rest are inert stubs that satisfy the type without being reachable, because a stack push never
 * reads a second form, never resolves a second token, and has no separate diagnostic channel.
 *
 * @param deps this verb's own clock, which stamps the description, sleeper, autonomy ledger, checkout and review
 *   check, carried to fill the shape
 * @param out where `performCreate` prints its own progress
 * @returns a full `GithubPrDeps` whose unreachable edges throw rather than returning a plausible value
 */
export function toGithubPrDeps({
  deps,
  out,
}: {
  deps: {
    autonomy: AutonomyLedgerPort;
    cwd: () => string;
    descriptionReview: DescriptionReviewCheck;
    doorLedger: DoorLedgerPort;
    now: () => Date;
    sleep: (input: { ms: number }) => Promise<void>;
  };
  out: (input: { line: string }) => void;
}): GithubPrDeps {
  return {
    autonomy: deps.autonomy,
    cwd: deps.cwd,
    descriptionReview: deps.descriptionReview,
    doorLedger: deps.doorLedger,
    env: () => undefined,
    err: () => undefined,
    installationIdentifiers: () => {
      throw new Error("unreachable: stack push reads the installation's identifiers once and passes them in");
    },
    identityRoster: UNREACHABLE_ROSTER,
    makeApi: () => {
      throw new Error("unreachable: stack push resolves its own API client");
    },
    measureAlreadyLanded: () => {
      throw new Error("unreachable: the already-landed gate is not checked inside performCreate");
    },
    measureBaseFreshness: () => {
      throw new Error("unreachable: base freshness is not checked inside performCreate");
    },
    now: deps.now,
    out,
    readFileSource: () => {
      throw new Error("unreachable: stack push reads its own form");
    },
    readForm: () => {
      throw new Error("unreachable: stack push reads its own form");
    },
    sleep: deps.sleep,
    token: () => {
      throw new Error("unreachable: stack push resolves its own token");
    },
    writeFileOut: () => {
      throw new Error("unreachable: stack push never pulls a description to a file");
    },
  };
}
