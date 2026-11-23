/**
 * The interaction VOCABULARY and its admission rule — what `slopweaver browser act` can be asked to do to a
 * page, which of those things can change one, and whether this page may have it done.
 *
 * Pure. No browser, no clock, no filesystem; `./actionExecutor.ts` is the shell that drives the first and
 * `./interactionSessionStore.ts` owns the last two.
 *
 * ## Why there is a closed list here at all, when the owner rejected a closed inventory
 *
 * A closed inventory of steps is the wrong shape: a session with good information in front of it and good
 * judgement is far less likely to blow up. What is rejected is a list of permitted BUSINESS STEPS — "you may
 * open the monitor page, then click edit". This is not that. {@link BrowserActionKind} is a list of the
 * primitives a hand has: click, type, choose, drag, press. A session composes them with judgement, in an
 * order nothing here constrains, toward a goal nothing here knows about. What the list buys is the thing the
 * owner's rail actually needs — a decidable answer to "is this one capable of changing the page", which is
 * the question the JumpCloud hard-fail turns on and which a free-form passthrough could never answer.
 *
 * ## The write/observe split is the load-bearing line
 *
 * {@link WRITE_CAPABLE_ACTIONS} is what a `refuse-every-write` page refuses. `hover` and `scroll` are IN it,
 * which is stricter than the Claude-in-Chrome guard was, and on purpose: the owner's rule is never to click
 * while on the JumpCloud URL, a hover fires the page's own handlers, and "this one only opens a menu" is
 * exactly the reasoning that ends with a click nobody meant. Reading is untouched — a snapshot, a text read
 * and a screenshot are what the read-only pages exist to allow.
 */
import { resolveBrowserPagePolicy } from "../admit/browserPagePolicy.js";
import type { BrowserWritePolicy } from "../admit/browserSurface.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";

/**
 * Every interaction one `browser act` command can perform — the hand, not the errand.
 *
 * Each maps to one command the `playwright-core` terminal client already publishes, which is why the list
 * is this shape rather than an invention: the client owns actionability waiting, locator generation and
 * file-chooser handling, and re-implementing any of them would be a second, worse copy of a thing already
 * shipped. `slopweaver browser act --do <kind>` is one of these and nothing else; there is deliberately no
 * passthrough arm, because a passthrough is a hole in the rail below.
 */
export const BROWSER_ACTION_KINDS = [
  "click",
  "double-click",
  "fill",
  "type",
  "select",
  "check",
  "uncheck",
  "hover",
  "press",
  "scroll",
  "drag",
  "upload",
  "download",
  "navigate",
  "back",
  "forward",
  "reload",
  "dialog-accept",
  "dialog-dismiss",
] as const;

/** One interaction, as the verb names it. */
export type BrowserActionKind = (typeof BROWSER_ACTION_KINDS)[number];

/**
 * The interactions that can CHANGE the page, and therefore the ones a `refuse-every-write` page refuses.
 *
 * Every kind is here except the three navigations and the two dialog answers, and each absence is a decision
 * rather than an oversight:
 *
 * - `back`, `forward` and `reload` replace the document rather than act on it. A read-only page that could
 *   not be left would be a trap, and a walk that reached one needs the way out.
 * - `navigate` is absent for the same reason and is judged on its DESTINATION instead, by the executor,
 *   exactly as the Claude-in-Chrome guard judged a `navigate` — the page you are leaving has no standing to
 *   refuse the page you are going to.
 * - `dialog-accept` and `dialog-dismiss` answer a modal the page raised. They are not here because a dialog
 *   is a state the browser is STUCK in, and a rail that refuses to dismiss one wedges the session on the
 *   very page it was protecting. The action that RAISED the dialog was itself judged, one step earlier.
 *
 * `hover` and `scroll` ARE here. See the header: a hover is an input event on a page whose handlers this
 * repository does not read.
 *
 * @internal — ask {@link isWriteCapableAction} rather than the set; the predicate is what callers name.
 */
const WRITE_CAPABLE_ACTIONS: ReadonlySet<BrowserActionKind> = new Set([
  "click",
  "double-click",
  "fill",
  "type",
  "select",
  "check",
  "uncheck",
  "hover",
  "press",
  "scroll",
  "drag",
  "upload",
  "download",
]);

/**
 * Whether one interaction can change the page in front of it.
 *
 * @param kind the interaction
 * @returns true when a `refuse-every-write` page refuses it
 */
export function isWriteCapableAction({ kind }: { kind: BrowserActionKind }): boolean {
  return WRITE_CAPABLE_ACTIONS.has(kind);
}

/**
 * Whether a string names an interaction this verb performs.
 *
 * Positional because TypeScript error TS1230 forbids a type predicate over a destructured binding — the
 * compiler's decision, and the named exemption in `.claude/rules/typescript-patterns.md`.
 *
 * @returns true when it is one of {@link BROWSER_ACTION_KINDS}
 */
export function isBrowserActionKind(value: string): value is BrowserActionKind {
  return (BROWSER_ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * A waiver the operator took for one exact page, as the executor is handed it.
 *
 * Scoped by construction: a waiver names the page it is for, so the legacy session-wide browser break-glass
 * — which names no page at all — can never lift a page rule. That is the whole reason this is a separate
 * shape rather than a boolean, and it is the residue the page rule's escape hatch would otherwise carry.
 */
export interface BrowserPageWaiver {
  /** The exact page the waiver covers, compared as a whole URL. */
  readonly url: string;
  /** Why the operator took it. */
  readonly reason: string;
  readonly expiresAtIso: string;
}

/**
 * What the rail decided about one action on one page.
 *
 * **`provider` and `policy` are carried rather than discarded**: the aim shot is squared against which
 * platforms are read-only and which are read-write, so the posture prints beside the picture. Both values are
 * computed by {@link resolveBrowserPagePolicy} on every admission already, and a record that drops them
 * leaves nothing downstream able to print the posture. The register stays the one source — this is a wider
 * record of what it answered, never a second copy of it.
 */
export interface BrowserAdmission {
  readonly kind: BrowserActionKind;
  /** The page it was judged against — the LIVE one, never the one a caller claimed. */
  readonly url: string;
  /** The platform the register names for this host, or `null` when it names none. */
  readonly provider: string | null;
  /** What this page may be driven to do, after any page rule has tightened the platform's row. */
  readonly policy: BrowserWritePolicy;
  /** The page rule that decided it, or `null` when the platform's own row did. */
  readonly pageRuleId: string | null;
  /** Set when a scoped waiver lifted a refusal, so the receipt can carry what it overrode. */
  readonly waivedBecause: string | null;
}

/**
 * Decide ONE interaction against the page the browser is actually on.
 *
 * The hard-fail the owner asked for, and the one place it is decided: a click while on the JumpCloud URL
 * throws a hard error, with an escape hatch for a page that has been decided to refuse a click.
 *
 * Three things about WHERE this is called matter more than what it contains, and they are the executor's
 * obligation rather than this function's: `url` must be read off the live browser rather than taken from the
 * caller's `--url`; it must be asked immediately before dispatch rather than at parse time; and a waiver must
 * name this exact page. A correct decision asked about the wrong page is the failure mode this whole rail
 * exists to prevent, and no purity here protects against it.
 *
 * @param kind the interaction being attempted
 * @param url the page the browser is on right now, as the executor just read it
 * The escape hatch is `slopweaver browser break-glass --page <url>`, and `--page` is the whole of what makes
 * it an escape rather than an off switch: a waiver naming no page waives nothing here, so the session-wide
 * grant beside it cannot reach this rule.
 *
 * @param waiver the scoped waiver the operator took for this exact page, when there is one
 * @param nowIso the instant to judge a waiver's expiry against — passed in, never read from the clock
 * @returns the admission, or the refusal naming the rule that caught it
 */
export function admitBrowserAction({
  kind,
  url,
  waiver,
  nowIso,
}: {
  kind: BrowserActionKind;
  url: string;
  waiver: BrowserPageWaiver | undefined;
  nowIso: string;
}): Result<BrowserAdmission, BrowserActionError> {
  const policy = resolveBrowserPagePolicy({ url });
  const allowed = {
    kind,
    pageRuleId: policy.pageRuleId,
    policy: policy.policy,
    provider: policy.provider,
    url,
    waivedBecause: null,
  };
  if (!isWriteCapableAction({ kind }) || policy.policy !== "refuse-every-write") {
    return ok(allowed);
  }
  if (waiver?.url === url && waiver.expiresAtIso > nowIso) {
    return ok({ ...allowed, waivedBecause: waiver.reason });
  }
  return err(
    BrowserActionErrors.actionRefused({
      because: refusalText({
        authority: policy.pageRuleAuthority,
        kind,
        pageRuleId: policy.pageRuleId,
        provider: policy.provider,
        url,
      }),
      pageRuleId: policy.pageRuleId,
      url,
    }),
  );
}

/**
 * What a refusal says: the four lines the escape-hatch renderer owns, detailed with this page and this
 * interaction.
 *
 * The text is NOT written here, and that is the rule rather than a preference — `.claude/rules/error-handling.md`:
 * the renderer owns it. What this supplies is the `detail` clause, which names the page, the interaction and
 * whose decision it was, so the refusal is one an agent can weigh: a bare "blocked" without a reason helps
 * neither an agent nor a human, and both need information.
 *
 * @param kind the interaction that was refused
 * @param url the page it was aimed at
 * @param provider the platform's name, or `null` when the register does not name this host
 * @param pageRuleId the page rule that caught it, or `null` when the platform's own row did
 * @param authority whose decision the page rule was, when a page rule decided it
 * @returns the clause that reads after "blocked because"
 */
function refusalText({
  kind,
  url,
  provider,
  pageRuleId,
  authority,
}: {
  kind: BrowserActionKind;
  url: string;
  provider: string | null;
  pageRuleId: string | null;
  authority: string | null;
}): string {
  const aimed = `--do ${kind} on ${url}`;
  let why: string;
  if (pageRuleId !== null) {
    why = `page rule ${pageRuleId} makes this page read-only${authority === null ? "" : `, ${authority}`}`;
  } else if (provider !== null) {
    why = `${provider} is registered refuse-every-write, so every interaction that can change one of its pages is refused`;
  } else {
    why = "this host is in no write-policy register, and an unregistered host is read-only by default (owner ruling)";
  }
  return hatchRefusal({
    detail: `${aimed}: ${why}. Reads and screenshots on it still work — \`browser read\` is never refused here`,
    hatch: hatchFor({ id: "browser-page-read-only" }),
  });
}

/**
 * Report a crossing, when the action finished somewhere the rail would not have let it act.
 *
 * The after-half of {@link admitBrowserAction}, kept beside it because both ask the same register the same
 * question — one before the dispatch, one after. A reply naming no page is reported as exactly that rather
 * than substituted for: the action HAS run, and "where it landed is unknown" is a different claim from "it
 * landed where it started".
 *
 * @param actionId the action's own id, so the report can name it
 * @param admission what was judged, and the page it was judged against
 * @param settledUrl the page the browser was on afterwards
 * @param waiver the scoped waiver in play, when there is one
 * @returns the typed report, or `null` when the action stayed inside what was judged
 */
export function judgeWhereItLanded({
  actionId,
  admission,
  settledUrl,
  waiver,
}: {
  actionId: string;
  admission: BrowserAdmission;
  settledUrl: string | null;
  waiver: BrowserPageWaiver | undefined;
}): BrowserActionError | null {
  if (!landedSomewhereUnjudged({ admission, settledUrl, waiver })) {
    return null;
  }
  let landedUrl = "(the browser named no page)";
  if (settledUrl !== null) {
    landedUrl = settledUrl;
  }
  return BrowserActionErrors.pageMovedUnderAction({ actionId, judgedUrl: admission.url, landedUrl });
}

/**
 * Whether the action finished on a page that would have refused it.
 *
 * The detection half of the non-atomic fence. A same-document route change between the admission and the
 * dispatch is not preventable from outside the browser — see
 * {@link ./actionErrors.PageMovedUnderActionError} for the measurement — so the action is checked AFTERWARDS
 * and the caller is told loudly rather than left to find out.
 *
 * A move to a page that is equally writable is not reported: the rail's subject is the read-only page, and a
 * click that navigated from one Datadog page to another has crossed nothing. A move to a page a live waiver
 * also covers is likewise fine.
 *
 * @param admission what was judged, and the page it was judged against
 * @param settledUrl the page the browser was on afterwards
 * @param waiver the scoped waiver in play, when there is one
 * @returns true when the action landed on a page that refuses writes and no waiver names
 */
function landedSomewhereUnjudged({
  admission,
  settledUrl,
  waiver,
}: {
  admission: BrowserAdmission;
  settledUrl: string | null;
  waiver: BrowserPageWaiver | undefined;
}): boolean {
  if (settledUrl === null || settledUrl === admission.url || !isWriteCapableAction({ kind: admission.kind })) {
    return false;
  }
  if (resolveBrowserPagePolicy({ url: settledUrl }).policy !== "refuse-every-write") {
    return false;
  }
  return waiver?.url !== settledUrl;
}
