/**
 * The actions every workflow file may use, named exactly. The dependency cache's one-writer rule is judged
 * over `ci.yml`, and GitHub scopes a cache entry to a branch rather than to a workflow: a second workflow file
 * saving the same key would be restored by `ci.yml`'s jobs while the contract read only `ci.yml`. Naming the cache actions alone loses to a third-party wrapper, a local action or
 * a reusable workflow, so every `uses` in every workflow file must be one of the actions below, and the cache
 * pair may appear only in `ci.yml`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { isRecord } from "../lib/parsers.js";
import { DEPENDENCY_CACHE_ACTIONS } from "./ciDependencyCache.js";
import { runnerSelectorFindings } from "./ciRunnerFacts.js";
import { actionOf, type OffloadFinding } from "./ciWorkflowRead.js";

/**
 * Every action a workflow may use outside the cache pair. Add one here in the same diff as the workflow. Of these,
 * only `setup-node` has a cache of its own (`cache:`), so its inputs are
 * pinned whole as {@link SETUP_NODE_WITH}.
 */
const WORKFLOW_ACTIONS: ReadonlySet<string> = new Set([
  "actions/checkout",
  "actions/setup-node",
  "actions/upload-artifact",
  "actions/download-artifact",
]);

/** The one `with` every `actions/setup-node` step carries, with no `cache` input. */
const SETUP_NODE_WITH = { "node-version-file": ".nvmrc" };

/** Where GitHub reads workflow files from, repo-relative; it does not descend into subdirectories. */
export const WORKFLOWS_DIR = ".github/workflows";

/**
 * Every workflow file GitHub would run, read whole. Throws when the directory or a file cannot be read, which the
 * gate reports as a contract it could not evaluate.
 *
 * @param root the repository root
 * @returns each `.yml` or `.yaml` file's repo-relative path and text
 */
export function readWorkflowFiles({ root }: { root: string }): readonly { path: string; text: string }[] {
  return readdirSync(join(root, WORKFLOWS_DIR))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => {
      const path = `${WORKFLOWS_DIR}/${name}`;
      return { path, text: readFileSync(join(root, path), "utf8") };
    });
}

/**
 * Every map in a document that carries a `uses` key, at any depth, so a job-level reusable workflow is read as
 * well as a step.
 *
 * @param node the parsed document, or any part of it
 * @returns each step or job map with a `uses`, as written
 */
function usesMaps({ node }: { node: unknown }): readonly Record<string, unknown>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: unknown) => usesMaps({ node: child }));
  }
  if (!isRecord(node)) {
    return [];
  }
  return [...("uses" in node ? [node] : []), ...Object.values(node).flatMap((value) => usesMaps({ node: value }))];
}

/**
 * Every `uses` in the repository's workflow files that is not a pinned action, or is a cache action outside
 * the one workflow that may carry it, and every job in them off the one runner selector.
 *
 * @param workflows each file under `.github/workflows`, as its repo-relative path and its text
 * @param cacheWorkflow the one workflow whose cache steps `ci-offload-contract` judges
 * @returns one finding per offending `uses` and per job off the runner selector, or one unevaluated finding per
 *   file that does not parse
 */
export function workflowActionFindings({
  cacheWorkflow,
  workflows,
}: {
  cacheWorkflow: string;
  workflows: readonly { path: string; text: string }[];
}): readonly OffloadFinding[] {
  return workflows.flatMap(({ path, text }): OffloadFinding[] => {
    let document: unknown;
    try {
      document = parse(text);
    } catch (error: unknown) {
      return [{ line: `${path} does not parse as YAML: ${String(error)}`, unevaluated: true }];
    }
    const actions = usesMaps({ node: document }).flatMap((step): OffloadFinding[] => {
      const action = actionOf({ step });
      if (action === undefined) {
        return [{ line: `\`${path}\` has a \`uses\` that is not a string, which no pinned action can match` }];
      }
      if (DEPENDENCY_CACHE_ACTIONS.includes(action)) {
        return path === cacheWorkflow
          ? []
          : [
              {
                line: `\`${path}\` uses \`${action}\`, and only \`${cacheWorkflow}\` may touch the dependency cache — a save anywhere else shares its key`,
              },
            ];
      }
      if (action === "actions/setup-node" && !isDeepStrictEqual(step["with"], SETUP_NODE_WITH)) {
        return [
          {
            line: `\`${path}\` runs \`actions/setup-node\` with inputs other than exactly ${JSON.stringify(SETUP_NODE_WITH)}, and its \`cache\` input writes a cache of its own`,
          },
        ];
      }
      return WORKFLOW_ACTIONS.has(action)
        ? []
        : [
            {
              line: `\`${path}\` uses \`${action}\`, outside WORKFLOW_ACTIONS (ciWorkflowActions.ts), which could save the dependency cache where ci-offload-contract cannot see it`,
            },
          ];
    });
    return [...actions, ...runnerSelectorFindings({ path, workflow: document })];
  });
}
