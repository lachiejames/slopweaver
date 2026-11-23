/**
 * The transport that reads and edits ONE Vanta policy draft in the owner's own Chrome.
 *
 * A sibling of `playwrightCli.ts`'s page transport rather than a widening of it. `pageTransport.ts` states
 * as a property of its own seam that an implementation *"performs no click, no form submission and no
 * request replay"*, and every atlas walk's safety argument rests on that sentence, so the write arms live
 * behind a different interface with a different gate in front of it. What the two share is
 * `relaySession.ts`: the same machine-wide lease, the same origin binding, the same profile pin, the same
 * owned-tab cleanup — and the same rule that a caller chooses a declared OPERATION, never code.
 *
 * ## What stands in front of this
 *
 * `write vanta edit-policy-draft` is the only caller. It goes through `admit/effects.ts`'s door as an
 * `external-write` with an approval gate that HOLDS unless `--approve` carries the digest of that exact
 * substitution, and it re-reads the draft inside the admitted effect so the write is judged on what is in
 * the editor rather than on what a snapshot said a moment ago.
 *
 * ## The write boundary is the keystroke, not the Save
 *
 * MEASURED: the editor's toolbar reads **Auto-save enabled**. So {@link editDraft} has already
 * mutated a real compliance document by the time it clicks `Save and close`, and both the door row and the
 * refusal text say so. A verb that treated Save as the boundary would be describing a write that had
 * already happened.
 */
import { join } from "node:path";
import { type VantaDraftEditPlan, vantaDraftEditDigest } from "../atlas/vanta/policyDraft.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  type BrowserTransportError,
  BrowserTransportErrors,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { runLeasedOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/**
 * One editable region the editor page showed, as the snippet described it.
 *
 * @internal
 */
export interface VantaEditorRegion {
  readonly tagName: string;
  readonly className: string;
  readonly textLength: number;
}

/**
 * What was observed in the editor, exactly as the snippet reported it.
 *
 * @internal
 */
export interface VantaEditorObservation {
  readonly finalUrl: string;
  readonly title: string;
  readonly text: string;
  readonly controls: readonly string[];
  readonly regionCount: number;
  /**
   * Every editable region, not only the one the snippet picked.
   *
   * Reported because the page's shape is what a write is judged against: a refusal that says "79 regions"
   * and cannot say what they were leaves the reader with nothing to act on, and an ambiguous editor would
   * be indistinguishable from an unambiguous one.
   */
  readonly regions: readonly VantaEditorRegion[];
}

/** What an edit came to, exactly as the snippet reported it. */
export interface VantaEditorMutation {
  readonly finalUrl: string;
  /** The editor text before the substitution — what the plan was actually applied to. */
  readonly before: string;
  /** The editor text after it. Compared to the plan's `expectedText` by the caller, not here. */
  readonly after: string;
  /**
   * Whether the EDITOR took the substitution — its own text matched the plan byte for byte after typing.
   *
   * Evidence that the keystroke landed, and nothing more. MEASURED: a DOM write can make this
   * true while Vanta stores the original, which is why {@link VantaEditorMutation.persisted} exists and is
   * the only field success is reported on.
   */
  readonly matched: boolean;
  /**
   * Whether the substitution was still there when the editor was REOPENED from scratch.
   *
   * The one field that is evidence Vanta stored anything.
   */
  readonly persisted: boolean;
  /** Why the reopened read could not be taken, when it could not. An unknown outcome, never a false one. */
  readonly persistError: string | null;
  /** Why the keystroke could not be delivered, when it could not. */
  readonly typeError: string | null;
  /** Whether `document.execCommand("insertText", …)` reported success. */
  readonly typed: boolean;
  /** Whether `Save and close` was clicked and returned. Autosave means a false here is not "nothing happened". */
  readonly saved: boolean;
  readonly saveError: string | null;
  /** The refusal the snippet made in the page, changing nothing, when it made one. */
  readonly refused: string | null;
  readonly screenshotPath: string | null;
}

/** Read one draft, edit one draft, let go. Bound to one URL at construction; no method can retarget it. */
export interface VantaPolicyEditorTransport {
  readDraft: () => Result<VantaEditorObservation, BrowserTransportError>;
  /**
   * Apply one substitution — but only the one this transport was CONSTRUCTED for.
   *
   * It takes a whole {@link VantaDraftEditPlan} rather than three strings, and refuses unless that plan's
   * digest is the `approvedDigest` the factory was given. See the factory for what that buys and what it
   * honestly does not.
   */
  editDraft: (options: { plan: VantaDraftEditPlan }) => Result<VantaEditorMutation, BrowserTransportError>;
  release: () => void;
}

/**
 * How long the editor is given to paint before it is read or typed into.
 *
 * @internal
 */
export const EDITOR_SETTLE_MS = 6_000;

/**
 * Build the Vanta policy editor transport for ONE draft.
 *
 * ## The edit arm is bound to ONE approved substitution, and what that is worth
 *
 * `approvedDigest` is the digest the DOOR admitted, and {@link VantaPolicyEditorTransport.editDraft}
 * refuses any plan that does not hash to it. `null` builds a read-only transport whose edit arm can never
 * fire.
 *
 * **The bound, stated rather than implied.** This is not a capability lock and cannot be one: any file in
 * this repository can compute a digest and pass it here, exactly as any file can construct
 * `createVantaVulnerabilityWriteClient` and call it without the door. What it buys is that an ACCIDENTAL
 * write is not available — the realistic failure is a future session wiring a second caller and forgetting
 * `throughDoor`, and such a caller now has to deliberately thread an approval value it has no reason to
 * have. The bound is explicit rather than assumed; the routing itself is
 * held by `admit/coverage.ts`, which classifies this file `door-internal` and fails when a new direct seam
 * appears unsanctioned.
 *
 * @param deps the consent token, the profile pin, the scratch directory, the clock, the home and the
 *   origins the machine-wide relay lease is taken with
 * @param url the exact policy editor address this transport is bound to for its whole life
 * @param approvedDigest the substitution digest the door admitted, or `null` for a read-only transport
 * @returns a transport that reads and edits that one draft in the owner's own Chrome
 */
// max-lines-exempt: a transport factory is one object literal of arms; each arm is already the smallest thing it can be, and splitting them would separate an arm from the digest bound it is checked against.
export function createVantaPolicyEditorTransport({
  deps,
  url,
  approvedDigest,
}: {
  deps: PlaywrightCliDeps;
  url: string;
  approvedDigest: string | null;
}): VantaPolicyEditorTransport {
  const scratch = openScratch();
  const session = openSession();
  return {
    editDraft: ({ plan }) => {
      if (approvedDigest === null || vantaDraftEditDigest({ plan }) !== approvedDigest) {
        return err(
          BrowserTransportErrors.unavailable({
            reason:
              "this editor transport was not constructed for that substitution — its edit arm is bound to " +
              "the digest the door admitted, and nothing was typed",
          }),
        );
      }
      return mutationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason: "this editor transport is bound to the Vanta origin the lease was taken with",
          operation: {
            expectedText: plan.expectedText,
            find: plan.find,
            kind: "vanta-draft-edit",
            replace: plan.replace,
            screenshotPath: shotPath({ deps }),
            settleMs: EDITOR_SETTLE_MS,
            url,
          },
          scratch,
          session,
          url,
        }),
      });
    },
    readDraft: () =>
      observationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason: "this editor transport is bound to the Vanta origin the lease was taken with",
          operation: {
            kind: "vanta-draft-observe",
            screenshotPath: shotPath({ deps }),
            settleMs: EDITOR_SETTLE_MS,
            url,
          },
          scratch,
          session,
          url,
        }),
      }),
    release: () => {
      releaseSession({ deps, scratch, session });
    },
  };
}

/** Where this invocation's PNG is written. One per operation, so a before and an after both survive. */
function shotPath({ deps }: { deps: PlaywrightCliDeps }): string {
  return join(deps.scratchDir, `vanta-editor-${String(Date.now())}.png`);
}

/**
 * Turn what the observe snippet printed into an observation.
 *
 * @param result what the client printed, or the failure that reached it first
 * @returns the observation, or why there is none
 *
 * @internal
 */
export function observationFrom({
  result,
}: {
  result: Result<string, BrowserTransportError>;
}): Result<VantaEditorObservation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const output = readSnippetOutput({ stdout: result.value });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: "the Vanta editor read printed nothing this could parse, so its result never came home",
      }),
    );
  }
  const failure = output["failure"];
  if (typeof failure === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({
        because: SNIPPET_REPORTED_FAILURE_BECAUSE,
        reason: failure,
        url: stringOr({ value: output["finalUrl"] }),
      }),
    );
  }
  return ok({
    controls: stringsOf({ value: output["controls"] }),
    finalUrl: stringOr({ value: output["finalUrl"] }),
    regionCount: typeof output["regionCount"] === "number" ? output["regionCount"] : 0,
    regions: regionsOf({ value: output["regions"] }),
    text: stringOr({ value: output["text"] }),
    title: stringOr({ value: output["title"] }),
  });
}

/**
 * Turn what the edit snippet printed into a mutation record.
 *
 * A snippet that refused in the page is reported as a mutation with `refused` set rather than as a
 * transport failure, because the two mean opposite things: a refusal is proof that nothing was typed, and a
 * transport failure leaves the outcome unknown.
 *
 * @param result what the client printed, or the failure that reached it first
 * @returns the mutation record, or why there is none
 *
 * @internal
 */
export function mutationFrom({
  result,
}: {
  result: Result<string, BrowserTransportError>;
}): Result<VantaEditorMutation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const output = readSnippetOutput({ stdout: result.value });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason:
          "the Vanta editor write printed nothing this could parse. The editor AUTOSAVES, so the draft may " +
          "have been changed — read it again before doing anything else, and never repeat this operation blind",
      }),
    );
  }
  const failure = output["failure"];
  if (typeof failure === "string") {
    return err(
      BrowserTransportErrors.navigationFailed({
        because: SNIPPET_REPORTED_FAILURE_BECAUSE,
        reason: failure,
        url: stringOr({ value: output["finalUrl"] }),
      }),
    );
  }
  const refused = output["refused"];
  return ok({
    after: stringOr({ value: output["after"] }),
    before: stringOr({ value: output["before"] }),
    finalUrl: stringOr({ value: output["finalUrl"] }),
    matched: output["matched"] === true,
    persistError: typeof output["persistError"] === "string" ? output["persistError"] : null,
    persisted: output["persisted"] === true,
    refused: typeof refused === "string" ? refused : null,
    saveError: typeof output["saveError"] === "string" ? output["saveError"] : null,
    saved: output["saved"] === true,
    screenshotPath: output["screenshotWritten"] === true ? stringOr({ value: output["screenshotPath"] }) : null,
    typeError: typeof output["typeError"] === "string" ? output["typeError"] : null,
    typed: output["typed"] === true,
  });
}

/** A string field the snippet may or may not have sent, as a string either way. */
function stringOr({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** The editable regions the snippet described, with anything malformed dropped. */
function regionsOf({ value }: { value: unknown }): readonly VantaEditorRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown): readonly VantaEditorRegion[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const record = entry;
    if (typeof record["tagName"] !== "string" || typeof record["className"] !== "string") {
      return [];
    }
    return [
      {
        className: record["className"],
        tagName: record["tagName"],
        textLength: typeof record["textLength"] === "number" ? record["textLength"] : 0,
      },
    ];
  });
}

/** A string-array field the snippet may or may not have sent, with anything else dropped. */
function stringsOf({ value }: { value: unknown }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry: unknown): entry is string => typeof entry === "string");
}
