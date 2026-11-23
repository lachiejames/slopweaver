/**
 * The effectful shell for the user-attachment pipeline's reads: the HTML GET the upload token is scraped off,
 * the organisation-grant probe, and the one request helper every call goes through. The three upload calls
 * live in `attachUpload.ts`. Every decision lives in the pure `attachment.ts`; this file only performs I/O and
 * maps what came back onto the domain's typed errors.
 *
 * **No browser runs here.** The reverse-engineering this was built from assumed Playwright would drive the
 * upload, and measured against the live endpoint it does not need to: given the session
 * cookies and a token scraped from the page HTML, all four requests are plain `fetch`. A browser is
 * involved exactly once, in `webSession.ts`, to obtain the session interactively — and never again. That
 * keeps the hot path deterministic, testable against injected `fetch`, and free of a headed process.
 *
 * The `fetch` seam is injected rather than reached for globally, so the whole pipeline is exercisable
 * without network access and without a mock (a plain function, per `testing.md`).
 */

import { err, ok, type Result } from "../../lib/result.js";
import { invalidDatadogHostRefusalLines } from "../invalidDatadogHost.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";
import {
  GITHUB_ORIGIN,
  GITHUB_USER_AGENT,
  isOrgSsoWall,
  isSignedInPage,
  scrapeUploadContext,
  type UploadContext,
} from "./attachment.js";
import { accountProbeUrl, type OrgGrantVerdict, orgGrantVerdict, orgProbeUrl } from "./orgSso.js";

/** The minimal response shape this client reads — narrower than `Response`, so a fake stays small. */
export interface AttachResponse {
  readonly status: number;
  readonly text: () => Promise<string>;
}

/** The injected transport: everything this module does to the network goes through it. */
export type AttachFetch = (args: {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: FormData;
}) => Promise<AttachResponse>;

/** The pull request or issue the upload is attributed to, and the repository it is filed against. */
export interface AttachTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * The pull-request or issue page an upload is attributed to — the `referer` of calls 1 and 3. `/pull/<n>`
 * also serves an issue: GitHub redirects between the two, which is what makes one flag work for both.
 *
 * @param target the repository and pull-request or issue number
 * @returns the absolute page URL
 */
export function targetPageUrl({ target }: { target: AttachTarget }): string {
  return `${GITHUB_ORIGIN}/${target.owner}/${target.repo}/pull/${String(target.number)}`;
}

/**
 * The pages the upload token and repository id are scraped from, in the order they are tried.
 *
 * GitHub moved a pull request's page to its React app, which renders no `<file-attachment>`: measured, every
 * pull-request, issue and commit page tried came back signed in, SAML-authorised and with no upload region,
 * so every upload failed `SCRAPE_FAILED`. Two pages still server-render one:
 *
 * 1. **The pull request's classic conversation page**, `?overview=false` — the React page's own opt-out,
 *    served to anyone who can read the pull request. Measured on two private pull requests and a public one.
 * 2. **The repository's `releases/new`**, whose release-body editor posts to the same
 *    `/upload/policies/assets` endpoint. It is the fallback because an ISSUE has no classic page: `/pull/<n>`
 *    redirects an issue to `/issues/<n>`, the redirect drops the query, and the issue page is React. Loading
 *    it creates nothing — a release exists only once that form is submitted — but GitHub serves it only to an
 *    account that can push to the repository.
 *
 * Reproduce: `slopweaver github attach upload --file <png> --repo <o/r> --number <n> --dry-run` names both.
 *
 * @param target the repository and pull-request or issue number
 * @returns the classic pull-request page, then the repository's new-release form
 */
export function uploadTokenPageUrls({ target }: { target: AttachTarget }): {
  readonly classicPullPage: string;
  readonly releaseForm: string;
} {
  return {
    classicPullPage: `${targetPageUrl({ target })}?overview=false`,
    releaseForm: `${GITHUB_ORIGIN}/${target.owner}/${target.repo}/releases/new`,
  };
}

/**
 * Perform one request and read its whole body, turning a thrown transport failure into the domain's typed error.
 * The body is read HERE, inside the same catch, because a body that fails mid-read otherwise escaped every
 * caller as a raw rejection naming no URL.
 *
 * Every write the upload makes crosses here, so this is where its address and form are judged for a dead Datadog
 * console host: the page token, the policy's fields and the finalize token are all GitHub's own answers carried
 * into a later call, and judging each where it is read missed one after another. The file's bytes sit in the form
 * as a `Blob` this synchronous walk cannot read, so `uploadAttachment` judges them before the first call. A read
 * (`GET`) carries nothing composed and is not judged.
 *
 * A call whose success carries nothing it reads names that status in `bodyUnreadOn`: a body that then fails to
 * read is that success with an empty body, never a transport failure. Any other status still reads strictly,
 * because a refusal's body is the detail it carries out.
 *
 * @param fetchImpl the injected transport
 * @param bodyUnreadOn the one success status whose body the caller never reads
 * @returns the response's status and whole body, or the typed refusal or transport failure
 */
export async function attachRequest({
  fetchImpl,
  url,
  method,
  headers,
  body,
  bodyUnreadOn,
}: {
  fetchImpl: AttachFetch;
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: FormData;
  bodyUnreadOn?: number;
}): Promise<Result<{ status: number; body: string }, GithubAttachError>> {
  if (method !== "GET") {
    const refusal = invalidDatadogHostRefusalLines({
      command: `github attach ${method} ${url}`,
      payload: { body, url },
    });
    if (refusal !== undefined) {
      return err(GithubAttachErrors.deadDatadogHost({ refusal }));
    }
  }
  let response: Awaited<ReturnType<AttachFetch>>;
  try {
    response = await fetchImpl({ headers, method, url, ...(body === undefined ? {} : { body }) });
  } catch (cause: unknown) {
    return err(GithubAttachErrors.transportFailed({ cause, url }));
  }
  try {
    return ok({ body: await response.text(), status: response.status });
  } catch (cause: unknown) {
    if (response.status === bodyUnreadOn) {
      return ok({ body: "", status: response.status });
    }
    return err(GithubAttachErrors.transportFailed({ cause, url }));
  }
}

/**
 * GET one page and read its assets upload region.
 *
 * A page that comes back `200` but ANONYMOUS is reported as an expired session rather than as a failed
 * scrape, which is the distinction that matters to whoever has to fix it: GitHub serves a signed-out
 * visitor a perfectly valid page with no upload region on it, so the naive reading of that response is
 * "this repository has no comment box" when the truth is "your cookies lapsed".
 */
async function scrapePage({
  fetchImpl,
  cookieHeader,
  sessionPath,
  url,
  unreadable,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  sessionPath: string;
  url: string;
  unreadable: (args: { url: string; status: number }) => GithubAttachError;
}): Promise<Result<UploadContext, GithubAttachError>> {
  const response = await attachRequest({
    fetchImpl,
    headers: { accept: "text/html", cookie: cookieHeader, "user-agent": GITHUB_USER_AGENT },
    method: "GET",
    url,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  if (response.value.status !== 200) {
    return err(unreadable({ status: response.value.status, url }));
  }
  const html = response.value.body;
  if (!isSignedInPage({ html })) {
    return err(GithubAttachErrors.webSessionExpired({ path: sessionPath, url }));
  }
  // Checked BEFORE the scrape, because an SSO wall passes the signed-in check and then fails the scrape,
  // which reports the misleading "this page renders no upload region" for a page that renders no repository
  // at all. Measured: that message cost a full diagnostic detour looking for a UI difference.
  if (isOrgSsoWall({ html })) {
    return err(GithubAttachErrors.orgSsoRequired({ url }));
  }
  return scrapeUploadContext({ html, url });
}

/**
 * Read the upload token and repository id off the first of {@link uploadTokenPageUrls} that renders them.
 *
 * Only a page that loaded, signed in, and rendered NO assets region moves on to the release form; every other
 * failure on the pull-request page is final, because an expired session, an SSO wall or a wrong number would
 * fail the release form identically and the second request would only bury the first answer.
 *
 * @param fetchImpl the injected transport
 * @param cookieHeader the assembled github.com `Cookie` header
 * @param sessionPath the session file's path, for an expiry message
 * @param target the repository and pull-request or issue number whose pages are read
 * @returns the scraped token and repository id, or why neither page could supply them
 */
export async function readUploadContext({
  fetchImpl,
  cookieHeader,
  sessionPath,
  target,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  sessionPath: string;
  target: AttachTarget;
}): Promise<Result<UploadContext, GithubAttachError>> {
  const pages = uploadTokenPageUrls({ target });
  const fromPull = await scrapePage({
    cookieHeader,
    fetchImpl,
    sessionPath,
    unreadable: GithubAttachErrors.pageUnreadable,
    url: pages.classicPullPage,
  });
  if (fromPull.isOk() || fromPull.error.code !== "SCRAPE_FAILED") {
    return fromPull;
  }
  const fromRelease = await scrapePage({
    cookieHeader,
    fetchImpl,
    sessionPath,
    unreadable: ({ url, status }) =>
      GithubAttachErrors.tokenPageUnreadable({ pullPage: pages.classicPullPage, status, url }),
    url: pages.releaseForm,
  });
  if (fromRelease.isErr() && fromRelease.error.code === "SCRAPE_FAILED") {
    return err(
      GithubAttachErrors.scrapeFailed({
        missing: fromRelease.error.missing,
        url: `${pages.classicPullPage} and ${pages.releaseForm}`,
      }),
    );
  }
  // A non-200 already names both pages (`tokenPageUnreadable`); every other release-form failure names only the
  // page it came off, so it says the pull-request page was read first.
  if (fromRelease.isErr() && fromRelease.error.code !== "PAGE_UNREADABLE") {
    return err({
      ...fromRelease.error,
      message: `${pages.classicPullPage} rendered no upload region, so ${pages.releaseForm} was read: ${fromRelease.error.message}`,
    });
  }
  return fromRelease;
}

/**
 * Read whether the saved session is SAML-authorised for one organisation, with no browser and no upload.
 *
 * The online half of `attach status`, and the answer to the false green this verb used to report: parsing a
 * cookie file proves the file is a session, and proves nothing at all about the separate grant that decides
 * whether that session can see an organisation's private repositories. One GET settles it.
 *
 * @param fetchImpl the injected transport
 * @param cookieHeader the assembled github.com `Cookie` header
 * @param org the organisation whose grant is being read
 * @returns the verdict for that organisation, or why the page could not be read
 */
export async function readOrgGrant({
  fetchImpl,
  cookieHeader,
  org,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  org: string;
}): Promise<Result<OrgGrantVerdict, GithubAttachError>> {
  const url = orgProbeUrl({ org });
  const response = await attachRequest({
    fetchImpl,
    headers: { accept: "text/html", cookie: cookieHeader, "user-agent": GITHUB_USER_AGENT },
    method: "GET",
    url,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  if (response.value.status !== 200) {
    return err(GithubAttachErrors.pageUnreadable({ status: response.value.status, url }));
  }
  return ok(orgGrantVerdict({ html: response.value.body }));
}

/**
 * What a repository owner's page says about the session: an organisation's three-state grant, or a personal
 * account's plain session, which has no SAML grant to hold.
 */
export type OwnerGrant =
  | { readonly account: "organisation"; readonly verdict: OrgGrantVerdict }
  | { readonly account: "personal"; readonly verdict: "signed-in" | "signed-out" };

/**
 * Read the session against a repository OWNER that may be an organisation or a personal account.
 *
 * {@link readOrgGrant} first, unchanged, because an organisation's grant is the read that decides an upload.
 * GitHub answers `/orgs/<login>` with 404 for a personal account, so on exactly that answer the owner's own
 * profile page is read instead and only its signed-in marker is judged: a user-owned repository has no
 * organisation, so there is no sign-on wall to look for. Measured on a personal-account install,
 * `slopweaver browser sign-in --provider github` stopped on `https://github.com/orgs/<login> answered HTTP 404`
 * before this. A 404 on the profile too means no such account, named against that page.
 *
 * The 404 is an INFERENCE, not a documented account-type contract: GitHub promises no such thing, and an
 * Enterprise Managed Users organisation can hide its page from a session outside it. Were its profile page
 * then to answer 200 signed in, this would read a personal account signed in with no SAML grant checked — a
 * false signed-in, unproven either way and not guarded here. `GET /users/<login>` would say `type` outright,
 * but it answers for an API token, never for the browser cookies being judged.
 *
 * @param fetchImpl the injected transport
 * @param cookieHeader the assembled github.com `Cookie` header
 * @param owner the repository owner's login, organisation or user
 * @returns the owner's kind and the session's verdict against it, or why neither page could be read
 */
export async function readOwnerGrant({
  fetchImpl,
  cookieHeader,
  owner,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  owner: string;
}): Promise<Result<OwnerGrant, GithubAttachError>> {
  const organisation = await readOrgGrant({ cookieHeader, fetchImpl, org: owner });
  if (organisation.isOk()) {
    return ok({ account: "organisation", verdict: organisation.value });
  }
  const notAnOrganisation = organisation.error.code === "PAGE_UNREADABLE" && organisation.error.status === 404;
  if (!notAnOrganisation) {
    return err(organisation.error);
  }
  const url = accountProbeUrl({ owner });
  const response = await attachRequest({
    fetchImpl,
    headers: { accept: "text/html", cookie: cookieHeader, "user-agent": GITHUB_USER_AGENT },
    method: "GET",
    url,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  if (response.value.status !== 200) {
    return err(GithubAttachErrors.pageUnreadable({ status: response.value.status, url }));
  }
  return ok({
    account: "personal",
    verdict: isSignedInPage({ html: response.value.body }) ? "signed-in" : "signed-out",
  });
}

/**
 * The production transport — a thin adapter over global `fetch` that never follows a cross-origin redirect
 * silently and never carries cookies anywhere the caller did not name.
 *
 * @returns a transport backed by the runtime's own `fetch`
 */
export function productionAttachFetch(): AttachFetch {
  return async ({ url, method, headers, body }) => {
    const response = await fetch(url, {
      headers,
      method,
      redirect: "follow",
      ...(body === undefined ? {} : { body }),
    });
    return { status: response.status, text: () => response.text() };
  };
}
