/**
 * The `slopweaver github attach status` sub-verb — the offline read of the browser's session, plus one
 * online SAML-grant probe when an organisation is named. Split from `./attachRun.ts`, which owns the upload
 * and the verb's dispatch; this half sends nothing but the one read-only probe.
 */

import { readOrgGrant } from "../../../outbound/github/attachClient.js";
import type { GithubSessionStatus } from "../../../outbound/github/chromeSession.js";
import { loginCapturedEvent } from "../../../outbound/github/sessionRecovery.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { offlineStatusLines, orgGrantRefusal, statusOnlyLines } from "./attachCore.js";
import type { GithubAttachDeps } from "./attachDeps.js";

/** Render the offline half; returns false when the session is not even usable, so the probe is pointless. */
function reportOfflineStatus({ deps, status }: { deps: GithubAttachDeps; status: GithubSessionStatus }): boolean {
  for (const line of offlineStatusLines({ status })) {
    deps.out(line);
  }
  return status.present && status.usable;
}

/**
 * The online half: ask GitHub whether the browser's session is authorised for one organisation.
 *
 * Exits non-zero on a wall, and that exit code is the point of the whole flag. A precheck that cannot fail
 * is not a precheck, and this verb's green was exactly that until now — a session whose every upload to a
 * SAML organisation was refused still reported success, which is the false green this repository's gates
 * exist against.
 */
async function probeOrgGrant({
  deps,
  org,
  home,
  json,
}: {
  deps: GithubAttachDeps;
  org: string;
  home: string;
  json: boolean;
}): Promise<number> {
  const cookies = await deps.loadCookies({ home });
  if (cookies.isErr()) {
    deps.writeDiagnostic(cookies.error.message);
    return EXIT_ERROR;
  }
  const verdict = await readOrgGrant({ cookieHeader: cookies.value, fetchImpl: deps.fetchImpl, org });
  if (verdict.isErr()) {
    deps.writeDiagnostic(verdict.error.message);
    return EXIT_ERROR;
  }
  if (json) {
    deps.out(JSON.stringify({ org, verdict: verdict.value }, undefined, 2));
    return verdict.value === "granted" ? EXIT_OK : EXIT_ERROR;
  }
  if (verdict.value === "granted") {
    deps.out(`GitHub confirms this session is SAML-authorised for ${org} — an upload there will not hit the wall`);
    return EXIT_OK;
  }
  deps.writeDiagnostic(orgGrantRefusal({ org, verdict: verdict.value }));
  return EXIT_ERROR;
}

/**
 * Publish the clearing event when the browser holds a live session again.
 *
 * `status` is the only verb that can do this now that no verb captures a login, and it is on no hot path —
 * so the clear costs nothing and can never be forgotten the way the retired login verb's own publish could.
 *
 * @param status what the browser currently holds
 * @returns nothing; a stream failure must not sink the status read
 */
function clearOutstandingBlock({
  deps,
  home,
  status,
}: {
  deps: GithubAttachDeps;
  home: string;
  status: GithubSessionStatus;
}): void {
  if (!status.usable || status.login === undefined) {
    return;
  }
  deps.publishEvent({
    event: loginCapturedEvent({ atIso: deps.nowIso(), login: status.login, sessionPath: status.source }),
    home,
  });
}

/**
 * Report the offline read in the selected mode, with no organisation to probe.
 *
 * @param status what the browser currently holds
 * @returns the process exit code
 */
function reportStatusOnly({
  deps,
  json,
  status,
}: {
  deps: GithubAttachDeps;
  json: boolean;
  status: GithubSessionStatus;
}): number {
  if (json) {
    deps.out(JSON.stringify(status, undefined, 2));
    return status.usable ? EXIT_OK : EXIT_ERROR;
  }
  for (const line of statusOnlyLines({ status })) {
    deps.out(line);
  }
  return status.present && status.usable ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run `attach status`: the offline read always, plus one online grant probe when an org is named.
 *
 * @param deps session, transport, event and output seams shared with the upload half
 * @param home the state home the session and the supervisor stream resolve under
 * @param json emit one machine-readable document instead of lines
 * @param org the organisation whose SAML grant to probe, when one was named
 * @returns the process exit code
 */
export async function runGithubAttachStatus({
  deps,
  home,
  json,
  org,
}: {
  deps: GithubAttachDeps;
  home: string;
  json: boolean;
  org: string | undefined;
}): Promise<number> {
  const status = await deps.status({ home });
  clearOutstandingBlock({ deps, home, status });
  if (org === undefined) {
    return reportStatusOnly({ deps, json, status });
  }
  // A session that cannot even be read cannot be probed, so the offline read is reported as the answer and
  // nothing is sent — the probe would only turn a precise local failure into a vaguer remote one.
  if (!status.usable) {
    return reportStatusOnly({ deps, json, status: { ...status, usable: false } });
  }
  if (!json) {
    reportOfflineStatus({ deps, status });
  }
  return probeOrgGrant({ deps, home, json, org });
}
