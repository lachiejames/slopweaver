/**
 * The door half of "a committed proof folder cannot reach a pull request": `github push`, `stack push`,
 * `stack submit` and `github ready` refuse a head that carries proof output, naming each file, before
 * anything is sent. The CI half is the `no-proof-path` lint gate; the criterion is `src/proofPath/criterion.ts`.
 *
 * The push door reads the pushed commit's whole TREE rather than its diff against a base. Every path a
 * branch adds is in its tree, so nothing added is missed; and because the `no-proof-path` gate keeps every
 * base clean, a proof path in the tree IS one the branch carries. That invariant is load-bearing: if a base
 * ever legitimately held a proof path, this check would have to become a base-aware diff in the same change.
 * `github ready` has the pull request's own file list from GitHub, so it judges the paths it introduces.
 *
 * `github ready` judges the files as they stand when it reads them. GitHub's ready mutation names the pull
 * request, never a head, so a head pushed in the gap before it lands cannot be bound to the check. That gap is
 * covered rather than closed: a head can only arrive through a push, which this same door judges, and CI's
 * `no-proof-path` refuses the result whichever way it arrived.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { err, ok, type Result } from "../lib/result.js";
import { proofPathHits } from "../proofPath/criterion.js";
import { type GithubPushDoorError, GithubPushDoorErrors } from "./githubPushErrors.js";

/**
 * Whether the operator opened the proof-path hatch for this one run.
 *
 * Spelled out rather than derived, because the `escape-hatch` gate joins a row to its reader by this literal.
 *
 * @param env the environment, read only for the hatch
 * @returns true when `SLOPWEAVER_ALLOW_PROOF_PATH=1` is set
 */
export function proofPathHatchOpen({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean {
  return env["SLOPWEAVER_ALLOW_PROOF_PATH"] === "1";
}

/**
 * Pure: the refusal for a set of paths a head would carry into a pull request, or nothing.
 *
 * @param paths the head's paths — its whole tree for a push, the files it introduces for `ready`
 * @param hatchOpen whether the operator opened the proof-path hatch
 * @param subject what is being judged, for the first line (`commit <sha>`, `pull request #<n>`)
 * @returns the lines to print, or undefined when the head is clean or the hatch is open
 */
export function proofPathRefusal({
  paths,
  hatchOpen,
  subject,
}: {
  paths: readonly string[];
  hatchOpen: boolean;
  subject: string;
}): readonly string[] | undefined {
  const hits = proofPathHits({ paths });
  if (hits.length === 0 || hatchOpen) {
    return undefined;
  }
  return [
    `${subject} carries ${String(hits.length)} proof file(s); nothing was sent:`,
    ...hits.map((path) => `  ${path}`),
    ...hatchRefusalLines({
      detail: "keep proof under $SLOPWEAVER_HOME or a scratchpad and attach it to the pull request body",
      hatch: hatchFor({ id: "proof-path" }),
    }),
  ];
}

/**
 * Every path in the tree of the exact commit a push would send.
 *
 * NUL-delimited, because git permits a newline in a filename.
 *
 * @param readGit the caller's own isolated Git reader, so `cwd` alone decides the repository
 * @param repoRoot the repository the push is about
 * @param localSha the commit the push would send
 * @returns the tree's paths, or the typed failure to read them — which every caller refuses closed on
 */
export function headTreePaths({
  readGit,
  repoRoot,
  localSha,
}: {
  readGit: (args: { cwd: string; args: readonly string[] }) => string;
  repoRoot: string;
  localSha: string;
}): Result<readonly string[], GithubPushDoorError> {
  try {
    // `--no-replace-objects`: a `refs/replace` entry would have git list a substitute tree while the push sends
    // the original commit, so the check reads the object that actually travels.
    const listing = readGit({
      args: ["--no-replace-objects", "ls-tree", "-r", "-z", "--name-only", `${localSha}^{commit}`],
      cwd: repoRoot,
    });
    return ok(listing.split("\0").filter((path) => path.length > 0));
  } catch (error: unknown) {
    return err(
      GithubPushDoorErrors.proofPathUnread({ cause: error instanceof Error ? error.message : String(error), localSha }),
    );
  }
}

/**
 * Read the exact commit a push would send and refuse it when its tree carries proof output.
 *
 * A tree that cannot be read refuses closed.
 *
 * @param readGit the caller's own isolated Git reader, so `cwd` alone decides the repository
 * @param repoRoot the repository the push is about
 * @param localSha the commit the push would send
 * @param env the environment, read only for the hatch
 * @returns nothing when the tree is clean, or the refusal
 */
export function refuseProofPathHead({
  readGit,
  repoRoot,
  localSha,
  env,
}: {
  readGit: (args: { cwd: string; args: readonly string[] }) => string;
  repoRoot: string;
  localSha: string;
  env: Readonly<Record<string, string | undefined>>;
}): Result<void, GithubPushDoorError> {
  const paths = headTreePaths({ localSha, readGit, repoRoot });
  if (paths.isErr()) {
    return err(paths.error);
  }
  const refusal = proofPathRefusal({
    hatchOpen: proofPathHatchOpen({ env }),
    paths: paths.value,
    subject: `commit ${localSha.slice(0, 12)}`,
  });
  return refusal === undefined ? ok(undefined) : err(GithubPushDoorErrors.proofPathCarried({ refusal }));
}

/**
 * Why a submit may not send its heads: every head whose tree carries proof output, each file named, or none.
 *
 * Every head is read before any verdict, so one run names all of them rather than one per retry. A head whose
 * tree cannot be read refuses closed. Asked before the dry-run report, so a dry run discloses it, and before
 * the door, so nothing is sent.
 *
 * @param readGit the isolated Git reader the pushes themselves use
 * @param plan what the planner admitted
 * @param repoRoot the repository the heads are in
 * @param env the environment, read only for the hatch
 * @returns the refusal lines, empty when every head is clean
 */
export function submitProofPathRefusal({
  readGit,
  plan,
  repoRoot,
  env,
}: {
  readGit: (args: { cwd: string; args: readonly string[] }) => string;
  plan: { pushes: readonly { branch: string; pullRequestNumber: number; toSha: string }[] };
  repoRoot: string;
  env: Readonly<Record<string, string | undefined>>;
}): readonly string[] {
  const hatchOpen = proofPathHatchOpen({ env });
  const lines: string[] = [];
  let carried = false;
  for (const push of plan.pushes) {
    const head = `${push.branch} (PR #${String(push.pullRequestNumber)})`;
    const paths = headTreePaths({ localSha: push.toSha, readGit, repoRoot });
    if (paths.isErr()) {
      lines.push(`refused: ${head}`, ...paths.error.message.split("\n"));
      continue;
    }
    const hits = proofPathHits({ paths: paths.value });
    if (hits.length > 0 && !hatchOpen) {
      carried = true;
      lines.push(`refused: ${head} carries ${String(hits.length)} proof file(s):`, ...hits.map((path) => `  ${path}`));
    }
  }
  if (!carried) {
    return lines;
  }
  return [
    "nothing was sent:",
    ...lines,
    ...hatchRefusalLines({
      detail: "keep proof under $SLOPWEAVER_HOME or a scratchpad and attach it to the pull request body",
      hatch: hatchFor({ id: "proof-path" }),
    }),
  ];
}
