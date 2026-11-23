/*
 * The console-loading-prose gate's own tests: it must catch a loading line written as words in each place the
 * console writes one — JSX text, a string, a template — and leave a progress indicator's label, a failed read's
 * sentence, a pressed button's busy label and a comment alone.
 */

import { describe, expect, it } from "vitest";

import { isScannablePath, scanConsoleLoadingProse } from "../../../devLint/consoleLoadingProse.js";

const lines = ({ content }: { content: string }): readonly string[] =>
  scanConsoleLoadingProse({ content, path: "site/components/live/X.tsx" }).map(
    (hit) => `${String(hit.line)}: ${hit.text}`,
  );

describe("scanConsoleLoadingProse", () => {
  it("catches a loading line in JSX text, a string and a template, with the words it shows", () => {
    const content = [
      'const a = <p className="sw-tile-loading">reading the machine…</p>;',
      'const b = { text: "watchers: reading…" };',
      "const c = <p>{`reading ${repo} from GitHub…`}</p>;",
      'const d = "Loading this card...";',
      'const e = { words: " · re-reading…" };',
    ].join("\n");
    expect(lines({ content })).toEqual([
      "1: reading the machine…",
      "2: watchers: reading…",
      "3: reading   from GitHub…",
      "4: Loading this card...",
      "5: · re-reading…",
    ]);
  });

  it("leaves an indicator's label, a failed read, a busy button and a comment alone", () => {
    const content = [
      '<Spinner label="reading the board" />;',
      'const why = "the board did not read (the verb timed out)";',
      'const button = { button: "sending…" };',
      "// reading the machine… is what this replaced",
      "/* loading… */",
    ].join("\n");
    expect(lines({ content })).toEqual([]);
  });

  it("parses a .ts file as TypeScript, where an angle-bracket assertion is not JSX", () => {
    const content = 'const n = <number>value;\nconst t = "reading the ledger…";';
    expect(
      scanConsoleLoadingProse({ content, path: "site/lib/x.ts" }).map((hit) => `${String(hit.line)}: ${hit.text}`),
    ).toEqual(["2: reading the ledger…"]);
  });
});

describe("isScannablePath", () => {
  it("scans the console's TypeScript and TSX, never its tests, another tree or the gate's own files", () => {
    expect([
      isScannablePath({ path: "site/components/live/Fleet.tsx" }),
      isScannablePath({ path: "site/lib/prFreshness.ts" }),
      isScannablePath({ path: "site/__tests__/unit/prFreshness.test.ts" }),
      isScannablePath({ path: "src/cli/commands/x.ts" }),
      isScannablePath({ path: "site/content/docs/console.md" }),
      isScannablePath({ path: "src/devLint/consoleLoadingProse.ts" }),
    ]).toEqual([true, true, false, false, false, false]);
  });
});
