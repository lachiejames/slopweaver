/**
 * The transport that opens Notion's settings modal in the owner's own Chrome and reads one tab of it.
 *
 * A sibling of `playwrightCli.ts`'s page transport rather than a widening of it, for the same reason
 * `vantaPolicyEditor.ts` is one: `pageTransport.ts` states as a property of its own seam that an
 * implementation *"performs no click, no form submission and no request replay"*, and every atlas walk's
 * safety argument rests on that sentence. This transport clicks, so it lives behind a different interface.
 * What it shares with both is `relaySession.ts` — the same machine-wide lease, the same origin binding, the
 * same profile pin, the same owned-tab cleanup, and the same rule that a caller chooses a declared
 * OPERATION, never code.
 *
 * ## It is READ-ONLY, and that is a property of the arms rather than an intention
 *
 * Both arms click, and neither can click anything but a disclosure. The settings control is matched against
 * a closed accessible-name list in `notionSettingsSnippet.ts`; a tab is named by a closed enum member that
 * `atlas/notion/settingsTabs.ts` resolves. Nothing else in the modal is reachable — which matters here more
 * than it did for Vanta, because Notion's settings modal holds `Delete workspace`, `Remove member` and a
 * billing upgrade on the very panels this atlas photographs.
 *
 * ## Why an observe arm exists beside the tab arm
 *
 * The tab inventory was a measurement nobody held. Notion's help pages describe settings as something you
 * reach from the sidebar and document no URL scheme and no tab list at all, so a closed enum written from
 * memory would have been a guess dressed as a contract — and the first Notion walk already shipped one of
 * those, photographing 21 byte-identical not-found shells and reporting a filled surface
 * (`atlas/notion/browserPages.ts`). {@link NotionSettingsTransport.observe} is what the enum is built from.
 */
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  type BrowserTransportError,
  BrowserTransportErrors,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { holdRelayLease } from "./relayLeaseHold.js";
import { runLeasedOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/**
 * One entry the settings modal's own navigation offered, as the snippet described it.
 *
 * Reported whole rather than filtered, because the modal's shape is what a tab selection is judged against:
 * a refusal that says "no tab of that name" and cannot say what WAS there leaves a reader with nothing to
 * act on.
 *
 * @internal — a field type of {@link NotionSettingsObservation}.
 */
export interface NotionSettingsEntry {
  readonly name: string;
  readonly role: string;
  readonly selected: boolean;
}

/** What one arm saw of the settings modal. */
export interface NotionSettingsObservation {
  readonly finalUrl: string;
  readonly title: string;
  /** Whether a dialog was open when the modal was read. The falsifiable half of "the click worked". */
  readonly dialogOpen: boolean;
  /** The dialog's own accessible name, when it has one. */
  readonly dialogLabel: string | null;
  readonly entries: readonly NotionSettingsEntry[];
  /**
   * Every entry the client marked selected after the tab click. Empty on the observe arm.
   *
   * The witness the caller grades a tab capture on: a PNG existing proves only that a picture was taken,
   * and the failure this whole module is built around is a picture of the wrong thing reported as success.
   *
   * A LIST rather than one value, which the live run settled. Selecting `Members` leaves the client marking
   * two entries — the rail's `Members` and the panel's own `Members 186` sub-tab — so a field that only
   * accepted a single selection reported "nothing marked selected" for a capture that had worked perfectly.
   * The caller checks that the tab it ASKED for is among these.
   */
  readonly selectedTabs: readonly string[];
  /** How many controls matched the requested tab's name list: 1 is the only usable answer. */
  readonly tabMatches: number | null;
  /** How many sidebar controls matched the settings name list. */
  readonly controlMatches: number;
  /**
   * The role and accessible name of the control that was actually clicked, or `null` when none was.
   *
   * "One control matched" is not the same fact as "the right control matched": a workspace page TITLED
   * Settings is a link with that exact name, and clicking it navigates instead of opening anything. The
   * report has to name what it pressed.
   */
  readonly clicked: string | null;
  /**
   * Every control name the sidebar offered, populated ONLY when the settings control could not be matched.
   *
   * It is the one thing that makes a "not found" actionable rather than terminal: the Vanta arm's own
   * correction came from a report whose button list had the right name in it all along.
   */
  readonly offered: readonly string[];
  /**
   * Every ARIA role present on the page after the click, as `role=count`.
   *
   * Carried on every observation rather than only on a failure, because a modal that did not open and a
   * modal that opened with nothing in it are the same report otherwise — and the first live run of this arm
   * was exactly that: the sidebar control matched and was clicked, and no `role="dialog"` ever appeared.
   * A role census is what turns that into something the next session can act on in one run instead of two.
   */
  readonly roles: readonly string[];
  /**
   * The class markers of every large positioned overlay on the page, when no dialog was found.
   *
   * The second half of the same diagnosis: a client that renders its settings panel in an unlabelled
   * portal looks exactly like one that never opened it, and this is what tells the two apart.
   */
  readonly overlays: readonly string[];
  /** The refusal the snippet made in the page, having clicked nothing, when it made one. */
  readonly refused: string | null;
  /** Why the modal or the tab would not open, when it would not. */
  readonly dialogError: string | null;
  readonly screenshotPath: string | null;
  readonly screenshotError: string | null;
}

/** Open the modal, read it, optionally select one tab, let go. Bound to one URL at construction. */
export interface NotionSettingsTransport {
  /** Open the modal and describe it, selecting nothing. */
  observe: () => Result<NotionSettingsObservation, BrowserTransportError>;
  /** Open the modal, select the tab these names identify, and report what the client then marked selected. */
  readTab: (options: { tabNames: readonly string[] }) => Result<NotionSettingsObservation, BrowserTransportError>;
  /**
   * Take the relay lease BEFORE the first arm, waiting a bounded time for a live holder
   * (`relayLease.ts` § A contender WAITS). The arms stay synchronous; without this they refuse at once.
   */
  lease: () => Promise<Result<null, BrowserTransportError>>;
  release: () => void;
}

/**
 * How long Notion's client is given to paint, both before the sidebar is read and after each click.
 *
 * Generous because the client is a single-page app that renders its sidebar after first paint, and the
 * failure of being too quick is indistinguishable from the control not existing — which is exactly the
 * confusion this module reports its way out of.
 *
 * @internal
 */
export const NOTION_SETTLE_MS = 6_000;

/**
 * Build the Notion settings transport, bound to one client address for its whole life.
 *
 * @param deps the consent token, the profile pin, the scratch directory, the clock, the home and the
 *   origins the machine-wide relay lease is taken with
 * @param url the client address both arms open — the origin root, because the surface has no other
 * @returns a transport that reads Notion's settings modal in the owner's own Chrome
 */
export function createNotionSettingsTransport({
  deps,
  url,
}: {
  deps: PlaywrightCliDeps;
  url: string;
}): NotionSettingsTransport {
  const scratch = openScratch();
  const session = openSession();
  const offLeaseReason = "this settings transport is bound to the Notion origin the lease was taken with";
  return {
    lease: async () => {
      const held = await holdRelayLease({ deps, session });
      if (held.isErr()) {
        return err(held.error);
      }
      return ok(null);
    },
    observe: () => {
      const screenshotPath = shotPath({ deps });
      return observationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason,
          operation: { kind: "notion-settings-observe", screenshotPath, settleMs: NOTION_SETTLE_MS, url },
          scratch,
          session,
          url,
        }),
        screenshotPath,
      });
    },
    readTab: ({ tabNames }) => {
      const screenshotPath = shotPath({ deps });
      return observationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason,
          operation: { kind: "notion-settings-tab", screenshotPath, settleMs: NOTION_SETTLE_MS, tabNames, url },
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
  };
}

/** Where this invocation's PNG is written. One per operation, so every tab's picture survives its siblings. */
function shotPath({ deps }: { deps: PlaywrightCliDeps }): string {
  return join(deps.scratchDir, `notion-settings-${String(Date.now())}.png`);
}

/**
 * Turn what either arm printed into an observation.
 *
 * A snippet that refused in the page comes back as an observation with `refused` set rather than as a
 * transport failure: a refusal is proof that nothing was clicked, and a transport failure leaves the
 * outcome unknown. The two are different facts and the walk records them differently.
 *
 * @param result what the client printed, or the failure that reached it first
 * @param screenshotPath the path the operation was told to write, which the snippet does not echo back
 * @returns the observation, or why there is none
 *
 * @internal
 */
export function observationFrom({
  result,
  screenshotPath = null,
}: {
  result: Result<string, BrowserTransportError>;
  screenshotPath?: string | null;
}): Result<NotionSettingsObservation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const output = readSnippetOutput({ stdout: result.value });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: "the Notion settings read printed nothing this could parse, so its result never came home",
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
  const written = output["screenshotWritten"] === true;
  return ok({
    clicked: typeof output["clicked"] === "string" ? output["clicked"] : null,
    controlMatches: typeof output["controlMatches"] === "number" ? output["controlMatches"] : 0,
    dialogError: typeof output["dialogError"] === "string" ? output["dialogError"] : null,
    dialogLabel: typeof output["dialogLabel"] === "string" ? output["dialogLabel"] : null,
    dialogOpen: output["dialogOpen"] === true,
    entries: entriesOf({ value: output["entries"] }),
    finalUrl: stringOr({ value: output["finalUrl"] }),
    offered: stringsOf({ value: output["offered"] }),
    overlays: stringsOf({ value: output["overlays"] }),
    refused: typeof output["refused"] === "string" ? output["refused"] : null,
    roles: stringsOf({ value: output["roles"] }),
    screenshotError: typeof output["screenshotError"] === "string" ? output["screenshotError"] : null,
    screenshotPath: written ? screenshotPath : null,
    selectedTabs: stringsOf({ value: output["selectedTabs"] }),
    tabMatches: typeof output["tabMatches"] === "number" ? output["tabMatches"] : null,
    title: stringOr({ value: output["title"] }),
  });
}

/** A string field the snippet may or may not have sent, as a string either way. */
function stringOr({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** A list of strings the snippet may or may not have sent, with anything else dropped. */
function stringsOf({ value }: { value: unknown }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry: unknown): entry is string => typeof entry === "string");
}

/** The navigation entries the snippet described, with anything malformed dropped. */
function entriesOf({ value }: { value: unknown }): readonly NotionSettingsEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown): readonly NotionSettingsEntry[] => {
    if (!isRecord(entry) || typeof entry["name"] !== "string") {
      return [];
    }
    return [
      {
        name: entry["name"],
        role: typeof entry["role"] === "string" ? entry["role"] : "",
        selected: entry["selected"] === true,
      },
    ];
  });
}
