/**
 * The ONLY file in this repository permitted to import `@openai/codex-sdk`.
 *
 * That restriction is mechanical, not a convention: `src/devLint/schedulerBypass.ts` fails the build on an
 * import of the package from anywhere else — policing the PACKAGE rather than the constructor spelling,
 * because `import { Codex as Brain }` walks straight past a constructor regex.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED LIKE A WALL
 * ---------------------------------------------------------------------------
 *
 * Codex is a second brain here; another agent writes every line that ships. The dangerous part is that the
 * sandbox is NOT safe by default. A real developer machine was measured with
 * `sandbox_mode = "danger-full-access"` in `~/.codex/config.toml`, so a thread started without options would
 * inherit full write access — silently, with no error and nothing in the
 * output to notice. Defaulting the option in a wrapper is not enough, because the next person to add a
 * parameter re-opens the hole.
 *
 * Two commands settle that, and they answer different questions. `codex doctor --summary` reports the
 * EFFECTIVE sandbox — `unrestricted fs + enabled network` on that machine. `codex app-server
 * --strict-config < /dev/null` reads the schema, reporting the FIRST problem it finds — a key it does
 * not read, a bad value, a syntax error — and STOPPING there. Never conclude anything from what it
 * printed: the first problem masks every later one, so fix what it names and re-run. An EMPTY run
 * exiting 0, over a home Codex can write, is the best reading available and is still not total — it does
 * not descend into every table, and an unknown key under `[tui]` passes it in silence while `doctor`
 * shows the setting had no effect. And it can fail for reasons that are not the config at all — a home it
 * cannot write is one — so treat a failure as evidence only when the failure NAMES the config.
 *
 * An ignored sandbox key does not fail — the file is read as if that line were absent, so the effective
 * sandbox is whatever the REST of the config gives and the intent behind the line applies in NEITHER
 * direction. With no other sandbox key it reads restricted, which looks safe; written under a line Codex
 * does read, it changes nothing at all.
 * Re-check both from `/`, outside this checkout, with `CODEX_HOME` set to the home you mean rather than
 * the one you inherited. `codex --version` confirms the build, `codex doctor --summary` reports the
 * effective sandbox, and `codex app-server --strict-config` with stdin closed (`< /dev/null`) does the
 * schema read. A shell line is deliberately not written out here: `no-headless` NH003 reads a runner
 * basename after `&&` or at the start of a line in a `.ts` file as a launch, and it is right to.
 * Measured on codex-cli 0.155.1.
 * `sandbox_mode` is the TOML key; `sandboxMode`, the SDK option this file locks, is a different interface.
 * Never rename one to match the other.
 *
 * So the unsafe state is made unrepresentable three ways:
 *
 *  1. {@link lockedThreadOptions} returns `Required<ThreadOptions>`. Every option the SDK has must be
 *     stated explicitly, so when the SDK ADDS one, this file stops compiling instead of quietly
 *     inheriting whatever the machine's config says. That compile error is the feature.
 *  2. The exported seam accepts only `workingDirectory` (plus `threadId` to resume). There is no options
 *     bag, no `sandboxMode` parameter and no escape hatch, so no caller can override policy.
 *  3. `productionCodexClient()` hands the SDK an environment that is this process's own plus the ROUTED
 *     `CODEX_HOME`, with every credential the CLI would read instead of that home's `auth.json` REMOVED —
 *     so the routed account is the one that gets spent, never an API key somebody exported into this
 *     shell. See {@link codexClientEnvironment} for the measurement and the repro command.
 *
 * MEASURED, not assumed (probes against 0.145.0):
 *   * `workspace-write` over a SCRATCH working directory blocks a repo write while allowing a scratch write:
 *     measured, the repo canary was absent afterwards and the scratch file was present. The repo
 *     stays unwritable because it is neither the workspace nor in `additionalDirectories`.
 *   * the locked options SURVIVE `resumeThread` when re-supplied. This matters enormously —
 *     the predecessor's CLI transport REJECTED `--sandbox` on `exec resume`, so the obvious fix (drop the
 *     flag on resume) silently ran every steered turn under the machine's own config. Through the SDK the
 *     options are re-applied, and a post-resume write was refused with the file absent from disk.
 *   * `networkAccessEnabled: false` blocked egress (curl exit 6, HTTP 000) — a historical probe. It is now
 *     deliberately TRUE; see `docs/security/codex-boundary.md`.
 *   * `approvalPolicy: "never"` — NOT the sandbox — is what stops an MCP tool call. Verified with a real
 *     stdio MCP server exposing a mutating tool: under BOTH `read-only` and `workspace-write` the dispatch
 *     was cancelled and the sentinel file never appeared. **So `approvalPolicy` is load-bearing for the
 *     write story — the repo-write refusal cites "user approval settings", not the sandbox.
 *     Never relax it to `on-request` on the assumption the sandbox holds that line.**
 *   * `config: { mcp_servers: {} }` does NOT disable MCP — the server still starts and its tools are still
 *     offered. It is deliberately NOT used here and must not be claimed as a control.
 *
 * What this does NOT claim: an MCP server process configured globally is still SPAWNED, so a hostile entry
 * in `~/.codex/config.toml` can act on startup independently of anything decided here. The one named
 * exception is the ChatGPT app's browser and computer-use surface, which every client is built with
 * `configOverrides` switching OFF (`./capabilities.ts`, the one source both Codex runtimes project their
 * approval policy, sandbox, web search and browser-off from; `./browserSurface.ts` measures the spelling). And read-only is
 * not a least-privilege READ boundary — Codex can read outside the working directory, and it now has network access and live web
 * search. `docs/security/codex-boundary.md` states all of it.
 */

import { Codex, type CodexOptions, type ThreadOptions } from "@openai/codex-sdk";
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { safeCodex } from "../lib/safeBoundary.js";
import { admittedCodexClient, poisonedThread } from "./admittedClient.js";
import { codexCapabilityOverrides, PASS_THREAD_CAPABILITIES } from "./capabilities.js";
import type { CodexDestination } from "./destinations.js";
import { CODEX_MODEL, CODEX_REASONING_EFFORT } from "./profiles.js";
import { drainStream, toItemActivity } from "./streamDrain.js";
import type { CodexEventSink, CodexUsage, ItemActivity, UsageMeasurement } from "./types.js";
import { type CodexCli, withCodexPathDirs } from "./vendoredCli.js";

/**
 * Every thread option, stated explicitly.
 *
 * `Required<ThreadOptions>` is the whole point: omitting any option becomes a COMPILE error rather than a
 * silent inherit from `~/.codex/config.toml`. If a future SDK release adds an option, this function stops
 * compiling and somebody has to make a deliberate decision about it.
 *
 * @param workingDirectory the per-pass scratch directory, the only place the pass may write
 * @param model the model this pass asked for — the repository default unless the pass named another
 * @returns every thread option, stated explicitly — `Required` so a new SDK option breaks the build rather
 *   than silently inheriting from the user's global config
 */
function lockedThreadOptions({
  model = CODEX_MODEL,
  posture = "pass",
  workingDirectory,
}: {
  model?: string;
  posture?: CodexThreadPosture;
  workingDirectory: string;
}): Required<ThreadOptions> {
  if (posture === "sealed") {
    return { ...SEALED_POLICY, model, workingDirectory };
  }
  return { ...LOCKED_POLICY, model, workingDirectory };
}

/**
 * Which of the two locked policies a client's threads carry. `pass` is {@link LOCKED_POLICY}, what `codex plan|review`
 * investigates under; `sealed` is {@link SEALED_POLICY}, for a pass that only composes from what its prompt holds.
 * Neither is a parameter a caller can widen: the choice is between two constants, and `sealed` is strictly narrower.
 */
export type CodexThreadPosture = "pass" | "sealed";

/**
 * Every locked option EXCEPT the working directory and the model.
 *
 * Split out so the artifact can disclose the policy without being handed a path — including when the pass
 * never ran because its workspace could not be created. Inventing a placeholder directory there would be a
 * disclosure of something that never existed. The model is the one choice a pass may make for itself
 * (`codex plan|review --model`), so it travels on the client rather than in the policy; the effort does not.
 */
export const LOCKED_POLICY = {
  // The approval policy (`never` — LOAD-BEARING: measured to be what blocks an MCP tool dispatch, see the
  // header), the sandbox (`workspace-write`, but only across `workingDirectory` — which callers set to a
  // per-pass SCRATCH directory, never the repository) and live web search. Decided once for both Codex
  // runtimes in `./capabilities.ts`; spread here, never restated.
  ...PASS_THREAD_CAPABILITIES,
  // EMPTY IS THE CONTROL. `additionalDirectories` grants extra WRITABLE roots, so listing the repository
  // here would hand back exactly the write access the scratch workspace exists to withhold.
  additionalDirectories: [],
  modelReasoningEffort: CODEX_REASONING_EFFORT,
  // A brain that cannot look anything up is a worse brain. Costs a documented egress — see docs/security/codex-boundary.md.
  networkAccessEnabled: true,
  // The scratch workspace is deliberately NOT a git repository.
  skipGitRepoCheck: true,
  // The deliberate decision `Required<ThreadOptions>` forced when the SDK added this option in 0.151.0.
  // It is a CLASSIFICATION, not a control: the SDK forwards it as `--thread-source <value>` when a thread
  // is first created, so it names who opened the thread in Codex's own records and changes no policy here.
  // Stated rather than omitted for the same reason as every line above — an absent option inherits from
  // `~/.codex/config.toml`, and a pass that cannot say which product opened it is one nobody can attribute.
  threadSource: "slopweaver",
} as const satisfies Omit<Required<ThreadOptions>, "workingDirectory" | "model">;

/**
 * {@link LOCKED_POLICY} with every reach outward switched off: a read-only sandbox, no network and no web search. For a
 * pass whose whole input is its prompt — the Slack draft beside the original (`./slackDraftPass.ts`) composes from the
 * conversation it is handed and has nothing to look up, so a thread able to fetch or write is reach it never needs.
 * `approvalPolicy` stays `never`, which is what stops an MCP tool dispatch (the header).
 */
const SEALED_POLICY = {
  ...LOCKED_POLICY,
  networkAccessEnabled: false,
  sandboxMode: "read-only",
  webSearchEnabled: false,
  webSearchMode: "disabled",
} as const satisfies Omit<Required<ThreadOptions>, "workingDirectory" | "model">;

/** One completed turn, mapped off the SDK's shape into ours. */
export interface CodexTurnResult {
  readonly finalResponse: string;
  readonly usage: UsageMeasurement;
  readonly items: ItemActivity;
}

/**
 * A thread whose options are LOCKED. There is no option to make it anything else.
 *
 * Named for the invariant that actually holds. It was `ReadOnlyCodexThread`, which described a sandbox mode
 * rather than a guarantee — and once the sandbox became `workspace-write` over a scratch directory, the old
 * name would have been a lie in the one place a reader looks to check.
 */
export interface LockedCodexThread {
  /** The SDK thread id once it exists — null for roughly the first 235ms of a turn (measured). */
  currentId(): string | null;
  run({
    input,
    outputSchema,
    signal,
    onEvent,
  }: {
    input: string;
    outputSchema: unknown;
    signal: AbortSignal;
    /** Receives each step as it happens. Omit to run blind, which is what this used to do. */
    onEvent?: CodexEventSink | undefined;
  }): Promise<Result<CodexTurnResult, IngestError>>;
}

/**
 * The product seam. Deliberately narrow: `workingDirectory` is the only thing a caller chooses, and
 * `threadId` the only extra on resume. Everything about safety is decided in this module.
 */
export interface LockedCodexClient {
  /** The model every thread this client opens asks for — what the artifact discloses as `requestedModel`. */
  readonly model: string;
  startThread({ workingDirectory }: { workingDirectory: string }): LockedCodexThread;
  resumeThread({ threadId, workingDirectory }: { threadId: string; workingDirectory: string }): LockedCodexThread;
}

/**
 * The SDK surface this module actually uses — the injection point for a fake in tests.
 *
 * Scoped to this file on purpose: it is an adapter-test contract, never the product seam. Tests inject a
 * plain object here (no `vi.mock`, which the ESLint testing rules ban) and can then assert the EXACT
 * locked options object that was handed to the SDK.
 */
export interface CodexSdkPort {
  /**
   * POSITIONAL on purpose. These two mirror the Codex SDK's own signatures
   * (`codex.startThread(options)` / `codex.resumeThread(id, options)`), so this is the
   * "framework/handler signature the runtime dictates" exception in
   * `.claude/rules/typescript-patterns.md` — the same exception the CLI's `(argv)` contract uses.
   * Re-ordering them into a named object would make the adapter disagree with the thing it adapts,
   * which is the one place a shape mismatch could hide.
   */
  startThread(options: Required<ThreadOptions>): CodexSdkThread;
  // named-object-params-exempt: mirrors the SDK's own codex.resumeThread(id, options) signature
  resumeThread(threadId: string, options: Required<ThreadOptions>): CodexSdkThread;
}

/** The subset of the SDK's `Thread` this module drives. */
export interface CodexSdkThread {
  readonly id: string | null;
  // named-object-params-exempt: mirrors the SDK Thread's own runStreamed(input, turnOptions) signature
  runStreamed(
    input: string,
    turnOptions: { outputSchema: unknown; signal: AbortSignal },
  ): Promise<{ readonly events: AsyncIterable<CodexSdkStreamEvent> }>;
}

/**
 * The subset of the SDK's `ThreadEvent` union this module reads.
 *
 * Every field is optional because this is ONE shape standing in for a discriminated union — which is what
 * makes the SDK's own union structurally assignable to it without a cast. That assignability is the point:
 * a cast here would be the one place a shape change could slip through unnoticed, which is the same reason
 * `CodexSdkPort` mirrors the SDK's positional signatures rather than tidying them.
 */
export interface CodexSdkStreamEvent {
  readonly type: string;
  readonly thread_id?: string;
  readonly usage?: CodexUsage;
  readonly message?: string;
  readonly error?: { readonly message: string };
  readonly item?: {
    readonly type: string;
    readonly text?: string;
    readonly command?: string;
    readonly exit_code?: number;
    readonly query?: string;
    readonly changes?: readonly { readonly path: string }[];
  };
}

/**
 * Map the SDK's usage onto an honest measurement.
 *
 * `usage: null` is a real case the SDK's own types admit, and it means NOT MEASURED — never zero. The
 * discriminated union in `./types.ts` is what makes that impossible to render as `0`.
 */
function toUsageMeasurement({ usage }: { usage: CodexUsage | null }): UsageMeasurement {
  return usage === null ? { kind: "not-measured", reason: "sdk-reported-none" } : { kind: "measured", usage };
}

/** The completed turn this module reconstructs from the stream. */
export interface CodexSdkTurn {
  readonly finalResponse: string;
  readonly usage: CodexUsage | null;
  readonly items: readonly { readonly type: string }[];
  /** Items started and never completed: started minus completed, per kind, summed. */
  readonly unfinished: number;
}

/**
 * Build a locked client over an injected SDK port.
 *
 * @param sdk the SDK port (the real `Codex` in production, a plain capturing fake in tests)
 * @param model the model every thread asks for — the repository default unless a pass named another
 * @param posture which locked policy every thread carries — `pass` unless the caller asked for `sealed`
 * @returns a client whose every thread carries the locked options
 */
export function makeLockedCodexClient({
  model = CODEX_MODEL,
  posture = "pass",
  sdk,
}: {
  model?: string;
  posture?: CodexThreadPosture;
  sdk: CodexSdkPort;
}): LockedCodexClient {
  const wrap = ({ thread }: { thread: CodexSdkThread }): LockedCodexThread => ({
    currentId: () => thread.id,
    run: async ({ input, outputSchema, signal, onEvent }) => {
      const result = await safeCodex({
        execute: async () => {
          const streamed = await thread.runStreamed(input, { outputSchema, signal });
          return drainStream({ events: streamed.events, sink: onEvent });
        },
        operation: "codex.run",
      });
      return result.map((turn) => ({
        finalResponse: turn.finalResponse,
        items: toItemActivity({ turn }),
        usage: toUsageMeasurement({ usage: turn.usage }),
      }));
    },
  });
  return {
    model,
    resumeThread: ({ threadId, workingDirectory }) => {
      try {
        return wrap({ thread: sdk.resumeThread(threadId, lockedThreadOptions({ model, posture, workingDirectory })) });
      } catch (error: unknown) {
        return poisonedThread({ error, operation: "codex.resumeThread" });
      }
    },
    startThread: ({ workingDirectory }) => {
      try {
        return wrap({ thread: sdk.startThread(lockedThreadOptions({ model, posture, workingDirectory })) });
      } catch (error: unknown) {
        return poisonedThread({ error, operation: "codex.startThread" });
      }
    },
  };
}

/**
 * The credentials the bundled CLI reads INSTEAD of the routed home's `auth.json`, in its own precedence
 * order. Dropped by {@link codexClientEnvironment}, which carries the measurement and the repro command.
 */
export const CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]);

/**
 * The environment a routed pass hands the bundled Codex CLI: this process's own, plus the routed
 * `CODEX_HOME`.
 *
 * **The SDK's `env` REPLACES `process.env`, it does not extend it** — `dist/index.js` assigns `envOverride`
 * wholesale and only falls back to inheriting when the option is absent. So the spread is the whole point:
 * a bare `{ CODEX_HOME }` would hand the CLI a process with no `PATH`, no `HOME` and no terminal.
 *
 * It also does NOT inject a credential.
 * The SDK writes `CODEX_API_KEY` only under `if (args.apiKey)` (`dist/index.js`, the `apiKey` option of
 * `CodexOptions`), which nothing in this repo ever passes, so an `env` and a keyless OAuth login are not in
 * tension at all — the pass still reads whichever `auth.json` the routed home holds.
 *
 * **And the spread is where routing could be lost, so the three names in {@link CREDENTIAL_KEYS} are
 * DROPPED.** Not injecting one is not the same as not carrying one: an operator who exported
 * `OPENAI_API_KEY` into this shell would have had it inherited straight through, and the bundled CLI reads
 * that key in PREFERENCE to the routed home's login — so the pass would have spent an API-key account while
 * every ledger row, cap record and refusal named the destination the register chose. The three names and their order are the CLI's own
 * resolution chain, read out of the shipped binary beside `auth.json` and its "no Codex credentials were
 * found" message; re-measure with:
 *
 * ```
 * strings node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex |
 *   grep -o 'auth.jsonOPENAI_API_KEY[A-Z_]*'
 * ```
 *
 * **An UNROUTED client takes this same mapping**, and that is the second half of the same review finding:
 * the `eval/` lane deliberately runs on whatever account the operator is logged into, which is a choice
 * about WHICH home, never a licence to let an exported key outrank that home's login. So `codexHome` being
 * absent means only that `CODEX_HOME` is left exactly as the caller had it — the credential filter still
 * applies, and no code path in this repository hands the SDK an inherited credential.
 *
 * @param codexHome the routed `$CODEX_HOME` this pass spends against, or undefined to leave the caller's own
 * @param env this process's own environment, injected so the mapping is testable without touching the real one
 * @returns the complete environment to hand the CLI
 */
export function codexClientEnvironment({
  codexHome,
  env,
}: {
  codexHome: string | undefined;
  env: NodeJS.ProcessEnv;
}): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !CREDENTIAL_KEYS.has(key)) {
      resolved[key] = value;
    }
  }
  if (codexHome !== undefined) {
    resolved["CODEX_HOME"] = codexHome;
  }
  return resolved;
}

/**
 * Build the locked client for ONE routed Codex destination.
 *
 * A factory rather than a value, because which account a pass spends is decided per invocation now: the
 * ranking picks a destination and the client is built for it. `undefined` means the ambient account — the
 * `eval/` lane, which is not a routed pass — and it still goes through {@link codexClientEnvironment}, so
 * the CLI reads that home's own `auth.json` rather than a key somebody exported into this shell.
 *
 * @param codexHome the routed home, or undefined for a client that follows the ambient one
 * @param model the model this client's threads ask for — the repository default unless a pass named another
 * @param cli the CLI the SDK spawns, pinned so it is the very binary {@link admitThread} asked
 *   (`./browserDoor.ts`), with the directories it puts in front of PATH; omitted, the SDK resolves its own
 * @param admitThread the gate every thread passes first, in its own working directory — see {@link admittedCodexClient}
 * @param posture which locked policy every thread carries — `pass` unless the caller asked for `sealed`
 * @returns the locked Codex client for that destination
 */
export function productionCodexClient({
  codexHome,
  model = CODEX_MODEL,
  posture = "pass",
  cli,
  admitThread,
}: {
  codexHome: string | undefined;
  model?: string;
  posture?: CodexThreadPosture;
  cli?: CodexCli;
  admitThread: (args: { workingDirectory: string }) => Result<void, string>;
}): LockedCodexClient {
  // ONE construction, so the marker below sits on the single line that builds a client — and one environment
  // for both arms, so there is no path where an inherited credential reaches the SDK.
  // The ChatGPT app's browser and computer-use servers are switched off for every pass, and an Electron its shell
  // starts runs as Node (`./capabilities.ts`).
  const sdkOptions: CodexOptions = {
    configOverrides: [...codexCapabilityOverrides({ runtime: "pass" })],
    env: withCodexPathDirs({
      env: codexClientEnvironment({ codexHome, env: process.env }),
      pathDirs: cli === undefined ? [] : cli.pathDirs,
    }),
    ...(cli === undefined ? {} : { codexPathOverride: cli.path }),
  };
  // devlint: sdk-factory -- the sole closed Codex factory; every thread carries locked options
  const codex = new Codex(sdkOptions);
  // No cast: the SDK's `Thread` and `Turn` are structurally assignable to the narrow port above, which is
  // deliberate — a cast here would be the one place a shape change could slip through unnoticed.
  const sdk: CodexSdkPort = {
    resumeThread: (threadId, options) => codex.resumeThread(threadId, options),
    startThread: (options) => codex.startThread(options),
  };
  return admittedCodexClient({ admitThread, client: makeLockedCodexClient({ model, posture, sdk }) });
}

/**
 * How a caller asks for the client of whichever destination the ranking chose, or the refusal to print.
 *
 * One parameter, so a test can substitute a fake seam without a mock and a caller cannot transpose anything.
 * The production factory is `cli/commands/codex/passDeps.ts`'s, which runs the browser door
 * (`./browserDoor.ts`) on the destination's home before building anything — the door reads this module, so
 * the factory cannot live here without a cycle.
 */
export type CodexClientFactory = ({
  destination,
  model,
}: {
  destination: CodexDestination;
  model: string;
}) => Result<LockedCodexClient, string>;
