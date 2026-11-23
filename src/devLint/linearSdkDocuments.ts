/**
 * The Linear-SDK-documents gate — every Linear GraphQL operation comes from `@linear/sdk`, never from a
 * template literal in this tree.
 *
 * ## The criterion, and why it narrows itself
 *
 * A string or template literal under a Linear tree that opens a GraphQL operation (`query X {`,
 * `mutation X {`) fails **when the pinned `@linear/sdk` bundle ships a document for the root field it
 * selects.** The gate does not carry a list of banned operations or an allowlist of blessed sites: it reads
 * `LinearDocument` at scan time, extracts the root field of every generated document, and refuses any
 * hand-written operation that lands on one of those fields.
 *
 * That makes the criterion self-narrowing in both directions, which is the property worth having. The two
 * operations Linear's SDK genuinely cannot express pass without anyone naming them:
 *
 * - `src/atlas/linear/introspection.ts` selects `__schema` and `__type`. Those are meta-schema fields —
 *   there is no generated document for them and there never will be, because introspection is how you learn
 *   what the schema is rather than a query against it.
 * - `oauthApplications` is a real root field (it is in the 170 the atlas introspected), but
 *   the pinned v92 bundle ships no document for it and `LinearClient` exposes no method. Verify with
 *   `Object.keys(LinearDocument).filter((k) => /oauth/i.test(k))` — the only hit is `ApplicationInfoDocument`.
 *
 * Neither is exempted. Both simply sit outside the criterion, and the day Linear ships an
 * `OauthApplicationsDocument` the gate starts refusing that one hand-written query with no edit here. A
 * false positive of THAT kind is retired by SHARPENING this criterion, never by listing the site.
 *
 * ## The one exemption marker, and why a criterion could not replace it
 *
 * There is exactly one hand-written document left in this repo, and it selects `issues { history …
 * stateHistory … }`. Its root field is `issues`, which the SDK very much ships a document for, so it sits
 * INSIDE the criterion above and is refused unless it carries `linear-sdk-documents-exempt:` and a reason on
 * the line directly above it. A bare marker exempts nothing.
 *
 * Three sharper criteria were tried before reaching for a marker, and each was wrong in a way worth
 * recording so nobody re-proposes it:
 *
 * - *"Pass when the document selects a field the SDK's own document cannot reach."* This exempts today's
 *   `ISSUES_QUERY` too — it selects `comments`, `labels`, `attachments` and five more connections the SDK's
 *   `Issue` fragment does not carry — so it would bless the single largest thing this change exists to
 *   delete.
 * - *"Pass when the connections it selects have no root query of their own."* Closer, but it has to model
 *   the `labels` → `issueLabels` style of pluralisation to know which connections a root document covers,
 *   and a criterion that guesses at name mapping fails open.
 * - *"Pass when the SDK cannot reach the data at all."* False here: `Issue_HistoryDocument` reaches it
 *   perfectly well. It just costs 4,442 complexity points PER ISSUE — over a hundred million for a workspace
 *   of tens of thousands of issues, against a 3,000,000/hour budget — because it selects the whole `IssueHistory` fragment with its
 *   `from*`/`to*` objects, which is the exact object expansion `queries.ts` once replaced with scalar `*Id`
 *   fields to get a page from 9,454 points to 1,050.
 *
 * That last line is the real reason, and it is a COST fact rather than a schema fact. No static criterion
 * can see a complexity header. So the exception is a marker carrying the measurement, visible in the diff,
 * rather than a criterion bent until it admits the one case and quietly admits others with it.
 *
 * ## Why a gate rather than a note
 *
 * The rule is full SDK-first, made structurally impossible to get wrong by a lint rule or a custom check.
 * The class had
 * already regenerated to **81 hand-written operations across 11 files** while `@linear/sdk` was installed
 * and imported in four of them — as `LinearClient` only, with zero type imports. Every one of those
 * documents was written carefully by someone who had the SDK available; the SDK was simply the transport,
 * so nothing ever said no. That is what a gate says and a convention does not.
 *
 * ## Scope, stated rather than assumed
 *
 * Linear source paths only, and the test tree is out of scope. A test for the atlas's own GraphQL-document
 * parser has to hold a GraphQL string to parse, and a fixture is not a request — the ruling is about what
 * this repo SENDS to Linear, and nothing under `__tests__/` reaches the door.
 *
 * This repo also writes GitHub GraphQL by hand (`src/corpus/github`, `src/live/github`),
 * and GitHub's schema shares root field names with Linear's — `organization`, `search`, `user`, `node` — so
 * an unscoped criterion would refuse GitHub documents for selecting a field that happens to exist in
 * Linear's schema too. The scope is the boundary of the ruling, not a carve-out inside it.
 *
 * Pure {@link scanLinearSdkDocuments} + an effectful {@link runLinearSdkDocuments} edge, matching the other
 * gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LinearDocument } from "@linear/sdk";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/**
 * One hand-written Linear operation: where it is, and which SDK document replaces it.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface LinearSdkDocumentHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/**
 * The operation header a hand-written document opens with, and the first field of its selection set.
 *
 * Written so that every optional part begins with a character the part before it cannot match: the name
 * group opens on `[A-Za-z_]`, the argument group on `(`, and each carries its own trailing whitespace. The
 * obvious spelling — `\\s+(\\w+)?\\s*` — lets `\\s+` and `\\s*` both claim the same run of spaces on an
 * ANONYMOUS operation (`query {`), which is polynomial backtracking and what `redos-check` refuses.
 */
const OPERATION = /\b(query|mutation)\s+(?:([A-Za-z_]\w*)[\t ]*)?(?:\([^)]*\)[\s]*)?\{\s*([A-Za-z_][\w]*)/;

/**
 * The marker that lets a measured, hand-written document through. A bare marker exempts nothing.
 *
 * @internal — exported for this gate's own tests; nothing outside `src/devLint/` names it.
 */
export const EXEMPT_MARKER = "linear-sdk-documents-exempt";

/**
 * Whether a value is a boxed `String` object rather than a primitive.
 *
 * `instanceof String` is the only test that answers this, and it is realm-safe here because the value came
 * out of this process's own `@linear/sdk` import rather than across a boundary.
 *
 * @param value the value to test
 * @returns true iff it is a `String` object
 */
function isBoxedString({ value }: { value: unknown }): boolean {
  return Object.prototype.toString.call(value) === "[object String]";
}

/**
 * Every root field the pinned SDK bundle ships a document for, mapped to that document's name.
 *
 * Derived from `LinearDocument` at scan time rather than transcribed, so an SDK bump moves the criterion
 * without anyone editing this file. Reproduce the count with
 * `yarn tsx -e 'import{LinearDocument as d}from"@linear/sdk";console.log(Object.keys(d).filter(k=>k.endsWith("Document")).length)'`.
 *
 * @returns root field name to the SDK document that selects it
 */
function sdkDocumentsByRootField(): ReadonlyMap<string, string> {
  const byField = new Map<string, string>();
  for (const [name, value] of Object.entries<unknown>(LinearDocument)) {
    if (!name.endsWith("Document")) {
      continue;
    }
    // The SDK ships each document as a `TypedDocumentString` — a boxed `String` carrying phantom types — so
    // a plain `typeof` check alone would skip every one of them.
    if (typeof value !== "string" && !isBoxedString({ value })) {
      continue;
    }
    const match = OPERATION.exec(String(value));
    const field = match?.[3];
    if (field === undefined || byField.has(field)) {
      continue;
    }
    byField.set(field, name);
  }
  return byField;
}

/**
 * Whether the line directly above a literal carries the exemption marker AND a reason.
 *
 * The line must be a COMMENT line, which is what stops the marker's own text — quoted in this gate's tests
 * or in its documentation — from exempting whatever happens to follow it. A bare marker exempts nothing:
 * the reason is the whole point of making the exception visible in the diff.
 *
 * @param lines the file's lines
 * @param startLine the literal's 1-based line
 * @returns true when a marked, reasoned exemption sits directly above
 */
function hasMarker({ lines, startLine }: { lines: readonly string[]; startLine: number }): boolean {
  if (startLine <= 1) {
    return false;
  }
  // `startLine > 1` above is what makes this index in range; an out-of-range read would mean the caller
  // handed a line number this file does not have, which is a bug rather than a missing marker.
  const above = lines[startLine - 2]!.trim();
  if (!above.startsWith("//") && !above.startsWith("*") && !above.startsWith("/*")) {
    return false;
  }
  const at = above.indexOf(`${EXEMPT_MARKER}:`);
  return at >= 0 && above.slice(at + EXEMPT_MARKER.length + 1).trim().length > 0;
}

/** Whether a repo-relative path sits in one of the Linear trees this gate governs. */
function isLinearPath({ path }: { path: string }): boolean {
  return path.includes("/linear/") || path.endsWith("/linear.ts");
}

/** The literal's text, for a plain string or a template with no substitutions. */
function literalText({ node }: { node: ts.Node }): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
  }
  return undefined;
}

/**
 * Every hand-written Linear operation in `content` that the SDK already ships a document for. Pure — parses
 * in memory with the TypeScript AST, so a GraphQL string inside a comment is never read.
 *
 * @param path the file's repo-relative path, used for reporting and for the Linear-tree scope
 * @param content the file's text
 * @param sdkDocuments root field to SDK document name, from {@link sdkDocumentsByRootField}
 * @returns each violation, in source order
 */
export function scanLinearSdkDocuments({
  path,
  content,
  sdkDocuments,
}: {
  path: string;
  content: string;
  sdkDocuments: ReadonlyMap<string, string>;
}): readonly LinearSdkDocumentHit[] {
  if (!isLinearPath({ path })) {
    return [];
  }
  const lines = content.split("\n");
  const hits: LinearSdkDocumentHit[] = [];
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly LinearSdkDocumentHit[] => {
      const visit: NodeVisitor = (node) => {
        const text = literalText({ node });
        const match = text === undefined ? null : OPERATION.exec(text);
        const field = match?.[3];
        const document = field === undefined ? undefined : sdkDocuments.get(field);
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (field !== undefined && document !== undefined && !hasMarker({ lines, startLine: line })) {
          hits.push({
            line,
            message:
              `hand-written Linear GraphQL selecting \`${field}\`, which \`@linear/sdk\` already ships as ` +
              `\`LinearDocument.${document}\`. Pass that document to the transport instead — the SDK is the ` +
              `schema contract, not just the wire. (A root field the SDK ships no document for is outside this ` +
              `criterion and passes; there is no exemption marker.)`,
            path,
          });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  if (!path.startsWith("src/") || !path.endsWith(".ts")) {
    return false;
  }
  if (path.includes("__tests__/")) {
    return false;
  }
  if (path.endsWith("linearSdkDocuments.ts") || path.endsWith("linearSdkDocuments.entry.ts")) {
    return false;
  }
  return isLinearPath({ path });
}

/**
 * IO edge: scan every Linear source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runLinearSdkDocuments(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = workingTreeFilesOf({ pathspec: "src", root }).filter((path) => isScannablePath({ path }));
  } catch {
    // devlint: not-a-refusal -- a FACT: with no checkout there is nothing to scan, so no rule caught anything
    process.stderr.write("linear-sdk-documents: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const sdkDocuments = sdkDocumentsByRootField();
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<LinearSdkDocumentHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanLinearSdkDocuments({ content, path, sdkDocuments }),
  });
  const complete = reportScanIntegrity({
    label: "linear-sdk-documents",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(
      `linear-sdk-documents: clean (${String(readCount)} file(s) scanned against ${String(sdkDocuments.size)} SDK root field(s))\n`,
    );
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "linear-sdk-documents" }),
      detail: `${String(hits.length)} hand-written document(s) for a root field the SDK already ships`,
    })}\n`,
  );
  return 1;
}
