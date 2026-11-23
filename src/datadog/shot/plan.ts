/**
 * The plans for a Datadog Explorer capture: what to open in the owner's own Chrome, and what to bring back
 * so `shot file`'s grade can be a real grade.
 *
 * Owner ruling (`docs/browser-route.md`). Datadog is not a doored provider, so
 * `src/admit/browserSurface.ts` has nothing to say about a session driving its console in the owner's own browser.
 * A MONITOR capture is not planned here at all: `datadog shot monitor` takes it itself, through the
 * `datadog-monitor-backtest` relay arm (`browser/datadogMonitorBacktestSnippet.ts`).
 *
 * ## A supplied address is one relay command; only a SEEDED view is briefed
 *
 * Slopweaver's own browser verbs replace Claude in Chrome for everything, so this lane needs no extension of
 * its own. `slopweaver browser shot` photographs a page from a Node process through
 * the extension relay, so an address that needs nothing done to it before the shutter is
 * {@link relayExplorerPlan} — one command, no session leg, and no extension of any kind.
 *
 * A seeded view still needs reading back, because the console silently drops a scope it cannot apply, and
 * no relay arm runs `readExplorerView` yet. That step rides `browser/brief.ts`'s `no-verb-yet` arm and names
 * what would close it, because a brief step that named a Claude-in-Chrome tool would be instructing a lane
 * `src/admit/chromeRetirement.ts` refuses outright.
 */
import { BRIEF_NO_VERB, type ExtensionBrief } from "../../browser/brief.js";
import { readExplorerOptions, readExplorerView } from "./explorerScript.js";

/**
 * The brief for one Explorer view, seeded or supplied.
 *
 * Only reached for a SEEDED view. A supplied address goes to {@link relayExplorerPlan} instead, because
 * there is nothing to read back and therefore nothing the relay cannot do.
 *
 * @param url the address to open
 * @param imagePath where the graded PNG will belong once `shot file` accepts it
 * @param requiredFragments what a SEEDED view must be read back as carrying; never empty
 * @returns the brief to print
 */
export function explorerBrief({
  url,
  imagePath,
  requiredFragments,
}: {
  url: string;
  imagePath: string;
  requiredFragments: readonly string[];
}): ExtensionBrief {
  const readBack = `confirm the rendered view carries: ${requiredFragments.join(", ")}`;
  return {
    finish: `slopweaver datadog shot file --image ${imagePath}`,
    lane: "datadog shot explorer",
    steps: [
      {
        tool: "slopweaver browser open",
        what:
          "take an interaction session on the address above — a SEEDED view has to be read back before it is " +
          "believed, because the console silently drops a scope it cannot apply",
      },
      { tool: "slopweaver browser read", what: "wait for the view to finish drawing" },
      {
        script: `(${readExplorerView.toString()})(${JSON.stringify(readExplorerOptions())})`,
        tool: BRIEF_NO_VERB,
        what: `read the rendered view's own state back — ${readBack}`,
        wouldClose: "a declared relay operation for `readExplorerView` beside `src/browser/datadogConsoleSnippet.ts`",
      },
      { tool: "slopweaver browser shot", what: `save the marked view as ${imagePath}` },
    ],
    url,
  };
}

/**
 * The relay plan for an address that needs nothing done to it before the shutter.
 *
 * Not an {@link ExtensionBrief}: there is no session leg at all here, so a shape whose first line reads
 * "this runs in YOUR Chrome through the extension" would be a lie about the route. It IS the owner's Chrome — the
 * relay attaches to the browser the owner is already running — and no Claude-in-Chrome tool is involved, which is
 * what makes this leg survive the extension being disconnected.
 *
 * `--raw` is on the line because it is the only profile `browser shot` will take a supplied address under:
 * a dashboard or explorer URL matches no evidence adapter, and without `--raw` the verb refuses it as
 * `unsupported-target` (MEASURED on the SDLC dashboard). `--settle` belongs to that profile.
 *
 * @param url the address to photograph
 * @param imagePath where the graded PNG will belong once `shot file` accepts it
 * @returns the lines to print
 */
export function relayExplorerPlan({ url, imagePath }: { url: string; imagePath: string }): readonly string[] {
  return [
    "datadog shot explorer: this address was supplied rather than seeded, so there is nothing to read back",
    "and the whole capture runs through the relay in YOUR Chrome — no extension, no session leg.",
    `  1. slopweaver browser shot --url '${url}' --out ${imagePath} --raw --settle 12000`,
    `then: slopweaver datadog shot file --image ${imagePath}`,
  ];
}
