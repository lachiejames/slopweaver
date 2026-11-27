/**
 * The effectful half of the console-origin gate: resolve where a console server is serving from into a
 * `CallOrigin` (`src/talk/callOrigin.ts`), and refuse a write from one that is not the owner's into their live home.
 *
 * Why it exists: a seat's witness run on its branch console at `localhost:3001` wrote two calls of synthesised speech into the
 * owner's real talk store as them. A witness run needs its own `SLOPWEAVER_HOME`; this is what makes forgetting one a
 * refusal rather than the owner's words.
 *
 * A verb invoked with no console flags is a hand run — a test, a repair — and is neither gated nor stamped here.
 *
 * The residue, stated: this closes the ACCIDENT — a witness that forgot its home, or a home wired into the owner's
 * through a symlink or a hard link anywhere in it. A separate process that changes the home between this check and the
 * write — a link planted, a `profile.json` created — can still reach a live store, and so can any process writing the
 * owner's files directly; neither is a console, and no check before a write closes a race. Nor is a filesystem mount
 * vetted — a bind or FUSE mount exposing a live store under a fresh home is plumbing built on purpose, never a
 * witness's accident, and a mount need not even keep the store's inodes. The gate trusts the server's own environment
 * and tools as a seat finds them: a forged `git` first on `PATH` or a profile edited to declare a seat's worktree is
 * tampering by something already able to write the owner's files directly.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { declaredMainCheckoutPaths } from "../../../admit/declaredMainCheckouts.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpenNow } from "../../../hatch/open.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { accountDefaultHome, userDefaultHome } from "../../../homeDir.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type CallOrigin,
  callOriginSchema,
  consoleWriteRefused,
  isOwnerConsoleOrigin,
  originPhrase,
  servedByOwnerConsole,
} from "../../../talk/callOrigin.js";
import type { ConsoleOriginArgs } from "./consoleOriginArgs.js";
import { homeLinkFault, MAX_VETTED_ENTRIES } from "./homeLinks.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * A path through every symlink on it, including one above a part that does not exist yet: the deepest ancestor that
 * exists is resolved and the rest joined on, so a fresh `calls` directory under a symlinked `talk` still resolves to
 * where its bytes would land.
 *
 * @param path the path
 * @returns the canonical path
 */
function canonical({ path, depth = 0 }: { path: string; depth?: number }): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) {
      return absolute;
    }
    // A dangling symlink still decides where an append lands: it creates the file it names.
    const link = danglingLinkTarget({ path: absolute });
    if (link !== undefined && depth < MAX_LINK_HOPS) {
      return canonical({ depth: depth + 1, path: resolve(parent, link) });
    }
    return join(canonical({ depth, path: parent }), basename(absolute));
  }
}

/** How many dangling symlinks `canonical` follows before it stops, so a loop of them cannot recurse forever. */
const MAX_LINK_HOPS = 40;

/**
 * What a path that is a symlink points at, or `undefined` when it is no symlink or cannot be read.
 *
 * @param path the path
 * @returns the link's target, as written
 */
function danglingLinkTarget({ path }: { path: string }): string | undefined {
  try {
    if (!lstatSync(path).isSymbolicLink()) {
      return undefined;
    }
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Why a write under `home` and `handoverDir` could reach the owner's live home, or `undefined` when it cannot: either
 * root, resolved through every symlink, is one of `liveHomes` or inside it, or either tree holds a link that could carry
 * a write out of it (`./homeLinks.ts`). The write sites a path list misses: a `talk` symlink, a `calls` symlink below
 * the owner's store, a hard-linked call file, the card-landing ledger.
 *
 * @param home the home the write names
 * @param handoverDir the handover directory a landing writes
 * @param liveHomes every path the owner's live home could be at
 * @param cap how many entries to vet before refusing as too many
 * @returns why the write could reach the owner's live home, or `undefined`
 */
export function liveHomeReach({
  home,
  handoverDir,
  liveHomes,
  cap = MAX_VETTED_ENTRIES,
}: {
  home: string;
  handoverDir: string;
  liveHomes: readonly string[];
  cap?: number;
}): string | undefined {
  const lives = liveHomes.map((path) => canonical({ path }));
  const roots = [home, handoverDir].map((path) => canonical({ path }));
  const inside = roots.find((root) => lives.some((live) => root === live || root.startsWith(`${live}${sep}`)));
  if (inside !== undefined) {
    return `${inside} is the owner's live home or inside it`;
  }
  // A live home can sit anywhere `SLOPWEAVER_HOME` points, so a path list alone misses one;
  // an install's own home holds its `profile.json`, and a witness's fresh one holds none.
  if (holdsProfile({ home: roots[0]! })) {
    return `${roots[0]!} holds an install's profile.json, so it is a live home`;
  }
  return homeLinkFault({ cap, roots });
}

/**
 * Whether a home holds a `profile.json` of any kind, a link included; an entry that cannot be read counts as one.
 *
 * @param home the home, canonical
 * @returns whether it does
 */
function holdsProfile({ home }: { home: string }): boolean {
  try {
    lstatSync(stateHomePaths({ home }).profileJson);
    return true;
  } catch (cause) {
    return !(cause instanceof Error && "code" in cause && cause.code === "ENOENT");
  }
}

/**
 * `liveHomeReach` against both places the owner's live home could be, `$HOME`'s and the account's own
 * (`accountDefaultHome`). An account whose home the user database cannot give is refused rather than vetted against
 * `$HOME` alone.
 *
 * @param home the home the write names
 * @param handoverDir the handover directory a landing writes
 * @returns why the write could reach the owner's live home, or `undefined`
 */
function liveHomeReachOfAccount({ home, handoverDir }: { home: string; handoverDir: string }): string | undefined {
  let accountHome: string;
  try {
    accountHome = accountDefaultHome();
  } catch {
    return "this account's own home directory could not be read to vet the write against it";
  }
  return liveHomeReach({ handoverDir, home, liveHomes: [userDefaultHome(), accountHome] });
}

/**
 * Where a console is serving from, as a call records it: the checkout it serves, whether it is the OWNER's main
 * checkout, and the ports it was handed. The owner's means git CONFIRMS a main worktree and the owner's own profile
 * declares it (`declaredMainCheckoutPaths`): any clone is a main worktree of itself, so topology alone would let a
 * separate clone on the default port read as the owner's. A checkout whose topology cannot be read, or a profile that
 * cannot be found, is not the owner's: the gate fails closed (a linked worktree with an unreadable `.git` is not the
 * owner's).
 *
 * The desktop test instance's marker (`--console-instance e2e`) rides beside the server-derived fields, never in place
 * of one.
 *
 * @param args the console's flags
 * @param declared the main checkouts the owner's profile declares, read from the account's own home unless a test supplies them
 * @returns the origin
 */
export function resolveConsoleOrigin({
  args,
  declared = ownerDeclaredCheckouts(),
}: {
  args: ConsoleOriginArgs;
  declared?: readonly string[];
}): CallOrigin {
  const root = canonical({ path: args.checkoutRoot });
  const origin: CallOrigin = {
    checkoutRoot: args.checkoutRoot,
    defaultPort: args.defaultPort,
    mainWorktree:
      declared.some((path) => canonical({ path }) === root) && gitConfirmsMainWorktree({ root: args.checkoutRoot }),
    port: args.port,
  };
  if (args.instance === undefined) {
    return origin;
  }
  return { ...origin, instance: args.instance };
}

/**
 * The main checkouts the owner's profile declares, read from the account's own home (`accountDefaultHome`) rather than from
 * whatever home the console was handed, since a witness names a fresh one and the environment can move `$HOME`. None
 * when that home cannot be read.
 *
 * @returns the declared paths, canonical
 */
export function ownerDeclaredCheckouts(): readonly string[] {
  try {
    return declaredMainCheckoutPaths({ home: accountDefaultHome() });
  } catch {
    return [];
  }
}

/**
 * Whether git itself confirms `root` is the top of a main worktree: its toplevel is `root`, and its git dir is the
 * common one. Asked of git rather than read off disk, because a lone `.git/HEAD` reads as a main worktree on disk while
 * git refuses it; any failure is no confirmation. The `GIT_*` variables that would point git
 * somewhere else are dropped, so the server's environment cannot answer for the checkout.
 *
 * @param root the checkout the console serves
 * @returns whether git confirms it
 */
export function gitConfirmsMainWorktree({ root }: { root: string }): boolean {
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_CEILING_DIRECTORIES"]) {
    delete env[name];
  }
  let lines: string[];
  try {
    lines = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
      {
        cwd: root,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      },
    )
      .trim()
      .split("\n");
  } catch {
    return false;
  }
  const [toplevel, gitDir, commonDir] = lines;
  if (toplevel === undefined || gitDir === undefined || commonDir === undefined) {
    return false;
  }
  return (
    canonical({ path: toplevel }) === canonical({ path: root }) &&
    canonical({ path: gitDir }) === canonical({ path: commonDir })
  );
}

/**
 * The refusal for a console that is not the owner's writing into the owner's live home or typing into their chat, or
 * `undefined` when the write may go ahead: the console is the owner's, or the home is one the run named for itself and
 * nothing types into the owner's chat, or the hatch is open and nothing types into the owner's chat. The hatch never
 * opens the owner's chat: a relay or a wake types its words as the owner's, so a console that is not the owner's types
 * nothing there whatever is open, while a call it writes under the hatch is stamped not the owner's.
 *
 * @param verb the verb being refused, as the refusal names it
 * @param origin the console asking to write
 * @param home the home the write would land in
 * @param handoverDir the handover directory a landing from the write would touch
 * @param typesIntoChair whether the write also types into the owner's supervisor chat
 * @returns the refusal, or `undefined`
 */
export function consoleWriteRefusal({
  verb,
  origin,
  home,
  handoverDir,
  typesIntoChair,
}: {
  verb: string;
  origin: CallOrigin;
  home: string;
  handoverDir: string;
  typesIntoChair: boolean;
}): string | undefined {
  // An origin the call record cannot read back would leave its open line unparseable and its speech unstamped, which
  // reads as the owner's: refused whoever asks and whatever hatch is open (a checkout path over the stored bound).
  if (!callOriginSchema.safeParse(origin).success) {
    return `${verb} refused: this console's origin (${originPhrase({ origin })}) is not one a call record can store, so its speech would read back as unstamped — nothing written`;
  }
  if (isOwnerConsoleOrigin({ origin })) {
    return undefined;
  }
  if (typesIntoChair) {
    return `${verb} refused: ${originPhrase({ origin })} is not the owner's console, and only the owner's console types into the owner's supervisor chat, where its words read as the owner's. No hatch opens this; a witness runs with no --deliver-to-supervisor and wakes no chair.`;
  }
  const reach = liveHomeReachOfAccount({ handoverDir, home });
  const refused = consoleWriteRefused({ origin, reachesLiveHome: reach !== undefined, typesIntoChair });
  if (!refused || hatchOpenNow({ home, id: "non-owner-console-live-talk" })) {
    return undefined;
  }
  return hatchRefusal({
    detail: `${verb} from ${originPhrase({ origin })} into ${home}: ${reach!}`,
    hatch: hatchFor({ id: "non-owner-console-live-talk" }),
  });
}

/** The two verbs that RECORD a console call, and so may record the desktop test instance's through the owner's console. */
export type ConsoleRecordVerb = "talk transcript" | "talk call-thread-append";

/**
 * {@link consoleWriteRefusal} for a verb that records a call, with the one allowance only an APPEND gets: the desktop
 * test instance recording through the owner's own console writes into the owner's live home, since that call's file
 * and thread journal are what `slopweaver desktop e2e --call` proves. Both carry `instance: "e2e"` — a call file's open
 * lines, every thread journal entry — so no reader takes them for the owner's, and `talk transcript` lands nothing
 * from them (`./transcriptRun.ts`). Attribution stays {@link isOwnerConsoleOrigin}'s: this answers only whether the
 * bytes may be written. The marker on any other console is judged as that console.
 *
 * @param verb the recording verb, as the refusal names it
 * @param origin the console asking to write, marked when the test instance posted the batch
 * @param home the home the write would land in
 * @param handoverDir the handover directory a landing from the write would touch
 * @returns the refusal, or `undefined`
 */
export function consoleRecordWriteRefusal({
  verb,
  origin,
  home,
  handoverDir,
}: {
  verb: ConsoleRecordVerb;
  origin: CallOrigin;
  home: string;
  handoverDir: string;
}): string | undefined {
  const testInstanceOnOwnerConsole = origin.instance === "e2e" && servedByOwnerConsole({ origin });
  if (testInstanceOnOwnerConsole && callOriginSchema.safeParse(origin).success) {
    return undefined;
  }
  return consoleWriteRefusal({ handoverDir, home, origin, typesIntoChair: false, verb });
}

/**
 * The console a recording verb's batch came from, resolved — or the refusal for a console not the owner's writing the
 * owner's live home, made before anything is read or written: no call file or thread journal, no landing, no wake. The
 * desktop test instance through the owner's own console is the one exception, and it only records
 * ({@link consoleRecordWriteRefusal}).
 *
 * @param verb the recording verb, as a refusal names it
 * @param consoleOrigin the console's flags, absent on a hand run, which is neither gated nor stamped
 * @param handoverDir the handover directory a landing would write
 * @param home the home the batch would land in
 * @returns the origin, `undefined` on a hand run, or the four-line refusal
 */
export function consoleRecordGate({
  verb,
  consoleOrigin,
  handoverDir,
  home,
}: {
  verb: ConsoleRecordVerb;
  consoleOrigin: ConsoleOriginArgs | undefined;
  handoverDir: string;
  home: string;
}): Result<CallOrigin | undefined, string> {
  if (consoleOrigin === undefined) {
    return ok(undefined);
  }
  const origin = resolveConsoleOrigin({ args: consoleOrigin });
  const refusal = consoleRecordWriteRefusal({ handoverDir, home, origin, verb });
  if (refusal !== undefined) {
    return err(refusal);
  }
  return ok(origin);
}
