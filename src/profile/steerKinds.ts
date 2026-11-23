/**
 * Which kind of correction each turn of the owner's names about the Slack drafts the fleet writes as the owner — the
 * pure half of `slopweaver profile steers`, and what the Alignment page's Slack chart draws.
 *
 * The owner wants to see which problems have STOPPED, with evidence, even while new
 * feedback arrives — one chart for Slack steers with a line per kind, a small chart per kind behind it, and the
 * owner's own dated words behind each point. Four rules are this module's contract:
 *
 * - **One turn is one point per kind it names**:
 *   saying "em dashes" five times in one turn is one point; a voice dump naming em dashes and proof is one point on
 *   each chart, each quoting the words about its own kind.
 * - **Whether a turn names a kind is a READ, not a keyword match**: a turn that only
 *   implies the pain is left out. So a verdict is journalled by a session that read the
 *   turn (`profile steers judge`), never computed here — and no model runs here either (`AGENTS.md` rule 2).
 * - **A problem observed with no solution observed is still there**: a kind reads as
 *   stopped only on the owner's own words saying so, journalled as a `stopped` verdict quoting them. The page renders what
 *   the owner said beside what was observed and never declares a pass itself.
 * - **The quote is zoomed to the words about that kind**, expandable to the whole turn: every verdict quotes a
 *   verbatim run of the turn, refused at the journal when it is not one.
 *
 * ## What a candidate is, and what it costs
 *
 * Reading every turn of the owner's is not affordable — `profile words --since 160d` lists over five thousand — so the turns a
 * session is offered to read are those holding one of a kind's {@link SteerKind.cues} AND a word placing it on Slack.
 * The cues only choose what gets READ; nothing is counted until a session reads it. A turn naming a kind in words no
 * cue holds is never offered, which {@link STEER_RESIDUE} states rather than leaves to be discovered.
 */
import { z } from "zod";

import type { OwnerUtterance } from "./ownerWords.js";
import { placesOnSlack } from "./slackPlace.js";
import { withoutRelayTwins } from "./steerRelayTwins.js";

/** One kind of correction a Slack draft can need, as the page titles it and the cues that offer a turn for reading. */
export interface SteerKind {
  readonly id: string;
  readonly title: string;
  /** Any one of these, beside a Slack word, offers a turn to a reader. Never a verdict on its own. */
  readonly cues: readonly RegExp[];
}

/**
 * The Slack kinds, in the order the page draws them. The owner's own examples — em dashes, proof attached, the
 * right stakeholders, the right place after approval, withheld because the world moved — plus the two voice
 * complaints that are not em dashes; the owner does not yet know what gets a chart and will react to this cut.
 */
export const SLACK_STEER_KINDS: readonly SteerKind[] = [
  { cues: [/\bem[\s-]?dash/iu, /—/u, /\bdashes\b/iu], id: "em-dashes", title: "Em dashes" },
  {
    cues: [
      /\bvoice rules?\b/iu,
      /\bsounds? like (?:me|a bot|ai|chatgpt|claude)\b/iu,
      /\btone\b/iu,
      /\brobotic\b/iu,
      /\bcorporate\b/iu,
      /\bai[\s-]?(?:slop|tropes?|isms?)\b/iu,
      /\bmy voice\b/iu,
    ],
    id: "voice",
    title: "Other voice rules",
  },
  {
    cues: [/\btoo long\b/iu, /\bshorter\b/iu, /\bwall of text\b/iu, /\bverbose\b/iu, /\bwordy\b/iu, /\bconcise\b/iu],
    id: "length",
    title: "Length",
  },
  {
    cues: [/\btag(?:s|ged|ging)?\b/iu, /\bmention(?:s|ed)?\b/iu, /\bloop(?:ed)? in\b/iu, /\bstakeholders?\b/iu],
    id: "stakeholders",
    title: "The right people tagged",
  },
  {
    cues: [/\bproofs?\b/iu, /\bscreenshots?\b/iu, /\bvideos?\b/iu, /\bevidence\b/iu, /\battach(?:ed|ment|ments)?\b/iu],
    id: "proof",
    title: "Proof attached",
  },
  {
    cues: [
      /\bthread(?:ed)?\b/iu,
      /\bchannel\b/iu,
      /\btop[\s-]level\b/iu,
      /\bwrong place\b/iu,
      /\bin (?:a|the|my) dm\b/iu,
    ],
    id: "place",
    title: "Sent to the right place",
  },
  {
    cues: [
      /\b(?:don'?t|do not) send\b/iu,
      /\bhold (?:it|off)\b/iu,
      /\bmoot\b/iu,
      /\bno longer (?:needed|relevant|true)\b/iu,
      /\balready (?:merged|done|answered|fixed)\b/iu,
      /\bout of date\b/iu,
      /\bstale\b/iu,
    ],
    id: "withheld",
    title: "Withheld: the world moved",
  },
];

/** The kind ids, for the flag parser and the journal's schema. */
export const SLACK_STEER_KIND_IDS: readonly string[] = SLACK_STEER_KINDS.map((kind) => kind.id);

/** The limits of the measure, printed with every reading. */
export const STEER_RESIDUE: readonly string[] = [
  "a turn is offered for reading only when it holds a kind's cue and a word placing it on Slack; one naming a kind in other words is never read",
  "the owner's words before the supervisor chain's first chair, and anything said outside a console call, the console or a chair, are not read",
  "a kind with no turn naming it is not a solved kind: it stays open until a turn of the owner's says it stopped",
];

/** What a verdict says a turn did about one kind. */
export type SteerSays = "corrects" | "stopped";

/** One read of one turn, journalled. */
export type SteerVerdict =
  | {
      readonly anchor: string;
      readonly turnAtIso: string;
      readonly kind: string;
      readonly says: SteerSays;
      /** A verbatim run of the turn: the words about this kind and no others. */
      readonly quote: string;
      readonly judgedAtIso: string;
    }
  /** The turn was read and names no kind — so it is never offered again. */
  | { readonly anchor: string; readonly turnAtIso: string; readonly says: "nothing"; readonly judgedAtIso: string }
  /** A wrong read of one kind, taken back. */
  | { readonly anchor: string; readonly kind: string; readonly says: "withdrawn"; readonly judgedAtIso: string };

const instant = z.iso.datetime({ offset: true });
const kindId = z.string().refine((id) => SLACK_STEER_KIND_IDS.includes(id), { message: "not a Slack steer kind" });

const verdictSchema = z.union([
  z.strictObject({
    anchor: z.string().min(1),
    judgedAtIso: instant,
    kind: kindId,
    quote: z.string().min(1),
    says: z.enum(["corrects", "stopped"]),
    turnAtIso: instant,
  }),
  z.strictObject({ anchor: z.string().min(1), judgedAtIso: instant, says: z.literal("nothing"), turnAtIso: instant }),
  z.strictObject({ anchor: z.string().min(1), judgedAtIso: instant, kind: kindId, says: z.literal("withdrawn") }),
]);

/**
 * One verdict as the journal line it is written as.
 *
 * @returns the line, no trailing newline
 */
export function steerVerdictLine({ verdict }: { verdict: SteerVerdict }): string {
  return JSON.stringify(verdict);
}

/**
 * Read the journal's lines, keeping every line that parses and naming every one that does not.
 *
 * @param lines the journal, one verdict per line
 * @returns the verdicts in journal order, and the 1-based numbers of the lines that would not read
 */
export function parseSteerVerdicts({ lines }: { lines: readonly string[] }): SteerHistory {
  return parseNumberedSteerVerdicts({ lines: lines.map((line, at) => ({ line, number: at + 1 })) });
}

/** Every verdict that reads, in journal order, and the numbers of the lines that would not. */
export interface SteerHistory {
  readonly verdicts: readonly SteerVerdict[];
  readonly unparsed: readonly number[];
}

/**
 * One line, read as a verdict.
 *
 * @param line the journal line
 * @returns the verdict, or undefined when the line is not one
 */
export function steerVerdictOf({ line }: { line: string }): SteerVerdict | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = verdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Read journal lines that each carry their own number — a line's place in the file, or a stored measurement's
 * sequence — keeping every one that parses and naming every one that does not by that number.
 *
 * @param lines the lines, in journal order
 * @returns the verdicts in journal order, and the numbers of the lines that would not read
 */
export function parseNumberedSteerVerdicts({
  lines,
}: {
  lines: readonly { readonly line: string; readonly number: number }[];
}): SteerHistory {
  const verdicts: SteerVerdict[] = [];
  const unparsed: number[] = [];
  lines.forEach(({ line, number }) => {
    if (line.trim() === "") {
      return;
    }
    const verdict = steerVerdictOf({ line });
    if (verdict === undefined) {
      unparsed.push(number);
      return;
    }
    verdicts.push(verdict);
  });
  return { unparsed, verdicts };
}

/** Collapse every whitespace run to one space, so a quote spanning a line break still matches the turn. */
function flat({ text }: { text: string }): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Whether a quote is a verbatim run of a turn, whitespace aside.
 *
 * @param quote the words a verdict would carry
 * @param text the turn whole
 * @returns true when the turn holds the quote
 */
export function quoteIsVerbatim({ quote, text }: { quote: string; text: string }): boolean {
  const wanted = flat({ text: quote });
  return wanted !== "" && flat({ text }).includes(wanted);
}

/**
 * The kinds whose cue a turn holds, when it also names Slack — which turns a session is offered to read.
 *
 * @param text the turn whole
 * @param botHandles the bot's own Slack handles, as the install's profile records them
 * @returns the kind ids cued, in {@link SLACK_STEER_KINDS} order; empty when the turn does not name Slack
 */
export function cuedKinds({ text, botHandles }: { text: string; botHandles: readonly string[] }): readonly string[] {
  if (!placesOnSlack({ botHandles, text })) {
    return [];
  }
  return SLACK_STEER_KINDS.filter((kind) => kind.cues.some((cue) => cue.test(text))).map((kind) => kind.id);
}

/** A verdict that still stands about one kind of one turn. */
export interface StandingVerdict {
  readonly anchor: string;
  readonly turnAtIso: string;
  readonly kind: string;
  readonly says: SteerSays;
  readonly quote: string;
}

/**
 * Fold the journal: the last word on each turn's each kind stands, a withdrawal removes it, and a turn with any verdict
 * at all has been read.
 *
 * @param verdicts the journal in order
 * @returns the standing verdicts in journal order, and every anchor read
 */
export function foldSteerVerdicts({ verdicts }: { verdicts: readonly SteerVerdict[] }): {
  readonly standing: readonly StandingVerdict[];
  readonly read: ReadonlySet<string>;
} {
  const byKey = new Map<string, StandingVerdict>();
  const read = new Set<string>();
  for (const verdict of verdicts) {
    read.add(verdict.anchor);
    if (verdict.says === "nothing") {
      continue;
    }
    const key = `${verdict.anchor}\u0000${verdict.kind}`;
    byKey.delete(key);
    if (verdict.says === "withdrawn") {
      continue;
    }
    byKey.set(key, {
      anchor: verdict.anchor,
      kind: verdict.kind,
      quote: verdict.quote,
      says: verdict.says,
      turnAtIso: verdict.turnAtIso,
    });
  }
  return { read, standing: [...byKey.values()] };
}

/** One turn offered for reading. */
export interface SteerCandidate {
  readonly anchor: string;
  readonly atIso: string;
  readonly how: OwnerUtterance["how"];
  readonly cued: readonly string[];
  readonly text: string;
}

/**
 * The turns a session has yet to read: cued, and with no verdict of any kind journalled.
 *
 * @param utterances the owner's turns
 * @param read every anchor already read
 * @param botHandles the bot's own Slack handles, as the install's profile records them
 * @returns the unread candidates, oldest first
 */
export function unreadSteerCandidates({
  utterances,
  read,
  botHandles,
}: {
  utterances: readonly OwnerUtterance[];
  read: ReadonlySet<string>;
  botHandles: readonly string[];
}): readonly SteerCandidate[] {
  return utterances
    .filter((one) => !read.has(one.anchor))
    .map((one) => ({
      anchor: one.anchor,
      atIso: one.atIso,
      cued: cuedKinds({ botHandles, text: one.text }),
      how: one.how,
      text: one.text,
    }))
    .filter((one) => one.cued.length > 0)
    .toSorted((left, right) => left.atIso.localeCompare(right.atIso));
}

/** One point on a kind's chart: a turn of the owner's, and the words about that kind. */
export interface SteerPoint {
  readonly anchor: string;
  readonly atIso: string;
  readonly says: SteerSays;
  readonly quote: string;
  /** The turn whole; absent when its record did not read this time (a gap names why), where the anchor may. */
  readonly text?: string | undefined;
}

/** One kind's chart. */
interface SteerKindTrail {
  readonly kind: string;
  readonly title: string;
  /** Oldest first. */
  readonly points: readonly SteerPoint[];
  /** The last turn that corrected it, or absent when none has. */
  readonly lastCorrectedIso?: string | undefined;
  /** The last turn of the owner's saying it stopped AFTER the last correction, or absent — open until one does. */
  readonly stoppedIso?: string | undefined;
}

/** What `profile steers` reports. */
export interface SteerKindsReading {
  readonly observedAtIso: string;
  readonly surface: "slack";
  readonly sinceIso: string;
  readonly kinds: readonly SteerKindTrail[];
  /** Turns inside the window read, cued or not. */
  readonly read: number;
  /** Cued turns inside the window nobody has read yet — what a zero on a chart may be hiding. */
  readonly unread: number;
  readonly unparsed: readonly number[];
  readonly gaps: readonly string[];
  readonly residue: readonly string[];
}

/**
 * The reading the page draws: one trail per kind, every standing verdict on a turn inside the window a point on it,
 * and the read and unread counts over the same turns. A verdict whose quote the turn no longer holds verbatim — the
 * journal is a file another process could write — is named under the gaps and never drawn.
 *
 * @param utterances the owner's turns inside the window
 * @param verdicts the journal in order
 * @param unparsed journal lines that would not read
 * @param gaps every source that did not read whole
 * @param sinceIso the window's floor
 * @param nowIso the instant read at
 * @param botHandles the bot's own Slack handles, as the install's profile records them
 * @returns the reading
 */
export function steerKindsReading({
  utterances,
  verdicts,
  unparsed,
  gaps,
  sinceIso,
  nowIso,
  botHandles,
}: {
  utterances: readonly OwnerUtterance[];
  verdicts: readonly SteerVerdict[];
  unparsed: readonly number[];
  gaps: readonly string[];
  sinceIso: string;
  nowIso: string;
  botHandles: readonly string[];
}): SteerKindsReading {
  const { read, standing } = foldSteerVerdicts({ verdicts });
  const textOf = new Map(utterances.map((one) => [one.anchor, one.text]));
  const inWindow = standing.filter((verdict) => verdict.turnAtIso >= sinceIso && verdict.turnAtIso <= nowIso);
  const unheld = inWindow.filter((verdict) => {
    const text = textOf.get(verdict.anchor);
    return text !== undefined && !quoteIsVerbatim({ quote: verdict.quote, text });
  });
  const drawn = inWindow.filter((verdict) => !unheld.includes(verdict));
  const kinds = SLACK_STEER_KINDS.map((kind): SteerKindTrail => {
    const judged = drawn
      .filter((verdict) => verdict.kind === kind.id)
      .map((verdict): SteerPoint => ({
        anchor: verdict.anchor,
        atIso: verdict.turnAtIso,
        quote: verdict.quote,
        says: verdict.says,
        text: textOf.get(verdict.anchor),
      }));
    const points = withoutRelayTwins({ points: judged }).toSorted((left, right) =>
      left.atIso.localeCompare(right.atIso),
    );
    const lastCorrectedIso = points.findLast((point) => point.says === "corrects")?.atIso;
    const stopped = points.filter(
      (point) => point.says === "stopped" && (lastCorrectedIso === undefined || point.atIso > lastCorrectedIso),
    );
    return { kind: kind.id, lastCorrectedIso, points, stoppedIso: stopped.at(-1)?.atIso, title: kind.title };
  });
  const unheldGaps = unheld.map(
    (verdict) => `journal: ${verdict.anchor} no longer holds the ${verdict.kind} quote verbatim, so it is not drawn`,
  );
  return {
    gaps: [...gaps, ...unheldGaps],
    kinds,
    observedAtIso: nowIso,
    read: utterances.filter((one) => read.has(one.anchor)).length,
    residue: STEER_RESIDUE,
    sinceIso,
    surface: "slack",
    unparsed,
    unread: unreadSteerCandidates({ botHandles, read, utterances }).length,
  };
}
