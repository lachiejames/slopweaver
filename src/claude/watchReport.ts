/**
 * What a tick tells the owner: the ETA-to-recover accounting, the machine document and the human lines.
 *
 * ## ETA-TO-RECOVER is the number this whole design is judged on
 *
 * The owner's stated bar, and it has exactly three parts: how long until a wall is NOTICED, plus the swap itself,
 * plus how long a running session takes to pick the new credential up. Only the first is under this code's
 * control, which is why the loop reports it as its own guarantee — a tick every `interval`, so the worst
 * case for noticing a plan-wide threshold is one full interval and never longer.
 *
 * ## A tick reports what it DID, and the witness that says whether it worked
 *
 * MEASURED, by running the loop against one machine's real stores and reading the keychain
 * either side: a tick reported three stores "refreshed" and the modification date on every one of them had
 * not moved. Nothing was broken — the keep-alive command is a REPAIR, and it correctly does nothing to a
 * credential that is still healthy. The report was simply claiming an outcome from having run a command.
 *
 * So a tick says it TOUCHED a store, which is what it can know, and prints each store's own expiry beside
 * it, which is the falsifiable witness. That is also the number the owner actually wants: "plan-two has 3.6
 * hours of life left" says whether keep-alive is working, while "refreshed plan-two" does not.
 *
 * ## An unknown part is NAMED, never folded into zero
 *
 * {@link RecoveryEta} carries a total only when every part is known, and lists what it could not measure.
 * That is the same discipline `all-exhausted` keeps for its `earliestResetIso`, and for the same reason: a
 * partial figure dressed as a whole is worse than an honest gap, because a reader acts on it. A loop that
 * quietly reported "recovery: 4 seconds" while the pickup it never measured took four minutes would be
 * lying in exactly the direction that costs the owner an afternoon.
 */
import { cachedAccountCell } from "./accountBinding.js";
import { planLabel } from "./config.js";
import type { WatchTickPlan } from "./watchTick.js";

/** Hours in which a store's remaining life is reported, so one place decides the unit. */
const MS_PER_HOUR = 3_600_000;

/** How many decimal places a remaining-life figure carries — enough to see a change between ticks. */
const LIFE_DECIMALS = 2;

/** One store's own expiry, as the loop read it out of that store's credential. */
export interface StoreLife {
  readonly alias: string;
  /**
   * The DISPLAY CACHE `accounts.json` maps this store to, named on the SIGNED OUT line that sends the owner to
   * sign in. A signed-out store has no token to derive an account from, so this line can only ever offer the
   * cache — and `planLabel` says so rather than presenting it as the account (`accountBinding.ts`).
   */
  readonly email?: string;
  /** When this store's credential expires, ISO-8601. Absent when the store carries no usable one. */
  readonly expiresAtIso?: string;
  /** Whether the store holds an access token at all. False means signed out, which no touch repairs. */
  readonly hasCredential: boolean;
}

/**
 * The line for a store with nothing to refresh from — an instruction to the owner, so it names the account to sign in.
 *
 * @param life the signed-out store
 * @returns the line
 */
function signedOutLine({ life }: { life: StoreLife }): string {
  const cell = cachedAccountCell(life.email === undefined ? {} : { cachedEmail: life.email });
  const label = planLabel({ alias: life.alias, cell });
  return `  ${label}: SIGNED OUT — no touch repairs this, it needs one browser sign-in`;
}

/**
 * How much life each store has left, as the line a reader sees.
 *
 * A store whose credential has already expired is called out rather than reported as a negative number,
 * because that is the state keep-alive exists to repair and it must not read as a rounding detail.
 *
 * **A SIGNED-OUT store is a different line, and getting that wrong is a promise the loop cannot keep.**
 * MEASURED: `claude doctor` under a store whose refresh token had been superseded did not leave
 * the old credential in place, it wrote back an EMPTY one — both tokens the empty string and an expiry of
 * zero. The line then read `EXPIRED at 1970-01-01 — the next touch is what repairs it`, which is false in
 * both halves. No touch repairs a store with nothing to refresh from. Only a browser sign-in does, and that
 * is the owner's own hand, so it has to be said in the words that send the owner to do it.
 *
 * @param lives each store's expiry, in configured order
 * @param nowIso the tick's instant, ISO-8601
 * @returns one line per store
 */
export function storeLifeLines({ lives, nowIso }: { lives: readonly StoreLife[]; nowIso: string }): readonly string[] {
  return lives.map((life) => {
    if (life.expiresAtIso === undefined) {
      return life.hasCredential ? `  ${life.alias}: no expiry this build can read` : signedOutLine({ life });
    }
    if (!life.hasCredential) {
      return signedOutLine({ life });
    }
    const remainingMs = Date.parse(life.expiresAtIso) - Date.parse(nowIso);
    if (remainingMs <= 0) {
      return `  ${life.alias}: EXPIRED at ${life.expiresAtIso} — the next touch is what repairs it`;
    }
    return `  ${life.alias}: ${(remainingMs / MS_PER_HOUR).toFixed(LIFE_DECIMALS)}h left, expires ${life.expiresAtIso}`;
  });
}

/**
 * What is known about how long a recovery takes, and what is not.
 *
 * @internal — the value {@link recoveryEta} returns and the report renderers consume; a caller threads it
 *   between those rather than constructing one.
 */
export interface RecoveryEta {
  /** How long from a wall to this loop noticing it, in milliseconds. */
  readonly detectionMs: number;
  /** Whether {@link detectionMs} was observed, or is the loop's own worst-case guarantee. */
  readonly detection: "measured" | "worst-case";

  /** The parts this loop could not measure, named so a reader is not left to assume they were zero. */
  readonly unmeasured: readonly string[];
}

/**
 * How long it took, or would take at worst, for this loop to notice a wall.
 *
 * @param intervalMs how often this loop ticks — its worst case, used when nothing was observed
 * @param noticedAtIso when this loop saw the signal, ISO-8601
 * @param signalAtIso when the claim actually refused a session, ISO-8601
 * @returns the latency in milliseconds
 */
function detectionLatencyMs({
  intervalMs,
  noticedAtIso,
  signalAtIso,
}: {
  intervalMs: number;
  noticedAtIso?: string;
  signalAtIso?: string;
}): number {
  if (signalAtIso === undefined || noticedAtIso === undefined) {
    return intervalMs;
  }
  return Date.parse(noticedAtIso) - Date.parse(signalAtIso);
}

/**
 * Account for how long a recovery would take.
 *
 * Detection is MEASURED when the instant a claim refused a session is known and the instant this loop
 * noticed it is known; otherwise it is the loop's worst case, which is one full interval. Both are real
 * answers to the same question, and the field saying which one this is exists so a reader never has to
 * guess.
 *
 * @param intervalMs how often this loop ticks, which is its worst case for noticing anything
 * @param noticedAtIso when this loop saw the signal, ISO-8601 — present only alongside `signalAtIso`
 * @param signalAtIso when the claim actually refused a session, ISO-8601
 * **The SWAP leg is gone, and its absence is now a constant rather than an argument.** It measured the
 * credential copy, and that act is retired (`../cli/commands/claude/rotate.ts` § This verb no longer writes a
 * credential), so nothing can ever measure it again. It stays NAMED in `unmeasured` rather than dropped,
 * because a reader of a recovery estimate has to know which legs it does not cover — and it is never reported
 * as zero, which would read as an instant recovery.
 *
 * @returns the accounting, with every unknown part named
 */
export function recoveryEta({
  intervalMs,
  noticedAtIso,
  signalAtIso,
}: {
  intervalMs: number;
  noticedAtIso?: string;
  signalAtIso?: string;
}): RecoveryEta {
  const detectionMs = detectionLatencyMs({
    intervalMs,
    ...(noticedAtIso === undefined ? {} : { noticedAtIso }),
    ...(signalAtIso === undefined ? {} : { signalAtIso }),
  });
  // BOTH unmeasured legs are constants now, not conditionals. The swap leg became unknowable when the credential
  // copy was retired; the pickup leg never had a producer at all, and its optional parameter was an invitation to
  // supply a number nothing could measure.
  const unmeasured: readonly string[] = [
    "the swap, because the credential copy is retired and nothing performs one",
    "pickup, because how fast a running session re-reads the credential is not observable here",
  ];
  // There is no TOTAL field at all any more, not merely an absent one. The swap leg became permanently
  // unknowable when the credential copy was retired, so a total could never be computed again — and a field that
  // can only ever be absent is a reader's invitation to look for a number that will not come. The Codex review
  // pass on this change named it as dead. What replaced it is the `unmeasured` list, which says WHICH legs are
  // missing rather than leaving a hole where a sum used to be.
  return {
    detection: signalAtIso !== undefined && noticedAtIso !== undefined ? "measured" : "worst-case",
    detectionMs,
    unmeasured,
  };
}

/**
 * The machine document one tick emits under `--json`.
 *
 * `touched` and `wouldTouch` are separate fields rather than one field whose meaning depends on a flag. A
 * reader parsing a tick has to be able to tell what HAPPENED from what was merely due, and collapsing the
 * two is how a dry run ends up recorded as work. `stores` carries the witness that says whether any of it
 * achieved anything.
 *
 * @param dryRun whether this tick reported without touching anything
 * @param eta the recovery accounting for this tick
 * @param lives each store's own expiry, the witness for whether keep-alive is working
 * @param nowIso the tick's instant, ISO-8601
 * @param plan what the tick decided
 * @returns one JSON-serialisable document
 */
export function watchTickDocument({
  dryRun,
  eta,
  lives,
  nowIso,
  plan,
}: {
  dryRun: boolean;
  eta: RecoveryEta;
  lives: readonly StoreLife[];
  nowIso: string;
  plan: WatchTickPlan;
}): Readonly<Record<string, unknown>> {
  return {
    act: plan.outcome.act,
    activeFrom: plan.activeFrom,
    eta,
    held: plan.held,
    observedAtIso: nowIso,
    source: "claude-rotation",
    stores: lives,
    touched: dryRun ? [] : plan.touch,
    touchSkipped: plan.touchSkipped,
    why: plan.why,
    wouldTouch: plan.touch,
    // A CONSTANT now, and that inversion is the whole point. This used to report the plan a live tick had moved
    // the active credential onto, which was correct while a tick performed a swap. The credential copy is
    // retired (`../cli/commands/claude/rotate.ts` § This verb no longer writes a credential), so a tick writes
    // the active slot on NO path at all and a field naming a plan here would be the one thing this feature must
    // never get wrong about itself — found by the Codex review pass on that change, which built the tick that
    // recommended plan-two and emitted `wroteToActiveCredential: "plan-two"`. The field is kept rather than
    // dropped because it is the line a reader of a machine document checks to answer "did this write anything",
    // and the answer is now permanently no. `rotateTo` beside it still carries what was RECOMMENDED.
    wroteToActiveCredential: "nothing",
    ...(plan.active === undefined ? {} : { active: plan.active }),
    ...(plan.rotateTo === undefined ? {} : { rotateTo: plan.rotateTo }),
  };
}

/**
 * The human lines one tick prints.
 *
 * @param dryRun whether this tick reported without touching anything
 * @param eta the recovery accounting for this tick
 * @param lives each store's own expiry, the witness for whether keep-alive is working
 * @param nowIso the tick's instant, ISO-8601
 * @param plan what the tick decided
 * @returns the lines, in print order
 */
export function renderWatchLines({
  dryRun,
  eta,
  lives,
  nowIso,
  plan,
}: {
  dryRun: boolean;
  eta: RecoveryEta;
  lives: readonly StoreLife[];
  nowIso: string;
  plan: WatchTickPlan;
}): readonly string[] {
  const lines = [`${nowIso}  ${plan.why}`];
  if (plan.active !== undefined) {
    lines.push(`  active: ${plan.active} (${plan.activeFrom})`);
  }
  if (plan.touch.length > 0) {
    lines.push(`  ${dryRun ? "would touch" : "touched"}: ${plan.touch.join(", ")}`);
  }
  for (const skipped of plan.touchSkipped) {
    lines.push(`  not touched: ${skipped}`);
  }
  for (const line of storeLifeLines({ lives, nowIso })) {
    lines.push(line);
  }
  if (plan.held.length > 0) {
    lines.push(`  held out of selection: ${plan.held.join(", ")}`);
  }
  lines.push(`  eta-to-recover: detection ${String(eta.detectionMs)}ms (${eta.detection})`);
  for (const gap of eta.unmeasured) {
    lines.push(`    not measured: ${gap}`);
  }
  return lines;
}
