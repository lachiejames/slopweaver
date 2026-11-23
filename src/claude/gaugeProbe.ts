/**
 * The one request that reads a plan's remaining budget, and the pure parts of shaping it.
 *
 * The gauge is not an endpoint — it is the `anthropic-ratelimit-unified-*` headers that ride on any
 * ordinary response. So the probe is the smallest possible real request: one token of output, whose entire
 * purpose is to make the provider answer with headers attached. It costs 35 tokens a plan (§ below). Which MODEL
 * it names is load-bearing rather than a cost choice — see {@link PROBE_MODEL}.
 *
 * `GET /api/oauth/usage` returns a tidier body and is deliberately NOT used. Measured the same night it
 * answered `429` with `retry-after: 3568` on a FIRST call, because its budget is shared with every Claude
 * Code session on the machine already calling it for `/usage`. A gauge that can be throttled out of
 * existence is not a gauge, and a rotation that depended on one would go blind exactly when the fleet is
 * busiest. `slopweaver claude reset` does read it — once per run, for the free-reset block alone, and a throttle
 * there defers that verb rather than blinding anything (`./resetStatus.ts`).
 *
 * ## Why this probe, and only this probe, runs past a plan's usage limit
 *
 * A usage limit the owner set on a plan refuses every spawn on it once crossed (`./spawnStore.ts`). This probe is
 * the one exception, and it is the owner's ruling, not a judgement here: under a hundred tokens is basically
 * zero. It is how the fleet learns a capped plan has room again, so refusing it
 * would hold the cap shut forever. The exemption is the SIZE, not the verb: a seat spends real usage and is refused
 * at the cap, and a probe costing {@link BASICALLY_ZERO_TOKENS} or more has left the exemption it rides on.
 *
 * That size is MEASURED on every probe rather than asserted once: the response's own `usage` counters are read
 * ({@link readProbeCost}), `claude gauge --json` prints them per plan as `probeCost`, and `claude gauge` prints a
 * `PROBE COST` line for any plan whose probe was not under the ceiling. It ALARMS rather than refuses, because a
 * refused probe is a capped plan nobody can see reopen. MEASURED on every configured plan alike: 34
 * input tokens and one output, 35 in all (an earlier reading was 22 and one; what moved the input is not
 * established).
 * Reproduce with `slopweaver claude gauge --json | grep -o '"probeCost":{[^}]*}'`. A plans register that does not
 * read is different again — no limit is known at all, so `claude token`, `mint` and `reset` refuse before any
 * probe, as every spawn does.
 *
 * This module builds the request and reads the response. It never holds a credential beyond handing one to
 * the caller's own transport, and never logs one.
 */
import { isRecord } from "#lib/parsers.js";
import { safeJsonParse } from "#lib/safeJson.js";

/**
 * The model the probe names, and the reason it is not the cheapest one.
 *
 * A Fable model is what makes the provider attach the `anthropic-ratelimit-unified-7d_oi-*` trio — the
 * Fable-only seven-day window. MEASURED by sending this same one-token request four times over
 * one credential, changing only `model`: Haiku, Opus and Sonnet each came back with the plan-wide windows
 * and NOTHING else, while Fable came back with those plus the Fable trio. Reproduce with
 * `slopweaver claude gauge --json | jq '.[].gauge | has("sevenDayFable")'`.
 *
 * So a Haiku probe is a gauge that cannot see half of what routing has to decide on, which is the defect
 * this constant exists to close. The cost difference is one output token either way.
 */
const PROBE_MODEL = "claude-fable-5-1";

/** One output token: enough for the provider to answer, small enough that probing costs nothing that matters. */
const PROBE_MAX_TOKENS = 1;

/** The endpoint an ordinary Claude Code request goes to, which is what makes the headers appear. */
export const PROBE_URL = "https://api.anthropic.com/v1/messages?beta=true";

/**
 * The headers a probe request must carry to be answered as Claude Code rather than refused.
 *
 * @param accessToken the plan's OAuth access token — passed straight through, never stored or logged
 * @returns the request headers
 */
export function probeHeaders({ accessToken }: { accessToken: string }): Readonly<Record<string, string>> {
  return {
    "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
    "anthropic-version": "2023-06-01",
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "user-agent": "claude-cli/2.1.259 (external, cli)",
    "x-app": "cli",
  };
}

/**
 * The probe request body — the smallest real request the provider will answer.
 *
 * The system prompt matters: a subscription credential is only honoured for Claude Code's own system
 * prompt, so a probe without it is refused rather than answered with the headers this reads.
 *
 * @returns the JSON body to POST
 */
export function probeBody(): string {
  return JSON.stringify({
    max_tokens: PROBE_MAX_TOKENS,
    messages: [{ content: "hi", role: "user" }],
    model: PROBE_MODEL,
    system: [{ text: "You are Claude Code, Anthropic's official CLI for Claude.", type: "text" }],
  });
}

/**
 * The token count a request must stay UNDER to be basically zero — the owner's number, not a tuning knob.
 *
 * Under a hundred tokens is basically zero. Strictly under: a probe costing exactly this many is outside the exemption.
 */
export const BASICALLY_ZERO_TOKENS = 100;

/** What one probe actually cost, as the provider counted it on the response. */
export interface ProbeCost {
  /** Every input token, cache creation and cache reads included — the provider bills all three as input. */
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/* A counter the provider sent: a non-negative safe integer, or undefined when the field is not one. */
function tokenCount({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/* An OPTIONAL cache counter: absent is zero, present-but-malformed is undefined so the whole cost is unread. */
function optionalTokenCount({ usage, key }: { usage: Record<string, unknown>; key: string }): number | undefined {
  if (!(key in usage)) {
    return 0;
  }
  return tokenCount({ value: usage[key] });
}

/**
 * Read what a probe cost out of the response body's `usage` counters.
 *
 * Only the counters are read; the model's content is never looked at. An error body, malformed JSON, a missing
 * `usage` or a malformed counter all answer undefined — UNMEASURED, which is never the same claim as zero.
 *
 * @param text the response body as the provider sent it
 * @returns the probe's cost, or undefined when the body does not state one
 */
export function readProbeCost({ text }: { text: string }): ProbeCost | undefined {
  let body: unknown;
  try {
    body = safeJsonParse({ label: "claude gauge probe response", text });
  } catch {
    return undefined;
  }
  if (!isRecord(body) || !isRecord(body["usage"])) {
    return undefined;
  }
  const usage = body["usage"];
  const input = tokenCount({ value: usage["input_tokens"] });
  const output = tokenCount({ value: usage["output_tokens"] });
  const cacheCreation = optionalTokenCount({ key: "cache_creation_input_tokens", usage });
  const cacheRead = optionalTokenCount({ key: "cache_read_input_tokens", usage });
  if (input === undefined || output === undefined || cacheCreation === undefined || cacheRead === undefined) {
    return undefined;
  }
  const inputTokens = input + cacheCreation + cacheRead;
  return Number.isSafeInteger(inputTokens) ? { inputTokens, outputTokens: output } : undefined;
}

/**
 * Every token one probe cost, input and output together — the one sum the ceiling and the render both use.
 *
 * @param cost what the probe cost
 * @returns input plus output tokens
 */
export function probeCostTokens({ cost }: { cost: ProbeCost }): number {
  return cost.inputTokens + cost.outputTokens;
}

/**
 * Whether one probe stayed under {@link BASICALLY_ZERO_TOKENS}, which is what lets it run past a plan's limit.
 *
 * @param cost what the probe cost
 * @returns true when the total is strictly under the ceiling
 */
export function probeCostIsBasicallyZero({ cost }: { cost: ProbeCost }): boolean {
  return probeCostTokens({ cost }) < BASICALLY_ZERO_TOKENS;
}

/**
 * The header naming the organisation the presented credential belongs to.
 *
 * MEASURED: it rides on every ordinary `POST /v1/messages` response, alongside the rate-limit
 * headers this module already exists to collect. So the account a store holds is answered by the probe that
 * was being made anyway — no second endpoint, no second request, and nothing that a busy machine's own
 * `/usage` traffic can throttle away.
 *
 * @internal — exported for {@link organizationId}'s own test to pin the header name it reads.
 */
export const ORGANIZATION_HEADER = "anthropic-organization-id";

/**
 * The organisation a probe response named, when it named one.
 *
 * The value is a private identifier: it is passed to `checkoutIdentity.ts`, stored under the Slopweaver
 * home, and never rendered. Nothing on this path may log it.
 *
 * @param headers the probe response's headers, by lowercase name
 * @returns the organisation id, or undefined when the response carried none
 */
export function organizationId({ headers }: { headers: Readonly<Record<string, string>> }): string | undefined {
  const value = headers[ORGANIZATION_HEADER];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Flatten a `fetch` Headers object into the plain record `usage.ts` reads.
 *
 * @param headers the response's own headers
 * @returns every header by lowercase name
 */
export function headerRecord({ headers }: { headers: Headers }): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}
