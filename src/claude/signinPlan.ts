/**
 * What each configured plan's sign-in row SAYS, decided purely — the core the walk, the status read and the
 * rendered page all share, so none of them can disagree about what green means.
 *
 * ## Why a row is not a boolean
 *
 * The owner's ask was a surface they can self-service every sign-in from, with something checking they landed
 * properly. "Landed properly" is where the difficulty is, and MEASURED it defeats every cheap
 * check: `plan-two` and `plan-three` both held a keychain item and neither held a login, so a presence check
 * called two logged-out stores green; and `plan-one` was live, spendable and holding a DIFFERENT account from
 * the one recorded for it, so a liveness check called a broken slot green too.
 *
 * So a row carries a state from {@link SigninRowState} rather than a flag, and three of those states exist
 * precisely because a two-state row would have had to call them green or red and would have been wrong:
 *
 * - `rate-limited` is signed in. Grading it red would send the owner to a browser to fix a budget, and the existing
 *   parser already refuses that conflation — only 401 and 403 are credential refusals (`usage.ts`), while a
 *   429 still carries the windows.
 * - `unverified` is a store whose credential exists but could not be read this pass. It is neither proof of
 *   health nor of failure, so it says so rather than guessing.
 * - `duplicate` is the one four individually-successful sign-ins cannot catch: the same account signed into
 *   two stores. Four greens is not four accounts, and only the second claim makes the owner's
 *   "90% on all four" acceptance test measurable.
 *
 * ## The organisation-id boundary is structural here
 *
 * An organisation id enters this module and never leaves it. {@link SigninRow} has no field that could hold
 * one, identity comparison goes through `identityAssertions.ts`'s {@link ClaudeIdentityStatus} which carries
 * none in any variant, and distinctness is reported as a COUNT and as aliases.
 *
 * The row DOES name an account, because a sign-in naming `plan-two` alone leaves the owner
 * unable to tell which of their accounts to sign in, and an address is an internal name rather than a
 * secret. What it carries is a DECIDED cell (`accountBinding.ts`), never the raw `accounts.json` string:
 * a row that set its address from config unconditionally, independently of the verdict it had
 * just computed, would let a `wrong-account` row print the stale address AS ITS NAME and contradicted itself two
 * columns later. A reader scans the name.
 *
 * ## A row grades TWO axes, and grading only the gauge printed a lie for five stores at once
 *
 * MEASURED, both halves inside one minute on one machine: `slopweaver claude signin --status`
 * printed `5 of 5 live, 5 distinct account(s)`, `VERIFIED` on every row and the verdict `every configured
 * plan is live, distinct and enrolled` — while every one of the five plan stores' keychain credentials held
 * an access token of length 0, a refresh token of length 0 and an `expiresAt` of 0. Reproduce the second
 * half with `security find-generic-password -a "$USER" -w -s "$(the store's service name)" | jq
 * '.claudeAiOauth | {acc: (.accessToken|length), ref: (.refreshToken|length), exp: .expiresAt}'`.
 *
 * Nothing had gone wrong with the reading. `probeStore.ts`'s `probePlan` probes a plan's SETUP TOKEN when its
 * store directory holds one, and returns before the keychain credential is ever presented — so the windows
 * and the account were genuinely that plan's, taken over a credential the store does not contain. This module
 * then graded `probe.gauge` alone, and a live token over a signed-out store came out `verified`.
 *
 * The lie was visible inside this repository at the time: `watchReport.ts`'s `signedOutLine` already printed
 * `SIGNED OUT — no touch repairs this, it needs one browser sign-in` for that exact credential shape, so two
 * surfaces described the same five stores in opposite words. So a row now grades the CREDENTIAL axis beside
 * the gauge, from the {@link SigninProbe.life} `probePlan` had been returning and the shell had been dropping,
 * and {@link SigninRowState}'s `token-only` is what a live token over a store holding no login reads as.
 *
 * Two consequences are the rule rather than a note:
 *
 * - **`verified` now means the STORE's own credential carried the reading.** It is the only thing that makes
 *   the word worth printing on a verb whose subject is sign-ins.
 * - **`token-only` is REPAIRABLE and is not `complete`.** A browser sign-in genuinely repairs a signed-out
 *   store, so the walk offers it (with its `skip`) and the verdict names it; and `signinRun.ts` already exits
 *   non-zero on an incomplete summary, which is the loud half. The `rate-limited` precedent argues the other
 *   way and does not apply — a browser sign-in cannot fix a budget, and it is exactly the repair here.
 * - **The credential axis is graded BEFORE the budget one, and the budget rides in the detail.** `verified`
 *   is not the only state that counts toward `complete`; `rate-limited` counts too, so grading the wall first
 *   left a corner where every plan hitting its weekly window over a signed-out store exits 0 saying `every
 *   configured plan is live, distinct and enrolled`. `decideRow`'s comment carries the whole reasoning.
 *
 * ## A row also carries RECENCY and a DEADLINE, and only one of the two expiries is the deadline
 *
 * The owner's acceptance test is about how long it has been since the owner last signed in and when they are next
 * forced to, and until this row carried them neither number was printed anywhere. Both arrive as INSTANTS and
 * the relative arithmetic happens in `signinRender.ts`, because this module is clockless on purpose: every
 * instant it handles arrives as data, and both renderers already take a `nowIso`.
 *
 * **The grant expiry is the deadline; the access expiry is not.** A credential carries
 * `refreshTokenExpiresAt` 27 to 29 days out beside the eight-hour `expiresAt`, and `credentialDocument.ts`'s
 * header records what happened when only the eight-hour number was read: an expired access token was treated
 * as a plan needing a browser sign-in when it is a cache miss repairable from a grant with weeks left. So
 * {@link SigninRow.grantExpiresAtIso} is what the human faces print, and
 * {@link SigninRow.accessExpiresAtIso} rides in `--json` for a session that wants it. Printing both with
 * equal weight in a row the owner reads would re-make that exact mistake.
 *
 * **An absent instant always means UNKNOWN and never means fine.** `StoreLife.refreshExpiresAtIso`'s own
 * comment says so, and an `unreadable` reading carries no usable instant whatever else it holds — the guard
 * `credentialRepair.ts`'s `knownExpiryMs` had to build for the same reason, because the TYPE permits a
 * combination the producer never emits.
 */
import { absentAs } from "#lib/absent.js";
import { accountCell, type ClaudeAccountCell } from "./accountBinding.js";
import type { ClaudeAccount, ClaudeAccountAlias, ClaudeAccountGauge } from "./contracts.js";
import type { StoreLife } from "./credentialRepair.js";
import {
  assertionFor,
  assessIdentity,
  type ClaudeIdentityAssertion,
  type ClaudeIdentityStatus,
} from "./identityAssertions.js";
import { type ClaudeSignIn, lastSignInByAlias } from "./signInLog.js";

/**
 * What one plan's sign-in row concluded. Ordered worst-first, which is the order a walk should offer them.
 */
export type SigninRowState =
  /** No usable token in the store. The real red, and the only state a sign-in repairs. */
  | "needs-sign-in"
  /** A credential exists but the store could not be read this pass — owed, not failed. */
  | "unverified"
  /** Live, but holding an account another store also holds. */
  | "duplicate"
  /** Live, but not the account this store was enrolled with. */
  | "wrong-account"
  /** Live and correct, but nothing has been enrolled for this store yet, so nothing was checked. */
  | "unbound"
  /** Live, and its plan-wide week is spent. An auth success and a budget fact. */
  | "rate-limited"
  /**
   * Live on its plan's SETUP TOKEN, over a store that holds no login of its own. The reading is real and the
   * plan is spendable; the store behind it is signed out, which only a browser sign-in repairs.
   */
  | "token-only"
  /**
   * Live on the STORE's own credential, windows parsed, account matches its enrollment, and no other store
   * shares it. The one state that asserts anything about a sign-in.
   */
  | "verified";

/**
 * One store's plan-wide readings, as percentages, safe to render.
 *
 * @internal — a field of {@link SigninRow}; renderers read it rather than constructing one.
 */
export interface SigninWindows {
  /** Absent on a plan with no five-hour limit — the Ultra shape (`contracts.ts`). */
  readonly fiveHourPercent?: number;
  readonly sevenDayPercent: number;
  /** Absent when the probe that produced the reading did not ask for a Fable window. */
  readonly sevenDayFablePercent?: number;
}

/**
 * One rendered sign-in row. Carries no organisation id — there is no field for one.
 */
export interface SigninRow {
  readonly alias: ClaudeAccountAlias;
  /** What this store's account may be called, and on whose authority. Never the bare configured string. */
  readonly account: ClaudeAccountCell;
  readonly state: SigninRowState;
  /** Why the row reads as it does, in the owner's terms. Never quotes a credential or an account. */
  readonly detail: string;
  /** The readings, absent when the store could not be read. */
  readonly windows?: SigninWindows;
  /**
   * When this store was last signed in through this verb, ISO-8601. Absent means the LOG holds no sign-in
   * for it — a fact about the record, never about the owner, and the normal reading on an install whose
   * stores were signed in before the log existed.
   */
  readonly lastSignInAtIso?: string;
  /**
   * When this store's own ACCESS token expires, ISO-8601. Absent means unknown. Deliberately NOT the number
   * the human faces print — see the file header's § A row also carries RECENCY and a DEADLINE.
   */
  readonly accessExpiresAtIso?: string;
  /**
   * When this store's REFRESH GRANT expires, ISO-8601 — the instant past which no refresh works and a
   * browser sign-in is forced. Absent means unknown, and never means there is no deadline.
   */
  readonly grantExpiresAtIso?: string;
}

/**
 * What one probe of one store found. The organisation id is the caller's to supply and this module's to
 * consume — it is never handed back.
 *
 * @internal — the input {@link planSignin} folds; built by the effectful shell from `probePlan`.
 */
export interface SigninProbe {
  readonly alias: ClaudeAccountAlias;
  readonly gauge?: ClaudeAccountGauge;
  /** The reason the store could not be read, when it could not. */
  readonly problem?: string;
  /** The account the provider named. A private identifier: consumed here, never returned. */
  readonly organizationId?: string;
  /**
   * That store's OWN credential, as `probePlan` read it out of the same keychain document — two instants and
   * three booleans, never a token. Absent when the shell supplied no reading, which is graded as unknown
   * rather than as a signed-out store.
   */
  readonly life?: StoreLife;
}

/**
 * What the whole walk concluded, and what remains of it.
 *
 * @internal — the `summary` half of {@link SigninPlan}; produced by {@link planSignin} alone.
 */
export interface SigninSummary {
  readonly configured: number;
  readonly live: number;
  /** How many DIFFERENT accounts the live stores hold. Equal to `live` only when none collide. */
  readonly distinctAccounts: number;
  readonly verified: number;
  /**
   * How many live plans are carried by a setup token over a store holding no login. Counted separately
   * because it is the one number that made a `5 of 5 live` header true and its `VERIFIED` rows false.
   */
  readonly tokenOnly: number;
  /** The stores a sign-in would still repair, worst-first. */
  readonly remaining: readonly ClaudeAccountAlias[];
  /**
   * Whether every configured store is live, distinct, enrolled and holding its OWN login — the completion
   * criterion, and the precondition for the owner's "at least 90% on all four" acceptance test meaning
   * anything. A `token-only` plan is none of the four short of the last, and it is excluded on purpose:
   * `signinRun.ts`'s `report` and `walk` both exit non-zero on an incomplete summary, so this boolean is
   * where the verb fails loudly rather than in a wording.
   */
  readonly complete: boolean;
}

/** A planned walk: one row per configured plan, plus what it all adds up to. */
export interface SigninPlan {
  readonly rows: readonly SigninRow[];
  readonly summary: SigninSummary;
}

/** The utilization at or past which a plan-wide window is reported as spent rather than merely high. */
const SPENT_UTILIZATION = 1;

/**
 * Whether a reading shows the plan-wide week actually refused rather than merely nearly spent.
 *
 * Keyed on the provider's own `status` first, because that is its statement rather than our arithmetic; the
 * utilization comparison only catches a reading that reports a full window without having been refused yet.
 *
 * @param gauge the plan's reading
 * @returns whether this plan is signed in but out of week
 */
function isRateLimited({ gauge }: { gauge: ClaudeAccountGauge }): boolean {
  return gauge.sevenDay.status === "rejected" || gauge.sevenDay.utilization >= SPENT_UTILIZATION;
}

/**
 * A reading's windows as whole percentages.
 *
 * @param gauge the plan's reading, whose utilizations are 0..1 rather than percentages
 * @returns the same three numbers, rounded, for rendering
 */
function windowsOf({ gauge }: { gauge: ClaudeAccountGauge }): SigninWindows {
  const pct = ({ utilization }: { utilization: number }): number => Math.round(utilization * 100);
  return {
    sevenDayPercent: pct({ utilization: gauge.sevenDay.utilization }),
    ...(gauge.fiveHour === undefined ? {} : { fiveHourPercent: pct({ utilization: gauge.fiveHour.utilization }) }),
    ...(gauge.sevenDayFable === undefined
      ? {}
      : { sevenDayFablePercent: pct({ utilization: gauge.sevenDayFable.utilization }) }),
  };
}

/**
 * Whether a probe's failure is specifically "no login here" rather than an unreadable store.
 *
 * The distinction is the difference between sending the owner to a browser and telling the owner a check is owed,
 * so it is keyed on the store-not-ready message this repository itself produces rather than on any substring
 * of a provider's wording.
 *
 * @param problem the reason the probe gave
 * @returns whether a sign-in is the repair
 */
function isNoLogin({ problem }: { problem: string }): boolean {
  return problem.includes("holds no login");
}

/**
 * The sentence for a plan the provider answered over its setup token while its own store holds no login.
 *
 * The two cases the wording tells apart are the two `readStoreLife` can produce, and no more:
 * `unreadable` collapses an absent keychain item and a read that failed — a locked keychain, a `security`
 * timeout — into one conservative answer, with its own comment in `storeRefresh.ts` saying so. They stay ONE
 * state because the input cannot support a second, and because a browser sign-in is the move either way; the
 * `needs-sign-in`/`unverified` pair above splits only where the ACTION differs.
 *
 * It does not say the next token mint needs this store signed in, because it does not: `claude setup-token`
 * is its own browser sign-in (`cli/commands/claude/tokenRun.ts`). The honest claim is about the store alone.
 *
 * @param life that store's own credential, as the shell read it
 * @param spent whether this plan's own weekly window is exhausted, appended rather than dropped
 * @returns the explanation, carrying no credential and no account
 */
function tokenOnlyDetail({ life, spent }: { life: StoreLife; spent: boolean }): string {
  const week = spent ? ", and its plan-wide week is spent" : "";
  if (life.unreadable === true) {
    return (
      "live on its setup token, and its own store's credential could not be read this pass — nothing here " +
      `proves a sign-in${week}`
    );
  }
  return (
    "live on its setup token, but its own store is SIGNED OUT — no refresh repairs that, only one browser " +
    `sign-in${week}`
  );
}

/**
 * Decide one row's state and the sentence that explains it.
 *
 * @param probe what this store's probe found
 * @param status what comparing its account against its enrollment concluded
 * @param collides whether another store holds the same account
 * @param enrolledEmail the address the enrollment bound, named in the sentence where the row's NAME may no
 *   longer name it
 * @returns the state and its explanation, with no private identifier in either
 */
function decideRow({
  collides,
  enrolledEmail,
  probe,
  status,
}: {
  collides: boolean;
  enrolledEmail?: string;
  probe: SigninProbe;
  status: ClaudeIdentityStatus;
}): { readonly state: SigninRowState; readonly detail: string } {
  if (probe.gauge === undefined) {
    const problem = absentAs({ value: probe.problem, whenAbsent: "the store could not be read" });
    if (isNoLogin({ problem })) {
      return { detail: "no login in this store — one browser sign-in repairs it", state: "needs-sign-in" };
    }
    return { detail: `a credential exists but could not be read this pass: ${problem}`, state: "unverified" };
  }
  if (collides) {
    return {
      detail: "live, but another store holds this same account — two slots cannot share one plan",
      state: "duplicate",
    };
  }
  if (status.kind === "changed") {
    // The address belongs in the SENTENCE and never in the row's name here: it says what should be in this
    // store, and a name saying it would read as what IS in it.
    const wanted = enrolledEmail === undefined ? "" : ` (enrolled as ${enrolledEmail})`;
    return {
      detail: `live, but NOT the account enrolled for this store on ${status.assertedAtIso}${wanted} — a sign-in replaced it`,
      state: "wrong-account",
    };
  }
  if (status.kind === "unbound") {
    return { detail: "live, but no account has been enrolled for this store yet", state: "unbound" };
  }
  // The CREDENTIAL axis wins the STATE and the budget axis rides in the DETAIL, which is the opposite of how
  // this was first written. Grading the budget first looked safer — a wall is a fact about the account the
  // token named, true whichever credential carried the reading — but `rate-limited` counts toward `verified`,
  // so five spent weeks over the five signed-out stores would have exited 0 under the verdict
  // `every configured plan is live, distinct and enrolled`. That is the exact lie `token-only` exists to kill,
  // surviving in the one corner where nobody would look for it. Nothing is lost: the wall is still named.
  const spent = isRateLimited({ gauge: probe.gauge });
  const { life } = probe;
  if (life !== undefined && !life.hasCredential) {
    return { detail: tokenOnlyDetail({ life, spent }), state: "token-only" };
  }
  if (spent) {
    return { detail: "signed in and correct; its plan-wide week is spent", state: "rate-limited" };
  }
  return { detail: "live on its own store, windows read, and the account matches its enrollment", state: "verified" };
}

/**
 * The states a sign-in actually repairs. A row in any other state is not offered for a login.
 *
 * `token-only` is in the set because a browser sign-in genuinely repairs a signed-out store, and because the
 * alternative renders an incoherent surface: the summary would be incomplete while the verdict read `still
 * to do: nothing a sign-in repairs`. The walk offers each of these with an explicit `skip`, so membership is
 * an offer rather than a march.
 */
const REPAIRABLE: ReadonlySet<SigninRowState> = new Set(["needs-sign-in", "duplicate", "wrong-account", "token-only"]);

/**
 * One configured plan's row — its identity verdict, the state that verdict grades to, and the account cell
 * both of them decide.
 *
 * Split out of {@link planSignin} because the two levels answer different questions: this one is about a
 * single store, and the caller is about the set. Pure, and it consumes the organisation id rather than
 * returning one, exactly as its caller's contract promises.
 *
 * @param collides another configured store was seen holding this same account
 * @param probe what this store's probe found
 * @param signIns every sign-in this verb has recorded, newest last
 * @returns the row this plan contributes to the walk
 */
function signinRowFor({
  account,
  assertions,
  collides,
  probe,
  signIns,
}: {
  account: ClaudeAccount;
  assertions: readonly ClaudeIdentityAssertion[];
  collides: boolean;
  probe: SigninProbe;
  signIns: readonly ClaudeSignIn[];
}): SigninRow {
  const assertion = assertionFor({ alias: account.alias, assertions });
  const status = assessIdentity({
    alias: account.alias,
    ...(assertion === undefined ? {} : { assertion }),
    ...(probe.organizationId === undefined ? {} : { observedOrganizationId: probe.organizationId }),
  });
  const { detail, state } = decideRow({
    collides,
    probe,
    status,
    ...(assertion?.email === undefined ? {} : { enrolledEmail: assertion.email }),
  });
  const lastSignInAtIso = lastSignInByAlias({ alias: account.alias, signIns });
  return {
    account: accountCell({
      status,
      ...(account.email === undefined ? {} : { cachedEmail: account.email }),
      ...(assertion?.email === undefined ? {} : { enrolledEmail: assertion.email }),
    }),
    alias: account.alias,
    detail,
    state,
    ...(probe.gauge === undefined ? {} : { windows: windowsOf({ gauge: probe.gauge }) }),
    ...(lastSignInAtIso === undefined ? {} : { lastSignInAtIso }),
    ...expiriesOf(probe.life === undefined ? {} : { life: probe.life }),
  };
}

/**
 * The two credential instants a row may carry, taken only from a reading that actually carried them.
 *
 * A reading the shell never supplied, and one that explicitly could not be read, both yield NOTHING rather
 * than an instant: `readStoreLife` answers `{ hasCredential: false, hasRefreshToken: false, unreadable: true }`
 * for a locked keychain or a `security` timeout, and reporting a deadline off that is reporting a deadline
 * off a store nobody read this pass.
 *
 * @param life that store's own credential as the shell read it, absent when it supplied no reading
 * @returns whichever of the two instants is genuinely known
 */
function expiriesOf({ life }: { life?: StoreLife }): {
  readonly accessExpiresAtIso?: string;
  readonly grantExpiresAtIso?: string;
} {
  if (life === undefined || life.unreadable === true) {
    return {};
  }
  return {
    ...(life.expiresAtIso === undefined ? {} : { accessExpiresAtIso: life.expiresAtIso }),
    ...(life.refreshExpiresAtIso === undefined ? {} : { grantExpiresAtIso: life.refreshExpiresAtIso }),
  };
}

/** What the probe found for one plan's store, or a stand-in saying that store was never probed. */
function probeFor({ alias, byAlias }: { alias: string; byAlias: ReadonlyMap<string, SigninProbe> }): SigninProbe {
  const probe = byAlias.get(alias);
  if (probe === undefined) {
    return { alias, problem: "this store was not probed" };
  }
  return probe;
}

/**
 * Plan the walk: one row per configured plan, and what the whole set adds up to.
 *
 * Pure. Every organisation id it is handed is consumed to compute identity and distinctness and is absent
 * from everything returned.
 *
 * @param accounts the configured plans, in file order
 * @param assertions every standing enrollment
 * @param probes what each store's probe found, keyed by alias
 * @param signIns every recorded sign-in, in file order — empty when the log holds none
 * @returns a row per configured plan and the summary over them
 */
export function planSignin({
  accounts,
  assertions,
  probes,
  signIns,
}: {
  accounts: readonly ClaudeAccount[];
  assertions: readonly ClaudeIdentityAssertion[];
  probes: readonly SigninProbe[];
  signIns: readonly ClaudeSignIn[];
}): SigninPlan {
  const byAlias = new Map(probes.map((probe) => [probe.alias, probe]));
  const liveOrganizations = probes.flatMap((probe) =>
    probe.gauge !== undefined && probe.organizationId !== undefined ? [probe.organizationId] : [],
  );
  const counts = new Map<string, number>();
  for (const organization of liveOrganizations) {
    // The first live store naming an account opens its tally at one; each further one is a store sharing it.
    const held = counts.get(organization);
    counts.set(organization, held === undefined ? 1 : held + 1);
  }
  const shared = new Set([...counts].filter(([, held]) => held > 1).map(([organization]) => organization));

  const rows = accounts.map((account): SigninRow => {
    const probe = probeFor({ alias: account.alias, byAlias });
    return signinRowFor({
      account,
      assertions,
      collides: probe.organizationId !== undefined && shared.has(probe.organizationId),
      probe,
      signIns,
    });
  });

  const live = rows.filter((row) => row.windows !== undefined).length;
  const verified = rows.filter((row) => row.state === "verified" || row.state === "rate-limited").length;
  const tokenOnly = rows.filter((row) => row.state === "token-only").length;
  return {
    rows,
    summary: {
      complete: verified === accounts.length && counts.size === accounts.length,
      configured: accounts.length,
      distinctAccounts: counts.size,
      live,
      remaining: rows.filter((row) => REPAIRABLE.has(row.state)).map((row) => row.alias),
      tokenOnly,
      verified,
    },
  };
}
