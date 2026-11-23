/**
 * Which triage card is in front of the owner, as this server last heard it: the visit a voice call's `triage_next` answer
 * named. The time-up line is said only for that visit (`app/api/talk/call/[id]/triage-due/route.ts`), so a page can
 * no longer have the voice say time is up on a card no answer of this call put up — a stale tab's clock, or
 * a visit id made up by anything that can reach the route.
 *
 * For the whole server process rather than one plan call, as `./meetingLedger.ts` is: a rollover onto a fresh plan
 * call mid-card keeps the card's clock, and the page's pass already outlives the call (`../components/voice/useTriageWalk.ts`).
 * Ordered by the call that said it: each VOICE call is seated with a generation as it is made (`./talkPlanLaunch.ts`),
 * and once a call has named a visit no older call may replace, clear or say it, so a late answer from a rolled-over call
 * never undoes the fresh one's card. A typed conversation is never seated, so it names nothing: it has no voice to
 * time a card for.
 *
 * Kept at the routes rather than inside `PlanCall`, which reports only which tool a claim or an answer was for
 * (`PlanClaimOutcome`, `PlanAnswerOutcome`). A visit beside any answer but a successful `triage_next` or resuming
 * `triage_clock` is not taken; the answer itself still goes through, since the tool's own words are what the model is
 * owed. A call that may stop the page's clock clears the card as the page CLAIMS it, before the page can run it, so
 * one the server then times out, or whose answer is refused, has cleared it all the same.
 *
 * A server restart forgets it, and the next `triage_next` names the card again; until then a due line is refused.
 */
import type { CallOpenMode } from "./callRollover";

/** The tools whose answer may name the visit whose clock it started. */
const NAMES_A_VISIT: ReadonlySet<string> = new Set(["triage_next", "triage_clock"]);

/** The tools whose successful answer stops the clock whatever it carries; a `triage_clock` unless it resumed one. */
const STOPS_THE_CLOCK: ReadonlySet<string> = new Set(["triage_end", "open_card"]);

/**
 * Whether a `triage_clock` call restarted the clock, read from the arguments the model called it with as this server
 * received them, never from the page. Arguments that do not read are a stop: the safe side is no card.
 *
 * @param rawArguments the call's arguments, as JSON text
 * @returns true only for `state: "running"`
 */
function clockResumed({ rawArguments }: { rawArguments: string }): boolean {
  const parsed = argumentsOf({ rawArguments });
  return parsed?.["state"] === "running";
}

/**
 * Whether a `relay_steer` call carried the owner's triage ruling, read from its arguments as this server received
 * them. A ruling on the card in front of the owner spends its clock on the page, so the server stops holding that
 * card too; which card a ruling is on is {@link TriagePresented}'s to say, from when its answer began.
 * Arguments that do not read are a ruling: the safe side is no card.
 *
 * @param rawArguments the call's arguments, as JSON text
 * @returns true unless the arguments read and carry no `triage`
 */
function relaysARuling({ rawArguments }: { rawArguments: string }): boolean {
  const parsed = argumentsOf({ rawArguments });
  return parsed === undefined || parsed["triage"] !== undefined;
}

/**
 * A tool call's arguments as an object.
 *
 * @param rawArguments the call's arguments, as JSON text
 * @returns the object, or `undefined` when the text is not JSON or not an object
 */
function argumentsOf({ rawArguments }: { rawArguments: string }): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return undefined;
  }
}

/** The visit in front of the owner and the call generation that named it. */
interface Presented {
  readonly generation: number;
  readonly visitId: string | undefined;
}

/** The one record of the triage visit in front of the owner. */
export class TriagePresented {
  /** The last generation handed to a call. */
  private seated = 0;
  /** Each seated call's generation, held weakly so an ended call is forgotten with it. */
  private readonly generations = new WeakMap<object, number>();
  /** The newest call to name, or clear, a visit — and what it named. */
  private presented: Presented = { generation: 0, visitId: undefined };
  /**
   * How many tool calls have been claimed, in the order they were: each seated call's claims, by token, with the
   * answer each came in.
   */
  private claimCount = 0;
  private readonly claimOrder = new WeakMap<object, Map<string, { at: number; turnId: string | undefined }>>();
  /** The claim that last cleared the card: an answer to a call claimed before it never names one. */
  private clearedAt = 0;
  /** Each seated call's answers, by turn id, and the visit in front of the owner as each began. */
  private readonly turnFronts = new WeakMap<object, Map<string, string | undefined>>();

  /**
   * Seat a voice call being made, newer than every one before it. A fresh call — the owner's press, not a reconnect or a
   * rollover — clears the card an earlier call named, as the page stops its pass then (`stopTriageForFreshCall`,
   * `../components/voice/triageClockRun.ts`): triage is on only inside the call the owner asked for it in, and an older call's clock firing late is refused by its generation, never said.
   *
   * @param call the call, by identity
   * @param mode why the page opened it
   */
  seat({ call, mode }: { call: object; mode: CallOpenMode }): void {
    this.seated += 1;
    this.generations.set(call, this.seated);
    if (mode === "fresh") {
      this.presented = { generation: this.seated, visitId: undefined };
    }
  }

  /**
   * Note one of a seated call's answers beginning, with the visit then in front of the owner: a triage ruling in it is about
   * that card, as the page binds it (`./triageTurnFronts.ts`). A second start of the same answer keeps what the first
   * saw, since a replayed start says nothing about when the owner's words came. Ignored from an unseated call.
   *
   * @param call the call, by identity
   * @param turnId the answer, the Codex turn's id
   */
  turnStarted({ call, turnId }: { call: object; turnId: string }): void {
    if (!this.generations.has(call)) {
      return;
    }
    let fronts = this.turnFronts.get(call);
    if (fronts === undefined) {
      fronts = new Map();
      this.turnFronts.set(call, fronts);
    }
    if (!fronts.has(turnId)) {
      fronts.set(turnId, this.presented.visitId);
    }
  }

  /**
   * Whether a `relay_steer` carrying the owner's ruling may have stopped the clock on the card held now: only when its
   * answer began with that card in front of the owner. A ruling from an answer that began on an earlier card leaves
   * the page's clock on this one running, so its line stays owed. An answer never heard beginning, or a call
   * naming none, takes the safe side and clears.
   *
   * @param call the call, by identity
   * @param turnId the answer the ruling came in
   * @returns whether the ruling is on the card held now
   */
  private rulesTheHeldCard({ call, turnId }: { call: object; turnId: string | undefined }): boolean {
    const fronts = this.turnFronts.get(call);
    if (turnId === undefined || fronts === undefined || !fronts.has(turnId)) {
      return true;
    }
    return fronts.get(turnId) === this.presented.visitId;
  }

  /**
   * One tool call the page has just claimed, before it runs. A call that may stop the page's clock — a `triage_end`,
   * an `open_card`, any `triage_clock`, or a `relay_steer` carrying the owner's triage ruling from an answer that began on the
   * card held now — clears the card now: the page
   * stops its clock only after this claim, and the call may then time out or have its answer refused, neither of which
   * reaches {@link answered}. A `triage_clock` restarting the clock names its card again once it answers.
   * Every claim of a seated call is numbered, so a `triage_next` claimed before a stop and answered after it never
   * brings back the card the stop cleared. Ignored from an unseated call, and from a call older than the
   * one that last named or cleared a visit.
   *
   * @param call the claiming call, by identity
   * @param token the tool call's token, which its answer carries
   * @param tool the tool claimed
   * @param rawArguments what the model called the tool with, as JSON text this server received
   * @param turnId the answer the tool call came in, `undefined` when the call named none
   * @returns whether it cleared the card
   */
  claimed({
    call,
    token,
    tool,
    rawArguments,
    turnId,
  }: {
    call: object;
    token: string;
    tool: string;
    rawArguments: string;
    turnId: string | undefined;
  }): boolean {
    const generation = this.generations.get(call);
    if (generation === undefined) {
      return false;
    }
    this.claimCount += 1;
    let order = this.claimOrder.get(call);
    if (order === undefined) {
      order = new Map();
      this.claimOrder.set(call, order);
    }
    order.set(token, { at: this.claimCount, turnId });
    const mayStop =
      STOPS_THE_CLOCK.has(tool) ||
      tool === "triage_clock" ||
      (tool === "relay_steer" && relaysARuling({ rawArguments }) && this.rulesTheHeldCard({ call, turnId }));
    if (!mayStop || generation < this.presented.generation) {
      return false;
    }
    this.presented = { generation, visitId: undefined };
    this.clearedAt = this.claimCount;
    return true;
  }

  /**
   * One settled tool answer of a call, read for the card whose clock it leaves running: a successful `triage_next`
   * naming a visit names it, and so does a `triage_clock` the model called with `running` that restarted the clock on
   * one. A `triage_end`, `open_card`, any other `triage_clock` or a `relay_steer` carrying the owner's ruling on the card held
   * now, by the answer it was claimed in, whatever
   * visit rides beside it and whether or not it succeeded, names none: each may have stopped the page's clock, and a
   * due request delayed past it must find no card here to be said over. A
   * `triage_next` that put nothing up changes nothing: two
   * in one answer may settle in either order, and the one that lost the race must not clear the card the other put
   * up. Only a call claimed at or after the claim that last cleared the card may name one. Ignored from
   * an unseated call, and from a call older than the one that last named or cleared a visit.
   *
   * @param call the answering call, by identity
   * @param token the tool call's token, as it was claimed
   * @param tool the tool the answer settled
   * @param rawArguments what the model called the tool with, as JSON text this server received
   * @param success whether the tool succeeded
   * @param triageVisit the visit the answer says it put up
   * @returns whether it was taken
   */
  answered({
    call,
    token,
    tool,
    rawArguments,
    success,
    triageVisit,
  }: {
    call: object;
    token: string;
    tool: string;
    rawArguments: string;
    success: boolean;
    triageVisit: string | undefined;
  }): boolean {
    const generation = this.generations.get(call);
    // Decided by the tool and its own arguments before the visit beside it: a stray visit on a `triage_end`, an
    // `open_card` or a pausing `triage_clock` answer never keeps the card it stopped.
    // A restart that failed restarted nothing, so it stops like a pause.
    const resumed = tool === "triage_clock" && success && clockResumed({ rawArguments }) && triageVisit !== undefined;
    const claim = this.claimOrder.get(call)?.get(token);
    this.claimOrder.get(call)?.delete(token);
    // A ruling the page never claimed never ran, so it stopped no clock: the page runs a tool only once its claim is
    // taken, and an unclaimed answer is the page saying it could not.
    const ruling =
      tool === "relay_steer" &&
      claim !== undefined &&
      relaysARuling({ rawArguments }) &&
      this.rulesTheHeldCard({ call, turnId: claim.turnId });
    const stops = STOPS_THE_CLOCK.has(tool) || (tool === "triage_clock" && !resumed) || ruling;
    // A stopping answer clears even when it failed: the page stops its clock before it opens a card, so a refused
    // `open_card` has stopped it all the same. Only naming a card wants the tool to have worked.
    const claimedSinceCleared = claim !== undefined && claim.at >= this.clearedAt;
    const names = !stops && success && claimedSinceCleared && triageVisit !== undefined && NAMES_A_VISIT.has(tool);
    if (generation === undefined || !(stops || names) || generation < this.presented.generation) {
      return false;
    }
    this.presented = { generation, visitId: stops ? undefined : triageVisit };
    return true;
  }

  /**
   * Whether a call may say a visit's time-up line: the visit is the one in front of the owner, and the call is the one
   * that named it or a newer seated one. A rollover's fresh call carries the card on, as the page's clock does; a call
   * older than the one that named it never speaks over the newer call's card, and an unseated call never does.
   *
   * @param call the call asked to say it, by identity
   * @param visitId the visit a clock ran out on
   * @returns `true` only for the visit last named, asked of a call no older than the one that named it
   */
  holds({ call, visitId }: { call: object; visitId: string }): boolean {
    const generation = this.generations.get(call);
    if (generation === undefined || generation < this.presented.generation) {
      return false;
    }
    return this.presented.visitId === visitId;
  }
}

/** Where the process keeps it: `next dev` re-evaluates a module when it recompiles, and the routes are separate modules. */
const KEY = Symbol.for("slopweaver.talk.triagePresented");

/**
 * The one record for this server process, made on first use.
 *
 * @returns the process-global record
 */
export function processTriagePresented(): TriagePresented {
  const holder = globalThis as typeof globalThis & { [KEY]?: TriagePresented };
  let found = holder[KEY];
  if (found === undefined) {
    found = new TriagePresented();
    holder[KEY] = found;
  }
  return found;
}
