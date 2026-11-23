/**
 * `slopweaver hex project --project <id>` — one project's configuration, and with `--tables` the warehouse
 * tables its cells read.
 *
 * `--tables` is the rung that answers "which database is this notebook actually looking at", which is the
 * question behind the owner's own ask: is that system read through Hex or directly. A project's
 * queried tables name the data connection each is read through, and `hex connections` says what that
 * connection points at.
 */
import { listQueriedTables, readProject } from "../../../hex/reads.js";
import type { HexProject, HexQueriedTable } from "../../../hex/responses.js";
import { hexAppUrl } from "../../../hex/shape.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexObjectOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_PROJECT_USAGE } from "./usage.js";

/**
 * Run the `hex project` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexProject(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["project"] });
  if (askedForHelp({ rest, usage: HEX_PROJECT_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexObjectOptions({
    extraFlag: "tables",
    idFlag: "project",
    rest,
    usageHint: "--project 1b0c…, the UUID after `/hex/` in the project's URL",
  });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_PROJECT_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const project = await readProject({ client: opened.client, projectId: options.id });
  if (project.isErr()) {
    return exitForHexError({ error: project.error });
  }
  const tableRows: HexQueriedTable[] = [];
  if (options.extra) {
    const tables = await listQueriedTables({ client: opened.client, limit: options.limit, projectId: options.id });
    if (tables.isErr()) {
      return exitForHexError({ error: tables.error });
    }
    tableRows.push(...tables.value);
  }
  if (options.json) {
    logger.out({
      line: safeJsonStringify({
        label: "hex project",
        value: { appUrl: hexAppUrl({ projectId: project.value.id }), project: project.value, queriedTables: tableRows },
      }),
    });
    return EXIT_OK;
  }
  projectLines({ project: project.value, tables: options.extra ? tableRows : null }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * The lines one project's human rendering prints.
 *
 * Pure, and its own function for the reason every renderer here is: the verb keeps the client lifetime and
 * the exit codes, and what a reader actually sees is testable without a network.
 *
 * @param project the project Hex returned
 * @param tables its queried tables, or `null` when the caller did not ask for them — a different fact from
 *   an empty list, which means it queries none
 * @returns the lines, in print order
 *
 * @internal
 */
export function projectLines({
  project,
  tables,
}: {
  project: HexProject;
  tables: readonly HexQueriedTable[] | null;
}): readonly string[] {
  const { schedules } = project;
  return [
    `${project.title} (${project.type})`,
    `  ${hexAppUrl({ projectId: project.id })}`,
    ...(project.description === null ? [] : [`  ${project.description}`]),
    `  owner ${project.owner.email}, created by ${project.creator.email} on ${project.createdAt}`,
    `  status ${statusWord({ project })}; last edited ${project.lastEditedAt}; last published ${lastPublishedWord({ project })}`,
    ...(project.categories.length === 0
      ? []
      : [`  categories: ${project.categories.map((category) => category.name).join(", ")}`]),
    ...(schedules.length === 0
      ? []
      : [`  ${String(schedules.length)} schedule(s) — a published result may be refreshed without anyone opening it`]),
    ...(tables === null
      ? []
      : [
          `  warehouse tables this project queries (${String(tables.length)}):`,
          ...tables.map((table) => `    ${table.tableName}  via ${table.dataConnectionName}`),
        ]),
  ];
}

/** The project's workflow status as a reader sees it — `none` when Hex reports no status set on it. */
function statusWord({ project }: { project: HexProject }): string {
  const status = project.status;
  if (status === null) {
    return "none";
  }
  return status.name;
}

/** When the project was last published — `never` when Hex reports it has not been. */
function lastPublishedWord({ project }: { project: HexProject }): string {
  const published = project.lastPublishedAt;
  if (published === null) {
    return "never";
  }
  return published;
}

export const hexProjectCommand = defineCommand({ run: runHexProject });
