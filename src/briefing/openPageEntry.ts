/**
 * One `--open-artifacts` entry, decoded into the fields a projected react-now card is built from.
 *
 * Split from `./openPageCards.ts`, which pairs entries to the ranked index and decides where a card's question and
 * lean come from; this module only reads what a composer wrote, and refuses what is missing or malformed. The
 * question and the lean arrive already resolved ({@link QuestionAndLean}): a page that marks its own makes a typed
 * copy on the entry a refusal, since a second copy is the thing that drifts.
 *
 * Pure: an entry and its page's pair in, the fields or a refusal out.
 */

import { absentAs } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { BriefingFold, BriefingOption } from "../outbound/briefing/types.js";
import { foldSchema } from "../outbound/briefing/vocabulary.js";
import { MAX_OPTIONS } from "./caps.js";
import { type BriefingError, BriefingErrors } from "./errors.js";

/** Where one card's question and lean come from: the entry's typed pair, or the page's own marks. */
export type QuestionAndLean =
  { readonly kind: "typed" } | { readonly kind: "marked"; readonly question: string; readonly lean: string };

/** The card half of one `--open-artifacts` entry: the prose only a composer can write. */
export interface OpenPageCardFields {
  readonly question: string;
  readonly what: string;
  readonly whyYou: string;
  readonly options: readonly BriefingOption[];
  readonly lean: string;
  readonly ifSilent: string;
  /** The page's own depth, absent when the entry wrote none. See {@link decodeDetail}. */
  readonly detail?: BriefingFold | undefined;
}

/**
 * One string field of a record, or undefined when it is absent or not a string.
 *
 * @returns the non-empty string, or `undefined`
 */
export function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One entry's `options`, read as the lettered list a card renders.
 *
 * The LETTER is the composer's, not this module's, for the same reason a card's number is the renderer's: a
 * letter a projection assigned would renumber under the owner whenever the rank moved, and an option they are being
 * asked to answer by typing one word has to keep the letter they read last sweep.
 */
function decodeOptions({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): Result<readonly BriefingOption[], BriefingError> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(BriefingErrors.openPageOptionsMissing({ label }));
  }
  if (value.length > MAX_OPTIONS) {
    return err(BriefingErrors.openPageOptionsOverCap({ cap: MAX_OPTIONS, count: value.length, label }));
  }
  const options: BriefingOption[] = [];
  for (const entry of value) {
    // ONE refusal for both ways an option can be wrong — not an object at all, or an object short a key.
    // The fix a composer makes is identical for either, since a reader of their own JSON can see which of the
    // two they wrote; naming the required shape is the part that matters.
    const letter = isRecord(entry) ? stringField({ key: "letter", record: entry }) : undefined;
    const text = isRecord(entry) ? stringField({ key: "text", record: entry }) : undefined;
    if (letter === undefined || text === undefined) {
      return err(BriefingErrors.openPageOptionInvalid({ label }));
    }
    options.push({ letter, text });
  }
  return ok(options);
}

/**
 * One entry's `detail`, read as the collapsed fold the card renders it as.
 *
 * A projection that reads six fields and silently discards a seventh lets an entry carry a `detail`, pass
 * `briefing check`, and render a card with no fold at all. MEASURED on one supervisor scratch: four of the
 * sweep's entries carried a well-formed fold and the page rendered from them contained none of their text,
 * while carrying 66 `<details>` from other surfaces. The card's `what` points at commands in a fold
 * that does not exist, and the owner reads a card citing nothing.
 *
 * A PRESENT detail that is not a fold REFUSES rather than being coerced. A numbered list flattened into a
 * single string with runs of spaces for layout, coerced into a one-block paragraph, would render an unbroken
 * wall and call the defect fixed, and silent acceptance is how a field comes to be droppable. `../outbound/briefing/vocabulary.ts`'s `foldSchema` is the same
 * schema an authored card's `detail` is held to, so a projected fold and a composed one cannot diverge.
 *
 * **One thing an authored fold can do and a projected one cannot: an image by `path`.** The image resolver
 * (`../cli/commands/briefing/renderCore.ts`'s `resolveFormImages`) turns a `path` into a `data:` URI, and
 * it runs AFTER this projection — so a `{ "kind": "image", "path": … }` block is judged here by a schema
 * that only knows the resolved shape and is refused. Write the `data:` URI directly, or put the screenshot
 * on the page the entry already links. Moving this validation past the resolver would fix it and is not
 * worth the plumbing until something needs it; the refusal below names the restriction so nobody has to
 * discover it.
 *
 * @param value the entry's raw `detail`, absent when it wrote none
 * @param label the page as a refusal should name it
 * @returns the fold, `undefined` when the entry carried no detail, or the refusal
 */
function decodeDetail({
  value,
  label,
}: {
  value: unknown;
  label: string;
}): Result<BriefingFold | undefined, BriefingError> {
  if (value === undefined || value === null) {
    return ok(undefined);
  }
  const parsed = foldSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    BriefingErrors.openPageDetailInvalid({
      issues: parsed.error.issues.map((issue) => `${foldIssuePath({ path: issue.path })}: ${issue.message}`),
      label,
    }),
  );
}

/**
 * One Zod issue's path as a composer reads it, relative to the entry's own `detail` key.
 *
 * An EMPTY path means the issue is about the whole value rather than a field inside it — which is the
 * commonest case here, since a `detail` written as a string fails at the root — so it is named rather than
 * left blank.
 *
 * @param path the issue's path into the parsed value
 * @returns the dotted path, or `detail` when the issue is about the value as a whole
 */
function foldIssuePath({ path }: { path: readonly PropertyKey[] }): string {
  if (path.length === 0) {
    return "detail";
  }
  return `detail.${path.join(".")}`;
}

/**
 * The entry's question and lean when the page supplies neither, or the page's own when it marks them — and a
 * refusal when the entry types one beside the page's marks, since a second copy is the thing that drifts.
 */
function questionAndLean({
  record,
  label,
  page,
}: {
  record: Record<string, unknown>;
  label: string;
  page: QuestionAndLean;
}): Result<{ question: string | undefined; lean: string | undefined }, BriefingError> {
  const typedQuestion = stringField({ key: "question", record });
  const typedLean = stringField({ key: "lean", record });
  if (page.kind === "typed") {
    return ok({ lean: typedLean, question: typedQuestion });
  }
  const typedKeys = [
    ...(typedQuestion === undefined ? [] : ["question"]),
    ...(typedLean === undefined ? [] : ["lean"]),
  ];
  if (typedKeys.length > 0) {
    return err(BriefingErrors.openPageTypesPageFields({ keys: typedKeys, label }));
  }
  return ok({ lean: page.lean, question: page.question });
}

/**
 * The card fields of one entry, or a refusal naming the page and exactly what is missing.
 *
 * @param value the raw entry from the document
 * @param url the page the entry names, which labels a refusal when the entry carries no `label`
 * @param page where the card's question and lean come from
 * @returns the decoded fields, or the refusal
 */
export function decodeCardFields({
  value,
  url,
  page,
}: {
  value: unknown;
  url: string;
  page: QuestionAndLean;
}): Result<OpenPageCardFields, BriefingError> {
  if (!isRecord(value)) {
    return err(BriefingErrors.openPageEntryNotObject({ url }));
  }
  const label = absentAs({ value: stringField({ key: "label", record: value }), whenAbsent: url });
  const pair = questionAndLean({ label, page, record: value });
  if (pair.isErr()) {
    return err(pair.error);
  }
  const { question, lean } = pair.value;
  const what = stringField({ key: "what", record: value });
  const whyYou = stringField({ key: "whyYou", record: value });
  const ifSilent = stringField({ key: "ifSilent", record: value });
  const missing = [
    ...(question === undefined ? ["question"] : []),
    ...(what === undefined ? ["what"] : []),
    ...(whyYou === undefined ? ["whyYou"] : []),
    ...(lean === undefined ? ["lean"] : []),
    ...(ifSilent === undefined ? ["ifSilent"] : []),
  ];
  // The five tests spelled out rather than `missing.length > 0`, so the compiler narrows every field in one
  // branch — a second branch for the last two carried the same refusal a second time.
  const incomplete =
    question === undefined ||
    what === undefined ||
    whyYou === undefined ||
    lean === undefined ||
    ifSilent === undefined;
  if (incomplete) {
    return err(BriefingErrors.openPageFieldsMissing({ label, missing }));
  }
  const options = decodeOptions({ label, value: value["options"] });
  if (options.isErr()) {
    return err(options.error);
  }
  const detail = decodeDetail({ label, value: value["detail"] });
  if (detail.isErr()) {
    return err(detail.error);
  }
  return ok({
    ...(detail.value === undefined ? {} : { detail: detail.value }),
    ifSilent,
    lean,
    options: options.value,
    question,
    what,
    whyYou,
  });
}
