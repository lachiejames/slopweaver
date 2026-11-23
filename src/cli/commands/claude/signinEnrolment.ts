/**
 * The ENROLLMENT half of `slopweaver claude signin` — the store that records which account belongs to which
 * plan, and the two acts that write it.
 *
 * Split from `signinRun.ts` on the seam its own test file already drew (`unit/claude/signinEnrolment.test.ts`):
 * that file is the walk, the prompts, the login launch and the rendering, and this one is everything that
 * READS OR WRITES an enrollment. Nothing here launches a login or prints a page.
 *
 * ## Two acts, and only one of them replaces anything
 *
 * {@link verifyAndEnroll} is what `--plan`, `--enroll` and the walk reach: it establishes an enrollment for a
 * store that has none and CHECKS one that stands, printing the registered `identity-reenroll` refusal on a
 * mismatch rather than overwriting. {@link reenrollMany} is the one deliberate replacement, judging the whole
 * named set at once because a set of swapped stores is a permutation no single-store order can clear.
 *
 * ## Both bind the ADDRESS, and that is why they are the only two
 *
 * `accounts.json`'s `email` is hand-typed and a `/login` does not touch it, so it drifts from the token
 * silently. An enrollment and a re-enrollment are the only instants a human
 * names a store, a live token and an address together, so both carry the configured address onto the
 * assertion beside the organisation they just probed. Nothing downstream can make that join: no query maps an
 * address to an organisation id, so an address not captured here can only ever be rendered as a cache.
 *
 * Every path that can write reads the enrollments STRICTLY first ({@link readAssertionsForWrite}), because
 * every write stores the whole file.
 */
import { lstatSync, readFileSync } from "node:fs";

import { cachedAccountCell } from "../../../claude/accountBinding.js";
import { ASSERTIONS_FILE, readAssertions } from "../../../claude/assertionStore.js";
import { claudeErrorLines } from "../../../claude/claudeErrors.js";
import { planLabel, planLabelFor } from "../../../claude/config.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import {
  type ClaudeIdentityAssertion,
  type ClaudeReenrollment,
  collidingAliases,
  establishAssertion,
  identityFileProblem,
  parseIdentityAssertions,
  reenrollAssertions,
} from "../../../claude/identityAssertions.js";
import type { probePlan } from "../../../claude/probeStore.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { writeJsonFile } from "../../../lib/jsonFile.js";
import { parseJson } from "../../../lib/jsonParse.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { type ClaudeCommandError, ClaudeCommandErrors, claudeCommandErrorLines } from "./errors.js";

/**
 * One plan as every line of this verb names it: the alias with its account beside it.
 *
 * @param account the configured plan
 * @returns the label
 */
export function labelOf({ account }: { account: ClaudeAccount }): string {
  // Config alone, said to be config: these lines are written before or beside a probe rather than out of
  // one, so they cannot claim a token-derived account and must not look as though they do.
  const cell = cachedAccountCell(account.email === undefined ? {} : { cachedEmail: account.email });
  return planLabel({ alias: account.alias, cell });
}

/**
 * The standing enrollments for any path that may WRITE them — an enrollment or a re-enrollment — failing
 * CLOSED where {@link readAssertions} is tolerant.
 *
 * The tolerant read answers `[]` for a file it cannot use, which is right for a status read and wrong for a
 * write: every write stores the whole list, so a list read as empty would silently drop every row the reader
 * could not parse. So only a genuinely ABSENT file reads empty here, and anything unreadable, undecodable or
 * wrong-shaped refuses before a store is probed or a byte is written.
 *
 * A write path also PRINTS what it read — a row's alias in a collision refusal, its `assertedAtIso` as the
 * previous enrollment — and the shape check accepts any string in either. So a row whose alias is not a
 * configured plan, or whose instant is not the canonical ISO string an enrollment writes, refuses too.
 *
 * @internal — exported so the fail-closed cases are provable against a real file.
 *
 * @param home the Slopweaver home to read from
 * @param configured every configured plan's alias — the only names a stored row may carry
 * @returns every enrollment, or why the file cannot be trusted with a write
 */
export function readAssertionsForWrite({
  configured,
  home,
}: {
  configured: readonly string[];
  home: string;
}): Result<readonly ClaudeIdentityAssertion[], ClaudeCommandError> {
  const path = `${home}/${ASSERTIONS_FILE}`;
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "readAssertionsForWrite", path });
  if (read.isErr()) {
    // ENOENT alone does not prove absence: a dangling symlink is present and still answers ENOENT on read.
    const present = safeFs({ execute: () => lstatSync(path), operation: "readAssertionsForWrite", path }).isOk();
    return read.error.code === "ENOENT" && !present ? ok([]) : err(ClaudeCommandErrors.assertionsUnreadable());
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return err(ClaudeCommandErrors.assertionsNotJson());
  }
  // `identityFileProblem` reads null as "no file", which is right for the tolerant read and wrong here: the
  // file IS present, and reading it as empty would let one enrollment overwrite whatever it was meant to hold.
  if (decoded.value === null) {
    return err(ClaudeCommandErrors.assertionsHoldNull());
  }
  const problem = identityFileProblem({ value: decoded.value });
  if (problem !== undefined) {
    return err(ClaudeCommandErrors.assertionsWrongShape({ problem }));
  }
  const assertions = parseIdentityAssertions({ value: decoded.value });
  if (assertions.some((row) => !configured.includes(row.alias))) {
    return err(ClaudeCommandErrors.assertionStoreUnconfigured());
  }
  if (assertions.some((row) => !isCanonicalInstant({ value: row.assertedAtIso }))) {
    return err(ClaudeCommandErrors.assertionInstantInvalid());
  }
  return ok(assertions);
}

/**
 * Whether a stored instant is exactly the ISO string an enrollment writes. `Date.parse` alone is not enough:
 * it rolls an impossible calendar date such as 1999-02-31 forward into March rather than rejecting it.
 *
 * @param value the stored `assertedAtIso`
 * @returns true only when the value round-trips through `toISOString` unchanged
 */
function isCanonicalInstant({ value }: { value: string }): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

/**
 * Persist the standing enrollments, atomically.
 *
 * @internal — exported so the round-trip against {@link readAssertions} is provable rather than assumed.
 *
 * @param assertions every enrollment to store, in order
 * @param home the Slopweaver home to write under
 * @returns nothing
 */
export function writeAssertions({
  assertions,
  home,
}: {
  assertions: readonly ClaudeIdentityAssertion[];
  home: string;
}): void {
  // The envelope is `{ assertions: [...] }`, not a bare array: `parseIdentityAssertions` reads that key and
  // answers an empty list for anything else, so a bare array would enroll and then silently read back unbound.
  writeJsonFile({ path: `${home}/${ASSERTIONS_FILE}`, value: { assertions } });
}

/** The store probe, injected so a test can hand the shell a fixed reading without a live store. */
type ProbeStore = typeof probePlan;

/** What one sign-in, enrollment or re-enrollment attempt concluded. */
export interface SigninAttemptOutcome {
  /** What to print, in order. */
  readonly lines: readonly string[];
  /** Whether the store now holds the account enrolled for it. The exit code reads this, never the wording. */
  readonly ok: boolean;
}

/**
 * The line a store that answered no readable login reports.
 *
 * @param label the store, named with its account
 * @param problem what the probe said, when it said anything
 * @returns the line
 */
function notVerifiedLine({
  label,
  problem = "the store still holds no readable login",
}: {
  label: string;
  problem: string | undefined;
}): string {
  return `${label}: NOT VERIFIED — ${problem}`;
}

/**
 * Re-read one store after a sign-in and enroll whatever landed, when nothing was enrolled before.
 *
 * The enrollment is the FIRST-RUN half of the owner's two-phase contract, and it is safe here in a way it is
 * not on a sweep: this runs immediately after a login the owner just performed, so what landed is what they
 * just chose. `establishAssertion` still refuses to overwrite a standing enrollment, so a re-sign-in of an
 * already-enrolled store with a different account prints the registered `identity-reenroll` refusal and
 * writes nothing — replacing it is `--reenroll`, a separate deliberate act.
 *
 * It reads the enrollments STRICTLY, as `--reenroll` does, because an enrollment writes the whole file: read
 * tolerantly, a malformed file answers `[]`, the store "establishes", and one row overwrites every other.
 *
 * @internal — exported so the refusal and each outcome are provable against a real file and a fixed reading.
 *
 * @param account the plan just signed in
 * @param home the Slopweaver home
 * @param nowIso the instant to stamp an enrollment with
 * @param probe the store probe — `probePlan` in production
 * @param configured every configured plan's alias, which the strict read holds each stored row to
 * @returns the lines to print and whether the store holds its enrolled account
 */
export async function verifyAndEnroll({
  account,
  configured,
  home,
  nowIso,
  probe,
}: {
  account: ClaudeAccount;
  configured: readonly string[];
  home: string;
  nowIso: string;
  probe: ProbeStore;
}): Promise<SigninAttemptOutcome> {
  const standingRead = readAssertionsForWrite({ configured, home });
  if (standingRead.isErr()) {
    return {
      lines: claudeCommandErrorLines({ error: standingRead.error }).map(
        (problem) => `${labelOf({ account })}: NOT ENROLLED — ${problem}`,
      ),
      ok: false,
    };
  }
  const before = standingRead.value;
  const result = await probe({ alias: account.alias, nowIso, storeDir: account.storeDir });
  if (result.outcome.gauge === undefined || result.organizationId === undefined) {
    return { lines: [notVerifiedLine({ label: labelOf({ account }), problem: result.outcome.problem })], ok: false };
  }
  // The address is bound HERE, at the one instant a human names a store, a live token and an address
  // together. Nothing downstream can make that join: no query maps an address to an organisation id, so an
  // address not captured now is a string that can only ever be shown as an unverified cache.
  const { assertions, established } = establishAssertion({
    alias: account.alias,
    assertions: before,
    nowIso,
    organizationId: result.organizationId,
    ...(account.email === undefined ? {} : { email: account.email }),
  });
  return settleEnrollment({
    account,
    assertions,
    before,
    established,
    home,
    nowIso,
    organizationId: result.organizationId,
  });
}

/**
 * What an enrollment attempt means once the store has answered: a duplicate account, a first enrollment
 * written, the same account already enrolled, or the refusal that sends the caller to `--reenroll`.
 *
 * Split out of {@link verifyAndEnroll} so the probe and the decision read as two things; it is the only
 * writer on the enrollment path.
 *
 * @param before the enrollments as they stood, which is where the standing row is read from
 * @param established whether {@link establishAssertion} added a row rather than declining to overwrite one
 * @param organizationId the account the store answered with
 * @returns the lines to print and whether the attempt succeeded
 */
function settleEnrollment({
  account,
  assertions,
  before,
  established,
  home,
  nowIso,
  organizationId,
}: {
  account: ClaudeAccount;
  assertions: readonly ClaudeIdentityAssertion[];
  before: readonly ClaudeIdentityAssertion[];
  established: boolean;
  home: string;
  nowIso: string;
  organizationId: string;
}): SigninAttemptOutcome {
  const collisions = collidingAliases({ assertions });
  if (collisions.includes(account.alias)) {
    return {
      lines: [
        `${labelOf({ account })}: DUPLICATE — this account is already enrolled under ${collisions.filter((a) => a !== account.alias).join(", ")}; sign in a different account`,
      ],
      ok: false,
    };
  }
  if (established) {
    writeAssertions({ assertions, home });
    return {
      lines: [`${labelOf({ account })}: VERIFIED and enrolled — this account is now what this store must hold`],
      ok: true,
    };
  }
  const standing = before.find((entry) => entry.alias === account.alias);
  if (standing?.organizationId === organizationId) {
    return { lines: [`${labelOf({ account })}: VERIFIED — same account as enrolled`], ok: true };
  }
  // A row read strictly is present here in every reachable case; `unknown` names the one the reader cannot
  // otherwise account for rather than leaving the refusal with a blank where an instant should be.
  const enrolledAt = standing === undefined ? "unknown" : standing.assertedAtIso;
  return {
    lines: hatchRefusalLines({
      detail: `plan: ${labelOf({ account })}; enrolled at: ${enrolledAt}; attempted at: ${nowIso}`,
      hatch: hatchFor({ id: "identity-reenroll" }),
    }),
    ok: false,
  };
}

/**
 * One re-enrolled store as its own success line names it: the address the write just BOUND to it.
 *
 * @param accounts the plans named in this invocation
 * @param alias the store that was re-enrolled
 * @param changes what was written, which is where the newly bound address is
 * @returns the label, falling back to the configured one for a store whose row bound no address
 */
function reenrolledLabel({
  accounts,
  alias,
  changes,
}: {
  accounts: readonly ClaudeAccount[];
  alias: string;
  changes: readonly ClaudeReenrollment[];
}): string {
  const bound = changes.find((change) => change.alias === alias)?.email;
  if (bound === undefined) {
    return planLabelFor({ accounts, alias });
  }
  return planLabel({ alias, cell: { address: bound, trust: "bound" } });
}

/**
 * Re-bind one or more already-live stores to the accounts they hold now — the deliberate re-enrollment, and
 * the only path that replaces a standing enrollment.
 *
 * It launches no login: the account to bind is whichever one the owner already put in each store. It reads
 * the enrollments strictly, probes every named store, and replaces every named row in ONE judgement through
 * {@link reenrollAssertions}, because a set of swapped stores is a permutation that no single-store order can
 * clear. One unreadable store refuses the whole set. It writes once, and every refusal writes nothing.
 *
 * @internal — exported so the replacement and every refusal are provable against a real file.
 *
 * @param accounts the plans to re-enroll, at least one
 * @param home the Slopweaver home
 * @param nowIso the instant to stamp the new enrollments with
 * @param probe the store probe — `probePlan` in production
 * @param configured every configured plan's alias, which the strict read holds each stored row to
 * @returns the lines to print and whether every named store is now enrolled to the account it holds
 */
export async function reenrollMany({
  accounts,
  configured,
  home,
  nowIso,
  probe,
}: {
  accounts: readonly ClaudeAccount[];
  configured: readonly string[];
  home: string;
  nowIso: string;
  probe: ProbeStore;
}): Promise<SigninAttemptOutcome> {
  const standing = readAssertionsForWrite({ configured, home });
  if (standing.isErr()) {
    return {
      lines: claudeCommandErrorLines({ error: standing.error }).map((problem) => `NOT RE-ENROLLED — ${problem}`),
      ok: false,
    };
  }
  const changes: ClaudeReenrollment[] = [];
  const unreadable: string[] = [];
  for (const account of accounts) {
    const result = await probe({ alias: account.alias, nowIso, storeDir: account.storeDir });
    if (result.outcome.gauge === undefined || result.organizationId === undefined) {
      unreadable.push(notVerifiedLine({ label: labelOf({ account }), problem: result.outcome.problem }));
    } else {
      changes.push({
        alias: account.alias,
        organizationId: result.organizationId,
        ...(account.email === undefined ? {} : { email: account.email }),
      });
    }
  }
  if (unreadable.length > 0) {
    return {
      lines: [...unreadable, "NOT RE-ENROLLED — every named store must be readable, so nothing was changed"],
      ok: false,
    };
  }
  const replaced = reenrollAssertions({ assertions: standing.value, changes, nowIso });
  if (replaced.isErr()) {
    return { lines: claudeErrorLines({ error: replaced.error }), ok: false };
  }
  writeAssertions({ assertions: replaced.value.assertions, home });
  return {
    lines: replaced.value.replaced.map(
      (row) =>
        // The address this line names is BOUND as of the write above, not cached: saying `CACHED` on the
        // very line reporting the act that binds it would tell the reader the opposite of what happened.
        `${reenrolledLabel({ accounts, alias: row.alias, changes })}: RE-ENROLLED — previous enrollment: ${row.replacedAssertedAtIso}; new enrollment: ${nowIso}`,
    ),
    ok: true,
  };
}
