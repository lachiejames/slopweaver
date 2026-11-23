/**
 * A PLAN-funded Talk call — what `codex app-server` is launched with and told, pure data.
 *
 * It exists so the console voice runs on the owner's ChatGPT plan when the platform account's credits run out
 * mid-call. A plan login funds realtime only through Codex's own app-server (the platform session endpoints
 * answer 403 on a plan), so the call is minted the way
 * Codex CLI 0.157.1's `/voice` mints one — `thread/start`, then `thread/realtime/start` at protocol v3 with the
 * browser's WebRTC offer — never a hand-rolled request to the provider. The console holds the app-server child
 * for exactly the call's life (`site/lib/talkPlanLaunch.ts`); this module decides everything that child is
 * told, so what the model sees is a unit test.
 *
 * Every value here was MEASURED on a live call, codex-cli 0.157.1, `auth_mode:
 * chatgpt`, no API key:
 *
 * - `delegationAckFiller: false` is load-bearing. With the provider default the voice INVENTED an answer
 *   ("banana") before the delegated tool returned; with it off it said "let me fetch that" and then the real one.
 * - `prompt` is the VOICE model's instructions ("always begin with Kia ora" was obeyed); the delegated Codex
 *   thread reads `developerInstructions`. `talkInstructions` below builds the pair.
 * - By default the thread loads the owner's Codex hooks, plugins, MCP servers, shell and project docs. The disable list
 *   and one inert stub per configured MCP server strip that to: `exec`/`wait` (code mode — REQUIRED, disabling
 *   `code_mode_host` makes dynamic tools vanish), `request_user_input`, `apply_patch` under a read-only sandbox,
 *   MCP resource listing with no server, `clock`, the web search, and `collaboration.*` (not removable:
 *   `agents.max_threads=0` is refused). A bare `mcp_servers.<name>.enabled=false` errors "invalid transport",
 *   which is why each stub is a whole table.
 *
 * The approval policy, the sandbox, web search and the browser-off overrides are not decided here: both Codex
 * runtimes project them from `../codex/capabilities.ts`. The browser-off set rides
 * BEFORE the per-server stubs; MEASURED on the vendored CLI against the owner's real home (five servers,
 * `node_repl` and `cua_repl` among them): `codex app-server --strict-config <this argv> < /dev/null` exits 0
 * silently, where adding `-c not_a_real_key=1` exits 1 naming it, and `codex <the same flags> mcp list` lists
 * every server `disabled` — a later `mcp_servers.node_repl={…}` table MERGES with the earlier dotted keys.
 */
import { codexCapabilityOverrides, VOICE_THREAD_CAPABILITIES } from "../codex/capabilities.js";
import { err, ok, type Result } from "../lib/result.js";
import { COLLEAGUE_GREETING_VOICE_LINES } from "./colleagueGreetingLines.js";
import { type PlanLaunchError, PlanLaunchErrors } from "./planLaunchErrors.js";
import type { PlanVoice } from "./planVoices.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_REASONING_EFFORT, TALK_VOICE_INSTRUCTIONS } from "./sessionConfig.js";
import { TALK_TYPED_INSTRUCTIONS, type TalkSurface } from "./talkSurface.js";
import { TALK_TOOLS, type TalkTool } from "./talkToolSchemas.js";

/** The realtime protocol a plan call speaks — the only one the chatgpt.com voices were measured on. */
const TALK_PLAN_REALTIME_VERSION = "v3";

/** What a plan call's offer report names as its live model: Codex chooses it, so the report names the protocol. */
const TALK_PLAN_MODEL = "realtime-v3";

/**
 * The model the delegated Codex thread thinks with. Named rather than inherited: with `model` omitted the
 * owner's own `~/.codex/config.toml` decides, and a default that can drift is the thing `CODEX_MODEL`'s own
 * comment refuses. This is the one the live proof ran on.
 */
export const TALK_PLAN_BACKEND_MODEL = "gpt-6-astra";

/**
 * The Codex features a plan call's thread must not have — see this module's header for the measurement. This
 * strips the TOOL SURFACE; `browser_use`, `computer_use` and `in_app_browser` here are not the browser-off
 * control, which `../codex/browserSurface.ts` measured this spelling is not — the capability overrides are.
 */
const DISABLED_FEATURES: readonly string[] = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "browser_use",
  "computer_use",
  "image_generation",
  "goals",
  "view_image",
  "in_app_browser",
  "skill_search",
  "tool_suggest",
  "sleep_tool",
];

/**
 * The dynamic-tool namespace every picture-answering tool ({@link TalkTool.answersWithPicture}) is declared in, and
 * which code mode is told to offer DIRECTLY rather than nested inside `exec`.
 *
 * Nested in
 * `exec`, a tool's answer comes back to the JavaScript as a value, and a picture reaches the model only if that
 * script calls `image(...)` on it; otherwise the model reads the data URL as text. MEASURED on the
 * vendored CLI with this module's own argv, instructions and tools, one `read_screen` answered with a frame
 * and asked how many failures the first card names: nested, 0 of 3 ("the screenshot came through
 * as encoded text"); in this namespace, called directly, 4 of 4 ("577 failures, from June to September"). Repro:
 * the probe in `docs/console/voice-sees-the-owners-screen.md`.
 */
export const PICTURE_NAMESPACE = "see";

/** `-c` overrides every plan launch carries of its own: no project docs, no bundled skills, named model and effort. */
const CONFIG_OVERRIDES: readonly string[] = [
  "project_doc_max_bytes=0",
  "skills.bundled.enabled=false",
  `model="${TALK_PLAN_BACKEND_MODEL}"`,
  `model_reasoning_effort="${TALK_REASONING_EFFORT}"`,
  `features.code_mode.direct_only_tool_namespaces=["${PICTURE_NAMESPACE}"]`,
];

/**
 * An MCP server name a stub can be written for: a bare TOML key. Anything else is refused rather than quoted,
 * because a name that could break out of the key path would turn the stub into an arbitrary override.
 */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** One dynamic tool as `thread/start` declares it to the delegated thread. */
interface PlanDynamicFunction {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/** A namespace of dynamic tools, as `thread/start` declares one: the picture tools' {@link PICTURE_NAMESPACE}. */
interface PlanDynamicNamespace {
  readonly type: "namespace";
  readonly name: string;
  readonly description: string;
  readonly tools: readonly PlanDynamicFunction[];
}

/** One entry of `thread/start`'s `dynamicTools`. */
type PlanDynamicTool = PlanDynamicFunction | PlanDynamicNamespace;

/**
 * The dynamic tools a plan call declares: every talk tool, in order, with the picture-answering ones gathered into
 * {@link PICTURE_NAMESPACE} at the place the first of them stood, so code mode offers them as direct calls.
 *
 * @param tools the talk tools
 * @returns the `dynamicTools` list
 */
export function planDynamicTools({ tools }: { tools: readonly TalkTool[] }): readonly PlanDynamicTool[] {
  const fn = (tool: TalkTool): PlanDynamicFunction => ({
    description: tool.description,
    inputSchema: { ...tool.parameters },
    name: tool.name,
    type: "function",
  });
  const pictures = tools.filter((tool) => tool.answersWithPicture === true).map(fn);
  const declared: PlanDynamicTool[] = [];
  for (const tool of tools) {
    if (tool.answersWithPicture !== true) {
      declared.push(fn(tool));
    } else if (tool.name === pictures[0]?.name) {
      declared.push({
        description: "Tools whose answer is a picture you look at: the owner's screen, and an image file.",
        name: PICTURE_NAMESPACE,
        tools: pictures,
        type: "namespace",
      });
    }
  }
  return declared;
}

/** The `thread/start` params a plan call sends. */
interface PlanThreadStartParams {
  readonly model: string;
  readonly ephemeral: true;
  readonly sandbox: typeof VOICE_THREAD_CAPABILITIES.sandbox;
  readonly approvalPolicy: typeof VOICE_THREAD_CAPABILITIES.approvalPolicy;
  readonly developerInstructions: string;
  readonly dynamicTools: readonly PlanDynamicTool[];
}

/** The `thread/realtime/start` params a plan call sends, less the `threadId` and `transport` only the call has. */
interface PlanRealtimeStartTemplate {
  readonly outputModality: "audio";
  readonly version: typeof TALK_PLAN_REALTIME_VERSION;
  readonly voice: PlanVoice;
  readonly includeStartupContext: false;
  readonly prompt: string;
  readonly delegationAckFiller: false;
  /**
   * The console, not the app-server, hands the thinking model's words to the voice: every completed message is held
   * until the owner's words go quiet and then appended (`site/lib/talkPlanHeldAnswers.ts`), so an answer landing mid-clause
   * waits for the owner. Left to the app-server, each is forwarded at once and the voice speaks it at the owner's first pause,
   * cutting in. That covers a turn the console starts itself (`PlanCall.attachLook`) as
   * well, which nothing forwards otherwise. Live on the plan: with this `true`, a completed answer is
   * never voiced until appended (codex-cli 0.157.1 `ThreadRealtimeStartParams`).
   */
  readonly clientManagedHandoffs: true;
  /** `false`, its documented default: a held answer is appended as speech, never added as a conversation item. */
  readonly codexResponsesAsItems: false;
  /**
   * The voice session's starting HISTORY, beside its `prompt` (codex-cli 0.160.1 `ThreadRealtimeStartParams`: V3
   * only, at most 128 items and 8,192 estimated tokens). Exactly one `developer` item, the greeting lines: those lines
   * rode only the prompt, 4 lines in, and the voice still opened "Hi! I'm ChatGPT…" on a bare "Hello." (desktop e2e
   * run `2026-11-04T125249Z`, `report.json`'s `call.openings`). No example exchange: a made-up "Hello." / "Hey." would
   * read as a greeting already traded (`./colleagueGreetingLines.ts`).
   */
  readonly initialItems: readonly { readonly role: "developer"; readonly text: string }[];
}

/** How the console launches the app-server: the binary, its argv, and the credentials it must NOT inherit. */
interface PlanAppServerLaunch {
  readonly executable: string;
  readonly argv: readonly string[];
  /** Removed from the child's environment, so an exported API key can never outrank the plan login. */
  readonly unsetEnv: readonly string[];
  /**
   * The `$CODEX_HOME` of the register row this call routed to (`codex/seatDecision.ts`), which the console sets on
   * the child so the call is paid by that plan and no other — never the ambient home's login.
   */
  readonly codexHome: string;
  /** That row's register alias, for the report and the log; the home is what the launch acts on. */
  readonly planAlias: string;
}

/** Everything the console needs to open one plan call, as `talk offer` prints it. */
export interface PlanOfferComposition {
  readonly model: typeof TALK_PLAN_MODEL;
  readonly backendModel: string;
  readonly voice: PlanVoice;
  /** A voice call, or the typed box: a typed one never sends `realtime`, which stays for the wire's shape. */
  readonly surface: TalkSurface;
  readonly thread: PlanThreadStartParams;
  readonly realtime: PlanRealtimeStartTemplate;
  readonly appServer: PlanAppServerLaunch;
  readonly tools: readonly string[];
  readonly writers: readonly string[];
}

/**
 * The app-server argv for a plan call: the disabled features, the overrides, the voice's capability overrides,
 * and one inert stub per MCP server the owner's Codex config declares, so none of them starts inside the call.
 *
 * @param mcpServers the configured server names, as `codex mcp list --json` reports them
 * @returns the argv after the executable
 */
export function planAppServerArgv({ mcpServers }: { mcpServers: readonly string[] }): readonly string[] {
  return [
    "app-server",
    "--strict-config",
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...[...CONFIG_OVERRIDES, ...codexCapabilityOverrides({ runtime: "voice" })].flatMap((override) => ["-c", override]),
    ...mcpServers.flatMap((name) => ["-c", `mcp_servers.${name}={command="true",enabled=false}`]),
  ];
}

/**
 * The MCP server names out of `codex mcp list --json`, refusing the whole list when any entry cannot be stubbed:
 * a server left un-stubbed would start inside the call, so an unreadable list fails the plan mint closed.
 *
 * @param json what `codex mcp list --json` printed
 * @returns every configured server's name, or why the list cannot be trusted
 */
export function mcpServerNamesOf({ json }: { json: string }): Result<readonly string[], PlanLaunchError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    return err(PlanLaunchErrors.mcpListNotJson({ cause }));
  }
  if (!Array.isArray(parsed)) {
    return err(PlanLaunchErrors.mcpListNotAList());
  }
  const names: string[] = [];
  for (const entry of parsed) {
    const name: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "name") : undefined;
    if (typeof name !== "string" || !MCP_SERVER_NAME.test(name)) {
      return err(PlanLaunchErrors.mcpServerUnstubbable({ name }));
    }
    names.push(name);
  }
  return ok(names);
}

/**
 * The two prompts one call carries: the context rides the DELEGATED model's instructions and the opener the VOICE's,
 * because the voice never reads the delegated ones. The first goes to the Codex thread, the second to its realtime
 * start.
 *
 * @param context the owner's voice brief, where the last calls left off and the stored pack as one block, or `undefined` when
 *   none rides in
 * @param opener where the last call left off, or `undefined` when no steer is in the window
 * @param surface a typed conversation also hands the delegated model the opener and the typed-medium block
 * @returns the delegated model's instructions and the voice's
 */
export function talkInstructions({
  context,
  opener,
  surface,
}: {
  context: string | undefined;
  opener: string | undefined;
  surface: TalkSurface;
}): {
  readonly backend: string;
  readonly voice: string;
} {
  let backend = TALK_BACKEND_INSTRUCTIONS;
  if (context !== undefined) {
    backend = `${backend}\n\n${context}`;
  }
  // A typed conversation has no voice to carry the opener, so the delegated model reads it, then the typed block,
  // last, so it overrides every spoken-only line above it.
  if (surface === "typed") {
    if (opener !== undefined) {
      backend = `${backend}\n\n${opener}`;
    }
    backend = `${backend}\n\n${TALK_TYPED_INSTRUCTIONS}`;
  }
  let voice = TALK_VOICE_INSTRUCTIONS;
  if (opener !== undefined) {
    voice = `${TALK_VOICE_INSTRUCTIONS}\n\n${opener}`;
  }
  return { backend, voice };
}

/**
 * Everything one plan call is launched with and told. The tools are an exact projection of `TALK_TOOLS` and
 * the prompts are `talkInstructions`', so what the model is told is this module's unit test.
 *
 * @param voice the chatgpt.com voice to answer in
 * @param context the owner's voice brief, where the last calls left off and the stored pack as one block, or `undefined` when
 *   none rides in
 * @param opener where the last call left off, or `undefined` when no steer is in the window
 * @param executable the vendored Codex CLI the console launches
 * @param mcpServers the configured MCP server names to stub out
 * @param unsetEnv the credential variables the child must not inherit
 * @param surface a voice call, or the typed box driving the same thread by `turn/start`
 * @param codexHome the routed register row's `$CODEX_HOME`, the plan that pays for this call
 * @param planAlias that row's register alias
 * @returns the composition `talk offer` prints
 */
export function planOfferComposition({
  voice,
  context,
  opener,
  executable,
  mcpServers,
  unsetEnv,
  surface,
  codexHome,
  planAlias,
}: {
  voice: PlanVoice;
  context: string | undefined;
  opener: string | undefined;
  executable: string;
  mcpServers: readonly string[];
  unsetEnv: readonly string[];
  surface: TalkSurface;
  codexHome: string;
  planAlias: string;
}): PlanOfferComposition {
  const instructions = talkInstructions({ context, opener, surface });
  return {
    appServer: { argv: planAppServerArgv({ mcpServers }), codexHome, executable, planAlias, unsetEnv },
    backendModel: TALK_PLAN_BACKEND_MODEL,
    model: TALK_PLAN_MODEL,
    realtime: {
      clientManagedHandoffs: true,
      codexResponsesAsItems: false,
      delegationAckFiller: false,
      includeStartupContext: false,
      initialItems: [{ role: "developer", text: COLLEAGUE_GREETING_VOICE_LINES.join("\n") }],
      outputModality: "audio",
      prompt: instructions.voice,
      version: TALK_PLAN_REALTIME_VERSION,
      voice,
    },
    thread: {
      ...VOICE_THREAD_CAPABILITIES,
      developerInstructions: instructions.backend,
      dynamicTools: planDynamicTools({ tools: TALK_TOOLS }),
      ephemeral: true,
      model: TALK_PLAN_BACKEND_MODEL,
    },
    surface,
    tools: TALK_TOOLS.map((tool) => tool.name),
    voice,
    writers: TALK_TOOLS.filter((tool) => tool.kind === "relay" || tool.kind === "draft").map((tool) => tool.name),
  };
}
