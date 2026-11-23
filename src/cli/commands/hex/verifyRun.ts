/**
 * `slopweaver hex verify` — who this install's Hex token is, and what its role opens.
 *
 * The first verb to run after `slopweaver secrets set hex-api-token`, and the one that makes the token's
 * real scope visible: Hex mints no read-only token, so a personal one carries the minting user's own role.
 * Printing that role is how an operator sees what the credential could do if the client were ever to admit
 * a second HTTP method — which it does not (`src/hex/client.ts`).
 *
 * A workspace token omits the user fields the document declares as optional; both arms print rather than
 * one of them reading as an empty answer.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { epochSecondsToIso } from "#lib/date.js";
import { readMe } from "../../../hex/reads.js";
import type { HexMe } from "../../../hex/responses.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseHexVerifyOptions } from "./core.js";
import { askedForHelp, clientOrExit, exitForHexError, printRefusal } from "./shell.js";
import { HEX_VERIFY_USAGE } from "./usage.js";

/**
 * Run the `hex verify` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHexVerify(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["verify"] });
  if (askedForHelp({ rest, usage: HEX_VERIFY_USAGE })) {
    return EXIT_OK;
  }
  const options = parseHexVerifyOptions({ rest });
  if (options.isErr()) {
    printRefusal({ reasons: options.error, usage: HEX_VERIFY_USAGE });
    return EXIT_USAGE;
  }
  const opened = clientOrExit();
  if ("exit" in opened) {
    return opened.exit;
  }
  const me = await readMe({ client: opened.client });
  if (me.isErr()) {
    return exitForHexError({ error: me.error });
  }
  const identity = me.value;
  const expiresAtIso = expiryInstant({ expiry: identity.token?.exp });
  if (options.value.json) {
    logger.out({ line: safeJsonStringify({ label: "hex verify", value: { ...identity, expiresAtIso } }) });
    return EXIT_OK;
  }
  verifyLines({ expiresAtIso, identity }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * The token.s expiry as an instant, or `null` when Hex reported none — or reported one no clock can read.
 *
 * @param expiry the epoch seconds Hex put on the token, if it put any
 * @returns the instant, or `null`
 */
function expiryInstant({ expiry }: { expiry: number | null | undefined }): string | null {
  if (expiry === null || expiry === undefined) {
    return null;
  }
  const instant = epochSecondsToIso({ seconds: expiry });
  if (instant === undefined) {
    return null;
  }
  return instant;
}

/**
 * The ` (Name)` suffix after a user token's email — nothing when Hex sent no name, or an empty one.
 *
 * @param identity what `GET /v1/users/me` returned
 * @returns the suffix, or an empty string
 */
function nameSuffix({ identity }: { identity: HexMe }): string {
  const name = unsetFieldAsNull({ key: "name", record: identity });
  if (name === null || name.length === 0) {
    return "";
  }
  return ` (${name})`;
}

/**
 * The lines the human rendering prints for one identity.
 *
 * Pure, and its own function because one of these lines is the honest statement about the credential's
 * scope: Hex mints no read-only token, so the role is what it CARRIES and the GET-only client is what
 * bounds it. That sentence has to survive a refactor of the verb around it.
 *
 * @param identity what `GET /v1/users/me` returned
 * @param expiresAtIso the token's expiry as an instant, or `null` when Hex reported none
 * @returns the lines, in print order
 *
 * @internal
 */
export function verifyLines({
  identity,
  expiresAtIso,
}: {
  identity: HexMe;
  expiresAtIso: string | null;
}): readonly string[] {
  const person =
    identity.email === undefined
      ? "  the token is a WORKSPACE token — Hex omits the user fields, so no person is named by this credential"
      : `  ${identity.email}${nameSuffix({ identity })}`;
  const role =
    identity.role === undefined
      ? []
      : [
          `  role ${identity.role} — Hex mints no read-only token, so this role is what the credential CARRIES; every call this integration makes is a GET`,
        ];
  return [
    `hex verify: org ${identity.org.id}`,
    person,
    ...role,
    expiresAtIso === null ? "  no expiry is reported for this token" : `  expires ${expiresAtIso}`,
  ];
}

export const hexVerifyCommand = defineCommand({ run: runHexVerify });
