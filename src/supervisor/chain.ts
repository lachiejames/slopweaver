/**
 * The SUPERVISOR CHAIN — every session that has held the supervisor pin, in succession order, so the intake
 * check can read a week rather than a session.
 *
 * ## The defect, measured
 *
 * `../supervisor/intakeRead.ts` resolves ONE transcript: the session the pin record currently names. The pin
 * record is REPLACED on every takeover (`../sessions/supervisorPinStore.ts` says why), so the moment a
 * successor takes over, every turn the owner typed into its predecessor becomes invisible to the check.
 * Measured on a week audit: `slopweaver supervisor intake --since <a week back>` reported
 * `7 read, all witnessed` — and all seven came from the one live session, while the other sixty-seven
 * supervisors in that window were not looked at. The clause read as a clean bill of health for a week it had
 * never seen. The supervisor must remember pretty much everything the owner says, or at least not drop
 * important things they say.
 *
 * ## The record, and why a journal rather than a scan
 *
 * A link is written every time a Slopweaver verb moves the pin (`../cli/commands/cmux/recordPin.ts`), so the
 * chain maintains itself and reading a week costs one small file. The transcripts are the ground truth
 * underneath it and `./chainScan.ts` can rebuild the journal from them, but that pass reads every transcript
 * on the machine — MEASURED: 1,619 transcripts, 83 supervisors recovered, 45.7 s wall; reproduce
 * with `time slopweaver supervisor chain --rescan` — which is a repair, not a sweep-tick cost.
 *
 * ## Coverage is part of the answer, not a footnote
 *
 * The failure above was not that the check read one session. It was that reading one session and reading
 * sixty-eight were INDISTINGUISHABLE in the output. So every read carries {@link ChainCoverage}, the
 * clause states it, and a window the chain cannot reach is said out loud rather than counted as clean.
 *
 * The same command after this landed, over the same window: 281 owner turns across 79 supervisor sessions,
 * 247 of them witnessed by nothing.
 *
 * Pure: links and instants in, an ordered chain and a coverage verdict out. No filesystem, no clock beyond
 * the instants it is handed.
 */

import { absentAs } from "#lib/absent.js";
import { pushInto } from "#lib/collections.js";
import { sameSupervisorSession } from "./session.js";
import { linkKey, type SupervisorLink } from "./supervisorLink.js";

export type { SupervisorLink } from "./supervisorLink.js";

/** The verb that rebuilds the chain from the transcripts — named wherever coverage is short, never implied. */
export const CHAIN_RESCAN_COMMAND = "slopweaver supervisor chain --rescan";

/**
 * Why a Codex chair is a stated gap to a reader that does not open its rollout (`../profile/supervisorWords.ts`):
 * its owner turns and peer messages are disclosed as unread rather than counted as none. The chain's owner-turn
 * read opens the rollout (`./codexChairRead.ts`) and names {@link CODEX_CHAIR_PEER_TRAFFIC_UNREAD} instead.
 */
export const CODEX_CHAIR_UNREAD =
  "a Codex chair's rollout is not read yet, so its owner turns and peer messages are UNREAD";

/**
 * What a Codex chair whose owner turns DID read still leaves out: the messages other sessions sent it. Its rollout's
 * peer traffic is not decoded, so the chain read names it in coverage rather than judging no message as answered.
 */
export const CODEX_CHAIR_PEER_TRAFFIC_UNREAD =
  "a Codex chair's peer messages are not read from its rollout, so a report sent to it is UNREAD";

/**
 * One link with the window it is responsible for.
 *
 * A supervisor owns the owner's turns from the moment it took the pin until its successor did. That is the
 * succession itself rather than a guess, which is why the end is read off the NEXT link and never off the
 * transcript's own last line: a session that stayed open after handing over would otherwise claim turns its
 * successor answered.
 */
export interface ChainSpan {
  readonly link: SupervisorLink;
  /** The successor's `pinnedAtIso`, or `undefined` for the link still holding the pin. */
  readonly untilIso: string | undefined;
}

/** One chair whose transcript could not be walked, the reason, and when it last stopped holding the pin. */
export interface UnreadableChair {
  readonly claudeSessionId: string;
  readonly why: string;
  /**
   * The end of the chair's LATEST tenure (`chairTenures`), or `undefined` while it still holds the pin or no takeover
   * closes it. A reader asking whether this chair could hold a turn after some instant reads it; a required key, so
   * every producer states it rather than leaving an open tenure indistinguishable from an unstated one.
   */
  readonly untilIso: string | undefined;
}

/** What a chain read could and could not see — carried in every finding, never inferred by a reader. */
export interface ChainCoverage {
  /** Every session actually walked, in succession order. */
  readonly walked: readonly string[];
  /** How many links the chain holds in total, whatever the window kept. */
  readonly linksKnown: number;
  /** The earliest instant the chain knows about, or `undefined` when it holds no link at all. */
  readonly earliestIso: string | undefined;
  /**
   * The floor asked for, and whether the journal reaches it. `false` means turns before
   * {@link ChainCoverage.earliestIso} were NOT read — the case the old check reported as clean.
   */
  readonly reachesSince: boolean;
  /** Links whose transcript could not be walked, each with the reason. A gap that is stated, not swallowed. */
  readonly unreadable: readonly UnreadableChair[];
}

/**
 * The chain in succession order, one link per session.
 *
 * A session appears once even when the pin came back to it: the EARLIEST instant wins, because the span it
 * owns starts there and a later re-pin would silently drop the turns in between. A `pin` link outranks a
 * `scan` link for the same session, since the pin verb saw the workspace and the scan only saw a transcript.
 *
 * @param links every link the journal holds, in any order
 * @returns one link per session, oldest first
 */
export function orderChain({ links }: { links: readonly SupervisorLink[] }): readonly SupervisorLink[] {
  const bySession = new Map<string, SupervisorLink>();
  for (const link of links) {
    const key = linkKey({ link });
    const held = bySession.get(key);
    if (held === undefined) {
      bySession.set(key, link);
      continue;
    }
    const pinnedAtIso =
      Date.parse(link.pinnedAtIso) < Date.parse(held.pinnedAtIso) ? link.pinnedAtIso : held.pinnedAtIso;
    const authoritative = held.source === "pin" ? held : link;
    bySession.set(key, { ...authoritative, pinnedAtIso });
  }
  return [...bySession.values()].toSorted(
    (left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso),
  );
}

/**
 * Pair every link with the instant its successor took over.
 *
 * @param links the chain, already ordered by {@link orderChain}
 * @returns one span per link, in the same order
 */
export function chainSpans({ links }: { links: readonly SupervisorLink[] }): readonly ChainSpan[] {
  return links.map((link, index) => {
    const next = links[index + 1];
    return next === undefined ? { link, untilIso: undefined } : { link, untilIso: next.pinnedAtIso };
  });
}

/** One interval a session held the pin. */
export interface ChairTenure {
  readonly fromIso: string;
  /** When a DIFFERENT session next took the pin, or `undefined` while this one still holds it. */
  readonly untilIso: string | undefined;
}

/**
 * Every interval each session held the pin, read off the UNMERGED journal.
 *
 * {@link orderChain} keeps one link per session at its earliest pin, which is right for walking each transcript
 * once and wrong for asking whether a session held the pin at a given instant: for A → B → A it ends A at B's
 * pin and leaves B open. Here each pin opens a tenure that runs until a different session next pins, so the
 * live A is live. A second pin by the session already holding it extends that tenure rather than opening one.
 * MEASURED: 254 journal links, zero sessions pinned twice — reproduce with
 * `slopweaver supervisor chain` and count a session listed twice — so this is the correct shape for a case this
 * install has not yet produced, not a fix for one it has.
 *
 * A `scan` link's instant is the moment a session invoked the supervisor skill (`./chainScan.ts`), not the
 * moment it took the pin, so it is used only where nothing better exists. A session with ANY pin link is read
 * from its pin links alone, and a scan link never closes another session's tenure. A session with only scan
 * links — the pre-journal tail, 86 of 254 links here — opens one tenure at its scan and
 * never closes it, so its messages stay in-span: this check fails soft, because a wrongly CARRIED message is
 * the arm that makes the verb exit non-zero. Both directions of getting this wrong were reproduced.
 *
 * @param links every link, in any order
 * @returns each session's link key (host and id) → its tenures, oldest first
 */
export function chairTenures({
  links,
}: {
  links: readonly SupervisorLink[];
}): ReadonlyMap<string, readonly ChairTenure[]> {
  const readable = links.filter((link) => !Number.isNaN(Date.parse(link.pinnedAtIso)));
  const pinned = new Set(readable.filter((link) => link.source === "pin").map((link) => linkKey({ link })));
  const ordered = readable
    .filter((link) => link.source === "pin" || !pinned.has(linkKey({ link })))
    .toSorted((left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso));
  const tenures = new Map<string, ChairTenure[]>();
  ordered.forEach((link, index) => {
    const key = linkKey({ link });
    const previous = ordered[index - 1];
    if (previous !== undefined && linkKey({ link: previous }) === key) {
      return;
    }
    const next = ordered.slice(index + 1).find((later) => linkKey({ link: later }) !== key && later.source === "pin");
    // A scan-opened tenure is never closed: nothing in a scan link says when that session stopped holding the
    // pin, and closing it at somebody else's pin would carry messages a chair may well have read.
    pushInto({
      buckets: tenures,
      key,
      value: { fromIso: link.pinnedAtIso, untilIso: link.source === "pin" ? next?.pinnedAtIso : undefined },
    });
  });
  return tenures;
}

/**
 * Every Codex chair holding the pin at or after the floor, the live pin's holder included, one link per thread.
 *
 * Judged on TENURES, never on `orderChain`'s one earliest span per session: a Codex thread that retakes the chair
 * after another session would otherwise end at that session's pin and fall out of the window.
 * The live pin's holder is in the window whatever its instant reads: it holds the chair now, and a tenure drops a
 * link whose instant will not parse.
 *
 * @param links every link the journal holds, with the live pin folded in
 * @param pinned the live pin as a link, or nothing when no pin is recorded
 * @param sinceIso the floor
 * @returns the Codex chairs inside the window, in `orderChain`'s order
 */
function codexChairsInWindow({
  links,
  pinned,
  sinceIso,
}: {
  links: readonly SupervisorLink[];
  pinned: readonly SupervisorLink[];
  sinceIso: string;
}): readonly SupervisorLink[] {
  const tenures = chairTenures({ links });
  const floor = Date.parse(sinceIso);
  const inWindow = ({ link }: { link: SupervisorLink }): boolean =>
    pinned.some((pin) => sameSupervisorSession({ left: pin.session, right: link.session })) ||
    tenures
      .get(linkKey({ link }))
      ?.some((tenure) => tenure.untilIso === undefined || Date.parse(tenure.untilIso) >= floor) === true;
  return orderChain({ links }).filter((link) => link.session.host === "codex" && inWindow({ link }));
}

/**
 * Each later tenure of a chair that retook the pin and reaches the floor, as a gap. {@link orderChain} walks a session
 * once, from its first pin to its first successor's, so a later tenure is never read; this names it rather than
 * fixing the walk, which the takeover gate's count also rides on.
 *
 * @param span the span the walk read, ending at the first successor's pin
 * @param sinceIso the floor, or `undefined` for the whole chain
 * @param tenures that session's own tenures, from {@link chairTenures}
 * @returns one gap line per unwalked tenure, empty when there is none
 */
export function unwalkedTenureGaps({
  span,
  sinceIso,
  tenures,
}: {
  span: ChainSpan;
  sinceIso: string | undefined;
  tenures: readonly ChairTenure[];
}): readonly string[] {
  const { untilIso } = span;
  if (untilIso === undefined) {
    return [];
  }
  const floor = sinceIso === undefined ? Number.NEGATIVE_INFINITY : Date.parse(sinceIso);
  return tenures
    .filter((tenure) => Date.parse(tenure.fromIso) >= Date.parse(untilIso))
    .filter((tenure) => tenure.untilIso === undefined || Date.parse(tenure.untilIso) >= floor)
    .map(
      (tenure) =>
        `held the pin again from ${tenure.fromIso}, and only its first stretch was walked, so an owner turn from then may be missing`,
    );
}

/**
 * The owner window over the chain, pure: the live pin folded into the journal, `orderChain`'s one earliest link
 * per session, every chair's tenures, every span, and the spans to walk — those `spansSince` keeps plus the span
 * of every Codex chair `codexChairsInWindow` finds inside the window, so a Codex thread that retook the chair is
 * walked, and disclosed as unread, rather than dropped at its successor's pin without a word.
 *
 * @param chain every link the journal holds, in any order
 * @param pinned the live pin as a link, or nothing when no pin is recorded
 * @param sinceIso the floor, or `undefined` to keep the whole chain
 * @returns the ordered links, tenures, every span and the spans to walk, both in succession order
 */
export function ownerWindow({
  chain,
  pinned,
  sinceIso,
}: {
  chain: readonly SupervisorLink[];
  pinned: readonly SupervisorLink[];
  sinceIso: string | undefined;
}): {
  readonly allSpans: readonly ChainSpan[];
  readonly ordered: readonly SupervisorLink[];
  readonly spans: readonly ChainSpan[];
  readonly tenures: ReadonlyMap<string, readonly ChairTenure[]>;
} {
  const links = [...chain, ...pinned];
  const ordered = orderChain({ links });
  const tenures = chairTenures({ links });
  const allSpans = chainSpans({ links: ordered });
  const kept = spansSince({ sinceIso, spans: allSpans });
  if (sinceIso === undefined) {
    return { allSpans, ordered, spans: kept, tenures };
  }
  const codex = codexChairsInWindow({ links, pinned, sinceIso });
  const spans = allSpans.filter(
    (span) =>
      kept.includes(span) ||
      codex.some((link) => sameSupervisorSession({ left: link.session, right: span.link.session })),
  );
  return { allSpans, ordered, spans, tenures };
}

/**
 * The spans a window actually needs walking.
 *
 * A span is in scope when it was still current at or after the floor — its successor took over at or after
 * `sinceIso`, or it has no successor at all. The span whose successor took over BEFORE the floor holds no
 * turn the window wants.
 *
 * @param spans every span, oldest first
 * @param sinceIso the floor, or `undefined` to keep the whole chain
 * @returns the spans in scope, oldest first
 */
export function spansSince({
  spans,
  sinceIso,
}: {
  spans: readonly ChainSpan[];
  sinceIso: string | undefined;
}): readonly ChainSpan[] {
  if (sinceIso === undefined) {
    return spans;
  }
  const floor = Date.parse(sinceIso);
  if (Number.isNaN(floor)) {
    return spans;
  }
  return spans.filter((span) => span.untilIso === undefined || Date.parse(span.untilIso) >= floor);
}

/**
 * Whether the journal reaches back far enough to answer the window.
 *
 * An EMPTY journal never reaches: a chain that knows nothing must not report a clean week. A journal whose
 * earliest link postdates the floor reaches only if that link is the very first supervisor there was, which
 * nothing on disk can prove — so it reads as short, and the clause says so.
 *
 * @param links the whole chain, oldest first
 * @param sinceIso the floor asked for, or `undefined` when the whole chain was asked for
 * @returns true when every instant the window covers sits inside the chain
 */
export function chainReachesSince({
  links,
  sinceIso,
}: {
  links: readonly SupervisorLink[];
  sinceIso: string | undefined;
}): boolean {
  const earliest = links[0];
  if (earliest === undefined) {
    return false;
  }
  if (sinceIso === undefined) {
    return true;
  }
  const floor = Date.parse(sinceIso);
  if (Number.isNaN(floor)) {
    return false;
  }
  return Date.parse(earliest.pinnedAtIso) <= floor;
}

/**
 * The one sentence a coverage verdict adds to the intake clause, or "" when the chain covered the window.
 *
 * "" is the ONLY silent case and it is earned: every link in scope was walked and the chain reaches the
 * floor. Anything else prints, because the whole defect this closes was a short read that looked complete.
 *
 * @param coverage what the read could and could not see
 * @returns the sentence, full stop included, or "" when there is nothing to disclose
 */
export function coverageClause({ coverage }: { coverage: ChainCoverage }): string {
  if (coverage.linksKnown === 0) {
    return `No supervisor chain is recorded, so NOTHING was read — rebuild it with \`${CHAIN_RESCAN_COMMAND}\`.`;
  }
  const parts: string[] = [];
  if (!coverage.reachesSince) {
    parts.push(
      `the chain starts at ${absentAs({ value: coverage.earliestIso, whenAbsent: "an unknown instant" })}, so anything earlier was NOT read`,
    );
  }
  if (coverage.unreadable.length > 0) {
    parts.push(`${String(coverage.unreadable.length)} session(s) could not be walked`);
  }
  if (parts.length === 0) {
    return "";
  }
  const walked = String(coverage.walked.length);
  return `Chain coverage: ${walked} session(s) walked, but ${parts.join(", and ")} — \`${CHAIN_RESCAN_COMMAND}\`.`;
}
