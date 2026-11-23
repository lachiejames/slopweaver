/**
 * The effectful shells for `gmail list` and `gmail read`.
 *
 * Both are the same three steps: parse (pure), resolve a grant that carries the READ capability, and render
 * what came back. The grant resolution and the API seam are injected, so the shells — dispatch, the human
 * vs `--json` choice, and the exit code — are unit tested with plain fakes and no mailbox.
 */
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import { type GmailMeasureResult, measureGmailMailbox } from "../../../live/gmail/measure.js";
import {
  type GmailListingResult,
  type GmailMessageResult,
  readGmailListing,
  readGmailMessage,
} from "../../../live/gmail/read.js";
import { renderGmailListingText, renderGmailMeasureText, renderGmailMessageText } from "../../../live/gmail/render.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseGmailListArgs, parseGmailMeasureArgs, parseGmailReadArgs } from "./core.js";
import { gmailArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The seams the two read shells perform their effects through. */
export interface GmailReadDeps {
  readonly list: (args: {
    home: string | undefined;
    query: string | undefined;
    labelIds: readonly string[];
    limit: number;
  }) => Promise<Result<GmailListingResult, GmailError>>;
  readonly read: (args: {
    home: string | undefined;
    address: string;
    thread: boolean;
  }) => Promise<Result<GmailMessageResult, GmailError>>;
  readonly measure: (args: {
    home: string | undefined;
    query: string | undefined;
    byteSample: number;
  }) => Promise<Result<GmailMeasureResult, GmailError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `gmail list` against injected edges.
 *
 * @param rest argv after `gmail list`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runGmailList({ rest, deps }: { rest: readonly string[]; deps: GmailReadDeps }): Promise<number> {
  const parsed = parseGmailListArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { home, query, labelIds, limit, json } = parsed.value;
  const result = await deps.list({ home, labelIds, limit, query });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json ? renderProviderReadJson({ document: result.value.document }) : renderGmailListingText(result.value),
  );
  return EXIT_OK;
}

/**
 * Run `gmail read` against injected edges.
 *
 * @param rest argv after `gmail read`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runGmailRead({ rest, deps }: { rest: readonly string[]; deps: GmailReadDeps }): Promise<number> {
  const parsed = parseGmailReadArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { home, address, thread, json } = parsed.value;
  const result = await deps.read({ address, home, thread });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json ? renderProviderReadJson({ document: result.value.document }) : renderGmailMessageText(result.value),
  );
  return EXIT_OK;
}

/**
 * Run `gmail measure` against injected edges.
 *
 * @param rest argv after `gmail measure`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runGmailMeasure({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailReadDeps;
}): Promise<number> {
  const parsed = parseGmailMeasureArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { home, query, byteSample, json } = parsed.value;
  const result = await deps.measure({ byteSample, home, query });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json
      ? renderProviderReadJson({ document: result.value.document })
      : renderGmailMeasureText({ document: result.value.document, measurement: result.value.measurement }),
  );
  return EXIT_OK;
}

/**
 * The production read seams. Both verbs need only the `read` capability, so a `--grant read` install can
 * run the whole of phase A without ever approving a modify scope.
 *
 * @returns the grant-aware readers and output sinks
 */
export function productionGmailReadDeps(): GmailReadDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    list: async ({ home, query, labelIds, limit }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readGmailListing({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        labelIds,
        limit,
        nowIso,
        query,
      });
    },
    measure: async ({ home, query, byteSample }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return measureGmailMailbox({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        byteSample,
        nowIso,
        query,
      });
    },
    read: async ({ home, address, thread }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readGmailMessage({
        account: bound.value.account,
        address,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        nowIso,
        thread,
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

/** `slopweaver gmail list`. */
export const gmailListCommand = defineCommand({
  run: (argv) => runGmailList({ deps: productionGmailReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver gmail measure`. */
export const gmailMeasureCommand = defineCommand({
  run: (argv) => runGmailMeasure({ deps: productionGmailReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver gmail read`. */
export const gmailReadCommand = defineCommand({
  run: (argv) => runGmailRead({ deps: productionGmailReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
