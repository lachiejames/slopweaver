/**
 * What the owner has had to CORRECT on the Slack drafts the fleet parked for them, one kind at a time, read off the
 * draft register and nothing else.
 *
 * The owner wants to see which problems have STOPPED, with evidence, even while new feedback comes in — many tiny
 * charts, one per thing, time across and corrections for that one thing up, because a total across every Slack steer
 * is lossy the way average CPU across every database is. This module derives the events those charts draw; the console
 * buckets them by the owner's local day (`site/lib/draftCorrectionTrails.ts`).
 *
 * ## The criterion
 *
 * A CHAIN is one live cut (`./draftLiveCut.ts`) and every row whose live cut it is, so three replies merged into one
 * message are one chain. Only chains whose live cut goes out AS THE OWNER count: the question is whether drafts sound
 * like the owner, and a bot row does not. A chain is REVIEWED when its live cut was released — the owner said yes to
 * some version.
 *
 * A LAP is one cut replaced by the next, in recording order inside a chain. What it corrected is read STRUCTURALLY
 * from the two cuts, because nothing records a steer's kind and no model runs here (`AGENTS.md` rule 2):
 *
 * | kind           | the lap changed                                     |
 * | -------------- | --------------------------------------------------- |
 * | `place`        | the channel, or whether and where it threads        |
 * | `stakeholders` | who it tags                                         |
 * | `proof`        | what it attaches                                    |
 * | `shorter`      | the words, to fewer of them                         |
 * | `reworded`     | the words, to as many or more                       |
 *
 * Two more kinds are not laps. `voice` is a cut that reached the owner breaking one of their exact voice rules — the em
 * dash that has not needed steering on in weeks is the case it exists for, and its zero is the evidence. `withheld` is
 * a chain dropped whole, never sent.
 *
 * ## What it cannot see, said rather than discovered
 *
 * A re-cut whose drop note names no successor reads as two chains, each first-try. A lap counts whoever asked for
 * it. Words typed into the supervisor chat are in transcripts, not here; the spoken ones relayed on a draft's
 * card (`post:<id>`) are joined in. Every one of those is in {@link CORRECTION_RESIDUE}, printed with the result.
 */
import type { TriageRuling } from "../../talk/triageVocabulary.js";
import {
  authoredProseOf,
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  rulesForActor,
  voiceRuleSubject,
} from "../voice/exactRules.js";
import { liveCutOf } from "./draftLiveCut.js";
import { type ParkedSlackDraft, parkedPayloadShape, type SlackDraftItem } from "./draftRegister.js";

/** Every kind of correction a trail is drawn for, in the order the console draws them. */
const CORRECTION_KINDS = ["voice", "stakeholders", "proof", "place", "shorter", "reworded", "withheld"] as const;

/** One of {@link CORRECTION_KINDS}. */
type CorrectionKind = (typeof CORRECTION_KINDS)[number];

/** The kinds a lap between two cuts can carry — every kind but the two that are not laps. */
type LapKind = Exclude<CorrectionKind, "voice" | "withheld">;

/** The limits of the measure, printed with every result so a reader never mistakes a zero it cannot see for one. */
export const CORRECTION_RESIDUE: readonly string[] = [
  "a re-cut whose drop note names no successor reads as two first-try chains",
  "a lap counts whoever asked for the re-cut, the owner or the fleet",
  "words typed into the supervisor chat live in transcripts; only words relayed on a draft's card are joined",
  "drafts posted as the bot are left out: the question is whether a draft sounds like the owner",
];

/** One thing the owner said on a draft's card, relayed by the console voice or typed there. */
export interface DraftSteer {
  /** The card the owner was on, `post:<sd-id>`. */
  readonly about: string;
  readonly atIso: string;
  readonly words: string;
  readonly anchor: string;
}

/** A relay receipt, as far as {@link draftSteersOf} reads one — `../../talk/relayStore.ts`'s `TurnRecord` is one. */
export interface SteerReceipt {
  readonly about: string;
  /** The owner's own transcribed or typed words, or empty on a receipt written before they were carried. */
  readonly heard: string;
  /** The relay's line, which on a receipt with no {@link heard} is where the owner's words went. */
  readonly words: string;
  readonly anchor: string;
  readonly stagedAtIso: string;
  /** The owner's triage ruling on the card, structurally, `null` for none — read by `./draftSentBack.ts`, never here. */
  readonly triageRuling?: TriageRuling | null | undefined;
}

/** The record-key prefix a Slack draft's Queue card carries, `post:<sd-id>`. */
const DRAFT_CARD_PREFIX = "post:";

/**
 * What the owner said on Slack draft cards, out of the relay receipts: every receipt about a `post:` card, their own
 * words where the receipt carries them and the relay's line where it predates them.
 *
 * @param receipts every relay receipt
 * @returns one steer per receipt about a draft card, in receipt order
 */
export function draftSteersOf({ receipts }: { receipts: readonly SteerReceipt[] }): readonly DraftSteer[] {
  return receipts
    .filter((receipt) => receipt.about.startsWith(DRAFT_CARD_PREFIX))
    .map((receipt) => {
      let words = receipt.heard;
      if (words.trim() === "") {
        words = receipt.words;
      }
      return { about: receipt.about, anchor: receipt.anchor, atIso: receipt.stagedAtIso, words };
    });
}

/** One correction, at the instant it happened. */
interface CorrectionEvent {
  readonly kind: CorrectionKind;
  readonly atIso: string;
  /** The chain's live cut — the message that went out, or the last cut standing. */
  readonly chain: string;
  /** The live cut's one-line purpose, so an event reads without opening a draft. */
  readonly why: string;
  /** For a lap: the cut replaced. For `voice`: the cut that broke a rule. For `withheld`: the cut dropped. */
  readonly cut: string;
  /** For a lap: the cut that replaced it. Absent otherwise. */
  readonly next?: string | undefined;
  /** The drop note on {@link cut}, when it was dropped. */
  readonly note?: string | undefined;
  /** The words of {@link cut}. */
  readonly before: string;
  /** The words of {@link next}. Absent when there is no next cut. */
  readonly after?: string | undefined;
  /** For `voice`: each rule the cut broke, as its configured text. Empty otherwise. */
  readonly rules: readonly string[];
  /** What the owner said on any card of this chain, oldest first. */
  readonly steers: readonly DraftSteer[];
}

/** Every correction, and every review the owner gave, as instants. */
export interface DraftCorrections {
  /** When each reviewed chain's live cut was released, oldest first. */
  readonly reviewed: readonly string[];
  /** Every correction, oldest first. */
  readonly events: readonly CorrectionEvent[];
  readonly residue: readonly string[];
}

/** One chain: its live cut and every cut that led to it, oldest first. */
export interface DraftChain {
  readonly live: SlackDraftItem;
  readonly cuts: readonly SlackDraftItem[];
}

/**
 * Group the register into chains by live cut, as-owner chains only.
 *
 * @param items every folded row
 * @returns one chain per live cut, its cuts in recording order
 */
export function draftCorrectionChains({ items }: { items: readonly SlackDraftItem[] }): readonly DraftChain[] {
  const byLive = new Map<string, { live: SlackDraftItem; cuts: SlackDraftItem[] }>();
  for (const item of items) {
    const cut = liveCutOf({ id: item.id, items });
    if (cut === undefined) {
      continue;
    }
    const standing = byLive.get(cut.live.id);
    if (standing === undefined) {
      byLive.set(cut.live.id, { cuts: [item], live: cut.live });
      continue;
    }
    standing.cuts.push(item);
  }
  return [...byLive.values()]
    .filter(({ live }) => live.draft.actor !== "bot")
    .map(({ cuts, live }) => ({
      cuts: cuts.toSorted((left, right) => left.draft.tsIso.localeCompare(right.draft.tsIso)),
      live,
    }));
}

/**
 * What one lap changed, read off the two cuts.
 *
 * @param from the cut replaced
 * @param to the cut that replaced it
 * @returns every kind the lap carries, in {@link CORRECTION_KINDS} order; empty when the two cuts are the same message
 */
export function lapKinds({ from, to }: { from: ParkedSlackDraft; to: ParkedSlackDraft }): readonly LapKind[] {
  const kinds: LapKind[] = [];
  if (!sameSet({ left: targetsOf({ draft: from }), right: targetsOf({ draft: to }) })) {
    kinds.push("stakeholders");
  }
  if (!sameSet({ left: mediaOf({ draft: from }), right: mediaOf({ draft: to }) })) {
    kinds.push("proof");
  }
  if (from.channel !== to.channel || from.shape !== to.shape || from.threadTs !== to.threadTs) {
    kinds.push("place");
  }
  const before = draftText({ draft: from });
  const after = draftText({ draft: to });
  if (before !== after) {
    kinds.push(wordCount({ text: after }) < wordCount({ text: before }) ? "shorter" : "reworded");
  }
  return kinds;
}

/**
 * The words a cut would post: a drip message's text, which `./dripRender.ts` builds from every run. A bot card has
 * no single text and is never in a chain this module reads, so it reads as empty.
 *
 * @returns the message's words
 */
function draftText({ draft }: { draft: ParkedSlackDraft }): string {
  const shape = parkedPayloadShape({ payload: draft.payload });
  if (shape.kind === "drip") {
    return shape.payload.text;
  }
  return "";
}

/**
 * Every correction the register holds, and every review.
 *
 * @param items every folded row
 * @param rules the owner's exact voice rules, all lanes — the as-owner subset is taken here
 * @param steers what the owner said on draft cards, any order
 * @returns the reviews and the corrections, each oldest first
 */
export function draftCorrections({
  items,
  rules,
  steers,
}: {
  items: readonly SlackDraftItem[];
  rules: readonly ExactVoiceRule[];
  steers: readonly DraftSteer[];
}): DraftCorrections {
  const asOwner = rulesForActor({ actor: "me", rules });
  const reviewed: string[] = [];
  const events: CorrectionEvent[] = [];
  for (const chain of draftCorrectionChains({ items })) {
    const { live } = chain;
    if (live.state === "released" && live.resolvedIso !== undefined) {
      reviewed.push(live.resolvedIso);
    }
    const ids = new Set(chain.cuts.map((cut) => `post:${cut.id}`));
    const said = steers
      .filter((steer) => ids.has(steer.about))
      .toSorted((left, right) => left.atIso.localeCompare(right.atIso));
    const base = { chain: live.id, steers: said, why: live.draft.why };
    events.push(...voiceEvents({ base, chain, rules: asOwner }), ...lapEvents({ base, chain }));
    if (live.state === "dropped" && live.resolvedIso !== undefined) {
      events.push({
        ...base,
        atIso: live.resolvedIso,
        before: draftText({ draft: live.draft }),
        cut: live.id,
        kind: "withheld",
        note: live.outcome,
        rules: [],
      });
    }
  }
  return {
    events: events.toSorted((left, right) => left.atIso.localeCompare(right.atIso)),
    residue: CORRECTION_RESIDUE,
    reviewed: reviewed.toSorted((left, right) => left.localeCompare(right)),
  };
}

/**
 * The plain-text report: one line per kind, each saying how many times it came up, when last, and how many drafts the
 * owner has reviewed since — the "this has stopped" evidence, whatever the console draws.
 *
 * @param corrections the derived events and reviews
 * @returns the lines to print, the reviewed baseline first and the residue last
 */
export function draftCorrectionLines({ corrections }: { corrections: DraftCorrections }): readonly string[] {
  const { events, residue, reviewed } = corrections;
  const lines = [`reviewed  ${String(reviewed.length)} drafts sent as you after your yes`];
  for (const kind of CORRECTION_KINDS) {
    const ofKind = events.filter((event) => event.kind === kind);
    const last = ofKind.at(-1);
    if (last === undefined) {
      lines.push(`${kind.padEnd(12)}  0`);
      continue;
    }
    const since = reviewed.filter((iso) => iso > last.atIso).length;
    lines.push(`${kind.padEnd(12)}  ${String(ofKind.length)} · last ${last.atIso} · ${String(since)} reviewed since`);
  }
  return [...lines, ...residue.map((limit) => `not seen: ${limit}`)];
}

/** The fields every event of one chain shares. */
type ChainBase = Pick<CorrectionEvent, "chain" | "steers" | "why">;

/** One `voice` event per cut that reached the owner breaking any of their exact rules. */
function voiceEvents({
  base,
  chain,
  rules,
}: {
  base: ChainBase;
  chain: DraftChain;
  rules: readonly ExactVoiceRule[];
}): readonly CorrectionEvent[] {
  return chain.cuts.flatMap((cut) => {
    const before = draftText({ draft: cut.draft });
    const prose = authoredProseOf({ path: "text", text: unescapedMrkdwn({ text: before }) });
    const findings = exactVoiceRuleFindings({ prose, rules });
    if (findings.length === 0) {
      return [];
    }
    const broken = [...new Set(findings.map((finding) => voiceRuleSubject({ rule: finding.rule })))];
    return [{ ...base, atIso: cut.draft.tsIso, before, cut: cut.id, kind: "voice", note: cut.outcome, rules: broken }];
  });
}

/** One event per kind per lap, at the instant the replacing cut was recorded. */
function lapEvents({ base, chain }: { base: ChainBase; chain: DraftChain }): readonly CorrectionEvent[] {
  return chain.cuts.slice(1).flatMap((to, at) => {
    const from = chain.cuts[at]!;
    return lapKinds({ from: from.draft, to: to.draft }).map((kind) => ({
      ...base,
      after: draftText({ draft: to.draft }),
      atIso: to.draft.tsIso,
      before: draftText({ draft: from.draft }),
      cut: from.id,
      kind,
      next: to.id,
      note: from.outcome,
      rules: [],
    }));
  });
}

/**
 * A message's text with Slack's three mrkdwn escapes undone, so a line quoted (`&gt; …`) reads as the quote
 * `authoredProseOf` exempts. MEASURED: two of the four cuts read as breaking a voice rule did so only
 * inside a quoted question from somebody else — repro: `slopweaver slack draft corrections --json | jq -c
 * '.events[] | select(.kind=="voice") | [.cut, .rules]'`.
 */
function unescapedMrkdwn({ text }: { text: string }): string {
  return text.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

/** Who a cut notifies, as a set of Slack ids. */
function targetsOf({ draft }: { draft: ParkedSlackDraft }): ReadonlySet<string> {
  return new Set(draft.mentions.map((mention) => mention.target));
}

/** What a cut attaches, as a set of content hashes. A row recorded before media existed attaches nothing. */
function mediaOf({ draft }: { draft: ParkedSlackDraft }): ReadonlySet<string> {
  if (draft.media === undefined) {
    return new Set();
  }
  return new Set(draft.media.map((media) => media.sha256));
}

/** Whether two sets hold the same members. */
function sameSet({ left, right }: { left: ReadonlySet<string>; right: ReadonlySet<string> }): boolean {
  return left.size === right.size && [...left].every((member) => right.has(member));
}

/** How many whitespace-separated words a text holds. */
function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}
