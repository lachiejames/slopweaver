/**
 * `slack canvas` — the effectful SHELL. Every decision is delegated to `./canvasCore.ts`.
 *
 * ## The order, and the one step that is a disclosure
 *
 *   read the body → refuse → door → create (or replace, or delete)
 *
 * The body is read BEFORE the door and before any token is resolved, because the commonest way this verb
 * goes wrong is a `--markdown` path that is not there — and discovering that after minting a channel canvas
 * would leave a blank document visible to everyone in the channel. `readMarkdownSource` turns an unreadable
 * path into a rejection rather than an empty string for exactly that reason.
 *
 * A CHANNEL canvas is a disclosure the moment it exists: every member of that channel can read it with no
 * further step. So the dry run says who could read it in as many words, and the door request records the
 * destination — never the prose, which is the same discipline `slack poll`'s request keeps about a
 * question's text.
 */
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { slopweaverHome } from "../../../config.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { duplicateSendGate, OVERRIDE_REMEDY, priorSendFrom } from "../../../outbound/slack/duplicateGate.js";
import { confirmSend, DUPLICATE_WINDOW_HOURS, peekSend, reserveSend } from "../../../outbound/slack/sendReservation.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import { canvasProse } from "../../../outbound/voice/artifactProse.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  buildCanvasCreatePlan,
  type CanvasCreateOptions,
  type CanvasCreatePlan,
  type CanvasDeleteOptions,
  type CanvasReplaceOptions,
  canvasCreateDryRunLines,
  canvasDestination,
  canvasDoorRequest,
  parseCanvasArgs,
} from "./canvasCore.js";
import { type CanvasDeps, liveCanvasDeps } from "./canvasWiring.js";
import { slackReadErrorLines } from "./readErrors.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { slackVoiceGateInput } from "./voiceGateRead.js";
import { argumentUsageExit, doorOutcome, usageExit } from "./workspaceShapeRun.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/**
 * The voice gate for one canvas write, and the pain points it records on the way.
 *
 * A canvas is the one lane here whose body is raw markdown rather than typed runs, and it is also the one
 * whose prose a reader opens LATER — which is exactly why it is gated: an unchecked document outlives an
 * unchecked message. The pain point is recorded whether the door then admits the write or not, which is the
 * as-me lane's own advisory-record / blocking-decision split.
 *
 * @param actor the lane this write runs on, which decides which half of the rule list applies
 * @param markdown the body about to be created or replaced
 * @param nowIso the instant this write is judged at
 * @param title the canvas's own heading, absent on a replace that leaves it alone
 * @returns the one gate, ready to compose beside whatever else the operation is judged by, or why the
 * profile holding the voice rules cannot be trusted
 */
function canvasVoiceGate({
  actor,
  deps,
  home,
  markdown,
  nowIso,
  title,
}: {
  actor: SlackActor;
  deps: CanvasDeps;
  home: string;
  markdown: string;
  nowIso: string;
  title: string | undefined;
}): Result<DoorGate, ProfileReadError> {
  return slackVoiceGateInput({
    actor,
    env: deps.env(),
    home,
    nowIso,
    prose: canvasProse({ markdown, title }),
    record: true,
    recordVoicePainPoints: deps.recordVoicePainPoints,
    voiceRules: deps.voiceRules,
  }).map(voiceProfileGate);
}

/**
 * The gate list for a canvas CREATE: the duplicate warn, seeded from a NON-mutating peek.
 *
 * Only the create carries it. A `replace` is idempotent (the same body twice leaves the same document) and a
 * `delete` converges on absent, so neither can be duplicated by a re-run. A create can, and MEASURED, does:
 * a repeated channel-canvas create mints a second real document rather than being refused.
 *
 * @param home the state home holding the reservation store
 * @param plan the fully-decided create, whose `duplicateKey` the gate matches on
 * @param nowIso the reference instant the window is measured from
 * @returns the gates the door judges this create against, or why the voice rules cannot be read
 */
function canvasCreateGates({
  deps,
  home,
  plan,
  nowIso,
}: {
  deps: CanvasDeps;
  home: string;
  plan: CanvasCreatePlan;
  nowIso: string;
}): Result<readonly DoorGate[], ProfileReadError> {
  const voice = canvasVoiceGate({ actor: plan.actor, deps, home, markdown: plan.markdown, nowIso, title: plan.title });
  const prior = peekSend({ duplicateKey: plan.duplicateKey, home, nowIso, windowHours: DUPLICATE_WINDOW_HOURS });
  return voice.map((voiceGate) => [
    voiceGate,
    duplicateSendGate({
      prior: priorSendFrom({
        destination: canvasDestination({ plan }),
        duplicateKey: plan.duplicateKey,
        reservation: prior,
      }),
      unconfirmedRemedy: OVERRIDE_REMEDY,
      windowHours: DUPLICATE_WINDOW_HOURS,
    }),
  ]);
}

/** Mint the canvas and report it. Only ever called from inside the door's `perform`. */
async function createCanvas({
  deps,
  home,
  plan,
  token,
}: {
  deps: CanvasDeps;
  home: string;
  plan: CanvasCreatePlan;
  token: string;
}): Promise<number> {
  // The reservation is claimed INSIDE the door's `perform`, so a door refusal leaves no half-claimed slot
  // behind — the correction `slack poll` records for the same pattern. Its verdict is OBEYED: an atomic
  // claim nobody branches on prevents nothing, and here what it prevents is a second real document.
  const reservation = reserveSend({
    duplicateKey: plan.duplicateKey,
    home,
    nowIso: deps.nowIso(),
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
  if (reservation.kind === "duplicate") {
    logger.error({
      msg:
        `an identical canvas was already reserved at ${reservation.firstSentIso}. A repeat mints a SECOND ` +
        `document rather than updating the first, so nothing was created. ${OVERRIDE_REMEDY}`,
    });
    return EXIT_ERROR;
  }
  let canvasId: string;
  try {
    const { channel, markdown, title } = plan;
    canvasId =
      channel === undefined
        ? await deps.createCanvas({ home, markdown, title, token })
        : await deps.createChannelCanvas({ channel, home, markdown, title, token });
  } catch (error) {
    const message = errorMessage({ error });
    logger.error({ msg: `could not create that canvas: ${message}. Nothing was created.` });
    if (message.includes("missing_scope")) {
      logger.error({ msg: "that lane's token needs canvases:write. Both tokens held it when this verb was built." });
    }
    return EXIT_ERROR;
  }
  deps.emit(
    plan.channel === undefined
      ? `created a standalone canvas: ${canvasId}`
      : `created the canvas of ${plan.channel}: ${canvasId}`,
  );
  if (plan.reach === "channel") {
    deps.emit(`  everyone in ${plan.channel} can read it now.`);
    // Stated on the way out because it is the opposite of what a reader expects, and it is measured — see
    // `canvasCore.ts`'s header. Running this again does NOT update the document; it adds another one.
    deps.emit("  running this again would add a SECOND canvas there — rewrite this one instead.");
  }
  confirmSend({ duplicateKey: plan.duplicateKey, home, nowIso: deps.nowIso(), sentTs: canvasId });
  deps.emit("rewrite it with:");
  deps.emit(`  slopweaver slack canvas replace --canvas ${canvasId} --markdown <file>`);
  return EXIT_OK;
}

/** Run `slack canvas create`. */
async function runCreate({ options, deps }: { options: CanvasCreateOptions; deps: CanvasDeps }): Promise<number> {
  const body = await deps.readMarkdown({ source: options.markdownSource });
  if (body.isErr()) {
    return usageExit({ errors: slackReadErrorLines({ error: body.error }) });
  }
  const plan = buildCanvasCreatePlan({ markdown: body.value, options });
  if (plan.isErr()) {
    return usageExit({ errors: plan.error });
  }
  if (options.dryRun) {
    for (const line of canvasCreateDryRunLines({ plan: plan.value })) {
      deps.emit(line);
    }
    return EXIT_OK;
  }
  const token = tokenFor({ actor: options.actor, deps, home: options.home });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const gates = canvasCreateGates({ deps, home: options.home, nowIso: deps.nowIso(), plan: plan.value });
  if (gates.isErr()) {
    return unreadableProfileExit({ error: gates.error, nothingHappened: "nothing was created." });
  }
  const routed = await throughDoor({
    gates: gates.value,
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => createCanvas({ deps, home: options.home, plan: plan.value, token: token.value }),
    request: canvasDoorRequest({
      actor: options.actor,
      bodyLength: plan.value.markdown.length,
      duplicateKey: plan.value.duplicateKey,
      home: options.home,
      operation: "create",
      target: options.channel,
    }),
  });
  // No token is named here any more. This create is judged by TWO gates now, and `doorRefusalLines` above
  // already prints the override for whichever one actually fired — naming the duplicate token unconditionally
  // told a reader refused for VOICE to override the wrong finding.
  return doorOutcome({ command: "slopweaver slack canvas create", nothingHappened: "nothing was created.", routed });
}

/** Run `slack canvas replace`. */
async function runReplace({ options, deps }: { options: CanvasReplaceOptions; deps: CanvasDeps }): Promise<number> {
  const body = await deps.readMarkdown({ source: options.markdownSource });
  if (body.isErr()) {
    return usageExit({ errors: slackReadErrorLines({ error: body.error }) });
  }
  if (body.value.trim().length === 0) {
    // Same refusal as the create's, and for the same reason: Slack accepts a blank replace and BLANKS the
    // document, which is a destructive outcome an unreadable path or an empty stdin would produce silently.
    return usageExit({
      errors: [
        "REFUSING to replace a canvas with an EMPTY body — that BLANKS the document rather than leaving it " +
          "alone. Delete it deliberately with `slopweaver slack canvas delete` if that is what you meant.",
      ],
    });
  }
  if (options.dryRun) {
    deps.emit(`DRY RUN — nothing was rewritten. slopweaver would: canvases.edit ${options.canvasId} (replace)`);
    deps.emit(`  new body: ${String(body.value.length)} characters — the WHOLE document is replaced.`);
    return EXIT_OK;
  }
  const token = tokenFor({ actor: options.actor, deps, home: options.home });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  // A replace writes a WHOLE new body and leaves the title alone, so the body is the only authored prose
  // there is to judge — `title: undefined` is that fact, not an omission.
  const voice = canvasVoiceGate({
    actor: options.actor,
    deps,
    home: options.home,
    markdown: body.value,
    nowIso: deps.nowIso(),
    title: undefined,
  });
  if (voice.isErr()) {
    return unreadableProfileExit({ error: voice.error, nothingHappened: "nothing was rewritten." });
  }
  const routed = await throughDoor({
    gates: [voice.value],
    home: options.home,
    ledger: deps.doorLedger,
    perform: async () => {
      const { canvasId, home } = options;
      await deps.replaceCanvas({ canvasId, home, markdown: body.value, token: token.value });
      deps.emit(`rewrote canvas ${options.canvasId} (${String(body.value.length)} characters)`);
      return EXIT_OK;
    },
    request: canvasDoorRequest({
      actor: options.actor,
      bodyLength: body.value.length,
      duplicateKey: undefined,
      home: options.home,
      operation: "replace",
      target: options.canvasId,
    }),
  });
  return doorOutcome({ command: "slopweaver slack canvas replace", nothingHappened: "nothing was rewritten.", routed });
}

/** Run `slack canvas delete`. */
async function runDelete({ options, deps }: { options: CanvasDeleteOptions; deps: CanvasDeps }): Promise<number> {
  if (options.dryRun) {
    deps.emit(`DRY RUN — nothing was deleted. slopweaver would: canvases.delete ${options.canvasId}`);
    return EXIT_OK;
  }
  const token = tokenFor({ actor: options.actor, deps, home: options.home });
  if (token.isErr()) {
    return usageExit({ errors: [token.error.message] });
  }
  const routed = await throughDoor({
    // A delete carries no words of its own, and says so rather than dropping the gate — the distinction
    // `../../../admit/voiceProfileGate.ts` draws between a lane with nothing to judge and one nobody wired.
    gates: [voiceProfileGate(NO_AUTHORED_PROSE)],
    home: options.home,
    ledger: deps.doorLedger,
    perform: async () => {
      const gone = await deps.deleteCanvas({ canvasId: options.canvasId, home: options.home, token: token.value });
      deps.emit(gone ? `deleted canvas ${options.canvasId}` : `could not delete canvas ${options.canvasId}`);
      return gone ? EXIT_OK : EXIT_ERROR;
    },
    request: canvasDoorRequest({
      actor: options.actor,
      bodyLength: 0,
      duplicateKey: undefined,
      home: options.home,
      operation: "delete",
      target: options.canvasId,
    }),
  });
  return doorOutcome({ command: "slopweaver slack canvas delete", nothingHappened: "nothing was deleted.", routed });
}

/**
 * The token for the requested lane, under this invocation's own home.
 *
 * @param actor the lane
 * @param deps the injected seams holding both token resolvers
 * @param home the state home the secrets live under
 * @returns the token, or the refusal naming which secret to set
 */
function tokenFor({
  actor,
  deps,
  home,
}: {
  actor: SlackActor;
  deps: CanvasDeps;
  home: string;
}): ReturnType<typeof resolveSlackWriteToken> {
  return resolveSlackWriteToken({
    actor,
    botToken: deps.botToken({ home }),
    userToken: deps.userToken({ home }),
  });
}

/** Where the verb's own arguments start in `process.argv`: `[node, script, noun, verb, ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run `slack canvas` against SUPPLIED dependencies.
 *
 * Exported so a test can drive the whole verb with plain fakes and assert that a refusal creates nothing.
 *
 * @param argv the full process argv
 * @param deps the injected dependencies
 * @returns the process exit code
 */
export async function runCanvasWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: CanvasDeps;
}): Promise<number> {
  const options = parseCanvasArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (options.isErr()) {
    return argumentUsageExit({ error: options.error });
  }
  if (options.value.mode === "create") {
    return runCreate({ deps, options: options.value });
  }
  return options.value.mode === "replace"
    ? runReplace({ deps, options: options.value })
    : runDelete({ deps, options: options.value });
}

/** `slopweaver slack canvas` — create, rewrite or delete a Slack canvas, through the door. */
export const slackCanvasCommand = defineCommand({ run: (argv) => runCanvasWithDeps({ argv, deps: liveCanvasDeps() }) });
