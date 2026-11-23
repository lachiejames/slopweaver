/**
 * The browser interaction lane's own typed error union — every way one governed action on a real page can
 * fail, kept apart from the read-only transport's {@link ./pageTransport.BrowserTransportError}.
 *
 * A union rather than the default `readonly string[]` because a caller BRANCHES on which one it is, and the
 * branches are genuinely different acts. A policy refusal is a thing to escalate or waive; a stale
 * observation is a thing to re-read; a lost session is a thing to re-open.
 *
 * **Four arms mean the page HAS been touched, and none of them is a retry.**
 * {@link ActionAppliedEvidenceFailedError}, {@link PageMovedUnderActionError},
 * {@link UploadChooserStrandedError} and {@link DownloadNotResolvedError} are each reachable only after a
 * client command has gone out, and each says so in its own message.
 *
 * **A fifth case is neither, and pretending otherwise is the defect a review pass found here.** A client
 * process that dies mid-command may or may not have reached the page, so {@link ClientFailedError} carries
 * `mayHaveReachedPage` and its message reports the outcome as UNKNOWN rather than as nothing. Only
 * {@link StaleObservationError}, {@link SessionLostError}, {@link ActionRefusedError},
 * {@link FocusNotAssertedError}, {@link TargetNotARefError}, {@link RefNamesAnotherElementError} and a
 * `CLIENT_FAILED` raised while READING mean nothing reached the page. Collapsed into strings that distinction
 * is the one that disappears first, and it is the only one whose loss can cost a second click on the owner's
 * real browser.
 *
 * The split from `BrowserTransportError` is deliberate and is the rule in `.claude/rules/error-handling.md`
 * rather than a preference: an atlas walk's failures are navigation-shaped, an interaction's are
 * permission- and evidence-shaped, and one union spanning both would give every caller arms it can never
 * see.
 */
import { downloadMessage } from "./downloadMessage.js";
import {
  type SessionBusyError,
  SessionErrors,
  type SessionIdleError,
  type SessionLostError,
  type SessionRecordUnwritableError,
} from "./sessionErrors.js";

/** A page rule or a platform row refused this action before anything was dispatched. */
export interface ActionRefusedError {
  readonly code: "ACTION_REFUSED";
  readonly message: string;
  /** The page the action was aimed at, as the executor read it off the live browser. */
  readonly url: string;
  /** The page rule that decided it, or `null` when the platform's own row did. */
  readonly pageRuleId: string | null;
}

/** The caller cited an observation that no longer describes the page in front of the browser. */
export interface StaleObservationError {
  readonly code: "STALE_OBSERVATION";
  readonly message: string;
  /** What the observation said the page was. */
  readonly observedUrl: string;
  /** What the page actually is now. */
  readonly currentUrl: string;
}

/**
 * The terminal client refused, failed or could not be reached at all.
 *
 * **`mayHaveReachedPage` is the field that stops this arm lying.** MEASURED as a counterexample by a Codex
 * review pass: a client process that dies AFTER sending its command and before returning its
 * reply is indistinguishable, from here, from one that never sent it — so a flat "the client failed" on a
 * dispatch reads as "nothing happened" when the click may well have landed. A failure raised while READING a
 * page carries `false` and means what it says; one raised while DISPATCHING carries `true`, and its message
 * says the outcome is unknown rather than negative.
 */
export interface ClientFailedError {
  readonly code: "CLIENT_FAILED";
  readonly message: string;
  /** Exactly what the client said, so a reader is not guessing from a paraphrase. */
  readonly detail: string;
  /** True when this failure came from a command that could already have acted on the page. */
  readonly mayHaveReachedPage: boolean;
}

/**
 * The action WAS dispatched and its evidence could not be captured.
 *
 * The arm that exists so a caller cannot quietly retry a write: the action went out, and only its picture
 * failed. One of the four post-dispatch arms named in this file's header, and the only correct response to
 * any of them is a READ.
 */
export interface ActionAppliedEvidenceFailedError {
  readonly code: "ACTION_APPLIED_EVIDENCE_FAILED";
  readonly message: string;
  /** The action's own id, so the attempt record can be found. */
  readonly actionId: string;
  readonly detail: string;
}

/**
 * The page moved between the admission and the dispatch, and the action landed on a page that would have
 * been refused.
 *
 * The arm that exists because the fence is not atomic and saying so is better than pretending. MEASURED as a
 * counterexample by a Codex review pass: the URL read and the client command are two separate
 * processes, so a page timer changing `location.hash` between them moves the document without replacing it —
 * which means the element ref stays valid and the client happily acts. Nothing in this repository can close
 * that window from outside the browser.
 *
 * What it CAN do is refuse to be quiet about it. The action already happened, so this is not a retry; it is
 * a report that a write landed somewhere nothing judged, naming both pages so the caller can go and look.
 */
export interface PageMovedUnderActionError {
  readonly code: "PAGE_MOVED_UNDER_ACTION";
  readonly message: string;
  readonly actionId: string;
  /** The page the admission was taken against. */
  readonly judgedUrl: string;
  /** The page the browser was actually on afterwards. */
  readonly landedUrl: string;
}

/**
 * The download was triggered and the filesystem watch could not say which file it produced.
 *
 * **The click has already been made in both arms, and the message must never suggest making it again.**
 * MEASURED as a counterexample by a Codex review pass: the ambiguity arm used to end "name it
 * with `--expect-name`", and `--expect-name` only exists on `act --do download` — so a caller following the
 * instruction re-clicked a download that had already happened. The file is on disk either way; the
 * correction is to pick it up, never to download it twice.
 */
export interface DownloadNotResolvedError {
  readonly code: "DOWNLOAD_NOT_RESOLVED";
  readonly message: string;
  /** The directory that was watched. */
  readonly directory: string;
  /** How many settled candidates appeared — `0` for a timeout, `2` or more for an ambiguity. */
  readonly candidates: number;
  /** The files that settled, so a caller can pick one up rather than click again. */
  readonly names: readonly string[];
}

/**
 * An upload's chooser-opening click ran, and the rail then refused the delivery.
 *
 * Its own arm rather than the ordinary {@link ActionRefusedError}, and the distinction is the whole point.
 * MEASURED as a counterexample by a Codex review pass: the second-half refusal used to be
 * returned unchanged, so the caller read "blocked because this page is read-only" — the message that means
 * NOTHING HAPPENED — while a file chooser sat open on the owner's page from a click that had already been made.
 *
 * No bytes were delivered, which is the part the rail got right. What this arm adds is the part it was
 * silent about.
 */
export interface UploadChooserStrandedError {
  readonly code: "UPLOAD_CHOOSER_STRANDED";
  readonly message: string;
  readonly actionId: string;
  /** Why the delivery did not complete, so the reason is not lost in the retelling. */
  readonly because: string;
  /**
   * Whether the file is known NOT to have been delivered, or whether that is unknown.
   *
   * `refused` is the rail stopping the second half before it ran — no bytes moved, and the message may say
   * so. `unknown` is the delivery command itself failing to answer, which is a different thing entirely:
   * MEASURED as a counterexample by a Codex review pass, this arm's message once asserted "No bytes
   * were uploaded" on both, which is false whenever the client died after `setFiles` landed. A message that
   * asserts what it cannot see is the failure this whole family of arms exists to prevent.
   */
  readonly delivery: "refused" | "unknown";
}

/**
 * The interaction was described incompletely, so nothing was dispatched.
 *
 * Its own arm rather than a {@link ClientFailedError} carrying a usage string, which is what it was before
 * the rebase onto the `error-shape-threshold` gate made every plain shape in this directory visible: a
 * request missing `--target` never reached a client at all, and reporting it as a client failure told the
 * caller to go and look at a page nothing had touched.
 */
export interface RequestIncompleteError {
  readonly code: "REQUEST_INCOMPLETE";
  readonly message: string;
  /** The interaction that was asked for. */
  readonly kind: string;
  /** The flag that would complete it. */
  readonly missing: string;
}

/**
 * A keystroke was asked for and nothing established where the cursor is, so nothing was dispatched.
 *
 * Its own arm rather than an {@link ActionRefusedError}, because a page rule did not decide this and there
 * is no page to name: `--do type` and `--do press` carry no element at all, so the refusal is about the
 * REQUEST. The three halves share one arm because the caller's next move is the same in all three — make the
 * cursor provably be where you think it is, then ask again — and `because` keeps which one fired so a report
 * is not reconstructed from the prose.
 */
export interface FocusNotAssertedError {
  readonly code: "FOCUS_NOT_ASSERTED";
  readonly message: string;
  /**
   * `no-expect-focus` when the caller named no element, `focus-elsewhere` when the cursor is in a different
   * one, `probe-unreadable` when the page could not be asked at all.
   */
  readonly because: "no-expect-focus" | "focus-elsewhere" | "probe-unreadable";
  /** What the page says holds the cursor, when the probe got that far. */
  readonly focused: string | null;
}

/**
 * The aim shot could not show the target in the viewport, so nothing was dispatched.
 *
 * Raised by `./aimShot.ts`'s framing check after the before-pictures and before the admission: the page has
 * been scrolled and photographed, and not acted on.
 */
export interface TargetNotFramedError {
  readonly code: "TARGET_NOT_FRAMED";
  readonly message: string;
  /** The element the interaction was aimed by. */
  readonly ref: string;
  /** Which half failed: the page never said where it ended up, or it said the target was not wholly in. */
  readonly because: "not-in-viewport" | "framing-unreadable";
}

/**
 * An interaction was aimed with a CSS selector rather than a ref out of a snapshot.
 *
 * The fail-closed property the whole aiming story rests on belongs to refs alone.
 */
export interface TargetNotARefError {
  readonly code: "TARGET_NOT_A_REF";
  readonly message: string;
  /** The flag the selector arrived on. */
  readonly flag: string;
  /** What the caller passed. */
  readonly value: string;
}

/**
 * The page was read and the read cannot be turned into something an action could aim by.
 *
 * One arm for both halves because the caller's correction is identical: there is nothing to aim at, so read
 * again. `because` keeps WHICH half happened, so a report is not reconstructed from the prose.
 */
export interface ObservationUnusableError {
  readonly code: "OBSERVATION_UNUSABLE";
  readonly message: string;
  /**
   * `elements-unfiled` when the snapshot could not be written down, `elements-unreadable` when a cited read's
   * filed snapshot can no longer be read back, `no-page` when the browser named none.
   */
  readonly because: "elements-unfiled" | "elements-unreadable" | "no-page";
}

/**
 * An aimed ref names a different element in the admission's read than in the read the caller cited, so
 * nothing was dispatched.
 *
 * A FACT about the page, the same class as {@link StaleObservationError} and deliberately hatchless like it:
 * the document was replaced between the two reads and its refs renumbered — `./refIdentity.ts` carries the
 * measurement — so the element the caller chose is not the one the click would reach. There is no legitimate
 * click on an element nobody looked at; the correction is to read again.
 */
export interface RefNamesAnotherElementError {
  readonly code: "REF_NAMES_ANOTHER_ELEMENT";
  readonly message: string;
  readonly ref: string;
  /** What the ref named in the cited read, as a reader recognises it. */
  readonly observed: string;
  /** What it names in the admission's read — what the click would have reached. */
  readonly admitted: string;
}

/** Every way one governed browser action can fail. */
export type BrowserActionError =
  | ActionRefusedError
  | StaleObservationError
  | SessionLostError
  | SessionIdleError
  | SessionBusyError
  | SessionRecordUnwritableError
  | ObservationUnusableError
  | RequestIncompleteError
  | FocusNotAssertedError
  | TargetNotARefError
  | TargetNotFramedError
  | ClientFailedError
  | ActionAppliedEvidenceFailedError
  | PageMovedUnderActionError
  | UploadChooserStrandedError
  | DownloadNotResolvedError
  | RefNamesAnotherElementError;

/** What an unusable observation says, by which half failed. */
const OBSERVATION_UNUSABLE_MESSAGES: Readonly<Record<ObservationUnusableError["because"], string>> = {
  "elements-unfiled": "the page was read and its elements could not be filed, so there is nothing to aim an action by",
  "elements-unreadable":
    "the read you cited filed its elements and that file can no longer be read, so nothing can say what your " +
    "ref named when you chose it. Nothing was dispatched — take a fresh `browser read` and aim from it",
  "no-page": "the browser named no page, so there is nothing to read or aim an action at",
};

/** Construct one typed failure. Tests build fixtures through this, exactly as the real code does. */
export const BrowserActionErrors = {
  actionAppliedEvidenceFailed: ({
    actionId,
    detail,
  }: {
    actionId: string;
    detail: string;
  }): ActionAppliedEvidenceFailedError => ({
    actionId,
    code: "ACTION_APPLIED_EVIDENCE_FAILED",
    detail,
    message:
      `the action ran and its evidence did not: ${detail}. It HAS been performed against the page — whether ` +
      "it changed anything is exactly what the missing evidence would have shown — so this is not a failure " +
      `to retry. Take a fresh \`browser read\` and see what ${actionId} actually did.`,
  }),
  actionRefused: ({
    url,
    pageRuleId,
    because,
  }: {
    url: string;
    pageRuleId: string | null;
    because: string;
  }): ActionRefusedError => ({
    code: "ACTION_REFUSED",
    message: because,
    pageRuleId,
    url,
  }),
  clientFailed: ({
    detail,
    mayHaveReachedPage = false,
  }: {
    detail: string;
    /** Set by a caller whose command could already have acted; defaults to the reading case. */
    mayHaveReachedPage?: boolean;
  }): ClientFailedError => ({
    code: "CLIENT_FAILED",
    detail,
    mayHaveReachedPage,
    message: mayHaveReachedPage
      ? `the browser client failed while performing this: ${detail}\n\nWhether it reached the page first cannot be told from here, so treat the outcome as UNKNOWN rather than as nothing having happened. Take a fresh \`browser read\` and look before you do anything else.`
      : `the browser client refused or failed: ${detail}`,
  }),
  uploadChooserStranded: ({
    actionId,
    because,
    delivery,
  }: {
    actionId: string;
    because: string;
    delivery: "refused" | "unknown";
  }): UploadChooserStrandedError => ({
    actionId,
    because,
    code: "UPLOAD_CHOOSER_STRANDED",
    delivery,
    message:
      `${actionId}: the click that opens the file chooser HAS run — ${because}` +
      (delivery === "refused"
        ? "\n\nNo bytes were uploaded: the rail stopped the delivery before it ran."
        : "\n\nWhether the file was delivered CANNOT be told from here — the delivery command did not answer, so treat the outcome as UNKNOWN rather than as a failure. It may well have completed.") +
      "\n\nA file chooser may still be open on the page: take a fresh `browser read` and see, and dismiss it " +
      "before doing anything else. Do not simply re-run this command — that would click the input a second time.",
  }),
  pageMovedUnderAction: ({
    actionId,
    judgedUrl,
    landedUrl,
  }: {
    actionId: string;
    judgedUrl: string;
    landedUrl: string;
  }): PageMovedUnderActionError => ({
    actionId,
    code: "PAGE_MOVED_UNDER_ACTION",
    judgedUrl,
    landedUrl,
    message:
      `${actionId} was judged against ${judgedUrl} and the browser was on ${landedUrl} when it finished — the ` +
      "page moved underneath the action, and that page refuses every write. The action HAS run; this is not a " +
      "failure to retry. Read the page and see what it did, then decide whether it needs undoing.",
  }),
  downloadNotResolved: ({
    directory,
    candidates,
    names,
    expected,
  }: {
    directory: string;
    candidates: number;
    names: readonly string[];
    /** The filename the caller asked for, when they named one. */
    expected?: string | undefined;
  }): DownloadNotResolvedError => ({
    candidates,
    code: "DOWNLOAD_NOT_RESOLVED",
    directory,
    message: downloadMessage({ candidates, directory, expected, names }),
    names,
  }),
  focusNotAsserted: ({
    because,
    focused,
    refusal,
  }: {
    because: "no-expect-focus" | "focus-elsewhere" | "probe-unreadable";
    focused: string | null;
    /** The four-line refusal `../browser/aim.ts` rendered; this factory never writes refusal text itself. */
    refusal: string;
  }): FocusNotAssertedError => ({
    because,
    code: "FOCUS_NOT_ASSERTED",
    focused,
    message: refusal,
  }),
  targetNotFramed: ({
    ref,
    because,
    refusal,
  }: {
    ref: string;
    because: "not-in-viewport" | "framing-unreadable";
    /** The four-line refusal `../browser/aimShot.ts` rendered; this factory never writes refusal text itself. */
    refusal: string;
  }): TargetNotFramedError => ({ because, code: "TARGET_NOT_FRAMED", message: refusal, ref }),
  targetNotARef: ({ flag, value, refusal }: { flag: string; value: string; refusal: string }): TargetNotARefError => ({
    code: "TARGET_NOT_A_REF",
    flag,
    message: refusal,
    value,
  }),
  requestIncomplete: ({ kind, missing }: { kind: string; missing: string }): RequestIncompleteError => ({
    code: "REQUEST_INCOMPLETE",
    kind,
    message: `\`--do ${kind}\` needs ${missing}. Nothing was dispatched, so the page is exactly as it was.`,
    missing,
  }),
  ...SessionErrors,
  observationUnusable: ({ because }: { because: ObservationUnusableError["because"] }): ObservationUnusableError => ({
    because,
    code: "OBSERVATION_UNUSABLE",
    message: OBSERVATION_UNUSABLE_MESSAGES[because],
  }),
  refNamesAnotherElement: ({
    ref,
    observed,
    admitted,
  }: {
    ref: string;
    observed: string;
    admitted: string;
  }): RefNamesAnotherElementError => ({
    admitted,
    code: "REF_NAMES_ANOTHER_ELEMENT",
    message:
      `${ref} was ${observed} in the read you cited and is ${admitted} on the page now — the page was replaced ` +
      "between the two reads and its refs renumbered, so the click would have reached an element you never " +
      "chose. Nothing was dispatched. Take a fresh `browser read`, find the element you mean, and aim by its ref.",
    observed,
    ref,
  }),
  staleObservation: ({
    observedUrl,
    currentUrl,
  }: {
    observedUrl: string;
    currentUrl: string;
  }): StaleObservationError => ({
    code: "STALE_OBSERVATION",
    currentUrl,
    message:
      `the observation you cited was of ${observedUrl} and the browser is on ${currentUrl} — the page moved ` +
      "underneath the decision, so nothing was dispatched. Read it again and decide against what is there now.",
    observedUrl,
  }),
} as const;
