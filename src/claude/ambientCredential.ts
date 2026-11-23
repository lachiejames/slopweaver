/**
 * Decide whether an Anthropic-issued credential in the environment has taken the fleet OFF its subscription
 * plans, and say which one did it.
 *
 * ## Why this exists at all
 *
 * The rest of `src/claude/*` selects between credential STORES: a store is a directory, the directory picks
 * a keychain item, and the item holds one Max plan's OAuth credential. Every gauge, every trigger and every
 * swap in this feature is about those stores. None of it is about what a Claude Code session actually
 * presents when it makes a request — and those are not the same thing.
 *
 * MEASURED against Claude Code v2.1.261. The CLI resolves a credential from an ordered list of
 * sources it names in its own diagnostics, and the first four are `ANTHROPIC_API_KEY`, `apiKeyHelper`, the
 * saved `/login` API key and `ANTHROPIC_AUTH_TOKEN` — every one of them ahead of `the saved claude.ai login`
 * that a store holds. Its own managed-policy refusal groups the three configurable ones as a set: _"an
 * Anthropic-issued credential (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or apiKeyHelper) is configured. A
 * non-OAuth Anthropic credential cannot satisfy the org pin."_ Reproduce the source list with
 * `strings -a ~/.local/share/claude/versions/2.1.261 | grep -n "from the saved claude.ai login"` and read the
 * ten lines above it.
 *
 * ## What that costs, and why it is silent
 *
 * An API key is a Console ORGANISATION credential billed per token. A Max plan's budget rides the OAuth
 * credential and nothing else, so a key does not draw on it, cannot exhaust it, and is not rotated by moving
 * one. Set the variable and every session on the machine keeps working, looks identical, and stops spending
 * the plans the owner pays for.
 *
 * The gauge cannot see it either. Measured the same day: the CLI's bundle names `anthropic-ratelimit-unified`
 * 68 times and `anthropic-ratelimit-requests`, `anthropic-ratelimit-input-tokens` and
 * `anthropic-ratelimit-tokens` — the families an API-key response carries instead — ZERO times (reproduce
 * with `strings -a <the binary> | grep -c anthropic-ratelimit-requests`). `usage.ts` parses the unified
 * family only and fails closed on anything else, and `transcriptSignal.ts` already classifies both refusals
 * an API key can produce, a spend cap and a per-model cap, as `ignored`. So under a key both lanes are blind
 * BY DESIGN, and the store readings a session prints go on being true about the store while being the wrong
 * question.
 *
 * Which is why this module reports rather than probes: the condition is a property of the environment the
 * verb was launched in, readable with no request and no credential, and it is the one fact that makes every
 * other reading in this feature mean what it appears to mean.
 */

/** What the environment says the fleet is actually presenting to the provider. */
type ClaudeAmbientCredentialKind =
  /** No Anthropic-issued credential is configured, so a session uses the store's own subscription login. */
  | "subscription"
  /** A configured credential outranks the store, so the store's plan is not what a session spends. */
  | "shadowed";

/** The verdict on one environment. Carries a NAME, never a value — a credential may not reach a log line. */
export interface ClaudeAmbientCredential {
  readonly kind: ClaudeAmbientCredentialKind;
  /** What configured it, by name — an environment variable, or the settings key. Absent when unshadowed. */
  readonly source?: string;
  /** Why, in one sentence a verb prints verbatim. */
  readonly reason: string;
}

/**
 * The environment variables that outrank a store's login, in the CLI's own resolution order.
 *
 * `CLAUDE_CODE_OAUTH_TOKEN` is deliberately NOT here. It is a subscription credential like the store's own,
 * so it changes which plan a session spends without changing that a plan is what it spends — a different
 * question from this one, and rotating between stores under it is still meaningful.
 */
const SHADOWING_VARIABLES: readonly string[] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/**
 * Whether a configured value is really present. Blank counts as absent because the CLI's own reader is a
 * truthiness test — `let e = env.ANTHROPIC_AUTH_TOKEN; if (e) return \`Bearer ${e}\`` — so an empty string
 * shadows nothing there and must shadow nothing here.
 *
 * @param value the raw configured value, or undefined when the variable is unset
 * @returns whether it would be presented to the provider
 */
function present({ value }: { value: string | undefined }): boolean {
  return value !== undefined && value.trim() !== "";
}

/**
 * Classify one environment. Pure: it reads the record it is handed and performs no I/O, so a caller decides
 * whether that record is `process.env` or a fixture.
 *
 * @param apiKeyHelper the `apiKeyHelper` command from Claude Code's settings, when the caller resolved one
 * @param env every environment variable visible to the process
 * @returns which credential a session launched here would present, and what named it
 */
export function classifyAmbientCredential({
  apiKeyHelper,
  env,
}: {
  apiKeyHelper?: string;
  env: Readonly<Record<string, string | undefined>>;
}): ClaudeAmbientCredential {
  const variable = SHADOWING_VARIABLES.find((name) => present({ value: env[name] }));
  if (variable !== undefined) {
    return {
      kind: "shadowed",
      reason:
        `\`${variable}\` is set, and Claude Code resolves it AHEAD of the subscription login a credential ` +
        `store holds — so every session launched here bills a Console organisation per token instead of ` +
        `spending a plan, and no plan gauge describes what it costs`,
      source: variable,
    };
  }
  if (present({ value: apiKeyHelper })) {
    return {
      kind: "shadowed",
      reason:
        "`apiKeyHelper` is configured in Claude Code's settings, and Claude Code runs it for a credential " +
        "ahead of the subscription login a credential store holds — so every session launched here bills a " +
        "Console organisation per token instead of spending a plan, and no plan gauge describes what it costs",
      source: "apiKeyHelper",
    };
  }
  return {
    kind: "subscription",
    reason: "no Anthropic-issued credential is configured, so a session presents its store's own plan login",
  };
}
