/**
 * The effectful shell for `gmail unsubscribe`: parse (pure), read the ONE message's headers through a grant carrying
 * the read capability, find its RFC 8058 one-click target (`../../../live/gmail/unsubscribe.ts`), stop on `--dry-run`,
 * and route the one POST through the door.
 *
 * A sender that publishes no one-click is refused BEFORE the door — nothing would be sent, so there is no external
 * write to record, exactly as a `--dry-run` returns before it (`./modifyRun.ts` § Why `--dry-run` returns before the
 * door). The refusal is a FACT about the sender, not a policy a hatch could waive: no override makes a sender publish a
 * target it did not.
 *
 * Every edge is injected, so the shell is unit tested with plain fakes: the message, the POST and the home.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../live/gmail/parse.js";
import {
  describeOneClickTarget,
  type OneClickPost,
  oneClickTarget,
  performOneClick,
  postOneClick,
} from "../../../live/gmail/unsubscribe.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { type GmailArgsError, GmailArgsErrors, gmailArgsErrorLines } from "./errors.js";
import { GMAIL_UNSUBSCRIBE_USAGE } from "./unsubscribeUsage.js";

const VERB_ARG_OFFSET = 4;

/** A parsed `gmail unsubscribe` invocation. */
export interface GmailUnsubscribeArgs {
  readonly address: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The seams `gmail unsubscribe` performs its effects through. */
export interface GmailUnsubscribeDeps {
  readonly read: (args: { home: string | undefined; address: string }) => Promise<Result<GmailMessage, GmailError>>;
  readonly post: OneClickPost;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The door ledger the POST's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * Parse the `gmail unsubscribe` tail: one leading message id, then flags.
 *
 * @param rest the argv tail after `gmail unsubscribe`
 * @returns the validated request, or the one reason it was refused
 */
export function parseGmailUnsubscribeArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GmailUnsubscribeArgs, GmailArgsError> {
  const address = rest[0];
  if (address === undefined || address.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<message-id>", usage: GMAIL_UNSUBSCRIBE_USAGE }));
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: { boolean: ["dry-run", "json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_UNSUBSCRIBE_USAGE }));
  }
  return ok({
    address,
    dryRun: parsed.value.flags.has("dry-run"),
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
  });
}

/** Print one outcome line, or its JSON document. */
function report({
  args,
  deps,
  value,
  line,
}: {
  args: GmailUnsubscribeArgs;
  deps: GmailUnsubscribeDeps;
  value: Record<string, unknown>;
  line: string;
}): void {
  deps.writeOut(args.json ? JSON.stringify({ address: args.address, ...value }, undefined, 2) : line);
}

/**
 * Run `gmail unsubscribe` against injected edges.
 *
 * @param rest argv after `gmail unsubscribe`
 * @param deps the read, POST, home and output seams
 * @returns the process exit code
 */
export async function runGmailUnsubscribe({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailUnsubscribeDeps;
}): Promise<number> {
  const parsed = parseGmailUnsubscribeArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await deps.read({ address: args.address, home: args.home });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  const target = oneClickTarget({ message: read.value });
  if (target.isErr()) {
    deps.writeDiagnostic(`gmail unsubscribe: ${args.address} — ${target.error.message}`);
    report({
      args,
      deps,
      line: `not unsubscribed: the sender offers ${target.error.offered}`,
      value: { code: target.error.code, offered: target.error.offered, unsubscribed: false },
    });
    return EXIT_ERROR;
  }
  const described = describeOneClickTarget({ url: target.value });
  if (args.dryRun) {
    report({
      args,
      deps,
      line: `would POST List-Unsubscribe=One-Click to ${described} — nothing was sent`,
      value: { target: described, unsubscribed: false, wouldPost: true },
    });
    return EXIT_OK;
  }
  return postThroughDoor({ args, deps, described, url: target.value });
}

/**
 * Send the one POST through the door and report what the sender answered.
 *
 * @param described the target as it may be printed, from {@link describeOneClickTarget}
 * @returns the process exit code
 */
async function postThroughDoor({
  args,
  deps,
  url,
  described,
}: {
  args: GmailUnsubscribeArgs;
  deps: GmailUnsubscribeDeps;
  url: URL;
  described: string;
}): Promise<number> {
  // `--home` names the ledger's home, and the home whose private terms judge the POST, when given; otherwise the
  // ambient one does both.
  let home = deps.home();
  if (args.home !== undefined) {
    home = args.home;
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performOneClick({ home, post: deps.post, url }),
    request: {
      action: { kind: "verb", noun: "gmail", verb: "unsubscribe" },
      // Ids and a host only: the target's path and query carry the sender's token for the owner, and the ledger needs neither.
      artifact: { address: args.address, host: url.host },
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver gmail unsubscribe", through: routed })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (routed.result.isErr()) {
    deps.writeDiagnostic(`gmail unsubscribe: ${args.address} — ${routed.result.error.message}`);
    return EXIT_ERROR;
  }
  const { status } = routed.result.value;
  report({
    args,
    deps,
    line: `unsubscribed: POST List-Unsubscribe=One-Click to ${described} → HTTP ${String(status)}`,
    value: { status, target: described, unsubscribed: true },
  });
  return EXIT_OK;
}

/**
 * The production seams. Reading the headers needs only the `read` capability; the POST goes to the sender, not to
 * Google, so it needs no Gmail scope at all.
 *
 * @returns the grant-aware reader, the RFC 8058 POST, and the output sinks
 */
export function productionGmailUnsubscribeDeps(): GmailUnsubscribeDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    post: postOneClick,
    read: async ({ home, address }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      const api = makeGmailApi({ account: bound.value.account, client: bound.value.client });
      return api.getMessage({ format: "metadata", id: address });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail unsubscribe`. */
export const gmailUnsubscribeCommand = defineCommand({
  run: (argv) => runGmailUnsubscribe({ deps: productionGmailUnsubscribeDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
