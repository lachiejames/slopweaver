/**
 * One admitted incident channel, registered: checked against the row docs that already name it, probed, claimed,
 * written to the board, and recorded in the seen ledger — or skipped with the reason.
 *
 * ## The outcome is the registration's own receipt
 *
 * `deps.register` reports whether THIS call created the row — which only the invocation that created the doc can
 * say, from inside the board lock — so two sweeps racing on one channel produce one `created` and one
 * `already-existed`, never two rows and never a false failure. The channel's claim (`./claim.ts`) is taken before
 * the doc, so a sweep that died between the two refuses rather than writing a second row.
 *
 * Every effect is injected; nothing here reads a clock, a token or a file except through `deps`.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { Organisation } from "../organisation/core.js";

import type { IncidentChannel } from "./channel.js";
import { CLAIM_STALE_MS, type IncidentClaim } from "./claim.js";
import type { IncidentClaimError, IncidentLedgerError } from "./errors.js";
import { askNamesChannel, incidentAskText, incidentRegisterArgv, incidentRowSlug } from "./row.js";
import type { SeenOutcome, SeenRow } from "./seen.js";

/** What one readability probe found: readable by a named principal on a named workspace, or why not. */
export type IncidentReadProbe =
  | { readonly readable: true; readonly principal: "user" | "bot"; readonly workspaceUrl: string }
  | { readonly readable: false; readonly why: string };

/** What one registration attempt reported: its exit code, and whether this call's receipt said it created the row. */
export interface IncidentRegistration {
  readonly code: number;
  readonly created: boolean;
}

/** Every effect detection performs. */
export interface IncidentDetectDeps {
  /** The ids the seen ledger records. */
  readonly seen: () => Result<ReadonlySet<string>, IncidentLedgerError>;
  /** Record a channel whose board row exists. */
  readonly record: (args: { row: SeenRow }) => Result<string, IncidentLedgerError>;
  /** Read one message of the channel's history with the token `slack read-thread` would resolve. */
  readonly probe: (args: { channelId: string }) => Promise<IncidentReadProbe>;
  /** The declared main checkout the seat's worktree is cut from, or why there is none. */
  readonly checkout: () => Result<string>;
  /** The organisation the store holds (`../organisation/read.ts`), whose Slack hosts place the row, or why not. */
  readonly organisation: () => Promise<Result<Organisation>>;
  /** Write the board row `slug` from a whole process argv; `created` is read off THIS call's own receipt. */
  readonly register: (args: { argv: readonly string[]; slug: string }) => Promise<IncidentRegistration>;
  /**
   * The channel's incident row doc, live and archived — named by the channel id alone, which a rename cannot
   * change; or why one could not be read, which refuses rather than reading as none.
   */
  readonly rowDocs: (args: { channelId: string }) => Result<readonly IncidentRowDoc[]>;
  /** Take the channel's durable claim exclusively, before any row doc is written (`./claim.ts`). */
  readonly claim: (args: { channelId: string }) => Result<IncidentClaim, IncidentClaimError>;
  /**
   * Give back a claim this sweep took and then could not register under; false when it was held long enough that
   * another sweep may be taking it over, or one already restamped it, which leaves it in place.
   */
  readonly release: (args: { path: string }) => Result<boolean, IncidentClaimError>;
  /** Every channel id with a claim; such a channel stays a candidate past the live window until its row exists. */
  readonly claimed: () => Result<ReadonlySet<string>, IncidentClaimError>;
  /** Restamp a held claim a dead sweep left, in place; true when this sweep now holds it, false when it is live. */
  readonly reclaim: (args: { path: string }) => Result<boolean, IncidentClaimError>;
}

/** One incident row doc on the board or in its archive. */
export interface IncidentRowDoc {
  readonly slug: string;
  readonly text: string;
}

/** A channel this sweep registered — or found already registered — and how. */
export interface IncidentRegistered {
  readonly channelId: string;
  readonly name: string;
  readonly slug: string;
  readonly outcome: SeenOutcome;
  /** Set when the row exists and the ledger append failed — the next sweep reads it as already existing. */
  readonly ledger?: string;
}

/** A candidate channel this sweep did not register, and why. */
export interface IncidentSkipped {
  readonly channelId: string;
  readonly name: string;
  readonly why: string;
}

/** What became of one candidate. */
type CandidateOutcome = { registered: IncidentRegistered } | { skipped: IncidentSkipped };

/** One candidate's skip, carrying its channel. */
type SkipOf = (args: { why: string }) => { skipped: IncidentSkipped };

/**
 * The outcome one registration attempt reached.
 *
 * @param registration what the call reported
 * @param existing the slug's row doc text after the call, when one exists
 * @param channelId the channel being registered
 * @returns the outcome, or `undefined` when no row exists for this channel
 */
export function registrationOutcome({
  registration,
  existing,
  channelId,
}: {
  registration: IncidentRegistration;
  existing: string | undefined;
  channelId: string;
}): SeenOutcome | undefined {
  if (registration.created) {
    return registration.code === 0 ? "created" : "created-incomplete";
  }
  if (existing !== undefined && askNamesChannel({ ask: existing, channelId })) {
    return "already-existed";
  }
  return undefined;
}

/**
 * Claim, probe, register and record one admitted candidate.
 *
 * The claim comes FIRST, before the probe's network await, so the only work before the first durable write is
 * synchronous: a sweep killed later leaves a claim that keeps the channel a candidate past the window. One killed before it is no different from a sweep that never ran before the window closed.
 *
 * @param channel the candidate
 * @param checkout the declared main checkout
 * @param home the state home the row lands in
 * @param nowIso the sweep's instant
 * @param organisation the organisation, read once a sweep, whose Slack hosts place the row
 * @returns what happened to it
 */
export async function registerOne({
  channel,
  checkout,
  home,
  nowIso,
  organisation,
  deps,
}: {
  channel: IncidentChannel;
  checkout: string;
  home: string;
  nowIso: string;
  organisation: Organisation;
  deps: IncidentDetectDeps;
}): Promise<CandidateOutcome> {
  const skip: SkipOf = ({ why }) => ({ skipped: { channelId: channel.id, name: channel.name, why } });
  const settled = existingRowOutcome({ channel, deps, nowIso, skip });
  if (settled !== undefined) {
    return settled;
  }
  const claim = claimOrTakeOver({ channelId: channel.id, deps });
  if (claim.isErr()) {
    return skip({
      why: `the channel's claim could not be taken, so nothing was registered: ${claim.error.message}`,
    });
  }
  if (claim.value.state === "held") {
    return heldClaimOutcome({ channel, claimPath: claim.value.path, deps, nowIso, skip });
  }
  const probe = await deps.probe({ channelId: channel.id });
  if (!probe.readable) {
    return skip({ why: `${probe.why}${givenBack({ claim: claim.value, deps })}` });
  }
  const permalink = `${probe.workspaceUrl.replace(/\/+$/u, "")}/archives/${channel.id}`;
  if (!askNamesChannel({ ask: incidentAskText({ channel, permalink }), channelId: channel.id })) {
    // The row is only ever recognised by its ask, so one a later sweep could not recognise is never written.
    return skip({
      why:
        `the probe named the workspace ${probe.workspaceUrl}, which is not a Slack workspace link, so the row's ask ` +
        `could not be recognised again${givenBack({ claim: claim.value, deps })}`,
    });
  }
  return registerClaimed({
    channel,
    checkout,
    claim: claim.value,
    deps,
    home,
    nowIso,
    organisation,
    permalink,
    skip,
  });
}

/**
 * Give back a claim no row came of, so the next sweep tries the channel afresh — unless this sweep took it over from a
 * dead one. A taken-over claim may be all that keeps a channel past the 48-hour window a candidate, so releasing it on
 * a failure that could be transient would drop that channel for good. It stays, restamped, and a
 * sweep retries the channel once it is stale again.
 *
 * @param claim the claim this sweep holds
 * @param deps the effects
 * @returns the suffix the skip carries: empty once released, else what became of the claim
 */
function givenBack({ claim, deps }: { claim: IncidentClaim; deps: IncidentDetectDeps }): string {
  if (claim.state === "reclaimed") {
    return (
      `; the claim at ${claim.path} was taken over from a dead sweep and stays, so the channel stays a candidate ` +
      `and a sweep retries it once the claim is ${String(CLAIM_STALE_MS / 60_000)} minutes old`
    );
  }
  const released = deps.release({ path: claim.path });
  if (released.isErr()) {
    return `; the claim stays: ${released.error.message}`;
  }
  if (!released.value) {
    return (
      `; the claim at ${claim.path} stays, since this sweep held it long enough that another may have taken it ` +
      `over, and a sweep retries the channel once it is ${String(CLAIM_STALE_MS / 60_000)} minutes old`
    );
  }
  return "";
}

/**
 * What the row docs under the channel's slug already settle, before anything is probed or claimed: its own row is
 * `already-existed`; a doc there naming a DIFFERENT channel occupies the one path this channel's row can be written
 * at, which only a hand-made doc can do, and is refused by name rather than retried as an opaque register failure
 * every sweep; docs that will not read refuse.
 *
 * @param channel the candidate
 * @param nowIso the sweep's instant
 * @param deps the effects
 * @param skip the candidate's skip
 * @returns the settled outcome, or `undefined` when no doc is there and registration should go ahead
 */
function existingRowOutcome({
  channel,
  nowIso,
  deps,
  skip,
}: {
  channel: IncidentChannel;
  nowIso: string;
  deps: IncidentDetectDeps;
  skip: SkipOf;
}): CandidateOutcome | undefined {
  const docs = deps.rowDocs({ channelId: channel.id });
  if (docs.isErr()) {
    return skip({
      why: `the board's row docs would not read, so a second row cannot be ruled out: ${docs.error.join("; ")}`,
    });
  }
  const own = docs.value.find((doc) => askNamesChannel({ ask: doc.text, channelId: channel.id }));
  // An occupant is refused even beside the channel's own row, live or archived, so one never hides behind the other.
  const occupant = docs.value.find((doc) => !askNamesChannel({ ask: doc.text, channelId: channel.id }));
  if (occupant !== undefined && own !== undefined) {
    return skip({
      why:
        `a row doc at ${occupant.slug} beside this channel's own row names a different channel; move that doc ` +
        "aside and the next sweep records the row",
    });
  }
  if (occupant !== undefined) {
    return skip({
      why:
        `a row doc already at ${occupant.slug} names a different channel, so this channel's row cannot be written ` +
        "under its id; move that doc aside and the next sweep registers it",
    });
  }
  if (own !== undefined) {
    return { registered: recordOutcome({ channel, deps, nowIso, outcome: "already-existed", slug: own.slug }) };
  }
  return undefined;
}

/**
 * Take the channel's claim — or, when one is held and no row doc names the channel, take over a dead sweep's stale
 * one, `reclaimed`. A young held claim, or one a row doc already answers for, stays `held`.
 *
 * @param channelId the channel
 * @param deps the effects
 * @returns the claim this sweep holds or found held, or why it would not write or reclaim
 */
function claimOrTakeOver({
  channelId,
  deps,
}: {
  channelId: string;
  deps: IncidentDetectDeps;
}): Result<IncidentClaim, IncidentClaimError> {
  const first = deps.claim({ channelId });
  if (first.isErr() || first.value.state === "claimed") {
    return first;
  }
  const named = rowNamingChannel({ channelId, deps });
  if (named.isErr() || named.value !== undefined) {
    return first;
  }
  const reclaimed = deps.reclaim({ path: first.value.path });
  if (reclaimed.isErr()) {
    return err(reclaimed.error);
  }
  return ok(reclaimed.value ? { path: first.value.path, state: "reclaimed" } : first.value);
}

/**
 * A claim another sweep holds: the row that sweep wrote, when a doc names the channel, else a refusal — the holder
 * is mid-registration, or died after claiming too recently to take over, and either way a second row must not happen.
 *
 * @param channel the candidate
 * @param claimPath the claim that was already there
 * @param nowIso the sweep's instant
 * @param deps the effects
 * @param skip the candidate's skip
 * @returns already-existed under the holder's slug, or the skip naming the claim to remove if it persists
 */
function heldClaimOutcome({
  channel,
  claimPath,
  nowIso,
  deps,
  skip,
}: {
  channel: IncidentChannel;
  claimPath: string;
  nowIso: string;
  deps: IncidentDetectDeps;
  skip: SkipOf;
}): CandidateOutcome {
  const held = rowNamingChannel({ channelId: channel.id, deps });
  if (held.isOk() && held.value !== undefined) {
    return {
      registered: recordOutcome({ channel, deps, nowIso, outcome: "already-existed", slug: held.value.slug }),
    };
  }
  return skip({
    why:
      `${claimPath} claims this channel and no row doc names it yet — a sweep mid-registration, or one that died ` +
      `after claiming; a sweep takes it over once it is ${String(CLAIM_STALE_MS / 60_000)} minutes old`,
  });
}

/**
 * Register a channel this sweep holds the claim for, giving the claim back when no row came of it.
 *
 * @param channel the candidate
 * @param checkout the declared main checkout
 * @param claim the claim this sweep took or took over
 * @param home the state home the row lands in
 * @param nowIso the sweep's instant
 * @param permalink the channel's own link
 * @param organisation the organisation whose Slack hosts place the row
 * @param deps the effects
 * @param skip the candidate's skip
 * @returns what happened to it
 */
async function registerClaimed({
  channel,
  checkout,
  claim,
  home,
  nowIso,
  organisation,
  permalink,
  deps,
  skip,
}: {
  channel: IncidentChannel;
  checkout: string;
  claim: IncidentClaim;
  home: string;
  nowIso: string;
  organisation: Organisation;
  permalink: string;
  deps: IncidentDetectDeps;
  skip: SkipOf;
}): Promise<CandidateOutcome> {
  const slug = incidentRowSlug({ channel });
  const registration = await deps.register({
    argv: incidentRegisterArgv({ channel, checkout, home, nowIso, organisation, permalink }),
    slug,
  });
  const after = rowNamingChannel({ channelId: channel.id, deps });
  if (after.isErr() && !registration.created) {
    // Whether a row came of it is unknown, so the claim stays: releasing it could let a second row in.
    return skip({
      why:
        `register reported no row (exit ${String(registration.code)}) and the row docs would not read to confirm, ` +
        `so the claim stays at ${claim.path}: ${after.error.join("; ")}`,
    });
  }
  const found = after.isOk() ? after.value : undefined;
  const outcome = registrationOutcome({ channelId: channel.id, existing: found?.text, registration });
  if (outcome === undefined) {
    const kept = givenBack({ claim, deps });
    return skip({ why: `register refused (exit ${String(registration.code)}); its reason is on stderr${kept}` });
  }
  const recordedSlug = outcome === "already-existed" && found !== undefined ? found.slug : slug;
  return { registered: recordOutcome({ channel, deps, nowIso, outcome, slug: recordedSlug }) };
}

/**
 * The row doc — live, or archived once its investigation settled — that already names this channel. Checked BEFORE
 * registering, because an archived row is one the board's exclusive create of a LIVE doc cannot see; two sweeps
 * racing on a live row meet at that create, since the slug is the id.
 *
 * @param channelId the channel
 * @param deps the effects
 * @returns the doc naming it, `undefined` when none does, or why the docs would not read
 */
function rowNamingChannel({
  channelId,
  deps,
}: {
  channelId: string;
  deps: IncidentDetectDeps;
}): Result<IncidentRowDoc | undefined> {
  return deps.rowDocs({ channelId }).map((docs) => docs.find((doc) => askNamesChannel({ ask: doc.text, channelId })));
}

/**
 * Record a channel whose row exists in the seen ledger, carrying the append's failure rather than dropping it.
 *
 * @param channel the channel
 * @param slug its row
 * @param outcome how the row came to exist
 * @param nowIso the sweep's instant
 * @param deps the effects
 * @returns the registered entry, with `ledger` set when the append failed
 */
function recordOutcome({
  channel,
  slug,
  outcome,
  nowIso,
  deps,
}: {
  channel: IncidentChannel;
  slug: string;
  outcome: SeenOutcome;
  nowIso: string;
  deps: IncidentDetectDeps;
}): IncidentRegistered {
  const recorded = deps.record({ row: { atIso: nowIso, channelId: channel.id, outcome, slug } });
  const base = { channelId: channel.id, name: channel.name, outcome, slug };
  if (recorded.isErr()) {
    return { ...base, ledger: recorded.error.message };
  }
  return base;
}
