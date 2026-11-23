/**
 * The `git` and `cmux` segment classifiers `./rawTools.ts` judges one segment's tokens through, and the
 * classification shape every segment classifier there returns. Split out of `./rawTools.ts` along the same seam
 * as `./rawGhWriteRoute.ts` and `./rawGhReadRoute.ts`: which `git` shapes are destructive, which route a blocked
 * one takes, and how a raw `cmux` call is labelled. Pure; it never imports the classifier it serves.
 */
import { gitSubcommand } from "./commandTokens.js";
import { isRetiredCmuxWrite, type RouteCategory } from "./rawToolsRoute.js";

/**
 * Destructive / external `git` subcommand shapes. Local rebase is intentionally left to the visible agent.
 *
 * @returns whether the call pushes, hard-resets, force-cleans, deletes a branch or tag, or filter-branches
 */
export function isDestructiveGit({ tokens }: { tokens: readonly string[] }): boolean {
  const { sub, flags } = gitSubcommand({ tokens });
  if (sub === undefined) {
    return false;
  }
  if (sub === "push") {
    return true; // any push reaches the remote — route it through the door
  }
  if (sub === "reset") {
    return flags.includes("--hard");
  }
  if (sub === "clean") {
    return flags.some((f) => /^-[a-z]*f/.test(f)); // -f / -fd / -ffd …
  }
  if (sub === "branch" || sub === "tag") {
    return flags.some((f) => f === "-d" || f === "-D" || f === "--delete");
  }
  return sub === "filter-branch";
}

/**
 * Classify a blocked `git` call: a push has a governed verb, every other destructive shape does not.
 *
 * @returns `git-push` for a push, `local-destructive-git` for any other destructive shape
 */
export function gitCategory({ tokens }: { tokens: readonly string[] }): RouteCategory {
  const { sub } = gitSubcommand({ tokens });
  return sub === "push" ? "git-push" : "local-destructive-git";
}

/** One segment's own classification — `undefined` when that segment is not a recognised raw-bypass shape. */
export interface SegmentClassification {
  readonly tool: string;
  readonly reason: string;
  readonly category: RouteCategory;
}

/**
 * `cmux` subcommands the shipped `cmux`/`session` manifests actually have a governed verb for.
 *
 * MEASURED against the manifest, not assumed — the same discipline `GITHUB_COMMAND_COVERS` was corrected into
 * after it claimed six `gh pr` operations `slopweaver github` had never been able to perform. A hint that
 * points at a verb which cannot do the job is worse than the generic one, because it actively misdirects.
 */
const CMUX_COMMAND_COVERS: Readonly<Record<string, readonly string[]>> = {
  // `cmux workspace list` → `slopweaver cmux list`; `cmux workspace close` → `slopweaver cmux close`.
  workspace: ["list", "close"],
};

/** `cmux` top-level subcommands with a governed verb of their own, regardless of what follows. */
const CMUX_GOVERNED_SUBCOMMANDS = new Set(["events", "read-screen", "send", "top", "list-workspaces"]);

/**
 * Classify a raw `cmux` invocation.
 *
 * Rule 3 ("one door") applies to cmux the same way it applies to GitHub: the client, the id-resolution that
 * stops a stale ref addressing someone else's session, the resume cursor and the row identity writers all live
 * behind the verbs, and a raw call looks identical when it works. It is blocked by DEFAULT rather than by an
 * enumerated denylist, because a new cmux subcommand nobody has wrapped yet should surface as a block a human
 * reads — not sail through silently.
 *
 * @param tokens the `cmux …` tokens, env prefix already stripped
 * @returns the classification, or `undefined` for the one shape that is genuinely not a bypass
 */
export function classifyCmuxSegment({ tokens }: { tokens: readonly string[] }): SegmentClassification | undefined {
  const subcommand = tokens.slice(1).find((token) => !token.startsWith("-"));
  if (subcommand === undefined) {
    return undefined; // a bare `cmux` prints its own help and touches nothing
  }
  const sub = tokens.slice(tokens.indexOf(subcommand) + 1).find((token) => !token.startsWith("-"));
  const covered =
    CMUX_GOVERNED_SUBCOMMANDS.has(subcommand) ||
    (sub !== undefined && CMUX_COMMAND_COVERS[subcommand]?.includes(sub) === true);
  let category: SegmentClassification["category"] = "cmux-ungoverned";
  if (covered) {
    category = "cmux-governed";
  } else if (isRetiredCmuxWrite({ sub, subcommand })) {
    category = "cmux-retired";
  }
  return {
    category,
    reason: `raw cmux ${subcommand} drives the fleet outside the door`,
    tool: "cmux",
  };
}
