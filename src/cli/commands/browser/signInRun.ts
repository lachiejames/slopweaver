/**
 * `slopweaver browser sign-in --provider datadog|github` — LOOK at whether the owner's Chrome is signed in to a provider the
 * fleet signs in to itself, and when it is not, name the one button the fleet presses or the step that is the owner's.
 *
 * The fleet can always click the buttons and do the sign in, for Datadog and GitHub.
 * The incident that motivates the look
 * was a Queue card asking the owner to sign in to Datadog that no look stood behind; the console read signed in when one
 * was finally taken. So every look is recorded (`../../../browser/signInProbeStore.ts`), and the card gate
 * (`../../../handover/fleetSignInGate.ts`) passes a sign-in card only over a fresh look that reached the owner's hands.
 *
 * How each provider is judged signed in is the MEASURED detector already in the tree, never a new guess: Datadog by
 * where the console address settles (`isDatadogSignInWall`), GitHub by the organisation grant read off the owner's Chrome's
 * own cookies (`readOrgGrant`, the read `github attach status --org` makes) — or, when the repository owner is a
 * personal account, which has no organisation page and no grant, by that account's page reading signed in
 * (`readOwnerGrant`). A wall is opened in a session whose tab
 * is LEFT open, so the press is one `browser act` on the ref printed — refs, aim pictures and the read-only rail all
 * apply to it as to any other click — and the look after it is `--session <id>`, through that same tab, because a
 * fresh tab on the wall's address shows the button just pressed rather than where the press led.
 *
 * Exit codes: 0 signed in, 3 a wall (pressable or the owner's), 1 the look itself failed, 2 a usage mistake.
 */
import { readFileSync } from "node:fs";

import { listChromeProfiles } from "../../../browser/cookieJar.js";
import { destinationUrl } from "../../../browser/present.js";
import { resolveRecordedProfile } from "../../../browser/profileIndex.js";
import {
  type RecordedProfileHome,
  type RecordedProfilePort,
  readRecordedProfile,
} from "../../../browser/recordedProfile.js";
import { classifyWall, isSignInProvider, SIGN_IN_PROVIDERS, wallPressLines } from "../../../browser/signInPress.js";
import { appendSignInProbe, probePage, type SignInProbeRow } from "../../../browser/signInProbeStore.js";
import { resolveRepository } from "../../../config.js";
import { isDatadogSignInWall } from "../../../datadog/shot/proof.js";
import { datadogSite } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { type OwnerGrant, productionAttachFetch, readOwnerGrant } from "../../../outbound/github/attachClient.js";
import { githubCookieHeader } from "../../../outbound/github/chromeSession.js";
import { accountProbeUrl, orgProbeUrl, orgSsoInitiateUrl } from "../../../outbound/github/orgSso.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveSessionPin } from "./sessionShell.js";
import { closeNamedSession, closeSession, type LookRequest, takeLook, type WorkChrome } from "./signInLook.js";
import { BROWSER_USAGE } from "./usage.js";

/** Where GitHub sends a browser with no session at all. */
const GITHUB_LOGIN_URL = "https://github.com/login";

/**
 * The account the owner's recorded work Chrome profile is signed in as, when Chrome names one — the only chooser row the
 * fleet may press.
 *
 * @returns the email, or `undefined` when no profile is recorded or Chrome names no account for it
 */
async function recordedWorkEmail({ home, profiles }: RecordedProfileHome): Promise<string | undefined> {
  const directory = await readRecordedProfile({ home, profiles });
  if (directory.isErr()) {
    return undefined;
  }
  const known = listChromeProfiles({ platform: process.platform });
  if (known.isErr()) {
    return undefined;
  }
  const profile = resolveRecordedProfile({ directory: directory.value, profiles: known.value });
  return profile.isErr() ? undefined : profile.value.accountEmail;
}

/** Record one look, saying so when the ledger refused it — a look nothing recorded backs no card. */
function record({ home, row }: { home: string; row: SignInProbeRow }): void {
  const written = appendSignInProbe({ home, row });
  if (written.isErr()) {
    logger.error({ msg: `browser sign-in: ${written.error.message} — this look backs no card` });
  }
}

/**
 * Look at one wall page, judge it, record the look and print what to do — the shared tail of both providers.
 *
 * @returns the process exit code
 */
function judgeWallPage({
  chrome,
  provider,
  url,
  sessionId,
  signedInOn,
}: LookRequest & { signedInOn: ((landed: string) => boolean) | undefined }): number {
  const { home } = chrome;
  const look = takeLook({ chrome, nowIso: new Date().toISOString(), provider, sessionId, url });
  if (look.isErr()) {
    for (const problem of look.error) {
      logger.error({ msg: `browser sign-in: ${problem}` });
    }
    return EXIT_ERROR;
  }
  const { observation, session } = look.value;
  // Stamped once the look has come back, never at its start: the card gate's 30-minute freshness counts from the
  // moment the page was SEEN, and a slow open would otherwise age the row before anyone read it.
  const atIso = new Date().toISOString();
  const page = probePage({ url: observation.url });
  if (signedInOn?.(observation.url) === true) {
    closeSession({ chrome, session });
    record({ home, row: { atIso, page, provider, verdict: "signed-in", why: `the console opened at ${page}` } });
    logger.out({ line: `browser sign-in: ${provider} SIGNED IN — ${page}. Nothing to press, and no card to raise.` });
    return EXIT_OK;
  }
  let elements: string;
  try {
    elements = readFileSync(observation.snapshotPath, "utf8");
  } catch {
    logger.error({
      msg: `browser sign-in: the look at ${page} wrote no readable snapshot (${observation.snapshotPath})`,
    });
    closeSession({ chrome, session });
    return EXIT_ERROR;
  }
  const wall = classifyWall({ elements, landedUrl: observation.url, workEmail: chrome.workEmail });
  if (wall.kind === "owner-hands") {
    record({ home, row: { atIso, page, provider, verdict: "owner-hands", why: wall.why } });
    logger.out({ line: `browser sign-in: ${provider} THE OWNER'S HANDS — ${wall.why}.` });
    logger.out({
      line:
        `  The page is open in the owner's work Chrome (session ${session.id}); a card may now ask the owner for that one step, ` +
        "for the next 30 minutes. Close the session once the owner has done it.",
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const why = `press "${wall.label}" (${wall.ref}) on ${page}`;
  record({ home, row: { atIso, page, provider, verdict: "pressable", why } });
  for (const line of wallPressLines({ observation, provider, ref: wall.ref, sessionId: session.id, why })) {
    logger.out({ line });
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Look at Datadog: open this install's console and judge where it settles.
 *
 * @returns the process exit code
 */
function signInDatadog({ chrome, sessionId }: { chrome: WorkChrome; sessionId: string | undefined }): number {
  const root = destinationUrl({ ddSite: datadogSite({ home: chrome.home }), destination: "datadog" });
  if (root.isErr()) {
    logger.error({ msg: `browser sign-in: ${root.error.message}` });
    return EXIT_ERROR;
  }
  const url = `${root.value}apm/home`;
  const consoleHost = new URL(url).host;
  return judgeWallPage({
    chrome,
    provider: "datadog",
    sessionId,
    signedInOn: (landed) => !isDatadogSignInWall({ consoleHost, url: landed }),
    url,
  });
}

/**
 * Look at GitHub: read the owner's grant off the owner's Chrome's cookies — an organisation's SAML grant, or a personal
 * account's plain session — and open the wall only when there is one.
 *
 * @returns the process exit code
 */
async function signInGithub({
  chrome,
  org,
  sessionId,
  profiles,
}: {
  chrome: WorkChrome;
  org: string | undefined;
  sessionId: string | undefined;
  profiles: RecordedProfilePort;
}): Promise<number> {
  const { home } = chrome;
  let owner = org;
  if (owner === undefined) {
    const repository = resolveRepository({ home });
    if (repository.isErr()) {
      logger.error({ msg: `browser sign-in: no --org, and ${repository.error.join("; ")}` });
      return EXIT_USAGE;
    }
    owner = repository.value.owner;
  }
  const cookies = await githubCookieHeader({ home, profiles });
  if (cookies.isErr()) {
    logger.error({ msg: `browser sign-in: ${cookies.error.message}` });
    return EXIT_ERROR;
  }
  const grant = await readOwnerGrant({ cookieHeader: cookies.value, fetchImpl: productionAttachFetch(), owner });
  if (grant.isErr()) {
    logger.error({ msg: `browser sign-in: ${grant.error.message}` });
    return EXIT_ERROR;
  }
  const plan = githubSignInPlan({ grant: grant.value, owner });
  if (plan.kind === "wall") {
    return judgeWallPage({ chrome, provider: "github", sessionId, signedInOn: undefined, url: plan.url });
  }
  record({
    home,
    row: { atIso: new Date().toISOString(), page: plan.page, provider: "github", verdict: "signed-in", why: plan.why },
  });
  logger.out({ line: plan.message });
  closeNamedSession({ chrome, sessionId });
  return EXIT_OK;
}

/** What a GitHub look does with an owner's grant: record a signed-in row and stop, or open one wall page. */
export type GithubSignInPlan =
  | { readonly kind: "signed-in"; readonly page: string; readonly why: string; readonly message: string }
  | { readonly kind: "wall"; readonly url: string };

/**
 * Map an owner's grant onto the look's next act — the pure half of `signInGithub`, so every arm is pinned by a
 * table test rather than by opening Chrome.
 *
 * An organisation keeps its three arms exactly: granted is signed in off `/orgs/<org>`, walled opens the SSO
 * initiation page, signed out opens GitHub's login. A personal account has no grant, so signed in is signed in
 * off its own page and signed out opens the same login.
 *
 * @param owner the repository owner's login the grant was read against
 * @returns the signed-in row and line to print, or the wall page to open
 */
export function githubSignInPlan({ grant, owner }: { grant: OwnerGrant; owner: string }): GithubSignInPlan {
  if (grant.account === "organisation") {
    if (grant.verdict === "granted") {
      return {
        kind: "signed-in",
        message: `browser sign-in: github SIGNED IN — ${owner} is SAML-authorised. Nothing to press.`,
        page: orgProbeUrl({ org: owner }),
        why: `GitHub answers ${owner} as SAML-authorised for the owner's Chrome's session`,
      };
    }
    return { kind: "wall", url: grant.verdict === "walled" ? orgSsoInitiateUrl({ org: owner }) : GITHUB_LOGIN_URL };
  }
  if (grant.verdict === "signed-out") {
    return { kind: "wall", url: GITHUB_LOGIN_URL };
  }
  return {
    kind: "signed-in",
    message: `browser sign-in: github SIGNED IN — ${owner} is a personal account, so no SAML grant applies. Nothing to press.`,
    page: accountProbeUrl({ owner }),
    why: `GitHub answers ${owner}'s personal account page signed in for the owner's Chrome's session`,
  };
}

/**
 * Run `browser sign-in` from the parsed flags.
 *
 * @param provider the raw `--provider` value
 * @param org the raw `--org` value, GitHub only
 * @param sessionId the raw `--session` value: the tab a press left open, looked at again where it is now
 * @param home the state home the look is recorded under
 * @param profiles the door the recorded work profile is read through, once the provider is known
 * @returns the process exit code
 */
export async function runSignIn({
  provider,
  org,
  sessionId,
  home,
  profiles,
}: {
  provider: string | undefined;
  org: string | undefined;
  sessionId: string | undefined;
  home: string;
  profiles: RecordedProfilePort;
}): Promise<number> {
  if (!isSignInProvider(provider)) {
    logger.error({ msg: `browser sign-in needs --provider ${SIGN_IN_PROVIDERS.join("|")}` });
    logger.error({ msg: BROWSER_USAGE });
    return EXIT_USAGE;
  }
  const pin = await resolveSessionPin({ home, profiles });
  if (pin.isErr()) {
    for (const problem of pin.error) {
      logger.error({ msg: `browser sign-in: ${problem}` });
    }
    return EXIT_ERROR;
  }
  const chrome: WorkChrome = { home, pinPath: pin.value, workEmail: await recordedWorkEmail({ home, profiles }) };
  if (provider === "datadog") {
    return signInDatadog({ chrome, sessionId });
  }
  return signInGithub({ chrome, org, profiles, sessionId });
}
