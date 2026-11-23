/**
 * File-wide JSDoc hygiene (code-quality survey item 9's Read-2 add-on, requested regardless of which comment
 * option landed): a block DETACHED from any declaration by a blank line, and a block DUPLICATED verbatim
 * within the SAME stack. Both are a stray comment a rename or refactor left behind.
 *
 * `jsdocTags.ts`'s `attachedBlock` already only ever reads the LAST `/** *\/` block immediately above a
 * declaration — a blank line, or a second block stacked right after the first, both make an earlier block
 * unreachable. Nothing said so until now. Two measured instances forced the shape below:
 *
 *   - `src/corpus/linear/structures.ts:542-543` — the SAME block, typed twice, back to back. The first copy
 *     is shadowed; the second is a verbatim duplicate of it.
 *   - `src/cli/commands/handover/lifecycleRun.ts:64-65` — a stale block for a deleted declaration, sitting
 *     directly above the real (and correct) doc for `COMMON`, shadowed by it.
 *
 * ## Duplicate detection is scoped to one site's own stack, not the whole file
 *
 * Measured against the real tree: comparing every block's text against every OTHER block in the file flagged
 * 18 of 19 hits, and every one of the 18 was two DIFFERENT declarations (usually the same field name in two
 * sibling interfaces — `hasMore`, `warnings`, a pagination cursor) carrying the identical, correct, one-line
 * description on purpose. Repeating an exact description across parallel shapes is this repo's convention,
 * not a defect. The one real hit, `structures.ts:542-543`, is two blocks stacked directly above the SAME
 * declaration — so duplication is only checked within a site's own block list, never across the file.
 *
 * ## Why this scans MORE than `jsdocTags.ts`'s own exported-function walk
 *
 * A stray comment can sit above anything — an interface member, a non-exported constant — not only an
 * exported function, so this walks every top-level statement plus every interface and class member's own
 * leading trivia. Each site's leading-trivia zone is disjoint from its neighbours' (a node's `getFullStart()`
 * begins exactly where the previous token ended), so summing every site's blocks visits each `/** *\/`
 * comment in the file exactly once — nothing is double-counted and nothing in scope is skipped.
 *
 * ## The file-header exemption
 *
 * The very first block in a file, when it is the only thing before the first statement's own attached doc
 * (or is that statement's only block), is a legitimate file overview — `attachedBlock` already treats a
 * blank-separated header this way for the SAME reason. Losing that exemption here would flag nearly every
 * file in the tree.
 *
 * Pure ({@link scanCommentHygiene}, unit-tested with inline fixtures); no I/O, no type checker.
 */

import { ts, withSourceFile } from "#lib/tsSyntax.js";

/** One hygiene defect: a JSDoc block that cannot be documenting what it looks like it documents. */
export interface CommentHygieneDefect {
  readonly path: string;
  readonly line: number;
  readonly kind: "detached-block" | "duplicate-block";
  readonly detail: string;
}

/** One `/** *\/`-shaped block found in a declaration site's leading trivia. */
interface DocBlock {
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly line: number;
}

/**
 * Every `/** *\/` block in `node`'s leading trivia, in source order — not just the last (attached) one.
 *
 * @param node the declaration site whose leading trivia is read
 * @param sf the source file `node` belongs to
 * @returns each doc-shaped comment block found, oldest first
 */
function docBlocksBefore({ node, sf }: { node: ts.Node; sf: ts.SourceFile }): readonly DocBlock[] {
  const text = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart());
  // The compiler API answers `undefined`, not an empty list, for a site with no leading comment at all — so
  // there is no block before it.
  if (ranges === undefined) {
    return [];
  }
  return ranges
    .filter((range) => text.slice(range.pos, range.pos + 3) === "/**")
    .map((range) => ({
      end: range.end,
      line: sf.getLineAndCharacterOfPosition(range.pos).line + 1,
      pos: range.pos,
      text: text.slice(range.pos, range.end),
    }));
}

/**
 * Every declaration site worth checking for stray leading comments: top-level statements plus the members of
 * any top-level interface or class.
 *
 * @param sf the source file to walk
 * @returns each site, in source order (top-level statements first, then each container's members)
 */
function declarationSites({ sf }: { sf: ts.SourceFile }): readonly ts.Node[] {
  const sites: ts.Node[] = [...sf.statements];
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      appendMembers({ members: stmt.members, sites });
    } else if (ts.isClassDeclaration(stmt)) {
      appendMembers({ members: stmt.members, sites });
    }
  }
  return sites;
}

/** Push every member into `sites`, kept out of {@link declarationSites} only to stay under one return path. */
function appendMembers({
  members,
  sites,
}: {
  members: readonly ts.ClassElement[] | readonly ts.TypeElement[];
  sites: ts.Node[];
}): void {
  for (const member of members) {
    sites.push(member);
  }
}

/** Whether `block` is the file's legitimate overview header: the very first comment in the file, full stop. */
function isFileHeader({ block, content }: { block: DocBlock; content: string }): boolean {
  return content.slice(0, block.pos).trim() === "";
}

/**
 * The blocks at one declaration site, with a legitimate file-overview header stripped off the front so the
 * shadow/duplicate/detached checks below never see it — the same exemption `attachedBlock` already grants a
 * blank-separated header, applied here to the (rarer) case where the header sits directly above the first
 * statement's own doc block with no blank line between them.
 *
 * @param site the declaration whose blocks are being read
 * @param isFirstStatement whether `site` is the file's first top-level statement — the only place a header
 *   can legitimately appear
 * @param content the file's raw text, for the header check
 * @returns the blocks to run the hygiene checks over, and the header block if one was stripped
 */
function blocksExcludingHeader({
  site,
  isFirstStatement,
  content,
  sf,
}: {
  site: ts.Node;
  isFirstStatement: boolean;
  content: string;
  sf: ts.SourceFile;
}): { readonly blocks: readonly DocBlock[]; readonly header: DocBlock | undefined } {
  const raw = docBlocksBefore({ node: site, sf });
  const first = raw[0];
  if (!isFirstStatement || first === undefined || !isFileHeader({ block: first, content })) {
    return { blocks: raw, header: undefined };
  }
  return { blocks: raw.slice(1), header: first };
}

/** The defects in one declaration site's own block stack: duplicates within it, shadowed blocks, a detached last one. */
function siteDefects({
  site,
  isFirstStatement,
  content,
  path,
  sf,
}: {
  site: ts.Node;
  isFirstStatement: boolean;
  content: string;
  path: string;
  sf: ts.SourceFile;
}): readonly CommentHygieneDefect[] {
  const defects: CommentHygieneDefect[] = [];
  const { blocks } = blocksExcludingHeader({ content, isFirstStatement, site, sf });
  // Scoped to THIS site's own stack — see the module header for why a file-wide scan is the wrong shape.
  const seenWithinSite = new Map<string, number>();

  blocks.forEach((block, index) => {
    const normalized = block.text.trim();
    const firstSeenLine = seenWithinSite.get(normalized);
    if (firstSeenLine !== undefined) {
      defects.push({
        detail: `identical to the JSDoc block at line ${String(firstSeenLine)} — dedupe or rewrite one of them`,
        kind: "duplicate-block",
        line: block.line,
        path,
      });
    } else {
      seenWithinSite.set(normalized, block.line);
    }

    const isLast = index === blocks.length - 1;
    if (!isLast) {
      if (firstSeenLine === undefined) {
        defects.push({
          detail:
            "shadowed by the JSDoc block immediately below it — only the last block before a " +
            "declaration is ever read, so this one documents nothing",
          kind: "detached-block",
          line: block.line,
          path,
        });
      }
      return;
    }
    const between = sf.getFullText().slice(block.end, site.getStart(sf));
    if (/\n[ \t]*\n/.test(between) && firstSeenLine === undefined) {
      defects.push({
        detail:
          "separated from its declaration by a blank line — that documents the file, not this " +
          "declaration, and there is no file overview at this position",
        kind: "detached-block",
        line: block.line,
        path,
      });
    }
  });
  return defects;
}

/**
 * Every hygiene defect on one file's JSDoc blocks. Pure — parses `content` in memory, so a test asserts
 * exactly which line trips each kind.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns every defect, in source order
 */
export function scanCommentHygiene({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly CommentHygieneDefect[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly CommentHygieneDefect[] =>
      declarationSites({ sf }).flatMap((site, siteIndex) =>
        siteDefects({ content, isFirstStatement: siteIndex === 0, path, site, sf }),
      ),
  });
}
