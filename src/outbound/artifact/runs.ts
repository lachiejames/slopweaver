/**
 * Walking a detail sequence's inline runs.
 *
 * Three separate places need "every run sequence in this sub-block": the schema (to validate citation
 * references), the dry run (to warn about markdown-looking text), and the CLI (to collect mentioned
 * people). Each had its own copy of the same paragraph/bullets/table fan-out, which is exactly the
 * kind of triplication that drifts — one copy forgets table cells and a whole class of content stops
 * being checked. One function, three callers.
 *
 * {@link mentionedPeopleOfCard} is the same lesson one level up: a card renders runs in TWO regions, and
 * collecting from only one of them is how a mention above the fold reached the renderer unresolved.
 */
import type {
  AsMeArtifact,
  DetailBlock,
  DripInlineRun,
  InlineRun,
  NoFoldArtifact,
  NoFoldInlineRun,
  OneListArtifact,
} from "./types.js";

/**
 * Every run sequence in a NO-FOLD message, in render order: the lead, each dot point, each trailing line.
 *
 * The single enumeration of that form's run-bearing fields, and every walker over it goes through here —
 * the schema's width check, its newline check, its raw-markup residue check, and
 * {@link mentionedPeopleOfNoFold}. That is the same lesson this module's own header records one form
 * along: a region a walker forgets is a region no rule ever reads.
 *
 * It lives beside the card walkers rather than in the schema that defines the form, because the schema
 * imports `./schema.ts` for a shared cap and `./schema.ts` imports this module — so a walker there would
 * close an import cycle.
 *
 * @param artifact the no-fold artifact
 * @returns the lead, then each bullet, then each trailing line
 */
export function noFoldSequences({ artifact }: { artifact: NoFoldArtifact }): readonly (readonly NoFoldInlineRun[])[] {
  return [artifact.lead, ...artifact.bullets, ...artifact.trailing];
}

/** One run sequence of an as-me send, tagged with the form field and position it was written in. */
export interface AsMeSequence {
  /** The field of the form this sequence came from — `messages`, `lines`, `lead`, `bullets`, `trailing`. */
  readonly field: string;
  /** Its position within that field. A single-sequence field reports 0, so every path has the same shape. */
  readonly index: number;
  readonly runs: readonly DripInlineRun[];
}

/**
 * Every run sequence in an AS-ME send, in render order, whichever of the four forms it is.
 *
 * The single enumeration of the as-me lane's run-bearing fields, for exactly the reason
 * {@link noFoldSequences} is one for the bot lane: four callers walk this union — the voice-rule scan, the
 * mentioned-people collection, the addressed-group collection and the raw-body branch's own guard — and
 * before this existed each of them spelled the fan-out itself as `kind === "one-card" ? lines : messages`.
 * That ternary is correct for exactly two arms and silently wrong for a third, which is how a form added to
 * the union gets its mentions collected by nobody and posts an unresolved `@person-key` in the operator's
 * own name.
 *
 * The `plain` escape hatch has NO sequences, and that is the honest answer rather than a gap: it is a bare
 * string with no typed runs in it at all, which is the property its own doc comment is about. A caller that
 * needs its bytes reads `artifact.text`.
 *
 * @param artifact the validated as-me send
 * @returns every sequence in render order, each naming the field and position it came from
 */
export function asMeSequences({ artifact }: { artifact: AsMeArtifact }): readonly AsMeSequence[] {
  if (artifact.kind === "plain") {
    return [];
  }
  if (artifact.kind === "one-card") {
    return artifact.lines.map((line, index) => ({ field: "lines", index, runs: line.runs }));
  }
  if (artifact.kind === "one-list") {
    return [
      { field: "lead", index: 0, runs: artifact.lead },
      ...artifact.bullets.map((runs, index) => ({ field: "bullets", index, runs })),
      ...artifact.trailing.map((runs, index) => ({ field: "trailing", index, runs })),
    ];
  }
  return artifact.messages.map((message, index) => ({ field: "messages", index, runs: message.runs }));
}

/**
 * How many headline dot points a one-list carries: every point when it declares no depths, else the depth-0 ones.
 * A sub-point is part of the dot point it sits under, so it never counts as a dot point of its own.
 *
 * @param artifact the one-list post
 * @returns the headline count, sub-points excluded
 */
export function listHeadlineCount({ artifact }: { artifact: OneListArtifact }): number {
  if (artifact.depths === undefined) {
    return artifact.bullets.length;
  }
  return artifact.depths.filter((depth) => depth === 0).length;
}

/**
 * The authored words of one run sequence: text runs that are neither code nor somebody else's quoted words. A
 * link's label is somebody else's title and a mention is a name, so each skipped run leaves one space where it
 * stood rather than welding its neighbours together.
 *
 * @returns the words, a skipped run standing as one space
 */
export function authoredWordsOf({ runs }: { runs: readonly DripInlineRun[] }): string {
  return runs.map((run) => (run.type === "text" && run.code !== true && run.quoted !== true ? run.text : " ")).join("");
}

/**
 * Rewrite every run sequence of an as-me send, keeping its form and every other field exactly as it was.
 *
 * The write half of {@link asMeSequences}, and separate from it because a rewrite has to rebuild the form's
 * own shape — a one-card holds `{ runs }` wrappers and a one-list holds bare sequences, so a caller mapping
 * over the READ view could not put the results back. Both halves live here so a form added to the union is
 * two edits in one file rather than a compile error in four.
 *
 * `plain` is returned untouched: it has no runs to map, and rewriting its bytes is a different operation
 * that its own caller does explicitly.
 *
 * @param map what each sequence becomes
 * @returns the same artifact with every sequence replaced
 */
export function mapAsMeSequences({
  artifact,
  map,
}: {
  artifact: AsMeArtifact;
  map: (runs: readonly DripInlineRun[]) => readonly DripInlineRun[];
}): AsMeArtifact {
  if (artifact.kind === "plain") {
    return artifact;
  }
  if (artifact.kind === "one-card") {
    return { ...artifact, lines: artifact.lines.map((line) => ({ runs: map(line.runs) })) };
  }
  if (artifact.kind === "one-list") {
    return {
      ...artifact,
      bullets: artifact.bullets.map((runs) => map(runs)),
      lead: map(artifact.lead),
      trailing: artifact.trailing.map((runs) => map(runs)),
    };
  }
  return { ...artifact, messages: artifact.messages.map((message) => ({ runs: map(message.runs) })) };
}

/**
 * Every run sequence inside one detail sub-block: a paragraph's runs, each bullet item's runs, or
 * every table cell's runs.
 *
 * @param block the sub-block to walk
 * @returns the sequences, in document order
 */
export function runSequencesOf({ block }: { block: DetailBlock }): readonly (readonly InlineRun[])[] {
  if (block.type === "paragraph") {
    return [block.runs];
  }
  if (block.type === "bullets" || block.type === "list") {
    return block.items;
  }
  return block.rows.flat();
}

/**
 * Every inline run across a whole detail sequence, flattened.
 *
 * @param detail the ordered detail sub-blocks
 * @returns every run, in document order
 */
export function allRunsOf({ detail }: { detail: readonly DetailBlock[] }): readonly InlineRun[] {
  return detail.flatMap((block) => runSequencesOf({ block }).flat());
}

/**
 * Every distinct USER GROUP addressed anywhere a card renders runs — its ABOVE-THE-FOLD index first, then
 * its detail sub-blocks — in first-appearance order.
 *
 * A sibling of {@link mentionedPeopleOfCard} rather than a second return value from it, because the two
 * resolve against different indexes and a caller that needs one may legitimately not need the other. Both
 * take `index` as a REQUIRED parameter for the reason that function's note records: a run written into the
 * region a reader sees first is exactly the one an optional parameter loses.
 *
 * @param detail the ordered detail sub-blocks
 * @param index the above-the-fold index lines — pass `[]` for a shape that has none
 * @returns each addressed group handle, once
 */
export function addressedGroupsOfCard({
  detail,
  index,
}: {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
}): readonly string[] {
  const handles: string[] = [];
  for (const run of [...index.flat(), ...allRunsOf({ detail })]) {
    if (run.type === "group" && !handles.includes(run.handle)) {
      handles.push(run.handle);
    }
  }
  return handles;
}

/**
 * Every distinct person mentioned in a NO-FOLD message, in first-appearance order.
 *
 * It takes the whole artifact rather than its parts, unlike {@link mentionedPeopleOfCard}, and that is the
 * lesson from that function's own history applied one step earlier: its predecessor took `detail` alone, a
 * `mention` in `index` was never collected, and the renderer threw mid-send. A form with three run-bearing
 * fields would have three chances to make that mistake, so the caller does not get to choose which of them
 * to pass — `noFoldSequences` enumerates every one, and a fourth field added later is collected the moment
 * it joins that function.
 *
 * @param artifact the validated no-fold artifact
 * @returns each mentioned identity-map key, once
 */
export function mentionedPeopleOfNoFold({ artifact }: { artifact: NoFoldArtifact }): readonly string[] {
  const people: string[] = [];
  for (const run of noFoldSequences({ artifact }).flat()) {
    if (run.type === "mention" && !people.includes(run.person)) {
      people.push(run.person);
    }
  }
  return people;
}

/**
 * Every distinct person mentioned anywhere a card renders runs — its ABOVE-THE-FOLD index first, then its
 * detail sub-blocks — in first-appearance order.
 *
 * `index` is a required parameter rather than a defaulted one, and that is the whole point of this
 * signature. Its predecessor read `detail` alone, so a `mention` run written into the index — the natural
 * place for one, since that is the region a reader sees before expanding — was never collected, never
 * resolved, and then threw `UnresolvedMentionError` out of the renderer mid-send. Measured on this tree:
 * an answer whose only mention sat in `index` collected `[]` people and the render threw
 * `cannot resolve a mention for "U…": no exact match in the identity map`. Making the field required means
 * a caller that forgets a region fails to compile instead of failing in a thread.
 *
 * @param detail the ordered detail sub-blocks
 * @param index the above-the-fold index lines — pass `[]` for a shape that has none
 * @returns each mentioned identity-map key, once
 */
export function mentionedPeopleOfCard({
  detail,
  index,
}: {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
}): readonly string[] {
  const people: string[] = [];
  for (const run of [...index.flat(), ...allRunsOf({ detail })]) {
    if (run.type === "mention" && !people.includes(run.person)) {
      people.push(run.person);
    }
  }
  return people;
}
