/**
 * One risk item's list row, in the two shapes a body can carry, rendered and read back side by side.
 *
 * The SENTENCE row is the only one a write emits. It reads the way the owner would say it: the outcome as a bold
 * sentence, how likely and how bad in words, then who it hits. The row under the risk lead was
 * a field dump, `**worst** · impact high · likelihood low · reach · P1`, which a reader has to decode.
 *
 * The DOTTED row is that dump, its fields joined by ` · `, kept byte for byte as a read-back shape only: every body written before this
 * change, merged ones included, must still parse and re-render exactly, or `pr summary`, `--pull`, `--edit` and
 * the CI body gate would decline it. No write path can choose it.
 *
 * The priority is not printed. The list order already ranks the items and the badge already states the level,
 * but the badge DERIVES from it, so it round-trips as `data-priority`, an attribute GitHub's sanitiser drops.
 *
 * The nine odds sentences are a WIRE FORMAT: rewording one turns every body carrying it non-canonical, and would
 * need a third read-back shape here.
 */
import type { Level, Priority } from "./types.js";

/** Which row shape a body's risk items were written in. Only `sentence` is ever written. */
export type RiskRowShape = "sentence" | "dotted";

/** A risk item's check half, already rendered to HTML. */
export type RiskRowCheck =
  { readonly kind: "checked"; readonly html: string } | { readonly kind: "unchecked"; readonly html: string };

/** Everything one row carries, with its content runs already rendered to HTML. */
export interface RiskRowFields {
  readonly priority: Priority;
  readonly impact: Level;
  readonly likelihood: Level;
  readonly worstHtml: string;
  readonly reachHtml: string;
  readonly check: RiskRowCheck;
}

/**
 * How likely and how bad, in words, by likelihood then impact. Written out cell by cell so each sentence can be
 * read and pinned: "but" where exactly one half reassures, "and" where both point the same way.
 */
export const RISK_ODDS: Readonly<Record<Level, Readonly<Record<Level, string>>>> = {
  high: {
    high: "Likely, and serious if it happens.",
    low: "Likely, but minor if it happens.",
    medium: "Likely, and noticeable if it happens.",
  },
  low: {
    high: "Unlikely, but serious if it happens.",
    low: "Unlikely, and minor if it happens.",
    medium: "Unlikely, but noticeable if it happens.",
  },
  medium: {
    high: "Possible, and serious if it happens.",
    low: "Possible, but minor if it happens.",
    medium: "Possible, and noticeable if it happens.",
  },
};

const LEVELS: readonly Level[] = ["low", "medium", "high"];
const PRIORITIES: readonly Priority[] = [0, 1, 2, 3, 4];

/** Text already ending a sentence, so no full stop is added after it. */
const ENDS_SENTENCE = /[.?!]$/;

/**
 * A field's HTML ending a sentence: a full stop is appended only when it does not already end in `.`, `?` or `!`.
 *
 * @param html the field's rendered HTML
 * @returns the HTML with exactly one sentence ending
 */
export function withFullStop({ html }: { html: string }): string {
  return ENDS_SENTENCE.test(html) ? html : `${html}.`;
}

/**
 * The inverse of `withFullStop`: one trailing `.` is removed only when what remains could not have ended a
 * sentence on its own, so re-rendering the result reproduces the input byte for byte. A full stop the author typed
 * is indistinguishable from an added one, so it reads back without the stop, and the write door takes it off first.
 *
 * @param html the field's HTML as read off a row
 * @returns the HTML before `withFullStop` ran on it
 */
export function withoutAddedFullStop({ html }: { html: string }): string {
  const stripped = html.slice(0, -1);
  return html.endsWith(".") && !ENDS_SENTENCE.test(stripped) ? stripped : html;
}

/**
 * One row's whole `<li>` line in the given shape.
 *
 * @param shape `sentence` for anything written; `dotted` only to re-render a body read in that shape
 * @param fields the row's levels, priority and rendered content
 * @returns the line, `<li` to `</li>`
 */
export function riskRowLine({ shape, fields }: { shape: RiskRowShape; fields: RiskRowFields }): string {
  const { check, impact, likelihood, priority, reachHtml, worstHtml } = fields;
  if (shape === "dotted") {
    const dottedCheck = check.kind === "checked" ? `✅ ${check.html}` : `⚠️ No check. ${check.html}`;
    return (
      `<li><strong>${worstHtml}</strong> · impact ${impact} · likelihood ${likelihood} · ${reachHtml} · ` +
      `P${String(priority)}<br>${dottedCheck}</li>`
    );
  }
  const sentenceCheck = check.kind === "checked" ? `✅ ${check.html}` : `⚠️ Not checked: ${check.html}`;
  return (
    `<li data-priority="${String(priority)}"><strong>${withFullStop({ html: worstHtml })}</strong> ` +
    `${RISK_ODDS[likelihood][impact]} Affects ${withFullStop({ html: reachHtml })}<br>${sentenceCheck}</li>`
  );
}

/** Escape a literal for use inside a regular expression. */
function literal({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The nine odds sentences, as a list. */
const ODDS_SENTENCES: readonly string[] = LEVELS.flatMap((likelihood) =>
  LEVELS.map((impact) => RISK_ODDS[likelihood][impact]),
);

/** Every odds sentence, as one alternation. */
const ODDS_ALTERNATION = ODDS_SENTENCES.map((text) => literal({ text })).join("|");

/** A full stop standing apart from any text: alone, or after whitespace that follows a tag. */
const DETACHED_FULL_STOP = /^\s*\.$|>\s+\.$/;

/**
 * Why a `worst` or `reach` cannot be written into a sentence row, or undefined when it can. The WRITE door asks
 * this, never a reader, so a body already published in either shape stays readable.
 *
 * An odds sentence is what the row is split on, so one inside `worst` would end it early. A detached full stop
 * reads back as the one the row added, leaving a blank run behind. An ordinary typed full stop is allowed. The write
 * door takes it off (`./writeSchema.ts`), so the form reads back as written, which is what a dotted body carrying one
 * needs to stay editable.
 *
 * @param html the field's rendered HTML
 * @returns the reason, worded to follow the field's name, or undefined
 */
export function sentenceRowCellIssue({ html }: { html: string }): string | undefined {
  if (DETACHED_FULL_STOP.test(html)) {
    return "ends in a full stop standing apart from its text, which would read back as a blank run. Join or remove it";
  }
  const odds = ODDS_SENTENCES.find((sentence) => html.includes(sentence));
  if (odds !== undefined) {
    return `contains "${odds}", which the risk row is split on. Reword it`;
  }
  return undefined;
}

const SENTENCE_ROW = new RegExp(
  `^<li data-priority="([0-4])"><strong>(.*?)</strong> (${ODDS_ALTERNATION}) Affects (.*?)<br>` +
    "(?:✅ (.*)|⚠️ Not checked: (.*))</li>$",
);

const DOTTED_ROW =
  /^<li><strong>(.*?)<\/strong> · impact (low|medium|high) · likelihood (low|medium|high) · (.*?) · P([0-4])<br>(?:✅ (.*)|⚠️ No check\. (.*))<\/li>$/;

/** The levels an odds sentence was rendered from, by exact lookup over the table. */
function oddsOf({ sentence }: { sentence: string }): { likelihood: Level; impact: Level } | undefined {
  for (const likelihood of LEVELS) {
    for (const impact of LEVELS) {
      if (RISK_ODDS[likelihood][impact] === sentence) {
        return { impact, likelihood };
      }
    }
  }
  return undefined;
}

/** The check half of a matched row: the checked capture, else the unchecked one. */
function checkOf({ checked, why }: { checked: string | undefined; why: string | undefined }): RiskRowCheck | undefined {
  if (checked !== undefined) {
    return { html: checked, kind: "checked" };
  }
  return why === undefined ? undefined : { html: why, kind: "unchecked" };
}

/** A captured level, narrowed. */
function levelOf({ text }: { text: string | undefined }): Level | undefined {
  return LEVELS.find((level) => level === text);
}

/** The dotted row, read. */
function readDotted({ match }: { match: RegExpExecArray }): RiskRowFields | undefined {
  const impact = levelOf({ text: match[2] });
  const likelihood = levelOf({ text: match[3] });
  const priority = PRIORITIES[Number(match[5])];
  const check = checkOf({ checked: match[6], why: match[7] });
  if (impact === undefined || likelihood === undefined || priority === undefined || check === undefined) {
    return undefined;
  }
  return { check, impact, likelihood, priority, reachHtml: match[4]!, worstHtml: match[1]! };
}

/**
 * Read one `<li>` line in either shape, saying which it was.
 *
 * @param line one line of the risk items list
 * @returns the row's fields and shape, or undefined when the line is neither shape
 */
export function readRiskRowLine({ line }: { line: string }): (RiskRowFields & { shape: RiskRowShape }) | undefined {
  const sentence = SENTENCE_ROW.exec(line);
  if (sentence !== null) {
    const odds = oddsOf({ sentence: sentence[3]! });
    const priority = PRIORITIES[Number(sentence[1])];
    const check = checkOf({ checked: sentence[5], why: sentence[6] });
    if (odds === undefined || priority === undefined || check === undefined) {
      return undefined;
    }
    return {
      check,
      ...odds,
      priority,
      reachHtml: withoutAddedFullStop({ html: sentence[4]! }),
      shape: "sentence",
      worstHtml: withoutAddedFullStop({ html: sentence[2]! }),
    };
  }
  const dotted = DOTTED_ROW.exec(line);
  const fields = dotted === null ? undefined : readDotted({ match: dotted });
  return fields === undefined ? undefined : { ...fields, shape: "dotted" };
}
