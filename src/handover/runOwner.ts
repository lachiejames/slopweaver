/**
 * Which session owns a run — the fact the stop gate was missing, and the reason it damaged neighbours.
 *
 * ## The defect this exists for
 *
 * The owner deliberately runs many sessions at once, and a background driver may hold a run. Measured: the gate fired in a session on a run a LIVE driver was executing, and every escape it offered mutated that
 * other run. `resume` — its top suggestion — starts a second agent on a branch already being driven, which is
 * exactly what produced two competing all-green PRs for one fix, and a parked question written by a session
 * reading a different checkout. So a gate meant to prevent abandoned runs became a mechanism for cross-session
 * damage.
 *
 * Nothing was wrong with the gate's rules. It simply had no notion of WHO, and a rule with no subject applies to
 * everyone.
 *
 * ## The identity was already on disk, unread
 *
 * The journal is append-only and typed, and the owner's fleet driver was already writing `launched` and
 * `resumed` entries carrying a `sessionId`, a `pid` and a worktree path. This build could not decode either kind
 * — see {@link ./ledger} — so the one fact needed to scope the gate was sitting in the file being read. No new
 * side-channel and no new state file: {@link ./ledger} types those entries, and this reads them.
 *
 * ## What "not mine" licenses, and what it forbids
 *
 * A run owned elsewhere is REPORTED, never acted on. The gate does not block for it and offers no exit against
 * it, because `finish`, `abandon` and `ask` all write to the other session's journal and `resume` puts a second
 * agent on its branch. Reporting goes through the read-only brief instead of the interrupt: the interrupt is
 * the channel that was being abused, and "someone else is driving this" is not something the reading session can
 * act on.
 *
 * ## Unidentifiable counts as NOT mine
 *
 * When the current session cannot be named, ownership of a run that HAS a recorded writer is
 * {@link RunOwnership} `elsewhere`, not `mine`. The gate may only act on state it verified, and "I might be the
 * owner" is not verification. The cost of erring this way is a missed interrupt; the cost of erring the other
 * way is the cross-session damage above.
 *
 * Pure: the caller supplies the events, the payload and the environment.
 */

import { isRecord } from "#lib/parsers.js";
import { detectSupervisorSession, type SupervisorHost } from "../supervisor/session.js";
import { currentCycle, type RunEvent, type RunPhase } from "./ledger.js";
import { releaseWhyOf } from "./runRelease.js";
import { nextWriter } from "./runWriterStep.js";

/**
 * What this machine can prove about the session that currently holds a run.
 *
 * Declared here rather than in the CLI layer because the pure renderer below consumes it: the guidance a
 * foreign reader gets depends on whether the holder can still act. `unknown` is an explicit measurement
 * verdict, not a failure — see {@link ./writerLiveness} for how each host kind is classified.
 */
export type WriterLiveness =
  { readonly kind: "live" } | { readonly kind: "dead" } | { readonly kind: "unknown"; readonly why: string };

/** The session a journal says is driving a run, with enough detail to point a reader at it. */
export interface RunWriter {
  readonly sessionId: string;
  /** The visible host that made the claim, when the journal version recorded it. */
  readonly host?: SupervisorHost;
  /** The worktree the driver launched into, when it recorded one. */
  readonly worktree: string | undefined;
  /** The driving process, when it recorded one. */
  readonly pid: number | undefined;
  /** When the claim was made, so a reader can judge how old it is. */
  readonly atIso: string;
}

/**
 * Whose run this is, from the point of view of one session.
 *
 * `unowned` is not a failure — it is every run started before identity was recorded, and every run started by
 * hand outside a session. Those keep the gate's original behaviour, because there is no neighbour to damage.
 *
 * `released` is NOT `unowned`, even though both currently have no writer. A released run had a real, live owner
 * who made a deliberate, informed handoff — exactly the case `handover claim` exists to formalise — and treating
 * it as freely actionable let an unrelated session ask a fabricated question under another workstream's name
 * (a confirmed incident). It is the same protection {@link RunOwnership} `elsewhere` already gives a
 * run someone else is actively driving, so `mayMutate` refuses both alike. One release is narrower: a seat that
 * PARKED released its run, and `finish` alone may act on it while that park stands (`./parkedFinish.ts`).
 */
export type RunOwnership =
  | { readonly kind: "unowned" }
  | { readonly kind: "mine"; readonly writer: RunWriter }
  | {
      readonly kind: "elsewhere";
      readonly writer: RunWriter;
      /** This session's id, or `undefined` when it could not be determined — which is itself a reason to stand off. */
      readonly thisSession: string | undefined;
    }
  | {
      readonly kind: "released";
      /** The session that released it, so a reader knows who to ask and where the work last lived. */
      readonly writer: RunWriter;
      /** When the release happened. */
      readonly releasedAtIso: string;
      /** The reason the releasing session gave. */
      readonly why: string;
    };

/**
 * This visible Claude Code or Codex session's id, read from the environment.
 *
 * @param env the environment to read
 * @returns the session id, or `undefined` when the variable is absent or blank
 */
export function currentSessionId({ env }: { env: NodeJS.ProcessEnv }): string | undefined {
  const detection = detectSupervisorSession({ env });
  return detection.kind === "active" ? detection.session.id : undefined;
}

/**
 * EVERY id the environment names for this session — one, two, or none.
 *
 * {@link currentSessionId} answers `undefined` for an AMBIGUOUS environment, where a Claude id and a Codex id
 * are both set, because no single id is the answer. That is right for identifying a session and wrong for
 * protecting one: a guard asking "is this writer me?" over `undefined` protects nobody.
 *
 * MEASURED by an adversarial review pass, reproduced against the shipped CLI: a session holding
 * its own run, with `CLAUDE_CODE_SESSION_ID` set and a stale `CODEX_THREAD_ID` also in its environment, ran
 * `handover settle` on its own row and appended an `orphaned` ending naming ITSELF as the dead writer. Both
 * ids are candidates for "me", so a self-guard must hold all of them.
 *
 * @param env the environment to read
 * @returns every session id present, in no significant order — empty when the environment names none
 */
export function currentSessionIds({ env }: { env: NodeJS.ProcessEnv }): readonly string[] {
  const detection = detectSupervisorSession({ env });
  if (detection.kind === "active") {
    return [detection.session.id];
  }
  return detection.kind === "ambiguous" ? detection.sessions.map((session) => session.id) : [];
}

/**
 * The session id a hook payload declares.
 *
 * Preferred over the environment for a hook, because the harness states it in the payload it hands over — that
 * is the authoritative answer for the session actually being gated, whereas an env var is whatever the wrapper
 * process inherited.
 *
 * @param payload the parsed hook payload
 * @returns the session id, or `undefined` when the payload does not carry a usable one
 */
export function sessionIdFromPayload({ payload }: { payload: unknown }): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload["session_id"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** What a released run's fold remembers about the release that emptied `writer`, for the report. */
interface ReleaseRecord {
  readonly writer: RunWriter;
  readonly atIso: string;
  readonly why: string;
}

/** The current writer, and — separately — the release that most recently emptied it, if nothing has superseded it. */
interface OwnershipFold {
  readonly writer: RunWriter | undefined;
  readonly release: ReleaseRecord | undefined;
}

/**
 * The session a run's journal last named as its writer, and whether it currently sits released rather than
 * merely unclaimed.
 *
 * The LAST claim in the current cycle wins, because a driver that re-launches a run onto a fresh session writes
 * a new `resumed` entry and the earlier session is gone. Reading the first would name a dead session as owner
 * and hand the gate a stranger for every live one. `release` is folded alongside `writer` rather than in a
 * second pass over the same events, so the two can never read a different cycle.
 *
 * @param events the journal's events, in order — sliced to the current cycle here
 * @returns the writer (`undefined` once a release clears it or nothing ever named one) and the release record,
 *   present only when the last identity-relevant event was a self-release nothing since has superseded
 */
function foldOwnership({ events }: { events: readonly RunEvent[] }): OwnershipFold {
  let writer: RunWriter | undefined;
  let release: ReleaseRecord | undefined;
  for (const event of currentCycle({ events })) {
    if (event.kind === "launched" || event.kind === "resumed" || event.kind === "claimed") {
      writer = nextWriter({ event, writer });
      release = undefined;
      continue;
    }
    const why = releaseWhyOf({ event, holder: writer?.sessionId });
    if (why !== undefined && writer !== undefined) {
      release = { atIso: event.atIso, why, writer };
    }
    writer = nextWriter({ event, writer });
  }
  return { release, writer };
}

/**
 * The session a run's journal last named as its writer.
 *
 * @param events the journal's events, in order — sliced to the current cycle here
 * @returns the writer, or `undefined` when no cycle entry names one, INCLUDING when the last entry was that
 *   writer's own release — {@link runOwnership} is what turns that case into `released` rather than `unowned`
 */
export function writerOf({ events }: { events: readonly RunEvent[] }): RunWriter | undefined {
  return foldOwnership({ events }).writer;
}

/**
 * Whether a run belongs to this session.
 *
 * @param events the journal's events, in order
 * @param sessionId this session's id, or `undefined` when it could not be determined
 * @returns the ownership verdict
 */
export function runOwnership({
  events,
  sessionId,
}: {
  events: readonly RunEvent[];
  sessionId: string | undefined;
}): RunOwnership {
  const { release, writer } = foldOwnership({ events });
  if (writer === undefined) {
    return release === undefined
      ? { kind: "unowned" }
      : { kind: "released", releasedAtIso: release.atIso, why: release.why, writer: release.writer };
  }
  if (sessionId !== undefined && sessionId === writer.sessionId) {
    return { kind: "mine", writer };
  }
  return { kind: "elsewhere", thisSession: sessionId, writer };
}

/**
 * Whether this session may be offered an exit that WRITES to a run.
 *
 * `finish`, `abandon` and `ask` all append to the journal, and `resume` puts a second agent on the branch. Every
 * one of those is a mutation of whatever session holds the run, so the answer is no for `elsewhere` — and for
 * `released`, which is a run that HAD a real owner and has not been explicitly claimed since, not a run that
 * never had one.
 *
 * @param ownership the verdict from {@link runOwnership}
 * @returns true only when acting on the run cannot disturb another session's handoff
 */
export function mayMutate({ ownership }: { ownership: RunOwnership }): boolean {
  return ownership.kind !== "elsewhere" && ownership.kind !== "released";
}

/**
 * A flag value spelled so a pasted command parses it as ONE literal argument.
 *
 * A path with a space rendered bare splits into a wrong flag value plus a stray positional — and lifecycle
 * parsing permits extra positionals, so the pasted command silently reads a different board (an r3 review
 * pass's counterexample). SINGLE quotes, because they are the only POSIX quoting that is total: an r1 pass
 * showed `$` and backticks stay ACTIVE inside double quotes, so a double-quoted `/tmp/$USER/…` expands on
 * paste and routes to a different board. Plain path-shaped values stay unquoted so default-path suggestion
 * text is unchanged.
 *
 * @param value the raw flag value
 * @returns the value, single-quoted (with embedded single quotes escaped) unless it is a plain path
 */
export function shellValue({ value }: { value: string }): string {
  // `~` is NOT in the safe alphabet: a shell that never expanded it on the way in (the CLI received a literal
  // tilde path) would expand it on paste, routing the recommendation to a different board (r3).
  return /^[A-Za-z0-9/._-]+$/.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** The no-command tail for a board that could not be fully read — no doc-dependent verb may be named over one. */
const BOARD_UNREADABLE =
  "The board could not be fully read, so whether a doc claims this slug is unknown and no takeover door can " +
  "be named — fix the unreadable board doc(s) before acting.";

/**
 * The line for a CLOSED cycle: nothing to take over, and claim's phase guard refuses one anyway — so any
 * transfer instruction would recommend a command that always fails (an r3 pass reached this cell through
 * finish's foreign refusal). `handover start` is the one entry verb for a closed doc-backed run, and it is
 * recommended as the DIAGNOSTIC it is: start states its own refusal (a blocker, a shipped-looking doc) rather
 * than this line pretending to know the board's verdict in advance.
 */
function closedCycleLine({
  slug,
  sessionId,
  flagSuffix,
}: {
  slug: string;
  sessionId: string;
  flagSuffix: string;
}): string {
  const slugArg = shellValue({ value: slug });
  return (
    `⊘ The run "${slug}" last named session ${sessionId}, but its current cycle is CLOSED — there is nothing ` +
    `to take over. \`handover start ${slugArg}${flagSuffix}\` opens a fresh cycle if the doc has remaining ` +
    "work, and states its own refusal if the board blocks it."
  );
}

/**
 * The sentence naming the session that holds a run, or that released it, for the read-only brief.
 *
 * States the WORKTREE first when there is one, because that is the actionable half — a session id identifies the
 * run's holder but tells a reader nothing about where to look, and the collision this prevents is two agents in
 * two checkouts of one branch.
 *
 * The guidance tail depends on two facts beyond ownership, both supplied by the caller because this module is
 * pure: whether the holder is still ALIVE, and whether a board doc still CLAIMS the slug. Both are load-bearing —
 * a dead holder cannot run `handover release`, and `handover claim` refuses a slug no doc owns, so a line that
 * ignores either recommends an impossible command. That exact misdirection is what forced hand-appended journal
 * events, with the working front door (`claim` on a provably-dead holder) sitting unmentioned.
 *
 * @param slug the run's slug
 * @param ownership the verdict from {@link runOwnership}
 * @param liveness what the caller proved about the current writer; `undefined` is treated as unknown, never dead
 * @param docClaim what the VERB SURFACE would conclude about docs claiming this slug — "one" when a caller's
 *   own resolution already found exactly one readable doc (so a recommended claim resolves identically),
 *   "none" when the orphan path proved the board has no claimant, "duplicate" when more than one readable doc
 *   claims it, and "unknown" when a partial or failed board scan makes every count a guess — no doc-dependent
 *   command may be recommended over "unknown"
 * @param journalAmbiguous whether the journal carries undecodable lines — every transfer verb refuses such a
 *   journal, so no transfer may be recommended over one
 * @param phase the run's phase as of the SAME read ownership came from — claim's phase guard refuses a closed
 *   cycle, so no takeover may be recommended over one
 * @param flagSuffix the caller's own non-default routing flags (e.g. \` --home /x\` or \` --dir /y\`),
 *   embedded in every recommended invocation so a pasted command reads the same board the caller did —
 *   empty when the caller runs on the defaults
 * @param readerIdentified whether the reading session could identify itself — every takeover verb requires an
 *   identified session, so an unidentified reader's recommendations carry the run-it-elsewhere caveat (the
 *   released ownership variant carries no identity of its own, so the caller must say)
 * @returns one line, or `undefined` when this session may act on the run and so has nothing to report
 */
export function foreignRunLine({
  slug,
  ownership,
  liveness,
  docClaim,
  journalAmbiguous,
  phase,
  flagSuffix,
  readerIdentified,
}: {
  slug: string;
  ownership: RunOwnership;
  liveness: WriterLiveness | undefined;
  docClaim: "one" | "none" | "duplicate" | "unknown";
  journalAmbiguous: boolean;
  phase: RunPhase;
  flagSuffix: string;
  readerIdentified: boolean;
}): string | undefined {
  if (ownership.kind !== "elsewhere" && ownership.kind !== "released") {
    return undefined;
  }
  if (journalAmbiguous) {
    // Checked before EITHER rendering branch — the r3 review found the released line bypassing this guard and
    // recommending a claim over a journal claim refuses. Undecodable lines make ownership itself a guess, and
    // release, claim and abandon all refuse such a journal, so no transfer may be recommended over one.
    return (
      `⊘ The run "${slug}"'s journal has undecodable line(s), so ownership is AMBIGUOUS (it last named session ` +
      `${ownership.writer.sessionId}) and every transfer verb will refuse it. Resume is read-only; do NOT ` +
      `finish, abandon, ask, answer or amend it. Inspect the journal file for the run "${slug}" before acting.`
    );
  }
  if (phase === "closed") {
    return closedCycleLine({ flagSuffix, sessionId: ownership.writer.sessionId, slug });
  }
  if (docClaim === "duplicate") {
    // A slug claimed by more than one doc makes every lifecycle verb refuse it outright, so neither the claim
    // nor the orphan-abandon recommendation can succeed (the r1 review's counterexample: duplicate read as
    // "no doc" and sent to an orphan abandon the board's own slug check refuses). State the defect instead.
    return (
      `⊘ The run "${slug}" is unresolvable: MORE THAN ONE doc on the board claims this slug, and every ` +
      `lifecycle verb refuses a duplicate slug. Resume is read-only; do NOT finish, abandon, ask, answer or ` +
      `amend it. Fix the board so exactly one doc claims "${slug}" before acting.`
    );
  }
  if (ownership.kind === "released") {
    return releasedLine({ docClaim, flagSuffix, ownership, readerIdentified, slug });
  }
  return heldElsewhereLine({ docClaim, flagSuffix, liveness, ownership, slug });
}

/**
 * The line for a deliberately released, unclaimed run. A released ORPHAN cannot be claimed — claim needs a
 * board doc — but the orphan abandon explicitly waives released ownership, so that is the door to point at
 * (an r3 pass found the one-doc line being recommended for the zero-doc state). The one-doc line stays
 * byte-for-byte what it always was, and an unreadable board names no door at all.
 */
function releasedLine({
  slug,
  ownership,
  docClaim,
  flagSuffix,
  readerIdentified,
}: {
  slug: string;
  ownership: Extract<RunOwnership, { kind: "released" }>;
  docClaim: "one" | "none" | "unknown";
  flagSuffix: string;
  readerIdentified: boolean;
}): string {
  const slugArg = shellValue({ value: slug });
  // Every takeover verb needs an identified session; the released variant carries no reader identity of its
  // own, so the caller supplies it and an unidentified reader gets the run-it-elsewhere caveat (r3).
  const identity = readerIdentified ? "" : " Run it from an identified visible session.";
  const released =
    `⊘ The run "${slug}" was released by session ${ownership.writer.sessionId} at ${ownership.releasedAtIso} ` +
    `("${ownership.why}") and has not been claimed since. Resume is read-only; do NOT finish, abandon, ask, ` +
    "answer or amend it. ";
  if (docClaim === "unknown") {
    return `${released}${BOARD_UNREADABLE}`;
  }
  // The bare historical claim survives only on the default path — with non-default routing in play it must
  // be spelled out or the caller's --home/--dir is silently dropped (r1).
  if (docClaim === "one") {
    return flagSuffix === "" && readerIdentified
      ? `${released}\`handover claim\` here to take it over.`
      : `${released}\`handover claim ${slugArg}${flagSuffix} --why "…"\` here to take it over.${identity}`;
  }
  return (
    `${released}No doc on the board claims the slug — close the orphaned run with ` +
    `\`handover abandon ${slugArg}${flagSuffix} --why "…"\`.${identity}`
  );
}

/** The stand-off line for a run another session actively holds, routed by the holder's liveness. */
function heldElsewhereLine({
  slug,
  ownership,
  liveness,
  docClaim,
  flagSuffix,
}: {
  slug: string;
  ownership: Extract<RunOwnership, { kind: "elsewhere" }>;
  liveness: WriterLiveness | undefined;
  docClaim: "one" | "none" | "unknown";
  flagSuffix: string;
}): string {
  const slugArg = shellValue({ value: slug });
  const where = ownership.writer.worktree === undefined ? "" : ` in ${ownership.writer.worktree}`;
  const pid = ownership.writer.pid === undefined ? "" : `, pid ${String(ownership.writer.pid)}`;
  const head = `⊘ The run "${slug}" is held by session ${ownership.writer.sessionId}${where}${pid} since ${ownership.writer.atIso}`;
  const standOff = "Resume is read-only; do NOT finish, abandon, ask, answer or amend it.";
  if (liveness?.kind === "dead") {
    // The dead-holder guidance wins over the identity caveat, and the ordering is the r3 finding: for a dead
    // holder, "release it in the owning session" is impossible no matter who is asking, so an unidentified
    // reader gets the working command plus where it must run from — never the impossible one.
    const identity =
      ownership.thisSession === undefined
        ? " This session could not identify itself, so run it from an identified visible session."
        : "";
    if (docClaim === "unknown") {
      return `${head} — that session is DEAD. ${standOff} ${BOARD_UNREADABLE}${identity}`;
    }
    return docClaim === "one"
      ? `${head} — that session is DEAD. ${standOff} Take the run over with ` +
          `\`handover claim ${slugArg}${flagSuffix} --why "…"\` (a provably dead holder needs no --force).${identity}`
      : `${head} — that session is DEAD and no doc on the board claims the slug. ${standOff} ` +
          `Close the orphaned run with \`handover abandon ${slugArg}${flagSuffix} --why "…"\`.${identity}`;
  }
  if (ownership.thisSession === undefined) {
    // The tail is the same condition-aware one an identified reader gets — an r3 pass found this branch
    // returning unconditional release-then-claim for an unknown-liveness orphan, where claim cannot succeed.
    // Spelled-out invocations, because this cell is CHANGED text (unlike the byte-frozen identified live
    // line); the trailing note covers every cross-product: takeovers need a session with identity.
    return (
      `${head} — this session could not identify itself, so it cannot claim the run. ${standOff} ` +
      `${transferTail({ docClaim, flagSuffix, liveness, slug, spellOut: true })} Any takeover command above must run ` +
      "from an identified visible session."
    );
  }
  return `${head} — another session is driving it. ${standOff} ${transferTail({ docClaim, flagSuffix, liveness, slug, spellOut: false })}`;
}

/** The transfer instruction for a holder not proven dead — the only branch where a release is possible. */
function transferTail({
  slug,
  liveness,
  docClaim,
  spellOut,
  flagSuffix,
}: {
  slug: string;
  liveness: WriterLiveness | undefined;
  docClaim: "one" | "none" | "unknown";
  /** Full invocations (slug + required flags) — the historical bare-verb live line stays byte-frozen otherwise. */
  spellOut: boolean;
  flagSuffix: string;
}): string {
  const slugArg = shellValue({ value: slug });
  if (docClaim === "unknown") {
    // NO command at all: even release resolves the board doc first, so nothing is guaranteed to run over a
    // partially-readable board (an r3 pass refuted an earlier draft's "release is doc-independent" claim).
    return BOARD_UNREADABLE;
  }
  if (liveness?.kind === "live") {
    // A holder PROVEN live can act, but WHAT it can run depends on the doc: release resolves the board doc
    // first, so over an orphan the only working verb anywhere is the owning session's own orphan abandon —
    // an r3 pass refuted an earlier draft's release-then-abandon sequence for exactly that cell.
    if (docClaim === "one") {
      // Spelled out whenever the reader lacks identity OR non-default routing is in play — a bare-verb line
      // would silently drop the caller's --home/--dir (r1). The historical bare text survives only on the
      // default path, where it is byte-frozen.
      return spellOut || flagSuffix !== ""
        ? `Transfer it with \`handover release ${slugArg}${flagSuffix} --why "…"\` in the owning session, then ` +
            `\`handover claim ${slugArg}${flagSuffix} --why "…"\` here.`
        : "Transfer it with `handover release` in the owning session, then `handover claim` here.";
    }
    return (
      "No doc on the board claims the slug, so no transfer verb can act from here — the owning session " +
      `itself can close its orphaned run with \`handover abandon ${slugArg}${flagSuffix} --why "…"\` (the ` +
      "orphan path acts for a session's own runs)."
    );
  }
  // Unknown OR unmeasured liveness: every recommendation is framed on the condition under which it succeeds —
  // release assumes the holder can still act, and the escape names the gone case. `undefined` lands here too,
  // because the contract above says an unsupplied verdict is treated as unknown, never as live (r3 found an
  // earlier draft's fall-through rendering unconditional guidance for exactly that cell).
  const why = liveness?.kind === "unknown" ? ` (${liveness.why})` : "";
  if (docClaim === "one") {
    // Full invocations, not bare verb names: an r3 pass pasted the bare forms and hit usage refusals, which
    // is exactly the recommend-a-failing-command class this renderer exists to remove.
    return (
      `If the owning session is still alive: \`handover release ${slugArg}${flagSuffix} --why "…"\` there, ` +
      `then \`handover claim ${slugArg}${flagSuffix} --why "…"\` here. If you know it is gone${why}: ` +
      `\`handover claim ${slugArg}${flagSuffix} --force --why "…"\`.`
    );
  }
  return (
    "No doc on the board claims the slug, so no transfer verb can act from here. If the owning session is " +
    `still alive, it can close its own orphaned run there with \`handover abandon ${slugArg}${flagSuffix} --why "…"\`. ` +
    `If it is gone${why}, no typed takeover exists for this case yet — that limitation is recorded, not an ` +
    "accident."
  );
}
