/**
 * The transport that reads the Datadog console's left nav and command palette in the owner's own Chrome.
 *
 * A sibling of `playwrightCli.ts`'s page transport rather than a widening of it, for the reason
 * `notionSettings.ts` is one: `pageTransport.ts` states as a property of its own seam that an implementation
 * *"performs no click, no form submission and no request replay"*, and every atlas walk's safety argument
 * rests on that sentence. This transport hovers and presses one key chord, so it lives behind a different
 * interface. What it shares is `relaySession.ts` — the same machine-wide lease, the same origin binding,
 * the same profile pin, the same owned-tab cleanup, and the same rule that a caller chooses a declared
 * OPERATION, never code. `datadogConsoleSnippet.ts` carries what each arm may do and why both are reads.
 *
 * ## What each arm is FOR, so a reader knows which result a walk grades on
 *
 * `observeNav` is the freshness witness for `atlas/datadog/consolePages.ts`: the declared route table is a
 * hand-carried read of the nav on one date, and this arm re-reads the same nav so the walk can say, every
 * run, whether the console still offers exactly those pages. `observePalette` is the one way to reach the
 * palette's own calls — `POST /api/ui/search/suggestions/entities` and `GET /api/ui/cmd-k/navigation-mappings`
 * are session-authenticated and answer 401 to API keys — and it hands back the same {@link CapturedResponse}
 * shape a page visit does, reduced by the walk to field names before anything is stored.
 */
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  type BrowserTransportError,
  BrowserTransportErrors,
  type CapturedResponse,
  type PageCapture,
  SNIPPET_REPORTED_FAILURE_BECAUSE,
} from "./pageTransport.js";
import { accountingOf, capturedResponsesOf } from "./playwrightCli.js";
import type { RelayLease } from "./relayLease.js";
import { runLeasedOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/**
 * One link the nav rendered inside one section's fly-out.
 * @internal a field type of {@link DatadogNavObservation}
 */
export interface DatadogNavLink {
  /** The section's own label — the first link in its list item. */
  readonly section: string;
  /** The href exactly as rendered, relative to the console origin. */
  readonly href: string;
  readonly label: string;
}

/** What the nav arm saw. */
export interface DatadogNavObservation {
  readonly finalUrl: string;
  readonly title: string;
  /** Every section whose fly-out was hovered and read, in nav order. */
  readonly sections: readonly string[];
  readonly links: readonly DatadogNavLink[];
  /** A hover or read that failed, by the selector it failed on. A section here is unread, not empty. */
  readonly hoverErrors: readonly string[];
}

/** What the palette arm saw. */
export interface DatadogPaletteObservation {
  readonly finalUrl: string;
  readonly title: string;
  /** Whether a dialog was open when the palette was read — the falsifiable half of "the chord worked". */
  readonly dialogOpen: boolean;
  /** The entity-kind filter buttons the palette offered, by their own labels. */
  readonly filterNames: readonly string[];
  /** How many suggestions the palette listed before anything was typed. */
  readonly optionCount: number;
  /** Why the chord could not be pressed, or `null`. */
  readonly keyError: string | null;
  /** The calls the palette made after the chord, on the lease's origins only. */
  readonly responses: readonly CapturedResponse[];
  readonly responseAccounting: PageCapture["responseAccounting"];
  readonly screenshotPath: string | null;
  readonly screenshotError: string | null;
}

/** Read the nav, read the palette, let go. Bound to one console origin at construction. */
export interface DatadogConsoleTransport {
  observeNav: () => Result<DatadogNavObservation, BrowserTransportError>;
  observePalette: () => Result<DatadogPaletteObservation, BrowserTransportError>;
  release: () => void;
}

/**
 * How long the console is given to paint before either arm acts on it.
 *
 * @internal
 */
export const DATADOG_CONSOLE_SETTLE_MS = 6_000;

/**
 * Build the Datadog console transport, bound to one console origin for its whole life.
 *
 * @param deps the consent token, the profile pin, the scratch directory, the clock, the home and the
 *   origins the machine-wide relay lease is taken with
 * @param url the console address both arms open — the origin root, which the console redirects to its
 *   default page
 * @returns a transport that reads the left nav and the command palette in the owner's own Chrome
 */
export function createDatadogConsoleTransport({
  deps,
  url,
}: {
  deps: PlaywrightCliDeps;
  url: string;
}): DatadogConsoleTransport {
  const scratch = openScratch();
  const session = openSession();
  const offLeaseReason = "this console transport is bound to the Datadog origin the lease was taken with";
  return {
    observeNav: () =>
      navObservationFrom({
        result: runLeasedOperation({
          deps,
          offLeaseReason,
          operation: { kind: "datadog-nav-observe", settleMs: DATADOG_CONSOLE_SETTLE_MS, url },
          scratch,
          session,
          url,
        }),
      }),
    observePalette: () => {
      const screenshotPath = join(deps.scratchDir, `datadog-palette-${String(Date.now())}.png`);
      const result = runLeasedOperation({
        deps,
        offLeaseReason,
        operation: { kind: "datadog-palette-observe", screenshotPath, settleMs: DATADOG_CONSOLE_SETTLE_MS, url },
        scratch,
        session,
        url,
      });
      // Read AFTER the operation: the first operation of a session is what takes the lease.
      return paletteObservationFrom({ lease: session.lease, result, screenshotPath });
    },
    release: () => {
      releaseSession({ deps, scratch, session });
    },
  };
}

/** A string field the snippet may or may not have sent, as a string either way. */
function stringOr({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** A list of strings, anything else dropped. */
function stringsOf({ value }: { value: unknown }): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The snippet's `sections` list, flattened to links and to the section names that were read. */
function navLinksOf({ value }: { value: unknown }): { links: readonly DatadogNavLink[]; sections: readonly string[] } {
  if (!Array.isArray(value)) {
    return { links: [], sections: [] };
  }
  const links: DatadogNavLink[] = [];
  const sections: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["section"] !== "string" || !Array.isArray(entry["links"])) {
      continue;
    }
    const section = entry["section"];
    sections.push(section);
    for (const link of entry["links"]) {
      if (isRecord(link) && typeof link["href"] === "string" && typeof link["label"] === "string") {
        links.push({ href: link["href"], label: link["label"], section });
      }
    }
  }
  return { links, sections };
}

/**
 * Turn what the nav arm printed into an observation.
 *
 * @param result what the client printed, or the failure that reached it first
 * @returns the observation, or why there is none
 *
 * @internal
 */
export function navObservationFrom({
  result,
}: {
  result: Result<string, BrowserTransportError>;
}): Result<DatadogNavObservation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const output = readSnippetOutput({ stdout: result.value });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: "the Datadog nav read printed nothing this could parse, so its result never came home",
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
  const nav = navLinksOf({ value: output["sections"] });
  return ok({
    finalUrl: stringOr({ value: output["finalUrl"] }),
    hoverErrors: stringsOf({ value: output["hoverErrors"] }),
    links: nav.links,
    sections: nav.sections,
    title: stringOr({ value: output["title"] }),
  });
}

/**
 * Turn what the palette arm printed into an observation.
 *
 * @param result what the client printed, or the failure that reached it first
 * @param lease the origins the session is bound to, so an off-lease body is dropped exactly as a page
 *   visit drops one; `null` before any operation has taken the lease, in which case nothing is kept
 * @param screenshotPath the path the operation was told to write, which the snippet does not echo back
 * @returns the observation, or why there is none
 *
 * @internal
 */
export function paletteObservationFrom({
  result,
  lease,
  screenshotPath,
}: {
  result: Result<string, BrowserTransportError>;
  lease: RelayLease | null;
  screenshotPath: string;
}): Result<DatadogPaletteObservation, BrowserTransportError> {
  if (result.isErr()) {
    return err(result.error);
  }
  const output = readSnippetOutput({ stdout: result.value });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: "the Datadog palette read printed nothing this could parse, so its result never came home",
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
  const captured = lease === null ? { dropped: 0, kept: [] } : capturedResponsesOf({ lease, output });
  const palette: Record<string, unknown> = isRecord(output["palette"]) ? output["palette"] : {};
  const written = output["screenshotWritten"] === true;
  return ok({
    dialogOpen: palette["dialogOpen"] === true,
    filterNames: stringsOf({ value: palette["filterNames"] }),
    finalUrl: stringOr({ value: output["finalUrl"] }),
    keyError: typeof output["keyError"] === "string" ? output["keyError"] : null,
    optionCount: typeof palette["optionCount"] === "number" ? palette["optionCount"] : 0,
    responseAccounting: accountingOf({ dropped: captured.dropped, output }),
    responses: captured.kept,
    screenshotError: typeof output["screenshotError"] === "string" ? output["screenshotError"] : null,
    screenshotPath: written ? screenshotPath : null,
    title: stringOr({ value: output["title"] }),
  });
}
