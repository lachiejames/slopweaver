/**
 * The no-headless gate — the mechanical half of AGENTS.md's operating doctrine rule 2: **"No headless
 * Claude, anywhere. No launchd job, no daemon, no detached or backgrounded `claude -p`, no resident
 * executor of any kind."**
 *
 * Unlike `schedulerBypass.ts`, which this file otherwise copies the shape of, there is **no allowlist and
 * no exemption marker**. The doctrine is a total ban: nothing in this repository may start a model, full
 * stop, and a marker or a sanctioned-file map would just be a second way to write the thing being banned. One
 * recognised desktop call causes visible app sessions, and only those (NH008 below).
 *
 * Five independent rules, each with a falsifiable trap that motivated it:
 *
 * - **NH001** bans importing `spawn`/`exec`/`execFile`/`fork` from `node:child_process` — named, aliased,
 *   namespace, `require`, or a dynamic `import()`. The last three are banned wholesale (regardless of which
 *   member is actually used) because a namespace/require/dynamic form conceals which member that is, the
 *   same reasoning `schedulerBypass.ts` applies to `@openai/codex-sdk`. `spawnSync`/`execSync`/
 *   `execFileSync` stay legal: they block the caller, so they cannot outlive the process that started them.
 * - **NH002** is the call-site backstop for the same four names. The trap: a naive `/\bexec\s*\(/` flags
 *   every `RegExp.prototype.exec()` call in the tree (real examples in `src/config.ts` and
 *   `src/prformat/checkCore.ts`) — a MEMBER call must never be flagged, only a bare one. The negative
 *   lookbehind for `.` and a word character is what tells `re.exec(x)` apart from a bare `exec(x)`.
 * - **NH003** bans a model-runner basename in executable command position — the start of a shell line,
 *   after `env`/`nohup`, or after a control operator (`&&`, `;`, `|`) — because a shell script or an
 *   embedded shell string can start a model without going anywhere near `child_process`. A model id
 *   (`claude-3-opus`), a URL, or prose is not command position, which is why every pattern requires a word
 *   boundary immediately after the basename rather than a bare substring match.
 * - **NH004** bans a MUTATING `launchctl` subcommand (`bootstrap`, `load`, `kickstart`, `start`, `submit`);
 *   `list`/`print` stay legal because they only inspect the launchd state, never activate a job.
 * - **NH005** bans a genuine job definition (`Program`/`ProgramArguments`) in a `.plist` file. No
 *   `.plist` exists in this tree today, so this rule has a measured, falsifiable zero baseline.
 * - **NH006** bans a model-runner basename hidden inside a `sendLine` call's own `text` field (the shape
 *   NH003 cannot see at all — see this rule's own doc for why), except the one recognized visible cmux-spawn
 *   launch, tracked per CALL rather than by line.
 * - **NH007** bans a model-runner basename inside a RETURNED string or template literal, except the same
 *   recognized visible launches. This is the hole NH006 alone left, and it was measured open: `cmux spawn`
 *   stopped writing its launch text inline and started building it in a `bootLine()` helper, so the
 *   `sendLine` call now reads `text: line` — a bare identifier carrying no basename for NH006 to see, while
 *   the literal itself sits in a `return` NH003 does not treat as command position. Measured:
 *   `visibleCmuxLaunch` matched ZERO call sites in the real `src/cmux/spawn.ts`, so the deliberate
 *   recognition had quietly become dead code and the one launch this repo intends was passing by the same
 *   accident any other launch would have. NH007 makes the recognition live where the string is actually
 *   built, which is the point: the pass is now a decision rather than a blind spot. Measured again,
 *   the same blind spot one level in: a launch line that grew an environment prefix
 *   (`` `${homePrefix}codex …` ``) no longer started with a basename, so NH007 stopped reading it —
 *   admitting a leading `${…}` group into `returnedLaunchHits`'s own command-position pattern is the fix,
 *   and the comment above that pattern carries the repro.
 * - **NH008** is the console's (`site/`) own spawn rule. The console is a separate Next app that ran outside
 *   this gate's scan entirely, which is how its verb runner's async `spawn` passed by the same accident any
 *   launch there would have. Since the plan-funded Talk call the console ALSO starts a model
 *   thread — `codex app-server`, held for exactly the life of a call the owner opened and can hang up — so the scan
 *   now covers `site/` and a bare async spawn there passes only as one of `RECOGNIZED_SITE_SPAWNS` (`noHeadlessCapability.ts`), a
 *   call-shape recognition exactly like NH006's, never a file list. The `spawn` import itself is NH001 there
 *   only when the file makes no recognized call, and `exec`/`execFile`/`fork` stay NH001 everywhere. The
 *   Electron shell (`desktop/`) and `tools/` ran outside the scan the same way (
 *   MEASURED: `desktop/` held ten hits in five files and `tools/` none, so a headless `spawn("claude", …)`
 *   written in either would have passed). `desktop/` now takes NH008 with its own recognized shapes
 *   (`RECOGNIZED_DESKTOP_CHILDREN`, `noHeadlessCapability.ts`) — never the console's, never a file list — and
 *   `tools/` takes the plain NH001/NH002. One of those shapes, the owner's Recovery press running `fleet
 *   recover`, causes visible app sessions: throwaway cards the owner sees and can stop, never a headless model. Reproduce the measurement by running `scanNoHeadless` over every
 *   non-test `.ts` under `desktop/` and `tools/`.
 *
 * The trap shared by NH003/NH004: the WORDS "launchd", "launchctl" and ".plist" legitimately appear in this
 * repo's own doctrine prose (`AGENTS.md`, `skills/loop/SKILL.md`, a comment in
 * `src/cli/commands/listen/run.ts`) — a rule that fires on the word rather than on command position or a
 * real job key would flag the doctrine that states the ban. Markdown/docs are excluded from the scan
 * surface entirely, and NH004/NH005 both key on syntax (a subcommand, a plist key) rather than a word.
 *
 * ## NH006's known, accepted limitation — a regex is not a parser
 *
 * `SEND_LINE_CALL` finds a `sendLine` call's own object-literal body by matching up to the first textual
 * `})`, the same limitation NH002 already accepts for member calls (see above): it does not track string/
 * escape state, so a `text` value whose own content happens to CONTAIN the literal sequence `})` truncates
 * the call body early and the hidden basename after it goes unseen. Closing this fully needs an actual
 * lexer that tracks quote/escape state character by character, not a smarter regex — a real string
 * containing `})` immediately before a bare `codex`/`claude` mention is possible but reads as bizarre on
 * sight to any reviewer, the same "not a silent bypass in the sense that matters" reasoning NH002's own gap
 * already rests on. Accepted for the same reason: real cost to close fully, low realistic likelihood, and a
 * human reviewer would flag the construction anyway. NH006 still closes every ORDINARY escape (quote-style
 * variation, an escaped quote inside otherwise plain text, two calls sharing one line) — this gap is about
 * deliberately adversarial string content, not accidental variation.
 *
 * Mirrors the other gates' shape: a PURE {@link scanNoHeadless} over one file's content (unit-tested with
 * inline fixtures, so this file never scans itself) plus an effectful {@link runNoHeadless} edge that walks
 * the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { capabilityHits, lineAt } from "./noHeadlessCapability.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import { repoRoot } from "./scanScope.js";

/** The rule identifiers this gate enforces, NH001 to NH008. */
type NoHeadlessKind = "NH001" | "NH002" | "NH003" | "NH004" | "NH005" | "NH006" | "NH007" | "NH008";

/** One no-headless finding: where it is, which rule it broke, and the offending text. */
export interface NoHeadlessFinding {
  readonly path: string;
  readonly line: number;
  readonly kind: NoHeadlessKind;
  readonly excerpt: string;
}

const MODEL_BASENAMES = "claude|codex|gemini|aider|opencode";

/**
 * The three ways a model-runner basename sits in executable command position, one per line. All carry the
 * `g` flag: `matchAll` requires it, and the leading-anchor pattern still only ever matches once per line
 * because `^` binds to the true start of the (single-line) string being searched.
 */
const COMMAND_POSITION_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`^\s*(?:sudo\s+)?(${MODEL_BASENAMES})(?=\s|$)`, "g"),
  new RegExp(String.raw`(?:&&|;|\|)\s*(${MODEL_BASENAMES})(?=\s|$)`, "g"),
  // `env`/`nohup` are usually followed by `VAR=value` assignments before the real command
  // (`env DEBUG=1 claude -p`), so zero or more of those are allowed between the wrapper and the basename.
  new RegExp(String.raw`\b(?:env|nohup)\s+(?:[A-Za-z_]\w*=\S*\s+)*(${MODEL_BASENAMES})(?=\s|$)`, "g"),
];

/**
 * NH003 — a model-runner basename in executable command position, one line at a time.
 *
 * A model id (`claude-3-opus`), a URL or a prose sentence is never command position: every pattern requires
 * the basename to sit at the start of the line, right after a control operator, or right after `env`/
 * `nohup`, with a word boundary immediately following it.
 *
 * @param content the file's text
 * @returns each hit, tagged NH003
 */
function commandPositionHits({ content }: { content: string }): NoHeadlessFinding[] {
  const hits: NoHeadlessFinding[] = [];
  content.split("\n").forEach((line, index) => {
    for (const pattern of COMMAND_POSITION_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        hits.push({ excerpt: match[0].trim(), kind: "NH003", line: index + 1, path: "" });
      }
    }
  });
  return hits;
}

/**
 * Every `sendLine(…)` call's own object-literal body, greedy across lines — `cmux/client.js`'s primitive
 * for writing text to a REAL, already-open interactive terminal surface, the one way this repo's own visible
 * spawn (`cmux/spawn.ts`) tells a booted session what to run.
 */
const SEND_LINE_CALL = /\bsendLine\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

/**
 * A `text:` field's own string value, whichever quote style it used.
 *
 * Each alternative matches a run of "anything but that quote or a backslash, or a backslash followed by ANY
 * character" — the standard escaped-string pattern — rather than `[^"]*`, which stops at the first quote
 * character REGARDLESS of whether it was escaped. A found-and-fixed defect: the naive form read
 * `text: "say \"then codex exec headless\""` as ending at the escaped quote, truncating the captured value
 * to `say \` and missing the hidden basename entirely — a valid, unremarkable escape sequence, not an exotic
 * one, so failing to handle it left a real gap rather than a merely theoretical one.
 */
const TEXT_FIELD_VALUE = /\btext\s*:\s*(?:`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;

/**
 * A `text:` field's own string value, whichever of the three quote-style capture groups actually matched.
 *
 * `TEXT_FIELD_VALUE` alternates backtick/double/single quoting into three MUTUALLY EXCLUSIVE groups — only
 * one is ever populated per match, and it is never group 1. Reading `match[1]` alone (a real regression,
 * found by adversarial review) silently misses every double- or single-quoted `text:`, exactly the kind of
 * quote-style variation this rule exists to catch regardless of which one a caller happens to use.
 *
 * @param body the text to search for a `text:` field
 * @returns the field's own string value, from whichever quote style matched, or `undefined` when absent
 */
function textFieldValue({ body }: { body: string }): string | undefined {
  const match = TEXT_FIELD_VALUE.exec(body);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/** The absolute offset, in the FULL scanned content, of a `sendLine` call match's own `text:` field. */
function textFieldIndex({ match }: { match: RegExpExecArray }): number | undefined {
  const body = match[1];
  if (body === undefined) {
    return undefined;
  }
  const bodyOffsetInMatch = match[0].indexOf(body);
  const fieldOffsetInBody = TEXT_FIELD_VALUE.exec(body)?.index;
  if (bodyOffsetInMatch === -1 || fieldOffsetInBody === undefined) {
    return undefined;
  }
  return match.index + bodyOffsetInMatch + fieldOffsetInBody;
}

/** One `sendLine(…)` call's own `text:` field — where it sits, and its value when the field parsed at all. */
interface SendLineCall {
  readonly textOffset: number;
  readonly value: string | undefined;
}

/**
 * Every `sendLine(…)` call in `content`, in order, each with its own `text:` field read independently.
 *
 * Deliberately per-CALL, not per-line: two `sendLine` calls can share one line (a real finding —
 * tracking recognition by line number let one recognized call on a line hide an unrelated forbidden call
 * sharing that same line). Reading each match's own offset keeps every call's recognition entirely its own.
 */
function sendLineCalls({ content }: { content: string }): readonly SendLineCall[] {
  const calls: SendLineCall[] = [];
  const rx = new RegExp(SEND_LINE_CALL);
  let match = rx.exec(content);
  while (match !== null) {
    const textIndex = textFieldIndex({ match });
    // A call carrying no `text:` field this scanner can locate has no value to recognize, and is reported where
    // the call itself starts.
    calls.push(
      textIndex === undefined
        ? { textOffset: match.index, value: undefined }
        : { textOffset: textIndex, value: textFieldValue({ body: match[1]! }) },
    );
    match = rx.exec(content);
  }
  return calls;
}

/**
 * The `sendLine` call `text` shapes this repo recognizes as a visible cmux launch — EXACT equality, not
 * a prefix match. A prefix match (this file's own history: `startsWith("claude --plugin-dir ")`) accepts any
 * suffix a caller appends after the recognized recipe, including `; codex exec` or another runner tacked on
 * the same line — equality closes that specific gap. `${pluginDirSuffix}`, `${modelSuffix}`,
 * `${effortSuffix}`, `${nameSuffix}` and `${templateSuffix}` are `bootLine.ts`'s own local variable names (all
 * five plain strings — `""` or ` --plugin-dir <path>`, `""` or ` --model <value>`, `""` or ` --effort <level>`,
 * `""` or ` --name <value>`, `""` or ` --settings '<json>'` — built from the plan BEFORE this call, never a
 * second `sendLine`, never a runner tacked onto the same line), captured here as literal source text the same
 * way the scanner reads every other `text:` field: if any of them is ever renamed, or a sixth suffix is
 * appended, this set must be updated in the same change, not silently drift. `${templateSuffix}` is what a
 * fifth one looked like: it landed and this literal moved in the same commit.
 */
const RECOGNIZED_VISIBLE_LAUNCHES: ReadonlySet<string> = new Set([
  // `storePrefix` is environment only — EMPTY for an ordinary worker in its checkout, `NX_DAEMON=false ` for a
  // fleet-worktree seat (`cmux/fleetEnv.ts`), plus the credential store for a pinned one — so this one literal
  // covers every seat rather than blessing a second kind of launch: the command being started is identical.
  // `pluginDirSuffix` is empty on the marketplace route, which is the DEFAULT
  // (`src/cmux/pluginDir.ts`), so the same literal covers a dogfooding launch and a marketplace one.
  // Both are the same visible `claude`.
  "${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}",
  // `cmux reseat`'s relaunch (`cmux/reseatLine.ts`): the same visible `claude`, in the surface it was already
  // running in, with no `--name` and `--resume <id>` last. `sessionId` is a UUID the planner checked before
  // composing, never a command. Rename any local there, or append a piece, and this entry moves with it.
  "${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${templateSuffix} --resume ${sessionId}",
  // The same relaunch with nothing to resume (`cmux/reseatLine.ts`'s `fresh` arm): a session that never took a
  // prompt has no transcript, so `--resume` would only print "No conversation found" and drop to the shell. The
  // same visible `claude`, minus `--resume`, and the cmux wrapper picks the new session id.
  "${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${templateSuffix}",
  // The Codex seat, in the same shape and for the same reason. `homePrefix` is `spawn.ts`'s own local (empty,
  // or `CODEX_HOME=<quoted home> ` — built by `cmux/seatRoute.ts`'s `codexHomePrefix` BEFORE this return,
  // never a second command), and `CODEX_MODEL` is the repository's own model pin from `codex/profiles.ts`.
  // A seat that routes to a registered account and one that follows the ambient home are the same visible
  // `codex`. Rename either name, or append a fourth piece, and this entry must move in the same change.
  // `browserOffSuffix` is that fourth piece: `-c` overrides only (`codex/browserSurface.ts`), never a command.
  "${homePrefix}codex --no-alt-screen --model ${CODEX_MODEL}${browserOffSuffix}",
  // The bare interactive Codex TUI, which is what the line above was before it carried a routed home and the
  // model pin. Kept because the SHAPE is what is recognized, not the file it sits in: a plain
  // `codex --no-alt-screen` sent to a real surface is a visible session wherever it occurs, and
  // `codex exec` — the non-interactive one — is recognized by neither entry and never will be.
  "codex --no-alt-screen",
]);

/** Whether one `sendLine` call's own text is exactly one of this repo's recognized cmux-spawn recipes. */
function isRecognizedVisibleLaunch({ call }: { call: SendLineCall }): boolean {
  return call.value !== undefined && RECOGNIZED_VISIBLE_LAUNCHES.has(call.value);
}

/**
 * The deliberately-recognized visible-session launches: a `sendLine` call whose `text` is exactly one of
 * this repo's own cmux-spawn recipes — the interpolated `claude` line, or an interactive
 * `codex --no-alt-screen` (never `codex exec`, which is non-interactive automation).
 *
 * This is a structural recognition of a CALL SHAPE, never a file-path allowlist or an exemption comment:
 * `sendLine` only ever reaches a real, already-booted, human-watchable terminal (see this file's own
 * header for why NH001/NH002 already treat a detached `child_process` spawn completely differently), so a
 * model-runner basename sitting inside its own `text` field is exactly the shape rule 2's own visible-session
 * exception describes. The same shape matches identically wherever it occurs — this is a pattern match, not
 * a lookup keyed on which file is being scanned.
 *
 * @param content the file's text
 * @returns the 1-indexed line of every recognized visible launch
 */
export function visibleCmuxLaunch({ content }: { content: string }): readonly { readonly line: number }[] {
  return sendLineCalls({ content })
    .filter((call) => isRecognizedVisibleLaunch({ call }))
    .map((call) => ({ line: lineAt({ content, index: call.textOffset }) }));
}

/**
 * Every `return` whose expression is a single string or template literal, with its text and line.
 *
 * Deliberately only the ONE-EXPRESSION shape (`return "…";`, `return \`…\`;`), because that is the shape a
 * launch-line builder actually has and a wider match would start reporting on concatenations and ternaries
 * whose value this scanner cannot resolve anyway. A quote character inside the literal ends the match, the
 * same regex-is-not-a-parser limitation NH002 and NH006 already accept and state.
 *
 * @param content the file's text
 * @returns each returned literal's own text and 1-indexed line
 */
function returnedLiterals({ content }: { content: string }): readonly { text: string; line: number }[] {
  const rx = /\breturn\s+(?:`([^`]*)`|"([^"]*)"|'([^']*)')\s*;/g;
  const found: { text: string; line: number }[] = [];
  let match = rx.exec(content);
  while (match !== null) {
    // Exactly one alternative matched, so exactly one group is defined — an honest assertion rather than a
    // coalesce, which would silently turn "the regex changed shape" into an empty literal nobody flags.
    const text = match[1] ?? match[2] ?? match[3]!;
    found.push({ line: lineAt({ content, index: match.index }), text });
    match = rx.exec(content);
  }
  return found;
}

/**
 * NH007 — a model-runner basename in a RETURNED literal, unless it is exactly a recognized visible launch.
 *
 * NH006 reads a `sendLine` call's own `text` field, so it sees nothing once the launch line is built by a
 * helper and passed in as a variable — which is exactly what `src/cmux/spawn.ts` does today. NH003 does not
 * help either: a basename after `return \`` is not shell command position under any of its patterns. The
 * result, measured, was that the ONE launch this repo deliberately recognizes escaped by the same accident
 * that would have waved through `claude -p '…'` returned from the same function.
 *
 * The recognized set is shared with NH006 rather than duplicated, so there is exactly one place naming what
 * a visible launch looks like, and a rename of `spawn.ts`'s own interpolated variables fails BOTH rules at
 * once instead of silently loosening one.
 *
 * @param content the file's text
 * @returns each hit, tagged NH007
 */
function returnedLaunchHits({
  content,
}: {
  content: string;
}): { kind: NoHeadlessKind; line: number; excerpt: string }[] {
  // COMMAND POSITION, exactly as NH003 requires it, and for exactly the same reason: this repo's own prose
  // says the words. A launch line starts with the runner, optionally behind `env`/`nohup` or an
  // environment-assignment prefix, which POSIX permits before the command word — and a BUILT line spells
  // that prefix as a leading `${…}` interpolation, so the three sit in one alternation rather than one being
  // stripped first. MEASURED on this repo: the Codex seat's boot line became
  // `` `${homePrefix}codex …` `` when routing gave it a `CODEX_HOME=` prefix, and a pattern anchored on the
  // basename alone stopped seeing it entirely — rewriting that same line to `codex exec` left the gate CLEAN.
  // Reproduce it by putting `codex exec` in `src/cmux/spawn.ts`'s `codexBootLine` and running
  // `slopweaver dev lint --only no-headless`. Only LEADING whole `${…}` groups count: an interpolation later
  // in the line is an argument and says nothing about which program runs. Recognition still compares the
  // WHOLE text, so a prefixed launch must be spelled in `RECOGNIZED_VISIBLE_LAUNCHES` exactly as written.
  const launchPattern = new RegExp(String.raw`^\s*(?:\$\{[^}]*\}|env\s+|nohup\s+)*(${MODEL_BASENAMES})\b`);
  return returnedLiterals({ content })
    .filter(
      (literal) =>
        launchPattern.test(literal.text) &&
        // A returned SENTENCE that happens to open with a runner's name is prose, not a launch. Measured:
        // `doctor/run.ts` returns diagnostic lines beginning "codex config: none — …", and position alone
        // reported both of them. A label followed by a colon and a space is the shape of a diagnostic line
        // and never the shape of a command line, so it is the discriminator — deliberately narrow, and it
        // errs toward flagging, because a launch that has to be dressed as a sentence to pass is one a
        // reviewer should see anyway.
        !literal.text.includes(": ") &&
        !RECOGNIZED_VISIBLE_LAUNCHES.has(literal.text),
    )
    .map((literal) => ({ excerpt: literal.text, kind: "NH007" as const, line: literal.line }));
}

/**
 * NH006 — a model-runner basename hidden inside a `sendLine` call's own `text` field, ANYWHERE it occurs,
 * unless that exact call is {@link isRecognizedVisibleLaunch}'s one recognized shape.
 *
 * NH003 only ever matches a basename sitting in true shell command position (line start, after a control
 * operator, after `env`/`nohup`) — a basename sitting inside an object literal's own field, as
 * `text: \`claude --plugin-dir …\`` does, never matches any of those patterns and escapes NH003 by
 * construction. That is the real gap this rule closes: the SAME indirect shape anywhere else in the tree —
 * a future call sending a model command through a cmux surface via some OTHER text than the one recognized
 * launch — is refused here rather than passing by the same accident.
 *
 * @param content the file's text
 * @returns each hit, tagged NH006
 */
function sendLineModelHits({ content }: { content: string }): NoHeadlessFinding[] {
  const basenamePattern = new RegExp(String.raw`\b(${MODEL_BASENAMES})\b`);
  return sendLineCalls({ content }).flatMap((call) => {
    if (call.value === undefined || isRecognizedVisibleLaunch({ call }) || !basenamePattern.test(call.value)) {
      return [];
    }
    const line = lineAt({ content, index: call.textOffset });
    return [{ excerpt: call.value, kind: "NH006" as const, line, path: "" }];
  });
}

/** A MUTATING launchctl subcommand — `list`/`print` are read-only and deliberately absent from this list. */
const LAUNCHCTL_MUTATING = /\blaunchctl\s+(bootstrap|load|kickstart|start|submit)\b/g;

/**
 * NH004 — a scheduler-activating `launchctl` subcommand, one line at a time. The bare words "launchd" or
 * "launchctl" never match on their own; only a real mutating subcommand does, so doctrine prose that merely
 * names launchd is untouched.
 *
 * @param content the file's text
 * @returns each hit, tagged NH004
 */
function schedulerActivationHits({ content }: { content: string }): NoHeadlessFinding[] {
  const hits: NoHeadlessFinding[] = [];
  content.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(LAUNCHCTL_MUTATING)) {
      hits.push({ excerpt: match[0].trim(), kind: "NH004", line: index + 1, path: "" });
    }
  });
  return hits;
}

/** A genuine launchd job definition: the key that names the program to run, or its argument list. */
const PLIST_JOB_KEY = /<key>\s*Program(?:Arguments)?\s*<\/key>/;

/**
 * NH005 — a real job definition in a `.plist` file. Scoped to that one extension, so a `.plist`
 * mentioned in prose elsewhere (there is none today) can never trip it.
 *
 * @param path the file's repo-relative path
 * @param content the file's text
 * @returns the one hit when a job key is present, else empty
 */
function realPlistJobHits({ path, content }: { path: string; content: string }): NoHeadlessFinding[] {
  if (!path.endsWith(".plist")) {
    return [];
  }
  const match = PLIST_JOB_KEY.exec(content);
  if (match === null) {
    return [];
  }
  return [{ excerpt: match[0], kind: "NH005", line: lineAt({ content, index: match.index }), path }];
}

/**
 * Every no-headless finding in one file. Pure — a test feeds it inline fixtures, so the gate stays
 * falsifiable without touching the filesystem.
 *
 * @param path the file's repo-relative path
 * @param content the file's text
 * @returns each finding (empty when clean)
 */
export function scanNoHeadless({ path, content }: { path: string; content: string }): readonly NoHeadlessFinding[] {
  const hits: NoHeadlessFinding[] = [];
  appendAll({ from: capabilityHits({ content, path }).map((hit) => ({ ...hit, path })), into: hits });
  appendAll({ from: commandPositionHits({ content }).map((hit) => ({ ...hit, path })), into: hits });
  appendAll({ from: schedulerActivationHits({ content }).map((hit) => ({ ...hit, path })), into: hits });
  appendAll({ from: realPlistJobHits({ content, path }), into: hits });
  appendAll({ from: sendLineModelHits({ content }).map((hit) => ({ ...hit, path })), into: hits });
  appendAll({ from: returnedLaunchHits({ content }).map((hit) => ({ ...hit, path })), into: hits });
  return hits.toSorted((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/** What each rule actually protects against, for the operator-facing message. */
function whatItBans({ kind }: { kind: NoHeadlessKind }): string {
  switch (kind) {
    case "NH001":
      return "importing an ASYNC child-process capability (spawn/exec/execFile/fork) from node:child_process";
    case "NH002":
      return "a bare call to spawn/exec/execFile/fork";
    case "NH003":
      return "a model-runner basename (claude/codex/gemini/aider/opencode) in executable command position";
    case "NH004":
      return "a MUTATING launchctl subcommand (bootstrap/load/kickstart/start/submit)";
    case "NH005":
      return "a real launchd job definition (Program/ProgramArguments) in a `.plist` file";
    case "NH006":
      return (
        "a model-runner basename inside a sendLine call's own text field, other than the one recognized " +
        "visible cmux-spawn launch"
      );
    case "NH007":
      return (
        "a model-runner basename in a RETURNED string literal, other than a recognized visible cmux-spawn " +
        "launch — a launch line built in a helper is still a launch line"
      );
    case "NH008":
      return (
        "an async spawn in the console or the desktop shell other than a recognized one (the console's verb " +
        "runner and the plan-funded Talk call's app-server; the shell's five helpers) — a child either starts " +
        "must be one a visible call owns"
      );
  }
}

/**
 * The failure line for one finding.
 *
 * @param finding the offending site
 * @returns the line to print
 */
export function noHeadlessMessage({ finding }: { finding: NoHeadlessFinding }): string {
  return (
    `${finding.path}:${String(finding.line)}: [${finding.kind}] ${whatItBans({ kind: finding.kind })}: ` +
    `\`${finding.excerpt}\`. AGENTS.md rule 2 — no headless Claude, anywhere. spawnSync/execSync/` +
    "execFileSync stay legal; a launchctl list/print stays legal. Nothing else may start a model."
  );
}

/**
 * The scanner's own files by EXACT repo-relative path — excluded from the walk, since they necessarily name the
 * forbidden shapes. A basename match would let a `desktop/src/noHeadless.ts` or `tools/noHeadless.ts` vanish from the
 * widened scan by name alone.
 */
const SELF_FILES: ReadonlySet<string> = new Set([
  "src/devLint/noHeadless.ts",
  "src/devLint/noHeadless.entry.ts",
  "src/devLint/noHeadlessCapability.ts",
]);

/** Directories scanned wholesale, regardless of extension — the plugin's shell/launcher/eval surface. */
const SCAN_DIRS: readonly string[] = ["scripts/", "hooks/", "bin/", "eval/"];

/**
 * Whether a path is excluded everywhere: this gate's own files, tests, recordings, Markdown/docs and fixtures.
 * `desktop/` is new to the scan, so its `.test.tsx` is excluded as a `.test.ts` is, while `site/` keeps scanning one.
 */
function isExcludedPath({ path }: { path: string }): boolean {
  const isTest = path.endsWith(".test.ts") || (path.startsWith("desktop/") && path.endsWith(".test.tsx"));
  const isDoc = path.endsWith(".md") || path.endsWith(".har");
  const isFixture = path.includes("/fixtures/") || path.startsWith("fixtures/");
  return SELF_FILES.has(path) || isTest || isDoc || isFixture;
}

/** Whether a path is a production `.ts`/`.tsx` under one of the TypeScript trees that also scans `.tsx`. */
function isUiTreeSource({ path }: { path: string }): boolean {
  const inUiTree = path.startsWith("site/") || path.startsWith("desktop/");
  return inUiTree && !path.includes("/__tests__/") && /\.tsx?$/.test(path);
}

/**
 * Whether a repo-relative path is in scope: a production `.ts` under `src/`, a production `.ts`/`.tsx` under
 * the console's `site/` or the desktop shell's `desktop/` (their `__tests__/` excluded), a `.ts` under `tools/`,
 * anything under the plugin's shell surface, or a `.plist`.
 * Tests, fixtures, recordings, Markdown/docs and this gate's own files are excluded everywhere.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  if (isExcludedPath({ path })) {
    return false;
  }
  const isTsTree = (path.startsWith("src/") || path.startsWith("tools/")) && path.endsWith(".ts");
  return (
    isTsTree || isUiTreeSource({ path }) || SCAN_DIRS.some((dir) => path.startsWith(dir)) || path.endsWith(".plist")
  );
}

/** List every working-tree file (repo-relative), anchored at `root` — the whole tree, not just `src`. */
function scanFiles({ root }: { root: string }): readonly string[] {
  return workingTreeFilesOf({ root });
}

/**
 * IO edge: scan every in-scope file, print each finding, return 0 (clean) or 1 (any finding / hard
 * error).
 *
 * @returns the process exit code
 */
export function runNoHeadless(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRoot();
    files = scanFiles({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("no-headless: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const scanned = files.filter((path) => isScannablePath({ path }));
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<NoHeadlessFinding>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanNoHeadless({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "no-headless",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`no-headless: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const finding of hits) {
    process.stderr.write(`  ${noHeadlessMessage({ finding })}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "no-headless" }),
      detail: `${String(hits.length)} violation(s) of AGENTS.md rule 2`,
    })}\n`,
  );
  return 1;
}
