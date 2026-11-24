/**
 * Which tree a description's written rules are read from, and the reading itself.
 *
 * A pull request on this source repository is judged against the rules AT ITS OWN HEAD: one that edits a rule file
 * is reviewed against the edited text, never the text it replaces. Any other repository carries no such files, so
 * its rules come from the installed CLI's tree. The choice is made once, in `./descriptionReviewGate.ts`, so the
 * packet a reviewer reads and the write gate that checks its receipt can never select differently.
 *
 * There is no fallback between the two. A rule absent at the head (the change set deleted or renamed it) is
 * `RULE_ABSENT_AT_HEAD`, never a quiet read of the installed copy. The head is read by the commit SHA the change
 * digest already resolved, so a ref that moves between the two reads cannot pair one commit's change set with
 * another's rules, and by blob, so neither working-tree edits nor line-ending filters reach the bytes hashed.
 *
 * The residue, stated: the LIST of rule paths is the running CLI's (`DESCRIPTION_RULE_FILES`). A change set that
 * edits that list cannot make an older running CLI read the new one; that is what not executing the branch's code
 * costs, and a renamed rule refuses by name rather than passing on the old path's absence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { runGitChecked } from "../../codex/gitRun.js";
import { SOURCE_REPOSITORY } from "../../hygiene/ownRepository.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import { DESCRIPTION_RULE_FILES, type DescriptionRulesOrigin } from "./descriptionReviewTypes.js";

/** Where one description's rules are read: a resolved head commit in a checkout, or an installed tree. */
type DescriptionRulesSource =
  | { readonly kind: "head"; readonly repoDir: string; readonly headRef: string; readonly headSha: string }
  | { readonly kind: "installed"; readonly root: string };

/** One written rule: its path inside the tree and its exact contents. */
interface DescriptionRuleFile {
  readonly path: string;
  readonly contents: string;
}

/** The rules a description is judged against, and the tree they came from. */
interface DescriptionRulesReading {
  readonly files: readonly DescriptionRuleFile[];
  readonly origin: DescriptionRulesOrigin;
}

/**
 * The installed tree: the running CLI's own, wherever it is installed. Read only for a repository other than this
 * source repository.
 *
 * @returns the absolute root of the running build
 */
export function installedRulesRoot(): string {
  return installedTreeRoot({ importMetaUrl: import.meta.url });
}

/**
 * Select the tree a description's rules are read from. Pure. The repository is matched as a whole `owner/repo`,
 * case-insensitively as GitHub matches it, so a fork under another owner is not this source repository.
 *
 * @param repository the pull request's `owner/repo`
 * @param repoDir the checkout holding the head commit
 * @param headRef the head as the caller named it, kept for the packet's provenance line
 * @param headSha the commit the change digest resolved `headRef` to
 * @param installedRoot the running CLI's tree, for any other repository
 * @returns the head for this source repository, the installed tree otherwise
 */
export function descriptionRulesSourceFor({
  repository,
  repoDir,
  headRef,
  headSha,
  installedRoot,
}: {
  repository: string;
  repoDir: string;
  headRef: string;
  headSha: string;
  installedRoot: string;
}): DescriptionRulesSource {
  if (repository.toLowerCase() === SOURCE_REPOSITORY.toLowerCase()) {
    return { headRef, headSha, kind: "head", repoDir };
  }
  return { kind: "installed", root: installedRoot };
}

/**
 * Read every written rule a description is judged against, in {@link DESCRIPTION_RULE_FILES} order, from the
 * selected tree only.
 *
 * @param source the tree {@link descriptionRulesSourceFor} selected
 * @returns the rules and their origin, or the first rule that is absent at the head or cannot be read
 */
export function readDescriptionRules({
  source,
}: {
  source: DescriptionRulesSource;
}): Result<DescriptionRulesReading, DescriptionReviewError> {
  const files: DescriptionRuleFile[] = [];
  for (const path of DESCRIPTION_RULE_FILES) {
    const read = source.kind === "head" ? readHeadRule({ path, source }) : readInstalledRule({ path, source });
    if (read.isErr()) {
      return err(read.error);
    }
    files.push({ contents: read.value, path });
  }
  const origin: DescriptionRulesOrigin =
    source.kind === "head" ? { headRef: source.headRef, headSha: source.headSha, kind: "head" } : { kind: "installed" };
  return ok({ files, origin });
}

/** One rule from the installed tree. */
function readInstalledRule({
  path,
  source,
}: {
  path: string;
  source: Extract<DescriptionRulesSource, { kind: "installed" }>;
}): Result<string, DescriptionReviewError> {
  try {
    return ok(readFileSync(join(source.root, path), "utf8"));
  } catch (error: unknown) {
    return err(
      DescriptionReviewErrors.rulesUnreadable({ detail: errorMessage({ error }), path, source: "the installed tree" }),
    );
  }
}

/** One rule's blob at the resolved head commit: absent is its own refusal, any other failure unreadable. */
function readHeadRule({
  path,
  source,
}: {
  path: string;
  source: Extract<DescriptionRulesSource, { kind: "head" }>;
}): Result<string, DescriptionReviewError> {
  const { headRef, headSha, repoDir } = source;
  const where = `the head under review (ref ${JSON.stringify(headRef)}, commit ${headSha})`;
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repoDir, label: `git ${args[0]!}` });
  try {
    const listed = git({ args: ["ls-tree", "--full-tree", "--name-only", "-z", headSha, "--", path] });
    if (!listed.split("\0").includes(path)) {
      return err(DescriptionReviewErrors.ruleAbsentAtHead({ headRef, headSha, path }));
    }
    return ok(git({ args: ["cat-file", "blob", `${headSha}:${path}`] }));
  } catch (error: unknown) {
    return err(DescriptionReviewErrors.rulesUnreadable({ detail: errorMessage({ error }), path, source: where }));
  }
}
