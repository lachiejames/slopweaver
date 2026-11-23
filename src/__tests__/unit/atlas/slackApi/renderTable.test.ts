/**
 * The generator for the committed browser table, asserted as the exact module text it emits.
 *
 * The two rows differ in every field — name, flag, path count, total and parameter count — so a renderer
 * that read one field into another, or one row into the next, produces a different string.
 */
import { describe, expect, it } from "vitest";

import type { BrowserObservedMethod } from "../../../../atlas/slackApi/model.js";
import { renderBrowserModule } from "../../../../atlas/slackApi/renderTable.js";

/** The header and table opening every generated module carries, verbatim. */
const HEADER = [
  "/**",
  " * The undocumented Slack surface, as the first-party web client actually calls it.",
  " *",
  " * GENERATED — do not hand-edit. Rebuild from a fresh browser capture with:",
  " *",
  " *   slopweaver atlas slack-api --from-har <file.har> > src/atlas/slackApi/browser.ts",
  " *",
  " * Every entry is a NAME: a method, a parameter, or a response field path. No token, cookie, header,",
  " * request body or response value is retained, and a path segment that was itself a value — a message",
  " * timestamp or a Slack object id used as a map key — is redacted to `<ts>` or `<id>`. That reduction is",
  " * `harObservations.ts`, which is committed and tested precisely so it can be reviewed rather than trusted.",
  " *",
  " * ## Why an undocumented surface belongs in an atlas at all",
  " *",
  " * Most of these methods cannot be called with a bot or user token, and this file never claims they can:",
  " * `publicSurface` says only whether the installed SDK declares the same NAME. Their value is the value of",
  " * the Datadog atlas's `listed` rows — they reveal what data Slack HOLDS and is willing to compute. The",
  " * highest-value row is `conversations.history`, which the SDK does declare: the web client sends it seven",
  " * parameters no public page documents and gets back response fields no public page documents either.",
  " * Whether an ordinary token can ask for the same thing is a question this file makes ASKABLE. It is not an",
  " * answer.",
  " */",
  'import type { BrowserObservedMethod } from "./model.js";',
  "",
  "/** Every method seen on the wire in the capture, sorted by name. */",
  "export const BROWSER_OBSERVED_METHODS: readonly BrowserObservedMethod[] = [",
].join("\n");

/** A method the SDK does not declare, with an escaped path; sorts SECOND. */
const USERS_PREFS: BrowserObservedMethod = {
  name: "users.prefs.get",
  publicSurface: false,
  responsePaths: ['prefs."theme"', "ok\\flag"],
  responsePathsTotal: 7,
  undocumentedParams: ["_x_reason"],
};

/** A method the SDK declares; sorts FIRST. */
const CONVERSATIONS_HISTORY: BrowserObservedMethod = {
  name: "conversations.history",
  publicSurface: true,
  responsePaths: ["messages.<ts>.text"],
  responsePathsTotal: 3,
  undocumentedParams: ["include_pin_count", "no_user_profile"],
};

/** A third method, for the ordering case; sorts between the other two. */
const DND_INFO: BrowserObservedMethod = {
  name: "dnd.info",
  publicSurface: true,
  responsePaths: [],
  responsePathsTotal: 0,
  undocumentedParams: [],
};

describe("renderBrowserModule", () => {
  it("renders two rows, given in reverse name order, as the exact sorted module", () => {
    expect(renderBrowserModule({ rows: [USERS_PREFS, CONVERSATIONS_HISTORY] })).toBe(
      [
        HEADER,
        "  {",
        '    name: "conversations.history",',
        "    publicSurface: true,",
        '    responsePaths: ["messages.<ts>.text"],',
        "    responsePathsTotal: 3,",
        '    undocumentedParams: ["include_pin_count", "no_user_profile"],',
        "  },",
        "  {",
        '    name: "users.prefs.get",',
        "    publicSurface: false,",
        String.raw`    responsePaths: ["prefs.\"theme\"", "ok\\flag"],`,
        "    responsePathsTotal: 7,",
        '    undocumentedParams: ["_x_reason"],',
        "  },",
        "];",
        "",
      ].join("\n"),
    );
  });

  it("renders an empty table as the header and a closed array", () => {
    expect(renderBrowserModule({ rows: [] })).toBe(`${HEADER}\n\n];\n`);
  });

  it("sorts shuffled rows by name without reordering the caller's array", () => {
    const rows = [USERS_PREFS, DND_INFO, CONVERSATIONS_HISTORY];
    const names = renderBrowserModule({ rows })
      .split("\n")
      .filter((line) => line.startsWith("    name: "));
    expect(names).toEqual([
      '    name: "conversations.history",',
      '    name: "dnd.info",',
      '    name: "users.prefs.get",',
    ]);
    expect(rows.map((row) => row.name)).toEqual(["users.prefs.get", "dnd.info", "conversations.history"]);
  });
});
