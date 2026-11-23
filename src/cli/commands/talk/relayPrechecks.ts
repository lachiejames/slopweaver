/**
 * The two refusals `talk relay` makes before it writes anything: a console that is not theirs, and a team fix naming a
 * repository the organisation does not hold. Split from `./relayRun.ts` for its line cap; both run before the run
 * lease is taken, so a refusal here costs no row, no ruling and no keystroke into their chat.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { Organisation } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { teamFixRefusal } from "../../../talk/discussFirst.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { consoleWriteRefusal, resolveConsoleOrigin } from "./consoleOrigin.js";
import type { RelayArgs } from "./relayArgs.js";
import { TALK_RELAY_USAGE } from "./usage.js";

/** The organisation read a team fix is judged against: `../../../organisation/read.ts` in the verb, a fake in a test. */
export type RelayOrganisationRead = (args: { home: string }) => Promise<Result<Organisation, OrganisationError>>;

/**
 * Refuse a relay before it writes, or let it through.
 *
 * The organisation is read only for a relay naming a team fix, since whose repository a fix names is the
 * organisation's to say and the flags' parse checked the slug's shape and nothing more. An unreadable organisation is
 * a failed read and exits 1; a fix outside it is the caller's mistake and exits 2.
 *
 * @param readOrganisation reads the organisation under the relay's home
 * @returns the exit code to stop with, or `undefined` when the relay may proceed
 */
export async function refuseBeforeRelay({
  args,
  home,
  readOrganisation,
}: {
  args: RelayArgs;
  home: string;
  readOrganisation: RelayOrganisationRead;
}): Promise<number | undefined> {
  if (args.consoleOrigin !== undefined) {
    const refusal = consoleWriteRefusal({
      handoverDir: resolveHandoverDir({ dir: args.dir, home }),
      home,
      origin: resolveConsoleOrigin({ args: args.consoleOrigin }),
      typesIntoChair: args.deliverToSupervisor,
      verb: "talk relay",
    });
    if (refusal !== undefined) {
      logger.error({ msg: refusal });
      return EXIT_USAGE;
    }
  }
  if (args.discussFirst === undefined) {
    return undefined;
  }
  const organisation = await readOrganisation({ home });
  if (organisation.isErr()) {
    logger.error({ msg: `talk relay: ${organisation.error.message}` });
    return EXIT_ERROR;
  }
  const refused = teamFixRefusal({ organisation: organisation.value, record: args.discussFirst });
  if (refused === undefined) {
    return undefined;
  }
  logger.error({ msg: `talk relay: ${refused}` });
  logger.error({ msg: TALK_RELAY_USAGE });
  return EXIT_USAGE;
}
