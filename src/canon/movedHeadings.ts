/**
 * The other half of the always-on docs budget: proving that what LEFT the root file still exists, and is
 * still reachable from it.
 *
 * ## Why this is a separate module from the budget
 *
 * A size gate has one obvious way to go green — delete paragraphs until the number drops. The owner's
 * constraint on this whole restructure was that the gate must never be able to do that, and the answer is
 * not to make one cleverer check but to make two checks that cannot satisfy each other. `alwaysOnDocs.ts`
 * measures and can only ever be made happy by REMOVING text. This module can only ever be made happy by that
 * same text EXISTING SOMEWHERE LINKED. Green on both means the content moved; deleting it reddens this one,
 * and padding the root reddens that one.
 *
 * ## What a move has to satisfy
 *
 * Three things, and each catches a different way a "move" goes wrong:
 *
 * - the heading is GONE from the root file — otherwise nothing moved and the manifest is describing a wish;
 * - the heading is PRESENT in the destination — the actual relocation;
 * - the destination is REACHABLE from the root by following links, within {@link MAX_HOPS}. A paragraph
 *   parked in an unlinked file is deleted with extra steps: no session will ever open it, and the root no
 *   longer says the thing. One hop is the owner's stated shape — root keeps the what, links to the why —
 *   and two is allowed so a skill's bundled reference file counts, since the root links the skill and the
 *   skill links the file.
 *
 * A fourth check lives in the manifest rather than the code: each entry carries the body size measured at
 * the time of the move, and the destination section must still be at least that big. That is what stops a
 * heading being relocated with its paragraphs quietly dropped on the way — the shape a reviewer skims past,
 * because the diff shows a heading arriving in a new file and reads as a clean move.
 */

import { posix } from "node:path";

/** One section that used to live in the root instructions file, and where it went. */
export interface MovedHeading {
  /** The heading line as it must read in the destination. */
  readonly heading: string;
  /**
   * The heading line as it read in the ROOT file, when the move changed its level.
   *
   * A `###` subsection promoted to a `##` in its new home is still the same section, and the root check has
   * to look for the spelling the root actually used or it would pass over a heading that never left.
   */
  readonly rootHeading?: string;
  /** The repo-relative file it now lives in. */
  readonly destination: string;
  /** Non-blank body lines the section had when it was moved. The destination must still carry at least this many. */
  readonly bodyLines: number;
}

/**
 * One section whose HEADING stayed in the root file while its detail moved out.
 *
 * The root keeps a heading and a few lines that change what an agent does, and the reference behind it goes
 * somewhere linked — the owner's stated shape. `MovedHeading` cannot describe that: its first check is that
 * the heading is gone, which for these is exactly what must NOT happen. So they are declared separately, and
 * what is checked is that the destination exists, is reachable, and still carries the bulk it was given.
 *
 * A body split across a tree of pages names every page, and the bulk is summed across them: a split moves
 * lines between destinations, and only a drop in the total is detail lost.
 */
export interface MovedBody {
  /** What moved, for the failure message. */
  readonly label: string;
  /** The repo-relative files the detail now lives in — one, or an index and the pages it links to. */
  readonly destinations: readonly [string, ...string[]];
  /** Non-blank lines the destinations held together at the move. They must still hold at least this many. */
  readonly minLines: number;
}

/** How many link hops from the root file a destination may sit and still count as reachable. */
export const MAX_HOPS = 2;

/** One thing wrong with a declared move, phrased so the failure itself says what to do. */
export interface MoveProblem {
  readonly heading: string;
  readonly detail: string;
}

/**
 * Every repo-relative markdown path a document links to.
 *
 * Both spellings count, because the root file uses both: a markdown link, and an `@`-import (which Claude
 * Code expands at launch, making the imported file part of the root's own text rather than a hop away). A
 * link with an anchor or a query resolves to the file itself — the anchor selects a part of a document that
 * is already reachable.
 *
 * @param content the document's text
 * @returns each linked path, deduplicated, in first-seen order
 */
export function linkedPaths({ content }: { content: string }): readonly string[] {
  const seen = new Set<string>();
  const add = ({ raw }: { raw: string }): void => {
    const path = raw.split("#")[0]!.split("?")[0]!.trim();
    if (path.length > 0 && !path.startsWith("http") && path.endsWith(".md")) {
      seen.add(path);
    }
  };
  const links = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match = links.exec(content);
  while (match !== null) {
    add({ raw: match[1]! });
    match = links.exec(content);
  }
  const imports = /(?:^|\s)@([A-Za-z0-9_./-]+\.md)\b/g;
  match = imports.exec(content);
  while (match !== null) {
    add({ raw: match[1]! });
    match = imports.exec(content);
  }
  return [...seen];
}

/**
 * Every document reachable from `root` by following links, out to `maxHops`.
 *
 * A link inside a skill's `SKILL.md` is relative to that skill's own directory, so a path is resolved
 * against the directory of the file that named it. Without that, `reference/reviewer.md` linked from
 * `skills/loop/SKILL.md` would be looked up at the repo root and silently count as unreachable — which
 * would report a correctly-moved paragraph as lost.
 *
 * @param root the repo-relative path to start from
 * @param maxHops how many links deep to walk
 * @param read returns a document's text, or undefined when it does not exist
 * @returns every reachable repo-relative path, including `root` itself
 */
export function reachableDocs({
  root,
  maxHops,
  read,
}: {
  root: string;
  maxHops: number;
  read: ({ path }: { path: string }) => string | undefined;
}): ReadonlySet<string> {
  const seen = new Set<string>([root]);
  let frontier: readonly string[] = [root];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = linksFrom({ frontier, read }).filter((path) => !seen.has(path));
    for (const path of next) {
      seen.add(path);
    }
    frontier = next;
  }
  return seen;
}

/**
 * Every document one hop out from a set of documents, each link resolved against its own file.
 *
 * @param frontier the paths to expand
 * @param read returns a document's text, or undefined when it does not exist
 * @returns each linked path, resolved to repo-relative, possibly with duplicates
 */
function linksFrom({
  frontier,
  read,
}: {
  frontier: readonly string[];
  read: ({ path }: { path: string }) => string | undefined;
}): readonly string[] {
  return frontier.flatMap((from) => {
    const content = read({ path: from });
    return content === undefined ? [] : linkedPaths({ content }).map((link) => resolveLink({ from, link }));
  });
}

/**
 * Resolve one link against the file that named it.
 *
 * A link inside a skill's `SKILL.md` is relative to that skill's own directory. Resolving it at the repo root
 * instead would report a correctly-moved paragraph as unreachable, which is the wrong direction for a gate
 * whose whole job is not crying wolf about content that is fine.
 *
 * @param from the repo-relative path of the document containing the link
 * @param link the link's own text
 * @returns the repo-relative path the link points at
 */
function resolveLink({ from, link }: { from: string; link: string }): string {
  if (link.startsWith("/")) {
    return link.slice(1);
  }
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  return dir === "" ? link : normalise({ path: `${dir}/${link}` });
}

/**
 * Collapse `.` and `..` segments in a joined repo-relative path.
 *
 * @param path the joined path
 * @returns the same path with navigation segments resolved
 */
function normalise({ path }: { path: string }): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * How many non-blank lines a heading's OWN body holds — up to the next heading of any level.
 *
 * Own body, not the whole subtree, and that is the load-bearing choice. A subsection can legitimately change
 * nesting during a move: the cmux-sidebar section was a `###` child of the orchestration-run section in the
 * root file and became a `##` sibling in its destination. Counting the subtree would report the parent as
 * having lost 19 lines that are sitting right underneath it, and a check that cries wolf on a correct move
 * is a check people learn to edit rather than obey. Each heading answers for its own paragraphs, and a
 * subsection that matters is declared as its own entry.
 *
 * Returns undefined when the heading is absent, which the caller reports differently from a section that is
 * present but hollowed out.
 *
 * @param content the document's text
 * @param heading the exact heading line to find
 * @returns the heading's own non-blank body line count, or undefined when the heading is absent
 */
export function sectionBodyLines({ content, heading }: { content: string; heading: string }): number | undefined {
  const lines = content.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]!.startsWith("#")) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).filter((line) => line.trim().length > 0).length;
}

/**
 * The heading as the ROOT file spelled it. A move that kept the section's level declares no `rootHeading`,
 * because the root used the very spelling the destination carries.
 */
function rootSpellingOf({ move }: { move: MovedHeading }): string {
  const { rootHeading, heading } = move;
  if (rootHeading === undefined) {
    return heading;
  }
  return rootHeading;
}

/**
 * Check every declared move: gone from the root, present in the destination at full size, and reachable.
 *
 * Reports EVERY problem rather than the first, so one run says everything that is wrong.
 *
 * @param moves the declared moves
 * @param rootPath the repo-relative path of the root instructions file
 * @param reachable every path reachable from the root, from {@link reachableDocs}
 * @param read returns a document's text, or undefined when it does not exist
 * @returns one problem per failing check, empty when every move holds
 */
export function moveProblems({
  moves,
  rootPath,
  reachable,
  read,
}: {
  moves: readonly MovedHeading[];
  rootPath: string;
  reachable: ReadonlySet<string>;
  read: ({ path }: { path: string }) => string | undefined;
}): readonly MoveProblem[] {
  const rootContent = read({ path: rootPath });
  const problems: MoveProblem[] = [];
  for (const move of moves) {
    const rootSpelling = rootSpellingOf({ move });
    if (rootContent?.split("\n").includes(rootSpelling) === true) {
      problems.push({
        detail: `still present in ${rootPath} — nothing moved, so this entry describes an intention rather than a change`,
        heading: move.heading,
      });
    }
    const destination = read({ path: move.destination });
    if (destination === undefined) {
      problems.push({ detail: `destination ${move.destination} does not exist`, heading: move.heading });
      continue;
    }
    const size = sectionBodyLines({ content: destination, heading: move.heading });
    if (size === undefined) {
      problems.push({
        detail: `${move.destination} does not carry the heading — the section was removed, not moved`,
        heading: move.heading,
      });
    } else if (size < move.bodyLines) {
      problems.push({
        detail: `${move.destination} carries only ${String(size)} body lines, down from the ${String(move.bodyLines)} measured at the move — content was dropped on the way`,
        heading: move.heading,
      });
    }
    if (!reachable.has(move.destination)) {
      problems.push({
        detail: `${move.destination} is not reachable from ${rootPath} within ${String(MAX_HOPS)} link hops — a paragraph nothing links to is deleted with extra steps`,
        heading: move.heading,
      });
    }
  }
  return problems;
}

/**
 * Check every declared body move: each destination exists and is reachable, and together they still carry
 * the bulk.
 *
 * @param bodies the declared body moves
 * @param rootPath the repo-relative path of the root instructions file, for the message
 * @param reachable every path reachable from the root, from {@link reachableDocs}
 * @param read returns a document's text, or undefined when it does not exist
 * @returns one problem per failing check, empty when every body move holds
 */
export function bodyProblems({
  bodies,
  rootPath,
  reachable,
  read,
}: {
  bodies: readonly MovedBody[];
  rootPath: string;
  reachable: ReadonlySet<string>;
  read: ({ path }: { path: string }) => string | undefined;
}): readonly MoveProblem[] {
  const problems: MoveProblem[] = [];
  for (const body of bodies) {
    const { lines, missing, pageProblems } = scanDestinations({ body, reachable, read, rootPath });
    problems.push(...pageProblems);
    if (!missing && lines < body.minLines) {
      const where = describeDestinations({ destinations: body.destinations });
      problems.push({
        detail: `${where} ${String(lines)} non-blank lines, down from the ${String(body.minLines)} measured at the move — detail was dropped rather than relocated`,
        heading: body.label,
      });
    }
  }
  return problems;
}

/**
 * Read each of one body's destinations once: a duplicate, a missing page and an unreachable page are each a
 * problem naming that page, and every page read adds its non-blank lines to the body's total.
 *
 * @returns the summed lines, whether any page was missing (so the total is short for that reason alone), and
 *   the per-page problems
 */
function scanDestinations({
  body,
  reachable,
  read,
  rootPath,
}: {
  body: MovedBody;
  reachable: ReadonlySet<string>;
  read: ({ path }: { path: string }) => string | undefined;
  rootPath: string;
}): { lines: number; missing: boolean; pageProblems: readonly MoveProblem[] } {
  const pageProblems: MoveProblem[] = [];
  const seen = new Set<string>();
  let lines = 0;
  let missing = false;
  for (const destination of body.destinations) {
    // Keyed on the normalised path, so a `./` or `dir/..` segment cannot count one page twice.
    // A symlink alias is not caught here: the reader is a seam, and this repository tracks no symlinks.
    const page = posix.normalize(destination);
    if (seen.has(page)) {
      pageProblems.push({ detail: `destination ${destination} is declared twice`, heading: body.label });
      continue;
    }
    seen.add(page);
    const content = read({ path: destination });
    if (content === undefined) {
      pageProblems.push({ detail: `destination ${destination} does not exist`, heading: body.label });
      missing = true;
      continue;
    }
    lines += content.split("\n").filter((line) => line.trim().length > 0).length;
    if (!reachable.has(destination)) {
      pageProblems.push({
        detail: `${destination} is not reachable from ${rootPath} within ${String(MAX_HOPS)} link hops`,
        heading: body.label,
      });
    }
  }
  return { lines, missing, pageProblems };
}

/**
 * Name a body's destinations for a size failure: the one file, or the index and how many pages it links to.
 *
 * @returns the subject and verb of the sentence, "X holds" or "X and its N pages hold"
 */
function describeDestinations({ destinations }: { destinations: readonly [string, ...string[]] }): string {
  const [first, ...rest] = destinations;
  if (rest.length === 0) {
    return `${first} holds`;
  }
  return `${first} and its ${String(rest.length)} pages hold`;
}
