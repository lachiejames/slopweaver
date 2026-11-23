/**
 * The transport that READS one Vanta policy's version workflow in the owner's own Chrome.
 *
 * A sibling of `vantaPolicyEditor.ts` rather than an arm of it, because the two answer different questions
 * about different routes. That module drives the in-app rich-text editor; this one describes the menu a
 * policy page offers, which is the only route a policy whose body arrived as a FILE has —
 * `vantaPolicyVersionSnippet.ts` carries the measurement that established that.
 *
 * ## The write arm is bound to one approval digest
 *
 * {@link VantaPolicyVersionTransport.upload} refuses unless this transport was CONSTRUCTED with the digest
 * the door admitted for that exact upload, so a caller that forgot `throughDoor` has to deliberately thread
 * a value it has no reason to hold. That is the same bound `vantaPolicyEditor.ts` states, and the same
 * account of what it is worth applies: it makes an accidental write unavailable, not an intentional one
 * impossible.
 */
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  type BrowserTransportError,
  BrowserTransportErrors,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { runLeasedOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/** How long the Vanta single-page app is given to paint a policy page before it is read.
 * @internal
 */
export const POLICY_PAGE_SETTLE_MS = 6_000;

/** One file input the page carries, as the snippet described it.
 * @internal
 */
export interface VantaFileInput {
  readonly accept: string;
  readonly name: string;
  readonly hidden: boolean;
}

/** What one look at a policy's version workflow found. */
export interface VantaPolicyVersionObservation {
  readonly finalUrl: string;
  readonly title: string;
  /** Every button label the page showed before any menu was opened. */
  readonly buttons: readonly string[];
  /** Every menu item label after the overflow menu was opened — the answer this read exists for. */
  readonly menuItems: readonly string[];
  /** Every file input present once the menu was open. */
  readonly fileInputs: readonly VantaFileInput[];
  /** How the menu was opened, or why it was not. */
  readonly opened: string | null;
  readonly screenshotPath: string | null;
}

/** What one upload attempt came to, exactly as the snippet reported it. */
export interface VantaPolicyVersionUpload {
  readonly finalUrl: string;
  /** How far the flow got: `opened`, `attached`, or the stage a refusal stopped at. */
  readonly stage: string;
  /** Why the snippet stopped, or null when it did what it was asked. */
  readonly refused: string | null;
  /** Whether the PDF was attached to the draft. */
  readonly attached: boolean;
  /**
   * Whether anything was WRITTEN at Vanta — true only once the new-version modal was confirmed.
   *
   * MEASURED: opening the modal writes nothing, so a run that stopped before the confirm has
   * left the policy exactly as it was. A refusal with this true HAS left a version behind, and the verb
   * says which of the two happened, because the corrections are different.
   */
  readonly wrote: boolean;
  /** Every control the screen offered, so a screen that has moved is diagnosable from the report. */
  readonly controls: readonly string[];
  /** The screen's own text, capped, so a person can read what Vanta said without opening the PNG. */
  readonly text: string;
  readonly beforeScreenshotPath: string;
  readonly screenshotPath: string | null;
}

/** What this transport can do. */
export interface VantaPolicyVersionTransport {
  readonly observe: () => Result<VantaPolicyVersionObservation, BrowserTransportError>;
  /**
   * Start a new version and, when a PDF is named, attach it — leaving the version a DRAFT.
   *
   * @param pdfPath the PDF to attach, or null to stop once the draft exists and report the screen
   * @returns what the snippet reported, or the typed reason the browser gave nothing back
   */
  readonly upload: (input: { pdfPath: string | null }) => Result<VantaPolicyVersionUpload, BrowserTransportError>;
  readonly release: () => void;
}

/** A string field of the snippet's report, or an empty string. */
function text({ record, key }: { record: Record<string, unknown>; key: string }): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/** A string-array field of the snippet's report, with every non-string dropped. */
function strings({ record, key }: { record: Record<string, unknown>; key: string }): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The file inputs the snippet reported, each reduced to the three fields this transport carries. */
function fileInputs({ record, key }: { record: Record<string, unknown>; key: string }): readonly VantaFileInput[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) =>
    isRecord(entry)
      ? [
          {
            accept: text({ key: "accept", record: entry }),
            hidden: entry["hidden"] === true,
            name: text({ key: "name", record: entry }),
          },
        ]
      : [],
  );
}

/**
 * Turn the snippet's own JSON into the observation, or the typed reason it is not usable.
 *
 * @param result what the relay printed, or the failure that reached it first
 * @param screenshotPath the file the snippet was told to write, carried through when it says it did
 * @returns the observation, or why there is none
 *
 * @internal
 */
export function observationFrom({
  result,
  screenshotPath,
}: {
  result: Result<string, BrowserTransportError>;
  screenshotPath: string;
}): Result<VantaPolicyVersionObservation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const record = readSnippetOutput({ stdout: result.value });
  if (record === null) {
    return err(
      BrowserTransportErrors.unavailable({
        reason: "the relay printed nothing this read could parse as a policy-page observation",
      }),
    );
  }
  const failure = record["failure"];
  if (typeof failure === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({
        because: SNIPPET_REPORTED_FAILURE_BECAUSE,
        reason: failure,
        url: text({ key: "finalUrl", record }),
      }),
    );
  }
  const openedValue = record["opened"];
  return ok({
    buttons: [
      ...new Set([...strings({ key: "beforeButtons", record }), ...strings({ key: "expandedButtons", record })]),
    ],
    fileInputs: [
      ...fileInputs({ key: "afterFileInputs", record }),
      ...fileInputs({ key: "expandedFileInputs", record }),
    ],
    finalUrl: text({ key: "finalUrl", record }),
    menuItems: strings({ key: "afterMenuItems", record }),
    opened: typeof openedValue === "string" ? openedValue : null,
    screenshotPath: record["screenshotWritten"] === true ? screenshotPath : null,
    title: text({ key: "title", record }),
  });
}

/** Where this invocation's PNG is written. */
function shotPath({ deps, label }: { deps: PlaywrightCliDeps; label: string }): string {
  return join(deps.scratchDir, `vanta-policy-${label}-${String(Date.now())}.png`);
}

/**
 * Turn the upload snippet's own JSON into the outcome, or the typed reason it is not usable.
 *
 * @param result what the relay printed, or the failure that reached it first
 * @param screenshotPath the after shot, carried through when the snippet says it wrote one
 * @param beforeScreenshotPath the before shot, carried through unconditionally so a pair can be compared
 * @returns the outcome, or why there is none
 *
 * @internal
 */
export function uploadFrom({
  result,
  screenshotPath,
  beforeScreenshotPath,
}: {
  result: Result<string, BrowserTransportError>;
  screenshotPath: string;
  beforeScreenshotPath: string;
}): Result<VantaPolicyVersionUpload, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const record = readSnippetOutput({ stdout: result.value });
  if (record === null) {
    return err(
      BrowserTransportErrors.unavailable({
        reason:
          "the relay printed nothing this upload could parse — a renewal may or may not have been started, " +
          "so read the policy page before running it again",
      }),
    );
  }
  const failure = record["failure"];
  if (typeof failure === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({
        because: SNIPPET_REPORTED_FAILURE_BECAUSE,
        reason: failure,
        url: text({ key: "finalUrl", record }),
      }),
    );
  }
  const refused = record["refused"];
  return ok({
    attached: record["attached"] === true,
    beforeScreenshotPath,
    controls: strings({ key: "controls", record }),
    finalUrl: text({ key: "finalUrl", record }),
    refused: typeof refused === "string" ? refused : null,
    screenshotPath: record["screenshotWritten"] === true ? screenshotPath : null,
    stage: text({ key: "stage", record }),
    text: text({ key: "text", record }),
    wrote: record["wrote"] === true,
  });
}

/**
 * Build the read-only policy-version transport for ONE policy page.
 *
 * @param deps the consent token, the profile pin, the scratch directory and the lease's own inputs
 * @param url the exact policy page this transport is bound to for its whole life
 * @returns a transport that describes that page's version menu in the owner's own Chrome
 */
// max-lines-exempt: the same shape as `vantaPolicyEditor.ts`'s factory above, for the same reason: one object literal of arms, each bound to the approval digest the door admitted.
export function createVantaPolicyVersionTransport({
  deps,
  url,
  approvedDigest,
}: {
  deps: PlaywrightCliDeps;
  url: string;
  approvedDigest: string | null;
}): VantaPolicyVersionTransport {
  const scratch = openScratch();
  const session = openSession();
  return {
    observe: () => {
      const screenshotPath = shotPath({ deps, label: "version" });
      return observationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason: "this read is bound to the Vanta origin the lease was taken with",
          operation: { kind: "vanta-policy-version-observe", screenshotPath, settleMs: POLICY_PAGE_SETTLE_MS, url },
          scratch,
          session,
          url,
        }),
        screenshotPath,
      });
    },
    release: () => {
      releaseSession({ deps, scratch, session });
    },
    upload: ({ pdfPath }) => {
      if (approvedDigest === null) {
        return err(
          BrowserTransportErrors.unavailable({
            reason:
              "this transport was built read-only — its upload arm is bound to the digest the door admitted, " +
              "and nothing was clicked",
          }),
        );
      }
      const beforeScreenshotPath = shotPath({ deps, label: "before" });
      const screenshotPath = shotPath({ deps, label: "after" });
      return uploadFrom({
        beforeScreenshotPath,
        result: runLeasedOperation({
          deps,
          offLeaseReason: "this read is bound to the Vanta origin the lease was taken with",
          operation: {
            beforeScreenshotPath,
            kind: "vanta-policy-version-upload",
            pdfPath,
            screenshotPath,
            settleMs: POLICY_PAGE_SETTLE_MS,
            url,
          },
          scratch,
          session,
          url,
        }),
        screenshotPath,
      });
    },
  };
}
