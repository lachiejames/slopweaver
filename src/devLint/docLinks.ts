/**
 * The doc-links gate — every local link in a tracked markdown file, and every repo-rooted markdown reference
 * in source, names a tracked file and (when it carries a fragment) a heading or explicit anchor in it; and
 * every reference page is reachable from an index by following links.
 *
 * ## Why it exists
 *
 * Progressive disclosure holds everywhere, every tracked `.md` at most 300 lines
 * ({@link "./agentDocSize.js"}). Meeting that cap means MOVING detail into child pages, and a move breaks
 * whatever linked to the old heading — in another doc, a skill, or a source comment — while every file still
 * reads perfectly. A size cap alone would pay a descent to scatter text; this gate is what keeps the moved
 * detail linked into one tree. Reachability is the half no off-the-shelf checker offers: a link checker only
 * validates the links that exist, so an orphaned page passes every one of them.
 *
 * ## Why home-grown, and over which libraries
 *
 * Measured before writing it: `remark-validate-links` over every tracked
 * `.md` reported 22 findings, 11 of them false — it does not read an explicit `<a id="…">` anchor, which
 * `README.md` navigates by — pulled 196 packages, and cannot see a link in a TypeScript comment.
 * `markdown-link-check` is an HTTP liveness checker, the wrong boundary for an offline lint lane; `lychee`
 * is a Rust binary outside this Yarn toolchain. What this repo needs from a library is exactly one thing it
 * should not re-derive: what GitHub DRAWS, and the ids it gives headings. The drawing is `micromark` with its GFM
 * extensions and `parse5`, already shipped for `src/prformat/renderedTables.ts`; the ids are `github-slugger`, GitHub's
 * own algorithm with no dependencies. A regex reader was written first and lost four review rounds to CommonMark
 * corners, one per round, and a hand URL resolver lost three more to URL-parsing ones; so a target is resolved by the
 * URL standard's own `URL`, and an `@`-import is `importedPathsOf`'s. See `./docLinksRead.ts`.
 *
 * Pure cores are unit-tested; {@link runDocLinks} reads the working tree and prints.
 */

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { fragmentCandidates, type LocalDocLink, markdownDocOf } from "./docLinksRead.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * One thing wrong with the doc tree.
 *
 * @internal — what this gate prints.
 */
export interface DocLinkFinding {
  readonly kind: "missing-file" | "missing-anchor" | "unreachable-doc";
  readonly sourcePath: string;
  readonly line: number | undefined;
  readonly target: string;
}

/** A repo-rooted markdown reference in source: `docs/<page>.md`, `skills/<name>/SKILL.md#<heading>`, `AGENTS.md`. */
const SOURCE_REFERENCE =
  /(?<![\w/.@-])((?:docs|skills|\.claude)\/[A-Za-z0-9_./-]*?\.md|AGENTS\.md|README\.md)(?:#([A-Za-z0-9_-]+))?(?![\w/-])/g;

/**
 * Every repo-rooted markdown reference in a source file — `docs/<page>.md#<heading>` in a comment, say — resolved
 * against the repository root, since source names docs by their repo path. Pure.
 *
 * @param content the source file's text
 * @param path the source file's repo-relative path
 * @returns each reference, in file order
 */
export function sourceDocReferencesIn({ content, path }: { content: string; path: string }): readonly LocalDocLink[] {
  const links: LocalDocLink[] = [];
  content.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(SOURCE_REFERENCE)) {
      links.push({ fragment: match[2], line: index + 1, sourcePath: path, targetPath: match[1]!, via: "source" });
    }
  });
  return links;
}

/** Whether a repo-relative target names a tracked file, a directory holding one, or the root (`./`, `/`) itself. */
function targetExists({ target, tracked }: { target: string; tracked: ReadonlySet<string> }): boolean {
  if (target === "." || tracked.has(target)) {
    return true;
  }
  // A trailing slash names a directory, so a file of that name does not satisfy it.
  const prefix = target.endsWith("/") ? target : `${target}/`;
  for (const path of tracked) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * The anchors a link's target offers, or undefined when only GitHub's renderer knows them (a `#L10` line anchor on
 * source). A directory is drawn with its `README.md` below the listing, so its anchors are that README's — and a
 * directory without one offers none.
 */
function anchorsOfTarget({
  targetPath,
  trackedPaths,
  anchorsByPath,
}: {
  targetPath: string;
  trackedPaths: ReadonlySet<string>;
  anchorsByPath: ReadonlyMap<string, ReadonlySet<string>>;
}): ReadonlySet<string> | undefined {
  if (trackedPaths.has(targetPath)) {
    return anchorsByPath.get(targetPath);
  }
  const readme = anchorsByPath.get(targetPath === "." ? "README.md" : `${targetPath.replace(/\/$/, "")}/README.md`);
  if (readme === undefined) {
    return new Set();
  }
  return readme;
}

/**
 * Every link naming no tracked file, or a fragment its target does not offer — a directory's being its README's. Pure.
 * A fragment on a non-markdown file (a `#L10` line anchor on source) is not checked — only GitHub's renderer knows it.
 *
 * @param links every local link found
 * @param trackedPaths every tracked repo-relative path
 * @param anchorsByPath each tracked markdown file's anchors
 * @returns each broken link, in input order
 */
export function docLinkFindings({
  links,
  trackedPaths,
  anchorsByPath,
}: {
  links: readonly LocalDocLink[];
  trackedPaths: ReadonlySet<string>;
  anchorsByPath: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly DocLinkFinding[] {
  const findings: DocLinkFinding[] = [];
  for (const link of links) {
    const target = link.fragment === undefined ? link.targetPath : `${link.targetPath}#${link.fragment}`;
    // An @-import names a file, so a directory never satisfies one.
    const exists =
      link.via === "import"
        ? trackedPaths.has(link.targetPath)
        : targetExists({ target: link.targetPath, tracked: trackedPaths });
    if (!exists) {
      findings.push({ kind: "missing-file", line: link.line, sourcePath: link.sourcePath, target });
      continue;
    }
    const anchors = anchorsOfTarget({ anchorsByPath, targetPath: link.targetPath, trackedPaths });
    const fragment = link.fragment;
    if (
      anchors !== undefined &&
      fragment !== undefined &&
      fragment.length > 0 &&
      !fragmentCandidates({ fragment }).some((candidate) => anchors.has(candidate))
    ) {
      findings.push({ kind: "missing-anchor", line: link.line, sourcePath: link.sourcePath, target });
    }
  }
  return findings;
}

/**
 * Every required page no root reaches by following markdown links and `@`-imports, however many hops. Pure. An image is
 * not an edge: nobody navigates through one, so a page only an image names is still an orphan.
 *
 * @param links every link found in markdown (source references are not tree edges)
 * @param roots the pages a reader or a host opens first
 * @param required the pages that must hang off one of them
 * @returns each unreachable required page, sorted
 */
export function unreachableDocs({
  links,
  roots,
  required,
}: {
  links: readonly LocalDocLink[];
  roots: readonly string[];
  required: ReadonlySet<string>;
}): readonly string[] {
  const edges = new Map<string, string[]>();
  for (const link of links.filter((edge) => edge.via === "link" || edge.via === "import")) {
    const out = edges.get(link.sourcePath);
    if (out === undefined) {
      edges.set(link.sourcePath, [link.targetPath]);
    } else {
      out.push(link.targetPath);
    }
  }
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const out = edges.get(queue.shift()!);
    if (out === undefined) {
      continue;
    }
    for (const next of out) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...required].filter((path) => !seen.has(path)).toSorted();
}

/**
 * Where the doc tree starts, and which pages must hang off it. Pure.
 *
 * Roots are what a host loads or a reader opens first: the two readmes, the instruction files, every rule and
 * every skill body. Required is every page opened only by following a link — all of `docs/`, and every
 * skill's `reference/` subtree. A fixture, a template or a dated eval artifact is neither: data, not
 * navigation, so it is link-checked but never required to be reached.
 *
 * @param markdownPaths every tracked markdown path
 * @returns the roots and the required set
 */
export function docTreeOf({ markdownPaths }: { markdownPaths: readonly string[] }): {
  readonly roots: readonly string[];
  readonly required: ReadonlySet<string>;
} {
  const roots = markdownPaths.filter(
    (path) =>
      ["README.md", "AGENTS.md", "CLAUDE.md", "docs/README.md"].includes(path) ||
      path.startsWith(".claude/rules/") ||
      /^skills\/[^/]+\/SKILL\.md$/.test(path),
  );
  const required = new Set(
    markdownPaths.filter((path) => path.startsWith("docs/") || /^skills\/[^/]+\/reference\//.test(path)),
  );
  return { required, roots };
}

/** Whether a tracked source file is scanned for repo-rooted doc references: shipped source, never tests. */
function isScannedSource({ path }: { path: string }): boolean {
  return /\.(ts|tsx)$/.test(path) && !path.includes("__tests__/") && !path.endsWith(".d.ts");
}

/** Print each finding and the refusal, or the clean line. */
function reportDocLinks({ findings, scanned }: { findings: readonly DocLinkFinding[]; scanned: number }): number {
  if (findings.length === 0) {
    process.stdout.write(`doc-links: clean (${String(scanned)} file(s) scanned)\n`);
    return 0;
  }
  for (const finding of findings) {
    const where = finding.line === undefined ? finding.sourcePath : `${finding.sourcePath}:${String(finding.line)}`;
    process.stderr.write(`  ${where}: ${finding.kind} ${finding.target}\n`);
  }
  const unreachable = findings.filter((finding) => finding.kind === "unreachable-doc").length;
  const broken = findings.length - unreachable;
  if (broken > 0) {
    process.stderr.write(
      `${lintGateRefusal({ declaration: lintDeclarationFor({ id: "doc-links" }), detail: `${String(broken)} broken link(s)` })}\n`,
    );
  }
  if (unreachable > 0) {
    process.stderr.write(
      `${lintGateRefusal({ declaration: lintDeclarationFor({ id: "doc-links-tree" }), detail: `${String(unreachable)} unreachable page(s)` })}\n`,
    );
  }
  return 1;
}

/**
 * IO edge: read every tracked markdown file and shipped source file, and refuse a broken link or an
 * unreachable page.
 *
 * @returns the process exit code (0 clean, 1 a finding or an unreadable input)
 */
export function runDocLinks(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    // Regular files inside the checkout only: a path deleted from disk but not the index names nothing a click opens,
    // a symlink — the file itself or a directory above it — may point out of the checkout, and a gitlink is a
    // directory, which exists here only as the prefix of files listed inside it.
    const realRoot = realpathSync(root);
    listing = workingTreeFilesOf({ root }).filter((path) => {
      const full = join(root, path);
      const regular = lstatSync(full, { throwIfNoEntry: false })?.isFile() === true;
      return regular && realpathSync(full).startsWith(`${realRoot}${sep}`);
    });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ, so the gate has no subject to judge
    process.stderr.write("doc-links: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const markdownPaths = listing.filter((path) => path.endsWith(".md"));
  const scan = scanTextFiles<{ path: string; content: string }>({
    paths: [...markdownPaths, ...listing.filter((path) => isScannedSource({ path }))],
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => [{ content, path }],
  });
  const complete = reportScanIntegrity({
    label: "doc-links",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete) {
    // devlint: not-a-refusal -- `reportScanIntegrity` has already named what went unread; a verdict over
    // documents nobody read would be a lie in either direction
    return 1;
  }
  const markdown = scan.hits.filter((hit) => hit.path.endsWith(".md"));
  const docs = markdown.map((hit) => ({ path: hit.path, ...markdownDocOf(hit) }));
  const markdownLinks = docs.flatMap((doc) => doc.links);
  const sourceLinks = scan.hits.filter((hit) => !hit.path.endsWith(".md")).flatMap((hit) => sourceDocReferencesIn(hit));
  const anchorsByPath = new Map(docs.map((doc) => [doc.path, doc.anchors]));
  const broken = docLinkFindings({
    anchorsByPath,
    links: [...markdownLinks, ...sourceLinks],
    trackedPaths: new Set(listing),
  });
  const unreachable = unreachableDocs({ links: markdownLinks, ...docTreeOf({ markdownPaths }) }).map(
    (path): DocLinkFinding => ({
      kind: "unreachable-doc",
      line: undefined,
      sourcePath: path,
      target: "no index links here",
    }),
  );
  return reportDocLinks({ findings: [...broken, ...unreachable], scanned: scan.scanned });
}
