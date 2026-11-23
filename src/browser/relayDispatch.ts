/**
 * The dispatch from a declared {@link RelayOperation} to the snippet source the terminal client runs — the
 * ONE place a relay snippet is produced.
 *
 * Split out of `relaySession.ts`, which owns a session's lifecycle (lease, attach, client, cleanup), because
 * this half is a different concern with a different reviewer question: not "does the session clean up" but
 * "what can this machine do to a page in the owner's browser". `relayOperation.ts` declares that set; this module is
 * the only thing that turns a member of it into code. `relaySession.ts`'s file overview carries why the union
 * is closed and who may add an arm.
 */
import { datadogNavObserveSnippet, datadogPaletteObserveSnippet } from "./datadogConsoleSnippet.js";
import { datadogMonitorBacktestSnippet } from "./datadogMonitorBacktestSnippet.js";
import { evidenceCaptureSnippet } from "./evidenceCaptureSnippet.js";
import { fathomShareTranscriptSnippet } from "./fathomShareSnippet.js";
import { notionSettingsObserveSnippet, notionSettingsTabSnippet } from "./notionSettingsSnippet.js";
import { pageVisitSnippet } from "./pageVisitSnippet.js";
import type { RelayOperation } from "./relayOperation.js";
import { vantaDraftEditSnippet, vantaDraftObserveSnippet } from "./vantaPolicyEditorSnippet.js";
import { vantaPolicyVersionObserveSnippet, vantaPolicyVersionUploadSnippet } from "./vantaPolicyVersionSnippet.js";

/**
 * The snippet source for one operation.
 *
 * **It takes no callback and no source.** An earlier shape passed the page-visit builder in as a parameter,
 * and a Codex review pass found the hole in one read: a caller returning its own string from that parameter
 * had arbitrary code running in the owner's Chrome with no door in front of it. `pageVisitSnippet.ts`
 * carries the whole account. Every arm below resolves to a builder this module imports.
 *
 * **Dispatch is exhaustive, and an unknown kind throws before any source exists.** It used to end in the
 * Vanta EDIT builder as the else-arm, so an operation record with a kind nothing here declared — reachable
 * from a JSON document, if never from a typed caller — would have been typed into a policy draft. A review
 * named it and the `default` below is the fix: a `never` the compiler checks, and a throw
 * a test can reach with a forged discriminant.
 *
 * @param operation the declared operation
 * @returns the snippet source to hand the terminal client
 *
 * @internal
 */
// max-lines-exempt: one exhaustive switch over the capability union, and its length IS the capability count. Splitting it into per-family dispatchers would give each a `string | null` return and destroy the `never` default that makes a forgotten arm a compile error — the exact hole Codex found here.
export function relayOperationSnippet({ operation }: { operation: RelayOperation }): string {
  switch (operation.kind) {
    case "page-visit":
      return pageVisitSnippet({
        photograph: operation.photograph,
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "page-evidence-capture":
      return evidenceCaptureSnippet({
        readinessTimeoutMs: operation.readinessTimeoutMs,
        screenshotPath: operation.screenshotPath,
        target: operation.target,
        url: operation.url,
      });
    case "fathom-share-transcript":
      return fathomShareTranscriptSnippet({ settleMs: operation.settleMs, url: operation.url });
    case "notion-settings-observe":
      return notionSettingsObserveSnippet({
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "notion-settings-tab":
      return notionSettingsTabSnippet({
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        tabNames: operation.tabNames,
        url: operation.url,
      });
    case "datadog-nav-observe":
      return datadogNavObserveSnippet({ settleMs: operation.settleMs, url: operation.url });
    case "datadog-palette-observe":
      return datadogPaletteObserveSnippet({
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "datadog-monitor-backtest":
      return datadogMonitorBacktestSnippet({
        readinessTimeoutMs: operation.readinessTimeoutMs,
        screenshotPath: operation.screenshotPath,
        url: operation.url,
      });
    case "vanta-draft-observe":
      return vantaDraftObserveSnippet({
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "vanta-draft-edit":
      return vantaDraftEditSnippet({
        expectedText: operation.expectedText,
        find: operation.find,
        replace: operation.replace,
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "vanta-policy-version-observe":
      return vantaPolicyVersionObserveSnippet({
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    case "vanta-policy-version-upload":
      return vantaPolicyVersionUploadSnippet({
        beforeScreenshotPath: operation.beforeScreenshotPath,
        pdfPath: operation.pdfPath,
        screenshotPath: operation.screenshotPath,
        settleMs: operation.settleMs,
        url: operation.url,
      });
    default: {
      const unknown: never = operation;
      throw new Error(`relay operation kind is not one this module declares: ${JSON.stringify(unknown)}`);
    }
  }
}
