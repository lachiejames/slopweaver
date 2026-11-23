/**
 * The FLAT half of a handover doc's front matter — every `key: value` scalar, read by hand rather than by
 * the YAML parser.
 *
 * Its own module beside `./docNested.ts`, and the split between the two is the whole design: `./doc.ts`'s
 * header explains why a malformed flat scalar must not be able to break the nested read, and two modules
 * neither of which can see the other's state is how that property is held rather than remembered. It is
 * also what keeps `./doc.ts` inside the file-size ratchet.
 *
 * Nothing here knows what a handover doc IS. These functions read lines and answer strings, which is why
 * the vocabulary — `DocStatus`, `SessionRole`, `HandoverDoc` — stays next door.
 */
import { collapseWhitespace } from "#lib/oneLineSummary.js";
import { isTopLevelKey, NESTED_KEYS } from "./docNested.js";
import { announcesBlock, decodeFlatScalar } from "./flatScalarCodec.js";

/** One `key: value` pair, or `undefined` for a blank or malformed line. */
function pair({ line }: { line: string }): readonly [string, string] | undefined {
  const colon = line.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
}

/*
 * The flat reader's one YAML-awareness, and why it is here rather than in the writer.
 *
 * MEASURED: 2,482 of 2,707 board rows carried a summary whose first character was a literal
 * double quote — every doc whose summary contains a `:` or a `#`, which is nearly all of them, because
 * `handover register` quotes such a value exactly as YAML requires. Nothing then unquoted it, so the value
 * a reader got was the SPELLING and not the string. Repro:
 * `slopweaver handover list --all --json | node -e '…rows.filter(r => r.summary?.startsWith(String.fromCharCode(34)))…'`.
 *
 * It read as deliberate on the terminal by coincidence — `render.ts` prints `<slug> — <summary>` bare, so
 * the YAML's quotes landed where a renderer's own would have. It stops reading as deliberate the moment a
 * value reaches a surface that quotes nothing: the console's queue card draws `problem` and `lean` in a
 * `<dd>` beside `options`, which go through the real YAML parser and so were already clean.
 *
 * The decoder is `./flatScalarCodec.ts`, beside the encoder it inverts; {@link flatValue} applies it to a whole
 * scalar and {@link asList} to each item of a flow list.
 */

/**
 * A `[a, b]` list, or a bare value, as an array.
 *
 * Each item goes through the same decoder as a scalar, because the writer encodes each one (`evidence:`:
 * a quote-leading item read back as its quoted spelling). The split is still on every comma, so an item carrying
 * one reads as two — no writer here produces one, and a quoted comma is not yet held together.
 *
 * @returns the items, trimmed, decoded and with empties dropped; empty when the field was absent
 */
export function asList({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return inner
    .split(",")
    .map((item) => decodeFlatScalar({ value: item.trim() }))
    .filter((item) => item.length > 0);
}

/**
 * The problem a front-matter key declared twice raises — one wording, so a reader that must REFUSE on one key
 * (`cmux spawn` on `template:`) matches the exact sentence the parser wrote rather than a copy of it.
 *
 * @param key the key declared more than once
 * @returns the problem sentence
 */
export function duplicateKeyProblem({ key }: { key: string }): string {
  return `front-matter declares "${key}" more than once — which one is meant?`;
}

/**
 * The flat `key: value` scalars, read by the ORIGINAL hand parser rather than by YAML.
 *
 * Kept deliberately, and the reason is measured rather than aesthetic. Handing the whole front-matter to a
 * strict YAML parser broke three live docs on the real board: a `summary:` beginning with a backtick is a
 * reserved character in a YAML plain scalar, and one containing `: ` reads as a nested mapping. Those docs
 * had parsed for weeks and were runnable, and the migration turned them malformed — a regression caught only
 * by running the board against the real directory, never by the unit suite.
 *
 * None of these fields ever needed nesting, so none of them needs YAML. Only `doneWhen:` does, and that is
 * read separately by {@link nestedFields}, whose failure cannot take a flat scalar down with it.
 *
 * ## A scalar that WRAPS is still one scalar, so this reader FOLDS it
 *
 * Reading a key's own physical line and stopping there is wrong for every scalar its author wrapped.
 * MEASURED on the real board:
 * a row whose `summary:` wrapped onto a second YAML line gave up only the fragment before the wrap,
 * stopping exactly where the line broke, while a quoted one-line summary came through
 * whole — and nineteen live docs whose `summary:`/`statusSummary:`/`ownerRuling:` used an explicit block
 * indicator returned the literal string `>` or `|` as the entire value (count them:
 * `grep -lE '^[A-Za-z_][A-Za-z0-9_-]*: *[>|][-+]? *$' ~/.slopweaver/handovers/*.md | wc -l`). Both were
 * invisible for as long as nothing rendered the field in full; `session-start`'s background is what
 * surfaced them, and it deliberately did not cap the length, because a cap hides a truncation.
 *
 * So a line that is INDENTED and non-blank continues the key above it, and the value is the key's own text
 * plus those lines folded together with single spaces. A `>`/`|` (with either chomping indicator) standing
 * alone as the value is an instruction ABOUT the scalar rather than the scalar, so it is dropped and the
 * lines below it become the whole value.
 *
 * **Folding to ONE line is the contract here, not a shortcut.** Every consumer of these fields prints a
 * board ROW — {@link ./render.ts}'s ready and blocked lists, `session-start`'s background, the fleet
 * briefing — so a `\n` arriving in a summary would trade a truncation defect for a layout one. Nothing is
 * lost by it: no live doc has a blank line inside a flat scalar, which is the only place YAML's own fold
 * would have produced a newline. Reproduce that —
 * `awk 'FNR==1{c=0} /^---$/{c++} c==1 && /^[ \t]*$/{print FILENAME}' ~/.slopweaver/handovers/*.md | sort -u`
 * reports three docs, and in every one the blank line sits inside the `doneWhen:` block this reader never
 * looks at.
 *
 * Folding is about PHYSICAL lines. A double-quoted value's escaped `\n` is part of the logical VALUE, and
 * {@link flatValue} decodes it after folding (`./flatScalarCodec.ts`), so the value read is the value written.
 * `parseHandoverDoc` then holds every field to one line, because its readers print rows; only `summary` keeps
 * its breaks, for `--keep-lines`, and its one-line printers collapse it themselves. 31 live
 * summaries carry one —
 * `grep -rlE '^summary: ".*[^\\](\\\\)*\\n' ~/.slopweaver/handovers/ | wc -l`.
 *
 * The nested keys are excluded by name for that same reason: a `doneWhen:` command block is many indented
 * lines that mean something else entirely, and {@link nestedBlock} owns them.
 *
 * ## The lines under a key are not always a wrapped sentence — sometimes they are a LIST
 *
 * `blockedBy:` is the one flat key authors write as a block sequence, and it is where this stopped being
 * cosmetic. MEASURED: TWELVE live docs declared a dependency as `blockedBy:` followed by
 * indented `- slug` lines, and the board read `blockedBy: []` for every one of them. Count them:
 * `awk '/^blockedBy:$/{f=1;next} f&&/^ +- /{print FILENAME; f=0} /^[A-Za-z]/{f=0}' ~/.slopweaver/handovers/*.md | sort -u | wc -l`
 *
 * Two of the twelve are ROWS THAT MOVE — `self-improve-5-skill-and-daily-slot` and `self-improve-6-grades`
 * left `RUN NOW` when this landed; the rest were already closed, in flight, or blocked by something
 * already `done`. That split is stated because the honest claim is the smaller half: twelve rows lost a
 * declared dependency, two of them were being offered as runnable while genuinely blocked. It is the
 * silent-drop the duplicate-key check below exists to prevent, arriving through the other door.
 *
 * Both halves were measured by running the shipped `handover list --all` from BOTH checkouts against ONE
 * frozen copy of the board (`cp ~/.slopweaver/handovers/*.md $TMP/handovers/`, then `--home $TMP` for
 * each) and diffing the `RUN NOW` sections. Reading the live board twice instead attributed a third row to
 * this change that was simply registered between the two reads — a caveat about staleness does not rescue
 * that, because the error is attribution rather than age. Freeze the board; do not caveat it.
 *
 * So a continuation block whose every line begins `- ` is a sequence rather than a wrapped scalar, and it
 * is handed on in the FLOW spelling `[a, b]` — the one {@link asList} already reads, so the block and flow
 * spellings of the same list produce the same value. `asList` splits that on commas, so an item containing
 * one would split; that is its existing contract for `blockedBy: [a, b]` rather than a new edge, and every
 * item this key holds is a slug.
 *
 * @returns every top-level scalar by key, and one sentence per key the front matter declared twice — the keys
 *   themselves in `duplicated`, for a reader that owns a key's duplicate (`./hisWords.ts`)
 */
export function flatFields({ lines }: { lines: readonly string[] }): {
  fields: ReadonlyMap<string, string>;
  problems: readonly string[];
  duplicated: readonly string[];
} {
  const fields = new Map<string, string>();
  const duplicated: string[] = [];
  const problems: string[] = [];
  const wrapped = new Map<string, WrappedScalar>();
  let open: string | undefined;
  for (const line of lines) {
    // TOP-LEVEL keys only. A nested continuation line like `  - present: src/a.ts#x` splits on its first colon
    // into a "key" named `- present`, so a doc declaring two probes of the same kind was reported as declaring
    // that key twice — which made it MALFORMED and unrunnable. The mirror image of the bug `nestedBlock` fixes,
    // and it survived the unit suite because those fixtures used one probe of each kind. Found by dogfooding:
    // the first real doc given four probes was rejected by its own board.
    if (!isTopLevelKey({ line })) {
      continueScalar({ line, open, wrapped });
      continue;
    }
    open = undefined;
    const found = pair({ line });
    if (found === undefined) {
      continue;
    }
    if (fields.has(found[0])) {
      // Reported, never resolved. `Map.set` keeps the last value, so `blockedBy: [x]` followed by a blank
      // `blockedBy:` erased the dependency and the doc read as runnable. A repeat leaves no key open either,
      // so its own wrapped lines cannot fold into the first value and quietly resolve what was just reported.
      problems.push(duplicateKeyProblem({ key: found[0] }));
      duplicated.push(found[0]);
      continue;
    }
    fields.set(found[0], found[1]);
    open = openScalar({ key: found[0], own: found[1], wrapped });
  }
  for (const [key, scalar] of wrapped) {
    fields.set(key, foldedValue(scalar));
  }
  return { duplicated, fields, problems };
}

/** A flat key mid-read: the text on its own line, and the indented lines gathered under it so far. */
interface WrappedScalar {
  own: string;
  continuations: string[];
  /** Announced by a lone `>`/`|`, so an indented `#` line inside it is text rather than a comment. */
  block: boolean;
}

/**
 * Begin folding a newly declared flat key, answering the key now open for continuation lines.
 *
 * A nested key opens nothing: `doneWhen:`/`outputs:` are {@link nestedBlock}'s, and their indented lines
 * mean something this reader must not fold into a scalar.
 *
 * @param own the text on the key's own line, which a lone block indicator makes empty
 * @returns the key now open, or `undefined` when the key belongs to the nested reader
 */
function openScalar({
  key,
  own,
  wrapped,
}: {
  key: string;
  own: string;
  wrapped: Map<string, WrappedScalar>;
}): string | undefined {
  if (NESTED_KEYS.some((nested) => nested === key)) {
    return undefined;
  }
  // A lone `>`/`|`, with either chomping indicator, announces the scalar rather than being any of it.
  const block = announcesBlock({ own });
  wrapped.set(key, { block, continuations: [], own: block ? "" : own });
  return key;
}

/** Record an indented line against the key it continues, if this reader has one open. */
function continueScalar({
  line,
  open,
  wrapped,
}: {
  line: string;
  open: string | undefined;
  wrapped: Map<string, WrappedScalar>;
}): void {
  const scalar = open === undefined ? undefined : wrapped.get(open);
  if (scalar !== undefined && line.trim().length > 0 && !isFrontMatterComment({ block: scalar.block, line })) {
    scalar.continuations.push(line.trim());
  }
}

/**
 * Whether a front-matter line that declares no key is a YAML comment rather than text of the key above it — the one
 * definition the reader folds by and the editor (`./frontmatter.ts`) keeps lines by, so the two cannot disagree.
 *
 * At column 0 a `#` line is a comment always; indented, only outside a `>`/`|` block, where it is the block's text.
 * Folded in, `artifact: null` above one read as `null # …` and published a fake artifact.
 *
 * @param block whether the key above announced a `>`/`|` block scalar
 * @returns true when the line is a comment and no part of any value
 */
export function isFrontMatterComment({ line, block }: { line: string; block: boolean }): boolean {
  return line.startsWith("#") || (!block && line.trim().startsWith("#"));
}

/**
 * One flat key's whole value: its own text and the lines below it, as a wrapped scalar or as a flow list.
 *
 * Both spellings collapse to ONE line — see {@link flatFields}'s header for why that is the contract these
 * fields are read under rather than a shortcut. A `|` literal indicator is therefore folded exactly like a
 * `>`, which DISCARDS an author's explicit request for newlines: deliberate, not an omission, because a
 * newline reaching a board row is a layout defect, and no live doc's `|` scalar contains a blank line for
 * YAML's own fold to have preserved one from.
 */
function foldedValue({ own, continuations }: { own: string; continuations: readonly string[] }): string {
  const sequence = own.length === 0 && continuations.length > 0 && continuations.every((line) => line.startsWith("- "));
  if (sequence) {
    return `[${continuations.map((line) => line.slice(2).trim()).join(", ")}]`;
  }
  return [own, ...continuations].filter((part) => part.length > 0).join(" ");
}

/**
 * One flat field's VALUE — YAML quoting removed, and an empty one reported as absent.
 *
 * The unquoting is `./flatScalarCodec.ts`'s `decodeFlatScalar`, the inverse of the encoder `handover register`
 * writes with, so a quoted value — a summary carrying a `:`, a branch carrying a newline — reads back as written. An empty scalar answers
 * `undefined` so `summary: ""` and a missing `summary:` are one state, which is what every caller already
 * assumed.
 *
 * @param fields the flat map {@link flatFields} returned
 * @param key the front-matter key
 * @returns the value, or nothing when the key is absent or its value is empty
 */
export function flatValue({ fields, key }: { fields: ReadonlyMap<string, string>; key: string }): string | undefined {
  const raw = fields.get(key);
  if (raw === undefined) {
    return undefined;
  }
  const value = decodeFlatScalar({ value: raw });
  if (value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * The `artifact:` line's value, and whether it was the bare `artifact: null` placeholder `ensureArtifactDefault`
 * writes — read off that literal LINE, with nothing folded below it, because the folded value cannot tell the
 * placeholder from an authored `"null"` or a `>` block reading `null`.
 *
 * @param fields the flat map {@link flatFields} returned
 * @param lines the front matter's raw lines, which still carry the spelling
 * @returns the value, with `artifactIsPlaceholder` present only for the bare placeholder
 */
export function flatArtifact({ fields, lines }: { fields: ReadonlyMap<string, string>; lines: readonly string[] }): {
  readonly artifact: string | undefined;
  readonly artifactIsPlaceholder?: true;
} {
  // One line, like every field `parseHandoverDoc` reads but `summary`: the board prints it as its `why:` line.
  const decoded = flatValue({ fields, key: "artifact" });
  const artifact = decoded === undefined ? undefined : collapseWhitespace({ text: decoded });
  // Any spacing `pair()` trims is the same bare placeholder: `artifact : null` is no page named null.
  const bare = lines.some((line) => /^artifact\s*:\s*null\s*$/u.test(line)) && fields.get("artifact") === "null";
  return bare ? { artifact, artifactIsPlaceholder: true } : { artifact };
}
