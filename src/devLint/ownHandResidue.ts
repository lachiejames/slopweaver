/**
 * The gate that stops a checked-in doc telling a session to HOLD OUT FOR THE OWNER'S KEYSTROKES.
 *
 * ## The failure this is for, and why prose could not close it
 *
 * The rule replaces "wait for the owner to type it into your own tab" with a row a session reads and
 * checks — see `.claude/rules/journalled-grants.md`. The second failure mode is contradicting guidance: memories,
 * state files, skills and checked-in markdown that still describe the old shape. A one-off sweep rots the
 * first time somebody writes the old sentence again, and the sentence is easy to write again because it reads
 * as caution.
 *
 * ## The criterion, stated rather than counted
 *
 * > An agent-facing markdown file that contains an OWN-TAB DIRECTIVE — a phrase telling a session to look for,
 * > wait for, or require something the owner typed into THAT session — while nowhere naming the journalled
 * > grant that supersedes it.
 *
 * Clearance is per FILE, not per line, and that is the design rather than a shortcut. A document has either
 * been reconciled with the mechanism or it has not; a line-local escape would let a file describe the old
 * shape in one paragraph and the new one three pages later, which is exactly the contradiction being closed.
 * So `cross-session-messages.md` may keep its "a line the owner typed in your session" sentence — it is true, and it
 * is the tier that the grant row now feeds — precisely because that file also names the grant.
 *
 * ## What it deliberately does NOT flag
 *
 * The phrase "the owner's own hand" and the tier-3 set it introduces. That set is UNTOUCHED by the rule —
 * new or widened access, a new audience, egress, spend, an irreversible unasked-for act — and a gate that
 * pushed docs to stop saying it would be widening what may be decided without the owner, which the rule
 * explicitly does not do. The scope here is the KEYSTROKE, never the authority.
 *
 * Pure core ({@link scanOwnHandResidue}, {@link OWN_TAB_DIRECTIVES}, {@link namesTheMechanism}) is
 * unit-tested; the thin {@link runOwnHandResidue} edge reads the working tree and prints.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * The phrases that mean "look to this session's own transcript for the owner's keystrokes".
 *
 * Each is a directive about WHERE a ruling has to appear, which is the thing the grant row replaced. They are
 * matched case-insensitively against the raw line. Kept few and literal on purpose: a looser pattern would
 * start flagging the tier-3 set, which must not move.
 */
export const OWN_TAB_DIRECTIVES: readonly string[] = [
  "into its own tab",
  "into your own tab",
  "in your own tab",
  "typed in your session",
  "typed into this session",
  "typed into your session",
  "a user turn in your own session",
];

/** The tokens that prove a file has been reconciled with the mechanism that replaced the old shape. */
const MECHANISM_TOKENS: readonly string[] = ["slopweaver grant", "journalled-grants.md", "journalled grant"];

/** Agent-facing trees whose markdown a session is handed rather than choosing to open. */
const IN_SCOPE_TREES: readonly string[] = [".claude/rules/", "skills/", "docs/"];

/** Exact-path docs loaded as project instructions by every session. */
const IN_SCOPE_FILES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md", "README.md"]);

/** One own-tab directive standing in a file that never names the mechanism. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface OwnHandHit {
  readonly path: string;
  readonly line: number;
  readonly directive: string;
}

/**
 * Whether the gate reads a path at all.
 *
 * @param path the repo-relative path
 * @returns true for agent-facing markdown
 */
export function isInScopeDoc({ path }: { path: string }): boolean {
  if (!path.endsWith(".md")) {
    return false;
  }
  return IN_SCOPE_FILES.has(path) || IN_SCOPE_TREES.some((tree) => path.startsWith(tree));
}

/**
 * Whether a document has been reconciled with the journalled grant.
 *
 * @param content the whole document text
 * @returns true when it names the mechanism anywhere
 */
export function namesTheMechanism({ content }: { content: string }): boolean {
  const lowered = content.toLowerCase();
  return MECHANISM_TOKENS.some((token) => lowered.includes(token));
}

/**
 * Every own-tab directive in one document that has not been reconciled with the mechanism.
 *
 * @param path the repo-relative path, for reporting
 * @param content the document text
 * @returns one hit per offending line; empty when the file names the mechanism or carries no directive
 */
export function scanOwnHandResidue({ path, content }: { path: string; content: string }): readonly OwnHandHit[] {
  if (namesTheMechanism({ content })) {
    return [];
  }
  return content.split("\n").flatMap((line, index) => {
    const lowered = line.toLowerCase();
    const directive = OWN_TAB_DIRECTIVES.find((phrase) => lowered.includes(phrase));
    return directive === undefined ? [] : [{ directive, line: index + 1, path }];
  });
}

/**
 * Fail when an agent-facing doc still tells a session to hold out for the owner's keystrokes.
 *
 * @returns 0 when clean, 1 on any hit, unreadable file, or an empty scan
 */
export function runOwnHandResidue(): number {
  let root: string;
  let listing: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    listing = workingTreeFilesOf({ root });
  } catch (error) {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write(`own-hand-residue: could not enumerate the working tree — ${String(error)}\n`);
    return 1;
  }
  const paths = listing.filter((path) => isInScopeDoc({ path }));
  const { hits, unreadable, scanned } = scanTextFiles({
    paths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: scanOwnHandResidue,
  });
  for (const hit of hits) {
    process.stderr.write(
      `  ${hit.path}:${String(hit.line)}: "${hit.directive}" — this doc still points a session at the owner's ` +
        "keystrokes in its own tab, and never names the journalled grant that replaced that shape\n",
    );
  }
  if (hits.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "own-hand-residue" }),
        detail: `${String(hits.length)} own-tab directive(s)`,
      })}
`,
    );
  }
  const intact = reportScanIntegrity({
    label: "own-hand-residue",
    scanned,
    unreadable,
    write: (text) => process.stderr.write(text),
  });
  if (hits.length > 0 || !intact) {
    return 1;
  }
  process.stdout.write(`own-hand-residue: clean (${String(scanned)} agent-facing doc(s) scanned)\n`);
  return 0;
}
