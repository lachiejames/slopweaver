/**
 * The environments an app-hosted Claude session runs under: the worker's, and the native Claude Code process the
 * worker's Agent SDK starts. Pure.
 *
 * Both drop the `ANTHROPIC_` and `CLAUDE` namespaces WHOLE, bar the owner's configuration the session reads, because a
 * session that picked up any credential or routing variable from them would spend an account its ledger row never
 * named, and Claude Code reads more of them than any list keeps up with (repro: `strings <the SDK's claude> | grep -oE
 * '\b(ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(KEY|TOKEN)[A-Z_]*\b' | sort -u`; a three-name list missed a refresh token, two
 * session tokens, a gateway token and an API-key descriptor). The CLI's gate judged this seat against exactly that scrub
 * (`src/sessionHarness/appCredentialContext.ts`), so the namespaces and the kept names must stay one, and
 * `desktop/__tests__/unit/claudeEnvironmentPolicy.test.ts` fails the moment they differ, since neither tree can
 * import the other.
 *
 * The native boundary then routes the login: `CLAUDE_SECURESTORAGE_CONFIG_DIR` is always the plan's store, never an
 * inherited one, and a setup-token seat reads its token from descriptor 3, the descriptor every cmux boot line names
 * (`src/claude/seatToken.ts`). The token itself never enters an environment, an argument or the IPC channel.
 */
import { keptEnvironment } from "./keptEnvironment";
import { type ClaudeWorkerLaunchConfig, WORKER_CONFIG_ENV } from "./workerWire";

/** The namespaces neither environment inherits, frozen so an importer cannot remove one. */
export const CLAUDE_DROPPED_PREFIXES: readonly string[] = Object.freeze(["ANTHROPIC_", "CLAUDE"]);

/** The owner's configuration inside those namespaces, which the session reads and which routes no login. */
export const CLAUDE_KEPT_KEYS: readonly string[] = Object.freeze(["CLAUDE_CONFIG_DIR"]);

/**
 * Every credential, auth header and provider switch Claude Code reads (repro: `strings <the SDK's claude> | grep -oE
 * '\b(ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(KEY|TOKEN|HEADERS|BEARER|OAUTH_URL|CREDS_FILE|AUTH_ENV_VAR|MANAGED_BY_HOST)[A-Z_]*\b' |
 * sort -u`, keeping what presents a login or names where one is read from): what a settings file's `env` could set after the scrub, so the flag tier blanks each one. Any other variable a
 * settings file sets applies exactly as it does in a cmux seat, which reads the same files.
 */
const SETTINGS_BLANKED_KEYS: readonly string[] = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_ENVIRONMENT_KEY",
  "ANTHROPIC_AWS_API_KEY",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_GATEWAY_HINT_HEADERS",
  "CLAUDE_CODE_GATEWAY_TOKEN",
  "CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_HFI_BEARER_TOKEN",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_HOST_CREDS_FILE",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_SESSIONS_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
]);

/**
 * Every endpoint Claude Code sends model traffic to, which a settings file could point at another host carrying the
 * plan's login (repro: `strings <the SDK's claude> | grep -oE '\b(ANTHROPIC|CLAUDE_CODE)_[A-Z_]*(BASE_URL|HOST)\b' |
 * sort -u`, keeping the API's and each provider's). A blank reads as unset, so the session reaches the default host.
 */
const SETTINGS_BLANKED_ENDPOINTS: readonly string[] = Object.freeze([
  "ANTHROPIC_API_HOST",
  "ANTHROPIC_AWS_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_GOOGLE_CLOUD_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "CLAUDE_CODE_API_BASE_URL",
]);

/** The descriptor a setup-token seat's token is open on, as `src/claude/seatToken.ts` `SETUP_TOKEN_FD`. */
export const CLAUDE_TOKEN_FD = 3;

/** The variable naming that descriptor, as `src/claude/seatToken.ts` `SETUP_TOKEN_FD_ENV`. */
export const CLAUDE_TOKEN_FD_ENV = "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR";

/**
 * The inherited environment without the dropped namespaces, bar the kept names.
 *
 * @param inherited the environment a child would otherwise inherit
 * @returns the same environment with every Anthropic and Claude variable but the owner's configuration gone
 */
function withoutClaudeNamespaces({
  inherited,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
}): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(inherited).filter(
      ([name]) => CLAUDE_KEPT_KEYS.includes(name) || !CLAUDE_DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  );
}

/**
 * The worker's own environment: credentials, routing and Node preloads dropped, nothing routed yet.
 *
 * @param inherited the app's child environment
 * @returns the environment to start the worker under, before the launch config is added
 */
export function claudeWorkerEnvironment({
  inherited,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  return keptEnvironment({ dropped: ["NODE_OPTIONS"], inherited: withoutClaudeNamespaces({ inherited }) });
}

/**
 * The native Claude Code process's environment: the same scrub again, the worker's config dropped, the plan's store
 * routed, and the token descriptor named only on a setup-token seat.
 *
 * @param inherited the environment the SDK asked to start the process under
 * @param config the worker's launch configuration
 * @returns the complete environment, still with no prototype
 */
export function claudeNativeEnvironment({
  inherited,
  config,
}: {
  inherited: Readonly<Record<string, string | undefined>>;
  config: ClaudeWorkerLaunchConfig;
}): Record<string, string> {
  // The worker runs as Node; the session's own tools must not inherit that, or an Electron they start would too.
  const environment = keptEnvironment({
    dropped: ["NODE_OPTIONS", WORKER_CONFIG_ENV, "ELECTRON_RUN_AS_NODE"],
    inherited: withoutClaudeNamespaces({ inherited }),
  });
  return Object.assign(environment, routedEnvironment({ config }));
}

/**
 * The routing variables, set to the plan's own values: the store always, the token descriptor only on a setup-token seat.
 *
 * @param config the worker's launch configuration
 * @returns the routing variables to set
 */
function routedEnvironment({ config }: { config: ClaudeWorkerLaunchConfig }): Record<string, string> {
  const routed: Record<string, string> = { CLAUDE_SECURESTORAGE_CONFIG_DIR: config.credential.secureStorageDir };
  if (config.credential.kind === "setup-token") {
    routed[CLAUDE_TOKEN_FD_ENV] = String(CLAUDE_TOKEN_FD);
  }
  return routed;
}

/**
 * The `env` the session's flag settings carry. Claude Code applies a settings file's `env` after the process starts,
 * so the scrub above cannot reach it; the flag tier outranks every user, project and local settings file, so this
 * blanks each credential, provider switch and model endpoint and pins the routing to the plan's own values over whatever those set.
 *
 * @param config the worker's launch configuration
 * @returns every credential blanked and every routing variable pinned, the descriptor blanked on a store seat
 */
export function claudeSettingsEnvironment({ config }: { config: ClaudeWorkerLaunchConfig }): Record<string, string> {
  const blanked = Object.fromEntries(
    [...SETTINGS_BLANKED_KEYS, ...SETTINGS_BLANKED_ENDPOINTS, CLAUDE_TOKEN_FD_ENV].map((key) => [key, ""]),
  );
  return { ...blanked, ...routedEnvironment({ config }) };
}
