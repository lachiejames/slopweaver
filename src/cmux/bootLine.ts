/**
 * The exact line `cmux spawn` sends to boot one host — a pure composer, no cmux client and no I/O.
 *
 * Its own file because the shape is load-bearing far outside `./spawn.ts`: `src/devLint/noHeadless.ts` holds
 * this module's boot-line template as literal SOURCE TEXT and compares by exact equality, so the two move in
 * one commit or the gate stops recognising this repo's own spawn. A file whose whole content is that one
 * decision is easier to keep in step than a decision buried in a thousand-line spawn driver.
 */
import { bootEnvPrefix } from "../claude/seatPinning.js";

import { fleetEnvPrefix } from "./fleetEnv.js";
import { claudeTemplateSuffix } from "./launchTemplate.js";
import type { VisibleSessionPlan } from "./plan.js";
import { codexBootLine } from "./seatRoute.js";

/**
 * The one seam {@link bootLine} reads: which checkout this session`s `claude --plugin-dir` should name, or
 * `undefined` to let it load the marketplace install. Declared here rather than imported from `./spawn.ts`,
 * which imports this module — `SpawnDeps` carries this exact member and the compiler checks the two agree at
 * every call site.
 */
export type PluginDirResolver = (args: { readonly plan: VisibleSessionPlan }) => string | undefined;

/**
 * The boot line for one host, as a literal per host.
 *
 * Kept as plain strings rather than a computed value, so the no-headless scanner (`src/devLint/noHeadless.ts`)
 * keeps matching each by exact source text: `claude` names a checkout via `--plugin-dir` only when this plan
 * opens a worktree of a Slopweaver checkout and loads the marketplace install otherwise (`./pluginDir.ts`
 * carries the owner ruling that set that), plus `--model <value>` appended when `plan.model` names one (never inferred, never applied later — see the
 * field's own doc comment on why this is the only safe moment), plus `--effort <level>` when
 * {@link VisibleSessionPlan.effort} names one, plus `--name <value>` when
 * {@link VisibleSessionPlan.sessionName} names one, plus `--settings '<json>'` last when the plan's launch
 * template leaves memory files out (`./launchTemplate.ts` — empty for `code`); `codex` needs `--no-alt-screen` (proven live: without it,
 * a screen read cannot scrape its TUI) plus the repository's own model pin — it reads the worktree's own
 * `AGENTS.md` from its cwd on boot, the same way a fresh Claude Code session does.
 *
 * **The Codex model is the repository's pin, never the plan's `--model`.** `CODEX_MODEL`
 * (`src/codex/profiles.ts`) moves for the whole fleet at once and offers no per-invocation dial, while
 * {@link VisibleSessionPlan.model} is Claude vocabulary — a tier name, which `codex -m` would reject. Naming
 * it on the line rather than letting `codex` inherit whatever `~/.codex/config.toml` last said is doctrine
 * rule 5; `cmux/seatRoute.ts`'s `codexSeatModelNote` is what says the substitution out loud to the operator.
 * A ROUTED Codex seat also carries a `CODEX_HOME=` prefix, empty when nothing routed it, which is what puts
 * a seat on the emptiest registered account instead of the one ambient home every seat used to share.
 *
 * A PINNED seat carries a `CLAUDE_SECURESTORAGE_CONFIG_DIR=` prefix, which is how the publishing seat and
 * the supervisor chair stay on one account while workers rotate — artifacts are per-account, so a rotating
 * publisher orphans the owner's react-now surface. The prefix is EMPTY for a worker, so an unpinned boot
 * line is byte-identical to the one this repo has always sent. `src/devLint/noHeadless.ts` recognises both
 * literals by exact text, and its own header says that set must be updated in the same change as this one.
 *
 * A seat booting in a FLEET WORKTREE also carries `NX_DAEMON=false ` at the front of that same prefix, for
 * either host (`./fleetEnv.ts`): a detached nx daemon outlives the seat that started it.
 * It rides the existing prefix locals rather than a new piece, so the recognised literals do not move.
 *
 * `--name` is a Claude-only lever: `codex` has no equivalent flag, and a Codex session is not something
 * `ListAgents` enumerates in the first place, so a `codex` worker keeps the identity its working directory
 * gives it and nothing here pretends otherwise. `--effort` is Claude-only for the same reason, but it is
 * handled differently at the door: `cmux spawn` REFUSES `--effort` on a `codex` driver rather than
 * accepting a level this line would silently drop. A launch template is Claude-only too, and never reaches the
 * codex line: codex expands no `@` import, so there is nothing for it to leave out.
 *
 * @param plan which host to boot, and (for Claude) the model, effort, session name and launch template to pass through
 * @param deps the seam that decides whether this plan carries a `--plugin-dir` at all — narrowed to that one
 *   member, so composing the line needs no cmux client and its test can pass a plain function
 * @returns the exact line to send
 */
export function bootLine({
  plan,
  deps,
}: {
  plan: VisibleSessionPlan;
  deps: { readonly resolvePluginDir: PluginDirResolver };
}): string {
  const envPrefix = fleetEnvPrefix({ cwd: plan.cwd, repoRoot: plan.repoRoot });
  if (plan.host === "codex") {
    return codexBootLine({ codexHome: plan.codexHome, envPrefix });
  }
  const resolved = deps.resolvePluginDir({ plan });
  const pluginDirSuffix = resolved === undefined ? "" : ` --plugin-dir ${resolved}`;
  const modelSuffix = plan.model === undefined ? "" : ` --model ${plan.model}`;
  const effortSuffix = plan.effort === undefined ? "" : ` --effort ${plan.effort}`;
  const nameSuffix = plan.sessionName === undefined ? "" : ` --name ${plan.sessionName}`;
  // `code` adds nothing, so a code seat's boot line stays byte-identical to the pre-template one.
  const templateSuffix = claudeTemplateSuffix({ cwd: plan.cwd, template: plan.template });
  const credentialPrefix = bootEnvPrefix({
    ...(plan.credentialStoreDir === undefined ? {} : { storeDir: plan.credentialStoreDir }),
    ...(plan.credentialTokenPath === undefined ? {} : { tokenPath: plan.credentialTokenPath }),
  });
  const storePrefix = `${envPrefix}${credentialPrefix}`;
  return `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}`;
}
