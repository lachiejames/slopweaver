/**
 * The app-copy-voice gate's own tests: every literal shape the app writes copy in is read, comments and regexes are
 * not, an HTML entity counts as the dash it renders, and the scope is the app and nothing beside it.
 */
import { describe, expect, it } from "vitest";
import { countsOf, isScannablePath, scanAppCopyVoice } from "../../../devLint/appCopyVoice.js";

/** The parts of a hit a case asserts, with the offset left out because it only keeps two findings apart. */
const shapes = ({ path, content }: { path: string; content: string }) =>
  scanAppCopyVoice({ content, path }).map((hit) => ({
    dashes: hit.dashes,
    kind: hit.kind,
    line: hit.line,
    preview: hit.preview,
  }));

describe("scanAppCopyVoice", () => {
  it("reads every literal shape a page writes copy in, attribute strings included", () => {
    const content = [
      'const a = "load is high — so hold";',
      "const b = `no holes — here`;",
      "const c = `${a} — then ${b} — end`;",
      'const d = <p title="a – b">seven working — busy</p>;',
    ].join("\n");

    expect(shapes({ content, path: "site/components/live/Example.tsx" })).toStrictEqual([
      { dashes: ["em-dash"], kind: "string-literal", line: 1, preview: "load is high — so hold" },
      { dashes: ["em-dash"], kind: "no-substitution-template", line: 2, preview: "no holes — here" },
      { dashes: ["em-dash"], kind: "template-middle", line: 3, preview: "— then" },
      { dashes: ["em-dash"], kind: "template-tail", line: 3, preview: "— end" },
      { dashes: ["en-dash"], kind: "string-literal", line: 4, preview: "a – b" },
      { dashes: ["em-dash"], kind: "jsx-text", line: 4, preview: "seven working — busy" },
    ]);
  });

  it("reads a template head, and a literal carrying both dashes once", () => {
    const content = "const a = `from — 1–2 ${x}`;";

    expect(shapes({ content, path: "site/lib/example.ts" })).toStrictEqual([
      { dashes: ["em-dash", "en-dash"], kind: "template-head", line: 1, preview: "from — 1–2" },
    ]);
  });

  it("counts an HTML entity as the dash JSX renders it into", () => {
    const content = "const d = <p>a &mdash; b &#8211; c</p>;";

    expect(shapes({ content, path: "site/components/live/Example.tsx" })).toStrictEqual([
      { dashes: ["em-dash", "en-dash"], kind: "jsx-text", line: 1, preview: "a &mdash; b &#8211; c" },
    ]);
  });

  it("counts a numeric entity with leading zeros, which renders the same dash", () => {
    const content = ["const d = <p>a &#x02014; b</p>;", "const e = <p>a &#008211; b</p>;"].join("\n");

    expect(shapes({ content, path: "site/components/live/Example.tsx" })).toStrictEqual([
      { dashes: ["em-dash"], kind: "jsx-text", line: 1, preview: "a &#x02014; b" },
      { dashes: ["en-dash"], kind: "jsx-text", line: 2, preview: "a &#008211; b" },
    ]);
  });

  it("counts an escaped dash, which decodes into the character", () => {
    const content = 'const a = "a \\u2014 b";';

    expect(shapes({ content, path: "site/lib/example.ts" })).toStrictEqual([
      { dashes: ["em-dash"], kind: "string-literal", line: 1, preview: "a — b" },
    ]);
  });

  it("passes hyphens, comments and regular expressions", () => {
    const content = [
      "// a comment — never copy",
      "/** a doc block — never copy */",
      'const a = "re-run the well-known check";',
      "const b = /\\u2014|—/u;",
    ].join("\n");

    expect(scanAppCopyVoice({ content, path: "site/lib/example.ts" })).toStrictEqual([]);
  });

  it("keeps two dashed literals on one line as two findings", () => {
    const hits = scanAppCopyVoice({ content: 'const a = ["a — b", "c — d"];', path: "site/lib/example.ts" });

    expect(hits.map((hit) => hit.offset)).toStrictEqual([11, 20]);
  });
});

describe("countsOf", () => {
  it("collapses hits into one entry per file, in path order", () => {
    const hits = [
      ...scanAppCopyVoice({ content: 'const a = ["x — y", "z — w"];', path: "site/lib/b.ts" }),
      ...scanAppCopyVoice({ content: 'const a = "x — y";', path: "desktop/src/a.ts" }),
    ];

    expect(countsOf({ hits })).toStrictEqual([
      { count: 1, path: "desktop/src/a.ts" },
      { count: 2, path: "site/lib/b.ts" },
    ]);
  });

  it("counts nothing when nothing fired", () => {
    expect(countsOf({ hits: [] })).toStrictEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the app's own TypeScript and nothing beside it", () => {
    const paths = [
      "site/app/(console)/layout.tsx",
      "site/components/live/Now.tsx",
      "site/lib/fleetState.ts",
      "desktop/src/shellState.ts",
      "site/lib/appCopyVoice.ts",
      "site/lib/my__tests__/copy.ts",
      "site/content/console/fleet.mdx",
      "site/__tests__/unit/fleetState.test.ts",
      "desktop/__tests__/unit/shellState.test.ts",
      "site/components/live/Now.test.tsx",
      "site/lib/fleetState.test.ts",
      "site/next.config.mjs",
      "src/devLint/appCopyVoice.ts",
      "src/lib/date.ts",
    ];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual([
      "site/app/(console)/layout.tsx",
      "site/components/live/Now.tsx",
      "site/lib/fleetState.ts",
      "desktop/src/shellState.ts",
      "site/lib/appCopyVoice.ts",
      "site/lib/my__tests__/copy.ts",
    ]);
  });
});
