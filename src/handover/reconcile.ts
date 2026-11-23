/**
 * The RECONCILIATION: what the fleet is actually working, set against what the board says is most urgent,
 * and the one sentence that reports the gap.
 *
 * ## Why this is a computation and not a paragraph in a skill
 *
 * The owner's standing rule: feedback given more than once is a signal that a mechanical fix is due. The
 * feedback given repeatedly was that work in flight drifts away from what the owner actually wants done, and the answer that does not close it is
 * another instruction telling a session to check. A session that must remember to compare two lists will
 * compare them for a while and then stop, and nothing will notice — which is precisely the shape of the
 * thirteen-hour drop that this whole board change was measured against.
 *
 * So the comparison is code, its output is a typed record, and `../outbound/briefing/schema.ts` makes the
 * fleet briefing REFUSE to render without carrying it. The forcing is at the door, not in the prose.
 *
 * ## Only GROOMED rows may be called misaligned
 *
 * The first version of this ranked all 281 live rows and reported the top five. Zero of them declared a
 * priority, so the "top five" was the first five slugs in the alphabet, and the verb reported five starving
 * top rows and fifteen misaligned sessions — every finding an artefact of sorting. A report like that is
 * worse than no report: it is confidently wrong every tick, so a reader learns to ignore it, which is exactly
 * the fate of the prose instruction this replaced.
 *
 * So a row counts toward the top only when somebody actually PLACED it — see `./rank.ts`'s `groomed`. The
 * ungroomed rows are counted and reported as a number, which is the honest finding and the one that pulls
 * toward the standing practice the ruling asked for: the board cannot say what matters most until somebody
 * says.
 *
 * ## Only an ELIGIBLE row may enter the top band, and a SEAT is what makes an in-flight one eligible
 *
 * The same class fires a second time, in the opposite direction: the owner finds the workstreams page
 * unreadable and cannot tell whether it reflects reality at all. MEASURED on one reading: the verb published
 * five starving top rows — rows it was telling the owner nobody was on — and its OWN document records every
 * one of those five as `"ready": false`. Not one was work anybody could have picked up, and the file says so
 * about itself.
 *
 * **Two commands, because the measurement and the fix falsify differently.** That reading stays on disk —
 * `latestReadingFor` (`../readings/store.ts`) SELECTS the latest document per producer and deletes none of
 * the earlier ones — so the measurement is checkable rather than historical: `jq '{rankedCount, starving:
 * [.starving[] | {id, ready}]}' "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/readings/handover-reconcile/<instant>.json"`
 * answers 654, five ids, and `false` five times. WHY each row was unstartable is a standing, the field this
 * change adds and the one that document predates, so the fix is falsified against a CURRENT tick instead:
 * `slopweaver handover reconcile --json | jq '[.starving[] | {id, standing, ready}]'` must read
 * `"standing": "ready"` on every entry, and one that does not is this defect back. Every other measured
 * comment in this change points here rather than restating either.
 *
 * The trap is that the obvious repair is the first artefact wearing the other face. `ready` is one board
 * section, `RUN NOW`, and a row with an OPEN RUN composes to `IN FLIGHT` — so a band filtered on `ready`
 * alone reports an aligned fleet of nearly ZERO for ever, which `../supervisor/outcomes/coverage.ts`'s
 * `belongs` had already measured and written down. A band that ignores availability reports a starving five
 * for ever. Neither is a finding about the fleet; both are findings about the filter. (Nearly, not exactly:
 * a live SEAT is not an open run, so a `RUN NOW` row a session is sitting on stays `ready` and aligned —
 * `./rowStanding.ts` carries that distinction, and it is the one overlap in this module's three lists.)
 *
 * So the band is drawn over the rows the fleet's attention can actually be ON: a `ready` row, or an
 * `in-flight` row a SEAT IS OBSERVED on. The seat is load-bearing and is not the same claim as an open run —
 * `run.kind === "active"` proves an unclosed journal cycle, never a living agent, so unioning open runs into
 * the band would let a dead holder hold a priority for ever. When the fleet could not be observed at all,
 * `fleet: "unavailable"`, the in-flight arm closes entirely and the band is ready-only, because an empty
 * seat list is ignorance and must never read as a quiet fleet.
 *
 * ## The five findings, kept apart because a reader acts on each differently
 *
 * A session working a groomed row below the top band is `misaligned` — real, registered, placed work, just
 * not the most urgent. A session working a row nobody has placed is `unprioritised`, which is a statement
 * about the BOARD rather than about that session. A session working nothing the board knows about at all is
 * `unregistered`, and that is the finding that catches the original defect: the owner said something, a session went
 * and did it, and no row was ever created, so the board could not have told anyone it was happening. A
 * groomed top-band row nobody is working is `starving`, the same gap read from the other end. An ask nobody
 * has settled past its age budget is `staleAsks`.
 *
 * None is automatically a defect. A session may be deliberately on a lower-ranked row. The contract is that
 * the sweep SAYS so, not that the numbers are zero — a reconciliation that could only ever report "all
 * aligned" would be decoration.
 *
 * ## EVERY live session is answerable to a row, and that is now true without an exception list
 *
 * There used to be two exclusion buckets here, for sessions that existed by the fleet's own contract rather
 * than by a row: the standing recipe-scheduler, and the children it dispatched. That session is retired
 * and the dispatcher deleted, so neither shape exists to exclude — an automation now runs in
 * a session `automation seat` opens, and `seat` writes the board row BEFORE it opens one. The exclusion list is
 * gone rather than emptied: a predicate that can no longer match anything reports "all clear" in exactly the
 * voice it would use if it had stopped working.
 *
 * Pure: rows and sessions in, a record out. No filesystem, no clock.
 */

import { type BoardRow, rankOf } from "./rank.js";

/**
 * How many of the ranked rows count as "the top" for this comparison.
 *
 * Five, the same count as `../briefing/caps.ts`'s `PAGE_UNFOLDED_BLOCKS_MAX` and for the same underlying
 * reason rather than by coincidence: this number's whole job is to be small enough that the owner can hold
 * the whole comparison in their head while reading one line of a briefing. A band of twenty would make every
 * session "aligned" and report nothing; a band of one would report misalignment on a fleet doing exactly the
 * right thing.
 */
export const RECONCILE_TOP_BAND = 5;

/** One session and the board row it is actually working, as the caller resolved it. */
export interface WorkedItem {
  /** How to name this session to the owner — a workspace name, a branch, a run slug. */
  readonly session: string;
  /** The row it is working, or `undefined` when nothing on the board claims it. */
  readonly rowId: string | undefined;
}

/** One session placed against the ranked board. */
export interface PlacedWork {
  readonly session: string;
  readonly row: BoardRow;
  /** The row's 1-based position in the ranked list. */
  readonly rank: number;
}

/**
 * Whether the live fleet could be READ at all this tick.
 *
 * `unavailable` is a first-class outcome rather than an empty seat list, because the two look identical
 * downstream and mean opposite things: a socket that is down is ignorance, and rendering it as a quiet fleet
 * is the failure `../cli/commands/handover/reconcileRun.ts`'s own header already refuses for the text read.
 */
export type FleetRead = "observed" | "unavailable";

/** What comparing the fleet against the board found. */
export interface Reconciliation {
  /** Whether the live fleet was READ this tick — what every occupancy claim below rests on. */
  readonly fleet: FleetRead;
  /** The top band of the ranked board, most urgent first — ELIGIBLE rows only. */
  readonly top: readonly BoardRow[];
  /** Sessions working a top-band row. */
  readonly aligned: readonly PlacedWork[];
  /** Sessions working a groomed row that is NOT in the top band. */
  readonly misaligned: readonly PlacedWork[];
  /** Sessions working a row nobody has placed — a finding about the board, not about the session. */
  readonly unprioritised: readonly PlacedWork[];
  /** Sessions working something no row on the board claims. */
  readonly unregistered: readonly string[];
  /**
   * Top-band rows that are READY and that no observed seat is on — startable work nobody has taken.
   *
   * Restricted to `ready` on purpose. A count over the whole band minus the aligned sessions
   * would be five-of-five for ever on a band full of paused and owner-waiting rows: it accused the
   * fleet of ignoring work that could not be started, and it is the number the console's own sidebar badge
   * draws. A row here is one `slopweaver cmux spawn` would accept today — the module header above carries
   * the anchor for that tick, and `jq '[.starving[] | {id, standing}]'` over this verb's `--json` is the
   * falsifier: an entry whose `standing` is not `ready` is the old behaviour back.
   */
  readonly starving: readonly BoardRow[];
  /**
   * Rows the fleet CANNOT be on — what is held, ranked most urgent first.
   *
   * Everything that is neither ready nor observed under a seat: parked on the owner, paused on a named
   * person, in flight with nobody watching it, or blocked behind a dependency, a contradiction or a retired
   * chair. Each row carries its own `standing`, so a reader groups them without computing anything. This is
   * where the old top band's five rows went (the module header above anchors that tick), and naming them as
   * HELD rather than as starving is the whole difference between a page that accuses the fleet and one that
   * says where each item is. Count what lands here by standing with this verb's `--json` and
   * `jq '.held | group_by(.standing) | map({standing: .[0].standing, rows: length})'`.
   *
   * Grooming is deliberately NOT a condition, unlike {@link Reconciliation.top}'s. Whether somebody stated a
   * position decides what may be called most urgent; it has nothing to do with whether the row is held, and
   * requiring it here left an ungroomed unready row in neither this list nor `ready` — present in the ranked
   * count and invisible in every list drawn from it. `ready`, `held` and the seated rows now COVER the whole
   * ranked board: every row is in at least one of the three, so a reader may treat them as the board rather
   * than as a selection off it.
   *
   * Cover, NOT partition, and the difference is one real state rather than a hedge: a `RUN NOW` row a live
   * session is already on is in `ready` AND seated, because it is genuinely both — startable by its
   * standing, and already picked up. `held` is disjoint from the other two, which is what the page's
   * "startable by nobody" claim actually needs.
   *
   * **Both of those hold while every ranked row carries its OWN id, and neither holds when two do not.**
   * Every list here is computed per row and then reconciled by ID, so one id on two rows breaks it in both
   * directions at once. A seat drops EVERY row under its id out of `held` while `placeSessions`'s `byId`
   * keeps only the last, so the earlier row is in none of the three — and with no seat and disagreeing
   * readiness, the id is in `ready` from one row and in `held` from the other, so the two lists overlap.
   * Two review passes found one direction each, with counterexamples that ran. Left as residue rather than
   * patched here: this is the board's existing duplicate-slug defect
   * (`../cli/commands/handover/reconcileRows.ts`'s own RESIDUE note, and `docClaimOf` in `./hookShell.ts`),
   * it wants ONE resolution every door shares, and a second copy inside this filter would be how the doors
   * come to disagree. `../__tests__/unit/handover/reconcile.test.ts` pins the cover, the overlap and both
   * halves of this gap, so the day the duplicate is resolved the assertions redden with the prose.
   */
  readonly held: readonly BoardRow[];
  /** How many live rows carry no stated position at all. */
  readonly ungroomed: number;
  /** Open ask rows that have been waiting longer than {@link ASK_STALE_HOURS}. */
  readonly staleAsks: readonly BoardRow[];
  /**
   * EVERY row that could be picked up right now, ranked — not the top five.
   *
   * The top band answers "is the fleet on the most urgent thing"; this answers "what is there to pick up",
   * which is the question a shift filling capacity is actually asking and the one `top` cannot answer. It sits
   * here because a chair once filled the fleet out of a five-row window over a 718-row board
   * while ready rows under the owner's own stated outcomes sat untouched, and the window was all the verb exposed.
   */
  readonly ready: readonly BoardRow[];
  /**
   * ONE number to chase — the ready top-band rows nobody is on — and what it means, in one sentence: what
   * goes above the fold. Every other finding is its own list above, never a clause here.
   */
  readonly headline: string;
}

/**
 * What to say when the top band is EMPTY — which is not the same fact as nothing being startable.
 *
 * `eligible` rejects an UNGROOMED row whatever its standing, while `ready` does not, so an ordinary
 * `RUN NOW` doc nobody has stated a priority for — none, or a backfilled default — is in `ready` and out of `top`. The line this replaced said
 * "no row on the board is startable" off an empty band alone, which called that row unstartable inside a
 * report that listed it as ready — the same overclaim this module's header is about, one list along. What
 * an empty band means is that nothing PLACED is startable, and the two cases want different fixes: a
 * stated priority on a row that is already runnable, or unblocking a held one.
 *
 * @returns the sentence, with no trailing newline
 */
export function emptyBandLine({ rankedCount, result }: { rankedCount: number; result: Reconciliation }): string {
  const counts =
    `of ${String(rankedCount)} ranked, ${String(result.held.length)} are held (paused, blocked or parked ` +
    `on the owner) and ${String(result.ungroomed)} carry no stated position`;
  if (result.ready.length === 0) {
    return `no row on the board is startable — ${counts}, so the board cannot say what to do next. Unblock a held row.`;
  }
  return (
    `no row on the board is PLACED and startable — ${counts}. ${String(result.ready.length)} row(s) are ready ` +
    "to run and want only a stated position: `slopweaver handover set-priority <slug> --priority <band> " +
    '--because "<why>"` on the ones that matter, or unblock a held row.'
  );
}

/**
 * How long an open ask may sit before the reconciliation names it.
 *
 * Six hours. Measured from the owner's own transcripts: a structured batch of six asks reached the board
 * in about thirteen minutes, while the ask given mid-paragraph took thirteen hours and one minute to reach
 * it at all. Six is well above the working case and less than half the failure, so it fires on the class
 * that actually dropped without firing on an ask somebody is already registering.
 */
export const ASK_STALE_HOURS = 6;

/**
 * The READY top-band rows no observed seat is on — startable work nobody has taken.
 *
 * The `ready` test and the seat test are both real and neither implies the other. A ready row is `RUN NOW`
 * and a seated row composes to `IN FLIGHT`, so they rarely overlap — but a workspace whose directory is
 * named for a row whose run was never opened is seated on a ready row, and calling that starving would be
 * the same accusation this whole repair removes.
 */
function starvingRows({ top, seated }: { top: readonly BoardRow[]; seated: ReadonlySet<string> }): readonly BoardRow[] {
  return top.filter((row) => row.standing === "ready" && !seated.has(row.id));
}

/**
 * Whether a row may enter the top band: the fleet's attention can be on it right now.
 *
 * Two arms, and the second needs the SEAT rather than the row's own standing. `in-flight` is composed from
 * an open run journal, which proves a cycle nobody closed and never that an agent is alive — so a row is
 * eligible through that arm only when a live workspace was actually observed on it. With no fleet read at
 * all the arm closes: ignorance may not promote a row.
 */
function eligible({ row, seated, fleet }: { row: BoardRow; seated: ReadonlySet<string>; fleet: FleetRead }): boolean {
  if (!row.groomed) {
    return false;
  }
  if (row.standing === "ready") {
    return true;
  }
  return fleet === "observed" && row.standing === "in-flight" && seated.has(row.id);
}

/**
 * Whether a live session could move onto an uncovered top row WITHOUT uncovering another one.
 *
 * Two shapes, and the second is the one the obvious test misses: any session off the top band at all, or two
 * sessions sharing one top row, which leaves one of them free to move while the row stays covered. With
 * neither, every live session is the only one on its top row, so moving it trades one gap for another.
 */
function canMoveASession({
  aligned,
  misaligned,
  unprioritised,
  unregistered,
}: {
  aligned: readonly PlacedWork[];
  misaligned: readonly PlacedWork[];
  unprioritised: readonly PlacedWork[];
  unregistered: readonly string[];
}): boolean {
  if (misaligned.length + unprioritised.length + unregistered.length > 0) {
    return true;
  }
  const alignedRowIds = aligned.map((item) => item.row.id);
  return new Set(alignedRowIds).size < alignedRowIds.length;
}

/**
 * The whole finding as ONE number to chase and what it means, short enough to sit above a briefing's fold.
 *
 * Owner rule: never make the owner do arithmetic — say the number to chase and whether there is wiggle room. The
 * line this replaced set eight counts side by side ("4 of 21 … 13 are lower down … 167 are held … 541 ask(s)
 * …") and left the owner to work out which one mattered. The number is `starving`: top-band rows that are ready
 * and have no observed seat, the one count a spawn or a move drives to zero. A session on lower-ranked work
 * matters only while such a row exists, so it becomes the wiggle room rather than a second number, and every
 * other finding stays in its own list on the record, the text read's detail lines and `--json`.
 *
 * The branches are mutually exclusive and each is one sentence carrying at most one count, which is what
 * `../__tests__/unit/handover/reconcile.test.ts` enumerates to bound the widest against the briefing's cap.
 * An unreadable fleet is tested FIRST: the open-runs fallback fills `worked` with journals rather than seats,
 * so counting a gap off it would state a number nobody observed.
 */
function headlineFor({
  aligned,
  fleet,
  misaligned,
  ready,
  starving,
  top,
  unprioritised,
  unregistered,
}: {
  aligned: readonly PlacedWork[];
  fleet: FleetRead;
  misaligned: readonly PlacedWork[];
  ready: readonly BoardRow[];
  starving: readonly BoardRow[];
  top: readonly BoardRow[];
  unprioritised: readonly PlacedWork[];
  unregistered: readonly string[];
}): string {
  if (fleet === "unavailable") {
    return "The live fleet could not be read, so the urgent rows nobody is on cannot be counted.";
  }
  if (top.length === 0 && ready.length > 0) {
    return `Nothing placed is startable: ${String(ready.length)} ready row(s) want a stated priority (\`handover set-priority\`) before the board can rank them.`;
  }
  if (top.length === 0) {
    return "Nothing on the board is startable — unblock a held row or register the next one.";
  }
  if (starving.length === 0) {
    return "0 of the board's most urgent startable rows have nobody on them — nothing to chase.";
  }
  const gap = `${String(starving.length)} of the board's most urgent startable rows have nobody on them`;
  const live = aligned.length + misaligned.length + unprioritised.length + unregistered.length;
  if (live === 0) {
    return `${gap} — nothing is in flight, so each needs a new session.`;
  }
  if (canMoveASession({ aligned, misaligned, unprioritised, unregistered })) {
    return `${gap} — a live session could move to one before anything new is spawned.`;
  }
  return `${gap} — every live session is the only one on its own top row, so each needs a new session.`;
}

/** Every session sorted into the bucket a reader acts on — the placement half of {@link reconcile}. */
interface Placement {
  readonly aligned: readonly PlacedWork[];
  readonly misaligned: readonly PlacedWork[];
  readonly unprioritised: readonly PlacedWork[];
  readonly unregistered: readonly string[];
}

/**
 * Sort every live session into its bucket.
 *
 * @param ranked the whole ranked board, which decides a row's position
 * @param worked one entry per live session
 * @param topIds the ids of the top band, so an aligned session is decided by membership rather than by rank
 * @returns the four buckets, each in the order the sessions arrived
 */
function placeSessions({
  ranked,
  worked,
  topIds,
}: {
  ranked: readonly BoardRow[];
  worked: readonly WorkedItem[];
  topIds: ReadonlySet<string>;
}): Placement {
  const byId = new Map(ranked.map((row) => [row.id, row]));
  const aligned: PlacedWork[] = [];
  const misaligned: PlacedWork[] = [];
  const unprioritised: PlacedWork[] = [];
  const unregistered: string[] = [];
  for (const item of worked) {
    const row = item.rowId === undefined ? undefined : byId.get(item.rowId);
    const rank = item.rowId === undefined ? undefined : rankOf({ id: item.rowId, ranked });
    if (row === undefined || rank === undefined) {
      unregistered.push(item.session);
      continue;
    }
    const placed: PlacedWork = { rank, row, session: item.session };
    if (!row.groomed) {
      unprioritised.push(placed);
      continue;
    }
    if (topIds.has(row.id)) {
      aligned.push(placed);
      continue;
    }
    misaligned.push(placed);
  }
  return { aligned, misaligned, unprioritised, unregistered };
}

/**
 * Compare what the fleet is working against what the board says matters most.
 *
 * @param ranked the whole board, already ranked most-urgent-first
 * @param worked one entry per live session, with the row it resolved to
 * @param topBand how many ranked rows count as the top, defaulting to {@link RECONCILE_TOP_BAND}
 * @returns the placement of every session, the gaps at both ends, and the one-sentence headline
 */
export function reconcile({
  ranked,
  worked,
  fleet = "observed",
  topBand = RECONCILE_TOP_BAND,
}: {
  ranked: readonly BoardRow[];
  worked: readonly WorkedItem[];
  fleet?: FleetRead;
  topBand?: number;
}): Reconciliation {
  const seated = new Set(worked.flatMap((item) => (item.rowId === undefined ? [] : [item.rowId])));
  const top = ranked.filter((row) => eligible({ fleet, row, seated })).slice(0, topBand);
  const { aligned, misaligned, unprioritised, unregistered } = placeSessions({
    ranked,
    topIds: new Set(top.map((row) => row.id)),
    worked,
  });
  const staleAsks = ranked.filter((row) => row.kind === "ask" && row.waitingHours >= ASK_STALE_HOURS);
  const ready = ranked.filter((row) => row.ready);
  const starving = starvingRows({ seated, top });
  const held = ranked.filter((row) => !row.ready && !seated.has(row.id));
  const ungroomed = ranked.filter((row) => !row.groomed).length;
  return {
    aligned,
    fleet,
    headline: headlineFor({ aligned, fleet, misaligned, ready, starving, top, unprioritised, unregistered }),
    held,
    misaligned,
    ready,
    staleAsks,
    starving,
    top,
    ungroomed,
    unprioritised,
    unregistered,
  };
}
