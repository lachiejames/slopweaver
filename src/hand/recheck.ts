/**
 * A HAND STEP NAMES THE CONDITION IT WAITS FOR, SO A SWEEP CAN SEE IT IS ALREADY MET — the pure half of `hand recheck`.
 *
 * A Queue card asking the owner to sign in, shown to an owner who is already signed in, wastes their time. When the
 * supervisor ticks, any Queue card asking for a sign-in, or for something else the owner's hand must do, is cleared
 * if its condition is already met.
 *
 * `./evidence.ts` already lets a card leave when the board row it waits on finishes. This is the other half: a card
 * whose own PRECONDITION already holds — the owner is signed in, the owner is in the channel — leaves on the tick that sees it, with
 * a settling no hand wrote. Two kinds (`./recheckShape.ts`), the two ever posted that a read can settle:
 *
 * - `browser-session` — a sign-in on a platform whose own walk reads its sign-in page (`./sessionProbes.ts`);
 * - `slack-member` — a channel the owner has to join, read with `conversations.members` through the door.
 *
 * A step carries one by `hand post --recheck <kind>:<value>`. A step that never said — every row before the field, and
 * every `mon-signin-*` card the `resync-signed-out` monitor posts — gets one DERIVED only when it reads as the owner's sign-in
 * and links to an origin the registry reads ({@link stepRecheck}): a link test against a closed list, never a guess at
 * prose. Docker, gcloud and plan sign-ins have no row: nothing settles them by a read the fleet already makes. Pure.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { HandStepError } from "./errors.js";
import { headlineAct } from "./headlinePurpose.js";
import { bareHttpsOrigin, type HandRecheck, invalidRecheck, isChannelId, RECHECK_SHAPE } from "./recheckShape.js";
import { sessionProbePlatform } from "./sessionProbes.js";
import type { HandStep } from "./step.js";

export type { HandRecheck };

/** A step sentence asking for the owner's sign-in — the one shape a recheck is ever derived for. */
const SIGN_IN_SENTENCE = /^sign in\b/i;

/**
 * A second act joined to the sign-in — "Sign in to Clerk and approve the SSO change" — which a session read cannot
 * prove done, so such a step is never derived a recheck.
 */
const SECOND_ACT = /[,;]|\b(?:and|then|plus)\b/i;

/**
 * Parse `hand post --recheck <kind>:<value>`, refusing a browser origin no atlas reads — a recheck nobody can run is
 * a claim, not a precondition.
 *
 * @param value the flag's value
 * @returns the recheck, or the refusal naming the shape
 */
export function parseRecheckFlag({ value }: { value: string }): Result<HandRecheck, HandStepError> {
  const colon = value.indexOf(":");
  if (colon === -1) {
    return err(invalidRecheck({ why: `names no value after a kind — ${RECHECK_SHAPE}` }));
  }
  const kind = value.slice(0, colon);
  const rest = value.slice(colon + 1).trim();
  if (kind === "slack-member") {
    return isChannelId({ channel: rest })
      ? ok({ channel: rest, kind })
      : err(invalidRecheck({ why: `names ${rest}, which is not a channel id — ${RECHECK_SHAPE}` }));
  }
  if (kind !== "browser-session") {
    return err(invalidRecheck({ why: `names the kind "${kind}" — ${RECHECK_SHAPE}` }));
  }
  const origin = bareHttpsOrigin({ value: rest });
  if (origin === undefined) {
    return err(invalidRecheck({ why: `names ${rest}, which is not a bare https origin — ${RECHECK_SHAPE}` }));
  }
  if (sessionProbePlatform({ origin }) === undefined) {
    return err(
      invalidRecheck({
        why: `names ${origin}, whose sign-in no atlas reads (src/hand/sessionProbes.ts) — add its row there first, or leave --recheck off`,
      }),
    );
  }
  return ok({ kind, origin });
}

/**
 * The origin a page address sits on, when it is an `https` address.
 *
 * @param url the address
 * @returns its origin, or `undefined` for any other scheme or an unreadable address
 */
function httpsOriginOf({ url }: { url: string }): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The precondition a sweep re-checks for one open step: its own `recheck`, else one DERIVED for a sign-in.
 *
 * Derived only when every one of these holds: the step waits on the owner (not a check-in, not a notice), its act opens
 * "Sign in" and joins no second act to it, it carries no literal or checklist of more to do, and the page it names — the window the fleet `opened`, else its `url` — is an origin the registry reads.
 * That is every `mon-signin-*` card (`opened` is the wall's origin) and the hand-posted `clerk-signin-6oct` shape
 * (`url` is the dashboard), and nothing a Queue link or an unread platform could make it.
 *
 * @param step the open step
 * @returns the recheck, or `undefined` when nothing the fleet reads can settle it
 */
export function stepRecheck({ step }: { step: HandStep }): HandRecheck | undefined {
  if (step.recheck !== undefined) {
    return step.recheck;
  }
  // The comma before a purpose joint (", so …") belongs to the joint, never to a second act.
  const act = headlineAct({ what: step.what }).replace(/[\s,]+$/u, "");
  const onlyASignIn =
    SIGN_IN_SENTENCE.test(act) && !SECOND_ACT.test(act) && step.literal === undefined && step.checklist === undefined;
  if (step.checkIn === true || step.notice === true || !onlyASignIn) {
    return undefined;
  }
  for (const place of [step.opened, step.url]) {
    if (place === undefined) {
      continue;
    }
    const origin = httpsOriginOf({ url: place });
    if (origin !== undefined && sessionProbePlatform({ origin }) !== undefined) {
      return { kind: "browser-session", origin };
    }
  }
  return undefined;
}

/**
 * One recheck's identity — two steps waiting on the same sign-in share ONE visit, never two.
 *
 * @param recheck the precondition
 * @returns its key, e.g. `browser-session:https://dashboard.clerk.com`
 */
function recheckKey({ recheck }: { recheck: HandRecheck }): string {
  return recheck.kind === "browser-session" ? `browser-session:${recheck.origin}` : `slack-member:${recheck.channel}`;
}

/** One distinct probe a pass runs, and every open step its answer settles or keeps. */
export interface RecheckProbe {
  readonly recheck: HandRecheck;
  readonly key: string;
  readonly ids: readonly string[];
}

/**
 * Every open step a sweep can recheck, grouped by the one probe that answers it.
 *
 * @param steps the open steps
 * @returns each distinct probe with the ids it answers, in the order first met, and the ids nothing can recheck
 */
export function recheckPlan({ steps }: { steps: readonly HandStep[] }): {
  readonly probes: readonly RecheckProbe[];
  readonly unchecked: readonly string[];
} {
  const byKey = new Map<string, { recheck: HandRecheck; key: string; ids: string[] }>();
  const unchecked: string[] = [];
  for (const step of steps) {
    const recheck = stepRecheck({ step });
    if (recheck === undefined) {
      unchecked.push(step.id);
      continue;
    }
    const key = recheckKey({ recheck });
    const group = byKey.get(key);
    if (group === undefined) {
      byKey.set(key, { ids: [step.id], key, recheck });
    } else {
      group.ids.push(step.id);
    }
  }
  return { probes: [...byKey.values()], unchecked };
}

/** What one probe found, as the shell read it. */
export type RecheckObservation =
  | { readonly kind: "met"; readonly observed: string }
  | { readonly kind: "unmet"; readonly observed: string }
  | { readonly kind: "unread"; readonly why: string };

/** One step's line in a recheck report. */
export interface RecheckLine {
  readonly id: string;
  /** What the read saw, or why it could not read. */
  readonly because: string;
}

/** What one pass found, step by step, before anything is written. */
export interface RecheckReport {
  /** Already met: each is settled by the pass. */
  readonly met: readonly RecheckLine[];
  /** Read and still needed: each stays on the owner's queue. */
  readonly unmet: readonly RecheckLine[];
  /** Could not be read this pass: each stays, and the next tick reads again. */
  readonly unread: readonly RecheckLine[];
  /** Open steps naming no precondition the fleet reads. */
  readonly unchecked: readonly string[];
}

/**
 * Spread each probe's answer back over every step it answers.
 *
 * @param probes the plan's probes
 * @param unchecked the plan's steps with no precondition
 * @param observations each probe's answer, by its key — a probe with none reads as unread
 * @returns the report, in plan order
 */
export function recheckReport({
  probes,
  unchecked,
  observations,
}: {
  probes: readonly RecheckProbe[];
  unchecked: readonly string[];
  observations: ReadonlyMap<string, RecheckObservation>;
}): RecheckReport {
  const met: RecheckLine[] = [];
  const unmet: RecheckLine[] = [];
  const unread: RecheckLine[] = [];
  for (const probe of probes) {
    const observation = observations.get(probe.key);
    for (const id of probe.ids) {
      if (observation === undefined) {
        unread.push({ because: `${probe.key} was not read this pass`, id });
      } else if (observation.kind === "unread") {
        unread.push({ because: observation.why, id });
      } else {
        (observation.kind === "met" ? met : unmet).push({ because: observation.observed, id });
      }
    }
  }
  return { met, unchecked, unmet, unread };
}

/**
 * The settling account a met precondition is journalled under, so nothing reading the register takes it for the owner's Done.
 *
 * @param observed what the probe saw
 * @param nowIso when it saw it
 * @returns the settled row's `did`
 */
export function recheckDid({ observed, nowIso }: { observed: string; nowIso: string }): string {
  return `retired by recheck — already met: ${observed} at ${nowIso}, no hand touched it`;
}
