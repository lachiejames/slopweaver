/**
 * The page's accessibility snapshot as a TREE YOU OPEN, rather than a file you read whole — the pure half of
 * `browser open|read|scroll|aim|inspect` handing over an outline, and of `browser read --under <ref>|--find <text>`.
 *
 * ## Why this exists
 *
 * Token wastage is to be avoided, not only because it spends tokens and plans, but because a massive dump of
 * junk in a session's context window degrades the performance of the session doing the work. Until this module a look printed `elements: <path>` and nothing else, so the
 * only way to find the one ref an action is aimed by was to Read the client's whole snapshot — every nav link,
 * footer and wrapper on the page — into context.
 *
 * So a look now prints the top of the tree, opened BREADTH-FIRST until a byte and a line budget are spent, with
 * every subtree it did not open collapsed to ONE line naming the ref that opens it and how many lines sit under
 * it. Breadth-first rather than a fixed depth, because a console page nests its content a dozen anonymous
 * wrappers deep, and a depth-3 cut of that shows wrappers and nothing else; the budget fills with whatever the
 * page's top levels actually hold. `--under` opens one subtree; `--find` (`./snapshotFind.ts`) prints only
 * matching lines and their ancestors. The whole file stays on disk, unchanged, and is still what an `act`'s ref
 * check reads (`./refIdentity.ts`).
 *
 * ## The shape this parses, and why a line parse is exact
 *
 * `playwright-core`'s renderer (`lib/coreBundle.js`, the `visit` over `createKey`) writes ONE node per line:
 * `"  ".repeat(depth) + "- " + key`, the key carrying `role "name" [attrs] [ref=…]`, and a property or text child
 * on its own `- /url: …` / `- text: …` line one level deeper. Values go through `renderString` and a YAML escape,
 * so none spans two lines. Depth is the leading-space count halved. A line that does not open with `- ` is kept
 * all the same, as a node at its own indentation — nothing in the file is silently dropped but blank lines.
 *
 * A node's OWN ref is read only out of the attribute run that ends its key, through
 * {@link snapshotRefElement} — the same reading `act`'s ref check uses — so a page that names a button
 * `see [ref=e5]` cannot make `--under e5` open the wrong subtree. The file is decoded as UTF-8 by the caller, so
 * an invalid byte has already become U+FFFD and is counted as three bytes here.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type ElementsError, ElementsErrors } from "./elementsError.js";
import { oneLine } from "./oneLine.js";
import { snapshotRefElement } from "./refIdentity.js";

/** One line of the snapshot, as a node of its tree. */
export interface SnapshotNode {
  /** The line as filed, indentation stripped. */
  readonly text: string;
  /** Its depth in the file: leading spaces halved. */
  readonly depth: number;
  /** The `[ref=…]` its own key carries, when it carries one. */
  readonly ref: string | undefined;
  readonly children: SnapshotNode[];
  /** How many lines this node's subtree takes in the file, its own line included. */
  lines: number;
}

/** What one outline or find came to. */
export interface SnapshotExcerpt {
  /** The lines to print, indented to their depth in the excerpt. */
  readonly lines: readonly string[];
  /** How many lines the whole snapshot holds, blank lines aside. */
  readonly fullLines: number;
  /** How many UTF-8 bytes the whole snapshot holds. */
  readonly fullBytes: number;
  /** How many UTF-8 bytes the printed lines hold, joined by newlines. */
  readonly printedBytes: number;
  /** Whether the byte or line budget cut the excerpt; collapse markers alone do not set it. */
  readonly cut: boolean;
}

/** The budget one excerpt is held to. */
export interface ExcerptBudget {
  readonly maxBytes: number;
  readonly maxLines: number;
}

/**
 * The budget a look's own outline is held to: about 1.5k tokens at {@link estimateTokens}'s bytes ÷ 4.
 *
 * JUDGEMENT, not a measurement — no real console snapshot was on disk where this was written (sessions delete
 * their own when they close), so the first real looks are what to tune it against; every receipt prints both
 * sizes so that measurement is taken by the reading itself.
 */
export const OUTLINE_BUDGET: ExcerptBudget = { maxBytes: 6 * 1024, maxLines: 120 };

/** Every `[ref=…]` on a line, each a candidate for that line's OWN ref. */
const REF_CANDIDATE = /\[ref=([A-Za-z0-9]+)\]/gu;

/**
 * Estimate how many tokens a byte count costs a model, as bytes ÷ 4 rounded up.
 *
 * An ESTIMATE, and printed as one: the true count depends on the tokenizer and the text, and a snapshot's refs
 * and punctuation tokenize denser than prose. It is the right order of magnitude, which is what a reader deciding
 * whether to open a file needs.
 *
 * @param bytes the UTF-8 size
 * @returns the estimate
 */
export function estimateTokens({ bytes }: { bytes: number }): number {
  return Math.ceil(bytes / 4);
}

/**
 * Open the snapshot breadth-first from its top, or from one ref, until the budget is spent.
 *
 * A node is opened only when ALL its children fit, so an excerpt never shows half a list and implies the rest is
 * absent; every node left closed is one line under its parent naming the ref that opens it and how many lines it
 * holds. Should the top level alone overrun the budget, it is cut and a closing line says how much was left.
 *
 * @param yaml the snapshot file's whole text
 * @param under the ref to open from, rather than the page's top — always opened, however wide, so a cut follows
 * @param budget the byte and line ceiling on the printed lines, closing line included
 * @returns the excerpt, or why `under` names no single element of this snapshot
 */
export function outlineSnapshot({
  yaml,
  under,
  budget,
}: {
  yaml: string;
  under: string | undefined;
  budget: ExcerptBudget;
}): Result<SnapshotExcerpt, ElementsError> {
  const roots = parseSnapshot({ yaml });
  return startNodes({ roots, under }).map((start) => {
    const open = openBreadthFirst({ budget, forceStart: under !== undefined, start });
    const lines: string[] = [];
    for (const node of start) {
      renderOpen({ depth: 0, lines, node, open });
    }
    return excerpt({ budget, lines, roots, yaml });
  });
}

/** Where an outline opens from: the page's top, or the ONE node carrying `under`. */
function startNodes({
  roots,
  under,
}: {
  roots: readonly SnapshotNode[];
  under: string | undefined;
}): Result<readonly SnapshotNode[], ElementsError> {
  if (under === undefined) {
    return ok(roots);
  }
  const found = nodesWithRef({ nodes: roots, ref: under });
  if (found.length === 0) {
    return err(ElementsErrors.refAbsent({ ref: under }));
  }
  if (found.length > 1) {
    return err(ElementsErrors.refAmbiguous({ count: found.length, ref: under }));
  }
  return ok(found);
}

/**
 * Choose which nodes to open, a level at a time, until the budget is spent.
 *
 * A level is finished before the next begins, and once any node of a level could not be opened no deeper level
 * is: otherwise the budget a large sibling could not use would be spent on the grandchildren of a small one, and
 * the page's second landmark would stay shut while the first one's detail was printed.
 *
 * Every node is priced at the depth it RENDERS at — the start nodes at zero, each child one deeper than its parent
 * — never its indentation in the file, which a snapshot need not keep consistent across its roots.
 *
 * `forceStart` opens the start nodes whether or not their children fit, and is what `--under <ref>` passes: a
 * subtree too wide for the budget would otherwise print the very marker that sent the reader there, naming the
 * same ref, so the advertised command could never make progress. Forced open, its children overrun into
 * {@link excerpt}'s cut, which keeps the first of them and counts the rest — the same shape a page whose top level
 * alone overruns already takes.
 */
function openBreadthFirst({
  start,
  budget,
  forceStart,
}: {
  start: readonly SnapshotNode[];
  budget: ExcerptBudget;
  forceStart: boolean;
}): ReadonlySet<SnapshotNode> {
  const open = new Set<SnapshotNode>();
  const spent = {
    bytes: start.reduce((sum, node) => sum + shownBytes({ depth: 0, node }), 0),
    lines: start.reduce((sum, node) => sum + shownLines({ node }), 0),
  };
  let frontier: readonly { node: SnapshotNode; depth: number }[] = start.map((node) => ({ depth: 0, node }));
  let levelComplete = true;
  let forced = forceStart;
  while (frontier.length > 0 && levelComplete) {
    const next: { node: SnapshotNode; depth: number }[] = [];
    for (const { node, depth } of frontier.filter((entry) => entry.node.children.length > 0)) {
      const cost = openingCost({ depth: depth + 1, node });
      const fits = spent.bytes + cost.bytes <= budget.maxBytes && spent.lines + cost.lines <= budget.maxLines;
      if (!fits) {
        levelComplete = false;
      }
      if (!fits && !forced) {
        continue;
      }
      open.add(node);
      spent.bytes += cost.bytes;
      spent.lines += cost.lines;
      next.push(...node.children.map((child) => ({ depth: depth + 1, node: child })));
    }
    forced = false;
    frontier = next;
  }
  return open;
}

/** What opening a node adds: its children, each closed, in place of its one marker line. */
function openingCost({ node, depth }: { node: SnapshotNode; depth: number }): { bytes: number; lines: number } {
  const bytes = node.children.reduce((sum, child) => sum + shownBytes({ depth, node: child }), 0);
  const lines = node.children.reduce((sum, child) => sum + shownLines({ node: child }), 0);
  return { bytes: bytes - markerBytes({ depth, node }), lines: lines - 1 };
}

/**
 * Parse the snapshot's text into its tree, one node per non-blank line.
 *
 * @param yaml the snapshot file's whole text
 * @returns the top-level nodes, each carrying its subtree
 */
export function parseSnapshot({ yaml }: { yaml: string }): SnapshotNode[] {
  const roots: SnapshotNode[] = [];
  const stack: SnapshotNode[] = [];
  for (const raw of yaml.split(/\r?\n/u)) {
    const text = raw.trimStart();
    if (text.trim().length === 0) {
      continue;
    }
    const depth = Math.floor((raw.length - text.length) / 2);
    const node: SnapshotNode = { children: [], depth, lines: 1, ref: ownRef({ line: text }), text: text.trimEnd() };
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    for (const ancestor of stack) {
      ancestor.lines += 1;
    }
    stack.push(node);
  }
  return roots;
}

/** The ref a line's own key carries, read the way `act`'s ref check reads it; a planted one is not it. */
function ownRef({ line }: { line: string }): string | undefined {
  for (const match of line.matchAll(REF_CANDIDATE)) {
    const ref = match[1]!;
    if (snapshotRefElement({ ref, yaml: line }) !== null) {
      return ref;
    }
  }
  return undefined;
}

/** Every node whose own key carries `[ref=<ref>]`, depth-first. */
function nodesWithRef({ nodes, ref }: { nodes: readonly SnapshotNode[]; ref: string }): SnapshotNode[] {
  const found: SnapshotNode[] = [];
  for (const node of nodes) {
    if (node.ref === ref) {
      found.push(node);
    }
    found.push(...nodesWithRef({ nodes: node.children, ref }));
  }
  return found;
}

/** Render one node and, when it was opened, its children; a closed node with children gets its marker line. */
function renderOpen({
  node,
  depth,
  open,
  lines,
}: {
  node: SnapshotNode;
  depth: number;
  open: ReadonlySet<SnapshotNode>;
  lines: string[];
}): void {
  lines.push(`${"  ".repeat(depth)}${node.text}`);
  if (node.children.length === 0) {
    return;
  }
  if (!open.has(node)) {
    lines.push(tailLine({ depth: depth + 1, node }));
    return;
  }
  for (const child of node.children) {
    renderOpen({ depth: depth + 1, lines, node: child, open });
  }
}

/**
 * The one line standing for a closed node's children: a marker naming the ref that opens them — or, when they are
 * a single line no longer than that marker (a link's `/url`, say), that line itself, since collapsing it would
 * cost more than showing it.
 */
function tailLine({ node, depth }: { node: SnapshotNode; depth: number }): string {
  const how = node.ref === undefined ? "open the nearest ref above it with --under" : `--under ${node.ref}`;
  const marker = `${"  ".repeat(depth)}… ${String(node.lines - 1)} more line(s) — ${how}`;
  const only = node.lines === 2 ? node.children[0] : undefined;
  if (only === undefined) {
    return marker;
  }
  const shown = `${"  ".repeat(depth)}${only.text}`;
  return Buffer.byteLength(shown, "utf8") <= Buffer.byteLength(marker, "utf8") ? shown : marker;
}

/** What a closed node's tail line costs, newline included. */
function markerBytes({ node, depth }: { node: SnapshotNode; depth: number }): number {
  return Buffer.byteLength(`${tailLine({ depth, node })}\n`, "utf8");
}

/** What a node costs shown CLOSED: its own line, and its marker when it has children. */
function shownBytes({ node, depth }: { node: SnapshotNode; depth: number }): number {
  const own = Buffer.byteLength(`${"  ".repeat(depth)}${node.text}\n`, "utf8");
  if (node.children.length === 0) {
    return own;
  }
  return own + markerBytes({ depth: depth + 1, node });
}

/** How many lines a node takes shown closed. */
function shownLines({ node }: { node: SnapshotNode }): number {
  return node.children.length === 0 ? 1 : 2;
}

/**
 * Hold the rendered lines to the budget — the hard ceiling, whatever the walk above decided — and size them.
 *
 * A cut keeps whole lines from the top and reserves room for its own closing line, so neither ceiling is ever
 * passed; it never ends between an element and its children (`dropDangling`), and the elements it drops whole are
 * counted in the closing line rather than named, which is what `--find` is for.
 *
 * Once a cut is needed, a line longer than a quarter of the byte budget is SHORTENED to that quarter, its head
 * kept and a suffix naming how many bytes it lost (`clipLine`). Without that, one text node bigger than the budget
 * — a log in a `pre`, a long paragraph — could never be printed, and `--under` its parent would answer the closing
 * line alone (a Codex counterexample). A quarter keeps a parent, one child and the closing line inside the
 * budget together. Residue: a shortened line whose own `[ref=…]` sat in its lost tail no longer shows that ref;
 * the file on disk, and `--find`, still carry the whole line.
 *
 * @param lines the rendered lines, before any cut
 * @param roots the parsed snapshot, whose line count is the whole file's
 * @param yaml the snapshot's whole text, whose size is the whole file's
 * @param budget the hard ceiling on the printed lines
 * @returns the excerpt and both of its sizes
 */
export function excerpt({
  lines: entries,
  roots,
  yaml,
  budget,
}: {
  lines: readonly string[];
  roots: readonly SnapshotNode[];
  yaml: string;
  budget: ExcerptBudget;
}): SnapshotExcerpt {
  const whole = entries.map((text) => oneLine({ text }));
  const fullBytes = Buffer.byteLength(yaml, "utf8");
  const fullLines = roots.reduce((sum, root) => sum + root.lines, 0);
  const fits = whole.length <= budget.maxLines && joinedBytes({ lines: whole }) <= budget.maxBytes;
  if (fits) {
    return { cut: false, fullBytes, fullLines, lines: whole, printedBytes: joinedBytes({ lines: whole }) };
  }
  const lines = whole.map((line) => clipLine({ line, maxBytes: Math.floor(budget.maxBytes / 4) }));
  if (lines.length <= budget.maxLines && joinedBytes({ lines }) <= budget.maxBytes) {
    return { cut: true, fullBytes, fullLines, lines, printedBytes: joinedBytes({ lines }) };
  }
  const closing = ({ left }: { left: number }): string =>
    `… excerpt cut: ${String(left)} more line(s) — open a ref above with --under, or search with --find`;
  // A budget with no room for even the closing line, whole, prints nothing at all: a closing line cut short could
  // lose the very count it exists to state.
  if (budget.maxLines < 1 || joinedBytes({ lines: [closing({ left: lines.length })] }) > budget.maxBytes) {
    return { cut: true, fullBytes, fullLines, lines: [], printedBytes: 0 };
  }
  const kept: string[] = [];
  for (const line of lines) {
    const candidate = [...kept, line, closing({ left: lines.length - kept.length - 1 })];
    if (candidate.length > budget.maxLines || joinedBytes({ lines: candidate }) > budget.maxBytes) {
      break;
    }
    kept.push(line);
  }
  // Each line dropped here frees at least two bytes and a line, more than the one digit the count can gain.
  dropDangling({ kept, lines });
  const closed = [...kept, closing({ left: lines.length - kept.length })];
  return { cut: true, fullBytes, fullLines, lines: closed, printedBytes: joinedBytes({ lines: closed }) };
}

/**
 * Never end a cut on a line whose own children it dropped: shown alone, that line would read as an element with
 * nothing under it, its marker gone with the rest. Such lines are dropped too, back to the last line whose
 * following line is no deeper — so every element printed carries its tail or every child it has.
 */
function dropDangling({ kept, lines }: { kept: string[]; lines: readonly string[] }): void {
  const indent = ({ line }: { line: string }): number => line.length - line.trimStart().length;
  while (
    kept.length > 0 &&
    kept.length < lines.length &&
    indent({ line: lines[kept.length]! }) > indent({ line: kept.at(-1)! })
  ) {
    kept.pop();
  }
}

/**
 * Shorten one line to `maxBytes`, keeping its indentation and head and ending on a suffix that says how many bytes
 * were lost. A line already inside the limit, or a limit with no room for the suffix, leaves the line whole.
 *
 * Residue, stated: under a budget whose quarter cannot hold the suffix (about 200 bytes of budget or less) an
 * oversized line is left whole, so `--under` its parent can still answer the closing line alone (a
 * 120-byte budget). No caller passes such a budget — `--under` is held to {@link OUTLINE_BUDGET} only — so the
 * guarantee is made for the budgets that ship, not for every budget.
 */
function clipLine({ line, maxBytes }: { line: string; maxBytes: number }): string {
  const size = Buffer.byteLength(line, "utf8");
  if (size <= maxBytes) {
    return line;
  }
  const suffix = ({ lost }: { lost: number }): string => ` … [${String(lost)} more byte(s) on this line]`;
  const room = maxBytes - Buffer.byteLength(suffix({ lost: size }), "utf8");
  if (room <= line.length - line.trimStart().length) {
    return line;
  }
  let head = "";
  let headBytes = 0;
  for (const char of line) {
    const width = Buffer.byteLength(char, "utf8");
    if (headBytes + width > room) {
      break;
    }
    head += char;
    headBytes += width;
  }
  return `${head}${suffix({ lost: size - headBytes })}`;
}

/** The UTF-8 size of lines joined by newlines. */
function joinedBytes({ lines }: { lines: readonly string[] }): number {
  return Buffer.byteLength(lines.join("\n"), "utf8");
}
