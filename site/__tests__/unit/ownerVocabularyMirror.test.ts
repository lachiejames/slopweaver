/*
 * The CLI and the console agree on every owner-vocabulary constant a stored value carries.
 *
 * Each console constant sits beside the reader that compares against it — the call speaker in
 * `site/lib/chatThread.ts`, the running list's origin in `site/lib/runningList.ts`, the landing verdict in
 * `site/lib/prNeedsOwner.ts`, the board's wait kind in `site/components/live/readBoardWaits.ts`, the pause subject in
 * `site/lib/workstreams.ts`, the done-check kind in `site/lib/cardCurrency.ts` and the hold reason in
 * `site/components/live/draftJudgement.ts` — because `site/` never imports `src/`; this file, in the lane that reaches
 * both roots, binds each copy to its CLI one. A value changed on one side alone would have the console refuse, or
 * misread, a payload the CLI wrote.
 *
 * The CLI constants are read as SOURCE TEXT, never imported. Each sits in a module whose imports reach `src/config.ts`
 * and the subprocess helpers, and the docs-site build type-checks every file a site test imports under Next's
 * `ProcessEnv`, which those modules do not satisfy. The trade: this binds the string literal written in the source,
 * not the runtime value, so a CLI constant rewritten as anything but a literal fails here rather than passing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ts, withSourceFile } from "../../../src/lib/tsSyntax.js";
import { NOT_OWNER_YES_REASON } from "../../components/live/draftJudgement";
import { OWNER_WAIT_KIND } from "../../components/live/readBoardWaits";
import { OWNER_RULING_DONE_KIND } from "../../lib/cardCurrency";
import { OWNER_SPEAKER } from "../../lib/chatThread";
import { OWNER_JUDGEMENT_VERDICT } from "../../lib/prNeedsOwner";
import { OWNER_ORIGIN } from "../../lib/runningList";
import { OWNER_PAUSE_SUBJECT } from "../../lib/workstreams";

/** The repository root, from this file. */
const ROOT = join(import.meta.dirname, "../../..");

/** Strip `as const`, `satisfies T` and parentheses down to the expression they wrap. */
function unwrapped({ node }: { node: ts.Expression }): ts.Expression {
  if (ts.isSatisfiesExpression(node) || ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapped({ node: node.expression });
  }
  return node;
}

/**
 * The string literal one top-level `const` in a CLI source file is initialised with. Throws when the constant is
 * absent or not a string literal, so a moved or computed constant fails the test loudly.
 */
function cliConstant({ file, name }: { file: string; name: string }): string {
  const path = join(ROOT, file);
  return withSourceFile({
    fileName: path,
    scriptKind: ts.ScriptKind.TS,
    text: readFileSync(path, "utf8"),
    use: (source) => {
      for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) {
          continue;
        }
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
            continue;
          }
          const literal =
            declaration.initializer === undefined ? undefined : unwrapped({ node: declaration.initializer });
          if (literal === undefined || !ts.isStringLiteral(literal)) {
            throw new Error(`${file}: ${name} is not initialised with a string literal`);
          }
          return literal.text;
        }
      }
      throw new Error(`${file}: no top-level const ${name}`);
    },
  });
}

/** Each console constant with the CLI file and constant it restates. */
const PAIRS: readonly { readonly console: string; readonly file: string; readonly name: string }[] = [
  { console: OWNER_SPEAKER, file: "src/talk/callRecord.ts", name: "OWNER_SPEAKER" },
  { console: OWNER_ORIGIN, file: "src/talk/runningList.ts", name: "OWNER_ORIGIN" },
  {
    console: OWNER_JUDGEMENT_VERDICT,
    file: "src/briefing/nothingStalePullRequests.ts",
    name: "OWNER_JUDGEMENT_VERDICT",
  },
  { console: OWNER_WAIT_KIND, file: "src/handover/ownerWait.ts", name: "OWNER_WAIT_KIND" },
  { console: OWNER_PAUSE_SUBJECT, file: "src/handover/pauseSubject.ts", name: "OWNER_PAUSE_SUBJECT" },
  { console: OWNER_RULING_DONE_KIND, file: "src/handover/currency.ts", name: "OWNER_RULING_DONE_KIND" },
  { console: NOT_OWNER_YES_REASON, file: "src/outbound/slack/draftHoldReasons.ts", name: "NOT_OWNER_YES_REASON" },
];

describe("the CLI's and the console's owner vocabulary agree", () => {
  it("holds a non-empty registry", () => {
    expect(PAIRS.length).toBeGreaterThan(0);
  });

  it.each(PAIRS.map((pair) => [pair.name, pair] as const))("on %s", (_name, pair) => {
    expect(pair.console).toBe(cliConstant({ file: pair.file, name: pair.name }));
  });
});
