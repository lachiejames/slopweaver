/**
 * `github pr`'s injectable edges, and the real filesystem/clock/client implementation of them.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling — every sibling module in this
 * directory imports `GithubPrDeps` as a type, so it lives on its own rather than inside whichever verb file
 * happened to declare it first.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  type InstallationIdentifiersReader,
  readInstallationIdentifiers,
} from "../../../outbound/github/installationIdentifiersRead.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { type IdentityRosterPort, identityRosterPort } from "../../../silver/identityRoster.js";
import { measureAvailableAlreadyLanded, productionAlreadyLandedRunDeps } from "./alreadyLandedRun.js";
import type { AlreadyLanded, BaseFreshness } from "./baseFreshnessCore.js";
import { measureAvailableBaseFreshness, productionBaseFreshnessRunDeps } from "./baseFreshnessRun.js";
import { type DescriptionReviewCheck, productionDescriptionReviewCheck } from "./descriptionReviewCheck.js";
import type { GithubVerbResult } from "./errors.js";
import { productionGithubPushDeps } from "./pushRun.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface GithubPrDeps {
  readonly readForm: (args: { source: string }) => string;
  /**
   * `--file`'s reader: `source` is a real file PATH (or `-` for stdin), never inline text.
   *
   * Deliberately a SEPARATE dep from `readForm` rather than a shared one. `readForm`'s own contract is "the
   * source IS the text", and conflating the two meanings is exactly the bug its own comment describes — this
   * dep exists so `--file`'s "the source is a path" contract can never quietly merge back into that one.
   */
  readonly readFileSource: (args: { source: string }) => string;
  /** `--pull`'s writer: save the rendered authoring file to a real path. */
  readonly writeFileOut: (args: { path: string; content: string }) => void;
  readonly makeApi: (args: { home: string; token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly sleep: (args: { ms: number }) => Promise<void>;
  readonly out: (args: { line: string }) => void;
  /**
   * One environment variable.
   *
   * Injected rather than read from `process.env` at the point of use, because an override is a DECISION and a
   * decision reached through ambient state cannot be tested. Three ordering defects in this repository were
   * unreachable while their code read `process` directly.
   */
  readonly env: (args: { name: string }) => string | undefined;
  /**
   * The diagnostic channel.
   *
   * Separate from `out` so the replacement patch — which is a warning, not a result — cannot land in a caller's
   * piped stdout. `out` stays the one channel that writes raw data.
   */
  readonly err: (args: { line: string }) => void;
  /** `create` only — the working directory base freshness is opportunistically measured from. */
  readonly cwd: () => string;
  /** `create` only — the base-freshness measurement itself, injectable so a test never shells real git. */
  readonly measureBaseFreshness: (args: {
    cwd: string;
    remote: string;
    target: PrTarget;
  }) => GithubVerbResult<BaseFreshness>;
  /**
   * `create` only — whether the head's own commits are already patch-identical to the target's base.
   *
   * A separate edge from `measureBaseFreshness` rather than a second field on its result, because the two
   * measure different refs with different tools: freshness compares the remote's DEFAULT branch by ancestry,
   * this compares the pull request's OWN base by patch id. Injectable so a test never shells real git.
   */
  readonly measureAlreadyLanded: (args: { cwd: string; remote: string; target: PrTarget }) => Result<AlreadyLanded>;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (args: { home: string }) => string | undefined;
  /** The autonomy ledger the internal finding door records its act in (`./findingRulingGate.ts`). */
  readonly autonomy: AutonomyLedgerPort;
  /** The door ledger every door-routed write records its decision through before performing. */
  readonly doorLedger: DoorLedgerPort;
  /** The door the store's identity roster is read through — `request-review` resolves each reviewer off it. */
  readonly identityRoster: IdentityRosterPort;
  /** `update` only — the installation's own identifiers the PR gate forgives on the target (`../../../outbound/github/installationIdentifiersRead.ts`). */
  readonly installationIdentifiers: InstallationIdentifiersReader;
  /** The last check before a description is sent: a CLEAN review covers these exact bytes (`./descriptionReviewCheck.ts`). */
  readonly descriptionReview: DescriptionReviewCheck;
}

/**
 * The production edges.
 *
 * A named exported factory rather than a module-private constant, mirroring `productionLinearWriteDeps()`.
 * The reason is not symmetry: `readForm` shipped a real bug that no unit test could reach, because every
 * test injects its own. Exporting it makes the default itself testable.
 *
 * @returns the real filesystem, clock, client factory and output sink
 */
export function productionGithubPrDeps(): GithubPrDeps {
  return DEFAULT_DEPS;
}

/** The real filesystem, clock, client factory and output sink — also `run.ts`'s own default `deps`. */
export const DEFAULT_DEPS: GithubPrDeps = {
  autonomy: autonomyLedgerPort(),
  cwd: () => process.cwd(),
  descriptionReview: productionDescriptionReviewCheck,
  doorLedger: doorLedgerPort(),
  env: ({ name }) => process.env[name],
  err: ({ line }) => process.stderr.write(`${line}\n`),
  identityRoster: identityRosterPort(),
  installationIdentifiers: readInstallationIdentifiers,
  makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
  measureAlreadyLanded: ({ cwd, remote, target }) =>
    measureAvailableAlreadyLanded({
      cwd,
      deps: productionAlreadyLandedRunDeps({ git: productionGithubPushDeps() }),
      remote,
      target,
    }),
  measureBaseFreshness: ({ cwd, remote, target }) =>
    measureAvailableBaseFreshness({
      cwd,
      deps: productionBaseFreshnessRunDeps({ git: productionGithubPushDeps() }),
      remote,
      target,
    }),
  now: () => new Date(),
  out: logger.out,
  // `--file`'s reader: `source` is a real path (or `-`), so the non-dash branch opens a file rather than
  // returning the string as-is. See the dep's own doc comment for why this stays separate from `readForm`.
  readFileSource: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8")),
  // The source IS the JSON, or `-` for stdin — matching `commands/linear/run.ts` exactly. An earlier cut
  // read `source` as a FILE PATH, which the gold-proof run caught the moment a form was passed inline:
  // the argument went to `open()` and failed with ENAMETOOLONG. No unit test saw it, because every test
  // injects `readForm`. The two write verbs must agree, because one caller fills forms for both.
  readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
  sleep: ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms)),
  token: ({ home }) => githubToken({ home }),
  writeFileOut: ({ path, content }) => {
    writeFileSync(path, content, "utf8");
  },
};
