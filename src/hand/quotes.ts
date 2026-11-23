/**
 * The words a hand step quotes ABOVE its fold — two or three lines from the room, each with who said it and the
 * permalink the owner opens to read it in place.
 *
 * The note a live incident ends in carries quotes:
 * verbatim quotes from the incident channel, with links, ABOVE the fold, then root cause and impact, then one
 * question (`../incident/note.ts`). A quote is the room's own words, so it is drawn
 * as theirs rather than summarised into the step's sentence — and it carries its permalink, so a line read out of
 * context is one click from its context.
 *
 * ## Capped by the SCHEMA, and refused rather than cut
 *
 * Above the fold is the part of a note the owner cannot avoid (rule 7), so it is the part most tightly bounded: at most
 * {@link QUOTES_MAX} quotes, each one line of at most {@link QUOTE_TEXT_CAP} characters. A cut quote is a
 * misquote, so a poster picks a shorter line, or marks its own elision with `…`, rather than this module cutting
 * one for it — the refusal `./details.ts` makes for the same reason.
 *
 * Pure: a value in, the quotes or a refusal out.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/** The most quotes one step may carry above its fold — two or three lines, never a transcript. */
export const QUOTES_MAX = 3;

/** The longest one quote may be: a sentence someone said, drawn on one or two lines of the note. */
export const QUOTE_TEXT_CAP = 200;

/** The longest the name beside a quote may be. */
export const QUOTE_WHO_CAP = 60;

/**
 * A Slack message permalink: `https://<workspace>.slack.com/archives/<channel>/p<ts>`, with an optional query
 * (`?thread_ts=…`). The only address a quote may carry, because a quote is something someone SAID in Slack.
 */
const SLACK_PERMALINK = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?\S*)?$/u;

/** One line the room said, as the note draws it. */
export interface HandQuote {
  /** The words, verbatim, on one line. */
  readonly text: string;
  /** Who said them, as the room knows them. */
  readonly who: string;
  /** The Slack permalink the owner opens to read the line in place. */
  readonly permalink: string;
}

/**
 * One field of a quote entry, checked as a trimmed single line within its cap.
 *
 * @param value whatever the entry carried under that key
 * @param key which field of the quote it is, named in the refusal
 * @param cap the longest it may be
 * @returns the trimmed text, or the refusal
 */
function quoteLine({ value, key, cap }: { value: unknown; key: string; cap: number }): Result<string, HandStepError> {
  if (typeof value !== "string") {
    return err(HandStepErrors.invalidField({ field: "quotes", why: `carries an entry whose ${key} is not text` }));
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes("\n")) {
    return err(HandStepErrors.invalidField({ field: "quotes", why: `carries an empty or multi-line ${key}` }));
  }
  if (trimmed.length > cap) {
    return err(
      HandStepErrors.invalidField({
        field: "quotes",
        why: `carries a ${String(trimmed.length)}-character ${key} and the cap is ${String(cap)} — quote a shorter line, or mark your own elision with …: "${trimmed.slice(0, 40)}…"`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * One quote entry, checked.
 *
 * @param entry one element of the list
 * @returns the quote, or the refusal
 */
function checkedQuote({ entry }: { entry: unknown }): Result<HandQuote, HandStepError> {
  if (!isRecord(entry)) {
    return err(HandStepErrors.invalidField({ field: "quotes", why: "is a list of { text, who, permalink }" }));
  }
  const record = entry;
  const extra = Object.keys(record).find((key) => key !== "text" && key !== "who" && key !== "permalink");
  if (extra !== undefined) {
    return err(
      HandStepErrors.invalidField({ field: "quotes", why: `carries an entry with an unknown key "${extra}"` }),
    );
  }
  const text = quoteLine({ cap: QUOTE_TEXT_CAP, key: "text", value: record["text"] });
  if (text.isErr()) {
    return err(text.error);
  }
  const who = quoteLine({ cap: QUOTE_WHO_CAP, key: "who", value: record["who"] });
  if (who.isErr()) {
    return err(who.error);
  }
  const permalink = typeof record["permalink"] === "string" ? record["permalink"].trim() : "";
  if (!SLACK_PERMALINK.test(permalink)) {
    return err(
      HandStepErrors.invalidField({
        field: "quotes",
        why: `carries a permalink "${permalink}" that is not a Slack message link (https://<workspace>.slack.com/archives/<channel>/p<ts>)`,
      }),
    );
  }
  return ok({ permalink, text: text.value, who: who.value });
}

/**
 * A step's quotes, checked — or honestly absent.
 *
 * An absent or empty list is dropped rather than written, so a row with no quotes reads back byte for byte as one
 * written before the field existed.
 *
 * @param value whatever the caller or the register line carried
 * @returns the quotes, `undefined` when there are none, or the refusal naming the rule it broke
 */
export function checkedQuotes({ value }: { value: unknown }): Result<readonly HandQuote[] | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return err(HandStepErrors.invalidField({ field: "quotes", why: "is a list of { text, who, permalink }" }));
  }
  if (value.length === 0) {
    return ok(undefined);
  }
  if (value.length > QUOTES_MAX) {
    return err(
      HandStepErrors.invalidField({
        field: "quotes",
        why: `carries ${String(value.length)} quotes and the cap is ${String(QUOTES_MAX)} — keep the lines that carry the incident`,
      }),
    );
  }
  const quotes: HandQuote[] = [];
  for (const entry of value as readonly unknown[]) {
    const quote = checkedQuote({ entry });
    if (quote.isErr()) {
      return err(quote.error);
    }
    quotes.push(quote.value);
  }
  return ok(quotes);
}
