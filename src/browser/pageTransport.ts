/**
 * The contract between a page walk and whatever drives a browser for it — and nothing else.
 *
 * ## Why this is an interface rather than an implementation
 *
 * The walk, the reduction, the artifact writing and every one of their tests are written against this type,
 * so all of them exist and are provable before a browser is involved. The implementation behind it is
 * Playwright attached to the owner's own already-running Chrome through the Playwright Extension's CDP
 * relay: `playwright-core`'s extension mode resolves the DEFAULT user-data directory and refuses with an
 * install URL rather than falling back to a fresh profile, which is the opposite of the dedicated-profile
 * lanes this repository retired. A test supplies a deterministic fake instead, so the walk's behaviour on a
 * redirect, a 404, a lost session and a missing screenshot is settled by unit tests rather than by luck in
 * a live run.
 *
 * ## What an implementation must guarantee, and what it must never expose
 *
 * The guarantees are here as prose because no type can carry them, and they are the reason the seam is
 * narrow: an implementation attaches to the owner's real signed-in session and never launches a browser,
 * never supplies a user-data directory, never opens a second or debug profile, and never closes the owner's Chrome.
 * It also LAUNCHES nothing bare: the connect page it opens is opened through the profile pin, so it lands in
 * the recorded work profile rather than whichever profile Chrome was last used in
 * (`src/browser/profilePin.ts`).
 * It performs no click, no form submission and no request replay — the walk NAVIGATES and observes, so the
 * console's own subrequests are passive observations rather than actions taken on the owner's behalf.
 *
 * The one widening since: {@link PageCapture.links}, the page's own same-origin hrefs. It is still an
 * observation of what the page RENDERED rather than a capability — nothing here clicks a link, and the walk
 * decides for itself which of them are in its scope. See the field's own comment for the measurement that
 * made it necessary.
 *
 * It also never surfaces a credential. The Falcon console holds a bearer in memory from its own
 * `/api2/auth/verify`, and that token would reach data the scoped API client cannot. Lifting it is not a
 * capability this atlas wants: {@link CapturedResponse} carries no headers, no cookies and no storage, and
 * a body is reduced to field NAMES before it is stored — see `harReduction.ts`.
 *
 * ## The evidence capture beside this seam widens it by exactly one target's observation
 *
 * `evidenceCapture.ts` is a SEPARATE interface over the same relay plumbing, the shape `vantaPolicyEditor.ts`
 * took: nothing here changed, no atlas walk gained a capability, and a walk still cannot read a page's
 * content. What that seam adds is bounded and stated: for one closed, source-owned target
 * (`evidenceAdapters/`) it reads element rectangles, a results summary's two counts, a chart's canvas alpha
 * samples, the smallest computed font size, the query editor's text and the time picker's value — the last
 * two capped at 300 characters, both of which a caption has to carry for a reader to check the claim. No
 * body text, no attribute dump, no cookies, no storage, no request replay, and no selector a caller can
 * supply. `visualEvidence/observation.ts` is the whole of what crosses.
 *
 * ## Every byte in a capture is on the walk's OWN origins, or there is no capture
 *
 * The implementation holds a relay lease (`browser/relayLease.ts`) naming the origins its walk may touch,
 * and that binding is what makes {@link PageCapture} safe to file under a platform. A visit to an address
 * off those origins is refused before anything runs; a page that SETTLES off them returns
 * {@link BrowserTransportErrors.offLeaseOrigin} rather than a capture; and a first-party filter drops any
 * response whose own URL is off them. So the invariant a consumer may rely on is total: `finalUrl` and
 * every {@link CapturedResponse.url} in a capture are on the lease's origins. It is stated here because it
 * is a property of the SEAM rather than of one implementation — a fake that returns a foreign `finalUrl`
 * beside a capture is not a valid transport.
 *
 * ## Capture accounting is part of the contract, not a detail
 *
 * {@link PageCapture.responseAccounting} exists because a lost response body is otherwise invisible: the
 * page still has its screenshot, its status and its title, so a walk that silently dropped two of twelve
 * captures looks identical to one that kept them all. The Slack walk's own response handler is
 * fire-and-forget and admits in a comment that reductions losing the race are simply not recorded. A count
 * of what was seen against what was kept is what makes that failure assertable instead of invisible.
 */
import type { Result } from "../lib/result.js";

/** One first-party call the console made while a page rendered, with its body already parsed. */
export interface CapturedResponse {
  readonly method: string;
  readonly url: string;
  readonly statusCode: number;
  /**
   * The response body. Parsed for a JSON response; a raw STRING for a `text/x-script` turbo-stream, which
   * is what a React Router application answers its own data requests with — the snippet that captures it
   * has no decoder, so decoding is the walk's own job (`atlas/nxCloud/dataRoute.ts`). Reduced to field names
   * before storage either way; never persisted as values.
   */
  readonly body: unknown;
  /**
   * The REQUEST body the client sent, as a string, when it sent one. Absent for a GET, and absent when the
   * body was larger than the transport's own cap.
   *
   * Added for the GraphQL case and it is the reason it exists: a response's own keys are the document's
   * ALIASES, so a caller that compares them to a schema's field names manufactures disagreements. Only the
   * request document says which fields were actually selected. A consumer must take the DOCUMENT out of
   * this and never the variables — a variables object is user data, and no atlas stores one.
   */
  readonly requestBody?: string;
}

/**
 * What a walk saw against what it kept, so incompleteness is a number rather than a silence.
 *
 * `eligible` counts first-party responses the walk wanted; `bodyFailed` counts those whose body could not
 * be read, typically because navigation disposed it first. A page with any `bodyFailed` cannot be reported
 * as a complete observation of what the console asked for.
 */
export interface ResponseAccounting {
  /** Every response the page made, JSON or not. */
  readonly seen: number;
  /** The JSON ones — the bodies this capture wanted. Always `bodySucceeded + bodyFailed`. */
  readonly eligible: number;
  readonly bodySucceeded: number;
  /** Wanted but not obtained: refused by the per-page cap, over the byte cap, or unreadable. */
  readonly bodyFailed: number;
}

/** Everything one visited console page yields. */
export interface PageCapture {
  readonly requestedUrl: string;
  /** Where the browser actually settled. Differing from `requestedUrl` is a redirect, and a gap. */
  readonly finalUrl: string;
  readonly statusCode: number | null;
  readonly title: string;
  readonly observedAt: string;
  /** PNG bytes for this page, or `null` when the page was reached but could not be photographed. */
  readonly screenshotPng: Uint8Array | null;
  /**
   * Why {@link PageCapture.screenshotPng} is `null`, or `null` when there is a picture — never both `null`
   * with a picture missing.
   *
   * The exact companion to {@link PageCapture.linksBlockedBecause}, and here because the sibling silence
   * that field's comment names was real and cost a whole finding: a capture that failed came back as a
   * `null` PNG and nothing else, so every walking atlas recorded "the browser returned no screenshot for
   * it" without ever knowing that Chrome had timed out, let alone why. The reason is not a nicety on a gap
   * row — it is the difference between a defect somebody can reproduce and one that gets attributed to
   * whichever pull request happened to land that morning.
   *
   * A transport that photographed nothing because it was ASKED not to leaves this `null` too: a page whose
   * atlas refused the picture is not a page whose capture failed, and the walk already carries that
   * refusal's own reason.
   */
  readonly screenshotBlockedBecause: string | null;
  readonly responses: readonly CapturedResponse[];
  readonly responseAccounting: ResponseAccounting;
  /**
   * Same-origin hrefs the page itself rendered — the page's own NAVIGATION, absolute and de-duplicated.
   *
   * Here because a platform that publishes no sitemap still declares its admin surface somewhere, and for
   * GitHub that somewhere is the settings sidebar it renders into HTML. MEASURED against
   * `https://github.com/settings/profile` and `/settings/security` through this transport: each page
   * emitted 10-11 first-party JSON responses and NOT ONE of them was a navigation document, so a walk
   * restricted to {@link CapturedResponse} has no denominator to be judged against at all. Falcon hands
   * `/content/sitemap-v2/index.json` to `readSitemap` and needs none of this; GitHub has no equivalent.
   *
   * It is a LINK LIST and deliberately nothing more — no text, no attributes, no DOM. A walk that could
   * read a page's content through this seam would be reading message previews and member names out of
   * whatever else the page rendered, which is the boundary the Slack surface map already had to draw, per page, in `atlas/slackApi/surfacePages.ts`.
   */
  readonly links: readonly string[];
  /**
   * Why {@link PageCapture.links} is empty, or `null` when the page genuinely rendered none.
   *
   * An empty link list is otherwise a SILENCE, and a walk whose denominator is the page's own navigation
   * cannot afford one: "this page has no admin links" and "the link read threw" produce the same empty
   * array and completely different conclusions about coverage. The screenshot half of the same failure —
   * an unwritten PNG that could not say why — stood once and is now
   * {@link PageCapture.screenshotBlockedBecause}.
   */
  readonly linksBlockedBecause: string | null;
}

/** Why a visit could not be made or completed. */
export type BrowserTransportError =
  | { readonly code: "TRANSPORT_UNAVAILABLE"; readonly message: string }
  | { readonly code: "SESSION_LOST"; readonly message: string }
  | {
      readonly code: "NAVIGATION_FAILED";
      readonly message: string;
      readonly url: string;
      /**
       * Why this page is not held, in words a RECORD may carry — no address, no quoted foreign message.
       *
       * The companion to {@link BrowserTransportError.message} and the half that is safe to print.
       * `message` interpolates the URL, so every consumer drops it and prints a sentence of its own instead;
       * MEASURED over six Vanta walks (page `vanta-walk-120s-client-hang`), that left a
       * 45-second page timeout and a two-minute client kill printing the identical sentence, and four runs
       * of evidence could not separate three mechanisms because of it. This field is REQUIRED rather than
       * optional for exactly that reason: every producer of this failure has to say which one it is, and
       * `browser/clientKill.ts` is what composes the client half of it.
       */
      readonly because: string;
    }
  | { readonly code: "OFF_LEASE_ORIGIN"; readonly message: string; readonly url: string };

/**
 * The `because` every failure whose SNIPPET ran and reported its own trouble carries.
 *
 * One literal rather than one per caller, because the distinction it draws is the one the finding turned on
 * and it is the same on every platform: this page's snippet reached the owner's browser and ran, and the failure is
 * the page's own — against `browser/clientKill.ts`'s sentences, where the client never got that far. A caller
 * with something more specific to say may of course say it; what none of them may do is quote the snippet's
 * raw failure, which is a Playwright error with the URL interpolated into it.
 */
export const SNIPPET_REPORTED_FAILURE_BECAUSE =
  "the page snippet ran in the browser and reported its own failure, so the page was addressed but did not " +
  "give the walk what it asked for";

/**
 * Typed failures for the console transport, constructed only through here.
 *
 * **The messages name no platform.** This transport is shared by every atlas that walks a browser, so a
 * message that named one would be wrong for all the others: `sessionLost` used to read "the Falcon console
 * session is no longer valid", which a Vanta, JumpCloud or GitHub walk printed verbatim while its own
 * provider was fine — and a reader chased the wrong console. The provider belongs in the `reason` its
 * CALLER supplies, which is the only place that knows one.
 */
export const BrowserTransportErrors = {
  navigationFailed: ({
    url,
    reason,
    because,
  }: {
    url: string;
    reason: string;
    because: string;
  }): BrowserTransportError => ({
    because,
    code: "NAVIGATION_FAILED",
    message: `could not navigate to ${url}: ${reason}`,
    url,
  }),
  sessionLost: ({ reason }: { reason: string }): BrowserTransportError => ({
    code: "SESSION_LOST",
    message: `the browser session driving this walk is no longer usable: ${reason}`,
  }),
  /**
   * The walk asked for, or landed on, an address outside the origins its relay lease binds it to.
   *
   * One code for both halves on purpose: they are the same fact about the same walk, and a reader who has
   * to distinguish them has the `reason` for it. MEASURED — see `browser/relayLease.ts` — a
   * Notion walk's pages settled on `linear.app` and it kept 143 response bodies from there, filed under
   * Notion. Neither half of that can now produce a {@link PageCapture} at all.
   */
  offLeaseOrigin: ({ url, reason }: { url: string; reason: string }): BrowserTransportError => ({
    code: "OFF_LEASE_ORIGIN",
    message: `${url} is outside the origins this walk's relay lease binds it to: ${reason}`,
    url,
  }),
  unavailable: ({ reason }: { reason: string }): BrowserTransportError => ({
    code: "TRANSPORT_UNAVAILABLE",
    message: `no browser transport is attached: ${reason}`,
  }),
} as const;

/**
 * The one seam a page walk drives.
 *
 * Deliberately two methods. Anything wider — an "evaluate this script" or a "fetch this URL" escape hatch —
 * would let a caller reach past the closed inventory, which is the property `inventory.ts` exists to hold.
 */
export interface BrowserPageTransport {
  /**
   * Visit one console page and return everything observed while it settled.
   *
   * @param url the absolute console URL to visit
   * @param settleMs how long to keep observing after load before returning
   * @returns the capture, or why the visit failed
   */
  visit({
    url,
    settleMs,
    photograph,
  }: {
    url: string;
    settleMs: number;
    /**
     * Whether to ask the page for a screenshot at all. Omitted means yes.
     *
     * Here because a picture that must never be KEPT must never be TAKEN, and those are different moments.
     * MEASURED by a Codex review over three passes: the Playwright implementation writes the
     * PNG to a file inside the visit itself, so every guard a caller applies afterwards is guarding a file
     * that already exists. On an atlas whose whole scoping is that a page rendering identifiable colleagues is
     * never photographed, twenty-seven of its forty-seven declared pages were reaching disk before anything
     * could refuse them.
     *
     * A caller that knows BEFORE the visit that a page may not be photographed passes `false`, and no
     * bytes are produced at any point. A caller that can only know afterwards — a permitted route the
     * client silently redirects to a withheld one — still relies on the refusal-and-delete path, and its
     * descriptor states that residue rather than claiming it away.
     */
    photograph?: boolean;
  }): Promise<Result<PageCapture, BrowserTransportError>>;

  /**
   * Close the tab this transport opened, let go of the browser, and release its own scratch — WITHOUT
   * closing the owner's browser.
   *
   * Closing the tab is part of the contract rather than an implementation detail, because the tab is
   * visible to the owner: a walk that finishes and leaves its last page sitting in the owner's window is litter to
   * clear by hand, and the owner wants none left. An implementation that cannot close a tab still returns
   * `ok` — a release runs on the way out, often after something else already failed, and turning that into a
   * second failure hides the first.
   *
   * @returns nothing on success, or why release failed
   */
  release(): Promise<Result<null, BrowserTransportError>>;
}

/**
 * Whether a capture accounted for every body it wanted.
 *
 * Both halves are load-bearing, and the second was once missing. `bodyFailed === 0` says nothing went
 * wrong; `bodySucceeded + bodyFailed === eligible` says nothing went MISSING — a body that was counted
 * eligible and then neither read nor failed is a body whose read never finished, which is exactly what a
 * fire-and-forget response handler produces. Judging on the first alone reported a page completely captured
 * while its reads were still in flight.
 *
 * @param capture the page capture to judge
 * @returns whether every eligible response body was both attempted and accounted for
 */
export function isCaptureComplete({ capture }: { capture: PageCapture }): boolean {
  const { bodyFailed, bodySucceeded, eligible } = capture.responseAccounting;
  return bodyFailed === 0 && bodySucceeded + bodyFailed === eligible;
}

/**
 * Whether a page settled somewhere other than where it was asked to go.
 *
 * A redirect is a completed attempt against a real declaration and becomes a recorded gap — never a walk
 * failure, and never a page silently credited to the destination it landed on.
 *
 * @param capture the page capture to judge
 * @returns whether the browser settled on a different URL
 */
export function isRedirected({ capture }: { capture: PageCapture }): boolean {
  return capture.finalUrl !== capture.requestedUrl;
}

/**
 * Whether a failed visit ends the whole walk rather than costing one page.
 *
 * The distinction is the same one every walk already drew for itself, in six verbatim copies of
 * `code === "SESSION_LOST" || code === "TRANSPORT_UNAVAILABLE"`: a navigation that failed is one declared
 * page's own recorded outcome, while a lost session or a detached transport means every page after it would
 * be attempted against nothing. It moved here when the read-after-screenshot retry needed the same
 * judgement — a retry that trips over a dead session must surface that, and one that trips over a single bad
 * address must not throw away the capture it already has.
 *
 * @param error the transport failure to judge
 * @returns whether the walk must stop rather than record this page and continue
 */
export function isWalkStoppingError({ error }: { error: BrowserTransportError }): boolean {
  return error.code === "SESSION_LOST" || error.code === "TRANSPORT_UNAVAILABLE" || error.code === "OFF_LEASE_ORIGIN";
}
