/**
 * Which of Slopweaver's plugin hooks Codex will actually run — read from Codex itself, never re-derived — and
 * the trust record that makes it run them, written by Codex itself on the fleet's word.
 *
 * Codex pins trust to a hash of each hook and SKIPS a new or changed one, without a word to the session, until
 * its trust record carries that hash. So every landing that touches `hooks/hooks.json` or
 * `hooks/codex-hooks.json`, re-installed by `codex plugin-sync`, would turn a guard off in Codex while Claude
 * kept running it. MEASURED against the owner's `~/.codex` (codex-cli 0.157.1): all eleven
 * Slopweaver hooks read `modified` or `untrusted`, and later thirteen of thirteen.
 *
 * **Trusting Slopweaver's own hooks is the fleet's, never the owner's**: the owner never opens Codex — Claude
 * drives it through the SDK — so a card asking them to approve hooks in Codex's `/hooks` is a hand step that
 * must be automated. So {@link hooksToTrust} picks every Slopweaver hook Codex skips for want of trust, and
 * {@link trustWriteRequests} has Codex's own app-server write `trusted_hash = currentHash` for each.
 *
 * Both halves are Codex's own answers. `hooks/list` gives each hook's `key`, `pluginId`, `source`,
 * `trustStatus` (`managed|untrusted|trusted|modified`), `enabled` and `currentHash`; `config/batchWrite`
 * writes the record the way Codex's own `/hooks` does. Computing the hash here would be a second
 * implementation of Codex's rule that goes stale silently the day Codex changes it, and hand-editing the TOML
 * a second writer of a file Codex owns. MEASURED on a copy of `~/.codex`: one `batchWrite`
 * upserting at `hooks.state` answered `ok`, a `hooks/list` in the same app-server read all thirteen
 * `trusted`, and a diff of the config showed only `trusted_hash` lines changed or added — every `enabled =
 * false` and every other plugin's row untouched. Upserting the TABLE is what spares encoding a key full of
 * dots and slashes into a key path. Reproduce on a scratch copy with
 * `CODEX_HOME=<copy> slopweaver codex hooks --trust`, then `diff ~/.codex/config.toml <copy>/config.toml`.
 *
 * **The scope is one plugin, by id.** Only a `plugin`-source hook whose `pluginId` is exactly the one
 * `codex plugin-sync` installs from the main checkout's HEAD — never another plugin's, never a user or project
 * hook, never a `slopweaver@` from some other marketplace — and `enabled` is never written, so a hook switched
 * off stays off.
 */
import { z } from "zod";

import { LIVE_MARKER_PREFIX } from "./accountLiveParse.js";

/** The id the `hooks/list` request carries, which the reader waits for. */
export const HOOKS_LIST_REQUEST_ID = 7;

/** The id the trust write carries, which the reader waits for beside the re-list. */
export const TRUST_WRITE_REQUEST_ID = 8;

/** The plugin id prefix every Slopweaver install carries, whichever marketplace it came from. */
const SLOPWEAVER_PLUGIN_PREFIX = "slopweaver@";

/** The handshake every exchange opens with. */
function handshake(): readonly string[] {
  return [
    JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "slopweaver", version: "0" } } }),
    JSON.stringify({ method: "initialized" }),
  ];
}

/** One `hooks/list` for the checkout. */
function hooksListRequest({ cwd }: { cwd: string }): string {
  return JSON.stringify({ id: HOOKS_LIST_REQUEST_ID, method: "hooks/list", params: { cwds: [cwd] } });
}

/**
 * The lines one store is sent: the handshake, then one `hooks/list` for the checkout.
 *
 * @param cwd the directory whose hooks Codex should list — plugin hooks are the same everywhere, project
 *   hooks are not, and the checkout is where the question is asked
 * @returns the newline-free JSON lines
 */
export function hookListRequests({ cwd }: { cwd: string }): readonly string[] {
  return [...handshake(), hooksListRequest({ cwd })];
}

const hookWire = z.object({
  currentHash: z.string(),
  enabled: z.boolean(),
  eventName: z.string(),
  key: z.string(),
  pluginId: z.string().nullable().optional(),
  source: z.string(),
  trustStatus: z.enum(["managed", "untrusted", "trusted", "modified"]),
});

const answerWire = z.object({
  id: z.literal(HOOKS_LIST_REQUEST_ID),
  result: z.object({ data: z.array(z.object({ hooks: z.array(hookWire) })) }),
});

const answerIdWire = z.object({ id: z.number() });

const writeAnswerWire = z.union([
  z.object({ id: z.literal(TRUST_WRITE_REQUEST_ID), result: z.object({ status: z.string() }) }),
  z.object({ error: z.object({ message: z.string() }), id: z.literal(TRUST_WRITE_REQUEST_ID) }),
]);

/** One Slopweaver hook as Codex sees it. */
export interface CodexPluginHook {
  readonly key: string;
  readonly eventName: string;
  readonly trustStatus: z.infer<typeof hookWire>["trustStatus"];
  readonly enabled: boolean;
  /** The plugin that carries it, `slopweaver@<marketplace>`. */
  readonly pluginId: string;
  /** Where Codex says the hook comes from; trust is only ever written for `plugin`. */
  readonly source: string;
  /** The hash Codex computed for the hook as installed — exactly what its trust record must carry. */
  readonly currentHash: string;
}

/** What one store said about Slopweaver's hooks, or why it said nothing. */
export type CodexHookTrustReading =
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "read"; readonly hooks: readonly CodexPluginHook[] };

/**
 * Whether Codex will run a hook: trusted or policy-managed, and not switched off.
 *
 * @param hook one hook as read
 * @returns true when Codex runs it
 */
export function codexRunsHook({ hook }: { hook: CodexPluginHook }): boolean {
  return hook.enabled && (hook.trustStatus === "trusted" || hook.trustStatus === "managed");
}

/** A line's JSON, or `undefined` when it is not JSON at all. */
function jsonOf({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** The JSON-RPC id a parsed line answers, or `undefined` when it carries none. */
function answerIdOf({ parsed }: { parsed: unknown }): number | undefined {
  const id = answerIdWire.safeParse(parsed);
  return id.success ? id.data.id : undefined;
}

/**
 * Read one store's answer lines into its Slopweaver hooks.
 *
 * @param lines the payload lines the reader forwarded for this store, a marker line included when it failed —
 *   another request's answer (the trust write's) is passed over rather than read as this one
 * @returns every Slopweaver plugin hook Codex lists, or why the store could not be read
 */
export function parseHookTrust({ lines }: { lines: readonly string[] }): CodexHookTrustReading {
  for (const line of lines) {
    if (line.startsWith(LIVE_MARKER_PREFIX)) {
      return { kind: "unreadable", reason: `the app-server gave no hooks/list answer (${line.slice(1)})` };
    }
    const parsed = jsonOf({ line });
    if (parsed === undefined || answerIdOf({ parsed }) === TRUST_WRITE_REQUEST_ID) {
      continue;
    }
    const answer = answerWire.safeParse(parsed);
    if (!answer.success) {
      return {
        kind: "unreadable",
        reason: `hooks/list answered in a shape this does not read: ${answer.error.message}`,
      };
    }
    const hooks = answer.data.result.data
      .flatMap((entry) => entry.hooks)
      .flatMap((hook) => {
        const pluginId = hook.pluginId;
        if (pluginId == null || !pluginId.startsWith(SLOPWEAVER_PLUGIN_PREFIX)) {
          return [];
        }
        return [
          {
            currentHash: hook.currentHash,
            enabled: hook.enabled,
            eventName: hook.eventName,
            key: hook.key,
            pluginId,
            source: hook.source,
            trustStatus: hook.trustStatus,
          },
        ];
      });
    return { hooks, kind: "read" };
  }
  return { kind: "unreadable", reason: "the app-server printed no hooks/list answer" };
}

/**
 * The hooks Codex skips for want of a trust record, of the one plugin the fleet installs.
 *
 * `untrusted` and `modified` only: a `managed` hook is policy's, a `trusted` one needs nothing, and a hook the owner
 * switched off is skipped for a reason trust does not touch.
 *
 * @param hooks every Slopweaver hook as read
 * @param pluginId the exact plugin id `codex plugin-sync` installs, `slopweaver@<marketplace>`
 * @returns the hooks whose trust record should carry their current hash
 */
export function hooksToTrust({
  hooks,
  pluginId,
}: {
  hooks: readonly CodexPluginHook[];
  pluginId: string;
}): readonly CodexPluginHook[] {
  return hooks.filter(
    (hook) =>
      hook.source === "plugin" &&
      hook.pluginId === pluginId &&
      (hook.trustStatus === "untrusted" || hook.trustStatus === "modified"),
  );
}

/**
 * The lines that have Codex trust each hook and then list again: the handshake, one `config/batchWrite`
 * upserting `trusted_hash` under `hooks.state`, and a `hooks/list` read in the same app-server.
 *
 * @param cwd the checkout the re-list is asked from
 * @param hooks the hooks to trust, as {@link hooksToTrust} picked them
 * @returns the newline-free JSON lines
 */
export function trustWriteRequests({
  cwd,
  hooks,
}: {
  cwd: string;
  hooks: readonly CodexPluginHook[];
}): readonly string[] {
  const value = Object.fromEntries(hooks.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]));
  const write = JSON.stringify({
    id: TRUST_WRITE_REQUEST_ID,
    method: "config/batchWrite",
    params: { edits: [{ keyPath: "hooks.state", mergeStrategy: "upsert", value }] },
  });
  return [...handshake(), write, hooksListRequest({ cwd })];
}

/**
 * Read the trust write's own answer, which says whether Codex wrote its config.
 *
 * @param lines the payload lines the reader forwarded for this store
 * @returns `undefined` when Codex answered the write `ok`, else why it did not
 */
export function trustWriteFailure({ lines }: { lines: readonly string[] }): string | undefined {
  for (const line of lines) {
    if (line.startsWith(LIVE_MARKER_PREFIX)) {
      return `the app-server gave no config/batchWrite answer (${line.slice(1)})`;
    }
    const parsed = jsonOf({ line });
    if (parsed === undefined || answerIdOf({ parsed }) !== TRUST_WRITE_REQUEST_ID) {
      continue;
    }
    const answer = writeAnswerWire.safeParse(parsed);
    if (!answer.success) {
      return `config/batchWrite answered in a shape this does not read: ${answer.error.message}`;
    }
    if ("error" in answer.data) {
      return `config/batchWrite refused: ${answer.data.error.message}`;
    }
    return answer.data.result.status === "ok" ? undefined : `config/batchWrite answered ${answer.data.result.status}`;
  }
  return "the app-server printed no config/batchWrite answer";
}

/**
 * The report: one line per hook Codex will skip, the fix, or why nothing could be said.
 *
 * @param codexHome the store that was read
 * @param reading what it said
 * @returns the lines to print, and whether every Slopweaver hook runs
 */
export function renderHookTrust({ codexHome, reading }: { codexHome: string; reading: CodexHookTrustReading }): {
  readonly lines: readonly string[];
  readonly allRun: boolean;
} {
  if (reading.kind === "unreadable") {
    return { allRun: false, lines: [`codex hooks: ${codexHome} could not be read — ${reading.reason}`] };
  }
  if (reading.hooks.length === 0) {
    return {
      allRun: false,
      lines: [
        `codex hooks: ${codexHome} lists no Slopweaver plugin hook — the plugin is not installed there, so Codex ` +
          `runs none of its guards or its rules injection. Install it with \`CODEX_HOME=${codexHome} slopweaver ` +
          "codex plugin-sync`.",
      ],
    };
  }
  const skipped = reading.hooks.filter((hook) => !codexRunsHook({ hook }));
  if (skipped.length === 0) {
    return { allRun: true, lines: [`codex hooks: all ${reading.hooks.length} Slopweaver hooks run in ${codexHome}`] };
  }
  return {
    allRun: false,
    lines: [
      `codex hooks: Codex SKIPS ${skipped.length} of ${reading.hooks.length} Slopweaver hooks in ${codexHome}:`,
      ...skipped.map((hook) => `  ${hook.key}  ${hook.enabled ? hook.trustStatus : `${hook.trustStatus}, disabled`}`),
      `  fix: \`CODEX_HOME=${codexHome} slopweaver codex hooks --trust\` has Codex trust each untrusted or ` +
        "modified one — the fleet's to run, never the owner's; a disabled one stays off.",
    ],
  };
}
