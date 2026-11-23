/**
 * `slopweaver slack repeats` — the 7-day audit of every place one identity said the same thing twice.
 *
 * Straight-line: help before any I/O, parse, build each identity's seams, read it (`./repeatsRead.ts`),
 * judge with the SAME matcher the send guard refuses with (`outbound/slack/repeatAudit.ts`), render. It
 * READS and never deletes: each `delete` row prints the exact `slack delete` that removes it through the door.
 * Exit 1 whenever any place could not be read — a partial audit is never an all-clear.
 */

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { makeSlackSearchMessages } from "../../../live/slack/searchMessages.js";
import {
  type AuditMessage,
  type RepeatActor,
  renderRepeatsJson,
  renderRepeatsText,
  repeatAudit,
} from "../../../outbound/slack/repeatAudit.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSlackRepeatsOptions } from "./repeatsCore.js";
import { type ActorReadSeams, readActor } from "./repeatsRead.js";
import { SLACK_REPEATS_USAGE } from "./repeatsUsage.js";

/** The argv index the `slack <verb>` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** Why one identity's read seams could not be built — its audit half is then UNREAD, never clear. */
export type RepeatSeamError =
  | { readonly code: "TOKEN_MISSING"; readonly message: string; readonly actor: RepeatActor }
  | { readonly code: "AUTH_FAILED"; readonly message: string; readonly cause: unknown }
  | { readonly code: "AUTH_INCOMPLETE"; readonly message: string };

/** The one place a {@link RepeatSeamError} is constructed. */
export const RepeatSeamErrors = {
  authFailed: ({ cause }: { cause: unknown }): RepeatSeamError => ({
    cause,
    code: "AUTH_FAILED",
    message: `auth.test failed — ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  authIncomplete: (): RepeatSeamError => ({
    code: "AUTH_INCOMPLETE",
    message: "auth.test named no workspace url or user id, so no permalink or self can be built",
  }),
  tokenMissing: ({ actor }: { actor: RepeatActor }): RepeatSeamError => ({
    actor,
    code: "TOKEN_MISSING",
    message: `no ${actor === "me" ? "user" : "bot"} token in the store — \`slopweaver secrets status\``,
  }),
} as const;

/** The injected edges. */
export interface SlackRepeatsDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly clockMs: () => number;
  readonly defaultHome: () => string;
  /** One identity's read seams, or why they cannot be built (no token, `auth.test` failed). */
  readonly seamsFor: (args: { actor: RepeatActor; home: string }) => Promise<Result<ActorReadSeams, RepeatSeamError>>;
}

/**
 * Run the verb against injected edges.
 *
 * @param rest the argv tail after `slack repeats`
 * @param deps the injected write channels, clock, home and read seams
 * @returns the process exit code
 */
export async function runSlackRepeats({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SlackRepeatsDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SLACK_REPEATS_USAGE);
    return EXIT_OK;
  }
  const options = parseSlackRepeatsOptions({ defaultHome: deps.defaultHome(), rest });
  if (options.isErr()) {
    options.error.forEach((problem) => {
      deps.writeDiagnostic(`slack repeats: ${problem}`);
    });
    deps.writeDiagnostic(SLACK_REPEATS_USAGE);
    return EXIT_USAGE;
  }
  const { actors, days, home, json } = options.value;
  const nowMs = deps.clockMs();
  const messages: AuditMessage[] = [];
  const unread: string[] = [];
  let placesRead = 0;
  for (const actor of actors) {
    const seams = await deps.seamsFor({ actor, home });
    if (seams.isErr()) {
      unread.push(`${actor}: ${seams.error.message}`);
      continue;
    }
    const read = await readActor({ actor, days, nowMs, seams: seams.value });
    messages.push(...read.messages);
    unread.push(...read.unread);
    placesRead += read.placesRead;
  }
  const audit = repeatAudit({ days, messages, placesRead, unread });
  if (json) {
    deps.writeOut(renderRepeatsJson({ audit }));
  } else {
    renderRepeatsText({ audit }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  return audit.unread.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * The production read seams for one identity: its token's read client, `auth.test` for who it is and the
 * workspace a permalink is built on, and — as them — the search seam.
 *
 * @returns the seams, or why they cannot be built
 */
async function productionSeams({
  actor,
  home,
}: {
  actor: RepeatActor;
  home: string;
}): Promise<Result<ActorReadSeams, RepeatSeamError>> {
  const token = actor === "me" ? slackUserToken({ home }) : slackBotToken({ home });
  if (token === undefined) {
    return err(RepeatSeamErrors.tokenMissing({ actor }));
  }
  let self: Awaited<ReturnType<ReturnType<typeof makeSlackWriteTransport>["whoAmI"]>>;
  try {
    self = await makeSlackWriteTransport({ home, token }).whoAmI();
  } catch (error) {
    return err(RepeatSeamErrors.authFailed({ cause: error }));
  }
  if (self.workspaceUrl === undefined || self.userId === undefined) {
    return err(RepeatSeamErrors.authIncomplete());
  }
  return ok({
    api: makeSlackApi({ token }),
    search: actor === "me" ? makeSlackSearchMessages({ token }) : undefined,
    self: { botId: actor === "bot" ? self.botId : undefined, userId: self.userId },
    workspaceUrl: self.workspaceUrl,
  });
}

/**
 * The production edges.
 *
 * @returns the process streams, the wall clock, the installed home and the live read seams
 */
export function productionSlackRepeatsDeps(): SlackRepeatsDeps {
  return {
    clockMs: () => Date.now(),
    defaultHome: () => slopweaverHome(),
    seamsFor: productionSeams,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver slack repeats` — every place one identity said the same thing twice; reads, never deletes. */
export const slackRepeatsCommand = defineCommand({
  run: (argv) => runSlackRepeats({ deps: productionSlackRepeatsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
