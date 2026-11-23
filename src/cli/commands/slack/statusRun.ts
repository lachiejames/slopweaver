/**
 * `slack status` — the effectful SHELL. Parsing is `./statusCore.ts`, what it says `./statusReport.ts`, and
 * its seams, door request and gates `./statusWiring.ts`.
 *
 * resolve the user token → (show: read both, print) | (write: door → write → read back → compare → print).
 * A write is never reported from Slack's `ok` alone: what is printed is what Slack READS BACK, and a
 * read-back that differs from what was sent exits non-zero naming the field.
 *
 * The door's artifact carries the status TEXT's length, never the text — the discipline a channel create's
 * request keeps about its purpose prose. The text is judged by the voice gate on its way out instead,
 * because it is their words shown to the whole workspace.
 */
import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { throughDoor } from "../../../admit/effects.js";
import { NO_AUTHORED_PROSE, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { slopweaverHome } from "../../../config.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  buildStatusProfilePlan,
  parseStatusArgs,
  type StatusInvocation,
  type StatusProfilePlan,
} from "./statusCore.js";
import { type SlackStatusError, SlackStatusErrors, type StatusSlackMethod } from "./statusErrors.js";
import { renderExpiry, resolveStatusExpiry } from "./statusExpiry.js";
import {
  classifyStatusFailure,
  presenceDocument,
  presenceDryRunLines,
  presenceFollowUp,
  presenceHeldLines,
  presenceReadbackMismatch,
  presenceWriteFailureLine,
  readbackFailure,
  statusDryRunLines,
  statusFollowUp,
  statusHeldLines,
  statusReadbackMismatch,
  statusWriteFailureLine,
} from "./statusReport.js";
import {
  deadHostRefusal,
  dryRunDoorRefusal,
  liveStatusDeps,
  type StatusDeps,
  statusDoorRequest,
  statusGates,
} from "./statusWiring.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { doorOutcome, usageExit } from "./workspaceShapeRun.js";

/** The token a status runs on: their user token, and nothing else. */
function resolveUserToken({ deps, home }: { deps: StatusDeps; home: string }): string | SlackStatusError {
  const token = deps.userToken({ home });
  if (token === undefined) {
    return SlackStatusErrors.tokenAbsent();
  }
  return token.startsWith("xoxp-") ? token : SlackStatusErrors.tokenWrongKind();
}

/** Run one Slack call, turning a throw into the refusal a reader can act on. */
async function attempt<T>({
  call,
  method,
  emoji,
}: {
  call: () => Promise<T>;
  method: StatusSlackMethod;
  emoji: string;
}): Promise<{ readonly value: T } | { readonly error: SlackStatusError }> {
  try {
    return { value: await call() };
  } catch (error) {
    return { error: classifyStatusFailure({ emoji, message: errorMessage({ error }), method }) };
  }
}

/** Print a refusal and answer the failure exit. */
function fail({ error }: { error: SlackStatusError }): number {
  logger.error({ msg: error.message });
  return EXIT_ERROR;
}

/** Print either the readable lines or one JSON document, never both. */
function report({
  deps,
  json,
  lines,
  document,
}: {
  deps: StatusDeps;
  json: boolean;
  lines: readonly string[];
  document: Readonly<Record<string, unknown>>;
}): void {
  if (json) {
    deps.emit(JSON.stringify(document, null, 2));
    return;
  }
  for (const line of lines) {
    deps.emit(line);
  }
}

/** `show` — read both, no door: it changes nothing. */
async function runShow({
  deps,
  invocation,
  token,
}: {
  deps: StatusDeps;
  invocation: Extract<StatusInvocation, { sub: "show" }>;
  token: string;
}): Promise<number> {
  const transport = deps.profile({ home: invocation.home, token });
  const status = await attempt({ call: () => transport.readProfileStatus(), emoji: "", method: "users.profile.get" });
  if ("error" in status) {
    return fail({ error: status.error });
  }
  const presence = await attempt({ call: () => transport.readPresence(), emoji: "", method: "users.getPresence" });
  if ("error" in presence) {
    return fail({ error: presence.error });
  }
  const expiry = renderExpiry({ expirationSeconds: status.value.expirationSeconds, zone: invocation.zone });
  report({
    deps,
    document: { expires: expiry, presence: presenceDocument({ held: presence.value }), status: status.value },
    json: invocation.json,
    lines: [...statusHeldLines({ expiry, held: status.value }), ...presenceHeldLines({ held: presence.value })],
  });
  return EXIT_OK;
}

/** Write the status, read it back, compare, and print what Slack holds. Only called inside the door. */
async function writeStatus({
  deps,
  home,
  plan,
  token,
  zone,
  json,
}: {
  deps: StatusDeps;
  home: string;
  plan: StatusProfilePlan;
  token: string;
  zone: string | undefined;
  json: boolean;
}): Promise<number> {
  const transport = deps.profile({ home, token });
  const emoji = plan.statusEmoji;
  const wrote = await attempt({ call: () => transport.setProfileStatus(plan), emoji, method: "users.profile.set" });
  if ("error" in wrote) {
    logger.error({ msg: statusWriteFailureLine({ error: wrote.error, operation: plan.operation }) });
    return EXIT_ERROR;
  }
  const held = await attempt({ call: () => transport.readProfileStatus(), emoji, method: "users.profile.get" });
  if ("error" in held) {
    const next = statusFollowUp({ operation: plan.operation });
    return fail({ error: readbackFailure({ cause: held.error, next, wrote: "users.profile.set" }) });
  }
  const mismatch = statusReadbackMismatch({ held: held.value, plan });
  if (mismatch !== undefined) {
    return fail({ error: mismatch });
  }
  const expiry = renderExpiry({ expirationSeconds: held.value.expirationSeconds, zone });
  report({
    deps,
    document: { expires: expiry, operation: plan.operation, status: held.value },
    json,
    lines: statusHeldLines({ expiry, held: held.value }),
  });
  return EXIT_OK;
}

/** Set presence, read it back, compare, and print it. Only called inside the door. */
async function writePresence({
  deps,
  home,
  presence,
  token,
  json,
}: {
  deps: StatusDeps;
  home: string;
  presence: "away" | "auto";
  token: string;
  json: boolean;
}): Promise<number> {
  const transport = deps.profile({ home, token });
  const wrote = await attempt({
    call: () => transport.setPresence({ presence }),
    emoji: "",
    method: "users.setPresence",
  });
  if ("error" in wrote) {
    logger.error({ msg: presenceWriteFailureLine({ error: wrote.error, presence }) });
    return EXIT_ERROR;
  }
  const held = await attempt({ call: () => transport.readPresence(), emoji: "", method: "users.getPresence" });
  if ("error" in held) {
    const next = presenceFollowUp({ awayMayBeHeld: presence === "away" });
    return fail({ error: readbackFailure({ cause: held.error, next, wrote: "users.setPresence" }) });
  }
  const mismatch = presenceReadbackMismatch({ manualAway: held.value.manualAway, presence });
  if (mismatch !== undefined) {
    return fail({ error: mismatch });
  }
  report({
    deps,
    document: { operation: "presence", presence: presenceDocument({ held: held.value }) },
    json,
    lines: presenceHeldLines({ held: held.value }),
  });
  return EXIT_OK;
}

/** `set` or `clear`: resolve the expiry, then dry-run or write through the door. */
async function runStatusWrite({
  deps,
  invocation,
}: {
  deps: StatusDeps;
  invocation: Extract<StatusInvocation, { sub: "set" | "clear" }>;
}): Promise<number> {
  const request = invocation.sub === "set" ? invocation.until : ({ kind: "never" } as const);
  const zone = invocation.sub === "set" ? invocation.zone : undefined;
  const expiresAtMs = resolveStatusExpiry({ nowMs: deps.now(), request });
  if (expiresAtMs.isErr()) {
    return usageExit({ errors: [expiresAtMs.error.message] });
  }
  const plan = buildStatusProfilePlan({ expiresAtMs: expiresAtMs.value, invocation });
  const token = resolveUserToken({ deps, home: invocation.home });
  if (typeof token !== "string") {
    return usageExit({ errors: [token.message] });
  }
  const deadHost = deadHostRefusal({ dryRun: invocation.dryRun, plan });
  if (deadHost !== undefined) {
    return deadHost;
  }
  const { home } = invocation;
  const doorRequest = statusDoorRequest({ home, operation: plan.operation, plan, presence: undefined });
  const gates = statusGates({ deps, home, plan, record: !invocation.dryRun });
  if (gates.isErr()) {
    return unreadableProfileExit({ error: gates.error, nothingHappened: "your status was not changed." });
  }
  if (invocation.dryRun) {
    const refused = dryRunDoorRefusal({ deps, gates: gates.value, request: doorRequest });
    if (refused !== undefined) {
      return refused;
    }
    const expiry = renderExpiry({ expirationSeconds: plan.expirationSeconds, zone });
    report({
      deps,
      document: { dryRun: true, plan },
      json: invocation.json,
      lines: statusDryRunLines({ expiry, plan }),
    });
    return EXIT_OK;
  }
  const routed = await throughDoor({
    gates: gates.value,
    home,
    ledger: deps.doorLedger,
    perform: () => writeStatus({ deps, home, json: invocation.json, plan, token, zone }),
    request: doorRequest,
  });
  return doorOutcome({ command: "slopweaver slack status", nothingHappened: "your status was not changed.", routed });
}

/** `presence`: dry-run or write through the door. */
async function runPresence({
  deps,
  invocation,
}: {
  deps: StatusDeps;
  invocation: Extract<StatusInvocation, { sub: "presence" }>;
}): Promise<number> {
  const { presence } = invocation;
  const token = resolveUserToken({ deps, home: invocation.home });
  if (typeof token !== "string") {
    return usageExit({ errors: [token.message] });
  }
  if (invocation.dryRun) {
    report({
      deps,
      document: { dryRun: true, presence },
      json: invocation.json,
      lines: presenceDryRunLines({ presence }),
    });
    return EXIT_OK;
  }
  const routed = await throughDoor({
    gates: [voiceProfileGate(NO_AUTHORED_PROSE)],
    home: invocation.home,
    ledger: deps.doorLedger,
    perform: () => writePresence({ deps, home: invocation.home, json: invocation.json, presence, token }),
    request: statusDoorRequest({ home: invocation.home, operation: "presence", plan: undefined, presence }),
  });
  return doorOutcome({ command: "slopweaver slack status", nothingHappened: "your presence was not changed.", routed });
}

/** Where the verb's own arguments start in `process.argv`: `[node, script, noun, verb, ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run `slack status` against SUPPLIED dependencies, so a test drives the whole verb with plain fakes.
 *
 * @param argv the full process argv
 * @param deps the injected dependencies
 * @returns the process exit code
 */
export async function runStatusWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: StatusDeps;
}): Promise<number> {
  const parsed = parseStatusArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return usageExit({ errors: [parsed.error.message] });
  }
  const invocation = parsed.value;
  if (invocation.sub === "presence") {
    return runPresence({ deps, invocation });
  }
  if (invocation.sub !== "show") {
    return runStatusWrite({ deps, invocation });
  }
  const token = resolveUserToken({ deps, home: invocation.home });
  if (typeof token !== "string") {
    return usageExit({ errors: [token.message] });
  }
  return runShow({ deps, invocation, token });
}

/** `slopweaver slack status` — their own Slack status and presence, through the door. */
export const slackStatusCommand = defineCommand({ run: (argv) => runStatusWithDeps({ argv, deps: liveStatusDeps() }) });
