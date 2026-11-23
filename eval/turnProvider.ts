/**
 * promptfoo custom provider for the turn-level judgement lane. Unlike `askProvider.ts` (which shells the
 * real deterministic `slopweaver store read`, no model in the loop), this lane's whole point is judging judgement —
 * AGENTS.md's owner ruling names it "the one lane that judges judgement" and allows a real model call here.
 *
 * The call goes through `productionCodexClient` on the registered Codex plan a seat with no `--plan` and no `--force`
 * would take (`../src/codex/seatDecision.ts`), never the ambient `$CODEX_HOME`: a plan comes only from the user's own
 * sign-in, and their usage limits bind. It runs
 * behind the browser door (`../src/codex/client.ts`), the repo's ONE sanctioned model-egress boundary (`docs/security/codex-boundary.md` § "The Codex boundary") — never a new SDK client, and never a
 * headless `claude` launch (`AGENTS.md` rule 2 bans that everywhere). No Anthropic transport is wired into
 * this repo at all, so Codex is the only model this harness can actually reach.
 *
 * `callApi` stays positional — promptfoo invokes providers by that fixed framework signature.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexAccountsLive } from "../src/codex/accountLive.js";
import { codexThreadAdmit } from "../src/codex/browserDoor.js";
import { type LockedCodexClient, productionCodexClient } from "../src/codex/client.js";
import { codexFleetCapPort } from "../src/codex/fleetCapPort.js";
import { decideCodexSeat } from "../src/codex/seatDecision.js";
import { codexSignInPort } from "../src/codex/signInPort.js";
import { vendoredCodexCli } from "../src/codex/vendoredCli.js";
import { slopweaverHome } from "../src/config.js";
import { isRecord } from "../src/lib/parsers.js";
import { err, ok, type Result } from "../src/lib/result.js";
import { planRegisterPort } from "../src/plans/port.js";

/** How long one turn-level judgement call may run before this harness gives up on it. */
const CALL_BOUND_MS = 5 * 60 * 1000;

/** The schema Codex must conform its reply to — one free-text field, so the assertion grades real prose. */
const COMPOSED_TEXT_SCHEMA = {
  additionalProperties: false,
  properties: {
    text: { description: "The composed reply, verbatim — exactly what would be sent.", type: "string" },
  },
  required: ["text"],
  type: "object",
} as const;

export interface TurnProviderResponse {
  readonly output: string;
  readonly error?: string;
}

/** Pull the `text` field out of a JSON reply conforming to {@link COMPOSED_TEXT_SCHEMA}. */
function extractComposedText({ raw }: { raw: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isRecord(parsed) && typeof parsed["text"] === "string" ? parsed["text"] : undefined;
}

/**
 * The client a case runs on: the registered Codex plan the fleet routes to, pinned to the SDK's vendored CLI and
 * gated by the browser door (`src/codex/browserDoor.ts`) like every other thread this repository starts. A register
 * with no Codex row, or one where every row is paused or at its usage limit, refuses rather than falling back.
 *
 * @returns the client, or why no registered plan may pay or this machine has no vendored CLI to run it through
 */
async function evalCodexClient(): Promise<Result<LockedCodexClient, string>> {
  const cli = vendoredCodexCli();
  if ("reason" in cli) {
    return err(`turn eval: ${cli.reason}`);
  }
  const routed = await decideCodexSeat({
    allowRefusing: false,
    fleetCap: codexFleetCapPort(),
    home: slopweaverHome(),
    nowIso: new Date().toISOString(),
    port: planRegisterPort(),
    readLive: readCodexAccountsLive,
    requestedAlias: undefined,
    signInPort: codexSignInPort(),
  });
  if (routed.isErr()) {
    return err(`turn eval: ${routed.error.message}`);
  }
  const { codexHome } = routed.value.destination;
  return ok(productionCodexClient({ admitThread: codexThreadAdmit({ cli, codexHome }), cli, codexHome }));
}

export default class SlopweaverTurnProvider {
  /**
   * The provider id promptfoo addresses this by.
   *
   * @returns the fixed id, which the eval config references
   */
  id(): string {
    return "slopweaver-turn";
  }

  /**
   * Run one judgement prompt through the real Codex boundary and hand promptfoo the composed text.
   *
   * @param prompt the case's prompt, passed straight to the model
   * @returns the composed text, or an `error` when the call or its output was unusable
   */
  // named-object-params-exempt: promptfoo invokes Provider.callApi(prompt) positionally
  async callApi(prompt: string): Promise<TurnProviderResponse> {
    const scratch = mkdtempSync(join(tmpdir(), "slopweaver-turn-eval-"));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, CALL_BOUND_MS);
      try {
        const client = await evalCodexClient();
        if (client.isErr()) {
          return { error: client.error, output: "" };
        }
        const thread = client.value.startThread({ workingDirectory: scratch });
        const result = await thread.run({
          input: prompt,
          outputSchema: COMPOSED_TEXT_SCHEMA,
          signal: controller.signal,
        });
        if (result.isErr()) {
          return { error: result.error.message, output: "" };
        }
        const text = extractComposedText({ raw: result.value.finalResponse });
        if (text === undefined) {
          return { error: `response did not conform to the schema: ${result.value.finalResponse}`, output: "" };
        }
        return { output: text };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  }
}
