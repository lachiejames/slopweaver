/**
 * The Slopweaver home directory resolver — split out from `config.ts` into its own dependency-free leaf
 * module so `config.ts` and `stateHome.ts` can both depend on it without depending on EACH OTHER.
 * `config.ts` re-exports {@link slopweaverHome} unchanged, so every existing importer of it from
 * `config.js` needs no change; `stateHome.ts` imports it from here directly.
 */
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

/**
 * The Slopweaver home. `$SLOPWEAVER_HOME` if set, else `~/.slopweaver`. Everything on disk (the
 * corpus cache, the private hygiene denylist) lives under here; it never leaves the machine.
 *
 * `$SLOPWEAVER_HOME` is resolved to an absolute path against the current working directory before it is
 * returned — a relative value (a real onboarding gap: nothing here used to normalise it) would otherwise
 * silently mean a DIFFERENT directory depending on where a later command happens to run from, splitting one
 * install's corpus across multiple locations with no error at any point.
 *
 * @returns the absolute home directory path
 */
export function slopweaverHome(): string {
  return slopweaverHomeOf({ env: process.env });
}

/**
 * The Slopweaver home an injected environment names — {@link slopweaverHome}'s rule, applied to an env a
 * caller was handed rather than to this process's own. A gate that takes its environment as a seam reads the
 * home out of that same seam, so a test that names a temp home in the env it passes is read from that home,
 * and production, which passes `process.env`, gets exactly what {@link slopweaverHome} answers.
 *
 * @param env the environment to read `$SLOPWEAVER_HOME` from
 * @returns the absolute home directory path
 */
export function slopweaverHomeOf({ env }: { env: Readonly<Record<string, string | undefined>> }): string {
  const fromEnv = env["SLOPWEAVER_HOME"];
  return fromEnv != null && fromEnv.trim().length > 0 ? resolve(fromEnv) : userDefaultHome();
}

/** The home the open {@link runUnderHome} scopes name, how many are open, and the variable's value before the first. */
type HomeScope = { readonly home: string; open: number; readonly prior: string | undefined };

/**
 * Where the open scope lives: on `process` itself under a REGISTERED symbol, never in a module-level `let` nor on
 * `globalThis`. The variable it guards lives on `process.env`, so the ledger lives on the same object: a module can
 * be loaded twice (two specifiers resolving to one file, a test runner's fresh graph), and a VM realm sharing this
 * `process` has its own `globalThis`, and two private ledgers would each let the other's scope overlap and restore a
 * stale value. The symbol registry is shared across realms, so every copy finds one slot.
 */
const HOME_SCOPE_SLOT: unique symbol = Symbol.for("slopweaver.runUnderHome.scope");

/**
 * The process-wide ledger every copy of this module shares, created by whichever copy asks first.
 *
 * @returns the ledger; `current` is `undefined` when no scope is open
 */
function homeScopeLedger(): { current: HomeScope | undefined } {
  const host = process as typeof process & { [HOME_SCOPE_SLOT]?: { current: HomeScope | undefined } };
  const existing = host[HOME_SCOPE_SLOT];
  if (existing !== undefined) {
    return existing;
  }
  const created: { current: HomeScope | undefined } = { current: undefined };
  host[HOME_SCOPE_SLOT] = created;
  return created;
}

/**
 * The open scope when it names `home`, else a fresh one recording the variable as it stands now.
 *
 * @param home the absolute home the caller is entering
 * @returns the scope the caller counts itself into
 */
function joinOrOpenHomeScope({ home }: { home: string }): HomeScope {
  const ledger = homeScopeLedger();
  if (ledger.current !== undefined) {
    if (ledger.current.home !== home) {
      throw new Error(
        `runUnderHome: a scope under ${ledger.current.home} is still open — overlapping scopes would corrupt $SLOPWEAVER_HOME`,
      );
    }
    return ledger.current;
  }
  // An OWN entry only: an inherited property of that name is not a set variable, and restoring one would set it.
  const set = Object.hasOwn(process.env, "SLOPWEAVER_HOME");
  const opened: HomeScope = { home, open: 0, prior: set ? process.env["SLOPWEAVER_HOME"] : undefined };
  ledger.current = opened;
  return opened;
}

/**
 * The home the environment named before any open {@link runUnderHome} scope switched it: {@link slopweaverHome}
 * when none is open, else the value the first scope recorded. A caller that keeps the ORIGINAL home as well as the
 * one it enters reads it here, because a second caller joining an open same-home scope, from an unrelated async
 * context, finds the variable already switched and would otherwise take the scope's home for the original.
 *
 * @returns the absolute home the environment named before the open scopes, or now when none is open
 */
export function homeBeforeScopes(): string {
  const open = homeScopeLedger().current;
  if (open === undefined) {
    return slopweaverHome();
  }
  return slopweaverHomeOf({ env: { SLOPWEAVER_HOME: open.prior } });
}

/**
 * Run `run` with `$SLOPWEAVER_HOME` naming `home`, and put the variable back exactly as it was afterwards —
 * unset again when it was unset — whether `run` resolves or throws.
 *
 * For a verb that takes `--home <dir>` and then runs OTHER verbs from words that carry no home of their own,
 * whether in this process or in a child that inherits this environment: each of those resolves
 * {@link slopweaverHome} from the environment, so without this the inner verb writes to the AMBIENT home while
 * the outer one reads `<dir>`. MEASURED: `automation run-due --recipe store-backup-sweep-hourly --home
 * <throwaway>` swept the real install. Setting the variable rather than threading a parameter is what reaches a
 * verb child too, whose environment is copied from this one (`cli/commands/automation/runDueVerbProcess.ts`).
 *
 * It mutates this process's environment, so it REFUSES a second scope naming a DIFFERENT home while one is open
 * rather than letting the two overwrite each other and restore stale snapshots. A
 * second scope naming the SAME home joins the open one instead: the variable already names it, and only the last
 * scope to close puts the variable back — so an in-process caller re-entering `automation run-due` under the
 * home it already resolves is not refused.
 *
 * What it closes, and what it does not. It closes every overlap reachable through ordinary code: same-module and
 * duplicate-module scopes, VM realms sharing this `process` (the ledger lives on `process`), a throw, a refused
 * overlap, and an unset variable. It does NOT close code that tampers with the mechanism itself — replacing
 * `process.env` or its prototype, writing the ledger slot, or a `worker_threads` Worker created with `SHARE_ENV`
 * (its isolate has its own `process`, so its own ledger). None exists in this repository; each was a constructed
 * counterexample in a seven-round Codex chase on this property. The mechanism that WOULD close them all is to stop
 * mutating the environment at all and thread the home through every verb as a parameter, which this does not do
 * because most verbs take no `--home`.
 *
 * @param home the state home the work must resolve, made absolute against the cwd at entry
 * @param run the work
 * @returns whatever `run` resolved to; rejects without touching the environment when another home's scope is open
 *   or the home carries a NUL byte
 */
export async function runUnderHome<T>({ home: given, run }: { home: string; run: () => Promise<T> }): Promise<T> {
  // Absolute on entry: a relative home compared and exported raw would name a different directory after a
  // `chdir`, so two scopes spelled alike could open two homes, and a child in another cwd read a third.
  const home = resolve(given);
  // The environment cuts a value at a NUL, so a home carrying one would not be the home the variable then names.
  if (home.includes("\u0000")) {
    throw new Error("runUnderHome: a home containing a NUL byte cannot be carried in $SLOPWEAVER_HOME");
  }
  const scope = joinOrOpenHomeScope({ home });
  // Asserted on every entry, a joining one included: work inside the open scope may have moved the variable, and a
  // joiner that trusted it would run against whatever that work left there.
  process.env["SLOPWEAVER_HOME"] = home;
  scope.open += 1;
  try {
    return await run();
  } finally {
    scope.open -= 1;
    if (scope.open === 0) {
      if (scope.prior === undefined) {
        delete process.env["SLOPWEAVER_HOME"];
      } else {
        process.env["SLOPWEAVER_HOME"] = scope.prior;
      }
      // Only the scope this call joined: a ledger something else installed meanwhile is not this call's to clear.
      const ledger = homeScopeLedger();
      if (ledger.current === scope) {
        ledger.current = undefined;
      }
    }
  }
}

/**
 * The home this user gets with no `$SLOPWEAVER_HOME` — `~/.slopweaver`, whatever the environment says. The one
 * home that shares a user directory with `~/.claude`, so the only one allowed to mirror or restore its
 * auto-memory: a rehearsal or a test pointing `$SLOPWEAVER_HOME` elsewhere must never reach the real corpora.
 *
 * @returns the absolute path of `~/.slopweaver`
 */
export function userDefaultHome(): string {
  return join(homedir(), ".slopweaver");
}

/**
 * Where a test harness parks the account home it sandboxes: on `process` under a REGISTERED symbol, the same slot
 * shape as {@link HOME_SCOPE_SLOT} and for the same reasons. Never an environment variable: the account home anchors
 * the owner's protect list (`protectedPaths/ownerEntries.ts`), and a variable would let any command line move that
 * anchor. Only code already running in this process can fill the slot, and no production module does.
 */
const ACCOUNT_HOME_SANDBOX_SLOT: unique symbol = Symbol.for("slopweaver.accountDefaultHome.sandbox");

/** `process` as the slot's one reader and writer see it. */
type AccountHomeSandboxHost = typeof process & { [ACCOUNT_HOME_SANDBOX_SLOT]?: unknown };

/**
 * Point {@link accountDefaultHome} at `home` for the rest of this process, or until {@link clearAccountHomeSandbox}.
 * The test lanes' `setup-ambient-home.ts` is the caller: under test the account's own home would otherwise be the
 * operator's real `~/.slopweaver`, and every corpus reader judged against the protect list would read their registry.
 *
 * @param home the sandbox directory to answer instead, made absolute against the cwd
 */
export function installAccountHomeSandbox({ home }: { home: string }): void {
  (process as AccountHomeSandboxHost)[ACCOUNT_HOME_SANDBOX_SLOT] = resolve(home);
}

/** Put {@link accountDefaultHome} back on the user database's answer. */
export function clearAccountHomeSandbox(): void {
  Reflect.deleteProperty(process, ACCOUNT_HOME_SANDBOX_SLOT);
}

/**
 * `~/.slopweaver` under the account's own home directory as the user database records it, which no environment
 * variable moves — where `userDefaultHome` follows `$HOME`. A gate guarding the owner's live home asks both, since a
 * process started with `HOME` pointed elsewhere would otherwise compare against the wrong one.
 *
 * The one exception is a sandbox {@link installAccountHomeSandbox} put in this process, which only a test harness
 * does. A slot holding anything but a string throws rather than answering the real home, since falling back there is
 * exactly the read the sandbox exists to stop.
 *
 * @returns the absolute path, or throws when the user database has no entry for this account
 */
export function accountDefaultHome(): string {
  const host = process as AccountHomeSandboxHost;
  if (Object.hasOwn(host, ACCOUNT_HOME_SANDBOX_SLOT)) {
    const sandbox = host[ACCOUNT_HOME_SANDBOX_SLOT];
    if (typeof sandbox !== "string") {
      throw new TypeError("accountDefaultHome: the account-home sandbox slot holds a non-string value");
    }
    return sandbox;
  }
  return join(userInfo().homedir, ".slopweaver");
}
