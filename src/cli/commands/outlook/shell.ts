/**
 * The one seam every `outlook` verb past `connect` performs its effects through, and the few steps they share.
 *
 * The seam is the SESSION, not one function per verb: a test hands every shell a session answering a plain fake
 * `OutlookApi`, so the shell, the domain code under it and the rendering are all exercised together with no
 * mailbox and no mock. Production binds the stored grant (`live/outlook/session.ts`).
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import type { Result } from "../../../lib/result.js";
import { writeFileAtomicBytes } from "../../../lib/writeAtomic.js";
import type { OutlookApi } from "../../../live/outlook/apiCore.js";
import type { WriteOutlookAttachmentBytes } from "../../../live/outlook/attachments.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import { OUTLOOK_VERB_CAPABILITIES } from "../../../live/outlook/scopes.js";
import { resolveOutlookClient } from "../../../live/outlook/session.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type OutlookArgsError, outlookArgsErrorLines } from "./errors.js";

/**
 * A bound session: the Graph seam and the mailbox it reads.
 *
 * @internal — what `OutlookShellDeps.session` answers; a fake shell builds one inline, never by name.
 */
export interface OutlookSession {
  readonly api: OutlookApi;
  readonly account: string;
}

/** The effects the `outlook` verb shells compose, production or fake. */
export interface OutlookShellDeps {
  /** Bind the stored grant for one verb, refusing a grant short of that verb's capabilities. */
  readonly session: (args: { home: string; verb: string }) => Promise<Result<OutlookSession, OutlookError>>;
  /** The ambient home, for a verb run with no `--home`. */
  readonly home: () => string;
  readonly readStdin: () => Promise<string>;
  readonly writeBytes: WriteOutlookAttachmentBytes;
  readonly out: (line: string) => void;
  readonly warn: (line: string) => void;
  /** The door ledger every outbound or mailbox-changing verb's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The home a verb acts in: `--home` when given, else the seam's ambient one.
 *
 * @param named whatever `--home` carried
 * @returns the home
 */
export function shellHome({ named, deps }: { named: string | undefined; deps: OutlookShellDeps }): string {
  if (named === undefined) {
    return deps.home();
  }
  return named;
}

/**
 * Print a parse refusal and its usage, and answer the usage exit.
 *
 * @returns the usage exit code, always
 */
export function refuseUsage({ error, deps }: { error: OutlookArgsError; deps: OutlookShellDeps }): number {
  for (const line of [...outlookArgsErrorLines({ error }), error.usage]) {
    deps.warn(line);
  }
  return EXIT_USAGE;
}

/**
 * One value as a verb's `--json` prints it.
 *
 * @returns indented JSON
 */
export function jsonOut({ value }: { value: unknown }): string {
  return JSON.stringify(value, undefined, 2);
}

/**
 * The production effects: the stored grant bound per verb, the ambient home, stdin, and an owner-only write.
 *
 * @returns the effects every `outlook` verb shell composes
 */
export function productionOutlookShellDeps(): OutlookShellDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    out: (line) => {
      logger.out({ line });
    },
    readStdin: () => readStdin(),
    session: async ({ home, verb }) => {
      const capabilities = OUTLOOK_VERB_CAPABILITIES[verb];
      if (capabilities === undefined) {
        throw new Error(`outlook ${verb} declares no capabilities in OUTLOOK_VERB_CAPABILITIES`);
      }
      const bound = await resolveOutlookClient({ capabilities, home });
      return bound.map(({ api, account }) => ({ account, api }));
    },
    warn: (line) => {
      logger.warn({ msg: line });
    },
    writeBytes: ({ bytes, path }) => {
      writeFileAtomicBytes({ bytes, dirMode: 0o700, fileMode: 0o600, path });
    },
  };
}
