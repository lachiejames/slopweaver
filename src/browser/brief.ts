/**
 * The brief: what a verb tells the VISIBLE session to do in the owner's own Chrome, and what to hand back
 * so the verb can judge it.
 *
 * ## Why a brief exists at all
 *
 * The owner's real work Chrome is the only browser anything here uses (`docs/browser-route.md`). That is not
 * a swap of one launcher for another — it removes the CLI's ability to LAUNCH a
 * browser at all, and the removal is mechanical rather than editorial. Desktop Google Chrome 136 and later
 * ignore `--remote-debugging-port` on the default user-data directory, which is the only way the owner runs
 * it, so no launch flag can open a localhost CDP endpoint on the owner's real profile. The one CDP route into it is
 * the extension relay (`src/devLint/noPrivateBrowserProfile.ts`), which the visible session drives.
 *
 * That is Chrome's own documented behaviour, not a measurement here: "Changes to remote debugging switches
 * to improve security", https://developer.chrome.com/blog/remote-debugging-port — "from
 * Chrome 136 … these switches will no longer be respected if attempting to debug the default Chrome data
 * directory". Chrome for Testing is exempt. Repro on macOS: quit Chrome itself with Cmd-Q, not just its
 * windows (a running Chrome absorbs the launch), and check both `pgrep -x Google\ Chrome` and
 * `lsof -i :9222` print nothing — before each of the two launches below; run
 * `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 &`, wait for
 * its window, and `curl -sS --max-time 5 localhost:9222/json/version` fails to connect; quit it, relaunch
 * with `--user-data-dir=$(mktemp -d)` added, and the same `curl` prints the version JSON. That control shows the
 * binary, the port and policy all allow a debugging endpoint, though it proves nothing about the instant of
 * the first launch; it is the only half run here
 * (`docs/browser-route/proof-and-capture-verbs.md`).
 *
 * So a verb that needs a rendered page does what doctrine rule 2 already makes every tier-3 verb do: it
 * gathers what it can, **writes a brief**, and validates what the visible session brought back. The
 * judgement — the seven-day window proof, the cell-line budget, the capture grade — stays in the CLI, where
 * it is pure, tested and impossible to skip. Only the driving moved.
 *
 * ## Every step names a `slopweaver browser` verb, and the TYPE is what makes that true
 *
 * Claude in Chrome is RETIRED, and `src/admit/chromeRetirement.ts` refuses
 * every `mcp__claude-in-chrome__*` call categorically, reads included, ahead of either break-glass. A step
 * written as a Claude-in-Chrome tool name — `computer (screenshot)`,
 * `javascript_tool`, `navigate`, `read_network_requests` — would print
 * an instruction the door refuses outright. A session doing as it was told hits a refusal; a session reading
 * the step and giving up reports the leg BLOCKED, which is a failure of the same kind as the stale seam
 * description below.
 *
 * {@link BriefVerb} is therefore a CLOSED union of the verbs that exist, so `tsc` refuses a retired tool
 * name at the line that writes it. A `src/devLint/` gate was considered and rejected: a step carries the
 * BARE tool name, so the PREFIX test `chromeRetirement.ts` relies on is unavailable and a gate would have
 * to match names — the allowlist shape that same file exists to avoid, and one that would have missed
 * `navigate` and `read_network_requests` for being undistinctive. The compiler needs no marker.
 *
 * ## `no-verb-yet` is an arm that COSTS something
 *
 * A closed union with no escape would push an author back to prose. So there is one arm for a step no verb
 * covers — and it requires {@link BriefGapStep.wouldClose}, naming the declared operation or adapter that
 * would remove it, which `renderBrief` prints. The real gaps that ride it are `datadog shot explorer`'s
 * seeded read-back (`readExplorerView`), `notion verify`'s observation script, and the Slack walk's network
 * read. Each is a named, greppable gap rather than a dead end — and closing one is a declared relay arm, the
 * way `datadogMonitorBacktestSnippet.ts` closed the monitor backtest's.
 *
 * **Why a declared operation rather than a `browser eval`.** `src/browser/datadogConsole.ts` states the
 * rule: a caller chooses a declared OPERATION, never code. `relaySession.ts` runs those operations —
 * `datadogConsoleSnippet.ts`, `notionSettingsSnippet.ts`, `vantaPolicyEditorSnippet.ts` — and `aim.ts`,
 * `aimShot.ts` and `scrollWalk.ts` run `eval` through the terminal client for their own fixed probes. What
 * is deliberately absent is a CLI route that runs a caller's script, so a `wouldClose` naming one would be
 * proposing a new capability rather than a rename.
 *
 * ## What is still true of the narrow seam
 *
 * The extension is NOT the one route into that browser, reachable only from an agent session's tools:
 * `browser/playwrightCli.ts` drives it from a Node process. Describing it as the only route has a measured
 * cost: sessions reported a screenshot leg BLOCKED because `list_connected_browsers` returned `[]`, with the
 * relay attached and filing PNGs the whole time, and the owner's own reaction was that slopweaver playwright
 * serves everything now instead of Claude in Chrome.
 *
 * Nor is the relay's whole call set `goto`, settle, `screenshot`, `title`, `url` with every step that
 * clicks or types belonging to the session. That is a property of ONE seam — `./pageTransport.ts`'s
 * `BrowserPageTransport`, which excludes an evaluate-this-script escape hatch on purpose, and on whose
 * narrowness every atlas walk's safety argument rests. It is not a property of the lane:
 * `slopweaver browser open | read | aim | act | scroll | shot | close` click, fill, type, select, check,
 * hover, press, scroll, drag, upload, download and navigate, each photographing its own result. A brief
 * emitted for a step one of those verbs takes is a defect rather than a style choice.
 *
 * ## What a brief is not
 *
 * It is not a licence. Every step it names runs through a `slopweaver browser` verb, and those verbs apply
 * the write-policy register (`src/admit/browserSurface.ts`) and the per-page read-only rail exactly as for
 * any other call, because the rails are about a missed click posting under the owner's name — a Slack incident's failure.
 * A brief carries no grant of its own: the Claude-in-Chrome door that once honoured a brief's page grant is
 * retired, and its grant log is gone.
 */

/**
 * Every verb a brief step may name — the interaction surface `skills/browser/SKILL.md` documents.
 *
 * Closed on purpose, and exported so a test can assert the set rather than restate it.
 */
export const BRIEF_VERBS = [
  "slopweaver browser open",
  "slopweaver browser read",
  "slopweaver browser aim",
  "slopweaver browser act",
  "slopweaver browser scroll",
  "slopweaver browser shot",
  "slopweaver browser close",
] as const;

/** One `slopweaver browser` verb, as a step names it.
 * @internal — a field type of {@link BriefVerbStep}.
 */
export type BriefVerb = (typeof BRIEF_VERBS)[number];

/** The `tool` value of a step no verb covers yet. */
export const BRIEF_NO_VERB = "no-verb-yet";

/** How {@link BRIEF_NO_VERB} reads once rendered, so a reader sees a gap rather than a tool name. */
export const BRIEF_NO_VERB_LABEL = "(no slopweaver verb yet)";

/** A step one of the browser verbs takes.
 * @internal — an arm of {@link BriefStep}.
 */
export interface BriefVerbStep {
  readonly tool: BriefVerb;
  /** What to do with it, in the imperative. */
  readonly what: string;
}

/** A step no verb covers, which must say what would close it. */
export interface BriefGapStep {
  readonly tool: typeof BRIEF_NO_VERB;
  /** What to do, in the imperative — still the session's to drive by hand. */
  readonly what: string;
  /** The declared operation or adapter that would remove this step. Never empty. */
  readonly wouldClose: string;
  /** The exact source that operation would run, when one has already been written and measured. */
  readonly script?: string;
}

/** One step the visible session performs in the owner's Chrome. */
type BriefStep = BriefVerbStep | BriefGapStep;

/** One lane's whole instruction: open this, do these, then run that verb over what came back. */
export interface ExtensionBrief {
  /** The lane's name, as its verb spells it. */
  readonly lane: string;
  /** Where to go. */
  readonly url: string;
  readonly steps: readonly BriefStep[];
  /** The `slopweaver` invocation that judges what the session hands back. */
  readonly finish: string;
}

/**
 * Render a brief for a reader, one instruction per line.
 *
 * A gap step prints what would close it, because a step with no verb behind it is the one thing in a brief
 * a reader might otherwise mistake for an oversight. A `script` is printed under its step rather than
 * inline, because it is the one part a session copies verbatim and a wrapped script is a script that gets
 * retyped wrong.
 *
 * @param brief the lane's instruction
 * @returns the lines to print
 */
export function renderBrief({ brief }: { brief: ExtensionBrief }): readonly string[] {
  const lines: string[] = [
    `${brief.lane}: this needs a rendered page, so it runs in YOUR Chrome through the slopweaver browser verbs.`,
    `open: ${brief.url}`,
  ];
  for (const [index, step] of brief.steps.entries()) {
    lines.push(...stepLines({ index, step }));
  }
  lines.push(`then: ${brief.finish}`);
  return lines;
}

/** The lines for one step: its number, its verb or its gap label, and what a gap step still owes. */
function stepLines({ index, step }: { index: number; step: BriefStep }): readonly string[] {
  const ordinal = String(index + 1);
  if (step.tool !== BRIEF_NO_VERB) {
    return [`  ${ordinal}. ${step.tool} — ${step.what}`];
  }
  const lines = [`  ${ordinal}. ${BRIEF_NO_VERB_LABEL} — ${step.what}`, `     what would close it: ${step.wouldClose}`];
  if (step.script !== undefined) {
    lines.push(`     script: ${step.script}`);
  }
  return lines;
}
