/**
 * The Datadog IMAGE lane's own typed error union — `datadog shot` and nothing else's.
 *
 * A union rather than the default `readonly string[]` because every member has a different correction and
 * the caller acts on which it is. A window the console evaluated over the wrong span means the picture is
 * of something else and must be thrown away; an unreadable panel sentence means the capture is of the right
 * thing and was measured wrong; an unusable image is a file problem no re-measurement fixes. Collapsing
 * them would make the one that invalidates the evidence read like the two that do not.
 *
 * ## Why so few members are about the browser
 *
 * Owner ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`): this lane launches nothing and keeps no
 * profile, so there is no missing Chromium binary, no login to time out, and no session of its own to lapse.
 * The one browser it reaches is the owner's real Chrome through the relay, for `shot monitor`, and every way that
 * leg can fail before a picture exists is ONE member — {@link ShotCaptureFailedError}, carrying the relay's
 * own sentence — because the correction is the same for all of them: the capture did not happen, so there
 * is nothing to grade. The rest is what a GRADE can conclude about a capture and its evidence.
 */

/** The panel was found and its own sentence did not carry the counts this crop is defined around. */
export interface ShotPanelUnreadableError {
  readonly code: "PANEL_UNREADABLE";
  readonly message: string;
  /** The panel text as it read, so a Datadog wording change is diagnosable from the failure alone. */
  readonly panelText: string;
  /** Which counts the text did not yield, in the order they are looked for. */
  readonly missing: readonly string[];
}

/** The address given to `shot explorer` is not one this verb will open. */
export interface ShotUrlRefusedError {
  readonly code: "URL_REFUSED";
  readonly message: string;
  readonly url: string;
}

/** The console drew a view whose own query is not the one that was asked for. */
export interface ShotViewStateUnconfirmedError {
  readonly code: "VIEW_STATE_UNCONFIRMED";
  readonly message: string;
  /** What the page's own query control rendered. */
  readonly rendered: string;
  /** The fragments that had to appear in it and did not. */
  readonly missing: readonly string[];
}

/** The monitor evaluated its backtest over a span that is not the one this proof claims. */
export interface ShotPreviewWindowWrongError {
  readonly code: "PREVIEW_WINDOW_WRONG";
  readonly message: string;
  readonly observedSeconds: number;
  readonly expectedSeconds: number;
}

/** The PNG that was written is not one this verb can vouch for. */
export interface ShotImageUnusableError {
  readonly code: "IMAGE_UNUSABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** The image could not be written where it was asked for. */
export interface ShotOutputUnwritableError {
  readonly code: "OUTPUT_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** The owner's browser could not be reached, or did not stay on the console long enough to be read. */
export interface ShotCaptureFailedError {
  readonly code: "CAPTURE_FAILED";
  readonly message: string;
  readonly url: string;
}

/** The backtest panel never reached a state worth photographing inside the readiness wait. */
export interface ShotPanelNeverSettledError {
  readonly code: "PANEL_NEVER_SETTLED";
  readonly message: string;
  /** Which of the panel's conditions the last pass still failed, so the refusal names what was missing. */
  readonly unmet: readonly string[];
}

/** Datadog drew `Query is not supported` where the backtest belongs: this monitor has no backtest to show. */
export interface ShotBacktestUnsupportedError {
  readonly code: "BACKTEST_UNSUPPORTED";
  readonly message: string;
  readonly monitorId: string;
}

/** The viewport picture could not be cut down to the marked panel from the page's own geometry. */
export interface ShotPanelCropRefusedError {
  readonly code: "PANEL_CROP_REFUSED";
  readonly message: string;
  /** Each reason the crop was refused, in the order they were found. */
  readonly problems: readonly string[];
}

/** Every way a Datadog image capture can fail. */
export type DatadogShotError =
  | ShotPanelCropRefusedError
  | ShotPanelUnreadableError
  | ShotUrlRefusedError
  | ShotViewStateUnconfirmedError
  | ShotPreviewWindowWrongError
  | ShotImageUnusableError
  | ShotOutputUnwritableError
  | ShotCaptureFailedError
  | ShotPanelNeverSettledError
  | ShotBacktestUnsupportedError;

/** Construct one typed failure. Tests build fixtures through this, exactly as the real code does. */
export const DatadogShotErrors = {
  backtestUnsupported: ({ monitorId }: { monitorId: string }): ShotBacktestUnsupportedError => ({
    code: "BACKTEST_UNSUPPORTED",
    message:
      `Datadog shows "Query is not supported" where monitor ${monitorId}'s backtest belongs, so this monitor ` +
      "has no backtest panel to prove anything with. Nothing was photographed.",
    monitorId,
  }),
  captureFailed: ({ url, detail }: { url: string; detail: string }): ShotCaptureFailedError => ({
    code: "CAPTURE_FAILED",
    message: `the backtest at ${url} could not be captured in the owner's Chrome: ${detail}. Nothing was kept.`,
    url,
  }),
  panelCropRefused: ({ problems }: { problems: readonly string[] }): ShotPanelCropRefusedError => ({
    code: "PANEL_CROP_REFUSED",
    message:
      `the viewport picture could not be cut to the marked panel: ${problems.join("; ")}. ` +
      "Nothing was kept rather than a picture framed off the panel.",
    problems,
  }),
  panelNeverSettled: ({
    waitedFor,
    unmet,
  }: {
    waitedFor: string;
    unmet: readonly string[];
  }): ShotPanelNeverSettledError => ({
    code: "PANEL_NEVER_SETTLED",
    message:
      `the backtest panel never settled into a picture worth taking (${waitedFor})` +
      (unmet.length === 0 ? "" : `; the last pass still lacked ${unmet.join(", ")}`) +
      ". Nothing was photographed.",
    unmet,
  }),
  imageUnusable: ({ path, detail }: { path: string; detail: string }): ShotImageUnusableError => ({
    code: "IMAGE_UNUSABLE",
    detail,
    message: `the PNG written to ${path} is not usable as evidence: ${detail}. Nothing was kept.`,
    path,
  }),
  previewWindowWrong: ({
    observedSeconds,
    expectedSeconds,
  }: {
    observedSeconds: number;
    expectedSeconds: number;
  }): ShotPreviewWindowWrongError => ({
    code: "PREVIEW_WINDOW_WRONG",
    expectedSeconds,
    message:
      `the console evaluated this backtest over ${String(observedSeconds)}s, not the ` +
      `${String(expectedSeconds)}s this proof claims, so the panel on screen is not a 7-day backtest. ` +
      "Nothing was photographed rather than an image whose caption is wrong.",
    observedSeconds,
  }),
  viewStateUnconfirmed: ({
    rendered,
    missing,
  }: {
    rendered: string;
    missing: readonly string[];
  }): ShotViewStateUnconfirmedError => ({
    code: "VIEW_STATE_UNCONFIRMED",
    message:
      `the view drew, and its own query does not carry ${missing.join(", ")}. The address built from these ` +
      "arguments did not put the console into the state that was asked for — build the view in the console " +
      "and pass its address to `--url`, which is the mode that carries a state this verb did not construct. " +
      `The page rendered: ${rendered}`,
    missing,
    rendered,
  }),
  outputUnwritable: ({ path, detail }: { path: string; detail: string }): ShotOutputUnwritableError => ({
    code: "OUTPUT_UNWRITABLE",
    message: `the capture could not be written to ${path}: ${detail}`,
    path,
  }),
  panelUnreadable: ({
    panelText,
    missing,
  }: {
    panelText: string;
    missing: readonly string[];
  }): ShotPanelUnreadableError => ({
    code: "PANEL_UNREADABLE",
    message:
      `the backtest panel was found and its text yielded no ${missing.join(", ")}. Datadog may have reworded ` +
      `the panel; the crop is defined around that wording. It read: ${panelText}`,
    missing,
    panelText,
  }),
  urlRefused: ({ url, reason }: { url: string; reason: string }): ShotUrlRefusedError => ({
    code: "URL_REFUSED",
    message: `${url} is not an address this verb will open: ${reason}`,
    url,
  }),
} as const;
