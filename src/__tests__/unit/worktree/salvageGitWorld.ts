/**
 * The scripted git world `runSalvage`'s tests drive it through: the injected `GithubPushEdges` a salvage
 * already takes, answered from a table rather than a mock, plus the fixed tree, shas and url every case names.
 */
import type { GithubPushEdges } from "../../../admit/githubPush.js";
import type { LineListLoad } from "../../../hygiene/scan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import { type SalvageScan } from "../../../worktree/pruneSalvage.js";

export const PATH = "/repo/.claude/worktrees/old-work";
export const HEAD = "2ba73fd1aaaabbbbccccddddeeeeffff00001111";
export const COMMITTED = "56a59d5faaaabbbbccccddddeeeeffff00002222";
export const BASE_BRANCH = "salvage/old-work-2ba73fd1";
/** The one url `origin` fetches from and pushes to, which the scan, the push and the read-back all name. */
export const URL = "git@github.com:owner/repo.git";
/** The prefix every git command a salvage issues must carry, reads included. */
const HOOKS_OFF = "-c core.hooksPath=/dev/null -c core.fsmonitor=false";
/** How many argv entries {@link HOOKS_OFF} occupies. */
const HOOKS_OFF_ARGS = 4;
/**
 * A scan that finds nothing — the push may go.
 *
 * @returns null, standing for no finding
 */
export const NO_SECRETS: SalvageScan = () => null;
/** No private denylist on this machine, the normal state of a fresh checkout. */
export const ABSENT: LineListLoad = { kind: "absent" };

export const verdict: PruneVerdict = {
  branch: "feature-x",
  cls: "salvaged",
  deleteBranch: false,
  dropsDeps: false,
  diskKib: null,
  path: PATH,
  reason: "3 uncommitted change(s), untouched 10d",
};

/** One scripted git world: what each read answers, and which write git refuses. */
export interface GitWorld {
  /** Branch names `ls-remote` reports as already present on the remote. */
  readonly remoteBranches?: readonly string[];
  /** Branch names `rev-parse --verify` resolves locally. */
  readonly localBranches?: readonly string[];
  /** Paths `diff --cached` reports before the commit step; after it, the tree reads clean. */
  readonly staged?: readonly string[];
  /** Paths `diff` reports — tracked files edited on disk — before the commit step. */
  readonly unstaged?: readonly string[];
  /** Paths `ls-files --others` reports, which only the working tree ever has. */
  readonly untracked?: readonly string[];
  /** What `ls-files --others --ignored --directory` reports, a `dir/` entry for a wholly-ignored directory. */
  readonly ignored?: readonly string[];
  /** The first write whose argv starts with this verb fails. */
  readonly failWrite?: string;
  /** What the remote reports for the pushed branch; by default, whatever the tree's HEAD is by then. */
  readonly remoteReports?: string;
  /** `rev-parse HEAD` throws when true, standing for a tree git cannot read at all. */
  readonly headUnreadable?: boolean;
  /** `ls-remote` throws, standing for a remote that could not be reached. */
  readonly remoteUnreachable?: boolean;
  /** What `ls-files -v -z` reports, NUL-separated; by default a tree git is watching in full. */
  readonly lsFiles?: string;
  /**
   * When true, a cleared bit STAYS set — git exits 0 and changes nothing.
   *
   * Not hypothetical: measured, passing `--no-assume-unchanged` and `--no-skip-worktree` to ONE
   * `update-index` does exactly this to the skip-worktree half, and the capture then pushed a file's old
   * bytes and reported success.
   */
  readonly bitsStick?: boolean;
  /** What `remote get-url --push --all` reports; by default exactly the fetch url, {@link URL}. */
  readonly pushUrls?: string;
  /**
   * When true, `rev-list --max-parents=0` of the tree's commits lists a root the trunk's does not, standing for a
   * tree carrying ANOTHER history — the pre-cut history an `archive` remote carries — however it was joined on.
   */
  readonly foreignRoot?: boolean;
  /** `ls-remote <url> HEAD` throws when true, standing for a remote whose live trunk cannot be asked. */
  readonly trunkUnreadable?: boolean;
  /** After this many `rev-parse HEAD` reads, HEAD answers {@link MOVED}, standing for another process moving it. */
  readonly headMovesAfter?: number;
}

/** The commit the remote's url reports as its HEAD right now. */
export const TRUNK = "77c1e0deaaaabbbbccccddddeeeeffff00003333";
/** The one root commit the trunk reaches. */
const TRUNK_ROOT = "00000000aaaabbbbccccddddeeeeffff00004444";
/** A root no trunk commit reaches: another history's. */
const FOREIGN = "f0f0f0f0aaaabbbbccccddddeeeeffff00005555";
/** The HEAD another process moved the tree to. */
const MOVED = "a0bed000aaaabbbbccccddddeeeeffff00006666";

/**
 * Build the injected edges for one scripted world, recording every command that ran.
 *
 * @returns the edges, plus every command split by whether it carried the hooks-off prefix
 */
// max-lines-exempt: one scripted git world, one answer per git invocation over shared commit state, moved verbatim out of a test file this gate skips
export function fakeDeps({ world }: { world: GitWorld }): {
  armoured: string[];
  bare: string[];
  deps: GithubPushEdges;
  ran: string[];
} {
  // Destructured with defaults rather than read through `??` at each use: an absent field is an explicit
  // empty world here, which is the substitution said out loud.
  const {
    staged = [],
    unstaged = [],
    untracked = [],
    ignored = [],
    failWrite,
    headUnreadable = false,
    localBranches = [],
    remoteBranches = [],
    bitsStick = false,
    lsFiles = "",
    remoteReports,
    remoteUnreachable = false,
    pushUrls = `${URL}\n`,
    foreignRoot = false,
    trunkUnreadable = false,
    headMovesAfter = Number.POSITIVE_INFINITY,
  } = world;
  let headReads = 0;
  const armoured: string[] = [];
  const bare: string[] = [];
  const ran: string[] = [];
  // Split the prefix off when it is there, and RECORD which side each command landed on. Stripping
  // unconditionally mangles the one command this class does not issue — `pushAndVerify`'s own read-back.
  const shed = ({ args }: { args: readonly string[] }): readonly string[] => {
    if (args.slice(0, HOOKS_OFF_ARGS).join(" ") === HOOKS_OFF) {
      const git = args.slice(HOOKS_OFF_ARGS);
      armoured.push(git.join(" "));
      return git;
    }
    bare.push(args.join(" "));
    return args;
  };
  let committed = false;
  let unhidden = false;
  // One answer per git verb, rather than one function branching over all five: the composite scored 22
  // against the cognitive-complexity ceiling of 12, and a fake nobody can read is a fake nobody can trust.
  const headNow = (): string => (committed ? COMMITTED : HEAD);
  /** A `-z` listing: every entry TERMINATED, which is what the production counter counts. */
  const listing = ({ paths }: { paths: readonly string[] }): string =>
    committed ? "" : paths.map((path) => `${path}\0`).join("");
  /** `ls-files` in both shapes the capture issues: the untracked listing, and the index listing. */
  const answerLsFiles = ({ args }: { args: readonly string[] }): string => {
    // Ignored content survives the commit — `add -A` never stages it — so this answer ignores `committed`.
    // The per-file re-listing of a collapsed `.yarn/`: every ignored FILE under it, never a directory entry.
    if (args.includes("--ignored") && args.includes("--")) {
      const inYarn = ignored.filter((path) => path.startsWith(".yarn/") && !path.endsWith("/"));
      return inYarn.map((path) => `${path}\0`).join("");
    }
    if (args.includes("--ignored")) {
      return ignored.map((path) => `${path}\0`).join("");
    }
    if (args.includes("--others")) {
      return listing({ paths: untracked });
    }
    // Once a bit is cleared git reports the path as watched, so the re-read the production code does sees
    // a different answer. A world with `bitsStick` never changes, which is the measured git bug.
    const stillHidden = bitsStick || !unhidden;
    return stillHidden ? lsFiles : lsFiles.replace(/(^|\0)[a-zS] /g, "$1H ");
  };
  // Not the capture's own read — `pushAndVerify` checks the tree is clean before it opens a transport,
  // and it is shared with `github push`, so it arrives WITHOUT the hooks-off prefix. See the case naming
  // both unarmoured commands.
  const answerStatus = (): string => {
    const pending = staged.length + unstaged.length + untracked.length > 0 && !committed;
    return pending ? "M  uncommitted.txt" : "";
  };
  const answerDiff = ({ args }: { args: readonly string[] }): string =>
    listing({ paths: args.includes("--cached") ? staged : unstaged });
  const answerHead = (): string => {
    if (headUnreadable) {
      throw new Error("fatal: not a git repository");
    }
    headReads += 1;
    return headReads > headMovesAfter ? MOVED : headNow();
  };
  const answerLocalRef = ({ args }: { args: readonly string[] }): string => {
    const ref = String(args[3]).replace("refs/heads/", "");
    if (localBranches.includes(ref)) {
      return ref;
    }
    throw new Error("fatal: Needed a single revision");
  };
  const answerRemoteHeads = ({ args }: { args: readonly string[] }): string => {
    if (remoteUnreachable) {
      throw new Error("fatal: could not read from remote repository");
    }
    const name = String(args[3]);
    return remoteBranches.includes(name) ? `${HEAD}\trefs/heads/${name}` : "";
  };
  // The read-back `pushAndVerify` believes. An absent `remoteReports` is the honest default — whatever the
  // tree's HEAD is by now — written as an `if` naming that case rather than as a `??`.
  const answerReadBack = ({ args }: { args: readonly string[] }): string => {
    const ref = String(args[2]);
    if (remoteReports === undefined) {
      return `${headNow()}\t${ref}`;
    }
    if (remoteReports === "") {
      return "";
    }
    return `${remoteReports}\t${ref}`;
  };
  // Reads carry the hooks-off prefix too — `git status` fires `post-index-change`, and a hook running
  // `git add` there destroys the staged content BEFORE the capture has measured it. Recorded and stripped
  // exactly as the writes are.
  const answerRemote = ({ args }: { args: readonly string[] }): string => {
    if (args.length === 1) {
      return "origin\n";
    }
    return args[2] === "--push" ? pushUrls : URL;
  };
  // An ancestry read arrives after the hardening options (`--no-replace-objects -c core.commitGraph=false`), so its
  // verb is read past them: `merge-base --is-ancestor` always holds here, and `rev-list` lists root commits.
  const answerAncestry = ({ args }: { args: readonly string[] }): string => {
    if (args[3] !== "rev-list") {
      return "";
    }
    return args[5] === TRUNK || !foreignRoot ? TRUNK_ROOT : `${TRUNK_ROOT}\n${FOREIGN}`;
  };
  const answerTrunk = (): string => {
    if (trunkUnreadable) {
      throw new Error("fatal: could not read from remote repository");
    }
    return `${TRUNK}\tHEAD`;
  };
  const answerLsRemote = ({ args }: { args: readonly string[] }): string => {
    if (args[1] === "--heads") {
      return answerRemoteHeads({ args });
    }
    return args[2] === "HEAD" ? answerTrunk() : answerReadBack({ args });
  };
  const answers: Readonly<Record<string, (input: { args: readonly string[] }) => string>> = {
    "--no-replace-objects": answerAncestry,
    config: () => "core.bare=false\n",
    diff: answerDiff,
    "ls-files": answerLsFiles,
    "ls-remote": answerLsRemote,
    remote: answerRemote,
    "rev-parse": ({ args }) => (args[1] === "--verify" ? answerLocalRef({ args }) : answerHead()),
    status: answerStatus,
  };
  const readGit = ({ args }: { cwd: string; args: readonly string[] }): string => {
    const git = shed({ args });
    ran.push(`read:${git.join(" ")}`);
    const answer = answers[String(git[0])];
    if (answer === undefined) {
      throw new Error(`unscripted read: ${git.join(" ")}`);
    }
    return answer({ args: git });
  };
  const writeGit = ({ args }: { cwd: string; args: readonly string[] }): Result<void, string> => {
    const git = shed({ args });
    ran.push(`write:${git.join(" ")}`);
    if (failWrite !== undefined && git[0] === failWrite) {
      return err(`git ${failWrite} refused`);
    }
    if (git[0] === "commit") {
      committed = true;
    }
    if (git[0] === "update-index") {
      unhidden = true;
    }
    return ok(undefined);
  };
  return {
    armoured,
    bare,
    deps: { out: () => undefined, readGit, writeGit },
    ran,
  };
}
