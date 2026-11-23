/**
 * `slopweaver codex rules-context` — the Codex-only `SessionStart` emitter that hands a Codex session the
 * always-on rules a Claude session gets through `AGENTS.md`'s `@` imports (option A;
 * the selection and its reasons are `../../../codex/rulesContext.ts`).
 *
 * Registered ONLY in `hooks/codex-hooks.json`, which `.codex-plugin/plugin.json` names and Claude Code never
 * reads. It cannot tell the hosts apart itself — Codex sets `CLAUDE_PLUGIN_ROOT` too, for compatibility — so the
 * registration is what keeps Claude from a second copy of every rule.
 *
 * Its own module, parsing no flags, for the reason `../profile/hookRun.ts` gives: a hook must never refuse an
 * argument. It prints their PROFILE in every project, as `profile hook` does for Claude, and the RULES only in a
 * Slopweaver checkout — the plugin loads into every project, and another repository's rules are that repository's
 * business. It ALWAYS exits zero, printing nothing on any failure, because a session start a rule read can break
 * is a hook somebody turns off.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { alwaysOnEntry } from "../../../canon/alwaysOnDocs.js";
import { codexRulesDocuments, renderCodexRulesContext } from "../../../codex/rulesContext.js";
import { contextOutput } from "../../../handover/hookShell.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";
import { hookPayloadFromStdin, loadProfileForHook, markHookDelivery } from "../profile/hookRun.js";

/** What a person who runs it by hand is told; the harness never reads this. */
const RULES_CONTEXT_USAGE = "usage: slopweaver codex rules-context";

/** The directory Claude Code reads rule files from, relative to the checkout root. */
const RULES_DIR = join(".claude", "rules");

/**
 * One repo-relative file's text, or `undefined` when it cannot be read.
 *
 * @param root the checkout root
 * @param path the repo-relative path
 * @returns the text, or `undefined`
 */
function readUnder({ root, path }: { root: string; path: string }): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Whether a checkout is Slopweaver's own, read off its `package.json` name.
 *
 * @param root the checkout root
 * @returns true only when the manifest parses and names `slopweaver`
 */
function isSlopweaverCheckout({ root }: { root: string }): boolean {
  const manifest = readUnder({ path: "package.json", root });
  if (manifest === undefined) {
    return false;
  }
  const parsed: unknown = JSON.parse(manifest);
  return isRecord(parsed) && parsed["name"] === "slopweaver";
}

/**
 * The lines to inject for the checkout at `root`, empty outside a Slopweaver checkout.
 *
 * @param root the checkout root the session stands in
 * @returns the rendered context lines
 */
export function rulesContextLines({ root }: { root: string }): readonly string[] {
  if (!isSlopweaverCheckout({ root })) {
    return [];
  }
  const readDoc = ({ path }: { path: string }): string | undefined => readUnder({ path, root });
  const ruleFiles = readdirSync(join(root, RULES_DIR))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${RULES_DIR}/${name}`);
  const entry = alwaysOnEntry({ exists: ({ path }) => readDoc({ path }) !== undefined });
  return renderCodexRulesContext({ documents: codexRulesDocuments({ entry, readDoc, ruleFiles }) });
}

/**
 * The rule lines, or none when they could not be read — a rule read that throws must not cost the session the
 * profile printed beside it.
 *
 * @returns the lines
 */
function rulesContextLinesOrNone(): readonly string[] {
  try {
    return rulesContextLines({ root: runningCheckoutRoot() });
  } catch {
    return [];
  }
}

/**
 * Print their profile, then the always-on rules, as the Codex `SessionStart` hook's `additionalContext`.
 *
 * The profile half is the Claude `profile hook`'s own step (`../profile/hookRun.ts`), in EVERY project, recorded
 * against the thread the payload names. A Codex session needs it too — the Codex manifest
 * registers this one command — so a Codex seat acting for them without it would act misaligned, every time.
 * It rides this command rather than a second registration because a new hook entry needs their `/hooks` approval in
 * every Codex install, while a changed command does not.
 *
 * @param argv the full process argv
 * @param readInput supplies the hook payload
 * @returns always `EXIT_OK`
 */
export async function runCodexRulesContextWith({
  argv,
  readInput,
}: {
  argv: readonly string[];
  readInput: () => Promise<string>;
}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    logger.out({ line: RULES_CONTEXT_USAGE });
    return EXIT_OK;
  }
  try {
    const profile = await loadProfileForHook({ readInput });
    const line = contextOutput({ event: "SessionStart", lines: [...profile.lines, ...rulesContextLinesOrNone()] });
    if (line !== null) {
      logger.out({ line });
      markHookDelivery({ deliversTo: profile.deliversTo });
    }
  } catch {
    // Deliberately silent, as `profile hook` is: a stack trace injected into a session's context is worse
    // than nothing, and the next session start tries again.
  }
  return EXIT_OK;
}

/**
 * Run the hook over the real stdin. ALWAYS returns 0.
 *
 * @param argv the full process argv
 * @returns always `EXIT_OK`
 */
export async function runCodexRulesContext(argv: readonly string[]): Promise<number> {
  return runCodexRulesContextWith({ argv, readInput: hookPayloadFromStdin });
}

export const codexRulesContextCommand = defineCommand({ run: runCodexRulesContext });
