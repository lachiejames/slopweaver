/**
 * The CLOSED set of operations a relay snippet may be — the capability surface of every browser leg on this
 * machine, split out of `relaySession.ts` (which dispatches on it) so the list reads as one declaration.
 *
 * `relaySession.ts`'s file overview carries why the union is closed and who may add an arm.
 */
import type { EvidenceTarget } from "../visualEvidence/evidenceTarget.js";

/**
 * Everything one relay operation needs, beyond the session it runs in.
 *
 * **This union is the capability surface of this whole module.** Adding an arm is adding something the
 * fleet may do to a page in the owner's browser, so an arm arrives with the verb that is allowed to ask for it and
 * the gate that stands in front of that verb — never on its own.
 */
export type RelayOperation =
  /** Navigate, settle, observe, optionally photograph. The only arm any atlas walk can reach. */
  | {
      readonly kind: "page-visit";
      readonly url: string;
      readonly settleMs: number;
      readonly photograph: boolean;
      readonly screenshotPath: string;
    }
  /**
   * Navigate, WAIT for one closed, source-owned target to render, photograph the whole page, observe the
   * target again. Reads only, and the only arm `browser shot` runs by default — `evidenceCaptureSnippet.ts`
   * carries why a settle could never do this. `target` is an enum, never a selector.
   */
  | {
      readonly kind: "page-evidence-capture";
      readonly url: string;
      readonly screenshotPath: string;
      readonly target: EvidenceTarget;
      readonly readinessTimeoutMs: number;
    }
  /**
   * Open one Fathom SHARE page and read its call and raw transcript cues off the page's own element.
   * Reads only, and clicks nothing — `fathomShareSnippet.ts` carries the measurement. The only verb that
   * asks is `fathom share`.
   */
  | {
      readonly kind: "fathom-share-transcript";
      readonly url: string;
      readonly settleMs: number;
    }
  /**
   * Open Notion's settings modal from the sidebar and describe it, selecting nothing. Reads only.
   *
   * Notion's settings surface has no address — MEASURED, 0 of 32 declared routes reached — so
   * this is the only arm that can see it at all. It clicks ONE control, chosen by an accessible name on a
   * closed list in `notionSettingsSnippet.ts`, and nothing inside the modal.
   */
  | {
      readonly kind: "notion-settings-observe";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
    }
  /**
   * The same, plus select ONE settings tab and photograph its panel. Reads only.
   *
   * `tabNames` is the name list `atlas/notion/settingsTabs.ts` resolves a closed tab id to — never a
   * selector, and never a name a caller composed. Nothing else inside the modal is ever clicked: it holds
   * controls that delete a workspace, remove a member and start a purchase.
   */
  | {
      readonly kind: "notion-settings-tab";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
      readonly tabNames: readonly string[];
    }
  /**
   * Hover every top-level entry of the Datadog left nav and read each fly-out's links. Reads only.
   *
   * The one arm that hovers, and it hovers nothing but the nav's own entries, matched by the two lists'
   * accessible labels fixed in `datadogConsoleSnippet.ts`. It is how `atlas datadog walk` checks its
   * declared page list against what the console offers today.
   */
  | {
      readonly kind: "datadog-nav-observe";
      readonly url: string;
      readonly settleMs: number;
    }
  /**
   * Open the Datadog command palette with its own fixed key chord, capture the calls it makes, describe
   * the dialog, photograph it and close it with Escape. Reads only — nothing is typed and no option is
   * chosen. The only way to reach `POST /api/ui/search/suggestions/entities`, which answers 401 to API keys.
   */
  | {
      readonly kind: "datadog-palette-observe";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
    }
  /**
   * Open one Datadog monitor's EDIT page, set its time-range picker to Past 1 Week, wait for the "Monitor
   * behavior with this threshold" panel to settle, mark it, and photograph the marked region. The only verb
   * that asks is `datadog shot monitor`.
   *
   * It clicks two things, both on the backtest's own time control: the picker, and the `Past 1 Week` preset
   * the picker opened. Nothing in the monitor form — no field, no Save — and nothing is typed.
   * `datadogMonitorBacktestSnippet.ts` carries why that is a read.
   */
  | {
      readonly kind: "datadog-monitor-backtest";
      readonly url: string;
      readonly screenshotPath: string;
      readonly readinessTimeoutMs: number;
    }
  /**
   * Open one Vanta policy editor and describe it: which editor element holds the draft, its text, its
   * workflow controls. Reads only — it is what a write is judged against.
   */
  | {
      readonly kind: "vanta-draft-observe";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
    }
  /**
   * Apply ONE exact text substitution to a Vanta policy draft and save it.
   *
   * Both strings are data baked in as JSON literals, never control flow, and the snippet refuses unless
   * `find` occurs exactly once in the editor's text and the result matches `expectedText` byte for byte.
   */
  | {
      readonly kind: "vanta-draft-edit";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
      readonly find: string;
      readonly replace: string;
      readonly expectedText: string;
    }
  /**
   * Open ONE Vanta policy page, open its overflow menu, and report what that menu offers. Reads only.
   *
   * The one click a read arm takes, and it takes it on a disclosure control alone — a menu's contents do
   * not exist in the DOM until it is opened, so there is no other way to learn whether this tenant's
   * policies offer an upload-a-version route at all. It clicks no item and touches no file input.
   */
  | {
      readonly kind: "vanta-policy-version-observe";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
    }
  /**
   * Start a new VERSION of one Vanta policy and, when a file is named, upload it — leaving it a draft.
   *
   * A write from its first click: starting a renewal creates a draft of a live compliance document. It
   * never clicks a control that would submit or publish one, and with `pdfPath` null it stops once the
   * draft exists and reports what the screen offers.
   */
  | {
      readonly kind: "vanta-policy-version-upload";
      readonly url: string;
      readonly settleMs: number;
      readonly screenshotPath: string;
      readonly beforeScreenshotPath: string;
      readonly pdfPath: string | null;
    };
