/**
 * The `browser` verbs that make or vouch for a PICTURE, split out of `./browser.ts` when that manifest passed its
 * size ratchet: `shot` photographs a page in the owner's own Chrome, `terminal-shot` renders terminal text,
 * `console-shot` photographs a click-through of this checkout's console over a throwaway fixture store, `annotate`
 * and `redact` draw onto a picture already taken, and `image-record` records what a session SAW in one.
 *
 * They belong together because each one's output is a picture an outbound attachment is admitted against
 * (`../../visualEvidence/`): every capture files a receipt, every drawing derives a new picture, and the record
 * is what the attachment gate reads. None reaches a provider or writes outside the machine, so none is
 * door-routed — `shot` drives the owner's own Chrome, which doctrine rule 3 makes the door (`./browser.ts`).
 */
import { BROWSER_USAGE } from "../commands/browser/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const loadBrowser = () => import("../commands/browser/profileRun.js").then((m) => m.browserCommand);

const shotMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    "slopweaver browser shot --url 'https://us3.datadoghq.com/logs?viz=timeseries&query=...' --out /tmp/panel.png",
  parseRejectIsIoFree: true,
  summary:
    "Wait for a page's target to render, photograph it through the Playwright extension relay in your own " +
    "Chrome, crop to the target and its context, frame and caption it — the screenshot route for every " +
    "session, never the Claude-in-Chrome extension; the result is readback-pending until image-record",
  usage: BROWSER_USAGE,
} as const;

const imageRecordMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser image-record --form ./looked-at.json",
  parseRejectIsIoFree: true,
  summary:
    "Write down what you SAW in an image, so it may be attached to an outbound message — an image with no " +
    "such record cannot be sent, and one recorded unfit can never be",
  usage: BROWSER_USAGE,
} as const;

const annotateMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser annotate --form ./annotate.json",
  parseRejectIsIoFree: true,
  summary:
    "Draw boxes and their notes onto an existing PNG and write a pre-filled image-record form beside it — no " +
    "record until you have looked at the result and run image-record on that form",
  usage: BROWSER_USAGE,
} as const;

const terminalShotMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser terminal-shot --form ./terminal-shot.json",
  parseRejectIsIoFree: true,
  summary:
    "Render terminal text to a PNG and file the capture receipt recording the exact words drawn — local proof " +
    "`github attach` holds until a figure check exists",
  usage: BROWSER_USAGE,
} as const;

const consoleShotMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    "slopweaver browser console-shot --walk automations-context --out $SLOPWEAVER_HOME/proof/<slug>/automations-context.png",
  parseRejectIsIoFree: true,
  summary:
    "Photograph one registered click-through of this checkout's console over a throwaway store holding the " +
    "synthetic organisation, and file the capture receipt `github attach` admits, the one verb it does",
  usage: BROWSER_USAGE,
} as const;

const redactMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver browser redact --form ./redact.json",
  parseRejectIsIoFree: true,
  summary:
    "Burn opaque rectangles into a captured PNG as a new file with a child receipt pointing at its parent — " +
    "never a blur, never an overlay",
  usage: BROWSER_USAGE,
} as const;

/** The picture verbs' entries, spread into `./browser.ts`'s manifest. */
export const browserPictureManifest: Readonly<Record<string, VerbManifestEntry>> = {
  annotate: lazy({ load: loadBrowser, meta: annotateMeta }),
  "console-shot": lazy({ load: loadBrowser, meta: consoleShotMeta }),
  "image-record": lazy({ load: loadBrowser, meta: imageRecordMeta }),
  redact: lazy({ load: loadBrowser, meta: redactMeta }),
  shot: lazy({ load: loadBrowser, meta: shotMeta }),
  "terminal-shot": lazy({ load: loadBrowser, meta: terminalShotMeta }),
};
