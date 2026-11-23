/**
 * The raw-bypass classifier — the pure core behind the PreToolUse hook. It decides whether a shell
 * command is a RAW side-effecting tool that would reach past the door (so the agent could force-push or
 * post to an external API without any gate), and blocks those BY DEFAULT with an informative escape. It is deliberately
 * narrow, not heavy-handed (D10): read-only `git`/`gh` (the hygiene gate itself runs `git ls-files`) and
 * everything unrecognised are ALLOWED — only external/destructive raw ops are blocked, and always with a
 * real path forward (`SLOPWEAVER_ALLOW_RAW=1`, single-run break-glass).
 *
 * It also carries {@link REACHING_TOOLS} — the named CLIs that reach as far as `curl` does
 * without being it. Two things about that table are the rule rather than detail. Its route hints name NO verb for the classes that
 * have none, because a hint pointing at a verb which cannot do the job actively misdirects — the mistake
 * `GITHUB_COMMAND_COVERS`'s own comment records being hit twice before anyone noticed the door was missing.
 * And the `production-cli` class is the ONE category `allowRaw` does not cover: it takes a journalled,
 * tool-scoped, expiring grant instead ({@link ./reachGrant}), because an env var is ambient and traceless,
 * which is the wrong shape when the rule is "stop" rather than "be careful".
 *
 * It resolves the tool + subcommand robustly: it strips an `env`/`VAR=VAL` prefix and skips `git` global
 * flags (`git -C <dir> push`, `git --git-dir=… push`) so the destructive subcommand isn't hidden behind
 * them — those token helpers live in `./commandTokens.ts`, and the `git` and `cmux` segment classifiers in
 * `./rawSegmentClassify.ts`. Pure: `command` + `allowRaw` in, a verdict out.
 *
 * Two `gh` READ families are blocked despite being reads: the watch/poll shapes (`gh pr checks --watch`, `gh run
 * watch`, a loop-polled `gh pr checks`), pointed at `github checks --wait`, and a one-shot CI log read (`gh run
 * view --log`, a `gh api` run, job or log fetch), pointed at `github run-log`. `./rawGhReadRoute.ts` owns both
 * and says why; a one-shot `gh pr checks <n>` and a plain `gh run view <id>` stay unblocked.
 *
 * KNOWN, ACCEPTED RESIDUAL GAP in `isLoneGraphqlRead`: it locates the `query=` field with a regex over the
 * raw command text, not a real shell tokenizer for the WHOLE command line, so it cannot tell a genuine
 * `-f query=…` flag from the same literal text sitting inside the VALUE of an earlier, unrelated argument
 * (e.g. a decoy `-H 'X-Decoy: -f query=query'` header before the real field). An adversarial review pass
 * found this exploitable. Closing it fully needs a tokenizer for every argument in the command, not just
 * the one field this function already reconstructs correctly — a materially larger undertaking, and one
 * this hook's own stated role does not justify: it is a self-discipline nudge over commands the AGENT
 * ITSELF is about to run, not a defence against an external adversary crafting shell input, and by the time
 * a decoy this deliberate is worth constructing, the escape hatch below is the honest path anyway. Six
 * PRIOR rounds each closed a real gap an ordinary quoting variation could hit — decoy field names, decoy
 * env-var prefixes, same/mixed-quote concatenation, ANSI-C quoting, unquoted-word splicing, backslash-
 * newline continuation, and a same-shape-different-operation document — this is the first that requires
 * deliberately adversarial command construction rather than an incidental one, which is where the line gets
 * drawn.
 */
import { extractShellWord, unquoteShellPayload, usesShellExpansion } from "./argumentValue.js";
import { stripEnvPrefix, toolName } from "./commandTokens.js";
import { classifyGhRead } from "./rawGhReadRoute.js";
import { githubWriteCategory } from "./rawGhWriteRoute.js";
import {
  classifyCmuxSegment,
  gitCategory,
  isDestructiveGit,
  type SegmentClassification,
} from "./rawSegmentClassify.js";
import { type RouteCategory, reachingSegment, routeHint } from "./rawToolsRoute.js";
import { reachGrantRefusal } from "./reachGrant.js";
import { classifyScriptSource, type ScriptReader, scriptPathFromTokens } from "./scriptWrapper.js";
import { hasSegmentInlineEnvironmentOverride, shellSegments } from "./shellSegments.js";

/**
 * The verdict for one command — a discriminated union so a `blocked` verdict ALWAYS carries its `tool`,
 * `reason`, and `message` (no optional fields to `?? ''` around). An allowed verdict may name the tool
 * (e.g. when the escape waived it).
 */
export type RawVerdict =
  | { readonly blocked: true; readonly tool: string; readonly reason: string; readonly message: string }
  | { readonly blocked: false; readonly tool?: string };

/** The raw-side-effect escape variable, shared with the hook's inline-override resolver. */
const RAW_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_RAW";

/** The escape hatch, quoted verbatim in every block message so the path forward is never hidden. */
export const RAW_ESCAPE = `${RAW_OVERRIDE_ENV}=1`;

/** `gh <group> <sub>` combinations that MUTATE (create/merge/close/delete/edit/…). Read verbs are absent ⇒ allowed. */
const GH_MUTATIONS: Readonly<Record<string, readonly string[]>> = {
  cache: ["delete"],
  gist: ["create", "edit", "delete"],
  issue: ["create", "close", "reopen", "edit", "comment", "delete", "lock", "unlock", "transfer", "pin", "unpin"],
  label: ["create", "edit", "delete"],
  // `merge` and `ready` are deliberately ABSENT. The policy they enforced — never merge or undraft without the
  // maintainer — no longer holds: an agent may undraft and merge its own PR once CI is green and the
  // proof grade is `gold`. Blocking them here would have made the sanctioned path require the break-glass, which
  // is how a break-glass stops meaning anything. What actually gates a merge now is CI plus the `proof-commit:`
  // anchor the PR-format gate compares against the head SHA (see AGENTS.md § Pull requests) — a gate on the
  // pull request rather than on the shell, which is where it belongs: this classifier cannot see whether CI is
  // green, so a block here was never the check anybody thought it was.
  pr: ["create", "close", "reopen", "edit", "comment", "review", "lock", "unlock"],
  release: ["create", "edit", "delete", "upload"],
  repo: ["create", "delete", "edit", "archive", "rename", "sync"],
  run: ["cancel", "rerun", "delete"],
  secret: ["set", "delete"],
  variable: ["set", "delete"],
  workflow: ["run", "enable", "disable"],
};

/** Write HTTP methods for `gh api` / `curl` — the tell that a request MUTATES rather than reads. */
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** The first two non-flag tokens after `gh` — its group + subcommand. */
function ghGroupSub({ tokens }: { tokens: readonly string[] }): {
  group: string | undefined;
  sub: string | undefined;
  rest: readonly string[];
} {
  const words = tokens.slice(1).filter((t) => !t.startsWith("-"));
  return { group: words[0], rest: tokens.slice(1), sub: words[1] };
}

/**
 * Whether a `gh api graphql` call's `query` field is PROVABLY a lone read. Anchored to the field name
 * itself — `(?:-f|-F|--field|--raw-field)\s+query=` — so a decoy field (`myquery=`, or a `QUERY=` SHELL
 * VARIABLE preceding the whole command, already stripped by {@link stripEnvPrefix} before this ever runs)
 * cannot supply a false match the way an unanchored `query=` search could.
 *
 * Anything involving `$`/backtick fails closed unconditionally ({@link usesShellExpansion}) — no attempt is
 * made to resolve a substitution's actual runtime value. Otherwise the value is read with
 * {@link extractShellWord}, which correctly concatenates adjacent quoted and unquoted segments the way a
 * real shell would, so a keyword can no longer be hidden by splitting it across a quote boundary. Within
 * that extracted value:
 *   - a leading `#`-comment line is skipped (harmless prose before the real operation);
 *   - a leading `query` keyword or a bare `{` (anonymous shorthand) is a read ONLY if no `mutation` keyword
 *     appears ANYWHERE ELSE in the value. The GraphQL spec does make the anonymous shorthand illegal
 *     alongside another operation, so a well-formed document containing one truly cannot also contain a
 *     mutation — but this function does not itself validate well-formedness, and trusting that a malformed
 *     document would simply be rejected server-side is exactly the kind of assumption an adversarial review
 *     pass found unsafe to make: `{ … }\nmutation Write { … }` is not valid GraphQL, yet nothing here
 *     confirms GitHub's own parser refuses it rather than executing something, so the SAME unconditional
 *     scan applies to both leading shapes rather than trusting either one specially;
 *   - anything else (a leading `mutation`, `fragment`, `subscription`, or a field this couldn't confidently
 *     parse at all) fails closed as NOT a lone read, since guessing wrong the other way lets a write through.
 */
function isLoneGraphqlRead({ command }: { command: string }): boolean {
  const match = /(?:-f|-F|--field|--raw-field)\s+query=/.exec(command);
  if (match === null) {
    return false;
  }
  const afterField = command.slice(match.index + match[0].length);
  if (usesShellExpansion({ text: afterField })) {
    return false;
  }
  const value = extractShellWord({ text: afterField });
  const withoutLeadingComments = value.replace(/^(?:\s*#[^\n]*\n)*/, "");
  const head = /^\s*(\{|[A-Za-z]+)/.exec(withoutLeadingComments)?.[1];
  if (head === undefined || (head !== "{" && head.toLowerCase() !== "query")) {
    return false;
  }
  return !/\bmutation\b/i.test(value);
}

/**
 * Whether a `gh api` REST call (never the `graphql` subcommand) mutates: a write method, or any field flag —
 * spaced (`--raw-field x=y`) or attached (`--raw-field=x=y`, `-fx=y`), since a field makes `gh` default to POST.
 * Redirections are not stripped from `rest`, so output sent to a file NAMED like a field (`> -fx=y`) reads as a
 * write — the safe direction, found by a Codex review, and the base already did the same for a file named `-f`.
 */
function isMutatingRestApi({ rest }: { rest: readonly string[] }): boolean {
  const hasFields = rest.some((t) => /^(?:-[fF]|--field(?:=|$)|--raw-field(?:=|$)|--input(?:=|$))/u.test(t));
  // Method comes as `-X POST`, `--method POST`, `--method=POST`, or the attached `-XPOST`.
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!; // i < rest.length ⇒ in-bounds
    const attached = /^(?:-X|--method=)(.+)$/.exec(token);
    const method = attached?.[1] ?? (token === "-X" || token === "--method" ? rest[i + 1] : undefined);
    if (method !== undefined && WRITE_METHODS.has(method.toLowerCase())) {
      return true;
    }
  }
  return hasFields;
}

/** Whether a `gh` invocation mutates: a known mutating group/sub, or `gh api` with a write method / fields. */
function isMutatingGh({ tokens, command }: { tokens: readonly string[]; command: string }): boolean {
  const { group, sub, rest } = ghGroupSub({ tokens });
  if (group === undefined) {
    return false;
  }
  if (group === "api") {
    return sub === "graphql" ? !isLoneGraphqlRead({ command }) : isMutatingRestApi({ rest });
  }
  return sub !== undefined && GH_MUTATIONS[group]?.includes(sub) === true;
}

/**
 * Reaching CLIs that are not `curl` by another name but reach exactly as far — a lot of things are banned
 * in this setup the way a curl request is.
 *
 * MEASURED before it was written, over 158,911 `Bash`/`Monitor` calls in 14 days: the
 * shipped classifier blocked 348 of them (0.2%), and `gcloud` accounted for 45 live reaches that met no
 * gate at all — including `gcloud auth application-default print-access-token > /tmp/tok.txt`, which writes
 * a live cloud credential into a world-readable temp file, and a `gcloud secrets list` against a staging
 * project. Every other name here measured ZERO real invocations in the same window, which is the argument
 * FOR listing them rather than against: the ban costs nothing today and closes the class before it opens.
 * Reproduce by extracting every `Bash`/`Monitor` `tool_use` from the transcripts under
 * `~/.claude/projects` and re-running {@link classifyRawCommand} over each with `allowRaw: false`.
 *
 * Names deliberately ABSENT, and why, so a later reader does not "complete" the table:
 *   - `node`, `npx`, `deno`, `ruby`, `perl` — general-purpose interpreters. 46 uses in the same window
 *     (Python's among them; the figure is not Python's alone), nearly all scratch scripts and measurements.
 *     A name-based ban here would make the break-glass ambient across a whole session, which is how a hatch
 *     stops meaning anything, and any of them still reaches the network in one line once it is set. Named as
 *     accepted residue instead.
 *   - `python3` is absent from this table too, and is NO LONGER residue. The measurement justified
 *     leaving general interpreters outside the reaching-tool table; the owner's rule supersedes that
 *     treatment for Python only — the work is authored as typed, tested TypeScript exposed
 *     through a `slopweaver` verb. That is a rule about which TOOL does the work rather than about reaching
 *     anything, so it does not belong in this table at all: `./pythonInvocation.ts` refuses it in a separate
 *     walk with its own `SLOPWEAVER_ALLOW_PYTHON` hatch, which `SLOPWEAVER_ALLOW_RAW` does not open and
 *     which opens nothing here. Every other interpreter keeps the treatment above.
 *   - `docker`, `psql`, `mysql`, `redis-cli` — 58 uses, all measured local dev (`-h /tmp -p 55432`,
 *     `compose exec`, `docker ps`). Banning them taxes the loop daily to prevent nothing that happened.
 *   - `ssh`, `scp`, `rsync` — all three measured uses are `ssh -T git@github.com`, an auth check.
 *   - `yarn`, `npm`, `pnpm`, `brew` — a registry is not a provider, and the block would fire on install.
 */
const REACHING_TOOLS: Readonly<Record<string, RouteCategory>> = {
  aws: "cloud-cli",
  az: "cloud-cli",
  bq: "cloud-cli",
  fly: "production-cli",
  gcloud: "cloud-cli",
  gsutil: "cloud-cli",
  heroku: "production-cli",
  kubectl: "cloud-cli",
  netlify: "production-cli",
  op: "secrets-cli",
  stripe: "production-cli",
  supabase: "production-cli",
  twilio: "production-cli",
  vercel: "production-cli",
};

/**
 * The production-facing tools, as a list — what `session reach-grant` validates its `--tool` against, and
 * what its refusal names back. Derived from {@link REACHING_TOOLS} rather than restated, so the verb and the
 * classifier can never disagree about which class a tool is in.
 */
export const PRODUCTION_REACH_TOOLS: readonly string[] = Object.entries(REACHING_TOOLS)
  .filter(([, category]) => category === "production-cli")
  .map(([tool]) => tool)
  .toSorted();

/** `until`/`while` — the two shell loop keywords a hand-rolled `gh pr checks` poll gets wrapped in. */
const LOOP_KEYWORDS = new Set(["until", "while"]);

/**
 * The compound-statement keywords a real command can hide behind once {@link shellSegments} has cut the line.
 *
 * Measured, not guessed: `for f in a; do curl https://x; done` split into `for f in a`, `do curl https://x`
 * and `done`, and the middle segment's FIRST token was `do`, so the `curl` behind it was never classified at
 * all and the whole command passed. The same holds for a `then`/`else` branch body. These are prefixes to
 * strip, not commands, so stripping them is what lets the body be judged as itself.
 */
const STATEMENT_PREFIXES = new Set(["do", "then", "else", "elif", "{", "!"]);

/** Shells whose `-c` argument is a whole command line this classifier would otherwise never look inside. */
const SHELL_RUNNERS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** How many `sh -c` wrappers deep this classifier will look before it stops rather than recursing forever. */
const MAX_SHELL_RUNNER_DEPTH = 3;

/**
 * Strip a leading `until`/`while` (and an optional `!` negation) so the loop's own CONDITION command can be
 * classified like any other — {@link shellSegments} already splits `until COND; do BODY; done` into separate
 * `;`-joined segments, so `COND` (this segment) is the only one that ever names `gh pr checks`.
 *
 * @param tokens the segment's own whitespace-split tokens, env-prefix already stripped
 * @returns the tokens with the loop keyword and negation removed, or `tokens` unchanged if there was none
 */
function stripLoopKeyword({ tokens }: { tokens: readonly string[] }): readonly string[] {
  if (tokens.length === 0 || !LOOP_KEYWORDS.has(tokens[0]!)) {
    return tokens;
  }
  const rest = tokens.slice(1);
  return rest[0] === "!" ? rest.slice(1) : rest;
}

/**
 * Strip every leading compound-statement keyword, so a loop or branch BODY is classified as its own command.
 *
 * Loops on purpose: `do ! curl …` carries two prefixes, and stopping after one would leave the second in
 * place and hide the command behind it, which is the exact failure being closed. Bounded by the token count,
 * so a line made entirely of keywords terminates with nothing left rather than spinning.
 *
 * @param tokens the segment's own whitespace-split tokens, env-prefix already stripped
 * @returns the tokens with every leading statement keyword removed
 */
function stripStatementPrefixes({ tokens }: { tokens: readonly string[] }): readonly string[] {
  let rest = tokens;
  while (rest.length > 0 && STATEMENT_PREFIXES.has(rest[0]!)) {
    rest = rest.slice(1);
  }
  return rest;
}

/**
 * Classify a `gh` segment: (outside a loop) a mutating call FIRST, so `-X DELETE …/logs` is judged a write,
 * then the refused reads — the watch/poll shapes and a one-shot CI run, job or log read (`./rawGhReadRoute.ts`).
 * No watch shape is also a mutation, so judging the write first changes no watch verdict. A mutation that is a
 * loop's condition stays out of scope as before, rather than being relabelled a log read.
 */
function classifyGhSegment({
  command,
  tokens,
  loopWrapped,
}: {
  command: string;
  tokens: readonly string[];
  loopWrapped: boolean;
}): SegmentClassification | undefined {
  if (isMutatingGh({ command, tokens })) {
    const category = githubWriteCategory(ghGroupSub({ tokens }));
    return loopWrapped ? undefined : { category, reason: "raw gh mutates GitHub outside the door", tool: "gh" };
  }
  return classifyGhRead({ ...ghGroupSub({ tokens }), loopWrapped });
}

/** Classify a non-`gh` segment: `curl`/`wget`, or a destructive/pushing `git` call. */
function classifyNonGhSegment({
  tool,
  tokens,
}: {
  tool: string;
  tokens: readonly string[];
}): SegmentClassification | undefined {
  if (tool === "curl" || tool === "wget") {
    return { category: "external-request", reason: `raw ${tool} bypasses the door for external requests`, tool };
  }
  if (tool === "cmux") {
    return classifyCmuxSegment({ tokens });
  }
  const reaching = REACHING_TOOLS[tool];
  if (reaching !== undefined && tokens.length > 1) {
    // A BARE `gcloud`/`op`/`twilio` with no argument prints its own help and touches nothing — and, measured
    // over the same 14 days, every apparent `twilio`/`aws`/`stripe`/`httpie` "use" was exactly this shape or
    // the word sitting in heredoc prose. Classifying it would make the block's first impression a false
    // positive on a command that did nothing, which is how a gate loses its reader.
    return reachingSegment({ reaching, tokens, tool });
  }
  if (tool === "git" && isDestructiveGit({ tokens })) {
    return {
      category: gitCategory({ tokens }),
      reason: "raw git performs a pushing/destructive operation outside the door",
      tool,
    };
  }
  return undefined;
}

/**
 * Look INSIDE a `sh -c '<command line>'` wrapper, because the wrapper is not the command.
 *
 * Measured: a `bash -c` whose quoted payload was a blocked external-request tool passed. `bash` is not a raw
 * tool, the payload is one quoted argument the splitter deliberately never cuts, and nothing ever read it —
 * so the single most obvious way to spell "run this anyway" was the one shape that worked. The payload is a
 * whole shell line, so it is fed back through the same segment walk rather than token-matched, which is what
 * makes a wrapper around a COMPOUND line resolve too.
 *
 * Bounded by {@link MAX_SHELL_RUNNER_DEPTH}. A wrapper nesting deeper than that is not judged rather than
 * followed forever: this classifier is a workflow safety net, and an unbounded walk over attacker-shaped
 * input is a worse failure than the one it would be closing. The bound is stated so the limit reads as a
 * decision rather than an accident.
 *
 * @param tokens the segment's tokens, env prefix and statement keywords already stripped
 * @param depth how many wrappers have already been opened on the way here
 * @param readScript the script reader handed down to the payload's own segment walk
 * @returns the payload's classification, or undefined when this is not a shell wrapper worth opening
 */
function classifyShellRunner({
  depth,
  tokens,
  readScript,
}: {
  depth: number;
  tokens: readonly string[];
  readScript: ScriptReader | undefined;
}): SegmentClassification | undefined {
  if (depth >= MAX_SHELL_RUNNER_DEPTH || !SHELL_RUNNERS.has(toolName({ first: tokens[0]! }))) {
    return undefined;
  }
  const flag = tokens.indexOf("-c");
  if (flag === -1 || flag + 1 >= tokens.length) {
    return undefined; // an interactive shell, or `-c` with nothing after it
  }
  const payload = unquoteShellPayload({ text: tokens.slice(flag + 1).join(" ") });
  for (const segment of shellSegments({ command: payload })) {
    const classification = classifySegment({ command: segment.command, depth: depth + 1, readScript });
    if (classification !== undefined) {
      return classification;
    }
  }
  return undefined;
}

/**
 * Open the script a segment runs and judge its text — the case `docs/hooks/browser-memory-and-limits.md` used to name as the one this
 * classifier "cannot follow", closed after four `gh`-polling watchers ran through it (`scriptWrapper.ts`'s
 * header carries the measurement). One level only: the script's own text is judged, a script it calls is
 * not. Without a reader (the pure default, and every caller that has no `cwd` to resolve against) nothing is
 * opened and the segment is judged by name as before.
 *
 * `nohup`/`exec`/`time` and a plain `bash <file>` are unwrapped by {@link scriptPathFromTokens}; a `-c`
 * wrapper is {@link classifyShellRunner}'s and never reaches here.
 *
 * @param tokens the segment's tokens, env prefix and statement keywords already stripped
 * @param readScript the reader, or `undefined` to skip scripts entirely
 * @returns the script's classification, or `undefined` when the segment runs no readable reaching script
 */
function classifyScriptWrapper({
  tokens,
  readScript,
}: {
  tokens: readonly string[];
  readScript: ScriptReader | undefined;
}): SegmentClassification | undefined {
  if (readScript === undefined) {
    return undefined;
  }
  const path = scriptPathFromTokens({ tokens });
  if (path === undefined) {
    return undefined;
  }
  const source = readScript({ path });
  if (source === undefined) {
    return undefined;
  }
  const reach = classifyScriptSource({ source });
  if (reach === undefined) {
    return undefined;
  }
  return { category: "script-reach", reason: `\`${path}\` — ${reach.reason}`, tool: reach.tool };
}

/**
 * Classify ONE segment's own command in isolation — never the whole compound command's token stream. This
 * is the fix for the segment-blindness this classifier used to have: `git status && git push` used to
 * resolve `gitSubcommand` from token index 0 of the WHOLE command, so the `push` after `&&` was read as a
 * flag to `status` and never seen as its own operation. Each segment is now tokenized and judged entirely
 * on its own, so a later segment's destructive operation can never hide behind an earlier one's tokens —
 * and, symmetrically, an earlier segment's tokens can never leak into a later one's classification either.
 *
 * @param command one shell segment's own command text (already split by {@link shellSegments})
 * @param readScript the script reader, or `undefined` to judge a script by its name alone
 * @returns the segment's classification, or `undefined` when it is not a recognised raw-bypass shape
 */
function classifySegment({
  command,
  depth = 0,
  readScript,
}: {
  command: string;
  depth?: number;
  readScript: ScriptReader | undefined;
}): SegmentClassification | undefined {
  const rawTokens = stripStatementPrefixes({
    tokens: stripEnvPrefix({
      tokens: command
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    }),
  });
  const first = rawTokens[0];
  if (first === undefined) {
    return undefined; // empty, or only statement keywords — nothing to classify
  }
  const nested = classifyShellRunner({ depth, readScript, tokens: rawTokens });
  if (nested !== undefined) {
    return nested;
  }
  const script = classifyScriptWrapper({ readScript, tokens: rawTokens });
  if (script !== undefined) {
    return script;
  }
  const loopWrapped = LOOP_KEYWORDS.has(first);
  const tokens = loopWrapped ? stripLoopKeyword({ tokens: rawTokens }) : rawTokens;
  const toolToken = tokens[0];
  if (toolToken === undefined) {
    return undefined; // a bare `until`/`while` with nothing after it
  }
  const tool = toolName({ first: toolToken });
  if (tool === "gh") {
    return classifyGhSegment({ command, loopWrapped, tokens });
  }
  // only the `gh pr checks` loop shape is in scope for a loop condition — other loop bodies are out of scope here
  return loopWrapped ? undefined : classifyNonGhSegment({ tokens, tool });
}

/**
 * Classify a shell command as a blocked raw-bypass tool or allowed. `curl`/`wget` (external), mutating
 * `gh`, destructive/pushing `git`, any `cmux` subcommand, and a `gh pr checks --watch`/`gh run watch`/
 * `gh run view --watch`/loop-polled `gh pr checks`, and a raw CI run, job or log read (`gh run view --log`, a
 * `gh api …/actions/jobs/<id>/logs`) are blocked unless overridden; a one-shot `gh pr checks`,
 * a bare `cmux`, and every other read-only or unrecognised command pass.
 *
 * Every segment of a compound command (`&&`/`||`/`|`/`;`/newline-separated) is classified independently
 * ({@link classifySegment}) and, when destructive, checked against its OWN override scope
 * ({@link hasSegmentInlineEnvironmentOverride}) — `allowRaw` covers every segment (it is the process-wide
 * `SLOPWEAVER_ALLOW_RAW=1`), but an inline `SLOPWEAVER_ALLOW_RAW=1 <cmd>` prefix covers only the segment it
 * actually prefixes. The first destructive segment that is NOT covered by either blocks the whole command;
 * a destructive segment that IS covered is skipped and the walk continues, so an override on one segment
 * can never wave through a different, uncovered dangerous segment elsewhere in the same command.
 *
 * A segment that runs a SCRIPT (`./x.sh`, `bash scripts/x.sh`, `nohup ./x.sh`) is judged by the script's own
 * text when `readScript` is given — any `gh`, `curl`/`wget` or `git push` inside it is a reach — and by name
 * alone when it is not ({@link classifyScriptWrapper}).
 *
 * The `production-cli` category is the ONE exception to `allowRaw` covering everything, and it is the whole
 * of the reaching-tool design: `twilio`, `stripe`, `vercel`, `heroku`, `supabase`, `fly` and
 * `netlify` reach systems whose mistakes are visible to a real person, so they are waived only by a live
 * {@link reachGranted} grant — journalled, tool-scoped and expiring — never by the ambient variable. The
 * reasoning is the owner's own ruling on the depth block and is written out in `./reachGrant.ts`. Without a
 * `reachGranted` reader (the pure default) no grant is ever found, so the class simply refuses, which is
 * the safe direction for a caller that has no session to check against.
 *
 * @param command the raw shell command line
 * @param allowRaw whether `SLOPWEAVER_ALLOW_RAW=1` is set process-wide (the break-glass)
 * @param readScript a reader for scripts the command runs, already bound to the call's own `cwd`; omit to
 *   leave scripts unopened
 * @param reachGranted the grant state for one production-facing tool — whether a live, journalled grant
 *   opens it for this session, and how many this session has taken for it (which the refusal quotes back so
 *   a repeat is visible). Already bound to the session id and the clock; omit to find no grants at all
 * @returns the verdict
 */
export function classifyRawCommand({
  command,
  allowRaw,
  readScript,
  reachGranted,
}: {
  command: string;
  allowRaw: boolean;
  readScript?: ScriptReader;
  reachGranted?: (options: { tool: string }) => { granted: boolean; grantsTaken: number };
}): RawVerdict {
  let overriddenTool: string | undefined;
  for (const [segmentIndex, segment] of shellSegments({ command }).entries()) {
    const classification = classifySegment({ command: segment.command, readScript });
    if (classification === undefined) {
      continue;
    }
    if (classification.category === "production-cli") {
      const grant = reachGranted?.({ tool: classification.tool });
      if (grant?.granted === true) {
        overriddenTool = classification.tool;
        continue; // granted — this grant covers this tool only, so the walk goes on
      }
      return {
        blocked: true,
        message: reachGrantRefusal({ grantsTaken: grant?.grantsTaken ?? 0, tool: classification.tool }),
        reason: classification.reason,
        tool: classification.tool,
      };
    }
    const covered = allowRaw || hasSegmentInlineEnvironmentOverride({ command, name: RAW_OVERRIDE_ENV, segmentIndex });
    if (!covered) {
      return {
        blocked: true,
        message: `Slopweaver blocks raw side effects by default: ${classification.reason}. Route it through ${routeHint({ category: classification.category })}, or set ${RAW_ESCAPE} for this one run.`,
        reason: classification.reason,
        tool: classification.tool,
      };
    }
    overriddenTool = classification.tool; // covered — keep walking, this override does not extend past this segment
  }
  return overriddenTool === undefined ? { blocked: false } : { blocked: false, tool: overriddenTool };
}
