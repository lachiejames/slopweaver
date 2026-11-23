/**
 * The effectful shell of one governed browser interaction: read the live page, judge it, dispatch, and
 * photograph what happened.
 *
 * ## The rail binds HERE, and nowhere a caller can get past
 *
 * A verb that can click is a write capability, so the read-only rule cannot live in a hook that watches MCP
 * tools — there is no MCP tool any more. It lives in this function, between reading the browser and telling
 * it to act, and it is asked about the URL {@link currentPage} just read off the live session rather than
 * about the `--url` a caller typed. That distinction is the whole of it: a decision taken about a page the
 * browser is not on is not a decision at all, and an allow on Datadog must never authorise a target that has
 * since become JumpCloud.
 *
 * **The proof boundary, stated rather than discovered — and what is done about it.** The read and the
 * dispatch are two commands, so a page can move between them: the owner's own click, a redirect, a timer. Three
 * things narrow that window and none of them closes it, so all three are named rather than one being sold as
 * a fence.
 *
 * 1. **Nothing slow sits inside the window.** Every preparation happens before the admission and the
 *    admission is the last step before dispatch — the ordering a Codex review pass falsified this file on
 *    when a `--download-dir` on a slow mount took two seconds between the two.
 * 2. **A replaced DOCUMENT fails closed — in the client only until it re-issues the number, and here after
 *    that.** MEASURED: a ref from a superseded snapshot answers `Ref f1e11 not found in the current
 *    page snapshot`, before any element is touched. But the new document numbers its refs from one again
 *    (`./refIdentity.ts` carries the measurement), so once it has reached that number the same ref names
 *    ANOTHER element and the client acts on it. {@link judgeAgainstLivePage} therefore compares what each aimed
 *    ref names in the cited read and in the admission's own read, and refuses a ref whose role or name differ
 *    ({@link ./actionErrors.RefNamesAnotherElementError}) — nothing is dispatched.
 * 3. **A same-document route change is NOT fenced, and is PARTLY detected.** A page timer changing
 *    `location.hash` moves the page without replacing the document, so the ref stays valid and the client
 *    acts — nothing outside the browser can prevent that. {@link landedSomewhereUnjudged} checks where the
 *    action FINISHED and answers {@link ./actionErrors.PageMovedUnderActionError} when it finished somewhere
 *    that refuses writes; the write has happened by then, so what the caller gets is a loud account of it
 *    rather than silence.
 *
 *    **What that check cannot see, stated because a partial detector sold as a whole one is worse than
 *    none** — MEASURED as a counterexample by a Codex review pass: a page that routes away,
 *    acts, and routes BACK inside one click ends on the admitted URL, so the after-check finds nothing
 *    wrong and the receipt reads clean. Detecting that needs the URL at the instant of the click, which is
 *    inside the browser and out of reach of every process here. It is the residue of driving a page through
 *    a CLI rather than from inside it, it is not closable from this side, and a page adversarial enough to
 *    do it is a page to take off the browser lane entirely rather than to guard harder.
 *
 * ## The AIM is a second rail, and it is judged first
 *
 * Everything above is about the page the browser is on. `./aim.ts` is about what the interaction points at,
 * which is the half a Slack incident was made of — a click that missed the search field, then a
 * blind `type` and a `Return` that posted. {@link judgeTheAim} runs both of its checks as PREPARATIONS, for
 * the ordering reason above: a raw `--target` selector is refused before any client starts, and a keystroke
 * is refused unless the page itself confirms the cursor is in the element the caller named.
 *
 * ## And the aim is SHOWN — scrolled into the viewport, marked there, photographed, then acted on
 *
 * {@link photographTheAim} is the third preparation, after the two cheap ones, and `./aimShot.ts` is the
 * whole of what it decides. Read that file's header before quoting what it closes: on its own, nothing — it
 * makes a wrong aim reconstructable rather than impossible, and the one thing it does buy outright is that
 * the scroll and the highlight both resolve the ref before the interaction rather than during it.
 *
 * ## Every action photographs its own result, and the picture is the VIEWPORT
 *
 * A single command takes an action and then a screenshot, showing you the result or some evidence of what
 * the action did, and the owner sees the result instantly: the picture is responsive. So
 * one command is one interaction plus its evidence — the page before, the page after, and a picture of the
 * SCREEN after, never a whole-page stitch. When the action runs and the photograph does not, that is
 * {@link ./actionErrors.ActionAppliedEvidenceFailedError} — an arm that exists so the caller cannot read a
 * missing picture as a failed click and try again.
 */
import { randomUUID } from "node:crypto";
import { resolveBrowserPagePolicy } from "../admit/browserPagePolicy.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  admitBrowserAction,
  type BrowserActionKind,
  type BrowserAdmission,
  type BrowserPageWaiver,
  judgeWhereItLanded,
} from "./action.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import { type BrowserActionRequest, clientArgsFor } from "./actionRequest.js";
import {
  actionNeedsFocusAssertion,
  aimProblems,
  FOCUS_PROBE_SOURCE,
  type FocusProbe,
  focusVerdict,
  parseFocusProbe,
} from "./aim.js";
import {
  type AimShotResult,
  actionTakesAimShot,
  aimShotRef,
  framingProblem,
  framingRefusalDetail,
  planAimShot,
} from "./aimShot.js";
import { photographTheAim } from "./aimShotRun.js";
import type { DownloadFile, DownloadSelection } from "./download.js";
import { listDownloadDir, resolveDownload } from "./downloadRun.js";
import type { FullscreenGuardObservation, FullscreenGuardPreparation } from "./fullscreenGuard.js";
import { observeFullscreenGuard, prepareFullscreenGuard } from "./fullscreenGuardRun.js";
import { sessionObservationIsCurrent } from "./interactionSession.js";
import { settlePage } from "./pageSettleRun.js";
import { citedElements, refuseARenamedRef } from "./refIdentityRun.js";
import { runClientCommand, type TerminalClientDeps, type TerminalReply } from "./terminalClient.js";
import { captureScreenshot } from "./viewportCapture.js";

/* The request is declared in `./actionRequest.ts`; the verb that hands one to the executor names it from here. */
export type { BrowserActionRequest } from "./actionRequest.js";

/** What one interaction actually did, and what proves it. */
export interface BrowserActionReceipt {
  readonly actionId: string;
  readonly kind: BrowserActionKind;
  readonly admission: BrowserAdmission;
  /** The page before the action. */
  readonly beforeUrl: string;
  /** The page after it. */
  readonly afterUrl: string;
  readonly afterTitle: string | null;
  /** The after-picture: the viewport once the action has run. */
  readonly screenshotPath: string;
  /** The before-pictures, what was marked and where the page was framed — `null` when this kind takes none. */
  readonly aimShot: AimShotResult | null;
  /** The snapshot the client wrote after the action, so the next decision has refs. */
  readonly snapshotPath: string | null;
  /** Set when the page is holding a modal open after the action. */
  readonly modalState: string | null;
  /** What a download produced, when this was one. */
  readonly download: DownloadSelection | null;
  /** Where a downloaded file was copied to, when this was a download. */
  readonly downloadPath: string | null;
  /** What the background full-screen guard saw (`./fullscreenGuard.ts`), or `null` when none was armed or read. */
  readonly fullscreenGuard: FullscreenGuardObservation | null;
}

/**
 * Read the page the session is actually on.
 *
 * A `snapshot` rather than anything cheaper, because the answer has to be the page AND the elements on it:
 * the refs this returns are what the next action aims by, and they are what fails closed if the document is
 * replaced before it is used.
 *
 * @param deps the client and the session it runs under
 * @returns the live page, or the typed failure
 * @internal — the executor's own first step; a caller reads a page through `browser read`.
 */
export function currentPage({ deps }: { deps: TerminalClientDeps }): Result<TerminalReply, BrowserActionError> {
  return runClientCommand({ args: ["snapshot"], deps });
}

/**
 * Run one governed interaction end to end: judge the live page, dispatch, photograph the result.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver the operator took for this exact page, when there is one
 * @param now the clock, READ at each judgement rather than frozen once — MEASURED by a Codex review pass:
 *   an upload that started a second before its waiver lapsed judged its SECOND half against the
 *   instant its first half began, and delivered bytes under a waiver that had already expired. A waiver's
 *   deadline is only a deadline if it is compared to the time the write actually happens.
 * @param sleep how a download watch waits, injected so a test never really waits
 * @returns the receipt, or the typed failure
 */
export function executeBrowserAction({
  request,
  deps,
  waiver,
  now,
  sleep,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  waiver: BrowserPageWaiver | undefined;
  now: () => string;
  sleep: (ms: number) => void;
}): Result<BrowserActionReceipt, BrowserActionError> {
  const prepared = prepareTheAction({ deps, request, waiver });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const { aimShot, args, baseline, fullscreen } = prepared.value;
  const actionId = randomUUID();
  const judgement = judgeAgainstLivePage({ deps, now, request, waiver });
  if (judgement.isErr()) {
    return err(judgement.error);
  }
  const { admission, beforeUrl } = judgement.value;
  const dispatched = dispatch({ args, deps, now, request, uploadActionId: actionId, waiver });
  if (dispatched.isErr()) {
    return err(dispatched.error);
  }
  // Past this line the page HAS been acted on, so every remaining failure is an evidence failure rather than
  // an action failure — the distinction a caller must never collapse, because one is retryable and the other
  // is a thing that already happened.
  const fullscreenGuard = observeFullscreenGuard({ deps, preparation: fullscreen });
  const download = resolveDownload({ baseline, request, sleep });
  if (download.isErr()) {
    return err(download.error);
  }
  return gatherEvidence({
    actionId,
    admission,
    aimShot,
    beforeUrl,
    deps,
    download: download.value,
    fullscreenGuard,
    request,
    sleep,
    waiver,
  });
}

/**
 * Everything that happens BEFORE the admission — and the fact that it is everything is the correctness rule.
 *
 * MEASURED by a Codex review pass: with the baseline directory listing sitting BETWEEN the
 * admission and the dispatch, a `--download-dir` on a slow mount took two seconds to read, and a waiver that
 * was live when the check ran had expired by the time the click went out. Anything slow that sits after the
 * check silently widens the window the check exists to close, so nothing may — which is why these are one
 * named step rather than lines a later edit could reorder past the judgement.
 *
 * Their own order is a cost decision. {@link judgeTheAim}'s selector refusal costs no browser round trip at
 * all, so it runs before {@link aimShotFor} spends three photographing an aim a parse-time check rejects. The
 * background full-screen guard (`./fullscreenGuardRun.ts`) is armed last, once nothing else can refuse.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver for this exact page, when there is one
 * @returns the aim shot, the client argv, the download baseline and the full-screen guard, or the first typed
 *   refusal — in every case the page has not been acted on
 */
function prepareTheAction({
  request,
  deps,
  waiver,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  waiver: BrowserPageWaiver | undefined;
}): Result<
  {
    readonly aimShot: AimShotResult | null;
    readonly args: readonly string[];
    readonly baseline: readonly DownloadFile[];
    readonly fullscreen: FullscreenGuardPreparation;
  },
  BrowserActionError
> {
  const aimed = judgeTheAim({ deps, request });
  if (aimed.isErr()) {
    return err(aimed.error);
  }
  const aimShot = aimShotFor({ deps, request, waiver });
  if (aimShot.isErr()) {
    return err(aimShot.error);
  }
  const args = clientArgsFor({ request });
  if (args.isErr()) {
    return err(args.error);
  }
  let baseline: readonly DownloadFile[] = [];
  if (request.kind === "download" && request.downloadDir !== undefined) {
    baseline = listDownloadDir({ directory: request.downloadDir });
  }
  const fullscreen = prepareFullscreenGuard({ deps, kind: request.kind });
  return ok({ aimShot: aimShot.value, args: args.value, baseline, fullscreen });
}

/**
 * Take this interaction's aim shot, when its kind gets one.
 *
 * The kind decision and the ref decision are `./aimShot.ts`'s; this is the two-line bridge between them and
 * the browser, kept apart from {@link photographTheAim} so the standalone `browser aim` verb — which already
 * knows both — does not have to invent a request to get at it.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver for this exact page, when there is one
 * @returns the picture, `null` when this kind takes none, or the typed failure
 */
function aimShotFor({
  request,
  deps,
  waiver,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  waiver: BrowserPageWaiver | undefined;
}): Result<AimShotResult | null, BrowserActionError> {
  if (!actionTakesAimShot({ kind: request.kind })) {
    return ok(null);
  }
  const shot = photographTheAim({
    deps,
    // The rail, asked again about whatever page the browser turns out to be on. A waiver names one exact
    // page, so it is compared here rather than re-resolved.
    mayFocusOn: (url) => resolveBrowserPagePolicy({ url }).policy !== "refuse-every-write" || waiver?.url === url,
    plan: planAimShot({
      fullPage: request.fullPage,
      mark: request.aimMark,
      ref: aimShotRef({ expectFocus: request.expectFocus, kind: request.kind, target: request.target }),
      stem: request.aimShotStem,
    }),
  });
  if (shot.isErr()) {
    return err(shot.error);
  }
  return refuseAnUnframedTarget({ shot: shot.value });
}

/**
 * Refuse an interaction whose own pictures do not show what it is about to touch.
 *
 * A hard fail with an escape hatch under certain conditions, where good judgement can override. `./aimShot.ts` decides the condition and
 * writes the clause; this renders the four lines the hatch registry owns and hands the judgement back, which
 * is the fourth line of every refusal in this repository.
 *
 * It runs BEFORE the dispatch and before the admission, so a refusal here costs a scroll and two pictures
 * and nothing else — the page is not acted on.
 *
 * @param shot the pictures that were taken and what the page said while they were
 * @returns the shot when it framed its target, or the typed refusal
 */
function refuseAnUnframedTarget({ shot }: { shot: AimShotResult }): Result<AimShotResult, BrowserActionError> {
  // Read into a local HERE rather than taken as a parameter with a default, which is the `hatch-release`
  // rule: a default initialiser is skipped the moment a caller passes anything, so a hatch written as one
  // silently releases nobody.
  const allowOffscreen = process.env["SLOPWEAVER_ALLOW_BROWSER_OFFSCREEN_TARGET"] === "1";
  const because = framingProblem({ result: shot });
  const ref = shot.plan.ref;
  if (allowOffscreen || because === null || ref === null) {
    return ok(shot);
  }
  return err(
    BrowserActionErrors.targetNotFramed({
      because,
      ref,
      refusal: hatchRefusal({
        detail: framingRefusalDetail({ because, ref, scroll: shot.scroll }),
        hatch: hatchFor({ id: "browser-offscreen-target" }),
      }),
    }),
  );
}

/**
 * Judge WHAT this interaction is pointing at, before anything is pointed at it.
 *
 * The read-only rail judges where the browser IS; this judges the aim, which is the half a Slack
 * incident was entirely made of. Two decisions, in the order that costs least: a raw selector is refused
 * before a client is ever started, and only then is the page asked where the cursor is — a round trip worth
 * taking only once the cheap refusal has passed.
 *
 * **Where it sits in the sequence is a correctness rule.** This is a PREPARATION, so it runs before
 * {@link judgeAgainstLivePage} rather than between that admission and the dispatch: this file's own measured
 * ordering rule says nothing slow may sit in that window, and a whole client round trip is slower than the
 * download listing that rule was written about. The cost, stated rather than hidden, is that the admission's
 * own page read sits between the focus answer and the keystroke — the same non-atomicity this file already
 * states for the page, narrowed the same way and closed no better. The after-picture is what shows where the
 * characters actually went.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @returns nothing when the aim is sound, or the typed refusal — in either case the page is untouched
 */
function judgeTheAim({
  request,
  deps,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
}): Result<null, BrowserActionError> {
  // Both hatches are read into locals HERE rather than taken as parameters with a default, which is the
  // `hatch-release` rule: a caller may only ever ADD to a hatch, and a default initialiser is skipped the
  // moment a caller passes anything, so a hatch written as one silently releases nobody.
  const allowSelector = process.env["SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR"] === "1";
  const allowBlind = process.env["SLOPWEAVER_ALLOW_BLIND_KEYSTROKE"] === "1";
  const aimed = aimProblems({ allowSelector, request });
  if (aimed.isErr()) {
    return err(aimed.error);
  }
  const focus = probeFocus({ allowBlind, deps, request });
  if (focus.isErr()) {
    return err(focus.error);
  }
  return focusVerdict({ allowBlind, expectFocus: request.expectFocus, kind: request.kind, probe: focus.value });
}

/**
 * Ask the page where the cursor is, when this interaction is a keystroke that needs to know.
 *
 * The one place the client's `eval` command is used, and its shape is what keeps it out of the
 * arbitrary-JavaScript hole `skills/browser/reference/interactions.md` names: the function is
 * {@link ./aim.FOCUS_PROBE_SOURCE}, a constant authored in this repository, and the element it asks about
 * travels as the client's own separate target argv value exactly as it does for a click. No caller data
 * becomes source.
 *
 * `mayAct` is deliberately left at its reading default: the probe reads two elements and returns a
 * description of them, so a client that dies mid-probe has not touched the page and must not be reported as
 * though it might have.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param allowBlind whether the operator opened the blind-keystroke hatch, in which case nothing is asked
 * @returns what the page said, `null` when no probe was called for, or the typed failure
 */
function probeFocus({
  request,
  deps,
  allowBlind,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  allowBlind: boolean;
}): Result<FocusProbe | null, BrowserActionError> {
  const ref = request.expectFocus;
  if (allowBlind || !actionNeedsFocusAssertion({ kind: request.kind }) || ref === undefined || ref.length === 0) {
    return ok(null);
  }
  const reply = runClientCommand({ args: ["eval", FOCUS_PROBE_SOURCE, ref], deps });
  if (reply.isErr()) {
    return err(reply.error);
  }
  return parseFocusProbe({ kind: request.kind, stdout: reply.value.stdout });
}

/**
 * Photograph what the action did, read the page it left behind, and build the receipt.
 *
 * Every failure from here on is an EVIDENCE failure rather than an action failure: the page has been acted
 * on, so the caller's correction is to read rather than to retry, and the arms this returns all say so.
 *
 * @param actionId the action's own id, so an evidence failure can name it
 * @param admission what was judged, and the page it was judged against
 * @param aimShot the before-pictures already taken, carried through so the receipt holds the whole sequence
 * @param beforeUrl the page the action started on
 * @param download what a download produced, when this was one
 * @param fullscreenGuard what the background full-screen guard read back after the dispatch
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver in play, when there is one
 * @param sleep how the settle before the after-picture waits, injected with the action's own clock
 * @returns the receipt, or the typed evidence failure
 */
function gatherEvidence({
  actionId,
  admission,
  aimShot,
  beforeUrl,
  download,
  fullscreenGuard,
  request,
  deps,
  waiver,
  sleep,
}: {
  actionId: string;
  admission: BrowserAdmission;
  aimShot: AimShotResult | null;
  beforeUrl: string;
  download: DownloadSelection | null;
  fullscreenGuard: FullscreenGuardObservation | null;
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  waiver: BrowserPageWaiver | undefined;
  sleep: (ms: number) => void;
}): Result<BrowserActionReceipt, BrowserActionError> {
  const after = photographTheResult({ actionId, deps, path: request.screenshotPath, sleep });
  if (after.isErr()) {
    return err(after.error);
  }
  const settled = currentPage({ deps });
  if (settled.isErr()) {
    return err(BrowserActionErrors.actionAppliedEvidenceFailed({ actionId, detail: settled.error.message }));
  }
  const settledUrl = settled.value.pageUrl;
  const crossed = judgeWhereItLanded({ actionId, admission, settledUrl, waiver });
  if (crossed !== null) {
    return err(crossed);
  }
  const downloadOut = request.downloadOut;
  // A reply that named no page leaves the receipt reporting the page the action started on — the only page
  // anything here observed — rather than inventing one.
  let afterUrl = beforeUrl;
  if (settledUrl !== null) {
    afterUrl = settledUrl;
  }
  return ok({
    actionId,
    admission,
    afterTitle: settled.value.pageTitle,
    afterUrl,
    aimShot,
    beforeUrl,
    download,
    downloadPath: download === null || downloadOut === undefined ? null : downloadOut,
    fullscreenGuard,
    kind: request.kind,
    modalState: settled.value.modalState,
    screenshotPath: request.screenshotPath,
    snapshotPath: settled.value.snapshotPath,
  });
}

/**
 * Photograph what the action left on the screen.
 *
 * **The VIEWPORT, never the whole page.** The owner sees the result of every action
 * instantly — what a person sees after a click is the screen in front of them. A whole-page stitch is
 * both unreadable on a tall page and taken over enough time to photograph a page mid-render
 * (`src/visualEvidence/observation.ts` carries that measurement). `--full-page` adds
 * a whole-page picture to the AIM shot, where *where is this element in the document* is the question; it
 * deliberately does not replace this one.
 *
 * Its failure is an EVIDENCE failure, because the action has already happened by the time it runs — a caller
 * told "the screenshot failed" must not read that as "the click did not land".
 *
 * @param path where the picture goes
 * @param actionId the action's own id, so an evidence failure can name it
 * @param deps the client and the session it runs under
 * @returns nothing when the picture was taken, or the typed evidence failure
 */
function photographTheResult({
  path,
  actionId,
  deps,
  sleep,
}: {
  path: string;
  actionId: string;
  deps: TerminalClientDeps;
  sleep: (ms: number) => void;
}): Result<null, BrowserActionError> {
  // The action may have navigated or re-rendered, so the page is given a bounded chance to finish drawing
  // before it is photographed — otherwise "I see the result of my action" is a picture of a spinner.
  // `./pageSettle.ts` carries the measurement (a blank Datadog console) and the budget.
  settlePage({ deps, sleep });
  return captureScreenshot({ args: ["screenshot", `--filename=${path}`], deps })
    .map(() => null)
    .mapErr((error) => BrowserActionErrors.actionAppliedEvidenceFailed({ actionId, detail: error.message }));
}

/**
 * Read the live page, check the caller's observation against it — its URL, and what each aimed ref names —
 * and judge the interaction.
 *
 * The steps that must happen in this order and against THIS page, split out so
 * {@link executeBrowserAction} reads as judge, dispatch, photograph rather than as one wall.
 *
 * @param request what the interaction was asked to do
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver for this exact page, when there is one
 * @param now the clock, read HERE rather than passed as an instant, so a judgement taken after a page read
 *   is judged against the time that read finished — not the time the command began
 * @returns the admission and the page it was judged against, or the typed refusal
 */
function judgeAgainstLivePage({
  request,
  deps,
  waiver,
  now,
}: {
  request: BrowserActionRequest;
  deps: TerminalClientDeps;
  waiver: BrowserPageWaiver | undefined;
  now: () => string;
}): Result<{ readonly admission: BrowserAdmission; readonly beforeUrl: string }, BrowserActionError> {
  // The cited look is read back BEFORE the page is, so its file read costs the window nothing.
  const observed = citedElements({ observation: request.observation });
  if (observed.isErr()) {
    return err(observed.error);
  }
  const before = currentPage({ deps });
  if (before.isErr()) {
    return err(before.error);
  }
  const beforeUrl = before.value.pageUrl;
  if (beforeUrl === null) {
    // No page URL means the client answered about no page at all, which is not a thing to judge a write
    // against — an empty string here would resolve to the unregistered default and read as a policy
    // decision about a page nobody was on.
    return err(
      BrowserActionErrors.clientFailed({ detail: "the browser named no page, so there was nothing to judge" }),
    );
  }
  const cited = request.observation;
  if (cited !== undefined && !sessionObservationIsCurrent({ currentUrl: beforeUrl, observation: cited })) {
    return err(BrowserActionErrors.staleObservation({ currentUrl: beforeUrl, observedUrl: cited.url }));
  }
  // The same URL is not the same document: a replaced one re-issues refs from one, so the ref the caller chose
  // can name another element in the read the dispatch resolves it against. `./refIdentity.ts` carries why.
  const renamed = refuseARenamedRef({
    admitted: before.value,
    observedYaml: observed.value,
    request,
    workspace: deps.workspace,
  });
  if (renamed.isErr()) {
    return err(renamed.error);
  }
  // The destination decides a navigation, exactly as the Claude-in-Chrome guard decided one: the page you are
  // leaving has no standing to refuse the page you are going to, and a read-only page you could not leave
  // would be a trap rather than a rail.
  // A `navigate` with no `--value` never reaches here — `clientArgsFor` refuses it — so the destination is
  // the page being judged whenever there is one, and the page being left otherwise.
  const destination = request.value;
  const judgingDestination = request.kind === "navigate" && destination !== undefined;
  const judged = judgingDestination ? destination : beforeUrl;
  // The clock is read AFTER the page read above, so a waiver that lapsed while the browser was answering is
  // judged expired rather than live.
  const admission = admitBrowserAction({ kind: request.kind, nowIso: now(), url: judged, waiver });
  if (admission.isErr()) {
    return err(admission.error);
  }
  return ok({ admission: admission.value, beforeUrl });
}

/**
 * Send the interaction to the client, expanding the one kind that is two commands.
 *
 * ## The upload expansion re-judges between its halves, and that is a correctness rule rather than caution
 *
 * MEASURED by a Codex review pass, as a counterexample against this very file: an upload is a
 * chooser-opening CLICK followed by `setFiles`, and the click is a real interaction that can navigate. A
 * page serving `<input type="file" onclick="location.hash='other'">` therefore passed admission on the page
 * the waiver named and delivered its file on a page nothing had judged. One admission for a two-command
 * interaction is one admission too few.
 *
 * So the second half asks {@link judgeAgainstLivePage} again, against the URL the browser is on AFTER the
 * click. A refusal there costs an open file chooser on the owner's page and nothing else — no bytes are delivered —
 * which is the correct trade, and the refusal says so rather than leaving the chooser unexplained.
 *
 * @param args the argv tail {@link clientArgsFor} built
 * @param deps the client and the session it runs under
 * @param request what the interaction was asked to do, so a second judgement knows its kind
 * @param waiver the scoped waiver for this exact page, when there is one
 * @param now the clock, so the second judgement is made against the time of the second write
 * @param uploadActionId the action's own id, so a stranded chooser can be reported against it
 * @returns the client's reply, or the typed failure
 */
function dispatch({
  args,
  deps,
  request,
  waiver,
  now,
  uploadActionId,
}: {
  args: readonly string[];
  deps: TerminalClientDeps;
  request: BrowserActionRequest;
  waiver: BrowserPageWaiver | undefined;
  now: () => string;
  uploadActionId: string;
}): Result<TerminalReply, BrowserActionError> {
  if (args[0] !== "__upload__") {
    return runClientCommand({ args, deps, mayAct: true });
  }
  const [, ref, file] = args;
  if (ref === undefined || file === undefined) {
    return err(BrowserActionErrors.clientFailed({ detail: "an upload needs both a file input and a file" }));
  }
  return deliverUpload({ actionId: uploadActionId, deps, file, now, ref, request, waiver });
}

/**
 * Open the page's own file chooser and answer it — the one interaction that is two client commands.
 *
 * Every exit past the click reports {@link ./actionErrors.UploadChooserStrandedError}, because by then a
 * click HAS been made and a chooser may be sitting open on the owner's page. An ordinary refusal or a generic client
 * failure there would read as "nothing happened", and a caller who believes that re-runs the command and
 * clicks the input a second time.
 *
 * @param ref the page's own file input
 * @param file the absolute path of the file to deliver
 * @param deps the client and the session it runs under
 * @param request what the interaction was asked to do, so the second judgement knows its kind
 * @param waiver the scoped waiver for this exact page, when there is one
 * @param now the clock, so the second judgement is made against the time of the second write
 * @param actionId the action's own id, so a stranded chooser can be reported against it
 * @returns the client's reply, or the typed failure
 */
function deliverUpload({
  ref,
  file,
  deps,
  request,
  waiver,
  now,
  actionId,
}: {
  ref: string;
  file: string;
  deps: TerminalClientDeps;
  request: BrowserActionRequest;
  waiver: BrowserPageWaiver | undefined;
  now: () => string;
  actionId: string;
}): Result<TerminalReply, BrowserActionError> {
  const ready = openChooser({ actionId, deps, now, ref, request, waiver });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const delivered = runClientCommand({ args: ["upload", file], deps, mayAct: true });
  if (delivered.isErr()) {
    return err(
      BrowserActionErrors.uploadChooserStranded({
        actionId,
        because: delivered.error.message,
        // The delivery command itself failed, so whether `setFiles` landed before it died is not knowable
        // from here. Saying "no bytes were uploaded" would be asserting what nothing observed.
        delivery: "unknown",
      }),
    );
  }
  return delivered;
}

/**
 * Click the page's own file input and confirm a chooser is open and this page still allows the delivery.
 *
 * Split from {@link deliverUpload} so each half stays readable: this one is everything that happens between
 * the click and the bytes, and the click having HAPPENED is why both of its refusals are stranded-chooser
 * reports rather than ordinary ones.
 *
 * @param ref the page's own file input
 * @param deps the client and the session it runs under
 * @param request what the interaction was asked to do
 * @param waiver the scoped waiver for this exact page, when there is one
 * @param now the clock, so the second judgement is made against the time of the second write
 * @param actionId the action's own id
 * @returns nothing when the delivery may proceed, or the typed failure
 */
function openChooser({
  ref,
  deps,
  request,
  waiver,
  now,
  actionId,
}: {
  ref: string;
  deps: TerminalClientDeps;
  request: BrowserActionRequest;
  waiver: BrowserPageWaiver | undefined;
  now: () => string;
  actionId: string;
}): Result<null, BrowserActionError> {
  const opened = runClientCommand({ args: ["click", ref], deps, mayAct: true });
  if (opened.isErr()) {
    return err(opened.error);
  }
  if (opened.value.modalState === null || !opened.value.modalState.includes("File chooser")) {
    // The click HAS run even though no chooser came of it, so this is a stranded-chooser report rather than
    // a generic client failure — whatever that element's handler did, it did.
    return err(
      BrowserActionErrors.uploadChooserStranded({
        actionId,
        because: `clicking ${ref} opened no file chooser, so there was nothing to upload into — aim --target at the page's own file input`,
        delivery: "refused",
      }),
    );
  }
  // The click above may have moved the page. Judge where we ACTUALLY are before delivering any bytes; the
  // cited observation is deliberately dropped from this second judgement, because it described the page
  // before the click and is not evidence about the page after it.
  const stillAllowed = judgeAgainstLivePage({ deps, now, request: { ...request, observation: undefined }, waiver });
  if (stillAllowed.isErr()) {
    return err(
      BrowserActionErrors.uploadChooserStranded({ actionId, because: stillAllowed.error.message, delivery: "refused" }),
    );
  }
  return ok(null);
}
