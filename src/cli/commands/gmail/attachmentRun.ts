/**
 * The effectful shell for `gmail attachment`: parse (pure), resolve a grant carrying the READ capability,
 * fetch one attachment into the home, and print where it landed.
 *
 * Its own file rather than a fourth member of `readRun.ts`'s deps, because it is the one Gmail read that
 * WRITES — bytes under `live/gmail/attachments/` — and its seam carries the attachments root and the atomic
 * write that the pure reads never need.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { writeFileAtomicBytes } from "../../../lib/writeAtomic.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { fetchGmailAttachment, type GmailAttachmentResult } from "../../../live/gmail/attachment.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import { renderGmailAttachmentText } from "../../../live/gmail/render.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseGmailAttachmentArgs } from "./core.js";
import { gmailArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The seams the `gmail attachment` shell performs its effects through. */
export interface GmailAttachmentDeps {
  readonly fetch: (args: {
    home: string | undefined;
    messageId: string;
    name: string | undefined;
    partId: string | undefined;
    maxBytes: number;
  }) => Promise<Result<GmailAttachmentResult, GmailError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `gmail attachment` against injected edges.
 *
 * @param rest argv after `gmail attachment`
 * @param deps the fetch and output seams
 * @returns the process exit code
 */
export async function runGmailAttachment({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailAttachmentDeps;
}): Promise<number> {
  const parsed = parseGmailAttachmentArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { home, messageId, name, partId, maxBytes, json } = parsed.value;
  const result = await deps.fetch({ home, maxBytes, messageId, name, partId });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json ? renderProviderReadJson({ document: result.value.document }) : renderGmailAttachmentText(result.value),
  );
  return EXIT_OK;
}

/**
 * The production seams: a `read` grant, the home's attachments root, and an owner-only atomic write.
 *
 * @returns the grant-aware fetcher and output sinks
 */
export function productionGmailAttachmentDeps(): GmailAttachmentDeps {
  return {
    fetch: async ({ home, messageId, name, partId, maxBytes }) => {
      // No --home names the ambient home.
      let resolvedHome = slopweaverHome();
      if (home !== undefined) {
        resolvedHome = home;
      }
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolvedHome });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return fetchGmailAttachment({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        maxBytes,
        messageId,
        nowIso: () => new Date().toISOString(),
        root: stateHomePaths({ home: resolvedHome }).live.gmail.attachments,
        selector: { name, partId },
        writeBytes: ({ bytes, path }) => {
          writeFileAtomicBytes({ bytes, dirMode: 0o700, fileMode: 0o600, path });
        },
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail attachment`. */
export const gmailAttachmentCommand = defineCommand({
  run: (argv) => runGmailAttachment({ deps: productionGmailAttachmentDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
