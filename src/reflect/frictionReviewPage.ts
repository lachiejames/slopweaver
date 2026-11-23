/**
 * The Friction Review page, rendered from one dated self-improvement report — the republish step 11 of the
 * supervisor's sweep contract used to leave to a session's hands.
 *
 * ## Why a renderer rather than a session
 *
 * The report is already the finished evidence (`./briefMarkdown.ts` projects a composed brief and judges
 * nothing), so the page is that markdown made readable and nothing more. Before this existed, chairs
 * hand-authored one page per report with `page publish friction-review-<d><mon>`: every one was a
 * mechanical conversion of the same five shapes, and one of them wrapped a whole `<!doctype>` document
 * inside the page shell, the defect `skills/page/SKILL.md` warns about. Four chairs carried the gap in their
 * shift state rather than stamp a republish they had not done. A verb that renders and stamps in one act
 * closes both.
 *
 * ## Narrow on purpose
 *
 * It reads exactly the markdown `./briefMarkdown.ts` writes — `#`/`##`/`###` headings, `- ` bullets,
 * paragraphs and backtick code spans — rather than markdown in general. A line in any other shape is a
 * paragraph, escaped, so a report the writer one day widens still publishes, just plainer.
 *
 * Pure: markdown in, fragment out. The publish and the stamp are the verb's.
 */
import { BRIEFING_TIME_ZONE } from "../briefing/localDay.js";
import { err, ok, type Result } from "../lib/result.js";
import { escapeText } from "../outbound/briefing/escape.js";
import {
  EVIDENCE_BULLET_PREFIX,
  FINDING_ID_BULLET_PREFIX,
  NO_EVIDENCE_RECORDED,
  ORDERING_BULLET_PREFIX,
} from "./briefMarkdown.js";
import { type FrictionReviewPageError, FrictionReviewPageErrors } from "./frictionReviewPageErrors.js";

/**
 * How many rows a `board:` or `memory:` bullet lists inline before it folds behind a count.
 *
 * On the hand-authored `friction-review-12oct` the longest list left inline carried 11 rows and the shortest
 * folded one 22; any threshold in between reproduces it. A cross-reference past one wrapped line is detail,
 * so it collapses (AGENTS.md rule 7).
 */
export const CROSS_REF_FOLD_AFTER = 12;

/** One cross-reference bullet as `./briefMarkdown.ts` writes it: `- board: a, b, c`. */
const CROSS_REF_BULLET = /^(board|memory): (.+)$/;

/** An ISO-8601 instant as the report's `Window` line carries it. */
const ISO_INSTANT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

/** The month names a slug carries, lowercased: `friction-review-13oct`. */
const SLUG_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** What `./briefMarkdown.ts` opens every report's `#` heading with, before the day. */
const REPORT_TITLE_PREFIX = "Self-improvement mining, ";

/** A report day: `YYYY-MM-DD`. */
const REPORT_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The parts one instant is written from, in the owner's own zone. */
const LOCAL_PARTS = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  month: "short",
  timeZone: BRIEFING_TIME_ZONE,
  timeZoneName: "short",
});

/**
 * The page slug one report is republished under — the `friction-review-<day><mon>` shape the hand-authored
 * pages already carry, so a republish of a day a chair already published replaces that page and keeps its
 * frozen history rather than starting a second one.
 *
 * @param date the report's day, `YYYY-MM-DD`
 * @returns the slug, or why the date cannot name one
 */
export function frictionReviewPageSlug({ date }: { date: string }): Result<string, FrictionReviewPageError> {
  const match = REPORT_DATE.exec(date);
  const month = match === null ? undefined : SLUG_MONTHS[Number(match[2]) - 1];
  // A day the calendar rolls over (day 30 of February rolls into March) names no report, so it gets no page and no stamp.
  const onCalendar =
    match !== null &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDate() === Number(match[3]);
  if (match === null || month === undefined || !onCalendar) {
    return err(FrictionReviewPageErrors.notAReportDay({ date }));
  }
  return ok(`friction-review-${String(Number(match[3]))}${month}`);
}

/**
 * One instant as the owner reads time: day, month, then a 12-hour clock and a zone. Text shaped like an instant that
 * names no real one (a month of 99, say) is not an instant, so it stays the report's own characters.
 */
function localInstant({ iso }: { iso: string }): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    return iso;
  }
  const parts = new Map(LOCAL_PARTS.formatToParts(instant).map((part) => [part.type, part.value]));
  const period = parts.get("dayPeriod")?.toLowerCase();
  const clock = `${parts.get("hour")!}:${parts.get("minute")!}${period === undefined ? "" : ` ${period}`}`;
  return `${parts.get("day")!} ${parts.get("month")!}, ${clock} ${parts.get("timeZoneName")!}`;
}

/**
 * One line of report prose as HTML: escaped, every balanced backtick span a `<code>`, every machine instant
 * written in the owner's own zone. An unmatched backtick stays a literal character rather than swallowing the rest of
 * the line into code.
 */
function inline({ text }: { text: string }): string {
  const pieces = text.replaceAll(ISO_INSTANT, (iso) => localInstant({ iso })).split("`");
  const unmatched = pieces.length % 2 === 0 ? pieces.pop() : undefined;
  const html = pieces
    .map((piece, index) =>
      index % 2 === 1 ? `<code>${escapeText({ text: piece })}</code>` : escapeText({ text: piece }),
    )
    .join("");
  if (unmatched === undefined) {
    return html;
  }
  return `${html}\`${escapeText({ text: unmatched })}`;
}

/** One bullet's contents, folding a long cross-reference list behind its count. */
function bulletItem({ text }: { text: string }): string {
  const crossRef = CROSS_REF_BULLET.exec(text);
  const rows = crossRef === null ? [] : crossRef[2]!.split(", ");
  if (crossRef === null || rows.length <= CROSS_REF_FOLD_AFTER) {
    return `<li>${inline({ text })}</li>`;
  }
  return (
    `<li><details><summary>${crossRef[1]!}: ${String(rows.length)} rows</summary>` +
    `${inline({ text: crossRef[2]! })}</details></li>`
  );
}

/** Whether a bullet's text is one recorded evidence line, as opposed to the written-out "none recorded". */
function isEvidenceLine({ text }: { text: string }): boolean {
  return text.startsWith(EVIDENCE_BULLET_PREFIX) && text !== `${EVIDENCE_BULLET_PREFIX}${NO_EVIDENCE_RECORDED}`;
}

/**
 * Whether a finding-list bullet is how the miner ranked it or what already covers it — detail the owner does not need
 * to grade, folded so the consequence, the pattern and the id are what they read (a score above the fold reads as
 * "friction out of ten" with no rubric behind it).
 */
function isRankingLine({ text }: { text: string }): boolean {
  return text.startsWith(ORDERING_BULLET_PREFIX) || CROSS_REF_BULLET.test(text);
}

/** The summary a folded run of ranking and cross-reference bullets opens behind. */
const RANKING_FOLD_SUMMARY = "how the fleet ranked it, and what already covers it";

/**
 * A bullet list's items, with each run of consecutive evidence lines folded into ONE item behind its count, and
 * each run of ranking and cross-reference lines folded behind one summary (AGENTS.md rule 7: the finding id
 * stays above the fold, the evidence and the ranking are detail).
 *
 * Only a finding's own list is folded, recognised by its `finding id:` bullet: any other bullet that happens to
 * begin `evidence: ` (a could-not-see residue, say) is report text and renders as it always did.
 */
function bulletItems({ texts }: { texts: readonly string[] }): readonly string[] {
  if (!texts.some((text) => text.startsWith(FINDING_ID_BULLET_PREFIX))) {
    return texts.map((text) => bulletItem({ text }));
  }
  const items: string[] = [];
  let run: { kind: "evidence" | "ranking"; texts: string[] } | undefined;
  const flush = (): void => {
    if (run === undefined) {
      return;
    }
    if (run.kind === "ranking") {
      const inner = run.texts.map((text) => bulletItem({ text })).join("");
      items.push(`<li><details><summary>${RANKING_FOLD_SUMMARY}</summary><ul>${inner}</ul></details></li>`);
    } else {
      const noun = run.texts.length === 1 ? "line" : "lines";
      const lines = run.texts.map((text) => `<li>${inline({ text: text.slice(EVIDENCE_BULLET_PREFIX.length) })}</li>`);
      items.push(
        `<li><details><summary>evidence: ${String(run.texts.length)} ${noun}</summary><ul>${lines.join("")}</ul></details></li>`,
      );
    }
    run = undefined;
  };
  for (const text of texts) {
    let kind: "evidence" | "ranking" | undefined;
    if (isEvidenceLine({ text })) {
      kind = "evidence";
    } else if (isRankingLine({ text })) {
      kind = "ranking";
    }
    if (run !== undefined && run.kind !== kind) {
      flush();
    }
    if (kind === undefined) {
      items.push(bulletItem({ text }));
    } else if (run === undefined) {
      run = { kind, texts: [text] };
    } else {
      run.texts.push(text);
    }
  }
  flush();
  return items;
}

/** Which block a report line opens, continues or closes. */
type LineKind = "blank" | "heading" | "bullet" | "prose";

/** A run of adjacent lines of one kind, rendered as one element. */
interface Block {
  readonly kind: LineKind;
  readonly lines: string[];
}

/** Classify one report line. */
function lineKind({ line }: { line: string }): LineKind {
  if (line.trim() === "") {
    return "blank";
  }
  if (/^#{1,3} /.test(line)) {
    return "heading";
  }
  if (line.startsWith("- ")) {
    return "bullet";
  }
  return "prose";
}

/** A heading line as its element; the first `#` heading also titles the page. */
function headingElement({ line }: { line: string }): string {
  const level = line.indexOf(" ");
  const text = inline({ text: line.slice(level + 1) });
  return `<h${String(level)}>${text}</h${String(level)}>`;
}

/**
 * Group report lines into blocks: adjacent bullets form one list, adjacent prose lines one paragraph, and a
 * heading or blank line stands alone, closing whatever was open.
 */
function blocksOf({ lines }: { lines: readonly string[] }): readonly Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const kind = lineKind({ line });
    const last = blocks.at(-1);
    const continues = last?.kind === kind && (kind === "bullet" || kind === "prose");
    if (continues) {
      last.lines.push(line);
    } else {
      blocks.push({ kind, lines: [line] });
    }
  }
  return blocks;
}

/** One block as its element, or nothing for the blank lines between blocks. */
function blockElement({ block }: { block: Block }): readonly string[] {
  switch (block.kind) {
    case "blank":
      return [];
    case "heading":
      return [headingElement({ line: block.lines[0]! })];
    case "bullet":
      return [`<ul>\n${bulletItems({ texts: block.lines.map((line) => line.slice(2)) }).join("\n")}\n</ul>`];
    case "prose":
      return [`<p>${inline({ text: block.lines.map((line) => line.trim()).join(" ") })}</p>`];
    default: {
      const unreachable: never = block.kind;
      return unreachable;
    }
  }
}

/** The report's `# ` heading text, refused when it is absent or names another day than its filename. */
function reportTitle({
  lines,
  date,
}: {
  lines: readonly string[];
  date: string;
}): Result<string, FrictionReviewPageError> {
  const title = lines.find((line) => line.startsWith("# "));
  if (title === undefined) {
    return err(FrictionReviewPageErrors.noReportHeading());
  }
  const expected = `${REPORT_TITLE_PREFIX}${date}`;
  if (title !== `# ${expected}`) {
    return err(FrictionReviewPageErrors.headingDayMismatch({ expected, heading: title.slice(2) }));
  }
  return ok(expected);
}

/**
 * Render one report as a page fragment for `publishPage`: a `<title>` from its `#` heading, then its body in
 * the house design (no stylesheet of its own, so the shell's applies).
 *
 * The heading must name the same day as the file: the filename dates the page's slug and the stamp, so a
 * report whose contents name another day would publish one day's evidence under the other's identity.
 *
 * @param markdown the report exactly as it sits under `$SLOPWEAVER_HOME/morning`
 * @param date the day its filename carries, `YYYY-MM-DD`
 * @returns the fragment, or why the report cannot be published as that day's page
 */
export function renderFrictionReviewFragment({
  markdown,
  date,
}: {
  markdown: string;
  date: string;
}): Result<string, FrictionReviewPageError> {
  const lines = markdown.split("\n");
  return reportTitle({ date, lines }).map((title) => {
    const body = blocksOf({ lines }).flatMap((block) => blockElement({ block }));
    return `${[`<title>${inline({ text: title })}</title>`, ...body].join("\n")}\n`;
  });
}
