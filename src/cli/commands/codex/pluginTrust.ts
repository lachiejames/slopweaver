/**
 * The production hook-trust pass both writers of a Codex install run after each add: the foreground and
 * background `codex plugin-sync` (`./pluginSyncRun.ts`) and the one-home sync `plans add` runs on a home it just
 * registered (`../plans/codexPluginSyncLive.ts`). One adapter, so the two cannot drift in what counts as trusted.
 *
 * {@link hookTrustOutcome} is the whole decision, pure over one pass; {@link trustPluginHooks} only runs the
 * pass against the home's own Codex and hands it over.
 */
import { err, ok, type Result } from "#lib/result.js";
import { renderHookTrust } from "../../../codex/hookTrust.js";
import { type CodexPluginSyncError, CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import { type CodexHookTrustPass, trustCodexHooks } from "./hooksRun.js";

/**
 * Judge one finished trust pass: the home fails when Codex refused the write, and again when any Slopweaver hook
 * still would not run after it — the re-list's own report lines become the failure's detail.
 *
 * @param codexHome the `$CODEX_HOME` the pass wrote, named in a failure
 * @param pass what the pass did and what Codex listed after it
 * @returns how many hooks were trusted, or the home's hook-trust failure
 */
export function hookTrustOutcome({
  codexHome,
  pass,
}: {
  codexHome: string;
  pass: CodexHookTrustPass;
}): Result<{ readonly trusted: number }, CodexPluginSyncError> {
  if (pass.failure !== undefined) {
    return err(CodexPluginSyncErrors.hookTrustFailed({ codexHome, detail: pass.failure }));
  }
  const report = renderHookTrust({ codexHome, reading: pass.reading });
  if (!report.allRun) {
    const detail = report.lines.map((line) => line.trim()).join(" ");
    return err(CodexPluginSyncErrors.hookTrustFailed({ codexHome, detail }));
  }
  return ok({ trusted: pass.trusted });
}

/**
 * Have one home's Codex trust every Slopweaver hook it skips, failing that home unless every one then runs — a
 * re-add that changed a hook's hash turns it off in Codex until its trust record carries the new hash, silently,
 * so a refresh is the moment to write it, the fleet's act and never a step for the owner's hands
 * (`src/codex/hookTrust.ts`).
 *
 * @param codexHome the `$CODEX_HOME` whose hook trust records are written
 * @param cwd the directory the trust pass reads Codex's hook list from
 * @param pluginId the installed plugin's id, whose hooks are trusted
 * @returns how many hooks were trusted, or the home's hook-trust failure
 */
export function trustPluginHooks({
  codexHome,
  cwd,
  pluginId,
}: {
  codexHome: string;
  cwd: string;
  pluginId: string;
}): Result<{ readonly trusted: number }, CodexPluginSyncError> {
  return hookTrustOutcome({ codexHome, pass: trustCodexHooks({ codexHome, cwd, pluginId }) });
}
