/**
 * The `gh` READS the raw-command classifier refuses, and where each is pointed — the read half of
 * `./rawTools.ts`'s `gh` routing, split out along the same seam as `./rawGhWriteRoute.ts`: the classifier walks
 * segments and judges a write, this module recognises the two read families.
 *
 * **The polling shapes** — `gh pr checks --watch`, `gh run watch`, `gh run view --watch`, and an `until`/`while`
 * loop hand-polling `gh pr checks` — all reimplement `slopweaver github checks --wait`'s own stepped-backoff
 * polling, badly: a fixed short interval not tuned to this repository's CI, and every poll's raw output landing
 * in the caller's own transcript. A ONE-SHOT `gh pr checks <n>` (no loop, no `--watch`) stays a legitimate read.
 *
 * **The one-shot CI log reads** — `gh run view --log|--log-failed` and a `gh api` fetch of an Actions run, its
 * jobs, one job or a log. A job log is data-sized (MEASURED 3,213,680 bytes for one `unit` job,
 * `skills/github/reference/job-logs.md`), so the raw read lands the whole thing tail-first, with the `##[error]`
 * annotations hundreds of lines above where a reader stops; `github run-log` and `github checks --log` print the
 * annotations first and a bounded tail. Before this the classifier refused only the polling shapes, so the
 * one-shot read was the open path past the door. Narrow on purpose: a plain `gh run view <id>` and every other
 * Actions endpoint (artifacts, workflows, a run list) still pass — no doored verb replaces them.
 *
 * Residue, stated rather than discovered: a shell-quoted group or subcommand (`gh 'api' …`, `gh run 'view' …`)
 * is not recognised, found by a Codex review. It is the classifier's, not this module's — `./rawTools.ts`'s
 * `ghGroupSub` resolves every `gh` shape from raw tokens, so `gh 'pr' close` passes on `main` the same way, and
 * closing it is a change to every `gh` verdict at once rather than to this one read. And `run view`'s log flag
 * is looked for in every word, so a flag VALUE that is exactly `--log` (`--jq '--log'`) refuses a summary read:
 * the safe direction, and a value nobody writes by accident.
 */
import type { RouteCategory } from "./rawToolsRoute.js";

/** `gh run view` flags that print a job log rather than the run summary. */
const RUN_VIEW_LOG_FLAGS: ReadonlySet<string> = new Set(["--log", "--log-failed"]);

/** The API host a `gh api` endpoint may be spelled with in full, as `https://<host>/…`. */
const API_HOSTNAME = "api.github.com";

/**
 * Whether the segments after `actions/` name one run, one job, or a log under either: `runs/<id>`, its `/jobs`
 * or `/logs`, the same under `/attempts/<n>`, and `jobs/<id>` or its `/logs`. Segment-wise rather than one
 * regular expression, because the single pattern this replaces backtracked polynomially (`redos-check`).
 */
function isRunOrJobTail({ tail }: { tail: readonly string[] }): boolean {
  const [kind, , third, , fifth] = tail;
  if (kind === "jobs") {
    return tail.length === 2 || (tail.length === 3 && third === "logs");
  }
  if (kind !== "runs") {
    return false;
  }
  const attempt = third === "attempts";
  return (
    tail.length === 2 ||
    (tail.length === 3 && (third === "jobs" || third === "logs")) ||
    (attempt && tail.length === 4) ||
    (attempt && tail.length === 5 && (fifth === "jobs" || fifth === "logs"))
  );
}

/**
 * Whether a `gh api` endpoint is a REST path naming one Actions run, one job, or a log under either (see
 * {@link isRunOrJobTail}), optionally host-prefixed, with one leading and one trailing slash and a query string
 * tolerated. An `{owner}`/`$VAR` segment is any non-empty segment, so a placeholder or a variable matches as the
 * literal would. The FIRST `?` ends the path, as it does on the wire: `repos/a?x/b/actions/runs/1` is a request
 * for `repos/a`, so it passes, where the regex this replaces let a segment swallow the `?` and refused it.
 */
function isRunOrJobPath({ endpoint }: { endpoint: string }): boolean {
  // `split` always returns at least one element, so `[0]` is the path before any query string.
  let segments = endpoint.split("?")[0]!.split("/");
  // The host is compared as a whole SEGMENT, never as a string prefix, so `https://api.github.com.evil/…` is
  // not read as the API host (CodeQL `js/incomplete-url-substring-sanitization`).
  const [scheme, empty, host] = segments;
  if (scheme === "https:" && empty === "" && host === API_HOSTNAME) {
    segments = segments.slice(3);
  }
  segments = segments[0] === "" ? segments.slice(1) : segments;
  segments = segments.at(-1) === "" ? segments.slice(0, -1) : segments;
  // `repos/<owner>/<repo>/actions/…`: every segment non-empty, so an owner or repo placeholder is never blank.
  const [root, , , actions, ...tail] = segments;
  const wellFormed = segments.every((segment) => segment.length > 0);
  return wellFormed && root === "repos" && actions === "actions" && isRunOrJobTail({ tail });
}

/** `gh api` flags that consume the next word as their value, so that word is never the endpoint. */
const API_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "-X",
  "--method",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "--input",
  "--hostname",
  "--cache",
  "-p",
  "--preview",
]);

/**
 * Re-join whitespace-split tokens into the words a shell would hand over: unquoted whitespace splits, a quoted
 * run (`'…'`, `"…"`) does not, nor does a backslash-escaped character (`X-Test:\ …`), and the quote characters
 * and escaping backslashes are dropped. Near enough to find an
 * endpoint; `./argumentValue.ts` owns the exact reading of one word.
 */
function shellWords({ tokens }: { tokens: readonly string[] }): readonly string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | undefined;
  let escaped = false;
  for (const ch of tokens.join(" ")) {
    if (escaped) {
      word += ch; // `\ ` is a literal space inside the word, never a split
      escaped = false;
    } else if (ch === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote === undefined && /\s/u.test(ch)) {
      words.push(word);
      word = "";
    } else if (ch === quote) {
      quote = undefined;
    } else if (quote === undefined && (ch === "'" || ch === '"')) {
      quote = ch;
    } else {
      word += ch;
    }
  }
  return [...words, word].filter((w) => w.length > 0);
}

/**
 * The endpoint a `gh api` call fetches: its first positional word, skipping every flag and the value a
 * {@link API_VALUE_FLAGS} flag consumes — so a `-H 'Accept: …'` or a `--jq '"repos/…/actions/runs/1"'` value is
 * never mistaken for it. A Codex review found the second shape blocked an ordinary pull fetch when every word
 * was scanned instead.
 */
function apiEndpoint({ rest }: { rest: readonly string[] }): string | undefined {
  const words = shellWords({ tokens: rest.slice(rest.indexOf("api") + 1) });
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!; // i < words.length ⇒ in-bounds
    if (API_VALUE_FLAGS.has(word)) {
      i += 1;
    } else if (!word.startsWith("-")) {
      return word;
    }
  }
  return undefined;
}

/** One refused `gh` read: the route category its hint is keyed on, and the reason line. */
interface GhReadClassification {
  readonly category: RouteCategory;
  readonly reason: string;
  readonly tool: "gh";
}

/**
 * Whether `gh` tokens read a CI run, job or log outside the door: `gh run view … --log|--log-failed` (the `=`
 * form too), or a `gh api` whose endpoint ({@link apiEndpoint}) is one {@link isRunOrJobPath} accepts. The method
 * is not read: a
 * mutating `gh api` against the same paths (`-X DELETE …/logs`) is the caller's to judge FIRST, as a write.
 */
function isRawRunLogRead({
  group,
  sub,
  rest,
}: {
  group: string | undefined;
  sub: string | undefined;
  rest: readonly string[];
}): boolean {
  if (group === "run" && sub === "view") {
    // `split` always returns at least one element, so `[0]` is the whole token when it has no `=`.
    return shellWords({ tokens: rest }).some((word) => RUN_VIEW_LOG_FLAGS.has(word.split("=")[0]!));
  }
  const endpoint = group === "api" ? apiEndpoint({ rest }) : undefined;
  return endpoint !== undefined && isRunOrJobPath({ endpoint });
}

/**
 * Classify a non-mutating `gh` call as one of the refused reads: a watch/poll shape (pointed at `github checks
 * --wait`, or honestly at no verb for a run-id watch) or a one-shot CI run, job or log read (pointed at
 * `github run-log`/`github checks --log`). Everything else is an ordinary read and returns `undefined`.
 *
 * @param group the first non-flag token after `gh`, such as `run` or `api`
 * @param sub the second non-flag token, such as `view`
 * @param rest every token after `gh`, flags included
 * @param loopWrapped whether this segment is the condition of an `until`/`while` loop
 * @returns the refusal's category and reason, or `undefined` when the read is not one of the refused shapes
 */
export function classifyGhRead({
  group,
  sub,
  rest,
  loopWrapped,
}: {
  group: string | undefined;
  sub: string | undefined;
  rest: readonly string[];
  loopWrapped: boolean;
}): GhReadClassification | undefined {
  const hasWatchFlag = rest.some((t) => t === "--watch" || t.startsWith("--watch="));
  if (group === "pr" && sub === "checks" && (hasWatchFlag || loopWrapped)) {
    const reason = loopWrapped
      ? "a hand-rolled polling loop around `gh pr checks` reimplements the door's own checks verb, badly"
      : "`gh pr checks --watch` reimplements the door's own checks verb, flooding the transcript with raw output on every poll";
    return { category: "governed-read-watch", reason, tool: "gh" };
  }
  if (group === "run" && (sub === "watch" || (sub === "view" && hasWatchFlag))) {
    const reason = `\`gh run ${sub === "watch" ? "watch" : "view --watch"}\` polls a workflow run outside the door`;
    return { category: "ungoverned-read-watch", reason, tool: "gh" };
  }
  if (isRawRunLogRead({ group, rest, sub })) {
    const reason = "raw gh reads a CI run, job or log outside the door, landing a data-sized log tail-first";
    return { category: "governed-read-run-log", reason, tool: "gh" };
  }
  return undefined;
}
