/**
 * Cutting each Make answer down to what the atlas keeps (`details.ts`), and failing loudly when a kept field
 * is missing or mistyped.
 *
 * In short, names not values: a blueprint keeps the ORDER of its module identifiers and the apps they belong
 * to, never a module's `mapper`, `parameters`, `metadata` or `filter`; a connection never its `metadata` or
 * `uid`; a hook never its `url` or `udid` — the URL IS the capability to run the scenario — nor its `data`;
 * an execution only its list row, never its detail or outputs.
 *
 * ## Why these are not `defineBoundary` strict schemas yet
 *
 * `docs/provider-sdks.md` wants a strict all-keys boundary per endpoint, and `lib/boundary.ts` refuses any
 * object that is not `z.strictObject`. That needs every key Make returns, and the only honest source is a live
 * answer — no token existed when this landed, and the SDK's own types are wrong in places (a scenario's
 * creator `name` is typed as a number). So the kept fields are validated here, and the strict boundaries are
 * an open gap the atlas publishes (`gaps.ts`) until the first live fill supplies the real shapes.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import {
  blueprintOutlineDetail,
  connectionDetail,
  executionDetail,
  folderDetail,
  hookDetail,
  type MakeBlueprintOutline,
  organizationDetail,
  scenarioDetail,
  teamDetail,
} from "../details.js";

/** One kept item: its Make id as a string, and the allowlisted fields. */
export interface MakeProjectedItem {
  readonly providerId: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Each list a fill projects with a plain item allowlist, and the schema that is its allowlist. */
const LIST_SCHEMAS = {
  "connections.list": connectionDetail,
  "hooks.list": hookDetail,
  "organizations.list": organizationDetail,
  "scenarios.list": scenarioDetail,
  "teams.list": teamDetail,
} as const;

/**
 * Render Zod's issues as one line a reader can act on.
 *
 * @param what the read that answered
 * @param issues what Zod refused
 * @returns the sentence
 */
function issuesLine({ what, issues }: { what: string; issues: readonly z.core.$ZodIssue[] }): string {
  return `${what}: ${issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`;
}

/**
 * Project one page of a list whose items are kept as they are, cut to their allowlist.
 *
 * @param what which list answered
 * @param body the SDK's resolved value
 * @param extra fields every item from this read carries — the parent it was read under
 * @returns the kept items, or why the page could not be read
 */
export function projectList({
  what,
  body,
  extra,
}: {
  what: keyof typeof LIST_SCHEMAS;
  body: unknown;
  extra: Readonly<Record<string, unknown>>;
}): Result<MakeProjectedItem[]> {
  const parsed = z.array(LIST_SCHEMAS[what]).safeParse(body);
  if (!parsed.success) {
    return err([issuesLine({ issues: parsed.error.issues, what })]);
  }
  return ok(parsed.data.map((item) => ({ detail: { ...item, ...extra }, providerId: String(item.id) })));
}

/**
 * Project the executions list of one scenario, each row carrying that scenario's id.
 *
 * @param body the SDK's resolved value
 * @param scenarioId the scenario the logs were read for
 * @returns the kept rows
 */
export function projectExecutions({
  body,
  scenarioId,
}: {
  body: unknown;
  scenarioId: number;
}): Result<MakeProjectedItem[]> {
  const parsed = z.array(executionDetail).safeParse(body);
  if (!parsed.success) {
    return err([issuesLine({ issues: parsed.error.issues, what: "executions.list" })]);
  }
  return ok(parsed.data.map((item) => ({ detail: { ...item, scenarioId }, providerId: item.id })));
}

/** A folder node as the tree answers it — the kept fields, and its children. */
interface FolderNode {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly children?: readonly FolderNode[] | undefined;
}

const folderNode: z.ZodType<FolderNode> = z.lazy(() =>
  folderDetail.omit({ teamId: true }).extend({ children: z.array(folderNode).optional() }),
);

/**
 * Project a team's folder tree, flattened, each folder carrying the team it was read under.
 *
 * @param body the SDK's resolved value
 * @param teamId the team the tree was read under
 * @returns every folder at every depth
 */
export function projectFolders({ body, teamId }: { body: unknown; teamId: number }): Result<MakeProjectedItem[]> {
  const parsed = z.array(folderNode).safeParse(body);
  if (!parsed.success) {
    return err([issuesLine({ issues: parsed.error.issues, what: "folders.list" })]);
  }
  const flat: MakeProjectedItem[] = [];
  const walk = ({ nodes }: { nodes: readonly FolderNode[] }): void => {
    for (const node of nodes) {
      flat.push({ detail: { id: node.id, name: node.name, path: node.path, teamId }, providerId: String(node.id) });
      if (node.children !== undefined) {
        walk({ nodes: node.children });
      }
    }
  };
  walk({ nodes: parsed.data });
  return ok(flat);
}

/** A blueprint node as far as the outline reads it — its module, and any router's routes. */
interface BlueprintNode {
  readonly module: string;
  readonly routes?: readonly { readonly flow: readonly BlueprintNode[] }[] | undefined;
}

const blueprintNode: z.ZodType<BlueprintNode> = z.lazy(() =>
  z.object({ module: z.string(), routes: z.array(z.object({ flow: z.array(blueprintNode) })).optional() }),
);

/**
 * Reduce a blueprint to its outline: module identifiers depth-first through every router route, and the
 * distinct apps they name (the part before `:`) in the order first seen.
 *
 * @param body the SDK's resolved blueprint
 * @returns the outline, or why the blueprint could not be read
 */
export function projectBlueprintOutline({ body }: { body: unknown }): Result<MakeBlueprintOutline> {
  const parsed = z.object({ flow: z.array(blueprintNode) }).safeParse(body);
  if (!parsed.success) {
    return err([issuesLine({ issues: parsed.error.issues, what: "blueprints.get" })]);
  }
  const modules: string[] = [];
  const walk = ({ flow }: { flow: readonly BlueprintNode[] }): void => {
    for (const node of flow) {
      modules.push(node.module);
      if (node.routes === undefined) {
        continue;
      }
      for (const route of node.routes) {
        walk({ flow: route.flow });
      }
    }
  };
  walk({ flow: parsed.data.flow });
  const appPrefixes = [...new Set(modules.map((module) => module.split(":")[0]!))];
  return ok(blueprintOutlineDetail.parse({ appPrefixes, moduleCount: modules.length, modules }));
}
