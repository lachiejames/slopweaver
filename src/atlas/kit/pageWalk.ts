/**
 * The page-walk engine every driven-browser atlas runs: visit a DECLARED list of pages in the owner's own
 * browser, photograph each, reduce what the client asked for, and record what did not work.
 *
 * ## Why this is kit-owned
 *
 * Two atlases arrived at the same three hundred lines and differed in five decisions, every one of which is
 * a fact about the PLATFORM rather than about walking: how to learn the root a page hangs off, how to grade
 * where the browser settled, what a first-party call reduces to, whether a settled page means the session
 * has ended, and how long to let a page settle. Those five are {@link PageWalkSpec}. Everything around them
 * — the declared denominator, the four-way declared/attempted/reached/photographed accounting, the
 * lost-session stop, the duplicate-picture check and the artifact addressing — was identical, and each is a
 * property a copy can silently lose.
 *
 * ## The denominator is DECLARED, which is what makes the coverage claim checkable
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. The walk is judged against a list it did not choose, so a declared page never reached is a gap an
 * atlas can NAME, where a page a crawler never noticed is not.
 *
 * ## Declared, attempted, reached and PHOTOGRAPHED are four different things
 *
 * Each is recorded separately, and the fourth is the one a hand-written walk gets wrong. A reached page with
 * no verified PNG carries {@link PageObservation.screenshotMissingBecause} and stops its coverage cell being
 * `synced` — an atlas whose owner asked for screenshots by name has not done what it says it did if it
 * quietly returns none.
 *
 * ## The kit owns the ADDRESS comparison, even though grading the outcome is the platform's
 *
 * `gradeOutcome` is one of the five, and it stays one — a sign-in wall, a client's own `/404`, a rewrite to a
 * page the account cannot open are all facts about the platform. But the sub-question underneath every one of
 * those graders, *did the browser settle on the page we asked for*, is not: it is a fact about URLs, it stood
 * in ten near-verbatim copies, and every one of those copies got it wrong in the same direction.
 * {@link addressDisagreement} is that question, owned here, and its own comment carries the measurement and
 * the one walk that deliberately asks a different question instead.
 *
 * ## Everything here is written against a seam
 *
 * `browser/pageTransport.ts` is the whole contract — `visit` and `release` — so the walk, the reduction, the
 * artifact writing and every one of their tests run against a deterministic fake. A redirect, a lost body, a
 * lost session and a missing screenshot are settled by unit tests rather than by luck in a live run.
 */
import {
  type BrowserPageTransport,
  type BrowserTransportError,
  isCaptureComplete,
  isWalkStoppingError,
  type PageCapture,
  type ResponseAccounting,
} from "../../browser/pageTransport.js";
import { signInNotingTransport } from "../../browser/signInWalls.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { AtlasArtifactWriter } from "./artifactWriter.js";
import { visitPhotographed } from "./browserWalk.js";
import type { AtlasArtifactRef } from "./contract.js";
import { writeScreenshot } from "./pageScreenshot.js";
import { requestedQueryHeld } from "./queryHeld.js";
import { type WalkProgress, walkTicker } from "./walkProgress.js";

/** What one declared page's visit came to. `TCall` is the platform's own reduced-call row. */
export interface PageObservation<TCall> {
  readonly surface: string;
  /** Whether the walk got as far as asking for this page at all. `false` after a lost session. */
  readonly attempted: boolean;
  /** The URL asked for, or `""` when the page was never addressed. Never printed — it can carry a private id. */
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number | null;
  readonly title: string;
  readonly observedAt: string;
  /** Whether the client sent this page somewhere other than where it was asked to go. */
  readonly redirected: boolean;
  /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
  readonly captureComplete: boolean;
  /**
   * What the page's capture actually accounted for. Carried rather than reduced to the boolean above,
   * because "not complete" is a silence and "eligible 53, kept 44, lost 8" is a number somebody can act on.
   */
  readonly responseAccounting: ResponseAccounting;
  /** Why this declared page is not held, or `null` when it is. */
  readonly unreachableBecause: string | null;
  /**
   * Why this page has no proof screenshot, or `null` when it has one. A reached page that is not
   * photographed is an incomplete observation rather than a complete one missing a nicety.
   */
  readonly screenshotMissingBecause: string | null;
  readonly calls: readonly TCall[];
  /** The proof screenshot, or an empty list when there is none — see {@link screenshotMissingBecause}. */
  readonly artifacts: readonly AtlasArtifactRef[];
}

/** How a visited page graded against the address it was asked for. */
export interface PageOutcome {
  readonly redirected: boolean;
  readonly unreachableBecause: string | null;
}

/**
 * Which part of the address the browser did not keep.
 *
 * Four values rather than a boolean because every adopting platform prints a DIFFERENT sentence for each,
 * and several of those sentences deliberately never quote the settled address — it carries a tenant slug,
 * an account slug, an application id, a team id or an organisation short code, none of which may leave the
 * process. Collapsing this to "it moved" would take that wording away from the only layer that knows it.
 */
export type AddressDisagreement = "unreadable" | "origin" | "path" | "query";

/** A URL's pathname with any trailing slash removed, so `/x` and `/x/` are the same address. */
function trimmedPath({ url }: { url: URL }): string {
  return url.pathname.replace(/\/+$/, "");
}

/**
 * Whether the browser settled on the page it was asked for, and which part of the address says it did not.
 *
 * ## The question this answers, and the one it does not
 *
 * **Page identity**: is this the page the declaration named? Origin, path, and every query parameter the
 * DECLARATION itself asked for. A parameter the CLIENT appended is its own view state — a restored filter, a
 * selected tab, a timeframe — and it does not change which page this is. That is the comparison every walk
 * whose declared addresses carry query state needs, and neither shape that stood before this one could give
 * it: whole-URL equality (`browser/pageTransport.ts`'s `isRedirected`) calls an appended filter a redirect,
 * and origin-plus-path equality — which stood in ten near-verbatim copies across the atlases — tolerates ANY
 * query difference, so a page whose identity IS a parameter would be photographed under a sibling's
 * `?controlId=`, uniquely enough that the duplicate-picture check above never fires.
 *
 * **State fidelity** — did we see the view we asked for, or the one the client restored? — is a DIFFERENT
 * question, and whole-URL equality is the right answer to it. `atlas/vanta/browserWalk.ts` asks that one
 * deliberately and stays on `isRedirected`; do not convert it to this.
 *
 * MEASURED, and the reason this is a mechanism rather than a preference: on the first full Datadog console
 * walk, whole-URL equality graded pages **redirected** that were the same path wearing the console's own
 * appended state, understating the landed count `atlas/datadog/surfaceFill.ts` reads by every one of them. `atlas/datadog/consoleWalk.ts`'s `settledElsewhere` is where that
 * measurement lives.
 *
 * Trailing slashes are trimmed on both sides, so `/x` and `/x/` agree. The FRAGMENT is ignored: a hash is
 * client-side state rather than an address, and no walk here grades on one. Percent-encoding needs no
 * handling of its own — `URLSearchParams` decodes both sides, so `search=Password+policy` and
 * `search=Password%20policy` are the same value.
 *
 * @param requestedUrl the absolute address the walk asked for
 * @param finalUrl where the browser actually settled
 * @returns which part of the address disagreed, or `null` when the browser settled where it was asked
 */
export function addressDisagreement({
  requestedUrl,
  finalUrl,
}: {
  requestedUrl: string;
  finalUrl: string;
}): AddressDisagreement | null {
  // `URL.parse` answers `null` for an address it cannot read, rather than throwing as the constructor does.
  const requested = URL.parse(requestedUrl);
  const settled = URL.parse(finalUrl);
  if (requested === null || settled === null) {
    return "unreadable";
  }
  if (requested.origin !== settled.origin) {
    return "origin";
  }
  if (trimmedPath({ url: requested }) !== trimmedPath({ url: settled })) {
    return "path";
  }
  return requestedQueryHeld({ requested, settled }) ? null : "query";
}

/** What one platform contributes to a walk. Everything else the engine already knows. */
export interface PageWalkSpec<TPage extends { readonly surface: string }, TCall> {
  /** The declared list, which is the walk's denominator and the only thing coverage is graded against. */
  readonly pages: readonly TPage[];
  /**
   * Learn the root every page hangs off, by asking the client where it sends the bare origin.
   *
   * Returns `null` when the client landed somewhere with no such root — a real state, not a failure — and an
   * error only when the client could not be reached at all.
   *
   * `progress` is the walk's own sink, `undefined` when its caller supplied none. It is here for a probe that
   * RECOVERED from a failure — one navigation failed and a later step answered — which must say so rather
   * than recover silently. Like every progress line, what it is handed may never carry a URL.
   */
  readonly resolveRoot: (input: {
    transport: BrowserPageTransport;
    progress: WalkProgress | undefined;
  }) => Promise<Result<string | null>>;
  /** The absolute URL for one declared page, or `null` when it needs a root there is none of. */
  readonly urlFor: (input: { root: string | null; page: TPage }) => string | null;
  /** Why a page that needs a root there is none of is not held. */
  readonly rootMissingBecause: string;
  /** How this platform grades where the browser settled. */
  readonly gradeOutcome: (input: { requestedUrl: string; capture: PageCapture }) => PageOutcome;
  /**
   * What a page's first-party calls reduce to. Names only — never a value.
   *
   * The PAGE is passed alongside its responses because what may be kept from a body is a fact about the page
   * rather than about the response, and only the declaration knows it. An HR platform is why: a page carrying
   * a `never-read` body policy has its responses dropped without being walked at all — and a reduction that
   * read the body and discarded the result afterwards would already have read a payslip into the process. A
   * platform with no such policy ignores the field, which is what the Clerk and Xero walks do.
   */
  readonly reduceCalls: (input: { responses: PageCapture["responses"]; page: TPage }) => readonly TCall[];
  /**
   * Whether a SUCCESSFUL capture means the session has ended.
   *
   * A sign-in wall is a successful navigation, so a platform that redirects a signed-out browser needs this
   * or one sign-out becomes a page gap on every route after it.
   */
  readonly sessionLostOn: (input: { capture: PageCapture }) => boolean;
  /** The relative path a screenshot's artifact reference carries, given the digest of its own bytes. */
  readonly artifactPathFor: (input: { sha256: string }) => string;
  /**
   * Whether this page's picture may be WRITTEN at all, and the reason when it may not.
   *
   * REQUIRED, and required is the point — the same argument `kit/contract.ts` makes for `writePolicy`: a
   * platform that omitted it would inherit a default nobody chose. A platform that photographs everything
   * returns `null` for every page, which is one line and says so out loud.
   *
   * **This exists because a Codex review broke an HR atlas on it.** That atlas refused to
   * hold a picture of any page rendering identifiable colleagues, and it implemented the refusal by
   * clearing the observation's `artifacts` array AFTER the walk returned. The bytes had already been
   * written: this engine photographed every page it reached and handed each one to the writer, so a
   * screenshot of the people directory reached `$SLOPWEAVER_HOME` and stayed there while every count and
   * every test read clean. Clearing a REFERENCE is not withholding a FILE, and the only place the two can
   * be made the same thing is before the write.
   */
  readonly photographPolicy: (input: { page: TPage }) => { readonly refusedBecause: string } | null;
  /** How long to keep observing one page after it settles, so its own deferred calls are caught. */
  readonly settleMs: number;
  /** What to tell a reader to do when the session is gone. Carries the platform's name, never a URL. */
  readonly signedOutHint: string;
  /** The prefix a progress line leads with — the platform's name. Never a URL. */
  readonly progressLabel: string;
}

/** What a walk produced. */
export interface PageWalkResult<TCall> {
  /**
   * Whether the probe found a root at all. The root itself is NEVER carried out of the walk — on both
   * atlases using this it carries a private identifier.
   */
  readonly rootFound: boolean;
  readonly pages: readonly PageObservation<TCall>[];
  /** Whether the walk stopped early because the session was lost. */
  readonly sessionLost: boolean;
}

/** An accounting that claims nothing, for a visit that never happened. */
const NO_ACCOUNTING: ResponseAccounting = { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 };

/**
 * Whether one observation is fully held — reached, photographed, and carrying the artifact to prove it.
 *
 * The artifact check is not redundant with `screenshotMissingBecause === null`: a row can carry both
 * nullable reasons and an EMPTY artifact list, because those two fields are set by the walk and the artifact
 * list is set by the writer. Grading on the reasons alone lets a complete-looking walk with no screenshots
 * anywhere on disk publish `synced` coverage.
 *
 * @param page the observation to judge
 * @returns whether the atlas holds this declared page in full
 */
export function isPageHeld<TCall>({ page }: { page: PageObservation<TCall> }): boolean {
  return page.unreachableBecause === null && page.screenshotMissingBecause === null && page.artifacts.length > 0;
}

/**
 * Which of an observation's two reasons explains why it is not held, in that order.
 *
 * Ordered rather than coalesced: a page nobody reached says THAT, not that its picture is missing, and a
 * reader handed the second reason for a page that never loaded has been told the less useful fact. `null`
 * is its own answer and does not mean the page is held — {@link isPageHeld} also wants the artifact, so a
 * withdrawn duplicate picture leaves both reasons null and the page still not held.
 *
 * @param page the observation to explain
 * @returns the reason, or `null` when neither field carries one
 */
export function notHeldBecause<TCall>({ page }: { page: PageObservation<TCall> }): string | null {
  if (page.unreachableBecause !== null) {
    return page.unreachableBecause;
  }
  return page.screenshotMissingBecause;
}

/**
 * Mark every page whose picture is byte-identical to another declared page's as not independently evidenced.
 *
 * ## Why a duplicate screenshot is a FINDING rather than a saving
 *
 * Artifacts are content-addressed, so two pages that photograph the same thing share one file — which is
 * correct storage and a silent disaster for a coverage claim. MEASURED on the Notion walk:
 * every declared route reported reached and photographed, and every one of those screenshots was one
 * file, because each was the client's not-found shell. A vendor-specific not-found constant
 * catches that one case; this catches the whole class.
 *
 * The rule is exactly as strong as it should be: a picture identical to another page's does not evidence a
 * distinct surface, whatever produced it. Being wrong here costs a page a coverage credit rather than
 * granting one.
 *
 * @param pages every declared page's observation
 * @returns the observations, with a shared picture recorded on each page that shares one
 */
export function markIndistinguishablePages<TCall>({
  pages,
}: {
  pages: readonly PageObservation<TCall>[];
}): readonly PageObservation<TCall>[] {
  const bySha = Map.groupBy(
    pages.flatMap((page) => page.artifacts.map((artifact) => ({ sha256: artifact.sha256, surface: page.surface }))),
    (entry) => entry.sha256,
  );
  return pages.map((page): PageObservation<TCall> => {
    // Every artifact any page carries was grouped above, so each lookup here is present.
    const shared = page.artifacts.flatMap((artifact) => bySha.get(artifact.sha256)!.map((entry) => entry.surface));
    const others = [...new Set(shared)].filter((surface) => surface !== page.surface).toSorted();
    if (others.length === 0) {
      return page;
    }
    return {
      ...page,
      artifacts: [],
      screenshotMissingBecause:
        `its screenshot is byte-identical to ${String(others.length)} other declared page(s) ` +
        `(${others.join(", ")}), so it evidences no surface of its own`,
    };
  });
}

/**
 * Why a visit failed, in words that carry no URL.
 *
 * The transport's own `message` INTERPOLATES the address it was given — `could not navigate to <url>:
 * <reason>` — and both atlases using this engine address URLs that carry a private identifier. That message
 * therefore may not be quoted into an observation, because an observation reaches both report shapes and the
 * stored generation. The `code` says what kind of failure it was, and the transport's `reason` half is
 * deliberately dropped rather than parsed out — a substring rule over somebody else's message is exactly how
 * this class comes back.
 *
 * **The `code` alone was not enough, and that cost six runs.** A failed navigation once printed
 * one flat sentence here, so a 45-second page timeout and a two-minute client kill read identically and four
 * runs of evidence could not separate three mechanisms (page `vanta-walk-120s-client-hang`). A
 * `NAVIGATION_FAILED` now carries its own {@link BrowserTransportError.because} — composed, for a client
 * failure, from nothing but `browser/clientKill.ts`'s own literals and numbers, so it is recordable by
 * construction rather than by a reviewer checking.
 */
function transportReason({ error, signedOutHint }: { error: BrowserTransportError; signedOutHint: string }): string {
  if (error.code === "SESSION_LOST") {
    return signedOutHint;
  }
  if (error.code === "TRANSPORT_UNAVAILABLE") {
    return "no browser transport was attached, so this page was never asked for";
  }
  if (error.code === "NAVIGATION_FAILED") {
    return error.because;
  }
  return "the browser could not navigate to this page's address";
}

/** A row for a declared page the walk never completed, whether it was addressed or not. */
function incompletePage<TCall>({
  surface,
  attempted,
  why,
  requestedUrl,
}: {
  surface: string;
  attempted: boolean;
  why: string;
  requestedUrl: string;
}): PageObservation<TCall> {
  return {
    artifacts: [],
    attempted,
    calls: [],
    captureComplete: false,
    finalUrl: "",
    observedAt: "",
    redirected: false,
    requestedUrl,
    responseAccounting: NO_ACCOUNTING,
    screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
    statusCode: null,
    surface,
    title: "",
    unreachableBecause: why,
  };
}

/** A visit that never happened, or one the transport refused: a recorded row, never a thrown walk. */
function failedVisit<TCall>({
  surface,
  attempted,
  requestedUrl,
  why,
  sessionLost,
}: {
  surface: string;
  attempted: boolean;
  requestedUrl: string;
  why: string;
  sessionLost: boolean;
}): { observation: PageObservation<TCall>; sessionLost: boolean } {
  return { observation: incompletePage({ attempted, requestedUrl, surface, why }), sessionLost };
}

/** Visit one declared page, photograph it and reduce what it asked for. */
async function visitPage<TPage extends { readonly surface: string }, TCall>({
  page,
  root,
  transport,
  writeArtifact,
  spec,
}: {
  page: TPage;
  root: string | null;
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  spec: PageWalkSpec<TPage, TCall>;
}): Promise<{ observation: PageObservation<TCall>; sessionLost: boolean }> {
  const requestedUrl = spec.urlFor({ page, root });
  if (requestedUrl === null) {
    return failedVisit({
      attempted: false,
      requestedUrl: "",
      sessionLost: false,
      surface: page.surface,
      why: spec.rootMissingBecause,
    });
  }
  // A page the platform's policy does not refuse is photographed.
  const policy = spec.photographPolicy({ page });
  const refusedBecause = policy === null ? null : policy.refusedBecause;
  // The refusal reaches the TRANSPORT, so a page that may not be photographed is never asked for a
  // screenshot and no bytes are produced at any point — see `browser/pageTransport.ts` on the three review
  // passes that walked this back from "deleted afterwards" to "never taken".
  const visited = await visitPhotographed({
    photograph: refusedBecause === null,
    settleMs: spec.settleMs,
    transport,
    url: requestedUrl,
  });
  if (visited.isErr()) {
    return failedVisit({
      attempted: true,
      requestedUrl,
      sessionLost: isWalkStoppingError({ error: visited.error }),
      surface: page.surface,
      why: transportReason({ error: visited.error, signedOutHint: spec.signedOutHint }),
    });
  }
  return {
    observation: observationOf({ capture: visited.value, page, refusedBecause, requestedUrl, spec, writeArtifact }),
    // A settle the platform reads as the session ending is not this page being missing: everything after it
    // would land in the same place, so the walk stops rather than manufacturing a gap per remaining route.
    sessionLost: spec.sessionLostOn({ capture: visited.value }),
  };
}

/**
 * The instant a SUCCEEDING capture carries, repaired when the transport handed back one no store can read.
 *
 * A capture's `observedAt` is typed `string` and comes from a transport this module does not own, so an
 * unreadable value reaches a publisher that builds a source record out of it and the store refuses the
 * whole generation on it. MEASURED on the Vanta atlas, before its walk ran on this engine: two
 * consecutive walks each refused with `Invalid ISO datetime` on its own captures, wrote nothing either
 * time, and left the browser kinds holding ZERO entities while the descriptor declared the surface filled —
 * one bad instant discarding every good row beside it. That walk was hand-written and carried its own
 * guard; the guard belongs HERE, where every atlas's captures pass, rather than in the one that was bitten.
 *
 * A FAILED visit is untouched: `incompletePage` records the empty string on purpose, and every surface that
 * reads these rows treats it as "never observed" and supplies the run's own clock. The empty string is a
 * fact; an unreadable non-empty instant is a defect.
 *
 * @param offered the instant the capture brought back
 * @returns an instant `Date.parse` can read
 */
function usableInstant({ offered }: { offered: string }): string {
  return Number.isNaN(Date.parse(offered)) ? new Date().toISOString() : offered;
}

/** Fold one successful capture into the observation the walk records for its page. */
function observationOf<TPage extends { readonly surface: string }, TCall>({
  capture,
  page,
  requestedUrl,
  spec,
  writeArtifact,
  refusedBecause,
}: {
  capture: PageCapture;
  page: TPage;
  requestedUrl: string;
  spec: PageWalkSpec<TPage, TCall>;
  writeArtifact: AtlasArtifactWriter;
  refusedBecause: string | null;
}): PageObservation<TCall> {
  const outcome = spec.gradeOutcome({ capture, requestedUrl });
  const shot = writeScreenshot({
    artifactPathFor: spec.artifactPathFor,
    capture,
    redirected: outcome.redirected || outcome.unreachableBecause !== null,
    refusedBecause,
    writeArtifact,
  });
  return {
    artifacts: shot.artifacts,
    attempted: true,
    calls: spec.reduceCalls({ page, responses: capture.responses }),
    captureComplete: isCaptureComplete({ capture }),
    finalUrl: capture.finalUrl,
    observedAt: usableInstant({ offered: capture.observedAt }),
    redirected: outcome.redirected,
    requestedUrl,
    responseAccounting: capture.responseAccounting,
    screenshotMissingBecause: shot.missingBecause,
    statusCode: capture.statusCode,
    surface: page.surface,
    title: capture.title,
    unreachableBecause: outcome.unreachableBecause,
  };
}

/**
 * Walk every declared page.
 *
 * Strictly sequential, one page at a time: it drives the owner's own browser, so two pages at once would
 * fight over the tab the owner is looking at.
 *
 * @param spec what this platform contributes — its declared list and its five decisions
 * @param transport the bound page transport, released by the caller rather than here
 * @param writeArtifact where each page's screenshot is written and verified
 * @param progress where a line of progress goes; omitted discards it. It is given the surface NAME and never
 *   a URL, because both atlases using this address URLs that carry a private identifier
 * @returns every declared page's observation, or why the walk could not start at all
 */
export async function walkDeclaredPages<TPage extends { readonly surface: string }, TCall>({
  spec,
  transport,
  writeArtifact,
  progress,
}: {
  spec: PageWalkSpec<TPage, TCall>;
  transport: BrowserPageTransport;
  writeArtifact: AtlasArtifactWriter;
  progress?: WalkProgress;
}): Promise<Result<PageWalkResult<TCall>>> {
  const noting = signInNotingTransport({ sessionLostOn: spec.sessionLostOn, transport });
  const root = await spec.resolveRoot({ progress, transport: noting });
  if (root.isErr()) {
    return err(root.error);
  }
  const pages: PageObservation<TCall>[] = [];
  let sessionLost = false;
  const tick = walkTicker({ label: spec.progressLabel, progress, total: spec.pages.length });
  for (const [index, page] of spec.pages.entries()) {
    if (sessionLost) {
      pages.push(
        incompletePage({
          attempted: false,
          requestedUrl: "",
          surface: page.surface,
          why: "the walk stopped before this page: the browser session was lost part-way through",
        }),
      );
      continue;
    }
    tick({ page: page.surface, position: index + 1 });
    const visited = await visitPage({ page, root: root.value, spec, transport: noting, writeArtifact });
    pages.push(visited.observation);
    sessionLost = visited.sessionLost;
  }
  return ok({ pages: markIndistinguishablePages({ pages }), rootFound: root.value !== null, sessionLost });
}
