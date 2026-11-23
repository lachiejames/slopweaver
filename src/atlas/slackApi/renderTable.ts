/**
 * Render browser observations back out as the TypeScript module that holds them.
 *
 * The generated table is committed rather than synced, because a browser capture is a deliberate act by a
 * human and no verb can go and fetch one. Committing generated code is only honest if the generator is
 * runnable, so this renderer and the `--from-har` flag that drives it exist to make the file reproducible:
 * a reader can regenerate `browser.ts` from a fresh capture and diff it.
 */
import type { BrowserObservedMethod } from "./model.js";

/** The doc comment the generated module carries. Kept here so the generator owns the whole file. */
const MODULE_HEADER = `/**
 * The undocumented Slack surface, as the first-party web client actually calls it.
 *
 * GENERATED — do not hand-edit. Rebuild from a fresh browser capture with:
 *
 *   slopweaver atlas slack-api --from-har <file.har> > src/atlas/slackApi/browser.ts
 *
 * Every entry is a NAME: a method, a parameter, or a response field path. No token, cookie, header,
 * request body or response value is retained, and a path segment that was itself a value — a message
 * timestamp or a Slack object id used as a map key — is redacted to \`<ts>\` or \`<id>\`. That reduction is
 * \`harObservations.ts\`, which is committed and tested precisely so it can be reviewed rather than trusted.
 *
 * ## Why an undocumented surface belongs in an atlas at all
 *
 * Most of these methods cannot be called with a bot or user token, and this file never claims they can:
 * \`publicSurface\` says only whether the installed SDK declares the same NAME. Their value is the value of
 * the Datadog atlas's \`listed\` rows — they reveal what data Slack HOLDS and is willing to compute. The
 * highest-value row is \`conversations.history\`, which the SDK does declare: the web client sends it seven
 * parameters no public page documents and gets back response fields no public page documents either.
 * Whether an ordinary token can ask for the same thing is a question this file makes ASKABLE. It is not an
 * answer.
 */
import type { BrowserObservedMethod } from "./model.js";

/** Every method seen on the wire in the capture, sorted by name. */
export const BROWSER_OBSERVED_METHODS: readonly BrowserObservedMethod[] = [`;

/**
 * Render the observations as a complete, formatter-ready TypeScript module.
 *
 * Sorts a copy by name itself rather than trusting the caller's order, because the header it emits says
 * the table is sorted and a generator whose output contradicts its own header is not reproducible.
 *
 * @param rows the observations to render, in any order
 * @returns the module source
 */
export function renderBrowserModule({ rows }: { rows: readonly BrowserObservedMethod[] }): string {
  const body = rows
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((row) =>
      [
        "  {",
        `    name: ${JSON.stringify(row.name)},`,
        `    publicSurface: ${String(row.publicSurface)},`,
        `    responsePaths: [${row.responsePaths.map((path) => JSON.stringify(path)).join(", ")}],`,
        `    responsePathsTotal: ${String(row.responsePathsTotal)},`,
        `    undocumentedParams: [${row.undocumentedParams.map((param) => JSON.stringify(param)).join(", ")}],`,
        "  },",
      ].join("\n"),
    )
    .join("\n");
  return `${MODULE_HEADER}\n${body}\n];\n`;
}
