/**
 * The PURE half of `slopweaver browser open|read|act|close|sessions` — validating what was asked for, and
 * rendering what came back.
 *
 * No filesystem, no clock, no browser. `./actionRun.ts` does all three. What `open` and `read` print about a
 * look is `./lookReceipt.ts`.
 *
 * ## What a receipt has to say, and why it says it in this order
 *
 * A command that acts then shows the result afterwards, or some evidence of what the action did.
 * A reader of that evidence needs, in order: whether the
 * page moved, what it is now, where the picture is, and what the next action can aim at. So the outcome line
 * comes first in every arm — including the successful one — for the same reason `browser shot` names its
 * outcome on every arm: a composer quoting this to the owner should not have to infer the state from a silence.
 */
import type { ResolvedBrowserPolicy } from "../../../admit/browserPagePolicy.js";
import {
  BROWSER_ACTION_KINDS,
  type BrowserActionKind,
  type BrowserAdmission,
  isBrowserActionKind,
} from "../../../browser/action.js";
import { type AimMark, type AimShotResult, aimShotLines } from "../../../browser/aimShot.js";
import type { PageObservation } from "../../../browser/interactionSession.js";
import { type ScrollPageStep, scrollWalkLines } from "../../../browser/scrollWalk.js";
import { err, ok, type Result } from "../../../lib/result.js";
/** A validated `browser open`. */
export interface BrowserOpenOptions {
  readonly url: string;
  readonly json: boolean;
}

/** A validated `browser aim`. */
export interface BrowserAimOptions {
  readonly sessionId: string;
  /** The element to show and photograph, as a ref out of a snapshot. */
  readonly target: string;
  /** Put the page's own focus on the target as well as highlighting it. */
  readonly focus: boolean;
  /** Take a whole-page picture beside the viewport ones. */
  readonly fullPage: boolean;
  readonly json: boolean;
}

/** A validated `browser scroll`. */
export interface BrowserScrollOptions {
  readonly sessionId: string;
  /** How many screens to move, at least one. */
  readonly pages: number;
  /** Walk up the page rather than down. */
  readonly up: boolean;
  readonly json: boolean;
}

/** A validated `browser act`. */
export interface BrowserActOptions {
  readonly sessionId: string;
  readonly kind: BrowserActionKind;
  readonly target: string | undefined;
  readonly value: string | undefined;
  readonly observationId: string | undefined;
  /** `--do type|press` only: the element the caller says holds the cursor. */
  readonly expectFocus: string | undefined;
  readonly out: string | undefined;
  readonly downloadDir: string | undefined;
  readonly expectName: string | undefined;
  /** Put the page's own focus on the target in the aim shot as well as highlighting it. */
  readonly focus: boolean;
  /** Take a whole-page picture beside the aim shot's viewport ones. */
  readonly fullPage: boolean;
  readonly json: boolean;
}

/**
 * Validate the address a session was asked to open, accumulating every rejection rather than stopping at the
 * first — the same shape {@link resolveActOptions} below has, and for the same reason.
 *
 * Absolute `http`/`https` only, for the reason `shot` gives: the session's lease binds to the URL's own
 * ORIGIN, and a `file:`, `chrome:` or `about:` address has none to bind to.
 *
 * @param url the raw `--url` value
 * @returns the address, or why it is not one this verb can open
 */
export function resolveOpenOptions({
  url,
  json,
}: {
  url: string | undefined;
  json: boolean;
}): Result<BrowserOpenOptions> {
  const problems: string[] = [];
  if (url === undefined) {
    problems.push("`browser open` needs --url <address>, e.g. --url https://us3.datadoghq.com/monitors");
    return err(problems);
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    problems.push(`--url takes an absolute address, got '${url}'`);
  }
  if (parsed !== undefined && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    problems.push(`--url takes an http or https address, got '${url}'`);
  }
  if (problems.length > 0 || parsed === undefined) {
    return err(problems);
  }
  return ok({ json, url: parsed.toString() });
}

/**
 * Validate one `browser aim`, accumulating every rejection rather than stopping at the first.
 *
 * `--target` is required and nothing else is, because an aim with no element is a plain screenshot and
 * `browser shot` is already that. The ref itself is NOT validated here: `src/browser/aim.ts`'s
 * `isSnapshotRef` is what decides a ref from a selector, and the aim path asks the page — a value that
 * resolves to nothing comes back as the client's own "Ref … not found in the current page snapshot", which
 * is a better answer than a parse-time guess at the same thing.
 *
 * @param session the interaction session to look through
 * @param target the element to show and photograph
 * @param json whether machine-readable output was asked for
 * @returns the validated invocation, or every rejection
 */
export function resolveAimOptions({
  session,
  target,
  focus,
  fullPage,
  json,
}: {
  session: string | undefined;
  target: string | undefined;
  focus: boolean;
  fullPage: boolean;
  json: boolean;
}): Result<BrowserAimOptions> {
  const problems: string[] = [];
  if (session === undefined) {
    problems.push("`browser aim` needs --session <id>, as `slopweaver browser open` printed it");
  }
  if (target === undefined || target.length === 0) {
    problems.push("`browser aim` needs --target <ref>, the element to show — take a `browser read` to find one");
  }
  if (problems.length > 0 || session === undefined || target === undefined) {
    return err(problems);
  }
  return ok({ focus, fullPage, json, sessionId: session, target });
}

/**
 * Validate one `browser scroll`, accumulating every rejection rather than stopping at the first.
 *
 * `--pages` defaults to ONE rather than to a number that sounds thorough, because the loop is
 * one screen and a look: scroll one page's worth, then ask whether a resource is shown.
 * A walk that photographs five screens before the caller reads any of them is the batch this verb replaces.
 *
 * @param session the interaction session to drive
 * @param pages how many screens to move, as typed
 * @param up whether to walk up the page
 * @param json whether machine-readable output was asked for
 * @returns the validated invocation, or every rejection
 */
export function resolveScrollOptions({
  session,
  pages,
  up,
  json,
}: {
  session: string | undefined;
  pages: string | undefined;
  up: boolean;
  json: boolean;
}): Result<BrowserScrollOptions> {
  const problems: string[] = [];
  if (session === undefined) {
    problems.push("`browser scroll` needs --session <id>, as `slopweaver browser open` printed it");
  }
  let howMany = 1;
  if (pages !== undefined) {
    howMany = Number(pages);
    if (!Number.isInteger(howMany) || howMany < 1) {
      problems.push(`--pages takes a whole number of screens, 1 or more (got ${pages})`);
    }
  }
  if (problems.length > 0 || session === undefined) {
    return err(problems);
  }
  return ok({ json, pages: howMany, sessionId: session, up });
}

/**
 * Decide how the aim shot marks its target, and say so when `--focus` was asked for and not taken.
 *
 * **Why the caller decides this rather than the executor.** A highlight overlay fires no page handler; a
 * focus fires `focus` on the target and `blur` on whatever held the cursor, which can validate a form, close
 * a menu or dismiss a popover. So a focus is only taken where this session may write to the page at all —
 * and that is the register's answer about a PAGE, which is known here, before any client starts, while the
 * executor's own admission is deliberately the last thing before the dispatch and must stay that way.
 *
 * **A break-glass waiver counts**, because it is exactly the case where the operator has decided this page
 * may be driven: dropping the focus there would withhold it from the one caller who asked hardest for it.
 *
 * Nothing here is silent. When `--focus` is dropped the caller is told which posture dropped it, per
 * `.claude/rules/typescript-patterns.md`'s no-silent-fallback rule — the substitution is said out loud.
 *
 * @param focus whether `--focus` was asked for
 * @param policy what the register says about the page the mark would land on
 * @param waived whether a live break-glass waiver names that exact page
 * @returns the mark, and the line to print when a focus was asked for and not taken
 */
export function resolveAimMark({
  focus,
  policy,
  waived,
}: {
  focus: boolean;
  policy: ResolvedBrowserPolicy;
  waived: boolean;
}): { readonly mark: AimMark; readonly skipped: string | null } {
  if (!focus) {
    return { mark: "highlight", skipped: null };
  }
  if (policy.policy !== "refuse-every-write" || waived) {
    return { mark: "highlight-and-focus", skipped: null };
  }
  let who = "this host is in no write-policy register";
  if (policy.provider !== null) {
    who = `${policy.provider} is registered ${policy.policy}`;
  }
  return {
    mark: "highlight",
    skipped:
      `  --focus was not taken: ${who}, and a focus fires the page's own focus and blur handlers. ` +
      "The target is highlighted instead",
  };
}

/**
 * Validate one `browser act`, accumulating every rejection rather than stopping at the first.
 *
 * The observation requirement is enforced HERE as well as in the executor, and the duplication is
 * deliberate: refusing at parse time costs no browser round trip and tells the caller what to do, while the
 * executor's own check is the one that cannot be skipped by a caller that constructs a request another way.
 *
 * @param out where the after-picture goes on an interaction, and where the file goes on a download
 * @param downloadDir the directory a download is watched in
 * @param expectName the filename a download is expected to produce
 * @param expectFocus the element a keystroke says holds the cursor — judged by `src/browser/aim.ts`, which
 *   asks the page rather than taking the claim, so nothing here validates it
 * @param json whether machine-readable output was asked for
 * @returns the validated invocation, or every rejection
 */
export function resolveActOptions({
  session,
  doKind,
  target,
  value,
  observation,
  out,
  downloadDir,
  expectName,
  expectFocus,
  focus,
  fullPage,
  json,
}: {
  session: string | undefined;
  doKind: string | undefined;
  target: string | undefined;
  value: string | undefined;
  observation: string | undefined;
  out: string | undefined;
  downloadDir: string | undefined;
  expectName: string | undefined;
  expectFocus: string | undefined;
  focus: boolean;
  fullPage: boolean;
  json: boolean;
}): Result<BrowserActOptions> {
  const problems: string[] = [];
  if (session === undefined) {
    problems.push("`browser act` needs --session <id>, as `slopweaver browser open` printed it");
  }
  if (doKind === undefined) {
    problems.push(`\`browser act\` needs --do <kind>: ${BROWSER_ACTION_KINDS.join(", ")}`);
  } else if (!isBrowserActionKind(doKind)) {
    problems.push(`--do takes one of ${BROWSER_ACTION_KINDS.join(", ")}, got '${doKind}'`);
  }
  if (doKind === "download" && out === undefined) {
    problems.push("`browser act --do download` needs --out <file>, where the downloaded file is copied to");
  }
  if (problems.length > 0 || session === undefined || doKind === undefined || !isBrowserActionKind(doKind)) {
    return err(problems);
  }
  return ok({
    downloadDir,
    expectFocus,
    expectName,
    focus,
    fullPage,
    json,
    kind: doKind,
    observationId: observation,
    out,
    sessionId: session,
    target,
    value,
  });
}

/**
 * Render what one scroll walk saw.
 *
 * The observation is re-taken at the end and named here, because scrolling moves what is on the page and a
 * caller's next action has to cite a read of where it is NOW — a walk that left the session's last read
 * describing the top of the page would have every following `act` refused for a stale citation.
 *
 * @param steps the screens the walk photographed
 * @param up whether it was walking up the page
 * @param url the page it walked
 * @param policy what the register says that page may be driven to do
 * @param observation the read taken once the walk finished
 * @returns the lines to print
 */
export function renderScrollWalk({
  steps,
  up,
  url,
  policy,
  observation,
}: {
  steps: readonly ScrollPageStep[];
  up: boolean;
  url: string;
  policy: ResolvedBrowserPolicy;
  observation: PageObservation;
}): readonly string[] {
  const direction = up ? "up" : "down";
  return [
    `browser scroll: ${String(steps.length)} screen(s) ${direction} on ${url}`,
    renderWritePosture({ policy }),
    ...scrollWalkLines({ steps, up }),
    `  observation: ${observation.id}`,
    `  aim an action with --target <ref> --observation ${observation.id}`,
  ];
}

/**
 * Render what an aim showed — and say, in the same breath, that it decided nothing.
 *
 * The last line is the one that earns its place. An aim is a LOOK: it grants nothing, `act` does not cite
 * it, and nothing about the next command becomes allowed because one was taken. A reviewer session gating each risky
 * operation is rejected as overkill, so a
 * reader who took this output for a clearance would have read a permission into a mechanism that deliberately
 * is not one.
 *
 * @param result the element that was shown, how it was marked and where each picture went
 * @param url the page it was taken on
 * @param policy what the register says that page may be driven to do
 * @param focusSkipped the line explaining a `--focus` that was asked for and not taken, or `null`
 * @param observation the read this aim took of the page, which becomes the session's latest
 * @param notes `attributeAim`'s lines about a moved or unconfirmed page (`./aimDocument.ts`), printed as given
 * @returns the lines to print
 */
export function renderAim({
  result,
  url,
  policy,
  focusSkipped,
  observation,
  notes,
}: {
  result: AimShotResult;
  url: string;
  policy: ResolvedBrowserPolicy;
  focusSkipped: string | null;
  observation: PageObservation;
  notes: readonly string[];
}): readonly string[] {
  // `browser aim` requires --target, so the null arm is unreachable from the verb — spelled as an `if`
  // rather than a `??` because `no-silent-fallback` is exactly about not hiding a substitution behind one.
  let shown = "(no element)";
  if (result.plan.ref !== null) {
    shown = result.plan.ref;
  }
  const skipped = focusSkipped === null ? [] : [focusSkipped];
  return [
    `browser aim: ${shown} on ${url}`,
    renderWritePosture({ policy }),
    ...aimShotLines({ result }),
    ...skipped,
    ...notes,
    // The observation id is printed because an aim TAKES a read of its own — a second one, AFTER its pictures,
    // so it holds the page as the scroll and any focus left it — and that read becomes the session's latest. Without this line the
    // caller's next `act` cites the read it did before aiming, which is no longer current, and is refused for
    // staleness with nothing to say where the fresh id is. MEASURED live on the owner's own Chrome,
    // walking Datadog APM: `aim`, then `act --observation <the read before it>`, refused. The page's elements
    // follow as the same outline `open`, `read` and `scroll` print (`./elementsReceipt.ts`), never a bare path.
    `  observation: ${observation.id} — cite this one; the aim's own read is now the session's latest`,
    "  nothing was done to the page, and this grants nothing — `browser act` is judged exactly as it would",
    "  have been. Look at the picture, then act or do not",
  ];
}

/**
 * The register's posture on the page an action was judged against, as one line.
 *
 * The posture is squared against which platforms are read only and which are read write, with the right information
 * in front of the reader and good judgement about it.
 * So the posture prints beside the picture rather than being a thing a reader
 * has to go and look up — on the aim, on the receipt, and on a refusal.
 *
 * It names an unregistered host as unregistered rather than silently reporting its refusing default as
 * though a row had decided it: a caller told "unregistered" knows the answer is "nobody has put this
 * platform on the list", which is a different next step from "this platform is on the list and says no".
 *
 * @param policy what the register answered for that page
 * @returns the line to print
 */
export function renderWritePosture({ policy }: { policy: ResolvedBrowserPolicy }): string {
  let who = "unregistered host";
  if (policy.provider !== null) {
    who = policy.provider;
  }
  if (policy.pageRuleId === null) {
    return `  this page: ${who} — ${policy.policy}`;
  }
  return `  this page: ${who} — ${policy.policy}, by page rule ${policy.pageRuleId}`;
}

/**
 * The posture as an admission recorded it — the same line, off the record the rail actually judged with.
 *
 * Separate from {@link renderWritePosture} so a receipt never re-resolves the register: the admission is what
 * decided this action, and re-asking the resolver afterwards could answer about a page the action has since
 * moved to.
 *
 * @param admission what the rail decided, and on which page
 * @returns the line to print
 */
export function renderAdmissionPosture({ admission }: { admission: BrowserAdmission }): string {
  return renderWritePosture({
    policy: {
      door: null,
      pageRuleAuthority: null,
      pageRuleId: admission.pageRuleId,
      policy: admission.policy,
      provider: admission.provider,
    },
  });
}
