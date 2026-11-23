/**
 * The diagram ratchet.
 *
 * Three describe blocks. The first exercises the PURE extractor on inline Mermaid fixtures and never touches
 * disk. The second reads every real `docs/diagrams/*.mmd` against the real CLI manifest and the real
 * filesystem, and — unlike `staleReferences.test.ts`, whose corpus predates its checker — allows NO
 * known-stale list: these diagrams were drawn against this gate, so a label that stops resolving is a
 * diagram that has drifted from the code, which is the one failure a picture must not be allowed.
 *
 * The third closes the gap the split file layout opens. Each diagram is authored once as a `.mmd` and read
 * somewhere else, inlined as a fenced block; two copies of one picture drift, and the first disagreement
 * between them is unresolvable. So the fence is asserted to be the file, byte for byte, and every page that
 * could carry one is read, so each diagram is drawn on exactly one page: its owner, and nowhere else. A page is
 * read as GitHub renders it, so a fence quoted inside a longer fence, a comment or a template draws nothing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { parse } from "parse5";
import { describe, expect, it } from "vitest";
import { diagramReferences, scanDiagramFile } from "../../../canon/diagramReferences.js";
import { addressesFromManifestModules, formatOffender, type VerbAddress } from "../../../canon/staleReferences.js";
import { MANIFEST_MODULES } from "../../../cli/manifests/index.js";
import { childrenOf, isElement, type Node } from "../../../prformat/drawnNodes.js";

const ADDRESSES: readonly VerbAddress[] = [
  { noun: "turn", usage: "usage: slopweaver turn brief [--home <value>]", verb: "brief" },
  { noun: "refresh", usage: "usage: slopweaver refresh run [--source <value>]", verb: "run" },
];

/** A node's text and every descendant's, as `textContent` reads it: comments and a template's content add none. */
function textUnder({ node }: { node: Node }): string {
  if ("value" in node) {
    return node.value;
  }
  if (isElement(node) && node.tagName === "template") {
    return "";
  }
  return childrenOf({ node })
    .map((child) => textUnder({ node: child }))
    .join("");
}

/**
 * The text of every Mermaid code element under a node, skipping a template's inert content. Any `<code>` carrying
 * the class counts, whatever wraps it, sits inside it or nests in it, so a copy cannot hide behind markup.
 */
function mermaidBlocksUnder({ node }: { node: Node }): readonly string[] {
  if (isElement(node) && node.tagName === "template") {
    return [];
  }
  const isMermaidBlock =
    isElement(node) &&
    node.tagName === "code" &&
    node.attrs.some((attr) => attr.name === "class" && attr.value.split(/\s+/u).includes("language-mermaid"));
  const nested = childrenOf({ node }).flatMap((child) => mermaidBlocksUnder({ node: child }));
  return isMermaidBlock ? [textUnder({ node }), ...nested] : nested;
}

/**
 * The Mermaid diagrams a page draws, read from its rendered HTML — CommonMark plus GFM with raw HTML kept, the
 * way the doc-links gate renders it — so a fence quoted in a longer fence, a comment or a template draws nothing.
 */
const drawnDiagrams = ({ content }: { content: string }): readonly string[] =>
  mermaidBlocksUnder({
    node: parse(micromark(content, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] }), {
      scriptingEnabled: false,
    }),
  });

const ALWAYS_EXISTS = (): boolean => true;
const NEVER_EXISTS = (): boolean => false;

describe("drawnDiagrams", () => {
  const diagram = "flowchart TB\n  a --> b\n";
  const fence = `\`\`\`mermaid\n${diagram}\`\`\``;
  const serialised = '<pre><code class="language-mermaid">flowchart TB\n  a --&gt; b\n</code></pre>';

  it("reads a Mermaid fence the page draws", () => {
    expect(drawnDiagrams({ content: `# Page\n\n${fence}\n` })).toEqual([diagram]);
  });

  it("reads nothing when the same bytes are quoted inside a longer fence", () => {
    expect(drawnDiagrams({ content: `\`\`\`\`text\n${fence}\n\`\`\`\`\n` })).toEqual([]);
  });

  it("reads nothing when the fence, or its already-rendered HTML, sits inside a comment", () => {
    expect(drawnDiagrams({ content: `<!--\n${fence}\n-->\n` })).toEqual([]);
    expect(drawnDiagrams({ content: `<!--\n\`\`\`mermaid\n${serialised}\n-->\n` })).toEqual([]);
  });

  it("reads nothing inside a template, and reads a raw HTML block the page does draw", () => {
    expect(drawnDiagrams({ content: `<template>\n\n${fence}\n\n</template>\n` })).toEqual([]);
    expect(drawnDiagrams({ content: `${serialised}\n` })).toEqual([diagram]);
  });

  it("reads a Mermaid code element nested inside another, as well as the outer one", () => {
    const nested =
      '<pre><code class="language-mermaid">prefix<code class="language-mermaid">flowchart TB\n  a --&gt; b\n</code>suffix</code></pre>';
    expect(drawnDiagrams({ content: `${nested}\n` })).toEqual([`prefix${diagram}suffix`, diagram]);
  });

  it("reads a diagram whose text sits beneath markup inside the code element, or one not wrapped in a pre", () => {
    const wrapped = '<pre><code class="language-mermaid"><span>flowchart TB\n  a --&gt; b\n</span></code></pre>';
    expect(drawnDiagrams({ content: `${wrapped}\n` })).toEqual([diagram]);
    expect(
      drawnDiagrams({ content: '<div><code class="language-mermaid">flowchart TB\n  a --&gt; b\n</code></div>\n' }),
    ).toEqual([diagram]);
  });
});

describe("diagramReferences", () => {
  it("pulls a path out of a quoted node label", () => {
    expect(diagramReferences({ content: '  a["The brief<br/>src/live/turn/brief.ts"]' })).toEqual([
      "src/live/turn/brief.ts",
    ]);
  });

  it("stops a path at the Mermaid line break that follows it", () => {
    expect(diagramReferences({ content: '  a["src/admit/door.ts<br/>then more"]' })).toEqual(["src/admit/door.ts"]);
  });

  it("drops a trailing full stop rather than reading it as part of the filename", () => {
    expect(diagramReferences({ content: '  a["It lives in src/silver."]' })).toEqual(["src/silver"]);
  });

  it("keeps a trailing slash, so a directory label stays a directory", () => {
    expect(diagramReferences({ content: '  a["src/corpus/history/ holds it"]' })).toEqual(["src/corpus/history/"]);
  });

  it("takes a noun-and-verb invocation", () => {
    expect(diagramReferences({ content: '  a["slopweaver turn brief pins it"]' })).toEqual(["slopweaver turn brief"]);
  });

  it("never reads a third word as part of the address", () => {
    expect(diagramReferences({ content: '  a["slopweaver handover finish refuses while a probe fails"]' })).toEqual([
      "slopweaver handover finish",
    ]);
  });

  it("ignores a bare `slopweaver`, which names no address", () => {
    expect(diagramReferences({ content: '  a["the slopweaver CLI is the one door"]' })).toEqual([]);
  });

  it("ignores a slash-bearing token that is not rooted in this repository", () => {
    expect(diagramReferences({ content: '  a["corpus/members/ under the state home"]' })).toEqual([]);
  });

  it("deduplicates a path two boxes both name", () => {
    expect(diagramReferences({ content: '  a["src/admit/door.ts"]\n  b["src/admit/door.ts"]' })).toEqual([
      "src/admit/door.ts",
    ]);
  });

  it("returns nothing for a diagram whose labels name no code at all", () => {
    expect(
      diagramReferences({ content: 'flowchart TB\n  a["A colleague asks a question"] --> b["An answer"]' }),
    ).toEqual([]);
  });
});

describe("scanDiagramFile", () => {
  it("reports a path no longer on disk", () => {
    const offenders = scanDiagramFile({
      addresses: ADDRESSES,
      content: '  a["src/live/turn/gone.ts"]',
      path: "docs/diagrams/x.mmd",
      pathExists: NEVER_EXISTS,
    });
    expect(offenders.map((offender) => formatOffender({ offender }))).toEqual([
      "docs/diagrams/x.mmd: `src/live/turn/gone.ts` does not exist",
    ]);
  });

  it("reports a verb the manifest does not serve", () => {
    const offenders = scanDiagramFile({
      addresses: ADDRESSES,
      content: '  a["slopweaver turn compose"]',
      path: "docs/diagrams/x.mmd",
      pathExists: ALWAYS_EXISTS,
    });
    expect(offenders.map((offender) => formatOffender({ offender }))).toEqual([
      "docs/diagrams/x.mmd: no verb `compose` on noun `turn`",
    ]);
  });

  it("reports a noun the manifest does not serve", () => {
    const offenders = scanDiagramFile({
      addresses: ADDRESSES,
      content: '  a["slopweaver worldmodel build"]',
      path: "docs/diagrams/x.mmd",
      pathExists: ALWAYS_EXISTS,
    });
    expect(offenders.map((offender) => formatOffender({ offender }))).toEqual([
      "docs/diagrams/x.mmd: no noun `worldmodel` in the CLI manifest",
    ]);
  });

  it("passes a diagram whose every label resolves", () => {
    const offenders = scanDiagramFile({
      addresses: ADDRESSES,
      content: '  a["slopweaver refresh run<br/>src/corpus"] --> b["slopweaver turn brief"]',
      path: "docs/diagrams/x.mmd",
      pathExists: ALWAYS_EXISTS,
    });
    expect(offenders).toEqual([]);
  });
});

/** Each diagram, and the one page that draws it. The proposal draft is off-repo and unlisted. */
const DIAGRAMS: readonly { readonly name: string; readonly owner: string }[] = [
  { name: "overview", owner: "docs/architecture.md" },
  { name: "inbound", owner: "docs/architecture/inbound.md" },
  { name: "outbound", owner: "docs/architecture/outbound.md" },
  { name: "supervisor", owner: "docs/architecture/supervisor-loop.md" },
  { name: "supervisor-runs", owner: "docs/architecture/run-lifecycle.md" },
  { name: "corpus", owner: "docs/architecture/corpus.md" },
  { name: "verb-surface", owner: "docs/architecture/verb-surface.md" },
  { name: "trust-boundaries", owner: "docs/architecture/trust-boundaries.md" },
  { name: "voice", owner: "docs/voice-flow.md" },
];

describe("the real diagrams", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");
  const addresses = addressesFromManifestModules({ modules: MANIFEST_MODULES });
  // Strict decoding, so decoded text is the bytes one to one: an invalid sequence throws instead of collapsing to
  // U+FFFD, and a byte-order mark is kept rather than dropped, so two files differing only there cannot compare equal.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const read = ({ path }: { path: string }): string => decoder.decode(readFileSync(join(root, path)));

  it("names nine diagrams, every one of them on disk and none on disk unnamed", () => {
    const missing = DIAGRAMS.map((diagram) => `docs/diagrams/${diagram.name}.mmd`).filter(
      (path) => !existsSync(join(root, path)),
    );
    const onDisk = readdirSync(join(root, "docs", "diagrams")).filter((name) => name.endsWith(".mmd"));
    expect(missing).toEqual([]);
    expect(DIAGRAMS.length).toBe(9);
    expect(onDisk.toSorted()).toEqual(DIAGRAMS.map((diagram) => `${diagram.name}.mmd`).toSorted());
  });

  it("resolves every path and verb every diagram names", () => {
    const offenders = DIAGRAMS.flatMap((diagram) => {
      const path = `docs/diagrams/${diagram.name}.mmd`;
      return scanDiagramFile({
        addresses,
        content: read({ path }),
        path,
        pathExists: ({ path: candidate }) => existsSync(join(root, candidate)),
      });
    });
    expect(offenders.map((offender) => formatOffender({ offender })).toSorted()).toEqual([]);
  });

  it("checks a diagram that actually carries references, so a silent extraction failure cannot pass", () => {
    const counts = DIAGRAMS.map(
      (diagram) => diagramReferences({ content: read({ path: `docs/diagrams/${diagram.name}.mmd` }) }).length,
    );
    expect(counts.filter((count) => count === 0)).toEqual([]);
  });

  // One case per page, so rendering the whole tree is spread across cases rather than held to one case's timeout
  // (a single case over every page timed out at 20s on a loaded CI shard, against 3s locally).
  const pages = [
    "README.md",
    ...readdirSync(join(root, "docs"), { recursive: true })
      .map((name) => `docs/${String(name)}`)
      .filter((path) => path.endsWith(".md")),
  ];

  it("reads every page that could draw one, and every owner is among them", () => {
    expect(pages.length).toBeGreaterThan(1);
    expect(DIAGRAMS.map((diagram) => diagram.owner).filter((owner) => !pages.includes(owner))).toEqual([]);
  });

  it.each(pages)("%s draws exactly the diagrams it owns, each byte for byte, and no other", (path) => {
    const diagrams = drawnDiagrams({ content: read({ path }) });
    const sourceOf = (diagram: { readonly name: string }): string =>
      read({ path: `docs/diagrams/${diagram.name}.mmd` });
    const owned = DIAGRAMS.filter((diagram) => diagram.owner === path);
    // The owner draws the file exactly; a copy anywhere else counts even with text around it.
    const drawn = DIAGRAMS.filter((diagram) => diagrams.some((text) => text.includes(sourceOf(diagram))));
    expect(drawn.map((diagram) => diagram.name)).toEqual(owned.map((diagram) => diagram.name));
    expect(owned.filter((diagram) => !diagrams.includes(sourceOf(diagram))).map((diagram) => diagram.name)).toEqual([]);
  });
});
