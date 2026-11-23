/**
 * Parse the configured set of Claude plans. Pure — the caller reads the file, this decides whether what it
 * read is usable.
 *
 * **N plans, one included.** Adding another plan is easy, and rotation does not need two
 * plans. So this enforces no count at all: nothing here, and nothing in `select.ts`, knows how
 * many plans exist, and {@link parseClaudeAccounts} is the one parser for the register's write path and every reader.
 *
 * **An alias is a NEUTRAL LOCAL LABEL.** Never an email address, an organisation name, or an account UUID:
 * the alias names the store directory, and a store outlives whichever account is signed into it. That is
 * enforced here rather than left to the person writing the config.
 *
 * **A plan's account is printed BESIDE the alias, and `email` here is a DISPLAY CACHE rather than that
 * account.** An instruction reading `--plan plan-two` leaves the owner unable to tell
 * which of their accounts it means, so they pick one and it could be the wrong one. {@link planLabel} is
 * the one rendering of that pair, and every surface naming a plan to the owner goes through it. An email is
 * per-install state rather than a secret (AGENTS.md, "no organisation names in what you commit"), so it lives in
 * `$SLOPWEAVER_HOME`, never in git. The organisation id is still never rendered: it identifies nothing the owner
 * can act on.
 *
 * What matters is WHOSE WORD the printed address is. This file's `email` is hand-typed and a
 * `/login` does not touch it, so it drifts from the token independently and silently. The address a surface
 * may call the account is the one an ENROLLMENT bound to a live token
 * (`identityAssertions.ts`); this one is a cache, is labelled as one wherever it is shown, and may never be
 * used as identity by any verb — `claude-email-not-identity` in `yarn lint`. {@link planLabel} therefore
 * takes a decided `ClaudeAccountCell`, never a bare string.
 *
 * ## The store-path convention, and why it is the weakest claim that covers the case
 *
 * What the sign-in walk provisioned IS the convention, written down here. The owner cares about the outcome
 * rather than the internals, and the definition of done is: **the owner should not have to sign in again to
 * any plan for at least a week.**
 *
 * A plan's store lives at `$SLOPWEAVER_HOME/claude-accounts/<alias>`, mode `0700`, with no `pinned` key
 * unless it is the one pinned plan. That is not a scheme anyone invented: it is what `plan-one`, `plan-two`
 * and `plan-three` already were, so the fourth matched its siblings and the convention is simply what the
 * install already is. MEASURED: all four configured stores match it exactly, which is why
 * adopting it needed no migration and no fleet-down window.
 *
 * **THE SHARP EDGE, and it is the reason this is written down rather than left implicit.** The alias IS the
 * directory name, and `storeService.ts` derives the keychain service by hashing that PATH. So renaming a plan
 * does not rename its credential — the new name addresses a different, empty keychain item while the old one
 * lingers under the old hash. **A rename is a re-enrollment**, and a rename performed as a tidy-up is a
 * silent way to strand a signed-in account, which is precisely the class this feature exists to close.
 *
 * {@link conventionalStoreDir} and {@link storeDirDepartures} make that checkable rather than prose. They
 * REPORT rather than refuse: an install whose paths differ is unusual, not broken, and a gate that refused
 * one would take the fleet down to enforce a naming preference.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { hasLineBreak } from "#lib/lineBreaks.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { lapseProblems } from "../plans/lapse.js";
import { decodePlanAllowance, decodeUsageLimitPercent, usageLimitProblems } from "../plans/usageLimit.js";
import { type ClaudeAccountCell, cachedAccountCell, renderAccountCell } from "./accountBinding.js";
import type { ClaudeAccount, ClaudeAccountAlias, ClaudePausedPlan } from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import { claudeStoreService } from "./storeService.js";

/** A neutral label: lowercase letters, digits and single hyphens. An `@` or a dot cannot survive this. */
const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Longest alias worth having — long enough to be descriptive, short enough to fit a sidebar row. */
const ALIAS_MAX_LENGTH = 32;

/**
 * Narrow a decoded entry to a usable account. A predicate, so the compiler proves the shape rather than an
 * assertion claiming it — the same reason {@link entryProblems} reports rather than throws.
 *
 * @param entry one decoded element of the configured list
 * @returns whether the entry carries both a string alias and a string store directory
 */
function isAccountEntry(entry: unknown): entry is ClaudeAccount {
  return isRecord(entry) && typeof entry["alias"] === "string" && typeof entry["storeDir"] === "string";
}

/**
 * The alias pinned seats boot against, when one is configured.
 *
 * @param accounts the configured plans
 * @returns the pinned alias, or undefined when none is marked
 */
export function pinnedAccountAlias({ accounts }: { accounts: readonly ClaudeAccount[] }): string | undefined {
  return accounts.find((account) => account.pinned === true)?.alias;
}

/**
 * Read one entry's `paused` value into the contract, after {@link entryProblems} has already reported any
 * malformed one.
 *
 * It re-checks rather than trusting, because {@link isAccountEntry} narrows on `alias` and `storeDir` alone
 * and says nothing about this field — the same reason the mapper re-checks `email`.
 *
 * @param paused the entry's `paused` value, as decoded
 * @returns the pause, or undefined when the plan is not paused
 */
function decodePaused({ paused }: { paused: unknown }): ClaudePausedPlan | undefined {
  if (!isRecord(paused)) {
    return undefined;
  }
  const reason = paused["reason"];
  const sinceIso = paused["sinceIso"];
  if (typeof reason !== "string" || typeof sinceIso !== "string") {
    return undefined;
  }
  return { reason, sinceIso };
}

/**
 * The plans the fleet may actually spend — every configured plan that is not paused, in configured order.
 *
 * **This is the ONE filter, and where it is applied is the design.** A site that acts on "the fleet" calls
 * it; a site acting on a plan the operator NAMED does not, because pausing a plan must never block signing
 * it back in. Concretely: the routing gate (`spawnStore.ts`), the fleet-wide gauge read and the keep-alive
 * loop filter; `claude rotate`, `claude signin`, `claude token` and `claude gauge --plan <alias>` do not.
 *
 * @param accounts the configured plans
 * @returns the unpaused plans, in configured order
 */
export function unpausedAccounts({ accounts }: { accounts: readonly ClaudeAccount[] }): readonly ClaudeAccount[] {
  return accounts.filter((account) => account.paused === undefined);
}

/**
 * The line every fleet surface prints for one paused plan, instead of the provider refusal it would
 * otherwise print on every read.
 *
 * It names no instant but the one the row carries: a pause is a state, not a countdown, so this never
 * renders a deadline or an elapsed target the reader is meant to act on.
 *
 * @param account the paused plan
 * @returns the line, or undefined when the plan is not paused
 */
export function pausedPlanLine({ account }: { account: ClaudeAccount }): string | undefined {
  if (account.paused === undefined) {
    return undefined;
  }
  return (
    `${account.alias} is PAUSED since ${account.paused.sinceIso} — ${account.paused.reason}. It is not ` +
    `probed and not routed, but every fleet count still lists it as paused; ` +
    `\`slopweaver claude resume ${account.alias}\` puts it back.`
  );
}

/**
 * A plan as the owner reads it: the alias with what its store's account may be called beside it, e.g.
 * `plan-two (security@slopweaver.ai)`.
 *
 * An unmapped plan says so rather than printing the bare alias, because a bare alias is exactly the line that
 * sends the owner to guess.
 *
 * **It takes a decided cell rather than a string, and that is the whole point.** A label built from a bare
 * address cannot distinguish an address an enrollment bound to this store's live token from one somebody
 * typed into `accounts.json` and nothing ever checked — and printing the second as though it were the first
 * is the confusion the owner asked to end (`accountBinding.ts`). A caller holding only config builds its
 * cell with {@link cachedAccountCell}, which says so.
 *
 * @param alias the plan's neutral local label
 * @param cell what its account may be called, and on whose authority
 * @returns the label every surface naming a plan to the owner prints
 */
export function planLabel({ alias, cell }: { alias: ClaudeAccountAlias; cell: ClaudeAccountCell }): string {
  if (cell.trust === "bound-cache-stale") {
    // The one form `renderAccountCell` spells with its own parentheses, which would nest inside the label's.
    return `${alias} (${cell.address}; accounts.json says ${cell.staleCache})`;
  }
  if (cell.trust === "unmapped") {
    return `${alias} (UNMAPPED — add its email to accounts.json)`;
  }
  return `${alias} (${renderAccountCell({ cell })})`;
}

/**
 * {@link planLabel} for an alias looked up among the configured plans, by a caller that has read no token.
 *
 * It can only ever produce a `cached` or `unmapped` label, because config alone is all it has seen. A caller
 * that DID probe passes its own decided cell to {@link planLabel} instead.
 *
 * @param accounts the configured plans
 * @param alias the plan to label
 * @returns the label, or the unmapped label when no configured plan carries that alias
 */
export function planLabelFor({ accounts, alias }: { accounts: readonly ClaudeAccount[]; alias: string }): string {
  const cachedEmail = accounts.find((account) => account.alias === alias)?.email;
  return planLabel({ alias, cell: cachedAccountCell(cachedEmail === undefined ? {} : { cachedEmail }) });
}

/**
 * Collect every problem with one candidate entry, so a caller sees all of them at once rather than fixing
 * them one run at a time.
 *
 * @param entry one decoded element of the configured list
 * @param index its position, for a message that can point at the offending entry
 * @returns every problem found, empty when the entry is usable
 */
function entryProblems({ entry, index }: { entry: unknown; index: number }): readonly string[] {
  const at = `entry ${index + 1}`;
  if (!isRecord(entry)) {
    return [`${at} is not an object`];
  }
  const problems: string[] = [];
  const alias = entry["alias"];
  if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
    problems.push(`${at} needs an \`alias\` of lowercase letters, digits and hyphens`);
  } else if (alias.length > ALIAS_MAX_LENGTH) {
    problems.push(`${at}'s alias is longer than ${ALIAS_MAX_LENGTH} characters`);
  }
  const storeDir = entry["storeDir"];
  if (typeof storeDir !== "string" || storeDir.trim() === "") {
    problems.push(`${at} needs a \`storeDir\` naming its credential store directory`);
  }
  const email = entry["email"];
  // A line break is refused, not cleaned: every surface prints this address beside the alias, and `tick open` lifts
  // gauge lines by their opening words, so an address spanning two lines would print a forged PLAN line.
  if (email !== undefined && (typeof email !== "string" || !email.includes("@") || hasLineBreak({ text: email }))) {
    problems.push(`${at}'s \`email\`, when present, must be the one-line address of the account its store holds`);
  }
  problems.push(...lapseProblems({ at, lapsesAtIso: entry["lapsesAtIso"] }));
  problems.push(...pausedProblems({ at, paused: entry["paused"] }));
  problems.push(
    ...usageLimitProblems({ allowance: entry["allowance"], at, usageLimitPercent: entry["usageLimitPercent"] }),
  );
  return problems;
}

/**
 * Every problem with one entry's `paused` value, empty when the plan is not paused at all.
 *
 * A malformed pause is a config problem rather than something to ignore, and the reason is the direction of
 * the failure: an ignored one leaves the plan IN the fleet while its row says it is out, which is the state
 * the operator wrote the row to end.
 *
 * @param at how to name the offending entry in a message
 * @param paused the entry's `paused` value, as decoded
 * @returns every problem found
 */
function pausedProblems({ at, paused }: { at: string; paused: unknown }): readonly string[] {
  if (paused === undefined) {
    return [];
  }
  if (!isRecord(paused)) {
    return [`${at}'s \`paused\`, when present, must be an object with \`reason\` and \`sinceIso\``];
  }
  const reason = paused["reason"];
  const sinceIso = paused["sinceIso"];
  const problems: string[] = [];
  if (typeof reason !== "string" || reason.trim() === "") {
    problems.push(`${at}'s \`paused.reason\` must say what the plan is waiting on`);
  }
  if (typeof sinceIso !== "string" || parseStrictIsoInstantMs({ text: sinceIso }) === undefined) {
    problems.push(`${at}'s \`paused.sinceIso\` must be an ISO-8601 instant`);
  }
  return problems;
}

/**
 * Report every value that appears more than once in a list.
 *
 * @param values the values to check
 * @param label what a duplicate of these is called, for the message
 * @returns one problem per duplicated value
 */
function duplicates({ label, values }: { label: string; values: readonly string[] }): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated].map((value) => `two accounts share the same ${label} \`${value}\``);
}

/**
 * Where a plan's credential store belongs under the convention.
 *
 * @param home the Slopweaver home, without a trailing slash
 * @param alias the plan's neutral local label
 * @returns the conventional store directory for that plan
 */
export function conventionalStoreDir({ home, alias }: { home: string; alias: ClaudeAccountAlias }): string {
  return `${home}/claude-accounts/${alias}`;
}

/**
 * Which configured plans sit somewhere other than their conventional path.
 *
 * Reported, never refused. A store elsewhere still works — the keychain service is derived from whatever
 * path is configured — so the only cost of departing is that the alias no longer predicts the location. A
 * refusal here would take a working fleet down over a naming preference, which is the opposite of the
 * outcome the convention exists to protect.
 *
 * @param accounts the configured plans
 * @param home the Slopweaver home, without a trailing slash
 * @returns the aliases whose `storeDir` is not the conventional one, in configured order
 */
export function storeDirDepartures({
  accounts,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  home: string;
}): readonly ClaudeAccountAlias[] {
  return accounts
    .filter((account) => account.storeDir !== conventionalStoreDir({ alias: account.alias, home }))
    .map((account) => account.alias);
}

/**
 * Validate a decoded account list: the ONE parser, for the register's write path and every reader alike.
 *
 * Zero, one or N rows are all valid. One plan is a whole fleet (rotation does not need two
 * plans; a supervisor handing off to a new supervisor is fine on one plan), and pausing every plan is a
 * deliberate stop the spawn gate names (`./spawnStoreRefusals.ts`'s `everyPlanPaused`), never a broken register.
 * Whether an EMPTY list means "nothing configured" or "a source somebody emptied" depends on where it came from,
 * so that judgement lives with the reader that knows (`./spawnAccounts.ts`), never here.
 *
 * @param value the decoded configuration — expected to be an array of `{ alias, storeDir }`
 * @returns the accounts in configured order, or every structural problem found at once
 */
export function parseClaudeAccounts({
  value,
}: {
  value: unknown;
}): Result<readonly ClaudeAccount[], ClaudeRotationError> {
  if (!Array.isArray(value)) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: ["the account list is not an array"] }));
  }
  const problems = value.flatMap((entry, index) => entryProblems({ entry, index }));
  if (problems.length > 0) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems }));
  }
  const accounts = value.filter(isAccountEntry).map((entry) => {
    const paused = decodePaused({ paused: entry.paused });
    return {
      alias: entry.alias,
      allowance: decodePlanAllowance({ allowance: entry.allowance }),
      storeDir: entry.storeDir,
      usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: entry.usageLimitPercent }),
      ...(entry.pinned === true ? { pinned: true as const } : {}),
      ...(typeof entry.email === "string" ? { email: entry.email } : {}),
      ...(typeof entry.lapsesAtIso === "string" ? { lapsesAtIso: entry.lapsesAtIso } : {}),
      ...(paused === undefined ? {} : { paused }),
    };
  });
  const pinnedCount = accounts.filter((account) => account.pinned === true).length;
  const pausedPin = accounts.find((account) => account.pinned === true && account.paused !== undefined);
  const structural = [
    ...(pinnedCount > 1 ? [`${String(pinnedCount)} accounts are marked pinned; exactly one may be`] : []),
    ...(pausedPin === undefined
      ? []
      : [
          `the pinned plan \`${pausedPin.alias}\` is paused; the pin decides where pages publish, so unpin ` +
            `before pausing it (\`slopweaver plans unpin\`)`,
        ]),
    ...duplicates({ label: "alias", values: accounts.map((a) => a.alias) }),
    // NFC, as the keychain hashes it (`aliasForStoreDir`): two spellings that normalise alike are ONE credential.
    ...duplicates({ label: "storeDir", values: accounts.map((a) => a.storeDir.normalize("NFC")) }),
    // Two DISTINCT paths whose truncated hash collides are still one keychain item, so one credential.
    ...duplicates({
      label: "keychain service",
      values: [...new Set(accounts.map((a) => a.storeDir.normalize("NFC")))].map((storeDir) =>
        claudeStoreService({ storeDir }),
      ),
    }),
  ];
  if (structural.length > 0) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: structural }));
  }
  return ok(accounts);
}

/**
 * The configured plan whose credential store one directory names.
 *
 * ## The comparison is the KEYCHAIN SERVICE each path derives, and that is not a shortcut
 *
 * The obvious instinct is to resolve both paths with `realpath` before comparing, so that a symlink or a
 * trailing slash cannot hide a match. That would be wrong here, and wrong in the expensive direction.
 * `storeService.ts` derives Claude Code's keychain service name by hashing the store path **as given**,
 * NFC-normalised — so two spellings of one directory are two DIFFERENT keychain items holding two
 * different credentials. Treating them as one store would have this loop skip a store that genuinely
 * needs a touch, on the belief that a session is already refreshing it. So this compares exactly what the
 * keychain compares, and a mismatch is a real mismatch rather than a normalisation the caller forgot. The
 * converse holds too: that hash is truncated, so two DIFFERENT paths can derive one service and be one
 * credential, and a match on the service is how a pin onto a paused plan's store is caught.
 *
 * @param accounts the configured plans
 * @param storeDir the store directory to resolve — typically `CLAUDE_SECURESTORAGE_CONFIG_DIR`
 * @returns the alias whose store is that directory, or undefined when no configured plan holds it
 */
export function aliasForStoreDir({
  accounts,
  storeDir,
}: {
  accounts: readonly ClaudeAccount[];
  storeDir: string;
}): ClaudeAccountAlias | undefined {
  const wanted = claudeStoreService({ storeDir });
  return accounts.find((account) => claudeStoreService({ storeDir: account.storeDir }) === wanted)?.alias;
}
