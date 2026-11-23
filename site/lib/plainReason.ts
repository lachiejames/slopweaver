/**
 * Why a read failed, as one plain line the owner can read, and the raw message it was told from, kept for a fold. Pure.
 *
 * A warning's hover shows plain English, concise and accurate, never a raw stack trace. Every console failure mark
 * funnels through `./stalenessLabel.ts`, so this is where a reason becomes words, once, for every page.
 *
 * **Accurate before helpful, so it reads only shapes it knows.** No model is asked (AGENTS.md rule 2): a reason is
 * matched against the console's OWN transport sentences (`./spawnVerb.ts`'s `closedReason` and timeout,
 * `../components/live/useLiveWire.ts`'s), then against a status or `errno` code written the one way a record writes
 * it, and the console's own missing-token line. Anything else is said honestly as a technical error, never guessed at
 * and never lifted as itself, because a runtime's own messages read as English too; its raw message is always kept for
 * the fold.
 *
 * This is the console's own reading of a reason. An automation firing that a visible session explained leads with
 * that session's sentence instead (`slopweaver automation explain`), and this reading stands only where none did.
 *
 * Imports nothing, for the reason `./liveRetained.ts` gives.
 */

/** One reason, said plainly, and what it was told from when that differs. */
export interface PlainReason {
  /** One or two short sentences, each ending in a full stop. */
  readonly plain: string;
  /** The reason exactly as it arrived, for the fold; absent when the line is one of Slopweaver's own sentences. */
  readonly raw: string | undefined;
}

/** A failure a record names by its shape, and its sentence. */
interface ShapedReason {
  readonly code: RegExp;
  readonly plain: string;
}

/**
 * A class of failure a record names by code, its sentence, and the status phrase words that may stand beside only
 * THIS class's code: `HTTP 401 Too Many Requests` names two causes, so the rate-limit words never settle a 401.
 */
interface CodedReason extends ShapedReason {
  readonly phrase: ReadonlySet<string>;
}

/**
 * Every code read, most specific first. A status counts only written AS a status, with at least one separator between
 * the word and the number, so a pull request numbered 429 is never read as a rate limit, nor `statusCode401` or
 * `HTTP401` inside an identifier as a refused sign-in. No sentence promises a retry, a recovery or
 * a remedy, nor names who is at fault: the same line is drawn under a one-shot tool call, a Queue press and the
 * updater, none of which retries, and a code says what happened, never what would fix it.
 */
const CODED_REASONS: readonly CodedReason[] = [
  {
    code: /\b(?:invalid_auth|not_authed|token_revoked|token_expired|invalid_grant|account_inactive)\b|\b(?:HTTP|status(?:Code)?)\W{1,3}401\b|\b401 Unauthorized\b/iu,
    phrase: new Set(["unauthorized"]),
    plain: "The service turned down its sign-in.",
  },
  {
    code: /\b(?:missing_scope|insufficient_scope|not_allowed_token_type)\b|\b(?:HTTP|status(?:Code)?)\W{1,3}403\b|\b403 Forbidden\b/iu,
    phrase: new Set(["forbidden"]),
    plain: "The service refused it permission.",
  },
  {
    code: /\b(?:ratelimited|rate_limited)\b|\b(?:HTTP|status(?:Code)?)\W{1,3}429\b|\b429 Too Many Requests\b/iu,
    phrase: new Set(["many", "requests", "too"]),
    plain: "The service turned it away because too many requests came in at once.",
  },
  {
    code: /\b(?:HTTP|status(?:Code)?)\W{1,3}5\d\d\b|\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/iu,
    phrase: new Set(["bad", "gateway", "internal", "server", "timeout", "unavailable"]),
    plain: "The service hit an error and could not answer.",
  },
  {
    code: /\b(?:ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b/u,
    phrase: new Set(),
    plain: "It could not reach a service over the network.",
  },
  {
    // A reset arrives on a connection that was already open, so it never says the service was not reached.
    code: /\bECONNRESET\b/u,
    phrase: new Set(),
    // Names no actor: the socket's other end can be a local process as well as a service.
    plain: "A connection was cut off.",
  },
  {
    code: /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/u,
    phrase: new Set(),
    // Names no actor: Node also sets it on a local child or a raced task that overran its bound.
    plain: "It timed out.",
  },
  {
    code: /\bENOSPC\b/u,
    phrase: new Set(),
    // Names no device: Linux also answers it for an exhausted inotify watch limit, not only a full disk.
    plain: "It ran out of space.",
  },
];

/**
 * The console's own transport sentences, each said as what happened and none promising a retry: a sentence is chosen by
 * the text alone, and the same text can reach a one-shot surface (an automation firing that printed it), so a retry
 * is the poll's own line to say, never this table's. A signal names no cause, so none says one.
 */
const TRANSPORT_REASONS: readonly ShapedReason[] = [
  {
    // `useLiveWire.ts` appends this to a thrown fetch AND a 5xx whose body was not a reading, so it says only that no
    // readable answer came, never that the server sent none. What it appends to (a fetch's own message, or
    // `<url> answered 503 with …`) is named whole: a fetch's own message, or `useLiveFetch.ts`'s line for a live route, so
    // a record quoting the marker after anything else proves nothing.
    code: /^(?:fetch failed|Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.|\/api\/live\/[^\s:]+ answered \d{3} with something that is not a LiveResult) \(the console server did not answer; reading again\)$/u,
    plain: "The console's own server gave no answer this page could read.",
  },
  {
    // `spawnVerb.ts`'s own wait, its title `slopweaver <argv>` with no `:`, so a quoted line ("The test expected: hand
    // list did not answer within 30s") proves no timeout. Only that no answer came in time: a check that
    // merely gave up waiting stopped nothing.
    code: /^slopweaver [^:\n]+? did not answer within \d+(?:\.\d+)?s$/u,
    plain: "It did not answer in time.",
  },
  {
    // `spawnVerb.ts`'s whole grammar, `<title> <how>` then an optional `: <stderr tail>`, as the entry below. Every
    // title it is given is `slopweaver <argv>`, so that opening is the provenance an outside sentence cannot share.
    code: /^slopweaver [^:\n]+? was killed by SIG[A-Z0-9]+ before it answered(?:: .*)?$/u,
    plain: "It was stopped before it answered.",
  },
  {
    code: /^slopweaver [^:\n]+? ended with neither an exit code nor a signal(?:: .*)?$/u,
    plain: "It stopped without saying how.",
  },
  {
    // Anchored to the console's own producers' whole grammar (`briefingRead.ts`, `cardMailVerb.ts`,
    // `slackConnection.ts`, `talkPlanProtocol.ts`): a provider's "response is not JSON: HTTP 502" is not a Slopweaver
    // bug, so a bare "is not JSON" never reads as one. The shape line opens on a tile's one-word
    // slug (`useLiveWire.ts`), the JSON line on a command title opening on the program it ran (`slopweaver`, `talk`,
    // `codex`, `docker`), so "The test expected queue printed …" proves nothing.
    code: /^(?:[a-z0-9][a-z0-9-]* answered in a shape this tile does not read|(?:slopweaver|talk|codex|docker)(?: [^\s:]+)* printed something that is not JSON(?:, beginning `.*`)?)$/u,
    plain: "It answered in a form this page cannot read.",
  },
];

/** Every status written AS a status, so two different ones in one reason can be told apart. */
const STATUS_WRITTEN = /\b(?:HTTP|status(?:Code)?)\W{1,3}(\d{3})\b/giu;

/**
 * Any word that can set a code up as NOT what happened: "expected 401", "not a 403", "was not rate_limited". Found
 * anywhere, it leaves the cause unsettled, because which code it negates is not something a pattern can tell
 * and "No HTTP 401 was returned". A code's own `not_authed` is one word, so it never
 * matches. A match only ever moves a reason to the technical-error sentence, never to a cause.
 */
const NEGATION =
  /\b(?:expected|not|no|none|never|neither|nor|without|instead of|rather than|isn't|wasn't|aren't|weren't|didn't|doesn't)\b/iu;

/**
 * Node's own wording beside an errno the table reads, which carries a negation word while negating nothing: `ENOSPC: no
 * space left on device`. Struck out before {@link NEGATION} is tested, and only when its own code is beside it.
 */
const ERRNO_OWN_WORDS = /\bENOSPC: no space left on device\b/gu;

/**
 * The only words a reason's innermost clause may carry beside ANY code for that code to be the cause: a transport's
 * own glue (`getaddrinfo`, `connect`), an HTTP method and a provider body's `ok`/`false`/`error` keys. A status's own
 * phrase (`Unauthorized`) is its class's {@link CodedReason.phrase}, never shared. Any other word may be the real
 * failure with the code as context — `Cleanup after HTTP 401 failed: EACCES writing cache` failed at the cache, not the
 * sign-in — so it leaves the cause unsettled. A host, an address or a path is no word; a number is
 * none either.
 */
const SHAPE_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "code",
  "connect",
  "delete",
  "err",
  "error",
  "fail",
  "failed",
  "false",
  "fetch",
  "get",
  "getaddrinfo",
  "http",
  "https",
  "ok",
  "open",
  "patch",
  "post",
  "put",
  "read",
  "request",
  "response",
  "service",
  "status",
  "statuscode",
  "the",
  "with",
  "write",
]);

/**
 * A host or an address with an optional port (`api.example.com`, `10.0.0.1:443`), a path (`/tmp/x`) or a URL
 * (`https://api.example.com/v1/x`).
 */
const LOCATOR = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?|\.{0,2}\/\S*|[a-z][a-z0-9+.-]*:\/\/\S+)$/u;

/**
 * The words an OUTER link of a chain may carry for its innermost code to still be the cause: a call naming the
 * service it reached and what it did there (`slack api error`, `linear read`, `github search failed`). A link saying
 * anything else may be where the failure really was, with the code quoted as data — `Parser rejected documentation
 * example: HTTP 401 Unauthorized` refused no sign-in — so it leaves the cause unsettled.
 */
const CALL_WORDS: ReadonlySet<string> = new Set([
  "api",
  "auth",
  "call",
  "github",
  "linear",
  "list",
  "notion",
  "oauth",
  "query",
  "refresh",
  "search",
  "send",
  "slack",
  "sync",
  "token",
  "upload",
]);

/**
 * A reason's `outer: inner` chain, as a runtime writes it: its first line, Node's own errno wording collapsed to its
 * code, split at each link. The innermost cause sits in the last link.
 */
function chainOf({ text }: { text: string }): { readonly outer: readonly string[]; readonly inner: string } {
  const firstLine = text.replace(ERRNO_OWN_WORDS, "ENOSPC").split("\n")[0];
  const links = firstLine.split(": ");
  return { inner: links[links.length - 1], outer: links.slice(0, -1) };
}

/**
 * A clause's tokens, each trimmed of surrounding punctuation, with every host, address, path and URL dropped. A letter
 * in any script is kept, never trimmed as punctuation, so a word in another language still counts as a word.
 */
function bareTokensOf({ clause }: { clause: string }): readonly string[] {
  return clause
    .split(/\s+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}_/]+|[^\p{L}\p{N}_/]+$/gu, ""))
    .filter((token) => token !== "" && !LOCATOR.test(token));
}

/**
 * A clause's words, in any script, its hosts, addresses, paths and numbers dropped. Every word outside
 * {@link SHAPE_WORDS} unsettles a cause, so a reason in another language (`Ожидалось HTTP 401`, "HTTP 401 was
 * expected") never reads as a refused sign-in.
 *
 * What this heuristic does NOT close, by construction: an English reason whose only extra words happen to be
 * {@link SHAPE_WORDS} yet still mean something other than the code (no such sentence has been seen from a producer).
 * What would close it is a producer filing the cause as a typed field rather than inside its message; until then the
 * raw message always sits folded under the plain line, so a wrong plain line is visible beside its source.
 */
function wordsOf({ clause }: { clause: string }): readonly string[] {
  return bareTokensOf({ clause }).flatMap((token) =>
    [...token.matchAll(/\p{L}[\p{L}_]*/gu)].map((found) => found[0].toLowerCase()),
  );
}

/** What may sit directly before a code standing on its own: the clause's start, a space, a quote, an opener or `:`/`=`/`,`. */
const STANDS_AFTER = /[\s"'({[,:=]/u;

/** What may sit directly after one: the clause's end, a space, a quote, a closer or sentence punctuation. */
const STANDS_BEFORE = /[\s"')}\],.;:!?]/u;

/**
 * Whether every place a code matches in a clause stands on its own, rather than inside a path, an identifier or a URL:
 * `/tmp/invalid_auth` and `/cache/HTTP 401` name a file, not a refused sign-in.
 */
function standsAlone({ code, clause }: { code: RegExp; clause: string }): boolean {
  return [...clause.matchAll(new RegExp(code.source, `${code.flags}g`))].every((found) => {
    const before = clause.slice(0, found.index).slice(-1);
    const after = clause.slice(found.index + found[0].length, found.index + found[0].length + 1);
    return (before === "" || STANDS_AFTER.test(before)) && (after === "" || STANDS_BEFORE.test(after));
  });
}

/**
 * Whether a cause's code is the WHOLE of a reason's innermost clause: the code is in it, standing on its own, and every
 * other word in it is one of {@link SHAPE_WORDS} or the class's own status phrase, and every link above it names the call
 * in words ({@link CALL_WORDS}), never with a locator alone. A code beside any other word is context, never the cause.
 */
function codeIsTheClause({ entry, text }: { entry: CodedReason; text: string }): boolean {
  const { code, phrase } = entry;
  const { inner, outer } = chainOf({ text });
  // A code inside a locator (`?error=invalid_auth` in a URL) is data the call carried, never its answer.
  const bare = bareTokensOf({ clause: inner });
  const spoken = bare.join(" ");
  // And a clause holding a URL or a path settles nothing, so a value spaced off its `=` (`?error= invalid_auth`) is
  // still data the call carried. A bare address (`10.0.0.1:443`) is Node's own errno wording, so it stays.
  const carriesUrlOrPath = inner.split(/\s+/u).some((token) => /[/?=]/u.test(token));
  if (carriesUrlOrPath || !code.test(inner) || !code.test(spoken) || !standsAlone({ clause: inner, code })) {
    return false;
  }
  const struck = inner.replace(new RegExp(code.source, `${code.flags}g`), " ");
  const innerSettles = wordsOf({ clause: struck }).every((word) => SHAPE_WORDS.has(word) || phrase.has(word));
  // A link that is only a locator (`README.md`, `/docs/example`, a bare URL) names no call, so it settles nothing: a
  // file or page can hold a status as data.
  const outerWords = outer.map((link) => wordsOf({ clause: link }));
  const outerNamesTheCall = outerWords.every(
    (words) => words.length > 0 && words.every((word) => SHAPE_WORDS.has(word) || CALL_WORDS.has(word)),
  );
  return innerSettles && outerNamesTheCall;
}

/**
 * `slopweaver <argv> exited N: tail` — `./spawnVerb.ts`'s `closedReason` for a child that exited on its own with an
 * error, or the sync-run store's same line with its command in backticks. Its title always opens `slopweaver` and holds
 * no `:`, so an outside sentence that merely says something `exited 1` (`The provider said worker exited 1: HTTP 429`)
 * is never stripped down to its tail.
 */
// Bare or in one matched pair of backticks, never half a pair: an unmatched one is neither producer's. Never
// exit 0, which is a success no producer wraps as a failure.
const EXITED = /^(`?)(slopweaver [^:`\n]+?)\1 exited (-?[1-9]\d*)(?:: (.*))?$/su;

/** A sentence opened in capitals and closed by a full stop. */
function sentenceOf({ text }: { text: string }): string {
  const opened = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  if (/[.!?]$/u.test(opened)) {
    return opened;
  }
  return `${opened}.`;
}

/**
 * Slopweaver's own missing-credential lines, by their producers' whole grammar: `no <Provider> token configured`
 * (`connect/types.ts`, the GitHub, Slack, Linear and Notion verbs), `… token is configured` (`store/load.ts`,
 * `repliedRead.ts`), `… token for this home` (the Linear and Notion write verbs) and `… token is stored`
 * (`verifySlice.ts`). Each ends there, or goes on into its producer's own WHOLE hint and then ends: `; run \`slopweaver
 * connect <provider>\``, ` — run \`slopweaver connect <provider>\``, ` — \`slopweaver secrets status\` names the missing
 * one`, `. Set <ENV_VAR>, or write <home>/secrets/<provider>-token` or `. Set <ENV_VAR>, or run \`slopweaver connect
 * <provider>\``. Only the providers it stores a token for are named, and nothing may follow a hint, so neither a
 * provider's `no refresh token`, its `no Slack token configured by the provider for this request`, nor a hint with
 * other words after it is said as nothing stored here.
 */
const NO_TOKEN =
  /^no (github|slack|linear|notion) token (?:is )?(?:configured|stored|for this home)(?:(?:;| —) run `slopweaver connect \1`| — `slopweaver secrets status` names the missing one|\. Set [A-Z_]+, or (?:write .+\/secrets\/\1-token|run `slopweaver connect \1`))?$/iu;

/** A stored-token provider as the owner reads it, keyed by the lowercased name `NO_TOKEN` captured. */
const PROVIDER_NAMES: Readonly<Partial<Record<string, string>>> = {
  github: "GitHub",
  linear: "Linear",
  notion: "Notion",
  slack: "Slack",
};

/**
 * Sentences Slopweaver itself writes, matched whole, so each stands as itself with nothing to fold:
 * `src/automations/cardAnswers.ts`'s `syncRunSaid` for a sync run killed partway, and `./registerFreshness.ts`'s
 * `reasonOf` for a read that gave no reason.
 */
const OWN_SENTENCES: readonly RegExp[] = [
  /^It was stopped or crashed before it finished(?:; the next refresh reads the same window again)?\.$/u,
  /^its latest read did not answer$/u,
];

/** The first table entry whose code the text carries, or `undefined`. */
function matchOf({ table, text }: { table: readonly ShapedReason[]; text: string }): string | undefined {
  const found = table.find((entry) => entry.code.test(text));
  if (found === undefined) {
    return undefined;
  }
  return found.plain;
}

/**
 * The one cause a reason's codes name, or `undefined` when they name none, more than one, two different statuses, a
 * status set up as not what happened, or a code that is only context in its clause. Presence alone once read "expected
 * HTTP 401 but got HTTP 503" as a refused sign-in, and a lone code beside the real failure as its
 * cause, so an ambiguous reason is said as a technical error rather than as a guessed cause.
 */
function codedOf({ text }: { text: string }): string | undefined {
  const matched = CODED_REASONS.filter((entry) => entry.code.test(text));
  const causes = new Set(matched.map((entry) => entry.plain));
  const statuses = new Set([...text.matchAll(STATUS_WRITTEN)].map((found) => found[1]));
  if (causes.size !== 1 || statuses.size > 1 || NEGATION.test(text.replace(ERRNO_OWN_WORDS, "ENOSPC"))) {
    return undefined;
  }
  const entry = matched[0];
  if (!codeIsTheClause({ entry, text })) {
    return undefined;
  }
  return entry.plain;
}

/**
 * The plain sentence for a reason of a shape this file knows — a missing token, then a code — or `undefined`.
 * Nothing else is ever said as words: a runtime's own messages (`Cannot read properties of undefined`,
 * `Unexpected token '<'`) are English sentences no pattern can tell from a plain one.
 */
function knownOf({ text }: { text: string }): string | undefined {
  const token = NO_TOKEN.exec(text.trim());
  if (token !== null) {
    return `No ${PROVIDER_NAMES[token[1].toLowerCase()]!} token is stored.`;
  }
  return codedOf({ text });
}

/**
 * A command that exited with an error: a known tail by its shape, else said as a technical error. A coded tail is the
 * cause only when the command's own title names the call, as an outer link must (`slopweaver github read`); `slopweaver
 * docs check exited 1: HTTP 401 Unauthorized` may be printing a fixture, so it refused no sign-in.
 */
function exitedReason({ title, tail }: { title: string; tail: string | undefined }): string {
  if (tail === undefined || tail.trim() === "") {
    return "Its command stopped with an error and gave no reason.";
  }
  const token = NO_TOKEN.exec(tail.trim());
  if (token !== null) {
    return `No ${PROVIDER_NAMES[token[1].toLowerCase()]!} token is stored.`;
  }
  const argv = title
    .split(/\s+/u)
    .slice(1)
    .filter((word) => !word.startsWith("-"));
  const titleNamesTheCall = argv.some((word) => CALL_WORDS.has(word.toLowerCase()));
  const titleSaysNothingElse = argv.every(
    (word) => SHAPE_WORDS.has(word.toLowerCase()) || CALL_WORDS.has(word.toLowerCase()),
  );
  const coded = codedOf({ text: tail });
  if (coded !== undefined && titleNamesTheCall && titleSaysNothingElse) {
    return coded;
  }
  return "Its command stopped with a technical error.";
}

/**
 * One failure reason as a plain line, the raw message kept for the fold. Only a shape this file knows is said in
 * words; one of Slopweaver's own sentences stands as itself, and every other reason reads as a technical error.
 *
 * @param why the reason, exactly as the read gave it
 * @returns the plain line, and the raw message for the fold, exactly as it arrived (classified trimmed, never folded
 * trimmed), unless the line is one of Slopweaver's own sentences
 */
export function plainReasonOf({ why }: { why: string }): PlainReason {
  const trimmed = why.trim();
  // An empty reason is a failure that said nothing: said so, with no empty fold beneath.
  if (trimmed === "") {
    return { plain: "It failed without giving an error message.", raw: undefined };
  }
  if (OWN_SENTENCES.some((sentence) => sentence.test(trimmed))) {
    return { plain: sentenceOf({ text: trimmed }), raw: undefined };
  }
  const transport = matchOf({ table: TRANSPORT_REASONS, text: trimmed });
  if (transport !== undefined) {
    return { plain: transport, raw: why };
  }
  const exited = EXITED.exec(trimmed);
  if (exited !== null) {
    return { plain: exitedReason({ tail: exited[4], title: exited[2] }), raw: why };
  }
  const known = knownOf({ text: trimmed });
  if (known !== undefined) {
    return { plain: known, raw: why };
  }
  return { plain: "It failed with a technical error.", raw: why };
}

/**
 * A failed sync run's lead line. The verb's own `why` for one quotes the run's first stored error, which is a raw
 * provider or ingest record, so a failed run leads with a fixed true sentence instead, and every error is said
 * plainly beneath it with its raw message folded (`SyncRunPanel`'s problem list).
 *
 * @param errors the errors the run stored
 * @returns the lead line
 */
export function failedRunLeadOf({ errors }: { errors: readonly string[] }): string {
  if (errors.length === 0) {
    return "This run failed without giving an error message.";
  }
  return "This run failed.";
}

/**
 * What a broken automation folds under "Full message": the run's whole record, never the words the verb shortened or
 * extracted from it (`said`), which would pass a summary off as the raw message.
 *
 * @param account a broken automation's account, its extracted words and its whole record
 * @returns the whole record, or `undefined` when the account carries none, so nothing folds
 */
export function fullMessageOf({
  account,
}: {
  account: { readonly said: string | undefined; readonly detail: string | undefined };
}): string | undefined {
  return account.detail;
}
