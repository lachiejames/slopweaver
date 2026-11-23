/**
 * Which launch template a seat boots from — what its Claude Code session loads at launch, rightsized to the
 * kind of work it does. Pure: a template and a working directory in, a boot-line suffix out.
 *
 * **The rule**: launch templates differ by task — some load code-friendly context, some research-friendly, some
 * serve the supervisor, some the bot — and none loads what bloats, costs extra or pollutes the context
 * window. DevSecOps rightsizing, applied to a session instead of an instance.
 *
 * **What a template removes today, and how.** Claude Code reads `AGENTS.md` natively, and it `@`-imports the
 * three code-standards rules, so every seat received them at launch whether or not it would ever open a `.ts` file
 * (`docs/doctrine-rationale/always-on.md` § "The always-on set"). A non-code template passes Claude Code's documented
 * `claudeMdExcludes` setting through `--settings`, naming those three files by absolute path under the seat's
 * own working directory, spelled with `$PWD` so the line stays inside the terminal's 1,024-byte limit. `AGENTS.md` itself still loads, and still carries the `@` lines as text and the
 * instruction to open the rules before writing code, so a non-code seat that turns out to need them reads
 * them on demand.
 *
 * **Codex is not a template target.** It expands no `@` import at all, so a Codex seat never received the
 * three rules in the first place; its boot line is untouched by this module.
 *
 * **`code` is the default and loads everything**: an unclassified seat keeps today's byte-identical boot
 * line, because under-loading a seat that then writes code is the costlier mistake.
 */
import { shellCommandLine } from "../lib/shellCommandLine.js";

import type { SessionRole } from "./role.js";

/** The launch templates, one per kind of seat. `code` is first because it is the default. */
export const LAUNCH_TEMPLATES = ["code", "research", "supervisor", "bot"] as const;

/** One of {@link LAUNCH_TEMPLATES}. */
export type LaunchTemplate = (typeof LAUNCH_TEMPLATES)[number];

/**
 * The code-standards rules `AGENTS.md` imports into every seat — the whole of what a non-code template leaves
 * out. Repo-relative; {@link claudeTemplateSuffix} anchors them under the seat's own working directory.
 */
export const CODE_STANDARD_RULES = [
  ".claude/rules/typescript-patterns.md",
  ".claude/rules/testing.md",
  ".claude/rules/error-handling.md",
] as const;

/** What one template is for, and the repo-relative memory files it leaves out of the launch. */
interface LaunchTemplateRow {
  readonly purpose: string;
  readonly excludes: readonly string[];
}

/**
 * Every template's row. The three non-code templates leave out the same files today; they are separate
 * names because they are separate kinds of seat, and the next thing one of them sheds is not the others'.
 */
const LAUNCH_TEMPLATE_ROWS: Readonly<Record<LaunchTemplate, LaunchTemplateRow>> = {
  bot: {
    excludes: CODE_STANDARD_RULES,
    purpose: "a Slack turn: an ask worker or an answer reviewer, answering in-thread",
  },
  code: { excludes: [], purpose: "writes code in a worktree: loads every standing rule" },
  research: {
    excludes: CODE_STANDARD_RULES,
    purpose: "investigates and reports: gauges, transcripts, corpus, pages",
  },
  supervisor: { excludes: CODE_STANDARD_RULES, purpose: "the chair: routes, spawns and briefs, never edits code" },
};

/**
 * Whether a string names one of {@link LAUNCH_TEMPLATES} — the guard a `--template` flag or a doc's
 * `template:` line passes before anything boots from it.
 *
 * @param value the candidate, straight off argv or a doc's front matter
 * @returns true when `value` names a real template
 */
export function isLaunchTemplate(value: unknown): value is LaunchTemplate {
  return typeof value === "string" && (LAUNCH_TEMPLATES as readonly string[]).includes(value);
}

/**
 * The template a seat boots from when nothing named one: the standing surfaces by their role, everything
 * else `code`.
 *
 * The scheduler maps to `research` because a scheduled row runs a resync or a sweep and reports it. A
 * `session` is a workstream opened for one piece of work, which usually means code, so it keeps every rule.
 *
 * @param role the seat's already-classified role
 * @returns the template to boot from
 */
export function defaultTemplateForRole({ role }: { role: SessionRole }): LaunchTemplate {
  switch (role) {
    case "bot":
      return "bot";
    case "scheduler":
      return "research";
    case "supervisor":
      return "supervisor";
    case "session":
      return "code";
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}

/**
 * The `claudeMdExcludes` one template sets for a seat in `cwd`: each excluded rule's absolute path under it, so the
 * exclusion cannot reach a same-named rule in another repository the seat reads. The boot line spells the same
 * paths as `$PWD/<rule>` ({@link claudeTemplateSuffix}); the app harness, which types no line, takes these.
 *
 * @param template the template the seat boots from
 * @param cwd the seat's own working directory, the checkout whose rules are left out
 * @returns the absolute paths, empty for a template that leaves nothing out
 */
export function claudeMdExcludesFor({ template, cwd }: { template: LaunchTemplate; cwd: string }): readonly string[] {
  const root = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  return LAUNCH_TEMPLATE_ROWS[template].excludes.map((path) => `${root}/${path}`);
}

/**
 * The `claude` boot-line suffix one template adds: empty for a template that leaves nothing out, else
 * ` --settings "<json>"` carrying `claudeMdExcludes` with each excluded file's absolute path.
 *
 * Absolute paths under `cwd` rather than a `**` glob, so the exclusion cannot reach a same-named rule in
 * another repository the seat reads. They are spelled `$PWD/<rule>`, which the shell the line is typed into
 * expands: both callers type it into a shell already standing in `cwd` (`cmux spawn` opens the workspace
 * there; `reseat` types into the shell that launched the session, which `--resume` already relies on).
 *
 * MEASURED, why the root is not spelled out: a bot seat booted from a handover worktree whose path
 * is 150 bytes typed a 1,100-byte line, and the terminal's line discipline (macOS `MAX_CANON`) kept exactly
 * 1,024 of them — the JSON's closing quote among the lost bytes, so the shell sat at `quote>` and the seat
 * never booted. The cwd repeated once per excluded rule was the bulk of the line. Repro: the boot line
 * `bootLine` composes for a `bot` plan in any worktree under `.claude/worktrees.noindex/` with a long slug.
 *
 * A cwd carrying a double quote or a backslash cannot ride inside double-quoted JSON, so it keeps the
 * spelled-out, single-quoted form `shellCommandLine` makes one token of.
 *
 * @param template the template the seat boots from
 * @param cwd the seat's own working directory — the checkout whose rules are left out
 * @returns the suffix, with its leading space, or `""`
 */
export function claudeTemplateSuffix({ template, cwd }: { template: LaunchTemplate; cwd: string }): string {
  const { excludes } = LAUNCH_TEMPLATE_ROWS[template];
  if (excludes.length === 0) {
    return "";
  }
  const root = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  if (/["\\]/.test(root)) {
    const settings = JSON.stringify({ claudeMdExcludes: claudeMdExcludesFor({ cwd, template }) });
    return ` ${shellCommandLine({ command: ["--settings", settings] })}`;
  }
  const entries = excludes.map((path) => `\\"$PWD/${path}\\"`).join(",");
  return ` --settings "{\\"claudeMdExcludes\\":[${entries}]}"`;
}

/**
 * The front-matter problem an unknown `template:` line raises, or none — which makes the doc malformed, so a
 * mistyped template can never boot a seat on a template nobody chose.
 *
 * @param declared the `template:` line as written, when the doc has one
 * @returns the problem sentences, empty when the line is absent or names a real template
 */
export function templateProblems({ declared }: { declared: string | undefined }): readonly string[] {
  if (declared === undefined || isLaunchTemplate(declared)) {
    return [];
  }
  return [`template must be one of ${LAUNCH_TEMPLATES.join("|")}, got ${JSON.stringify(declared)}`];
}

/**
 * The `template` field a parsed doc carries: the line exactly as declared, a misspelling included, so the spawn
 * that reads it can REFUSE an unknown name rather than fall to the role's default as if none were written.
 *
 * @param declared the `template:` line as written, when the doc has one
 * @returns an object to spread into the doc, with no key at all when the line is absent
 */
export function templateField({ declared }: { declared: string | undefined }): { readonly template?: string } {
  return declared === undefined ? {} : { template: declared };
}

/** Where a seat's template came from — printed beside the template, so the choice is never silent. */
export type LaunchTemplateSource = "flag" | "doc" | "role";

/**
 * The template one spawn boots from: `--template` first, then the doc's `template:` line, then the role's
 * default. An unknown `--template` or `template:` line REFUSES, naming the valid set, rather than falling
 * through to a template nobody chose — a malformed doc line even under a valid flag. The board reports the
 * same misspelling through {@link templateProblems}.
 *
 * @param flag the `--template` value as passed, when it was
 * @param docTemplate the doc's `template:` line as declared, when it has one
 * @param role the seat's already-classified role, for the default
 * @returns the template and where it came from, or the refusal text
 */
export function resolveLaunchTemplate({
  flag,
  docTemplate,
  role,
}: {
  flag: string | undefined;
  docTemplate: string | undefined;
  role: SessionRole;
}): { template: LaunchTemplate; source: LaunchTemplateSource } | { error: string } {
  const valid = LAUNCH_TEMPLATES.join("|");
  // A malformed doc line refuses even under a valid --template, exactly as a doubled one does: the doc is
  // wrong either way, and a flag that happens to mask it would leave it wrong for the next spawn.
  if (docTemplate !== undefined && !isLaunchTemplate(docTemplate)) {
    return { error: `the doc's template: must be one of ${valid}, got ${JSON.stringify(docTemplate)}` };
  }
  if (flag !== undefined) {
    return isLaunchTemplate(flag)
      ? { source: "flag", template: flag }
      : { error: `--template must be one of ${valid}, got ${JSON.stringify(flag)}` };
  }
  if (docTemplate !== undefined) {
    return { source: "doc", template: docTemplate };
  }
  return { source: "role", template: defaultTemplateForRole({ role }) };
}

/**
 * The one line a spawn prints about its template: which one, where it came from, and what it leaves out.
 *
 * @param template the resolved template
 * @param source where it came from
 * @returns the line, without a verb prefix
 */
export function launchTemplateLine({
  template,
  source,
}: {
  template: LaunchTemplate;
  source: LaunchTemplateSource;
}): string {
  const { excludes } = LAUNCH_TEMPLATE_ROWS[template];
  const leaves = excludes.length === 0 ? "loads every standing rule" : `leaves out ${excludes.join(", ")}`;
  return `launch template ${template} (from ${source}) — ${leaves}`;
}

/** One template's launch load, measured over the always-on set it actually receives. */
export interface LaunchTemplateMeasurement {
  readonly template: LaunchTemplate;
  readonly purpose: string;
  readonly excluded: readonly string[];
  readonly loadedPaths: readonly string[];
  readonly bytes: number;
  /** `ceil(bytes / 4)` — a heuristic, never a tokenizer count, and printed as one. */
  readonly approximateTokens: number;
}

/**
 * What each template loads at launch, measured over the already-read always-on set (`alwaysOnPaths` in
 * `src/canon/alwaysOnDocs.ts`): every path it keeps, their bytes, and an approximate token figure.
 *
 * @param alwaysOn the always-on documents a `code` seat receives, already read
 * @returns one measurement per template, in {@link LAUNCH_TEMPLATES} order
 */
export function measureLaunchTemplates({
  alwaysOn,
}: {
  alwaysOn: readonly { readonly path: string; readonly content: string }[];
}): readonly LaunchTemplateMeasurement[] {
  return LAUNCH_TEMPLATES.map((template) => {
    const { excludes, purpose } = LAUNCH_TEMPLATE_ROWS[template];
    const loaded = alwaysOn.filter((doc) => !excludes.includes(doc.path));
    const bytes = loaded.reduce((sum, doc) => sum + Buffer.byteLength(doc.content, "utf8"), 0);
    return {
      approximateTokens: Math.ceil(bytes / 4),
      bytes,
      excluded: excludes,
      loadedPaths: loaded.map((doc) => doc.path),
      purpose,
      template,
    };
  });
}
