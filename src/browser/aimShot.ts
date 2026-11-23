/**
 * The AIM SHOT — the target scrolled into the viewport, marked there, and photographed as a human would see
 * it, immediately before the interaction that is about to touch it.
 *
 * Pure. No browser, no clock, no filesystem; `./actionExecutor.ts` runs the steps this file describes and
 * `src/cli/commands/browser/actionCore.ts` renders what they produced.
 *
 * ## The rule this implements
 *
 * The target is shown before it is fired at, and what is shown is the viewport: what a person would see
 * operating a browser. A browser works well because every movement and every action shows its result at
 * once, and a screen is meant to be scrolled and viewed through the viewport, never taken in as one whole
 * page.
 *
 * ## Three pictures, each answering one question
 *
 * - **before** — the viewport once the target has been scrolled into it, with no mark on it: here is what
 *   is on the page.
 * - **aimed** — the SAME viewport with the target marked. The pair is what makes the mark legible as the
 *   target: a reader compares two otherwise identical pictures and the difference is the element.
 * - **after** — the viewport once the interaction has run, taken by `./actionExecutor.ts`: here is the
 *   result of the action and the page it landed on.
 *
 * **The whole page is photographed only when asked for** (`--full-page`), and never instead of these.
 *
 * ## Why the scroll comes FIRST, and what the measurement really proved
 *
 * MEASURED live: DuckDuckGo's front page is 10,419 pixels tall, a highlight on its search field
 * is an unreadable speck at that scale, and the client's `highlight` **does not scroll** — so a viewport shot
 * of an element further down the page contains no highlight at all. That measurement stands and its
 * conclusion has changed: it is the evidence FOR photographing the viewport, and the missing half was never
 * a second picture, it was the SCROLL. {@link SCROLL_INTO_VIEW_SOURCE} brings the target into the viewport
 * before anything is photographed, so the viewport picture always holds the mark.
 *
 * ## The two constants are the same idiom as the focus probe, and keep the same hole shut
 *
 * `skills/browser/reference/interactions.md` says there is deliberately no arbitrary-JavaScript verb.
 * Neither of these is one, for exactly `./aim.ts`'s reason: each is a single string literal authored in this
 * repository, each returns nothing but numbers and booleans about one element, and **no caller data reaches
 * either** — the element travels as the client's own separate `target` argv value, as it does for a click.
 *
 * ## What this closes, and what it does NOT
 *
 * On its own, **nothing**. The pictures are taken before the dispatch and read after it, so a wrong aim
 * becomes RECONSTRUCTABLE rather than impossible; `./aim.ts` is what makes a Slack incident's two
 * halves impossible. **One thing it does buy outright**: both the scroll and the highlight resolve the ref
 * against the CURRENT snapshot, so a stale or wrong ref fails before the interaction rather than during it —
 * which on a `download` or an `upload`, the two kinds whose failure leaves real residue on the owner's machine, is a
 * genuine narrowing. Dropping the element close-up costs that guard nothing: the guard is a ref that will
 * not resolve, and two of the remaining steps still resolve it.
 *
 * ## What an aim shot does to the owner's page — stated exactly
 *
 * **The scroll is real, and it is the same scroll the interaction performs a moment later.** Playwright's own
 * actionability scrolls an element into view before it clicks, fills, hovers or drags it, so on an action
 * that goes ahead this costs no page effect at all. **On a REFUSED action it does**: the page ends scrolled
 * with nothing done to it. Cosmetic, non-destructive, and named here rather than discovered.
 *
 * **The highlight fires no page handler.** `playwright-core`'s own documentation
 * (`lib/tools/skills/playwright-cli/references/video-recording.md`) says its overlays are `pointer-events:
 * none` and *"do not interfere with page interactions"*, so no event reaches the page. Its residue is a real
 * DOM injection: the fused path hides it again including where a screenshot failed, and a process that dies
 * in between leaves it up until that page is reloaded — `browser close` sweeps a session's own with a
 * targetless `highlight --hide`.
 *
 * **The FOCUS does fire page handlers, which is why it is opt-in.** Focus simulates a human click more closely
 * than a highlight does. It is better evidence — the page draws its own focus ring, so the picture shows the page
 * agreeing the element is reachable — and it is a real interaction: `focus` fires, and the BLUR of whatever
 * held the cursor fires with it, which can validate a form, close a menu or dismiss a popover. So
 * {@link AimMark} defaults to `highlight`, and
 * `--focus` is the caller's choice. `./actionExecutor.ts` refuses to take it on a page the register will not
 * let this session write to.
 *
 * **The window none of this closes.** The aim shot runs BEFORE the admission, because the measured ordering
 * rule in `./actionExecutor.ts` forbids putting three round trips between the admission and the dispatch. So
 * a page that moved between the caller's cited read and the act is scrolled — and, with `--focus`, focused —
 * before the staleness refusal fires. That is the same non-atomicity this lane already states for the page
 * itself, narrowed the same way and closed no better.
 *
 * Neither the scroll, the overlay nor the focus is routed through the door as a separate external write: one
 * ledger row per look would bury the real writes among them, which is the argument `browser read` is already
 * given. The ACTION they precede is door-routed, and it is the thing that happened.
 */
import { isRecord } from "../lib/parsers.js";
import { type BrowserActionKind, isWriteCapableAction } from "./action.js";
import { evalReplyValue } from "./evalReply.js";

/**
 * Bring the target into the viewport, and report where the page ended up.
 *
 * `behavior: "instant"` rather than the default, deliberately: a page whose CSS sets `scroll-behavior:
 * smooth` would otherwise ANIMATE, and every number read on the next line would describe a scroll still in
 * flight — a picture taken a moment later would catch the page mid-slide. `block: "center"` puts the target
 * in the middle of the viewport rather than flush against its top edge, which is what makes the surrounding
 * context in the picture worth having.
 *
 * It returns the viewport and document heights as well as the target's own box, so a receipt can say where
 * in the page this viewport is — the thing a reader of a viewport picture cannot otherwise know.
 */
export const SCROLL_INTO_VIEW_SOURCE = `(element) => {
  const fromY = window.scrollY;
  element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const box = element.getBoundingClientRect();
  return {
    fromY,
    toY: window.scrollY,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    inView: box.top >= 0 && box.bottom <= window.innerHeight,
  };
}`;

/**
 * Put the cursor in the target, and report whether the page agreed.
 *
 * `preventScroll: true` because the framing is already decided by {@link SCROLL_INTO_VIEW_SOURCE}, and a
 * focus that re-scrolled would move the page between the before picture and the aimed one — leaving a pair
 * that differs by more than the mark, which is the one thing the pair exists to show.
 *
 * It walks open shadow roots to find what really holds the cursor, exactly as `./aim.ts`'s probe does, so
 * `focused` is an observation rather than the assumption that calling `focus()` worked.
 */
export const FOCUS_TARGET_SOURCE = `(element) => {
  if (typeof element.focus !== "function") {
    return { focusable: false, focused: false };
  }
  element.focus({ preventScroll: true });
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  return { focusable: true, focused: active === element };
}`;

/** How the target is marked in the aimed picture. */
export type AimMark = "highlight" | "highlight-and-focus";

/** What one aim shot photographs, how it marks its target, and where each picture goes. */
export interface AimShotPlan {
  /**
   * The element shown, or `null` when the interaction names none.
   *
   * `scroll` is the only write-capable kind with no element at all — a wheel event acts on what is under the
   * POINTER — so it is photographed with nothing marked rather than skipped, and the receipt says so.
   */
  readonly ref: string | null;
  /** How the target is marked. Ignored when there is no element to mark. */
  readonly mark: AimMark;
  /** The viewport with the target scrolled into it and nothing marked. */
  readonly beforePath: string;
  /** The same viewport with the target marked. `null` when there is no element. */
  readonly aimedPath: string | null;
  /** The whole scrollable page, present only when the caller asked for one. */
  readonly pagePath: string | null;
}

/** Where the page ended up when the target was scrolled into the viewport. */
export interface AimScroll {
  readonly fromY: number;
  readonly toY: number;
  readonly viewportHeight: number;
  readonly documentHeight: number;
  /** Whether the target's whole box ended up inside the viewport. */
  readonly inView: boolean;
}

/** What the page said when the target was focused. */
export interface AimFocus {
  /** Whether the element has a `focus` method at all. */
  readonly focusable: boolean;
  /** Whether the element really holds the cursor afterwards — observed, never assumed. */
  readonly focused: boolean;
}

/** One aim shot as it was actually taken. */
export interface AimShotResult {
  readonly plan: AimShotPlan;
  /** Where the page moved to frame the target, or `null` when there was no element to frame. */
  readonly scroll: AimScroll | null;
  /** What focusing the target did, or `null` when the mark was a highlight alone. */
  readonly focus: AimFocus | null;
  /** One entry per picture taken, the page its reply named or `null` where it named none; never a later step's. */
  readonly pictureUrls: readonly (string | null)[];
}

/** One client command an aim shot is made of, tagged with what it is for. */
export interface AimShotStep {
  /** Which part of the shot this is — read by the executor to decide what a failure costs. */
  readonly what: "scroll-into-view" | "before" | "highlight" | "focus" | "aimed" | "page" | "hide";
  /** The argv tail to run. */
  readonly args: readonly string[];
}

/**
 * Which ref an interaction is AIMED by, which is the one worth showing.
 *
 * `type` and `press` carry no element of their own, so their aim is `--expect-focus` — the same ref
 * `./aim.ts` asks the page about. Photographing it is not a duplicate of that probe and the two answer
 * different questions: the probe proves the cursor is in element X, and the picture shows WHICH element X is.
 * A Slack incident needed exactly that second half — the cursor was genuinely in an element, and it was
 * the channel composer rather than the search field.
 *
 * A `drag` shows its SOURCE. The drop element is already ref-checked by `./aim.ts`'s `aimProblems`, and
 * marking both would cost another round trip for a picture with two frames on it and nothing to say which is
 * which.
 *
 * @param kind the interaction
 * @param target `--target`, on every kind that names an element directly
 * @param expectFocus `--expect-focus`, which is how a keystroke names one
 * @returns the ref to show, or `null` when the interaction names none
 */
export function aimShotRef({
  kind,
  target,
  expectFocus,
}: {
  kind: BrowserActionKind;
  target: string | undefined;
  expectFocus: string | undefined;
}): string | null {
  if (kind === "type" || kind === "press") {
    if (expectFocus === undefined || expectFocus.length === 0) {
      return null;
    }
    return expectFocus;
  }
  if (target === undefined || target.length === 0) {
    return null;
  }
  return target;
}

/**
 * Whether this interaction is photographed before it runs.
 *
 * Exactly the write-capable set, and the boundary is `./action.ts`'s rather than a second judgement: a
 * `back`, a `reload` or a dialog answer replaces or dismisses what is in front of the browser instead of
 * acting on an element in it, so there is nothing on the page to aim at and a picture of it would be a
 * before-shot dressed up as an aim.
 *
 * @param kind the interaction
 * @returns true when an aim shot is taken before it
 */
export function actionTakesAimShot({ kind }: { kind: BrowserActionKind }): boolean {
  return isWriteCapableAction({ kind });
}

/**
 * Plan one aim shot: which element, how it is marked, and where each picture goes.
 *
 * `stem` is a path prefix rather than a set of paths, so the group is named by construction and a caller
 * cannot hand back one file that is this action's viewport and another that is a different action's. Both
 * `browser act` and `browser aim` build their plan here, which is why the ref arrives already resolved —
 * `act` reads it off an interaction with {@link aimShotRef}, and `aim` was handed one.
 *
 * @param ref the element to show, or `null` when the interaction names none
 * @param stem the path every picture is named from, without an extension
 * @param mark how the target is marked in the aimed picture
 * @param fullPage whether a whole-page picture is wanted beside the viewport ones
 * @returns the plan
 */
export function planAimShot({
  ref,
  stem,
  mark,
  fullPage,
}: {
  ref: string | null;
  stem: string;
  mark: AimMark;
  fullPage: boolean;
}): AimShotPlan {
  return {
    aimedPath: ref === null ? null : `${stem}-aimed.png`,
    beforePath: `${stem}-before.png`,
    mark,
    pagePath: fullPage ? `${stem}-page.png` : null,
    ref,
  };
}

/**
 * The client commands one aim shot becomes, in the order they must run.
 *
 * The order is the whole mechanism rather than a detail. The scroll runs first because the client's
 * `highlight` does not scroll and a mark outside the viewport is not in the picture. The before picture is
 * taken after the scroll and before the mark, so the pair differs by the mark ALONE. The focus runs before
 * the highlight so one picture holds both, and the hide runs LAST so the page is left as it was found.
 *
 * The hide is returned as part of the plan rather than left to the caller so the sequence is testable as one
 * value; the executor is what guarantees it runs even when a screenshot failed.
 *
 * @param plan the element, the mark and the paths this shot was planned with
 * @returns the tagged steps, in order
 */
export function aimShotSteps({ plan }: { plan: AimShotPlan }): readonly AimShotStep[] {
  const before: AimShotStep = { args: ["screenshot", `--filename=${plan.beforePath}`], what: "before" };
  const page: readonly AimShotStep[] =
    plan.pagePath === null
      ? []
      : [{ args: ["screenshot", "--full-page", `--filename=${plan.pagePath}`], what: "page" }];
  if (plan.ref === null || plan.aimedPath === null) {
    return [before, ...page];
  }
  const focus: readonly AimShotStep[] =
    plan.mark === "highlight-and-focus" ? [{ args: ["eval", FOCUS_TARGET_SOURCE, plan.ref], what: "focus" }] : [];
  return [
    { args: ["eval", SCROLL_INTO_VIEW_SOURCE, plan.ref], what: "scroll-into-view" },
    before,
    ...focus,
    { args: ["highlight", plan.ref], what: "highlight" },
    { args: ["screenshot", `--filename=${plan.aimedPath}`], what: "aimed" },
    ...page,
    { args: ["highlight", "--hide", plan.ref], what: "hide" },
  ];
}

/**
 * Read what the scroll step said about where the page ended up.
 *
 * A reply that cannot be read answers `null` rather than a made-up position: the pictures are still real and
 * the interaction still goes ahead, and a receipt that invented `y 0 of 0` would be describing a page nobody
 * measured.
 *
 * @param stdout everything the client printed for the scroll step
 * @returns the position, or `null` when the reply carried no readable one
 */
export function parseAimScroll({ stdout }: { stdout: string }): AimScroll | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value)) {
    return null;
  }
  const numbers = ["fromY", "toY", "viewportHeight", "documentHeight"] as const;
  if (numbers.some((key) => typeof value[key] !== "number") || typeof value["inView"] !== "boolean") {
    return null;
  }
  return {
    documentHeight: Number(value["documentHeight"]),
    fromY: Number(value["fromY"]),
    inView: value["inView"],
    toY: Number(value["toY"]),
    viewportHeight: Number(value["viewportHeight"]),
  };
}

/**
 * Read what the focus step said about the cursor.
 *
 * @param stdout everything the client printed for the focus step
 * @returns what the page said, or `null` when the reply carried no readable answer
 */
export function parseAimFocus({ stdout }: { stdout: string }): AimFocus | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value) || typeof value["focusable"] !== "boolean" || typeof value["focused"] !== "boolean") {
    return null;
  }
  return { focusable: value["focusable"], focused: value["focused"] };
}

/**
 * The lines a receipt or an aim prints about the pictures it took.
 *
 * Deliberately descriptions rather than a verdict — see this file's header. They say what was framed, marked
 * and photographed, and stop; a reader who wants to know whether that was the right element looks at the
 * pictures, which is the whole point of taking them.
 *
 * @param result the plan and what the scroll and focus steps observed
 * @returns the lines to print
 */
export function aimShotLines({ result }: { result: AimShotResult }): readonly string[] {
  const { plan } = result;
  if (plan.ref === null || plan.aimedPath === null) {
    return [
      `  before: ${plan.beforePath} — the viewport as it stands; this kind names no element, so nothing is marked`,
      ...pageLine({ plan }),
    ];
  }
  return [
    `  before: ${plan.beforePath} — the viewport with ${plan.ref} scrolled into it, unmarked`,
    `  aimed: ${plan.aimedPath} — the same viewport, ${markPhrase({ plan, result })}`,
    ...scrollLine({ result }),
    ...pageLine({ plan }),
  ];
}

/**
 * How the target ended up marked, said as what was OBSERVED rather than as what was asked for.
 *
 * A focus that did not take is reported as not having taken. An element the page will not focus is a real
 * answer about that element — and one a reader of the picture needs, because there will be no focus ring in
 * it to see.
 *
 * @param plan the element and the mark this shot was planned with
 * @param result what the focus step observed, when there was one
 * @returns the phrase that reads after the picture's path
 */
function markPhrase({ plan, result }: { plan: AimShotPlan; result: AimShotResult }): string {
  const highlighted = `${String(plan.ref)} highlighted`;
  if (plan.mark === "highlight") {
    return highlighted;
  }
  const focus = result.focus;
  if (focus === null) {
    return `${highlighted}; the focus step's answer could not be read, so whether it holds the cursor is unknown`;
  }
  if (focus.focused) {
    return `${highlighted} and holding the cursor, as a human about to click it would leave it`;
  }
  if (!focus.focusable) {
    return `${highlighted}; the page gives this element no focus method, so there is no focus ring to see`;
  }
  return `${highlighted}; focus was asked for and the page did not take it`;
}

/**
 * Where in the document this viewport is — the thing a reader of a viewport picture cannot otherwise know.
 *
 * @param result what the scroll step observed
 * @returns the line, or nothing when the position could not be read
 */
function scrollLine({ result }: { result: AimShotResult }): readonly string[] {
  const scroll = result.scroll;
  if (scroll === null) {
    return [];
  }
  const where =
    `  framed at: y ${String(scroll.toY)} of ${String(scroll.documentHeight)}, ` +
    `viewport ${String(scroll.viewportHeight)} tall (was y ${String(scroll.fromY)})`;
  if (scroll.inView) {
    return [where];
  }
  return [where, "  the target's box is still not wholly inside the viewport — read the picture before acting"];
}

/**
 * The whole-page picture's line, when one was asked for.
 *
 * @param plan the paths this shot was planned with
 * @returns the line, or nothing
 */
function pageLine({ plan }: { plan: AimShotPlan }): readonly string[] {
  if (plan.pagePath === null) {
    return [];
  }
  return [`  whole page: ${plan.pagePath} — every pixel of the scrollable page, because --full-page asked`];
}

/**
 * Whether the pictures actually SHOW the thing about to be touched, and the refusal when they do not.
 *
 * **`--focus` defaults on, and the rule is a hard fail with an escape hatch under certain conditions**, where
 * good judgement can override. This is that hard fail, and the condition is the one the viewport picture is
 * entirely about. The whole argument for the viewport picture is that it shows what is being acted on, so a picture the target is not in is evidence-shaped
 * and empty. Printing a warning line beside it, which is what this lane did before, leaves a reader to
 * notice; a refusal does not.
 *
 * **Two conditions, and neither is a guess.** The page is ASKED where the target ended up and answers with
 * its own `getBoundingClientRect`. `not-in-viewport` is the page saying the box is not wholly inside the
 * window. `framing-unreadable` is the page not answering at all, which establishes nothing and so cannot
 * establish this either.
 *
 * **What is deliberately NOT a condition.** An interaction that names no element takes no framing and is
 * never refused here — there is nothing to frame, and `scroll` is the whole of that case. A focus that the
 * page declined is also not a refusal: plenty of elements have no `focus` method, the highlight is still on
 * the picture, and refusing every un-focusable element would refuse most links on most pages.
 *
 * @param result the plan and what the scroll step observed
 * @returns why the shot failed to frame its target, or `null` when it framed it
 */
export function framingProblem({ result }: { result: AimShotResult }): "not-in-viewport" | "framing-unreadable" | null {
  if (result.plan.ref === null) {
    return null;
  }
  if (result.scroll === null) {
    return "framing-unreadable";
  }
  if (!result.scroll.inView) {
    return "not-in-viewport";
  }
  return null;
}

/**
 * The clause a framing refusal reads after "blocked because".
 *
 * The four lines themselves belong to `src/hatch/render.ts` per `.claude/rules/error-handling.md` —
 * *"You do not write that text."* What this supplies is the detail that makes the refusal one an agent can
 * weigh: which element, which half failed, and where the page said it put it.
 *
 * @param ref the element the interaction was aimed by
 * @param because which half failed
 * @param scroll what the page said about where it ended up, when it said anything
 * @returns the clause
 */
export function framingRefusalDetail({
  ref,
  because,
  scroll,
}: {
  ref: string;
  because: "not-in-viewport" | "framing-unreadable";
  scroll: AimScroll | null;
}): string {
  if (because === "framing-unreadable" || scroll === null) {
    return (
      `the page did not say where ${ref} ended up, so nothing has established that the picture about to be ` +
      "read actually contains it"
    );
  }
  return (
    `${ref} was scrolled for and did not end up wholly inside the viewport — the page put the window at ` +
    `y ${String(scroll.toY)} of ${String(scroll.documentHeight)}, ${String(scroll.viewportHeight)} tall — so ` +
    "the picture taken to show what is about to be touched does not contain it"
  );
}
