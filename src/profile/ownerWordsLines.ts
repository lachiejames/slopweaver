/**
 * The owner's words as `profile words` prints them, in three tiers: the count, one head line and preview per turn (or the
 * turn whole), then how to read one whole and every record that would not read. What the report holds is
 * `./ownerWords.ts`; this only says it.
 */
import type { OwnerUtterance, OwnerWordsReport, OwnerWordsWhere } from "./ownerWords.js";
import type { OwnerWordsEdge, OwnerWordsEdges } from "./ownerWordsEdges.js";

/** How much of a turn one list line previews. */
const PREVIEW_CHARS = 140;

/** Where the owner said it, as a reader says it. */
const WHERE_PHRASE: Readonly<Record<OwnerWordsWhere, string>> = {
  "call-landing": "a console call, landed on a card",
  "claude-session": "a Claude session",
  "console-call": "a console call",
  "console-relay": "relayed from the console voice",
  "console-typed": "typed on the console",
  supervisor: "the supervisor chat",
};

/** The ends in one state, named as a reader says them: `its start`, `its end`, or both joined by the word given. */
function endsNamed({ cut, edge, join }: { cut: OwnerWordsEdges; edge: OwnerWordsEdge; join: string }): string {
  const ends: string[] = [];
  if (cut.start === edge) {
    ends.push("its start");
  }
  if (cut.end === edge) {
    ends.push("its end");
  }
  return ends.join(` ${join} `);
}

/**
 * What a record says beside its words about each end on its own: the ends it lost, then the ends it does not say it kept.
 * A kept end says nothing, and an end the record never recorded is never said to be kept.
 *
 * @param cut what the record says about its start and its end
 * @returns the phrase, opening ` · `, or empty for a record that kept both ends
 */
export function cutPhrase({ cut }: { cut: OwnerWordsEdges }): string {
  const clauses: string[] = [];
  const lost = endsNamed({ cut, edge: "lost", join: "and" });
  if (lost !== "") {
    clauses.push(`lost ${lost}`);
  }
  const unknown = endsNamed({ cut, edge: "unknown", join: "or" });
  if (unknown !== "") {
    clauses.push(`does not say whether it kept ${unknown}`);
  }
  if (clauses.length === 0) {
    return "";
  }
  return ` · the record ${clauses.join(" and ")}`;
}

/**
 * An instant as a line prints it, to the minute in UTC.
 *
 * @param iso the instant a record carries
 * @returns `YYYY-MM-DD HH:MMZ`, or the text as stored when it is not an instant
 */
export function minuteOf({ iso }: { iso: string }): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return iso;
  }
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/**
 * The one line naming an utterance: when, how, where, how long, whether cut, and its anchor.
 *
 * @param one the utterance
 * @returns the head line, unindented
 */
export function utteranceHead({ one }: { one: OwnerUtterance }): string {
  return (
    `${minuteOf({ iso: one.atIso })} · ${one.how} · ${WHERE_PHRASE[one.where]} · ` +
    `${one.chars.toLocaleString("en-US")} chars${cutPhrase({ cut: one.cut })} · ${one.anchor}`
  );
}

/** The opening of an utterance on one line, whitespace collapsed — never the stored text. */
function previewOf({ text }: { text: string }): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= PREVIEW_CHARS) {
    return flat;
  }
  return `${flat.slice(0, PREVIEW_CHARS)}…`;
}

/** The report's first line: how many, of which how, over which window. */
function headline({ report }: { report: OwnerWordsReport }): string {
  let about = "";
  if (report.phraseWords.length > 0) {
    about = ` containing ${report.phraseWords.join(" + ")}`;
  }
  let only = "";
  if (report.how !== undefined) {
    only = ` ${report.how}`;
  }
  return (
    `profile words: ${String(report.matched)}${only} turn(s) of the owner's${about} from ${minuteOf({ iso: report.sinceIso })} ` +
    `to ${minuteOf({ iso: report.untilIso })} — ${String(report.spoken)} spoken, ${String(report.written)} written`
  );
}

/**
 * The report as lines, in three tiers: the count, one head and preview per utterance (or its whole text under
 * `full`), then how to read one whole and what could not be read.
 *
 * @param full print each utterance's whole text instead of a one-line preview
 * @returns the lines
 */
export function ownerWordsLines({ report, full }: { report: OwnerWordsReport; full: boolean }): readonly string[] {
  const lines = [headline({ report })];
  report.shown.forEach((one) => {
    lines.push(`  ${utteranceHead({ one })}`);
    if (full) {
      one.text.split("\n").forEach((line) => {
        lines.push(`      ${line}`);
      });
    } else {
      lines.push(`      ${previewOf({ text: one.text })}`);
    }
  });
  if (report.omitted > 0) {
    lines.push(`  ${String(report.omitted)} older — raise --limit, or narrow with --phrase, --since or --how`);
  }
  if (report.shown.length > 0 && !full) {
    lines.push("  one whole: slopweaver profile words <anchor>");
  }
  report.gaps.forEach((gap) => {
    lines.push(`  not read — ${gap.source}: ${gap.why}`);
  });
  return lines;
}
