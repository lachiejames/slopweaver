/**
 * Which plan a LIVE seat is spending, read from the credential it was booted on — never from the account name
 * Claude Code shows it.
 *
 * ## The misreading this exists to end
 *
 * MEASURED: a supervisor chair read Claude Code's own `userEmail` session context — the plan-three
 * address — and filed that it had "fallen through" its empty unbound store onto the default login while routing
 * had said plan-five. It had not. Its process held descriptor 3 open on `claude-accounts/plan-five/setup-token`
 * (`lsof -a -p <pid> -d 3 -Fn`), and the drawdown ledger showed plan-five's Fable week climbing from 0% to 68%
 * over the same days plan-three's sat flat and then reset. `userEmail` is read from `~/.claude.json`'s
 * `oauthAccount`, which every seat on the machine shares whatever token it boots on, so it names the last hand
 * `/login`, never the plan a seat spends. An EMPTY unbound store is the design (`seatToken.ts`).
 *
 * So the one honest answer is the boot credential itself: the file on descriptor 3 when the seat declared a token
 * descriptor, the store `CLAUDE_SECURESTORAGE_CONFIG_DIR` names when it did not. This module maps those to a plan
 * and folds every session in the pinned chair into the `*` mark `claude gauge` has always promised.
 *
 * Pure: `./seatBootRead.ts` is the effectful edge.
 */
import { aliasForStoreDir } from "./config.js";
import type { ClaudeAccount, ClaudeAccountAlias } from "./contracts.js";
import { SETUP_TOKEN_FD, SETUP_TOKEN_FD_ENV } from "./seatToken.js";

/** The variable naming the store a seat boots against. */
const STORE_ENV = "CLAUDE_SECURESTORAGE_CONFIG_DIR";

/** The two boot variables one process's environment carries, each only when present. */
export interface SeatBootEnv {
  readonly storeDir?: string;
  /** The raw value of the token descriptor variable, kept as text so a malformed one is reported as written. */
  readonly tokenFd?: string;
  /** A boot variable the environment declares more than once, which no single value can stand for. */
  readonly duplicated?: string;
}

/** Which plan one seat is spending, or why that could not be said. */
export type SeatBootPlan =
  /** Booted on a plan's setup token over the descriptor. */
  | { readonly kind: "token"; readonly alias: ClaudeAccountAlias }
  /** Booted on a plan's own store, with no token. */
  | { readonly kind: "store"; readonly alias: ClaudeAccountAlias }
  /**
   * READ, and it is no configured plan: the default login, or a store no plan names. A positive reading, never a read
   * that failed — `../claude/seatAttest.ts` refuses a turn on this and never on `unresolved`.
   */
  | { readonly kind: "off-plan"; readonly why: string }
  /** What it booted on could not be read, or could not be pinned to one plan; `why` says what was found instead. */
  | { readonly kind: "unresolved"; readonly why: string };

/** Where one environment assignment starts in a `ps eww` line: whitespace, an upper-case name, `=`. */
const ASSIGNMENT_START = /\s(?=[A-Z_][A-Z0-9_]*=)/g;

/**
 * Pull the two boot variables out of what `ps eww -o command=` appends to a process's command line.
 *
 * The environment is taken ONLY from the text after `commandLine` (`ps ww -o command=`, read separately): an argument
 * shaped like an assignment — `--append-system-prompt CLAUDE_SECURESTORAGE_CONFIG_DIR=…` — is part of the command, and
 * reading it as the environment would name a plan the process never booted on. An
 * `eww` line that does not begin with the command line is no environment this can separate, so it is `undefined`.
 *
 * **The one blind spot, stated rather than discovered**: `ps` quotes no VALUE either, so another
 * variable whose value itself contains ` CLAUDE_SECURESTORAGE_CONFIG_DIR=<a plan store>` or
 * ` CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3` is indistinguishable from a real assignment in this text. A forged
 * store names a plan the process never booted on; a forged descriptor names one only when the process ALSO holds
 * that plan's own 0600 setup token open on descriptor 3 without declaring it, which no launch line here builds. What
 * `lsof` finds on descriptor 3 is always the real file; only the declaration that sends the read there is text.
 * Closing it needs the NUL-separated `KERN_PROCARGS2` read, a native call this repo does not make.
 *
 * `ps` joins the command line and every environment assignment with single spaces and quotes nothing, so a value is
 * taken up to the NEXT assignment rather than the next space: a store path holding a space, which the register
 * permits (`seatPinning.ts`), stays whole. A value that itself contains ` NAME=` would be cut there and then name no
 * plan, which reads as `off-plan`, never as another plan — a false refusal of that one session, under its hatch,
 * rather than a false attestation.
 *
 * A line carrying NO assignment at all is not a process that declared nothing: `ps` prints no environment for a
 * process it may not read (MEASURED on darwin: `/bin/sleep`, a platform binary, printed its bare command
 * while a `node` launched the same way printed every variable). That is `undefined`, so it can never read as a seat
 * booted with no token and no store.
 *
 * @param psLine the process's command line followed by its environment, as `ps eww` prints it
 * @param commandLine the same process's command line alone, as `ps ww` prints it
 * @returns the store and token descriptor variables, each only when present, or undefined when no environment showed
 */
export function parseBootEnv({
  psLine,
  commandLine,
}: {
  psLine: string;
  commandLine: string;
}): SeatBootEnv | undefined {
  // Only the line terminator comes off: a trailing space can be part of the last value, and a store path's every
  // character is part of the keychain credential it names.
  const withEnv = psLine.replace(/\r?\n$/, "");
  const command = commandLine.replace(/\r?\n$/, "");
  if (!withEnv.startsWith(command)) {
    return undefined;
  }
  const [before, ...assignments] = withEnv.slice(command.length).split(ASSIGNMENT_START);
  if (assignments.length === 0 || before !== "") {
    return undefined;
  }
  return bootVariables({ assignments });
}

/**
 * The two boot variables among one environment's assignments, each split at its first `=`.
 *
 * @param assignments the environment's `NAME=value` segments, in the order `ps` printed them
 * @returns each variable's value when present, and the name of one declared more than once
 */
function bootVariables({ assignments }: { assignments: readonly string[] }): SeatBootEnv {
  const valuesOf = ({ name }: { name: string }): readonly string[] =>
    assignments.filter((segment) => segment.startsWith(`${name}=`)).map((segment) => segment.slice(name.length + 1));
  const stores = valuesOf({ name: STORE_ENV });
  const fds = valuesOf({ name: SETUP_TOKEN_FD_ENV });
  const duplicated = [...(stores.length > 1 ? [STORE_ENV] : []), ...(fds.length > 1 ? [SETUP_TOKEN_FD_ENV] : [])].join(
    " and ",
  );
  const [storeDir] = stores.slice(-1);
  const [tokenFd] = fds.slice(-1);
  return {
    ...(storeDir === undefined ? {} : { storeDir }),
    ...(tokenFd === undefined ? {} : { tokenFd }),
    ...(duplicated === "" ? {} : { duplicated }),
  };
}

/**
 * One file as the kernel identifies it: its device and inode, each as a decimal string.
 *
 * @internal
 */
export interface FileIdentity {
  readonly dev: string;
  readonly ino: string;
}

/** The file a descriptor is open on: the path `lsof` printed for it, and its identity. */
export interface OpenTokenFile {
  readonly path: string;
  readonly identity: FileIdentity;
}

/**
 * One configured plan's setup token file: its identity, neither when the plan has no token file at all, or why it
 * could not be identified — a token that exists but cannot be `stat`ed might be the very file on the descriptor.
 */
export interface PlanTokenIdentity {
  readonly alias: ClaudeAccountAlias;
  readonly identity?: FileIdentity;
  readonly unread?: string;
}

/**
 * The file in one `lsof -F Din` listing: its path from the `n` line, its device from `D` (hex, as `lsof` prints it)
 * and its inode from `i` — MEASURED against `stat`: `D0x100000f` is `stat -f %d` 16777231, and `i` is
 * `stat -f %i` exactly.
 *
 * @param text what `lsof -a -p <pid> -d <fd> -FDin` printed
 * @returns the path and identity, or undefined when the listing lacks any of the three
 */
export function parseLsofFile({ text }: { text: string }): OpenTokenFile | undefined {
  const lines = text.split("\n");
  const field = ({ tag }: { tag: string }): string | undefined => {
    const line = lines.find((candidate) => candidate.startsWith(tag));
    return line === undefined || line.length === tag.length ? undefined : line.slice(tag.length);
  };
  const path = field({ tag: "n" });
  const dev = field({ tag: "D" });
  const ino = field({ tag: "i" });
  if (
    path === undefined ||
    dev === undefined ||
    ino === undefined ||
    !/^0x[0-9a-f]+$/i.test(dev) ||
    !/^\d+$/.test(ino)
  ) {
    return undefined;
  }
  return { identity: { dev: BigInt(dev).toString(), ino }, path };
}

/**
 * Every plan whose setup token IS this file, by device and inode rather than by path: a store spelled with a trailing
 * slash, another case on a case-insensitive volume, or through a symlink names the same file by another string, and
 * only the identity sees that. Every match is returned — two plans naming one file is ambiguity to report, never a
 * first match to take.
 *
 * @param planTokens each configured plan's token file identity
 * @param identity the file the descriptor is open on
 * @returns the aliases whose token is that file, none when no plan's is
 */
function aliasesForTokenFile({
  planTokens,
  identity,
}: {
  planTokens: readonly PlanTokenIdentity[];
  identity: FileIdentity;
}): readonly ClaudeAccountAlias[] {
  return planTokens
    .filter((plan) => plan.identity?.dev === identity.dev && plan.identity.ino === identity.ino)
    .map((plan) => plan.alias);
}

/**
 * The plan a seat that declared descriptor 3 is spending: the ONE plan whose token is the file open there, with every
 * other plan's token proven a different file or absent.
 *
 * @param planTokens each configured plan's setup token file, identified
 * @param tokenFile the file descriptor 3 is open on
 * @returns the plan, or why no single plan can be named
 */
function planForTokenFile({
  planTokens,
  tokenFile,
}: {
  planTokens: readonly PlanTokenIdentity[];
  tokenFile: OpenTokenFile;
}): SeatBootPlan {
  const fd = String(SETUP_TOKEN_FD);
  const aliases = aliasesForTokenFile({ identity: tokenFile.identity, planTokens });
  const [alias] = aliases;
  // `unresolved`, never `off-plan`: a setup token is a subscription credential, so no descriptor-3 reading is a
  // Console bill, and the likeliest file no plan's token matches is that plan's token as it was at boot — a re-mint
  // renames a fresh file over it (`./seatToken.ts`), leaving this seat's descriptor on the old inode.
  if (alias === undefined) {
    return {
      kind: "unresolved",
      why: `descriptor ${fd} is open on ${tokenFile.path}, which is no configured plan's CURRENT token — re-minted since this seat booted, or never one`,
    };
  }
  if (aliases.length > 1) {
    return {
      kind: "unresolved",
      why: `descriptor ${fd} is open on ${tokenFile.path}, which is the token of ${aliases.join(" and ")} at once`,
    };
  }
  const unidentified = planTokens.filter((plan) => plan.unread !== undefined);
  if (unidentified.length > 0) {
    const which = unidentified.map((plan) => `${plan.alias} (${plan.unread!})`).join(", ");
    return {
      kind: "unresolved",
      why: `descriptor ${fd} is ${alias}'s token, but ${which} could not be identified, so it may share that file`,
    };
  }
  return { alias, kind: "token" };
}

/**
 * Decide which plan one seat is spending from what it was booted on.
 *
 * A declared token descriptor is the WHOLE answer: its store is the unbound one by design, so a descriptor that
 * cannot be read is `unresolved` and never falls back to the store. Descriptor 3 in a process that declared none is
 * whatever that process happened to open, so it is never consulted.
 *
 * @param accounts the configured plans, whose stores answer a seat with no token descriptor
 * @param env the process's two boot variables
 * @param planTokens each configured plan's setup token file, identified, to match a descriptor against
 * @param tokenFile the file descriptor 3 is open on, read only when the environment declared it
 * @param tokenFileUnread why that descriptor could not be read, when it could not
 * @returns the plan and how it was reached, or what was found instead
 */
export function planForSeatBoot({
  accounts,
  env,
  planTokens,
  tokenFile,
  tokenFileUnread = "it is not open on a file `lsof` could identify",
}: {
  accounts: readonly ClaudeAccount[];
  env: SeatBootEnv;
  planTokens: readonly PlanTokenIdentity[];
  tokenFile?: OpenTokenFile;
  tokenFileUnread?: string;
}): SeatBootPlan {
  if (env.duplicated !== undefined) {
    return {
      kind: "unresolved",
      why: `its environment declares ${env.duplicated} more than once, so no one value is what it booted on`,
    };
  }
  const fd = String(SETUP_TOKEN_FD);
  if (env.tokenFd !== undefined && env.tokenFd !== fd) {
    return {
      kind: "unresolved",
      why: `${SETUP_TOKEN_FD_ENV}=${env.tokenFd}, not the ${fd} every boot line this repo builds names`,
    };
  }
  if (env.tokenFd !== undefined) {
    return tokenFile === undefined
      ? { kind: "unresolved", why: `it declares a setup token on descriptor ${fd}, but ${tokenFileUnread}` }
      : planForTokenFile({ planTokens, tokenFile });
  }
  if (env.storeDir === undefined) {
    return {
      kind: "off-plan",
      why: "it declares no setup token descriptor and no store, so it spends whatever the default login holds",
    };
  }
  const alias = aliasForStoreDir({ accounts, storeDir: env.storeDir });
  return alias === undefined
    ? {
        kind: "off-plan",
        why: `signed out: it declares no setup token descriptor, and its store ${env.storeDir} is no configured plan's`,
      }
    : { alias, kind: "store" };
}

/** One live session in the pinned chair, and the plan its boot credential names. */
export interface ChairSeatPlan {
  readonly sessionId: string;
  readonly pid: number;
  readonly plan: SeatBootPlan;
}

/** The pinned chair as `claude gauge` reports it: each session's plan, the mark they earn, and the lines saying so. */
export interface GaugeChair {
  /** The plan to mark `*`, present only when every live session in the chair names it. */
  readonly active?: ClaudeAccountAlias;
  readonly sessions: readonly ChairSeatPlan[];
  /** Printed under the gauge's legend, one per session, and never none — an undrawn `*` always says why. */
  readonly lines: readonly string[];
  /** Why the chair itself could not be read, when it could not. */
  readonly unread?: string;
}

/**
 * One session's line.
 *
 * @param session the session and its plan
 * @returns the line, naming the plan and the credential it came from, or why neither could be read
 */
function sessionLine({ session }: { session: ChairSeatPlan }): string {
  const { plan } = session;
  const who = `session ${session.sessionId} (pid ${String(session.pid)})`;
  if (plan.kind === "unresolved") {
    return `chair: ${who} plan UNREAD — ${plan.why}`;
  }
  if (plan.kind === "off-plan") {
    return `chair: ${who} is OFF every configured plan — ${plan.why}`;
  }
  const how =
    plan.kind === "token" ? `its setup token on descriptor ${String(SETUP_TOKEN_FD)}` : "its own store, no token";
  return `chair: ${who} spends ${plan.alias}, booted on ${how}`;
}

/**
 * Fold every session in the pinned chair into the gauge's `*` mark.
 *
 * The mark is drawn only when EVERY session names the same plan. Two tabs on two plans, or one tab whose credential
 * could not be read, leaves it undrawn and names each session, rather than drawing a mark true of one tab only.
 *
 * @param sessions each live session's plan, in the order the chair read found them
 * @param unread why the chair itself could not be read, which draws no mark
 * @returns the chair, carrying the alias to mark only when unanimous
 */
export function chairPlanVerdict({
  sessions,
  unread,
}: {
  sessions: readonly ChairSeatPlan[];
  unread?: string;
}): GaugeChair {
  if (unread !== undefined) {
    return { lines: [`chair plan UNREAD — ${unread}`], sessions, unread };
  }
  if (sessions.length === 0) {
    return { lines: ["chair plan UNREAD — no Claude session is live in the pinned supervisor workspace"], sessions };
  }
  const lines = sessions.map((session) => sessionLine({ session }));
  const aliases = new Set(sessions.map(({ plan }) => ("alias" in plan ? plan.alias : undefined)));
  const [only] = [...aliases];
  if (aliases.size === 1 && only !== undefined) {
    return { active: only, lines, sessions };
  }
  if (aliases.has(undefined)) {
    return { lines, sessions };
  }
  // Every tab read, each on a real plan, and they disagree: no one of those lines says why nothing is marked.
  const spent = [...aliases].join(", ");
  return {
    lines: [...lines, `chair plan UNREAD — its ${String(sessions.length)} sessions spend different plans (${spent})`],
    sessions,
  };
}

/**
 * Keep a boot plan only when the process it was read off is the session's own, by the start time both name.
 *
 * A pid outlives nothing: the registry can describe a process that has exited, and the operating system can hand
 * its pid to another Claude process booted on another plan, so a clean `ps`/`lsof` read of that pid is a read of
 * the wrong thing. The registry records when its process started; the same instant read off the live pid AFTER the
 * credential read binds that read to the session, and any disagreement — or no start time to compare — reads
 * UNREAD rather than lending the session a stranger's plan. An `off-plan` reading is bound exactly like a plan, so a
 * stranger's default login never refuses this session's turn.
 *
 * @param plan what the credential read found at the pid
 * @param procStart when the session's own process started, as its registry file records it
 * @param observedStart when the process at the pid started, read once the credential read finished
 * @returns the plan, or why it cannot be said to be this session's
 */
export function bindBootToProcess({
  plan,
  procStart,
  observedStart,
}: {
  plan: SeatBootPlan;
  procStart: string | undefined;
  observedStart: { readonly text: string } | { readonly why: string };
}): SeatBootPlan {
  if (plan.kind === "unresolved") {
    return plan;
  }
  // An empty start is no start: two empty strings agreeing would bind the read to nothing.
  if (procStart === undefined || procStart.trim() === "") {
    return {
      kind: "unresolved",
      why: "its registry file records no process start, so the credential read cannot be bound to its process",
    };
  }
  if ("why" in observedStart) {
    return {
      kind: "unresolved",
      why: `its process start was not read, so the credential read is unbound: ${observedStart.why}`,
    };
  }
  const observed = observedStart.text.trim();
  if (observed === "") {
    return { kind: "unresolved", why: "`ps` printed no process start for its pid, so the credential read is unbound" };
  }
  if (observed !== procStart) {
    return {
      kind: "unresolved",
      why: `the process at its pid started ${observed}, not ${procStart} as its registry says, so the credential read is another process's`,
    };
  }
  return plan;
}
