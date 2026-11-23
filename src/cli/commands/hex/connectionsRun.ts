/**
 * `slopweaver hex connections` — which warehouses this workspace reads, and what each one points at.
 *
 * The verb that answers "is the thing a notebook calls the system's database the warehouse or the production
 * database itself": a connection's `type` and its target — a BigQuery project id, a Postgres host and
 * database — say which. Never a credential: `src/hex/responses.ts` keeps the identifier fields and nothing
 * else, and a key Hex added to `connectionDetails` tomorrow is refused by name at the boundary.
 */
import { listDataConnections } from "../../../hex/reads.js";
import { hexConnectionTarget } from "../../../hex/shape.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexProjectsOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_CONNECTIONS_USAGE } from "./usage.js";

/**
 * Run the `hex connections` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexConnections(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["connections"] });
  if (askedForHelp({ rest, usage: HEX_CONNECTIONS_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexProjectsOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_CONNECTIONS_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const listed = await listDataConnections({ client: opened.client, limit: options.limit });
  if (listed.isErr()) {
    return exitForHexError({ error: listed.error });
  }
  if (options.json) {
    logger.out({
      line: safeJsonStringify({
        label: "hex connections",
        value: listed.value.map((connection) => ({ ...connection, target: hexConnectionTarget({ connection }) })),
      }),
    });
    return EXIT_OK;
  }
  logger.out({ line: `${String(listed.value.length)} data connection(s)` });
  listed.value.forEach((connection) => {
    const target = hexConnectionTarget({ connection });
    logger.out({ line: `  ${connection.name} (${connection.type})${target === null ? "" : ` → ${target}`}` });
    const description = connection.description;
    if (description !== undefined && description.length > 0) {
      logger.out({ line: `    ${description}` });
    }
    logger.out({ line: `    id ${connection.id}` });
  });
  return EXIT_OK;
}

export const hexConnectionsCommand = defineCommand({ run: runHexConnections });
