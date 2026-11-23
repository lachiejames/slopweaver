/**
 * How one interaction is AIMED — which element it names, and where the cursor has to be before a keystroke
 * goes out.
 *
 * Pure. No browser, no clock, no filesystem; `./actionExecutor.ts` runs the one probe this file describes
 * and hands the reply back here to be read.
 *
 * ## Whose decision this is
 *
 * The owner's ruling: land a focus assertion before a blind keystroke and refuse a raw selector. A Slack
 * incident split into two halves, and these are those two halves:
 *
 * 1. **The aim.** A coordinate click is already structurally impossible — `./action.ts` has no such
 *    primitive. What was left is `--target`, which the client will happily read as a CSS selector, and a
 *    selector that matches two elements resolves to one of them with nothing to say which. A **ref** out of
 *    a snapshot does not have that property: MEASURED, a superseded ref answers `Ref f1e11 not
 *    found in the current page snapshot` before anything is touched, and one a replaced page has re-issued to
 *    another element is refused by `./refIdentity.ts`'s comparison at admission. {@link isSnapshotRef} makes
 *    that fail-closed property total rather than opt-in.
 * 2. **The keystroke.** `--do type` and `--do press` carry no element AT ALL — the client's own `type` and
 *    `press` commands take only text and a key (`playwright-core/lib/tools/cli-client/help.json`), so the
 *    characters go wherever the cursor happens to be. That is the exact mechanism of the incident: the click
 *    that was supposed to focus Slack's search field landed on nothing, and the text went into the channel
 *    composer, and the `Return` after it posted. {@link actionNeedsFocusAssertion} names the two kinds, and
 *    {@link FOCUS_PROBE_SOURCE} is the question the executor asks the page before either goes out.
 *
 * A reviewer session would have focused a cursor in that text field, taken a screenshot and judged from it
 * whether the cursor is in the correct text field. This is that check, made deterministic and moved into the
 * verb — no second session, no picture for anybody to misread.
 *
 * ## The probe is a CONSTANT, and that is what keeps it out of the arbitrary-JavaScript hole
 *
 * `skills/browser/reference/interactions.md` says there is deliberately no arbitrary-JavaScript verb, and
 * that adding one would be a hole in the read-only rail rather than a capability. {@link FOCUS_PROBE_SOURCE}
 * is not that. It is one string literal authored in this repository, it reads and returns nothing but a
 * description of two elements, and **no caller data reaches it** — the element it asks about travels as the
 * client's own separate `target` argv value, exactly as it does for a click. There is no verb that evaluates
 * caller-supplied source, and this file does not create one.
 *
 * ## What the assertion does not fence
 *
 * The client's `type` and `press` cannot take an element, so the probe and the keystroke are two commands
 * and the page can move focus between them — the same non-atomicity `./actionExecutor.ts` already states for
 * the page itself. It is narrowed the same way (nothing slow sits in the window, and the after-picture shows
 * where the characters actually went) and it is not closed. A page whose own timers steal focus is a page to
 * take off this lane, not one to guard harder.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { err, ok, type Result } from "../lib/result.js";
import type { BrowserActionKind } from "./action.js";
import { BrowserActionErrors, type FocusNotAssertedError, type TargetNotARefError } from "./actionErrors.js";
import { evalReplyValue } from "./evalReply.js";

/**
 * The grammar of a snapshot ref, as the client itself decides it.
 *
 * Not an invention and not a guess: `playwright-core` tests a target against `/^(f\d+)?e\d+$/` and treats
 * everything else as a selector to be resolved by `page.$` — the `f` prefix naming the frame a ref was taken
 * in. Reproduce: `grep -n 'f\\d+)?e\\d+' node_modules/playwright-core/lib/coreBundle.js`. Spelling the same
 * grammar here is what lets a refusal happen before a client is ever started, and the two agreeing is the
 * point: a value this accepts is a value the client will resolve as a ref rather than as a selector.
 */
const SNAPSHOT_REF = /^(?:f\d+)?e\d+$/u;

/**
 * Whether a value is a ref out of a page snapshot rather than a selector.
 *
 * @param value the `--target` or drop-target the caller typed
 * @returns true when the client will resolve it as a snapshot ref
 */
export function isSnapshotRef({ value }: { value: string }): boolean {
  return SNAPSHOT_REF.test(value);
}

/**
 * The interactions that carry no element and go wherever the cursor is — the blind keystrokes.
 *
 * Exactly `type` and `press`, and the membership is the client's contract rather than a judgement: its
 * `type <text>` and `press <key>` commands declare one argument each and neither is a target. `scroll` is
 * not here even though it also carries no element — a wheel event acts on what is under the POINTER, which
 * no focus assertion describes, and pretending otherwise would be a check that reads as a guarantee while
 * measuring the wrong thing.
 *
 * @param kind the interaction
 * @returns true when it must say where the cursor is before it runs
 */
export function actionNeedsFocusAssertion({ kind }: { kind: BrowserActionKind }): boolean {
  return kind === "type" || kind === "press";
}

/**
 * The function the executor evaluates against the ref the caller says holds the cursor.
 *
 * One string literal, authored here, evaluated by the client's own `eval` command with the ref as a separate
 * argv value. Three things in it are load-bearing:
 *
 * - **It walks open shadow roots.** `document.activeElement` answers the HOST when the real focus is inside
 *   an open shadow root, so a component-framework field would report as unfocused and refuse an errand that
 *   was correctly aimed. A CLOSED root has no `shadowRoot` to walk and stays a refusal, which is the right
 *   way round.
 * - **Every string it returns is truncated.** The descriptions come from the page, which is data this
 *   repository does not control; 120 characters is enough to recognise a field and short enough that the
 *   reply stays a bounded record rather than a data-sized payload.
 * - **It reads and returns.** Nothing in it assigns, clicks, focuses or dispatches.
 */
export const FOCUS_PROBE_SOURCE = `(expected) => {
  const cut = (text) => typeof text === "string" && text.length > 0 ? text.slice(0, 120) : null;
  const describe = (node) => {
    if (!node) return null;
    return {
      tag: node.tagName ? node.tagName.toLowerCase() : null,
      type: cut(node.getAttribute ? node.getAttribute("type") : null),
      role: cut(node.getAttribute ? node.getAttribute("role") : null),
      label: cut(node.getAttribute ? node.getAttribute("aria-label") : null),
      placeholder: cut(node.getAttribute ? node.getAttribute("placeholder") : null),
      id: cut(node.id),
      text: cut(node.innerText ? node.innerText.trim() : null),
    };
  };
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  return { matches: active === expected, active: describe(active), expected: describe(expected) };
}`;

/** One element as the focus probe described it — every field the page's own markup gave it, or `null`. */
export interface FocusedElement {
  readonly tag: string | null;
  readonly type: string | null;
  readonly role: string | null;
  readonly label: string | null;
  readonly placeholder: string | null;
  readonly id: string | null;
  readonly text: string | null;
}

/** What the page answered when asked where the cursor is. */
export interface FocusProbe {
  /** True when the element the caller named is the one holding the cursor. */
  readonly matches: boolean;
  /** What actually holds it, or `null` when nothing does. */
  readonly active: FocusedElement | null;
  /** The element the caller named, as the page describes it. */
  readonly expected: FocusedElement | null;
}

/**
 * Read the probe's answer out of the client's reply.
 *
 * The reply's own shape is `./evalReply.ts`'s business, shared with the aim shot rather than spelled here
 * twice. What is this function's business is that an unreadable one is a FAILURE rather than a default:
 * this answer decides whether a keystroke goes out, and a probe that could not be read has established
 * nothing.
 *
 * @param stdout everything the client printed
 * @param kind the keystroke being judged, so an unreadable answer can refuse in its own words
 * @returns what the page said, or the typed failure
 */
export function parseFocusProbe({
  stdout,
  kind,
}: {
  stdout: string;
  kind: BrowserActionKind;
}): Result<FocusProbe, FocusNotAssertedError> {
  const parsed = evalReplyValue({ stdout });
  if (!isRecord(parsed) || typeof parsed["matches"] !== "boolean") {
    return err(unreadableProbe({ kind }));
  }
  return ok({
    active: asFocusedElement({ value: parsed["active"] }),
    expected: asFocusedElement({ value: parsed["expected"] }),
    matches: parsed["matches"],
  });
}

/**
 * Whether a parsed value is an object this file can read fields off.
 *
 * Positional because TypeScript error TS1230 forbids a type predicate over a destructured binding — the
 * compiler's decision, and the named exemption in `.claude/rules/typescript-patterns.md`.
 *
 * @returns true when the value is a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The failure a probe that could not be read answers with — fail-closed, in one place, so the three ways a
 * reply can be unreadable cannot drift into three different refusals.
 *
 * @param kind the keystroke being judged
 * @returns the typed refusal
 */
function unreadableProbe({ kind }: { kind: BrowserActionKind }): FocusNotAssertedError {
  return BrowserActionErrors.focusNotAsserted({
    because: "probe-unreadable",
    focused: null,
    refusal: focusRefusalText({ because: "probe-unreadable", focus: null, kind }),
  });
}

/**
 * Read one described element out of the probe's reply, keeping only the fields this file declares.
 *
 * Every field is optional in the answer and a missing one becomes `null`, because a page is entitled to give
 * an element no label, no role and no id — that is a description of the element rather than a broken probe.
 *
 * @param value whatever the probe put in that position
 * @returns the description, or `null` when there was none
 */
function asFocusedElement({ value }: { value: unknown }): FocusedElement | null {
  if (!isRecord(value)) {
    return null;
  }
  const text = ({ key }: { key: string }): string | null => {
    const field = value[key];
    return typeof field === "string" ? field : null;
  };
  return {
    id: text({ key: "id" }),
    label: text({ key: "label" }),
    placeholder: text({ key: "placeholder" }),
    role: text({ key: "role" }),
    tag: text({ key: "tag" }),
    text: text({ key: "text" }),
    type: text({ key: "type" }),
  };
}

/**
 * One element in a phrase a reader recognises — what the refusal prints instead of a ref nobody can picture.
 *
 * @param element the description the probe returned, or `null` when nothing held the cursor
 * @returns the phrase
 */
export function describeFocusedElement({ element }: { element: FocusedElement | null }): string {
  if (element === null) {
    return "nothing at all (no element holds the cursor)";
  }
  const parts: string[] = [];
  if (element.tag !== null) {
    parts.push(`<${element.tag}>`);
  }
  if (element.type !== null) {
    parts.push(`type=${element.type}`);
  }
  if (element.role !== null) {
    parts.push(`role=${element.role}`);
  }
  if (element.label !== null) {
    parts.push(`aria-label="${element.label}"`);
  }
  if (element.placeholder !== null) {
    parts.push(`placeholder="${element.placeholder}"`);
  }
  if (element.id !== null) {
    parts.push(`#${element.id}`);
  }
  if (element.text !== null) {
    parts.push(`text "${element.text}"`);
  }
  if (parts.length === 0) {
    return "an element the page describes with nothing at all";
  }
  return parts.join(" ");
}

/**
 * The refusal a blind keystroke gets: what was asked, where the cursor actually is, and how to fix it.
 *
 * The text itself belongs to {@link ../hatch/render.hatchRefusal} per `.claude/rules/error-handling.md`;
 * what is supplied here is the clause that reads after "blocked because", detailed with the thing this
 * invocation actually saw.
 *
 * @param kind the keystroke that was refused
 * @param because which half of the assertion failed
 * @param focus what the page said holds the cursor, when the probe got that far
 * @returns the four-line refusal
 */
function focusRefusalText({
  kind,
  because,
  focus,
}: {
  kind: BrowserActionKind;
  because: "no-expect-focus" | "focus-elsewhere" | "probe-unreadable";
  focus: FocusProbe | null;
}): string {
  let detail: string;
  if (because === "no-expect-focus") {
    detail =
      `--do ${kind} names no element and goes wherever the cursor is, and this one said nothing about ` +
      "where that is. Take a `browser read`, find the field you mean, and name its ref with --expect-focus " +
      "<ref>; if the cursor is not in it yet, click or fill it first";
  } else if (because === "probe-unreadable") {
    detail =
      `the page could not be asked where the cursor is before --do ${kind}, so nothing establishes that the ` +
      "characters would land where you meant. Read the page again and retry";
  } else {
    const holder = focus === null ? "something else" : describeFocusedElement({ element: focus.active });
    const meant = focus === null ? "the element you named" : describeFocusedElement({ element: focus.expected });
    detail =
      `--do ${kind} was aimed at ${meant} and the cursor is in ${holder} — the characters would have gone ` +
      "there. Click or fill the element you meant first, read the page again, and retry";
  }
  return hatchRefusal({ detail, hatch: hatchFor({ id: "browser-blind-keystroke" }) });
}

/** One interaction's aiming values, as the caller typed them. */
export interface AimRequest {
  readonly kind: BrowserActionKind;
  /** `--target`, on every kind that names an element. */
  readonly target: string | undefined;
  /** `--value`, which carries the DROP element on a drag and text or a key on everything else. */
  readonly value: string | undefined;
  /** `--expect-focus`, the element a keystroke says holds the cursor. */
  readonly expectFocus: string | undefined;
}

/**
 * Refuse every aiming value that is not a ref out of a snapshot.
 *
 * `--target` is checked whenever it is PRESENT rather than only on the kinds that read it, because a target
 * passed to a kind that ignores it is already a caller who believes they are aiming at something. `--value`
 * is checked only on a `drag`, where it is the drop element; everywhere else it is text, a key or a URL and
 * has no business looking like a ref. `--expect-focus` is checked for the same reason `--target` is: the
 * whole point of the assertion is an exact element, and a selector cannot promise one.
 *
 * @param request the aiming values
 * @param allowSelector whether the operator opened `browser-raw-selector` for this one command
 * @returns nothing when every aim is a ref, or the typed refusal naming the first that is not
 */
export function aimProblems({
  request,
  allowSelector,
}: {
  request: AimRequest;
  allowSelector: boolean;
}): Result<null, TargetNotARefError> {
  if (allowSelector) {
    return ok(null);
  }
  const aims: readonly { readonly flag: string; readonly value: string | undefined }[] = [
    { flag: "--target", value: request.target },
    { flag: "--value", value: request.kind === "drag" ? request.value : undefined },
    { flag: "--expect-focus", value: request.expectFocus },
  ];
  for (const aim of aims) {
    if (aim.value !== undefined && aim.value.length > 0 && !isSnapshotRef({ value: aim.value })) {
      return err(
        BrowserActionErrors.targetNotARef({
          flag: aim.flag,
          refusal: selectorRefusalText({ flag: aim.flag, kind: request.kind, value: aim.value }),
          value: aim.value,
        }),
      );
    }
  }
  return ok(null);
}

/**
 * Decide a keystroke against what the page said about the cursor.
 *
 * Fail-closed in every direction that is not an exact match: no element named, no probe taken, or a probe
 * naming a different element. The hatch is the one way past, and it is read by the caller rather than here
 * so this stays pure.
 *
 * @param kind the keystroke being judged
 * @param expectFocus the element the caller says holds the cursor
 * @param probe what the page answered, or `null` when no probe was taken because none was asked for
 * @param allowBlind whether the operator opened `browser-blind-keystroke` for this one command
 * @returns nothing when the keystroke may go out, or the typed refusal
 */
export function focusVerdict({
  kind,
  expectFocus,
  probe,
  allowBlind,
}: {
  kind: BrowserActionKind;
  expectFocus: string | undefined;
  probe: FocusProbe | null;
  allowBlind: boolean;
}): Result<null, FocusNotAssertedError> {
  if (allowBlind || !actionNeedsFocusAssertion({ kind })) {
    return ok(null);
  }
  if (expectFocus === undefined || expectFocus.length === 0) {
    return err(
      BrowserActionErrors.focusNotAsserted({
        because: "no-expect-focus",
        focused: null,
        refusal: focusRefusalText({ because: "no-expect-focus", focus: null, kind }),
      }),
    );
  }
  if (probe === null) {
    return err(
      BrowserActionErrors.focusNotAsserted({
        because: "probe-unreadable",
        focused: null,
        refusal: focusRefusalText({ because: "probe-unreadable", focus: null, kind }),
      }),
    );
  }
  if (probe.matches) {
    return ok(null);
  }
  return err(
    BrowserActionErrors.focusNotAsserted({
      because: "focus-elsewhere",
      focused: describeFocusedElement({ element: probe.active }),
      refusal: focusRefusalText({ because: "focus-elsewhere", focus: probe, kind }),
    }),
  );
}

/**
 * The refusal a raw selector gets on an aiming flag.
 *
 * @param kind the interaction that was refused
 * @param flag the flag the selector arrived on, as the caller typed it
 * @param value what they passed
 * @returns the four-line refusal
 */
function selectorRefusalText({ kind, flag, value }: { kind: BrowserActionKind; flag: string; value: string }): string {
  return hatchRefusal({
    detail:
      `--do ${kind} ${flag} '${value}' is a CSS selector rather than a ref out of a snapshot. A selector that ` +
      "matches two elements resolves to one of them with nothing to say which, while a ref that has gone " +
      "stale refuses rather than hitting something else. Take a `slopweaver browser read`, find the element " +
      "in the file it names, and pass its ref (e.g. e42, or f1e42 inside a frame)",
    hatch: hatchFor({ id: "browser-raw-selector" }),
  });
}
