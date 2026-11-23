/**
 * The stale-card gate, at the two briefing doors that publish a page.
 *
 * `../briefing/prPremise.ts` decides whether a card's premise still holds; this is the seam that goes and
 * asks GitHub, so both `briefing check` and `briefing render` ask the same way, resolve the credential from
 * the same state home they read everything else from, and honour the same break-glass.
 *
 * Same shape as `./bareRefDoor.ts`, and for the same reason its own header gives: the override is a decision
 * ONE session makes for one page, journalled as the `stale-cards` grant — a render on a plane, a fixture check
 * in a suite that must not touch the network — which an always-on schema could not honour and a config file
 * would apply too broadly.
 *
 * **No credential is a refusal, not a pass.** A run that cannot reach GitHub cannot tell a merged pull
 * request from an open one, and the failure this gate exists to stop is exactly a card published on a
 * premise nobody checked. So the door says so and exits non-zero; the composer either configures a token or
 * says, per invocation, that this page is going out unverified.
 */

import { githubToken } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";
import type { GithubLiveError } from "../live/github/errors.js";
import { makeReadPrPremises, noGithubCredential, type PrAddress, type PrPremise } from "../live/github/prPremise.js";
import { githubReadGraphql } from "../live/github/read.js";

/**
 * The journalled hatch that skips the live read and publishes the page on unverified premises — a grant one
 * session takes with `slopweaver hatch open`, never an ambient variable.
 */
export const STALE_CARDS_HATCH = "stale-cards";

/** The seam both briefing doors read live pull-request state through. */
export type ReadCardPremises = (args: {
  addresses: readonly PrAddress[];
  home: string;
}) => Promise<Result<ReadonlyMap<string, PrPremise>, GithubLiveError>>;

/**
 * The production read: resolve the credential from the run's own state home, then ask GitHub about every
 * pull request the page's cards name.
 *
 * A page whose cards name no pull request asks nothing at all — and, deliberately, needs no credential
 * either, so a briefing carrying only composed cards still checks on a machine with no token.
 *
 * @param addresses every pull request the page's react-now cards rest on
 * @param home the state home whose credential to read with, so `--home` resolves the token it also reads
 * @returns what GitHub said about each, or the read failure that stopped the gate from knowing
 */
export const productionReadCardPremises: ReadCardPremises = async ({ addresses, home }) => {
  if (addresses.length === 0) {
    return ok(new Map<string, PrPremise>());
  }
  const token = githubToken({ home });
  if (token === undefined) {
    return err(noGithubCredential());
  }
  return makeReadPrPremises({ graphql: githubReadGraphql({ token }) })({ addresses });
};
