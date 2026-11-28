/**
 * What a Codex this repository starts may do — the ONE source both Codex runtimes project from.
 *
 * Two runtimes start Codex: the review and plan passes (`./client.ts`, through `@openai/codex-sdk`) and the
 * console voice on the owner's ChatGPT plan (`../talk/planSession.ts`, through `codex app-server`). Each used to spell
 * these settings itself — web search twice in two spellings, the approval policy twice, the browser switched
 * off by two different mechanisms, and the sandbox differing with nothing saying why. The rule: one capability
 * module, those settings consolidated into it. Native OpenAI web search stays — it is built in.
 *
 * Each runtime keeps its own SPELLING, because the two interfaces differ: the SDK takes thread options and
 * emits `--config web_search="…"` and `--config approval_policy="…"` itself, while `thread/start` takes
 * `approvalPolicy`/`sandbox` and the app-server argv takes `-c` overrides. What is shared is the VALUE, and a
 * runtime reads it from here rather than restating it. This file imports nothing from `@openai/codex-sdk`
 * (`schedulerBypass` allows that package in `./client.ts` alone), so `LOCKED_POLICY`'s `satisfies` there is
 * what proves these literals are ones the SDK accepts.
 *
 * Claude spawn flags are not in here: a Claude seat is not a Codex runtime (same ruling).
 */
import { codexBrowserOffOverrides } from "./browserSurface.js";
import { codexElectronRunAsNodeOverrides } from "./electronSurface.js";

/** The two Codex runtimes this repository starts. */
export type CodexRuntime = "pass" | "voice";

/** Codex's web-search modes, as both `web_search` and the SDK's `webSearchMode` spell them. */
type CodexWebSearchMode = "disabled" | "cached" | "live";

/**
 * Whether a web-search mode leaves search on — the SDK's `webSearchEnabled`, derived so it cannot disagree
 * with `webSearchMode`.
 *
 * @param mode the web-search mode a runtime is launched with
 * @returns false only for `disabled`
 */
function webSearchOn({ mode }: { mode: CodexWebSearchMode }): boolean {
  return mode !== "disabled";
}

/** Everything a Codex runtime here may do, stated once. */
export const CODEX_CAPABILITIES = {
  // LOAD-BEARING FOR SAFETY, not just for non-interactivity: measured to be the thing that blocks an MCP tool
  // dispatch, under both read-only and workspace-write (`./client.ts`'s header). Never `on-request`.
  approvalPolicy: "never",
  // The sandbox DIFFERS by runtime, on purpose. A pass writes its answer into a per-pass SCRATCH working
  // directory, never the repository, so it needs `workspace-write` over exactly that directory — and only that
  // one: `workspace-write` also opens `$TMPDIR` and `/tmp`, where every snapshot pool slot lives, unless told
  // not to, which `PASS_TEMP_EXCLUSION_OVERRIDES` below does (`./passWorkspace.ts` says why). The voice's
  // delegated thread has no workspace to write — every write it makes goes out as a Talk relay tool through
  // the page's relay gate — so it is `read-only`.
  sandbox: { pass: "workspace-write", voice: "read-only" },
  // Native OpenAI web search, live. A documented egress (`docs/security/codex-boundary.md`).
  webSearch: "live",
} as const satisfies {
  approvalPolicy: string;
  sandbox: Readonly<Record<CodexRuntime, string>>;
  webSearch: CodexWebSearchMode;
};

/** The pass's thread options this module decides, in the SDK's spelling — `LOCKED_POLICY` spreads it. */
export const PASS_THREAD_CAPABILITIES = {
  approvalPolicy: CODEX_CAPABILITIES.approvalPolicy,
  sandboxMode: CODEX_CAPABILITIES.sandbox.pass,
  webSearchEnabled: webSearchOn({ mode: CODEX_CAPABILITIES.webSearch }),
  webSearchMode: CODEX_CAPABILITIES.webSearch,
} as const;

/** The voice's `thread/start` fields this module decides, in the app-server's spelling. */
export const VOICE_THREAD_CAPABILITIES = {
  approvalPolicy: CODEX_CAPABILITIES.approvalPolicy,
  sandbox: CODEX_CAPABILITIES.sandbox.voice,
} as const;

/**
 * The two legacy `workspace-write` keys that close `$TMPDIR` and `/tmp` to a pass, leaving its working directory
 * the one writable root. The SDK launches `--sandbox workspace-write`, which reads these; a permission profile
 * (`-P :workspace`) ignores them, measured on 0.163.0 (`./passWorkspace.ts`).
 */
const PASS_TEMP_EXCLUSION_OVERRIDES = [
  "sandbox_workspace_write.exclude_tmpdir_env_var=true",
  "sandbox_workspace_write.exclude_slash_tmp=true",
] as const;

/**
 * The `-c` overrides a runtime carries for its capabilities: the ChatGPT app's browser and computer-use
 * surface switched off for both (`./browserSurface.ts`, where the spelling that works is measured), web
 * search for the voice alone — the SDK already emits `web_search` from `webSearchMode`, so a pass carrying
 * it too would be the duplicate this module removes — and, for the pass alone, an Electron its shell starts
 * run as Node so it cannot crash in front of the owner (`./electronSurface.ts`) and the temp folder closed to its
 * writes ({@link PASS_TEMP_EXCLUSION_OVERRIDES}). The voice has no shell to start one from and a read-only sandbox:
 * its launch disables `shell_tool` and `unified_exec` (`../talk/planSession.ts`). A pass's shell temp, which
 * moves into its scratch, is per thread and so is not here (`./passWorkspace.ts`).
 *
 * @param runtime which Codex runtime is launching
 * @returns the overrides, one `key=value` per entry, in a stable order
 */
export function codexCapabilityOverrides({ runtime }: { runtime: CodexRuntime }): readonly string[] {
  if (runtime === "pass") {
    return [...codexBrowserOffOverrides(), ...codexElectronRunAsNodeOverrides(), ...PASS_TEMP_EXCLUSION_OVERRIDES];
  }
  return [`web_search="${CODEX_CAPABILITIES.webSearch}"`, ...codexBrowserOffOverrides()];
}
