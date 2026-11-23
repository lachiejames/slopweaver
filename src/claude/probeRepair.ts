/**
 * The two-pass read the routing gate performs: probe every configured plan, repair the ones the provider
 * REFUSED whose credential has merely expired, and re-probe those. Every decision it takes was taken in
 * `credentialRepair.ts`, which is pure; every effect it performs is behind an injected seam, so the whole
 * ordering is unit-testable without a keychain, a provider or a child process.
 *
 * ## Why the repair lives here and not inside `probePlan`
 *
 * `probePlan` is shared by `claude gauge`, the keep-alive watch, the sign-in verifier and this gate. Putting a
 * refresh inside it would silently turn the read-only gauge verb and the sign-in verifier into credential
 * writers — which is the opposite of why that probe was extracted into one place. So the probe stays one
 * request, and the repair is a wrapper two callers choose: the routing gate before a spawn, and the keep-alive
 * watch before it records a probe the sign-in note reads, entering at {@link repairProbedPlans} once its
 * active-store guard has cleared a store.
 *
 * ## The order, and what each step of it is protecting
 *
 * 1. **Probe every store concurrently, and await the WHOLE sweep before any refresh.** The refresh is
 *    `execFileSync`, which blocks this thread — so starting one while probes are in flight would hold up their
 *    own timeout handling and make a slow network look like a refusal.
 * 2. **Walk the results once, in configured order.** Only a credential REFUSAL is a candidate.
 * 3. **Re-read that store's metadata, then read the clock, then decide — and that ONE reading is also the
 *    before-baseline the witness compares against.** Fresh for a reason: another session or the standing
 *    keep-alive may have refreshed the store in the meantime, in which case the cached token the refusal was
 *    about is already gone and one more probe is the whole correct act. And a slow earlier store must not leave
 *    this store's "now" stale, because an expiry comparison against a minute-old instant is how "already
 *    expired" becomes wrong. A SECOND read between the decision and the command would reopen exactly the gap
 *    the first one closed.
 * 4. **Mark the store attempted BEFORE running anything**, in a set keyed on the store's own KEYCHAIN SERVICE
 *    NAME rather than its path, so the guard and the thing it guards cannot disagree: that name is what
 *    identifies a physical store, and two different paths can derive one (`storeService.ts` keeps eight hex
 *    digits of the digest). Exactly one
 *    refresh command per store per gate invocation is then structural rather than intended, and two configured
 *    aliases spelling the same physical store cannot both fire. It is per INVOCATION and says so: two gates
 *    running at once are bounded by Claude Code's own per-store lock, not by this set.
 * 5. **Run one refresh, then read the store back immediately** — including after the command failed, because
 *    the witness is the expiry and not the exit code.
 * 6. **Re-probe the attempted and already-advanced stores concurrently, with a fresh clock each.** A store
 *    whose witness was inconclusive is re-probed too: the provider answering `200` is stronger evidence than
 *    any metadata reading, and it is the one that decides whether routing may use the store.
 *
 * Nothing here ever calls itself again. A second refusal is reported as a second refusal.
 *
 * ## The residue this ordering does NOT remove, stated rather than discovered
 *
 * A reading is a reading. Another process can refresh the store, or have its grant cleared, in the moment
 * between the decision and the command, and no re-read closes that,
 * because whatever is read can change after it is read. **This deliberately takes no Slopweaver lock**: Claude
 * Code takes its own per-store lock for the refresh write, and holding one here would make it wait on us.
 *
 * What bounds the residue is that the losing case is harmless. A refresh command against a store another process
 * has just refreshed finds a healthy token and does nothing, because the CLI refreshes only inside a token's
 * last five minutes. And a grant cleared in that window makes the command fail, which the expiry witness
 * reports as a failure rather than a repair. So the race costs at most one command that achieves nothing, and
 * never a false claim about what happened.
 *
 * ## What the expiry witness does and does not prove
 *
 * A strictly advanced expiry witnesses a refresh WRITE across the interval. It does not prove which process
 * performed it, and it does not prove the provider will accept the new token — which is why step 6 exists and
 * why the gate routes on the second READING rather than on the witness.
 */
import { absentAs } from "#lib/absent.js";
import type { ClaudeAccount } from "./contracts.js";
import {
  assessStoreRefresh,
  assessStoreRepair,
  refusedAlias,
  type StoreLife,
  type StoreRefreshOutcome,
  type StoreRepairDecision,
  signInOnlyRepairSkipMeaning,
} from "./credentialRepair.js";
import { type ClaudeProbeResult, probePlan } from "./probeStore.js";
import { readStoreLife, runStoreRefresh } from "./storeRefresh.js";
import { claudeStoreService } from "./storeService.js";

/** The four effects the two-pass read performs, each injectable so the ordering itself can be asserted. */
export interface ProbeRepairDeps {
  /** The current instant. Read once per probe launch and once per repair decision, never cached. */
  readonly nowIso: () => string;
  /** Probe one plan. */
  readonly probe: (options: { alias: string; nowIso: string; storeDir: string }) => Promise<ClaudeProbeResult>;
  /** Read one store's own lifetime metadata. */
  readonly readLife: (options: { account: ClaudeAccount }) => StoreLife;
  /** Run the CLI's own refresh under one store, returning the reason it did not complete. */
  readonly refresh: (options: { storeDir: string }) => string | undefined;
}

/** The production seams, reached through {@link repairSeams} so a caller threads one object rather than four. */
const PRODUCTION_REPAIR_DEPS: ProbeRepairDeps = {
  nowIso: () => new Date().toISOString(),
  probe: probePlan,
  readLife: readStoreLife,
  refresh: runStoreRefresh,
};

/**
 * The repair seams a gate probes and refreshes through.
 *
 * Every production caller leaves them out and gets the real probe, keychain read and refresh; only a test
 * injects its own, so the probe-and-repair ordering can be asserted without touching a store.
 *
 * @param deps the caller's injected seams, or undefined to take {@link PRODUCTION_REPAIR_DEPS}
 * @returns the seams to probe and refresh through
 */
export function repairSeams({ deps }: { deps: ProbeRepairDeps | undefined }): ProbeRepairDeps {
  if (deps === undefined) {
    return PRODUCTION_REPAIR_DEPS;
  }
  return deps;
}

/** Everything one store's pass through the gate established, in the order it was established. */
export interface StoreProbeRepair {
  readonly account: ClaudeAccount;
  /** The first probe — the one that may have been refused. */
  readonly first: ClaudeProbeResult;
  /** What the refusal was judged to be worth. Always present, including `skip/not-credential-rejected`. */
  readonly decision: StoreRepairDecision;
  /** The store's metadata immediately before the refresh command, when one was attempted. */
  readonly before?: StoreLife;
  /** Its metadata immediately after, when one was attempted. */
  readonly after?: StoreLife;
  /** What the attempt achieved, judged by those two readings. */
  readonly refresh?: StoreRefreshOutcome;
  /** The second probe, present for every store that was attempted or had already advanced. */
  readonly second?: ClaudeProbeResult;
}

/**
 * The reading the gate should route on: the second probe when there was one, otherwise the first.
 *
 * @param repair one store's pass through the gate
 * @returns the probe result whose gauge, if any, is the live one
 */
export function effectiveProbe({ repair }: { repair: StoreProbeRepair }): ClaudeProbeResult {
  const present = repair.second;
  if (present === undefined) {
    return repair.first;
  }
  return present;
}

/**
 * Probe every configured plan, repairing each one the provider refused whose credential had merely expired.
 *
 * @param accounts the configured plans, in configured order
 * @param deps the four effects, injected so the ordering is assertable — {@link PRODUCTION_REPAIR_DEPS} in
 *   production
 * @returns one entry per configured plan, in configured order, each carrying its whole witness
 */
export async function probePlansWithRepair({
  accounts,
  deps,
}: {
  accounts: readonly ClaudeAccount[];
  deps: ProbeRepairDeps;
}): Promise<readonly StoreProbeRepair[]> {
  const first = await Promise.all(
    accounts.map(async (account) => ({
      account,
      result: await deps.probe({ alias: account.alias, nowIso: deps.nowIso(), storeDir: account.storeDir }),
    })),
  );
  return repairProbedPlans({ deps, first });
}

/**
 * Steps 2 to 6 of the order, over first probes the caller already took and already AWAITED as a whole.
 *
 * The keep-alive watch enters here rather than through {@link probePlansWithRepair}: it must know which plan is
 * active before it may refresh any store, and that answer comes from the very first probes the repair reads. So
 * it probes once, plans its tick, and hands over only the stores its active-store guard clears — which is why
 * step 1's promise is the caller's to keep, and why every entry passed in is a settled result, never a promise.
 *
 * @param deps the four effects
 * @param first each plan's settled first probe, in configured order
 * @returns one entry per plan passed in, in that order, each carrying its whole witness
 */
export async function repairProbedPlans({
  deps,
  first,
}: {
  deps: ProbeRepairDeps;
  first: readonly { account: ClaudeAccount; result: ClaudeProbeResult }[];
}): Promise<readonly StoreProbeRepair[]> {
  const attemptedStores = new Set<string>();
  const repaired: StoreProbeRepair[] = [];
  for (const { account, result } of first) {
    repaired.push(repairOneStore({ account, attemptedStores, deps, first: result }));
  }
  const second = await Promise.all(
    repaired.map(async (repair) => {
      if (repair.decision.kind === "skip") {
        return undefined;
      }
      return deps.probe({
        alias: repair.account.alias,
        nowIso: deps.nowIso(),
        storeDir: repair.account.storeDir,
      });
    }),
  );
  return repaired.map((repair, index) => {
    const reprobe = second[index];
    return reprobe === undefined ? repair : { ...repair, second: reprobe };
  });
}

/**
 * Decide and perform this one store's repair, synchronously, so no other store's work interleaves between the
 * reading the decision was taken on and the command it authorised.
 *
 * @param account the plan
 * @param attemptedStores the per-invocation set of store paths already attempted, mutated here
 * @param deps the four effects
 * @param first what the first probe concluded
 * @returns the store's witness so far, without its second probe
 */
function repairOneStore({
  account,
  attemptedStores,
  deps,
  first,
}: {
  account: ClaudeAccount;
  attemptedStores: Set<string>;
  deps: ProbeRepairDeps;
  first: ClaudeProbeResult;
}): StoreProbeRepair {
  // Only a credential REFUSAL is a candidate, so a healthy or offline plan costs no second keychain read at
  // all. Reading unconditionally would make the ordinary case two reads per
  // store rather than one, against the stated latency budget.
  if (refusedAlias({ reading: first.reading }) === undefined) {
    return { account, decision: { kind: "skip", reason: "not-credential-rejected" }, first };
  }
  const current = deps.readLife({ account });
  // The clock is read AFTER the store, so "already expired" is judged against an instant no earlier than the
  // reading it is compared with. A slow earlier store's refresh is exactly what would otherwise stale it.
  const decision = assessStoreRepair({ current, nowIso: deps.nowIso(), probed: first.life, reading: first.reading });
  if (decision.kind !== "attempt") {
    return { account, decision, first };
  }
  // The key is the KEYCHAIN SERVICE NAME, which is what actually identifies a physical store, rather than the
  // path that derives it. A raw path lets two Unicode spellings of one store
  // each fire a refresh; NFC normalisation fixes that and is still wrong, because `storeService.ts`
  // takes only the first EIGHT hex digits of the digest — so two genuinely different paths can collide onto one
  // item, and a live pair does: `/tmp/r1-store-9327` and `/tmp/r1-store-56152` both resolve to
  // `Claude Code-credentials-583dfe92`. Keying on the derived name makes the guard agree with the thing it
  // guards by construction, including if that derivation ever changes.
  const storeKey = claudeStoreService({ storeDir: account.storeDir });
  if (attemptedStores.has(storeKey)) {
    // Two configured aliases can name one physical store, and one gate invocation may refresh a store once.
    return { account, decision: { kind: "skip", reason: "already-attempted" }, first };
  }
  attemptedStores.add(storeKey);
  // `current` IS the before-baseline. A second read here would open a window the
  // decision had not covered: another session could refresh the store between the two reads, or the grant could go
  // away, and the refresh would run anyway against a store that was no longer eligible. One reading decides and witnesses, so there is no gap to fall through.
  const before = current;
  const commandProblem = deps.refresh({ storeDir: account.storeDir });
  const after = deps.readLife({ account });
  return {
    account,
    after,
    before,
    decision,
    first,
    refresh: assessStoreRefresh({ after, before, ...(commandProblem === undefined ? {} : { commandProblem }) }),
  };
}

/**
 * The one line each store's repair reports, so a refused or repaired store is as visible as a routed one.
 *
 * It renders an alias, instants and a named reason — never an organisation, an email or a credential. Every
 * store gets a line only when something happened to it: a skip of `not-credential-rejected` is the ordinary
 * case for a healthy plan and saying so on every spawn would be the wall of text rule 7 bans.
 *
 * @param repair one store's pass through the gate
 * @param speaker which caller is speaking: the pre-spawn routing gate, or the standing keep-alive watch
 * @returns the line to print, or undefined when nothing about this store is worth a line
 */
export function renderRepair({
  repair,
  speaker = "claude routing",
}: {
  repair: StoreProbeRepair;
  speaker?: "claude routing" | "claude watch";
}): string | undefined {
  const alias = repair.account.alias;
  if (repair.decision.kind === "skip") {
    const reason = repair.decision.reason;
    if (reason === "not-credential-rejected") {
      return undefined;
    }
    const meaning = signInOnlyRepairSkipMeaning({ reason });
    const fix =
      meaning === undefined ? "" : `: ${meaning}; sign in again with \`slopweaver claude signin --plan ${alias}\``;
    return `${speaker}: ${alias} was refused and NOT repaired — ${reason}${fix}`;
  }
  if (repair.decision.kind === "reprobe") {
    return `${speaker}: ${alias} was refreshed by something else since the probe — re-probing, no refresh run`;
  }
  const outcome = repair.refresh;
  if (outcome === undefined) {
    return `${speaker}: ${alias} was due a repair and none was attempted`;
  }
  if (outcome.status === "failed") {
    return `${speaker}: ${alias} repair FAILED — ${outcome.problem}`;
  }
  const warning = outcome.commandProblem === undefined ? "" : ` (warning: ${outcome.commandProblem})`;
  const from = absentAs({ value: outcome.beforeExpiresAtIso, whenAbsent: "unknown" });
  return `${speaker}: ${alias} repaired on demand — expiry ${from} to ${outcome.afterExpiresAtIso}${warning}`;
}
