/**
 * `slopweaver hex projects` — what the workspace has, narrowed by words, with each project's app URL.
 *
 * The opening rung of the Hex ladder: an investigation starts by finding WHICH notebook already asks the
 * question, because somebody in growth ops or data has usually written it. Filtering happens here rather
 * than at Hex — the document's own list has no free-text search — so the words match a project's title,
 * description and category names, and every word must match (`src/hex/shape.ts`).
 */
import { listProjects } from "../../../hex/reads.js";
import { filterProjects, hexAppUrl } from "../../../hex/shape.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexProjectsOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_PROJECTS_USAGE } from "./usage.js";

/**
 * Run the `hex projects` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexProjects(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["projects"] });
  if (askedForHelp({ rest, usage: HEX_PROJECTS_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexProjectsOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_PROJECTS_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const listed = await listProjects({
    client: opened.client,
    includeArchived: options.includeArchived,
    limit: options.limit,
    ...(options.owner === null ? {} : { ownerEmail: options.owner }),
  });
  if (listed.isErr()) {
    return exitForHexError({ error: listed.error });
  }
  const { matched, ignored } = filterProjects({ projects: listed.value, words: options.words });
  if (options.json) {
    logger.out({
      line: safeJsonStringify({
        label: "hex projects",
        value: {
          ignoredWords: ignored,
          matched: matched.map((project) => ({ ...project, appUrl: hexAppUrl({ projectId: project.id }) })),
          scanned: listed.value.length,
        },
      }),
    });
    return EXIT_OK;
  }
  logger.out({
    line: `${String(matched.length)} project(s) of ${String(listed.value.length)} scanned${options.words.length === 0 ? "" : ` matching ${options.words.map((word) => `"${word}"`).join(" + ")}`}`,
  });
  ignored.forEach((word) => {
    logger.out({ line: `  ("${word}" was too short to narrow on and was ignored)` });
  });
  matched.forEach((project) => {
    const status = project.status === null ? "no status" : project.status.name;
    logger.out({
      line: `  ${project.title} — ${status}, owner ${project.owner.email}, last edited ${project.lastEditedAt}`,
    });
    logger.out({ line: `    ${hexAppUrl({ projectId: project.id })}` });
    logger.out({ line: `    id ${project.id}` });
  });
  if (listed.value.length === options.limit) {
    logger.out({
      line: `the scan stopped at --limit ${String(options.limit)}, so this is not the whole workspace — raise it or narrow with --owner`,
    });
  }
  return EXIT_OK;
}

export const hexProjectsCommand = defineCommand({ run: runHexProjects });
