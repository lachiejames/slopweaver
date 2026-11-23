/**
 * `slopweaver hex raw --path /v1/...` — one authenticated GET against a documented operation the seven
 * typed verbs do not cover, with the body printed as the TEXT Hex sent.
 *
 * The same escape hatch `datadog raw` is and with the same bound: read-only is enforced by the TYPE
 * (`HexMethod` admits `GET` alone), so this verb cannot be pointed at a mutation however it is invoked,
 * and the path must be under `/v1/`. What it buys is reaching an operation the atlas's surface map already
 * lists — suggestions, context topics, guides — without a typed verb existing for it first.
 *
 * It parses nothing, so it declares no endpoint boundary: the body is handed on unchanged, and `--json`
 * wraps it as `{ bodyText, status }` with `bodyText` still a string for the reader to decode. A typed verb
 * is where a shape is believed, and every one of those reads through a strict boundary (`src/hex/schemas.ts`).
 *
 * `slopweaver atlas hex read --kind method --json` is how to find what is there to call. An operation the
 * atlas marks `withheld` can be called from here; that disposition is about what the ATLAS stores, and this
 * verb stores nothing at all.
 */
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { hexRawOutputLines, parseHexRawOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_RAW_USAGE } from "./usage.js";

/**
 * Run the `hex raw` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexRaw(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["raw"] });
  if (askedForHelp({ rest, usage: HEX_RAW_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseHexRawOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, usage: HEX_RAW_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const response = await opened.client.getText({ path: options.path });
  if (response.isErr()) {
    return exitForHexError({ error: response.error });
  }
  hexRawOutputLines({
    bodyText: response.value.bodyText,
    json: options.json,
    path: options.path,
    status: response.value.status,
  }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const hexRawCommand = defineCommand({ run: runHexRaw });
