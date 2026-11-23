/**
 * THE CHECKLIST — a step the owner's hands take, written as the script the owner runs through in their head, one
 * tickable line at a time, each command its own copy block and each value to fetch named by where it sits on the page.
 *
 * The shape exists because commands the owner runs belong in copy blocks (one click copies, then says "copied"),
 * secret-setting commands run one at a time so each is its own block, each field says where on the page its value is
 * retrieved from (e.g. for a client id, under "Additional information > Client ID"), and a step that needs a human
 * hand is explained simply, like a script to run through in the head with instructions to check off as they go.
 *
 * ## What the schema holds, and what it cannot
 *
 * The SHAPE is the record's (rule 7: shape by schema, never by review): one plain sentence per item, at most ONE command
 * of the owner's per item, and a `secrets set` item names where its value sits (`find`, a breadcrumb the renderer joins
 * — the parts never carry their own separator). Whether a sentence reads simply enough for a beginner is the poster's
 * judgement; a pattern cannot read it, so nothing here pretends to.
 *
 * `buildHandStep` (`./step.ts`) runs {@link checkedChecklist} on write AND on read, so its rules are the ones a row
 * can always satisfy; {@link checklistRefusal} is a POSTING rule (`./posting.ts`), for `./step.ts`'s `linkAsLiteral`
 * reason — rows already in the register predate it.
 *
 * Pure: a value in, the items or a refusal out.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { fleetWordsIn } from "../talk/glossary.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { fleetRunnableSegment, isShellCommand, literalSegmentWords, ownerHandsCommand } from "./runnableLiteral.js";
import type { HandStep } from "./step.js";
import { LITERAL_CAP } from "./stepAddress.js";

/** One line of the script: what the owner does, and — when the line has one — the command, where its value sits, the page. */
export interface HandChecklistItem {
  /** One plain sentence: the one thing the owner does on this line. */
  readonly action: string;
  /** Exactly one command of the owner's, drawn as its own copy block. */
  readonly command?: string | undefined;
  /** Where on the page the value this line needs sits, outermost first: `["Additional information", "Client ID"]`. */
  readonly find?: readonly string[] | undefined;
  /** The page this line happens on, when it is not the step's own. */
  readonly url?: string | undefined;
}

/** The most lines a checklist may carry — the same bound a note's details have, a script and never a manual. */
export const CHECKLIST_MAX = 12;

/** The longest one line's sentence may be: one instruction read at a glance. */
export const CHECKLIST_ACTION_CAP = 160;

/** How deep a breadcrumb may go — a section, a panel, a field. */
export const FIND_PARTS_MAX = 4;

/** The longest one breadcrumb part may be: a label as the provider prints it. */
export const FIND_PART_CAP = 60;

/** The keys an item may carry; any other is a typo the card would silently drop. */
const ITEM_KEYS: ReadonlySet<string> = new Set(["action", "command", "find", "url"]);

/** A sentence terminator with more text after it — two instructions on one line. */
const SECOND_SENTENCE = /[.?!]\s+\S/;

/** A separator a breadcrumb part may not carry, because the renderer draws its own. */
const CRUMB_SEPARATOR = /[›>»\n]/;

/** One address a line may open: absolute http(s) or an absolute local file, as `./stepAddress.ts` reads `url`. */
const LINK = /^(?:https?:\/\/|file:\/\/\/)\S+$/i;

/**
 * The refusal naming one checklist line.
 *
 * @param index the line's position, from zero
 * @param why what is wrong with it
 * @returns the typed refusal
 */
function lineRefusal({ index, why }: { index: number; why: string }): HandStepError {
  return HandStepErrors.invalidField({ field: "checklist", why: `line ${String(index + 1)} ${why}` });
}

/**
 * One line's sentence, checked.
 *
 * @param value whatever the line carried as `action`
 * @param index the line's position
 * @returns the trimmed sentence, or the refusal
 */
function checkedAction({ value, index }: { value: unknown; index: number }): Result<string, HandStepError> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(lineRefusal({ index, why: "has no `action` — the one sentence saying what the owner does on it" }));
  }
  const action = value.trim();
  if (action.includes("\n") || SECOND_SENTENCE.test(action)) {
    return err(
      lineRefusal({ index, why: "is more than one sentence — one instruction per line, so the owner ticks one thing" }),
    );
  }
  if (action.length > CHECKLIST_ACTION_CAP) {
    return err(
      lineRefusal({
        index,
        why: `is ${String(action.length)} characters and the cap is ${String(CHECKLIST_ACTION_CAP)} — split it into two lines`,
      }),
    );
  }
  return ok(action);
}

/**
 * One line's command, checked as one line the owner copies — or honestly absent.
 *
 * @param value whatever the line carried as `command`
 * @param index the line's position
 * @returns the trimmed command, `undefined` when absent, or the refusal
 */
function checkedCommand({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): Result<string | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(lineRefusal({ index, why: "carries a `command` that is not one" }));
  }
  const command = value.trim();
  if (command.includes("\n")) {
    return err(lineRefusal({ index, why: "carries a command over more than one line — give each its own line" }));
  }
  if (command.length > LITERAL_CAP) {
    return err(lineRefusal({ index, why: `carries a command past the ${String(LITERAL_CAP)}-character cap` }));
  }
  return ok(command);
}

/**
 * One line's breadcrumb, checked — or honestly absent.
 *
 * @param value whatever the line carried as `find`
 * @param index the line's position
 * @returns the trimmed parts, `undefined` when absent, or the refusal
 */
function checkedFind({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): Result<readonly string[] | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value) || value.some((part) => typeof part !== "string")) {
    return err(lineRefusal({ index, why: "carries a `find` that is not a list of labels" }));
  }
  const parts = (value as readonly string[]).map((part) => part.trim());
  if (parts.length === 0 || parts.length > FIND_PARTS_MAX) {
    return err(
      lineRefusal({
        index,
        why: `carries a \`find\` of ${String(parts.length)} labels — 1 to ${String(FIND_PARTS_MAX)}`,
      }),
    );
  }
  const bad = parts.find((part) => part.length === 0 || part.length > FIND_PART_CAP || CRUMB_SEPARATOR.test(part));
  if (bad !== undefined) {
    return err(
      lineRefusal({
        index,
        why: `carries a \`find\` label "${bad.slice(0, 40)}" that is empty, past ${String(FIND_PART_CAP)} characters, or carries its own separator — give each label as the page prints it, one per entry`,
      }),
    );
  }
  return ok(parts);
}

/**
 * One line's page, checked — or honestly absent.
 *
 * @param value whatever the line carried as `url`
 * @param index the line's position
 * @returns the trimmed address, `undefined` when absent, or the refusal
 */
function checkedLineUrl({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): Result<string | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || !LINK.test(value.trim())) {
    return err(lineRefusal({ index, why: "carries a `url` that is not one absolute http(s) or file:/// address" }));
  }
  return ok(value.trim());
}

/**
 * One checklist line, checked whole.
 *
 * @param value whatever the register line or the caller carried
 * @param index the line's position
 * @returns the item, or the refusal
 */
function checkedItem({ value, index }: { value: unknown; index: number }): Result<HandChecklistItem, HandStepError> {
  if (!isRecord(value)) {
    return err(lineRefusal({ index, why: "is not an object with an `action`" }));
  }
  const record = value;
  const stray = Object.keys(record).find((key) => !ITEM_KEYS.has(key));
  if (stray !== undefined) {
    return err(lineRefusal({ index, why: `carries \`${stray}\`, which no line has — action, command, find, url` }));
  }
  const action = checkedAction({ index, value: record["action"] });
  if (action.isErr()) {
    return err(action.error);
  }
  const command = checkedCommand({ index, value: record["command"] });
  if (command.isErr()) {
    return err(command.error);
  }
  const find = checkedFind({ index, value: record["find"] });
  if (find.isErr()) {
    return err(find.error);
  }
  const url = checkedLineUrl({ index, value: record["url"] });
  if (url.isErr()) {
    return err(url.error);
  }
  return ok({
    action: action.value,
    ...(command.value === undefined ? {} : { command: command.value }),
    ...(find.value === undefined ? {} : { find: find.value }),
    ...(url.value === undefined ? {} : { url: url.value }),
  });
}

/**
 * A step's checklist, checked — or honestly absent.
 *
 * An absent or empty list is dropped rather than written, so a row with none reads back byte for byte as one written
 * before the field existed. A bad line is refused, never cut: a script missing a line reads whole and is not.
 *
 * @param value whatever the caller or the register line carried
 * @returns the items, `undefined` when there are none, or the refusal naming the line
 */
export function checkedChecklist({
  value,
}: {
  value: unknown;
}): Result<readonly HandChecklistItem[] | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return err(
      HandStepErrors.invalidField({
        field: "checklist",
        why: 'is a JSON list of lines, each {"action": …, "command"?: …, "find"?: […], "url"?: …}',
      }),
    );
  }
  if (value.length === 0) {
    return ok(undefined);
  }
  if (value.length > CHECKLIST_MAX) {
    return err(
      HandStepErrors.invalidField({
        field: "checklist",
        why: `carries ${String(value.length)} lines and the cap is ${String(CHECKLIST_MAX)} — a script the owner runs in their head, never a manual`,
      }),
    );
  }
  const items: HandChecklistItem[] = [];
  for (const [index, entry] of (value as readonly unknown[]).entries()) {
    const item = checkedItem({ index, value: entry });
    if (item.isErr()) {
      return err(item.error);
    }
    items.push(item.value);
  }
  return ok(items);
}

/**
 * `hand post --checklist` read as JSON — or the raw text when it is not JSON, which {@link checkedChecklist} then
 * refuses by name, so a malformed flag is reported as the field it is rather than as a parser error with no field.
 *
 * @param raw the flag's text
 * @returns the parsed value, or the text itself
 */
export function checklistFlagValue({ raw }: { raw: string }): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Every command a step's checklist carries, in order.
 *
 * @param checklist the step's checklist, when it has one
 * @returns each line's command
 */
export function checklistCommands({
  checklist,
}: {
  checklist: readonly HandChecklistItem[] | undefined;
}): readonly string[] {
  if (checklist === undefined) {
    return [];
  }
  return checklist.flatMap((item) => (item.command === undefined ? [] : [item.command]));
}

/**
 * How many of the owner's commands one paste runs — `mkdir -p … && CODEX_HOME=… codex login` is one, two `secrets set` lines
 * are two.
 *
 * @param command the paste
 * @returns the count of segments a `OWNER_HANDS_COMMANDS` row matches
 */
export function ownerCommandCount({ command }: { command: string }): number {
  return literalSegmentWords({ literal: command }).filter((words) => ownerHandsCommand({ words }) !== undefined).length;
}

/**
 * Whether a paste stores a secret with `slopweaver secrets set`.
 *
 * @param command the paste
 * @returns true when one of its segments does
 */
function storesASecret({ command }: { command: string }): boolean {
  return literalSegmentWords({ literal: command }).some((words) => ownerHandsCommand({ words })?.id === "secrets-set");
}

/**
 * Whether every command a paste runs is `slopweaver secrets set <name>` — the literal the queue card replaces with one
 * secure paste field per name, so it is never a copy block at all (`site/lib/handCardTexts.ts`'s
 * `pasteFieldsCoverLiteral`).
 *
 * Exactly `<binary> secrets set <name>` and nothing after it, as the card requires: a flag the field cannot pass on
 * would leave the card a copy block of several commands.
 *
 * @param literal the step's paste
 * @returns true when it runs at least one command and each is a bare `secrets set <name>`
 */
function onlyStoresSecrets({ literal }: { literal: string }): boolean {
  const segments = literalSegmentWords({ literal });
  return (
    segments.length > 0 &&
    segments.every((words) => words.length === 4 && ownerHandsCommand({ words })?.id === "secrets-set")
  );
}

/** The fix every one-command refusal names. */
const ONE_PER_LINE =
  "post a --checklist instead, one command per line, so each is its own copy block the owner runs one at a time";

/**
 * The refusal for a literal carrying more than one command — two lines, or two of the owner's commands joined on one. A literal
 * of only `secrets set` lines passes however many it holds: the card draws a paste field per name in its place.
 *
 * @param literal the step's paste
 * @param where where the step says it goes
 * @returns the refusal, or `undefined` when it is one command, no command at all, or only secrets to paste
 */
function literalRefusal({ literal, where }: { literal: string; where: string | undefined }): HandStepError | undefined {
  if (onlyStoresSecrets({ literal })) {
    return undefined;
  }
  const lines = literal.split("\n").filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));
  if (lines.length > 1 && isShellCommand({ literal, where })) {
    return HandStepErrors.invalidField({
      field: "literal",
      why: `holds ${String(lines.length)} command lines — ${ONE_PER_LINE}`,
    });
  }
  if (ownerCommandCount({ command: literal }) > 1) {
    return HandStepErrors.invalidField({
      field: "literal",
      why: `holds more than one of the owner's commands — ${ONE_PER_LINE}`,
    });
  }
  return undefined;
}

/**
 * The refusal for one checklist line's command: more than one of the owner's, a secret stored with no breadcrumb, or a
 * command the fleet could run itself.
 *
 * @param item the line
 * @param index its position
 * @returns the refusal, or `undefined` when the line passes
 */
function itemRefusal({ item, index }: { item: HandChecklistItem; index: number }): HandStepError | undefined {
  const [fleetWord] = fleetWordsIn({ text: item.action });
  if (fleetWord !== undefined) {
    return lineRefusal({
      index,
      why: `says "${fleetWord.word}", a word that is the fleet's and not the owner's (it means ${fleetWord.entry.means}) — say what the owner sees on the page instead`,
    });
  }
  if (item.command === undefined) {
    return undefined;
  }
  if (ownerCommandCount({ command: item.command }) > 1) {
    return lineRefusal({ index, why: "carries more than one of the owner's commands — give each its own line" });
  }
  if (storesASecret({ command: item.command }) && item.find === undefined) {
    return lineRefusal({
      index,
      why:
        'stores a secret and does not say where its value sits — add "find": the labels on the provider page, ' +
        'outermost first, e.g. ["Additional information", "Client ID"]',
    });
  }
  const runnable = fleetRunnableSegment({ literal: item.command });
  if (runnable !== undefined) {
    return lineRefusal({
      index,
      why: `carries a command the fleet can run itself (\`${runnable.slice(0, 100)}\`) — run it from the session and keep only what is the owner's (OWNER_HANDS_COMMANDS, src/hand/runnableLiteral.ts)`,
    });
  }
  return undefined;
}

/**
 * The checklist's POSTING rule: no literal beside a checklist, one command per literal, and every line's command
 * one of the owner's, alone, with a breadcrumb when it stores a secret.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step passes
 */
export function checklistRefusal({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.literal !== undefined && step.checklist !== undefined) {
    return HandStepErrors.invalidField({
      field: "literal",
      why: "is beside a --checklist — every command lives on its own checklist line, so drop the --literal",
    });
  }
  if (step.literal !== undefined) {
    return literalRefusal({ literal: step.literal, where: step.where });
  }
  if (step.checklist === undefined) {
    return undefined;
  }
  for (const [index, item] of step.checklist.entries()) {
    const refused = itemRefusal({ index, item });
    if (refused !== undefined) {
      return refused;
    }
  }
  return undefined;
}
