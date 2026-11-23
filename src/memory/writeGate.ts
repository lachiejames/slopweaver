/**
 * What a gate can honestly decide about a memory BEFORE the write lands — the pure half of the `PreToolUse`
 * guard. One tool payload's worth of text in, plus the corpus and canon the caller already read, and the
 * defects that text introduces out. No filesystem, no clock.
 *
 * Three questions: a malformed `name`, an unresolvable wikilink, and an OVERLAP the writer has not answered
 * — another memory or an always-on canon section on the same subject, nominated by
 * `./overlapNomination.ts` and answered `supersedes` or `compatible` in the leaf's own frontmatter.
 *
 * ## Why the graph checks, and a dated addendum, are not here
 *
 * `checkMemoryLeaf`'s own doc comment names the property this module needs: a file's own frontmatter cannot
 * be changed by a write that has not happened yet, so a file-LOCAL answer is never transient. Everything in
 * the graph is the opposite — `orphan`, `unreachable` and `double-routed` all have a legitimate
 * half-written window, and `checkMemoryCorpus` already warns that reading the graph mid-save reports a route
 * the other session is about to write. A gate that REFUSES on a transient reading is worse than the
 * `PostToolUse` reporter it would replace, so the graph checks stay where they are.
 *
 * `dated-addendum` is file-local too and is still not here. It reads prose, and eight review passes each
 * found a sound memory in whichever shape was refused — `- **Narrowed <date>** back to 15 connections`
 * records a pool's history, not an edit to the memory. Across 1789 live memory directories the narrowest
 * shape refused one write, so the reporter and `memory gate` carry it and nothing refuses on it.
 *
 * ## The wikilink rule is narrower than "dangling", deliberately
 *
 * Claude Code's own standing memory instruction tells the writer to *"link liberally — a `[[name]]` that
 * doesn't match an existing memory yet is fine; it marks something worth writing later, not an error"*.
 * Refusing every unresolved link would refuse writes that instruction blesses, and would do it on the
 * commonest shape there is: two related memories written in two consecutive tool calls, where the first
 * link necessarily dangles for one of them.
 *
 * What the corpus review actually measured was a link pointing at a rule DOCUMENT rather than a memory
 * — a target that is not a memory identity at all and can never become one however many memories are
 * written later. So this gate refuses a target that fails the {@link isWellFormedMemoryName} grammar, and
 * allows a well-formed forward reference. Reporting is UNCHANGED: `dangling-wikilink` still fires in
 * `memory check` and in the `PostToolUse` reporter for a well-formed link that resolves to nothing. Only
 * the REFUSAL is scoped to what is provably never-resolvable.
 */

import { parseMemoryLeaf } from "./corpus.js";
import { isWellFormedMemoryName, nameFormatFindingsForName } from "./nameFormat.js";
import {
  type CanonSection,
  nominateOverlaps,
  type OverlapNomination,
  overlapDefect,
  unansweredOverlaps,
} from "./overlapNomination.js";
import { extractWikilinks, parseFrontmatter } from "./parse.js";
import type { MemoryLeaf } from "./types.js";

/**
 * A `name:` line at the very start of a line, which is where frontmatter puts it. Used only for the `Edit`
 * path, where the payload carries a PATCH FRAGMENT with no frontmatter fences for a real parser to find.
 *
 * It captures the rest of the line RAW and lets `trim` do the trimming. Spelling the surrounding
 * whitespace into the pattern instead — a quantified run either side of a lazy one — is what `redos-check`
 * correctly reports as polynomial backtracking on a line a caller controls.
 */
const NAME_LINE = /^name:(.*)$/m;

/** Which tool is writing, and therefore whether the text is a whole file or a patch fragment. */
export type MemoryWriteKind = "whole-file" | "fragment";

/**
 * The declared name this text sets, or `null` when it sets none.
 *
 * A whole file goes through the real frontmatter parser, so a `name:` inside a fenced block or in the prose
 * cannot be mistaken for the declaration. A fragment has no fences to find, so it is matched by line — the
 * residue being a fragment that inserts a literal `name:` line into a memory's BODY, which this would judge
 * as a declaration. Measured against the alternative, that residue is worth carrying: the `Edit` path is the
 * only way a rename reaches an already-written memory.
 *
 * @param text the payload's whole-file content or patch fragment
 * @param kind which of the two it is
 * @param file the leaf's basename, used only to attribute a parse finding
 * @returns the name this text declares, or `null`
 */
export function declaredNameInWrite({
  text,
  kind,
  file,
}: {
  text: string;
  kind: MemoryWriteKind;
  file: string;
}): string | null {
  if (kind === "fragment") {
    const matched = NAME_LINE.exec(text);
    if (matched === null) {
      return null;
    }
    const captured = matched[1];
    if (captured === undefined) {
      return null;
    }
    const trimmed = captured.trim();
    // `name:` with nothing after it declares no name — it is `schema`'s finding, not this gate's.
    if (trimmed === "") {
      return null;
    }
    return trimmed;
  }
  return parseFrontmatter({ file, text }).declaredName;
}

/**
 * Every wikilink target in this text that can never resolve to any memory, in document order.
 *
 * Targets are read through {@link extractWikilinks}, so a link inside a fenced block or an HTML comment is
 * not an edge, and a trailing `.md` is stripped before judging — `[[thing.md]]` and `[[thing]]` are the same
 * reference, exactly as the checker treats them.
 *
 * @param text the payload's whole-file content or patch fragment
 * @returns the malformed targets, deduplicated, in first-occurrence order
 */
export function unresolvableWikilinkTargets({ text }: { text: string }): readonly string[] {
  const bad: string[] = [];
  for (const link of extractWikilinks({ text })) {
    if (!isWellFormedMemoryName({ value: link.target }) && !bad.includes(link.target)) {
      bad.push(link.target);
    }
  }
  return bad;
}

/**
 * The whole file this write would leave behind, or `null` when it cannot be reconstructed.
 *
 * A `Write` carries the result already. An `Edit` needs the file it is patching, so this is `null` when the
 * prior text could not be read or the payload named no `old_string`.
 *
 * @param text the payload's whole-file content, or an `Edit`'s replacement text
 * @param kind which of the two it is
 * @param priorText the leaf's current content, or `null`
 * @param replacedText the `Edit`'s `old_string`, or `null`
 * @param replaceAll whether the `Edit` replaces every occurrence rather than the first
 * @returns the resulting file, or `null` when only the fragment is decidable
 */
function resultingText({
  text,
  kind,
  priorText,
  replacedText,
  replaceAll,
}: {
  text: string;
  kind: MemoryWriteKind;
  priorText: string | null;
  replacedText: string | null;
  replaceAll: boolean;
}): string | null {
  if (kind === "whole-file") {
    return text;
  }
  if (priorText === null || replacedText === null) {
    return null;
  }
  // A FUNCTION replacer, never the string form: a replacement containing a dollar-ampersand or a
  // dollar-backtick is a PATTERN to `String.replace`, and a memory's body is text a caller controls.
  // Spelled the obvious way, one splices the surrounding file into itself and the gate judges something
  // nobody wrote.
  if (replaceAll) {
    return priorText.replaceAll(replacedText, () => text);
  }
  return priorText.replace(replacedText, () => text);
}

/**
 * Judge one write of one memory leaf, reporting only what THIS write introduces.
 *
 * ## Why an `Edit` is judged against the file it is editing
 *
 * The fragment alone is not a complete question, and believing it was is what let a rename through. An
 * `Edit` whose replacement text does not itself carry a literal `name:` token declares no name that
 * {@link declaredNameInWrite} can see, so `old_string: "a-fact"` with `new_string: "A_Fact"` left a leaf
 * declaring `name: A_Fact` and exited 0 — while the SAME rename spelled with the `name:` prefix exited 2.
 * The tool requires `old_string` to be unique in the file, and in an ordinary leaf the bare name occurs only
 * on that one line, so the escaping spelling is the one a caller will actually reach for.
 *
 * So the result of the write is reconstructed and judged whole, and the defects the file ALREADY had are
 * subtracted. Subtracting matters as much as judging, and it applies to a `Write` exactly as it does to an
 * `Edit`: five real corpus defects stand accepted on this machine, and a gate that judged the after-state
 * alone would refuse every rewrite of those memories, the rewrite that fixes one included. When the prior
 * text cannot be read the write is judged on its own — failing open on an unreadable file beats refusing on
 * it, and a leaf with no prior text is a new memory, whose every defect this write did introduce.
 *
 * @param text the payload's whole-file content, or an `Edit`'s replacement text
 * @param kind which of the two it is
 * @param file the leaf's basename
 * @param priorText the leaf's current content, or `null` when it could not be read
 * @param replacedText the `Edit`'s `old_string`, or `null` for a whole-file write
 * @param replaceAll whether the `Edit` replaces every occurrence rather than the first
 * @param overlap the rest of the leaf's corpus and the always-on canon beside it, which the overlap
 *   nomination reads — see {@link overlapIntroducedDefects}
 * @returns one sentence per defect this write introduces, empty when it introduces none
 */
export function writeIntroducedDefects({
  text,
  kind,
  file,
  priorText,
  replacedText,
  replaceAll,
  overlap,
}: {
  text: string;
  kind: MemoryWriteKind;
  file: string;
  priorText: string | null;
  replacedText: string | null;
  replaceAll: boolean;
  overlap: OverlapContext;
}): readonly string[] {
  const after = resultingText({ kind, priorText, replaceAll, replacedText, text });
  if (after === null) {
    return memoryWriteDefects({ file, kind, text });
  }
  const introduced = overlapIntroducedDefects({ after, file, overlap, priorText });
  if (priorText === null) {
    return [...memoryWriteDefects({ file, kind: "whole-file", text: after }), ...introduced];
  }
  const already = new Set(memoryWriteDefects({ file, kind: "whole-file", text: priorText }));
  return [
    ...memoryWriteDefects({ file, kind: "whole-file", text: after }).filter((defect) => !already.has(defect)),
    ...introduced,
  ];
}

/** What the overlap nomination reads beyond the write itself. */
export interface OverlapContext {
  /** Every OTHER leaf in the written leaf's corpus. A sibling sharing the written file's basename is ignored. */
  readonly siblings: readonly MemoryLeaf[];
  /** Every section of the always-on canon that loads beside the corpus. */
  readonly sections: readonly CanonSection[];
}

/**
 * The overlaps this write leaves UNANSWERED that the file did not already leave unanswered.
 *
 * ## Why this refuses when the graph checks do not
 *
 * The header's argument is about TRANSIENT readings — a route written a call before its leaf. An overlap is
 * not one: two memories on one subject are exactly as overlapping mid-save as after it, and the commonest real
 * shape, two related memories written in consecutive calls, is precisely the one this exists to ask about.
 * What keeps it from wedging is the subtraction below and the price of an answer: a false nomination costs
 * one `compatible` line.
 *
 * ## Subtracted against the prior text, like every other defect here
 *
 * An edit to a memory that already overlapped something unanswered is never asked about it: the overlap stood
 * before this write, so this write did not introduce it. Removing an answer does reintroduce one, because the
 * prior text's answered nomination is not in the prior's unanswered set.
 *
 * @param after the whole file the write leaves behind
 * @param priorText the file's current content, or `null` for a new memory
 * @param file the leaf's basename
 * @param overlap the siblings and canon sections to nominate from
 * @returns one sentence per newly unanswered nomination
 */
function overlapIntroducedDefects({
  after,
  priorText,
  file,
  overlap,
}: {
  after: string;
  priorText: string | null;
  file: string;
  overlap: OverlapContext;
}): readonly string[] {
  const siblings = overlap.siblings.filter((sibling) => sibling.file !== file);
  const unanswered = ({ text }: { text: string }): readonly OverlapNomination[] => {
    const leaf = parseMemoryLeaf({ file, text });
    return unansweredOverlaps({
      leaf,
      nominations: nominateOverlaps({ leaf, sections: overlap.sections, siblings }),
    });
  };
  const already = new Set(priorText === null ? [] : unanswered({ text: priorText }).map((each) => each.id));
  return unanswered({ text: after })
    .filter((nomination) => !already.has(nomination.id))
    .map((nomination) => overlapDefect({ nomination }));
}

/**
 * Judge one text as if it were the whole intent — the composed rule {@link writeIntroducedDefects} calls
 * three times. Not exported: a caller judging a fragment directly is what let a rename through, so the only
 * way in is the judge that also knows what the file already said.
 *
 * @param text the payload's whole-file content or patch fragment
 * @param kind which of the two it is
 * @param file the leaf's basename
 * @returns one sentence per defect this text carries, empty when it carries none
 */
function memoryWriteDefects({
  text,
  kind,
  file,
}: {
  text: string;
  kind: MemoryWriteKind;
  file: string;
}): readonly string[] {
  const defects: string[] = [];
  const name = declaredNameInWrite({ file, kind, text });
  if (name !== null) {
    for (const finding of nameFormatFindingsForName({ file, name })) {
      defects.push(finding.message);
    }
  }
  for (const target of unresolvableWikilinkTargets({ text })) {
    defects.push(
      `\`[[${target}]]\` is not a memory identity, so no memory can ever answer it — link to a memory's \`name\`, and put a pointer to a document in a markdown link instead`,
    );
  }
  return defects;
}
