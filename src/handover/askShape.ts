/**
 * The SHAPE every recorded ask carries — a problem, two to four options each with its trade-off, a lean,
 * and the STAKES (risk, blast radius, and the check that it is still real) — and the schema that refuses one
 * that does not.
 *
 * ## Why this exists
 *
 * **A recorded ask the owner has to parse is a defect.** An ask that waits on the owner's word is not a
 * paragraph to read, it is a decision to take, and a decision the owner can take in one breath needs the
 * problem, what the choices actually are, what each costs, and where the session already leans. MEASURED
 * over `slopweaver handover list --json`: of 2,700 board rows, 43 carried an open recorded question and 21 of
 * those were genuinely the owner's — and every one of the 43 was free text.
 *
 * ## The stakes — what the owner wants to know at a glance when reacting
 *
 * Risk, blast radius and trade-off are the things the owner wants at a glance when reacting to a card,
 * without reading its artifact. The trade-off already sits on every option and the lean beside them;
 * {@link AskStakes} is the rest, and a card dated seven days back is the reason for its third field — a card that
 * cannot say whether its problem still stands asks the owner to decide something that may have fixed itself.
 * The instant it was last CONFIRMED is never typed: it is the instant the shape was
 * recorded, which the journal or the register's own clock already carries.
 *
 * Stakes are required at every VERB and optional on the READ: {@link AskShape.stakes} is `undefined` on a row
 * shaped before they existed, and a card says so out loud rather than leaving a gap.
 *
 * ## Enforced by the SCHEMA, never by review (`AGENTS.md` rule 7)
 *
 * {@link askShapeProblems} is what `handover ask` and `handover register` call, and a violation is REFUSED
 * rather than truncated. The caps are `../briefing/caps.ts`'s own — imported, not restated, because they
 * are the same fields on the same card and that file carries the measurement behind each
 * number. The one number added here is {@link MIN_OPTIONS}, which comes from the ruling rather than from a
 * measurement.
 *
 * ## A lean is the SESSION's recommendation, and the card must say so
 *
 * This is the trap worth stating at the top of the file rather than discovering. The field answers "what
 * would the owner most likely pick with infinite time and attention", so it is written in the owner's voice —
 * and a voice is a register, never a claim about who spoke. Nothing here, and nothing rendering it, may
 * present a lean as the owner's word: `.claude/rules/cross-session-messages.md` § "Anchoring an authority" is
 * why, and a `ruling:` with its anchor is the field that carries what the owner actually said.
 *
 * Pure: no filesystem, no clock. The caller supplies the text.
 */

import { MAX_OPTIONS, OPTION_MAX_WORDS, SHORT_FIELD_MAX_SENTENCES, SHORT_FIELD_MAX_WORDS } from "../briefing/caps.js";
import { splitSentences, wordCount } from "../briefing/text.js";
import { authoredOptionLetter } from "./askOptionLabel.js";

/**
 * The fewest options an ask may offer.
 *
 * Two, from the ruling's own words — "options (two to four, each with its trade-off in one line)". One
 * option is not a decision, it is a notification, and a register that accepts it re-creates the free-text
 * ask under a field name. `../outbound/slack/pollForm.ts`'s `POLL_MIN_OPTIONS` is the same number reached
 * the same way, for the same reason.
 */
export const MIN_OPTIONS = 2;

/**
 * The letters options are labelled with, in order — derived by position, never authored.
 *
 * Module-private: a letter is assigned here and read off {@link AskOption.letter} everywhere else, so
 * nothing outside this file ever needs the alphabet itself. `../outbound/briefing/schema.ts` reaches the
 * same six letters the same way for the briefing card, and the two are deliberately not shared — that one
 * is sliced to the briefing's own `MAX_OPTIONS` and validated by Zod, this one is the ask's four.
 */
const OPTION_LETTERS: readonly string[] = ["A", "B", "C", "D"];

/**
 * The label for the option at one position — a letter, or its 1-based number once past the cap.
 *
 * Written as an `if` that RETURNS rather than as `OPTION_LETTERS[index] ?? String(index + 1)`, because
 * `no-silent-fallback` refuses the `??`, and as a function rather than inline because oxlint's
 * `prefer-nullish-coalescing` refuses the ternary that spells the same thing. Neither reader fires on this.
 *
 * A fifth option is over {@link MAX_OPTIONS} and will be refused — but it is refused BY A SENTENCE NAMING
 * IT, so it still needs a label a reader can match to a line.
 */
function letterAt({ index }: { index: number }): string {
  const letter = OPTION_LETTERS[index];
  if (letter === undefined) {
    return String(index + 1);
  }
  return letter;
}

/** What separates an option's sentence from its trade-off on one `--options` line. */
export const TRADEOFF_SEPARATOR = "::";

/** One option the owner could take, and what taking it costs. */
export interface AskOption {
  /** `A`, `B`, `C` or `D`, assigned by position so two options can never claim the same letter. */
  readonly letter: string;
  /** One line naming the decision. */
  readonly option: string;
  /** One line naming what that decision costs — never "none", which is the absence of a trade-off stated as one. */
  readonly tradeoff: string;
  /**
   * The exact line the owner pastes into a terminal to take this option, when it is a step only their hands take —
   * absent on every other option. `./askOptionCommand.ts` refuses an owner step without one.
   */
  readonly command?: string;
}

/** What deciding the ask puts at stake, and the check that it is still worth deciding — each one line. */
export interface AskStakes {
  /** What goes wrong if the owner picks badly, or says nothing. */
  readonly risk: string;
  /** Who and what the decision reaches — the repositories, people, channels or users it touches. */
  readonly blastRadius: string;
  /** How the problem was confirmed to still stand — the command or observation that re-checks it. */
  readonly stillReal: string;
}

/** The shape a recorded ask carries, in the owner's voice and concise. */
export interface AskShape {
  /** One line: what is actually wrong or undecided. */
  readonly problem: string;
  readonly options: readonly AskOption[];
  /**
   * The risk, blast radius and still-real check — required at every verb, `undefined` only on a row shaped
   * before they were, which a card renders as a stated absence.
   */
  readonly stakes: AskStakes | undefined;
  /**
   * What the SESSION recommends the owner would most likely pick with infinite time and attention.
   *
   * Never presented as the owner's word — see this file's header. A surface rendering it attributes it.
   */
  readonly lean: string;
}

/**
 * Every way a `bearsOn` line breaks its cap — one line saying how the owner's quoted words bear on the question,
 * drawn after every quote of theirs on the Queue card as why it is in front of them. Held to the `problem` field's
 * one-sentence cap because it is read whole, never folded.
 *
 * @param text the line as typed
 * @returns one sentence per problem, empty when it is well-formed
 */
export function bearsOnProblems({ text }: { text: string }): readonly string[] {
  return shortFieldProblems({ label: "--bears-on", maxSentences: 1, text });
}

/**
 * Every way one short field breaks its cap, empty when it is well-formed.
 *
 * @param label the field's name as a refusal prints it
 * @param maxSentences how many sentences it may carry; one for a field the ruling calls "one line"
 */
function shortFieldProblems({
  label,
  text,
  maxSentences,
}: {
  label: string;
  text: string;
  maxSentences: number;
}): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [`${label} is empty`];
  }
  const problems: string[] = [];
  const words = wordCount({ text: trimmed });
  if (words > SHORT_FIELD_MAX_WORDS) {
    problems.push(
      `${label} runs ${String(words)} words against a cap of ${String(SHORT_FIELD_MAX_WORDS)} — say it shorter, ` +
        "the fold is for the detail",
    );
  }
  const sentences = splitSentences({ text: trimmed }).length;
  if (sentences > maxSentences) {
    problems.push(
      `${label} runs ${String(sentences)} sentences against a cap of ${String(maxSentences)} — ` +
        "it is one line, not a paragraph",
    );
  }
  return problems;
}

/** Every way one option breaks its cap, empty when it is well-formed. */
function optionProblems({ option }: { option: AskOption }): readonly string[] {
  const problems: string[] = [];
  for (const half of [
    { label: `option ${option.letter}`, text: option.option },
    { label: `option ${option.letter}'s trade-off`, text: option.tradeoff },
  ]) {
    const trimmed = half.text.trim();
    if (trimmed.length === 0) {
      problems.push(`${half.label} is empty`);
      continue;
    }
    const words = wordCount({ text: trimmed });
    if (words > OPTION_MAX_WORDS) {
      problems.push(
        `${half.label} runs ${String(words)} words against a cap of ${String(OPTION_MAX_WORDS)} — ` +
          "one line each, so the owner can hold all of them at once",
      );
    }
  }
  return problems;
}

/**
 * Every way a shape violates the ruling, in the order a refusal should print them.
 *
 * Returns a plain list rather than a typed union on purpose: this is a validation pass whose whole
 * behaviour is the MULTIPLICITY of what is wrong, which one discriminated error would lose
 * (`.claude/rules/error-handling.md` § "When NOT to introduce a union").
 *
 * @param shape the shape a verb is about to record
 * @returns one sentence per rule it broke, empty when it is well-formed
 */
export function askShapeProblems({ shape }: { shape: AskShape }): readonly string[] {
  const problems: string[] = [
    ...shortFieldProblems({ label: "problem", maxSentences: 1, text: shape.problem }),
    ...shortFieldProblems({ label: "lean", maxSentences: SHORT_FIELD_MAX_SENTENCES, text: shape.lean }),
    ...(shape.stakes === undefined ? [] : askStakesProblems({ stakes: shape.stakes })),
  ];
  if (shape.options.length < MIN_OPTIONS) {
    problems.push(
      `${String(shape.options.length)} option(s) — an ask carries ${String(MIN_OPTIONS)} to ` +
        `${String(MAX_OPTIONS)}, because one option is a notification rather than a decision`,
    );
  }
  if (shape.options.length > MAX_OPTIONS) {
    problems.push(
      `${String(shape.options.length)} option(s) — an ask carries at most ${String(MAX_OPTIONS)}, which is ` +
        "what the owner can hold above the fold at once",
    );
  }
  for (const option of shape.options) {
    problems.push(...optionProblems({ option }));
  }
  return problems;
}

/** The three stakes, each with the name a refusal prints and the flag that sets it. */
const STAKES_FIELDS: readonly { readonly key: keyof AskStakes; readonly label: string; readonly flag: string }[] = [
  { flag: "--risk", key: "risk", label: "risk" },
  { flag: "--blast-radius", key: "blastRadius", label: "blast radius" },
  { flag: "--still-real", key: "stillReal", label: "still-real check" },
];

/**
 * Every way the stakes break their caps — one line each, because each is read at a glance.
 *
 * @param stakes the stakes a verb is about to record
 * @returns one sentence per rule broken, empty when all three read
 */
function askStakesProblems({ stakes }: { stakes: AskStakes }): readonly string[] {
  return STAKES_FIELDS.flatMap((field) =>
    field.key === "stillReal"
      ? stillRealProblems({ stillReal: stakes.stillReal })
      : shortFieldProblems({ label: field.label, maxSentences: 1, text: stakes[field.key] }),
  );
}

/**
 * Every way a still-real check breaks its cap — the exact lines a row carrying it reports, because
 * `askStakesProblems` builds them here too. A verb that replaces the line (`handover reconfirm`, `handover correct`)
 * excuses exactly these on the row it is repairing, and nothing else.
 *
 * @param stillReal the one-line check, as the row or the verb carries it
 * @returns one sentence per cap broken, empty when it reads
 */
export function stillRealProblems({ stillReal }: { stillReal: string }): readonly string[] {
  return shortFieldProblems({ label: "still-real check", maxSentences: 1, text: stillReal });
}

/**
 * The stakes off three optional fields — whole, or `undefined` with the flags that are missing.
 *
 * @param risk the `risk` field, absent when none was recorded
 * @param blastRadius the `blastRadius` field, absent when none was recorded
 * @param stillReal the `stillReal` field, absent when none was recorded
 * @returns the whole stakes when all three are present, and which flags are missing otherwise
 */
export function stakesFrom({
  risk,
  blastRadius,
  stillReal,
}: {
  risk: string | undefined;
  blastRadius: string | undefined;
  stillReal: string | undefined;
}): { readonly stakes: AskStakes | undefined; readonly missing: readonly string[] } {
  if (risk !== undefined && blastRadius !== undefined && stillReal !== undefined) {
    return { missing: [], stakes: { blastRadius, risk, stillReal } };
  }
  const present: Readonly<Record<keyof AskStakes, string | undefined>> = { blastRadius, risk, stillReal };
  const missing = STAKES_FIELDS.filter((field) => present[field.key] === undefined).map((field) => field.flag);
  return { missing, stakes: undefined };
}

/**
 * Whether a doc or event carries the whole shape, some of it, or none.
 *
 * Three states rather than a boolean, because they route differently: `none` is every ask recorded before
 * the shape existed and renders with a visible mark, `partial` is a verb being used wrongly right now and
 * is REFUSED, and only `whole` renders as a card.
 *
 * @param problem the `problem` field, absent when none was recorded
 * @param options the options, empty when none were
 * @param lean the `lean` field, absent when none was recorded
 * @returns which of the three it is
 */
export function shapeCompleteness({
  problem,
  options,
  lean,
}: {
  problem: string | undefined;
  options: readonly AskOption[];
  lean: string | undefined;
}): "none" | "partial" | "whole" {
  const present = [problem !== undefined, options.length > 0, lean !== undefined];
  if (present.every((one) => one)) {
    return "whole";
  }
  if (present.some((one) => one)) {
    return "partial";
  }
  return "none";
}

/**
 * Which halves of the shape a partially-shaped ask is missing, as a refusal names them.
 *
 * @param problem the `problem` field, absent when none was recorded
 * @param options the options, empty when none were
 * @param lean the `lean` field, absent when none was recorded
 * @returns the missing field names, in the order they are written
 */
export function missingShapeFields({
  problem,
  options,
  lean,
}: {
  problem: string | undefined;
  options: readonly AskOption[];
  lean: string | undefined;
}): readonly string[] {
  const missing: string[] = [];
  if (problem === undefined) {
    missing.push("--problem");
  }
  if (options.length === 0) {
    missing.push("--options");
  }
  if (lean === undefined) {
    missing.push("--lean");
  }
  return missing;
}

/**
 * Parse the `--options` flag: one option per line, `<sentence> :: <trade-off> [:: <command>]` — the third part the
 * command the owner pastes into a terminal, when the option is a step only their hands take (`./askOptionCommand.ts`).
 *
 * ## Why one flag holding lines, rather than a repeated flag or a comma list
 *
 * `../cli/parseFlags.ts` keeps flag values in a `Record<string, string | boolean>`, so a flag is not
 * repeatable, and widening that record for one verb's one field would change how every verb in the tree
 * parses its argv. A comma-separated list — the `--evidence` idiom — cannot carry these at all: an option
 * sentence and its trade-off both contain commas by construction, so the list would silently lose half of
 * what was typed, which is the failure class this whole register exists to end.
 *
 * `::` rather than an em dash because an em dash is ordinary INSIDE the owner's prose, and a separator that also
 * appears in the payload is not a separator.
 *
 * Letters are assigned by POSITION. A caller who types them can type them twice or out of order, and
 * neither is checkable prose — so a line opening with its own label is refused (`./askOptionLabel.ts`).
 *
 * @param text the raw `--options` value
 * @returns the options, and one sentence per malformed line
 */
export function parseAskOptions({ text }: { text: string }): {
  readonly options: readonly AskOption[];
  readonly problems: readonly string[];
} {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const options: AskOption[] = [];
  const problems: string[] = [];
  for (const line of lines) {
    const at = line.indexOf(TRADEOFF_SEPARATOR);
    if (at < 0) {
      problems.push(
        `this option line carries no \`${TRADEOFF_SEPARATOR}\`, so it states no trade-off: "${line}" — ` +
          `write it as \`<what the owner could do> ${TRADEOFF_SEPARATOR} <what that costs>\``,
      );
      continue;
    }
    const option = line.slice(0, at).trim();
    const typed = authoredOptionLetter({ text: option });
    if (typed !== undefined) {
      problems.push(
        `this option line opens with its own letter "${typed}", but options are lettered by position, ` +
          `so the card would draw two: "${line}" — drop the letter, and name an option in \`--lean\` by the letter ` +
          `its position gives it`,
      );
      continue;
    }
    const rest = line.slice(at + TRADEOFF_SEPARATOR.length);
    const commandAt = rest.indexOf(TRADEOFF_SEPARATOR);
    const letter = letterAt({ index: options.length });
    if (commandAt < 0) {
      options.push({ letter, option, tradeoff: rest.trim() });
      continue;
    }
    // Everything after the second separator is the command, so a shell line carrying `::` keeps it.
    options.push({
      command: rest.slice(commandAt + TRADEOFF_SEPARATOR.length).trim(),
      letter,
      option,
      tradeoff: rest.slice(0, commandAt).trim(),
    });
  }
  return { options, problems };
}

/**
 * The options carried by an already-decoded value — a journal payload's field, or a front-matter node.
 *
 * Forgiving in exactly the direction `../handover/ledger.ts`'s decoders are: a member missing either half
 * is DROPPED rather than losing the whole list, because a card showing two of three options is recoverable
 * and a row that vanished off the board is not. Letters are re-derived by position, so a hand-edited file
 * that lettered them wrongly still renders A, B, C.
 *
 * Lives here rather than in `./ledgerFields.ts` because that file's stated property is that none of its
 * accessors mentions a handover type, and this one returns {@link AskOption}.
 *
 * @param value the raw field, of any shape
 * @returns the options, empty when the field is absent or carries none that read
 */
export function askOptionsFrom({ value }: { value: unknown }): readonly AskOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AskOption[] = [];
  for (const member of value) {
    if (typeof member !== "object" || member === null) {
      continue;
    }
    const bag: Readonly<Record<string, unknown>> = { ...member };
    const option = bag["option"];
    const tradeoff = bag["tradeoff"];
    if (typeof option !== "string" || typeof tradeoff !== "string") {
      continue;
    }
    // A command that is not a string is dropped and the option kept: the forgiving direction this decoder reads in.
    const command = bag["command"];
    out.push({
      ...(typeof command === "string" ? { command } : {}),
      letter: letterAt({ index: out.length }),
      option,
      tradeoff,
    });
  }
  return out;
}

/**
 * The stakes carried by an already-decoded value — a journal payload's `stakes` field.
 *
 * Whole or nothing, exactly as {@link AskShape.stakes} is read everywhere: a member missing one of the three
 * is a hand edit, and a card drawing the risk without the blast radius would read as a stated shape that is
 * merely short. The write schema refuses a partial one, so this only ever meets one on disk.
 *
 * @param value the raw field, of any shape
 * @returns the stakes, or `undefined` when the field is absent or not whole
 */
export function askStakesFrom({ value }: { value: unknown }): AskStakes | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const bag: Readonly<Record<string, unknown>> = { ...value };
  const { risk, blastRadius, stillReal } = bag;
  if (typeof risk !== "string" || typeof blastRadius !== "string" || typeof stillReal !== "string") {
    return undefined;
  }
  return { blastRadius, risk, stillReal };
}

/**
 * The options as front-matter lines, under an `options:` key the nested YAML reader parses.
 *
 * @param options the options to write
 * @returns the block, `options:` header included, with no trailing newline
 */
export function askOptionsBlock({ options }: { options: readonly AskOption[] }): string {
  const rows = options.map(
    (option) =>
      `  - option: ${quoted({ text: option.option })}\n    tradeoff: ${quoted({ text: option.tradeoff })}` +
      (option.command === undefined ? "" : `\n    command: ${quoted({ text: option.command })}`),
  );
  return `options:\n${rows.join("\n")}`;
}

/** A YAML double-quoted scalar, so a colon or a `#` in the owner's prose cannot break the block. */
function quoted({ text }: { text: string }): string {
  return `"${text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}
