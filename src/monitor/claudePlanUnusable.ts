/**
 * `claude-plan-unusable` — a registered Claude plan whose last probe found it signed out, not set up on this machine,
 * or failing in a way that is the plan's own.
 *
 * A plan signed out or not set up locally goes unnoticed for days (one sat signed out for about 72 hours) with nothing saying so, so the owner gets a floating
 * note on their screen when one of the plans is not set up locally, is signed out, or has something wrong with it. The
 * probes are `claude gauge` (every supervisor tick), the `claude watch` keep-alive and the pre-spawn routing gate (every
 * spawn); each records what it found (`../claude/planProbeRecord.ts`) and this reads the record.
 *
 * ## One subject per plan, keyed by its fault EPISODE
 *
 * Each plan is its own act of the owner's, so each is its own card. The key is the alias's stem plus a digest of the
 * episode — store, code and the instant the episode began — so the card stands while the same fault repeats, and a
 * fault that clears and comes back is a new card rather than the old one's ghost.
 *
 * ## A fault read off the provider's answer waits for a second probe
 *
 * A rejected credential, a rejected setup token and a usage answer of a new shape are each read off what the provider
 * sent, and a network in trouble sends exactly that: an answer with no rate-limit headers. So one probe seeing one
 * floats nothing; the plan is a blind spot until the next probe confirms the episode or ends it
 * (`../claude/planProbeRecord.ts`'s `isUnconfirmedFault`). A fault read off this machine's disk floats on the probe
 * that saw it.
 *
 * ## The owner's Done is HELD until a probe re-tests it
 *
 * The owner's Done says they signed in. A subject whose card the owner closed AT OR AFTER the probe that last
 * confirmed the fault is held: nothing has looked since. The next probe either finds the plan well — the fault
 * clears — or confirms the fault again after the owner's Done, and that is news, so the card is posted again.
 *
 * ## The one step depends on the fault
 *
 * A sign-in fault (`STORE_MISSING`, `STORE_NOT_READY`, `CREDENTIAL_REJECTED`) is the owner's own command,
 * `slopweaver claude signin --plan <alias>`, put on their pasteboard. A rejected or unreadable setup token is
 * re-minted by a seat, which needs the code mailed to the plan's address; a usage answer of a new shape is a code
 * change. Nothing starts either on its own, so the card says so and the owner's one step is to ask for the repair on
 * the card itself, where a steer reaches the chair naming the card — never words dictated for the owner to type into a
 * session, and never a promise that a repair is already running.
 *
 * ## And one card for the register itself, when it does not read
 *
 * A register that does not read refuses every Claude seat — `../claude/spawnStore.ts` § Fail CLOSED — and it hides
 * every plan from this monitor at once. So it is a subject of its own — {@link evaluateClaudeRegisterFault} — rather
 * than an unmeasurable pass that says nothing.
 *
 * ## What it never says
 *
 * A paused plan is not read: the pause is the owner's decision to take it out, and a note on it would be a nag the
 * owner did not ask for. A plan with no record for its current store, or whose only news is an unmeasured probe, makes the reading
 * unmeasurable rather than clear — unless a card that should come down is open, which {@link
 * evaluateClaudePlanUnusable} settles first.
 *
 * Pure: the plans, their records and the owner's Done instants in, a reading out.
 */
import { createHash } from "node:crypto";

import {
  type ClaudePlanFault,
  type ClaudePlanProbeRecord,
  isSignInFault,
  isUnconfirmedFault,
} from "../claude/planProbeRecord.js";
import { signinCommandLine } from "../claude/signinRender.js";
import { DETAIL_LINE_CAP } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";
import { LITERAL_CAP } from "../hand/stepAddress.js";
import { parseStrictIsoInstantMs } from "../lib/date.js";
import type { PlanRegisterReadError } from "../plans/errors.js";

import type { MonitorReading, MonitorSubject } from "./types.js";

/** How much of the alias survives into the key before the episode digest. */
const ALIAS_STEM = 20;

/**
 * Hex characters of the episode digest: 64 bits, because two plans whose aliases share a stem are told apart by the
 * digest alone, and at 32 bits a pair colliding on purpose was found by search. The key stays
 * inside the hand step id's 60 characters with an occurrence suffix: `mon-claude-` + 20 + 1 + 16 + `.99` is 51.
 */
const EPISODE_DIGEST = 16;

/** One unpaused registered Claude plan, projected onto what this monitor turns on. */
export interface ClaudePlanInput {
  readonly alias: string;
  /** The address the register caches for the plan — what the owner signs in with, so what the card names. */
  readonly email: string | undefined;
  readonly storeDir: string;
  /** What the last probe recorded, when one ever did. */
  readonly record: ClaudePlanProbeRecord | undefined;
}

/**
 * The step-id-safe key one plan's fault episode is posted under.
 *
 * @param alias the plan's alias
 * @param storeDir the store the episode was seen on
 * @param fault the episode
 * @returns the key, e.g. `plan-two-1a2b3c4d5e6f7a8b`
 */
export function claudeFaultKey({
  alias,
  fault,
  storeDir,
}: {
  alias: string;
  fault: Pick<ClaudePlanFault, "code" | "sinceIso">;
  storeDir: string;
}): string {
  const stem = alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ALIAS_STEM)
    .replace(/-+$/, "");
  const digest = createHash("sha256")
    .update(`${alias}\n${storeDir}\n${fault.code}\n${fault.sinceIso}`)
    .digest("hex")
    .slice(0, EPISODE_DIGEST);
  if (stem.length === 0) {
    return digest;
  }
  return `${stem}-${digest}`;
}

/**
 * The command the owner's sign-in runs for one plan: `claude auth login` with the REGISTER's store bound inline and its
 * address pre-filled — the line `claude gauge` prints, and one `../hand/runnableLiteral.ts` admits as the owner's. Never
 * the `slopweaver claude signin` wrapper, which re-reads the `accounts.json` projection and so, once that diverges from
 * the register this monitor read, refuses the alias or signs a stale store in.
 *
 * @param plan the faulted plan, whose store and address the command carries
 * @returns the command
 */
function claudeSignInCommand({ plan }: { plan: ClaudePlanInput }): string {
  if (plan.email === undefined) {
    return signinCommandLine({ storeDir: plan.storeDir });
  }
  return signinCommandLine({ email: plan.email, storeDir: plan.storeDir });
}

/** The fault in words for the card, never the store path: that lives in the command. */
function faultWords({ fault }: { fault: ClaudePlanFault }): string {
  switch (fault.code) {
    case "STORE_MISSING":
      return "it is not set up on this machine — its store directory is gone";
    case "STORE_NOT_READY":
      return "it is signed out — its store holds no sign-in";
    case "CREDENTIAL_REJECTED":
      return "Anthropic rejects its sign-in";
    case "SETUP_TOKEN_REJECTED":
      return "Anthropic rejects its setup token";
    case "SETUP_TOKEN_UNREADABLE":
      return "its setup token file does not read";
    case "USAGE_SHAPE_CHANGED":
      return "its usage answer is a shape the gauge cannot read";
  }
}

/** One faulted plan's subject. */
function faultSubject({
  closedAt,
  fault,
  plan,
}: {
  closedAt: string | undefined;
  fault: ClaudePlanFault;
  plan: ClaudePlanInput;
}): MonitorSubject {
  const key = claudeFaultKey({ alias: plan.alias, fault, storeDir: plan.storeDir });
  const since = `since ${fault.sinceIso}`;
  // The probe's own message is unbounded and may span lines, and the register REFUSES a detail line past its cap or
  // holding a newline — so one long error would cost the plan its card, and with it every other plan's settling that
  // pass. Folded to one line and cut at a word, it can never stop the card.
  const detail = `${fault.code} ${since}, last confirmed ${fault.lastSeenIso}: ${fault.message.replace(/\s+/g, " ")}`;
  const details = [fitLine({ cap: DETAIL_LINE_CAP, text: detail })];
  // The command carries the register's store path, which nothing bounds, and the register REFUSES a literal past its
  // cap — so a store path long enough would cost the plan its card on every pass. Past the cap
  // the card still posts, and names the verb that walks the same sign-in instead of carrying it.
  let literal: string | undefined;
  if (isSignInFault({ code: fault.code })) {
    const command = claudeSignInCommand({ plan });
    if (command.length <= LITERAL_CAP) {
      literal = command;
    } else {
      const instead = `the sign-in command is ${command.length} characters, past what a card can copy — run \`slopweaver claude signin --plan ${plan.alias}\``;
      details.push(fitLine({ cap: DETAIL_LINE_CAP, text: instead }));
    }
  }
  const base: MonitorSubject = {
    claudeFault: fault.code,
    claudeStoreDir: plan.storeDir,
    details,
    email: plan.email,
    id: plan.alias,
    key,
    label: `${faultWords({ fault })}, ${since}`,
    ...(literal === undefined ? {} : { literal }),
  };
  // Compared as instants, never as text: a hand row's `settledIso` may carry no milliseconds, and "…00Z" sorts after
  // "…00.500Z" while being earlier. An unparseable Done is no Done.
  const closedMs = closedAt === undefined ? undefined : parseStrictIsoInstantMs({ text: closedAt });
  if (closedMs === undefined || closedMs < parseStrictIsoInstantMs({ text: fault.lastSeenIso })!) {
    return base;
  }
  return {
    ...base,
    delivery: {
      kind: "hold",
      why: `the owner's Done at ${closedAt} is after the last probe that saw the fault (${fault.lastSeenIso}) — the next probe re-tests it`,
    },
  };
}

/** The register fault in words for the card. */
function registerFaultWords({ error }: { error: PlanRegisterReadError }): string {
  switch (error.code) {
    case "REGISTER_UNREADABLE":
      return "the plans register file is there and does not read";
    case "REGISTER_INVALID":
      return "the plans register reads but holds something unusable";
    case "REGISTER_STORE_UNAVAILABLE":
      // "opened", never "reached": "reached" over a store that answered fine and was one migration behind would
      // send the reader to the wrong half of the system.
      return "the store holding the plans register cannot be opened";
  }
}

/**
 * The step-id-safe key the register fault is posted under: `register-` and a digest of what identifies the fault.
 *
 * An unreadable file is keyed by its path, an invalid register by its problems sorted — so the same problems found
 * in another order keep the card — and an unreachable store by its code alone, because the store's own message
 * carries a port or a timestamp that changes from pass to pass.
 *
 * @param error the register read's failure
 * @returns the key, e.g. `register-1a2b3c4d5e6f7a8b`
 */
export function claudeRegisterFaultKey({ error }: { error: PlanRegisterReadError }): string {
  let material: string = error.code;
  if (error.code === "REGISTER_UNREADABLE") {
    material = `${error.code}\n${error.path}`;
  } else if (error.code === "REGISTER_INVALID") {
    material = [error.code, ...error.problems.toSorted()].join("\n");
  }
  const digest = createHash("sha256").update(material).digest("hex").slice(0, EPISODE_DIGEST);
  return `register-${digest}`;
}

/**
 * Evaluate `claude-plan-unusable` when the plans register itself does not read: ONE card about the register.
 *
 * An unreadable register fails every spawn closed, and the owner is told early that something is wrong with one of
 * their plans. So the pass that sees it floats it, rather than reading the monitor unmeasurable and saying nothing
 * while the fleet stalls.
 *
 * The reading PRESERVES DEPARTURES: with no register there are no plans to judge, so a plan's own card is neither
 * cleared nor replaced by this one, and settles only on a later pass that reads the register again. The register
 * card itself settles on the first MEASURED pass that does — one whose probe row and hand register read too, because
 * an unmeasurable pass settles nothing; that row lives in the same store as the register. The owner's Done is not
 * held: every pass re-reads the register, so a pass after the owner's Done that still cannot read it is the news that
 * it is not fixed, and the card goes up again.
 *
 * @param error the register read's failure
 * @returns firing over the one register subject
 */
export function evaluateClaudeRegisterFault({ error }: { error: PlanRegisterReadError }): MonitorReading {
  const subject: MonitorSubject = {
    claudeRegisterFault: error.code,
    details: [fitLine({ cap: DETAIL_LINE_CAP, text: `${error.code}: ${error.message.replace(/\s+/g, " ")}` })],
    id: "plans register",
    key: claudeRegisterFaultKey({ error }),
    label: registerFaultWords({ error }),
  };
  return {
    blindSpot: "the plans register did not read, so no plan's own card was judged this pass",
    monitorId: "claude-plan-unusable",
    preservesDepartures: true,
    state: "firing",
    subjects: [subject],
  };
}

/**
 * Evaluate `claude-plan-unusable` over every unpaused registered Claude plan.
 *
 * ## An unmeasured plan never keeps another plan's card up
 *
 * A blind spot stops the pass settling a card, which is right when the unseen part might still hold that card's
 * fault. Here it never can: a fault a probe carried stays a subject however the latest probe went, so a plan with no
 * subject has no current fault, and a card whose key is not among this pass's subjects is one that should come down — a
 * recovered plan's, a paused one's, an old store's. So when an open card is stale, this pass drops its blind spot and
 * the card settles; one unmeasured plan never holds every other plan's recovered card open.
 *
 * ## An unconfirmed fault keeps every card up
 *
 * The one exception is a fault one probe has seen and none has confirmed (`isUnconfirmedFault`). It ended the
 * episode before it — the record starts a new one on a different code — so a confirmed card for that plan is no longer
 * among the subjects, and dropping the blind spot would settle it on one outage-shaped answer. So an unconfirmed fault
 * is a blind spot no stale card drops, and a firing reading beside it preserves departures: nothing settles until the
 * next probe confirms the new episode or ends it. The cost, stated: another plan's recovered card waits that one probe
 * too.
 *
 * @param plans every unpaused registered Claude plan, projected
 * @param closedByOwner each key whose card the owner closed themselves, and when (`./heldKeys.ts`'s `closedByOwner`)
 * @param openKeys the key of every card of this monitor still open
 * @returns firing over the faulted plans, unmeasurable, or clear
 */
export function evaluateClaudePlanUnusable({
  plans,
  closedByOwner,
  openKeys,
}: {
  plans: readonly ClaudePlanInput[];
  closedByOwner: ReadonlyMap<string, string>;
  openKeys: ReadonlySet<string>;
}): MonitorReading {
  const subjects: MonitorSubject[] = [];
  const unmeasured: string[] = [];
  const unconfirmed: string[] = [];
  for (const plan of plans) {
    const { record } = plan;
    if (record === undefined || record.storeDir !== plan.storeDir) {
      unmeasured.push(`${plan.alias}: no probe is recorded for its store yet`);
      continue;
    }
    if (record.fault !== undefined && isUnconfirmedFault({ fault: record.fault })) {
      unconfirmed.push(
        `${plan.alias}: ${record.fault.code} seen by one probe at ${record.fault.sinceIso}, waiting for the next probe to confirm it`,
      );
    } else if (record.fault !== undefined) {
      const key = claudeFaultKey({ alias: plan.alias, fault: record.fault, storeDir: plan.storeDir });
      subjects.push(faultSubject({ closedAt: closedByOwner.get(key), fault: record.fault, plan }));
    }
    if (record.latest === "unmeasured") {
      unmeasured.push(
        `${plan.alias}: its last probe at ${record.observedAtIso} reached no verdict (${String(record.unmeasuredBecause)})`,
      );
    }
  }
  return readingOf({ openKeys, subjects, unconfirmed, unmeasured });
}

/**
 * The reading one pass's plans add up to: the faulted plans' subjects, the blind spot the unmeasured and unconfirmed
 * plans leave (a stale open card drops the unmeasured half, never the unconfirmed one), and whether a firing reading
 * must preserve departures.
 *
 * @param subjects the confirmed faults' subjects
 * @param unmeasured one line per plan this pass could not judge
 * @param unconfirmed one line per plan whose fault waits on a second probe
 * @param openKeys the key of every card of this monitor still open
 * @returns firing, unmeasurable, or clear
 */
function readingOf({
  openKeys,
  subjects,
  unconfirmed,
  unmeasured,
}: {
  openKeys: ReadonlySet<string>;
  subjects: readonly MonitorSubject[];
  unconfirmed: readonly string[];
  unmeasured: readonly string[];
}): MonitorReading {
  const subjectKeys = new Set(subjects.map((subject) => subject.key));
  const staleCardOpen = [...openKeys].some((key) => !subjectKeys.has(key));
  const blind = [...(staleCardOpen ? [] : unmeasured), ...unconfirmed];
  const blindSpot = blind.length === 0 ? undefined : blind.join("; ");
  if (subjects.length > 0 && unconfirmed.length > 0) {
    // Departs nothing even when another plan's card goes up this pass: a partial read departs every stale card once a
    // replacement is posted (`./pass.ts`), and the unconfirmed plan's confirmed card is not that replacement.
    return { blindSpot, monitorId: "claude-plan-unusable", preservesDepartures: true, state: "firing", subjects };
  }
  if (subjects.length > 0) {
    return { blindSpot, monitorId: "claude-plan-unusable", state: "firing", subjects };
  }
  if (blindSpot !== undefined) {
    return { because: blindSpot, monitorId: "claude-plan-unusable", state: "unmeasurable" };
  }
  return { monitorId: "claude-plan-unusable", state: "clear" };
}
