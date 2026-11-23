/**
 * What a FAILED terminal-client invocation actually was, said in words that carry no address.
 *
 * ## The finding this module exists to answer
 *
 * MEASURED over two back-to-back twelve-page Vanta walks (page
 * `vanta-walk-120s-client-hang`): every lost page cost exactly the client's own process bound — four hangs,
 * all four within 270 ms of 120 s — while every page that worked cost 5.7 to 6.9 s. There was nothing in
 * between in either run. The hung clients held 0.09 s of CPU at 0.0%, state `SN`, for the whole two minutes:
 * asleep, not starved. `NAVIGATION_TIMEOUT_MS` is 45 s and nothing ever landed near it.
 *
 * Four runs before those two could not tell page weight from walk position from machine load, and the reason
 * is what this module fixes: **a 45-second page timeout and a two-minute client kill printed the same
 * sentence.** `atlas/kit/pageWalk.ts`'s `transportReason` collapses every non-session failure into "the
 * browser could not navigate to this page's address", deliberately, because the transport's own message
 * interpolates the URL and a Vanta or Nx Cloud address carries a tenant slug. So the discriminator went out
 * with the address, and six runs of evidence could not separate three mechanisms.
 *
 * ## The killed client prints NOTHING, and that emptiness is the proof
 *
 * The instinct — carry the killed child's `stdout` and `stderr`, which `execFileSync` hands back and
 * `relaySession.ts` used to drop — recovers no text at all on a hang. Read the client this repo runs:
 * `playwright-core/lib/tools/cli-client/program.js` picks `JsonOutput` for `--json`, which every relay
 * invocation passes, and that writes exactly one document at the END of the command. Nothing is printed
 * before or during a run. And `cli-client/session.js`'s `SocketConnectionClient.send` awaits the daemon's
 * response with **no timeout of any kind** — so a daemon that never answers leaves the client waiting
 * forever, having printed nothing and burned no CPU, which is the measurement above exactly.
 *
 * So what discriminates is the STRUCTURE of the kill: which bound fired, how long the client ran against
 * that bound, Node's own `code` and `signal`, and whether the client had printed anything at all. The last
 * one is not a hint — it is a proof of ONE thing, and the exact edge of what it proves is the part worth
 * writing down. A page that genuinely fails to load prints a JSON document carrying its own `failure` field
 * and exits 0 — `goto` has its own `NAVIGATION_TIMEOUT_MS`, so a page that will not load always produces a
 * document — and such a run never reaches this module at all. Empty output plus a kill at the bound therefore
 * proves the client was waiting on the RELAY, never on a page.
 *
 * **It does not prove the snippet never started, and an earlier draft of this file claimed it did.** Five
 * snippet sources — `pageVisitSnippet.ts`, `snippetParts.ts`, `evidenceCaptureSnippet.ts` and
 * `vantaPolicyVersionSnippet.ts` (twice) — `await page.bringToFront()`, whose Playwright signature
 * (`bringToFront(): Promise<void>`, `playwright-core/types/types.d.ts`) accepts no timeout, and `$$eval` and
 * `page.title()` are unbounded the same way. Every one of them rides the same `SocketConnectionClient.send`
 * with no timeout, AFTER a successful `goto` — so one of them hanging leaves exactly this evidence: nothing
 * printed, no CPU, killed at the bound. Both hangs are the relay; where in the snippet it stopped is not
 * something an empty stdout can say. Bounding those calls is a named follow-up, not a thing this file can
 * infer around.
 *
 * ## URL-free by CONSTRUCTION, which is the property and not a slogan
 *
 * **Every string {@link diagnoseClientFailure} can emit is a literal declared in this file.** Nothing from
 * the client's output, from Node's error message, or from the operation is ever interpolated. Exactly three
 * kinds of thing cross in from outside:
 *
 * - **Numbers** — elapsed, the bound, byte counts. A number cannot carry a slug.
 * - **`code` and `signal`**, each checked against {@link TOKEN_SHAPE} before it is printed and rendered as
 *   an unnamed one otherwise. Node documents these as tokens; the guard costs a line and the alternative is
 *   trusting a value from outside. `error.message`, `error.path` and `error.spawnargs` are deliberately
 *   never printed: all three carry absolute paths, and `spawnargs` carries the snippet path.
 * - **Phrase IDs** from {@link CLIENT_PHRASES}, whose `says` half is our own sentence.
 *
 * That last one is the inverse of the thing `pageWalk.ts` warns against. It is not a substring rule that
 * parses a reason OUT of somebody else's message; it is a membership test whose only output is one of our own
 * literals. The distinction is what makes it safe to record.
 *
 * **The raw text is not lost to the operator, and that is why this is not a trade.** `execFileSync` forwards
 * the child's stderr to the parent's stderr, so a session watching a walk still sees everything the client
 * said. What has to be URL-free is only what gets RECORDED.
 */
import { isRecord } from "../lib/parsers.js";

import { SNIPPET_REPORTED_FAILURE_BECAUSE } from "./pageTransport.js";

/**
 * The shape an error `code` or a `signal` must have before it is printed.
 *
 * Node documents both as tokens (`ETIMEDOUT`, `SIGTERM`), so this never fires in practice — it is here
 * because they are values from outside this process and the one thing that may not happen is a recorded
 * reason carrying an address. See this module's header.
 *
 * @internal
 */
const TOKEN_SHAPE = /^[A-Z][A-Z0-9_]*$/;

/** Which known client phrase a failure's output carried. */
export type ClientPhraseId =
  | "session-closed"
  | "target-closed"
  | "browser-closed"
  | "detached"
  | "version-skew"
  | "no-session-open"
  | "daemon-exited"
  | "daemon-pid";

/** One phrase the terminal client is known to print, and the sentence it means. */
interface ClientPhrase {
  readonly id: ClientPhraseId;
  /** Matched case-insensitively against what the client printed. Never rendered. */
  readonly match: string;
  /** What this phrase means, in our own words — the only thing a match can put in a record. */
  readonly says: string;
  /**
   * Whether every remaining page of this walk will fail the same way, so the whole run stops rather than
   * one page failing.
   *
   * This field was once called `sessionGone`, and that name is what let `version-skew` below be
   * graded wrong for a week: a skew leaves the relay alive and answering, so "the relay is gone" is FALSE of
   * it, while "every page after this one is already lost" is exactly true. The flag has only ever decided
   * the second thing, and now says so.
   */
  readonly runStopping: boolean;
  /**
   * Whether re-running the attach would plausibly clear this, so the operation is worth one more try.
   *
   * A strictly narrower question than {@link ClientPhrase.runStopping}, and the two disagree on exactly one
   * row. Four of the five run-stopping phrases name a relay or a page that went away, which is the one
   * thing a fresh attach rebuilds. `version-skew` does not: `Session.run` compares two constants that live
   * as long as the client binary does, so the same client attaching again is refused identically and the
   * only fix is a different client — retrying it would buy an attach per remaining page and be refused on
   * every one. A phrase that is not run-stopping never reaches this question at all, because it already
   * costs one page rather than the run.
   */
  readonly clearedByReattach: boolean;
}

/**
 * The closed set of phrases a failed client invocation is read against.
 *
 * The first five are the run-stopping ones. Four of them are measured rather than guessed: in one measurement,
 * three of four concurrent walks died on an uncaught `Error: Session closed` thrown out of
 * `playwright-core`'s `lib/tools/cli-client/session.js`. That reaches this process only as a child that
 * exited non-zero with the trace on its stderr, so the message is what there is to classify on.
 *
 * **The fifth, `version-skew`, is run-stopping BY CONSTRUCTION, which is stronger evidence than any of the
 * four.** `Session.run` refuses whenever `compareSemver(client.version, session.config.version) < 0` — two
 * constants that cannot change for the life of the client process — so ONE refusal proves every remaining
 * page will be refused identically. It arrived here graded as costing a single page, and what that cost is
 * a `automation resync --atlas linear` pass: under a tenth of its declared pages landed, the rest were refused
 * `Client is v1.62.1, session 'chrome' is v1.63.0`, and `live/resync/outcome.ts` still graded the attempt
 * SUCCEEDED — because nothing was ever noted in `./walkStops.ts`, whose header carries the class.
 *
 * The last three are the client's own fixed strings, read out of `cli-client/session.js` and
 * `cli-client/output.js` in playwright-core 1.61.1 — a relay that could not come up at all used to print the
 * same sentence as a page that would not load.
 *
 * **{@link ClientPhrase.clearedByReattach} cuts the same five in a DIFFERENT place, and the difference is
 * the whole of it.** Four of them name a relay, page or context that went away, which is the one thing a
 * fresh attach rebuilds; `version-skew` is the one that survives every attach the same client can make. So a
 * walk that loses its session mid-page retries that page against a rebuilt relay, while a skewed client
 * still stops the run at the first refusal. MEASURED on one seat: a Linear walk of hundreds of pages got past
 * half way and exited on `Error: Session closed`, and the xero walk in the same sweep on `Target page, context or
 * browser has been closed` — one row each, and both of them on the reattachable side.
 *
 * @internal exported for the guard that asserts every row renders something, that the run-stopping set is
 * exactly the five named above, and that the reattachable set is exactly the four.
 */
export const CLIENT_PHRASES: readonly ClientPhrase[] = [
  {
    clearedByReattach: true,
    id: "session-closed",
    match: "session closed",
    runStopping: true,
    says: "the relay dropped the call while it was in flight",
  },
  {
    clearedByReattach: true,
    id: "target-closed",
    match: "target closed",
    runStopping: true,
    says: "the page went away underneath the call",
  },
  {
    clearedByReattach: true,
    id: "browser-closed",
    match: "browser has been closed",
    runStopping: true,
    // `browser has been closed` is the tail of Playwright's GENERIC `Target page, context or browser has
    // been closed`, which fires for a disposed page as readily as for a browser the owner shut. Saying the
    // browser closed sends a reader to look at the owner's Chrome, and MEASURED the xero walk carrying
    // exactly this string was running in a Chrome that was still open.
    says: "the page, its context or the browser this walk was driving went away underneath the call",
  },
  {
    clearedByReattach: true,
    id: "detached",
    match: "detached",
    runStopping: true,
    says: "the relay detached from the browser",
  },
  {
    clearedByReattach: false,
    id: "version-skew",
    match: "client is v",
    runStopping: true,
    says:
      "the client is older than the relay daemon it was asked to drive, which that daemon refuses for every " +
      "call until the session is restarted",
  },
  {
    clearedByReattach: false,
    id: "no-session-open",
    match: "is not open",
    runStopping: false,
    says: "there was no relay session open to run in",
  },
  {
    clearedByReattach: false,
    id: "daemon-exited",
    match: "daemon process exited with code",
    runStopping: false,
    says: "the relay daemon exited while it was starting up",
  },
  {
    clearedByReattach: false,
    id: "daemon-pid",
    match: "daemon pid=",
    runStopping: false,
    says: "the relay daemon failed to come up",
  },
] as const;

/**
 * What kind of failure one client invocation was.
 *
 * @internal — the field type of {@link ClientDiagnosis.kind}; callers read the kind off a diagnosis.
 */
export type ClientFailureKind =
  /** Killed at its own process bound — the hang class. */
  | "killed-at-bound"
  /** Started, ran, exited with a non-zero status of its own. */
  | "exited-nonzero"
  /** Never ran at all: the executable could not be spawned. */
  | "never-started"
  /** Printed more than the invocation would buffer. */
  | "output-overflowed"
  /** The client ran fine and the SNIPPET reported a failure of its own — the page's trouble, not the client's. */
  | "snippet-reported"
  /** None of the above — the facts did not say. */
  | "unclassified";

/** Everything read off a thrown client failure. Held as data so the diagnosis is a pure function of it. */
export interface ClientFailureFacts {
  /** Node's own `code`, such as `ETIMEDOUT` on a kill at the bound. */
  readonly code: string | null;
  /** The signal the child was killed with, such as `SIGTERM`. */
  readonly signal: string | null;
  /** The child's exit status, or `null` when it was killed rather than exiting. */
  readonly status: number | null;
  /** Everything the client printed on stdout. Read for phrases and counted; never recorded. */
  readonly stdout: string;
  /** Everything the client printed on stderr. Read for phrases and counted; never recorded. */
  readonly stderr: string;
}

/** What a failed invocation was, in terms a record may carry. */
export interface ClientDiagnosis {
  readonly kind: ClientFailureKind;
  /** One sentence, composed entirely of this module's own literals plus numbers. Safe to record. */
  readonly because: string;
  /** Whether the run must stop rather than lose one page — see {@link ClientPhrase.runStopping}. */
  readonly runStopping: boolean;
  /**
   * Whether a fresh attach would plausibly clear this, so the operation is worth one more try.
   *
   * Only ever read beside {@link ClientDiagnosis.runStopping}: a failure that costs one page is already
   * retried by nobody, and a run-stopping failure this is `false` for is the one a reattach cannot help.
   * `relaySession.ts`'s `relayRecovery` is the one reader and it composes the two.
   */
  readonly reattachMayClear: boolean;
  /** Which known phrases the client's output carried, in declaration order. */
  readonly phrases: readonly ClientPhraseId[];
}

/**
 * Read the facts off whatever a failed `execFileSync` threw, without trusting any of it.
 *
 * @param error the thrown value
 * @returns the facts, with absent fields read as `null` and absent output as the empty string
 */
export function readClientFailureFacts({ error }: { error: unknown }): ClientFailureFacts {
  if (!isRecord(error)) {
    return { code: null, signal: null, status: null, stderr: "", stdout: "" };
  }
  return {
    code: stringOrNull({ value: error["code"] }),
    signal: stringOrNull({ value: error["signal"] }),
    status: numberOrNull({ value: error["status"] }),
    stderr: textOrEmpty({ value: error["stderr"] }),
    stdout: textOrEmpty({ value: error["stdout"] }),
  };
}

/**
 * Which known phrases a failure's output carried.
 *
 * @param text everything the client printed, both streams together
 * @returns the matching ids, in {@link CLIENT_PHRASES} order
 */
export function matchClientPhrases({ text }: { text: string }): readonly ClientPhraseId[] {
  const lowered = text.toLowerCase();
  return CLIENT_PHRASES.filter((phrase) => lowered.includes(phrase.match)).map((phrase) => phrase.id);
}

/**
 * Say what a failed client invocation was, in one sentence that carries no address.
 *
 * The whole point of the module — see its header for why the emptiness of a hung client's output is a proof
 * rather than a hint, and for the construction that keeps this output recordable.
 *
 * @param facts what was read off the thrown error
 * @param elapsedMs how long the invocation actually took, measured around the call
 * @param boundMs the bound that invocation was given
 * @returns the kind, the recordable sentence, and whether the run must stop
 */
export function diagnoseClientFailure({
  facts,
  elapsedMs,
  boundMs,
}: {
  facts: ClientFailureFacts;
  elapsedMs: number;
  boundMs: number;
}): ClientDiagnosis {
  const phrases = matchClientPhrases({ text: `${facts.stdout}\n${facts.stderr}` });
  const printedBytes = facts.stdout.length + facts.stderr.length;
  const kind = failureKind({ facts });
  const said = phraseSentence({ phrases });
  return {
    because: `${headline({ boundMs, elapsedMs, facts, kind, printedBytes })}${said}`,
    kind,
    phrases,
    reattachMayClear: phrases.some((id) => isClearedByReattach({ id })),
    runStopping: phrases.some((id) => isRunStopping({ id })),
  };
}

/**
 * Say what a snippet's OWN reported failure was — the other half of the pair the finding could not separate.
 *
 * The client ran, printed its document and exited 0; the page is what went wrong. A snippet failure is still
 * read against {@link CLIENT_PHRASES}, because a page that reports `Target closed` has lost the relay rather
 * than failed to load, and that grades the whole run rather than one page.
 *
 * @param failure the snippet's own failure string — a Playwright error with the URL interpolated, so it is
 * read here and never emitted
 * @returns the kind, the recordable sentence, and whether the run must stop
 */
export function diagnoseSnippetFailure({ failure }: { failure: string }): ClientDiagnosis {
  const phrases = matchClientPhrases({ text: failure });
  return {
    because: `${SNIPPET_REPORTED_FAILURE_BECAUSE}${phraseSentence({ phrases })}`,
    kind: "snippet-reported",
    phrases,
    reattachMayClear: phrases.some((id) => isClearedByReattach({ id })),
    runStopping: phrases.some((id) => isRunStopping({ id })),
  };
}

/**
 * Whether a matched phrase means every remaining page of the walk is already lost.
 *
 * @param id the matched phrase
 * @returns whether the whole run must stop
 */
function isRunStopping({ id }: { id: ClientPhraseId }): boolean {
  return CLIENT_PHRASES.some((phrase) => phrase.id === id && phrase.runStopping);
}

/**
 * Whether a matched phrase names something a fresh attach rebuilds.
 *
 * @param id the matched phrase
 * @returns whether re-attaching is worth trying before the run is given up on
 */
function isClearedByReattach({ id }: { id: ClientPhraseId }): boolean {
  return CLIENT_PHRASES.some((phrase) => phrase.id === id && phrase.clearedByReattach);
}

/** Grade the facts into one of the declared kinds. */
function failureKind({ facts }: { facts: ClientFailureFacts }): ClientFailureKind {
  if (facts.code === "ETIMEDOUT") {
    return "killed-at-bound";
  }
  if (facts.code === "ENOBUFS") {
    return "output-overflowed";
  }
  if (facts.code === "ENOENT" || facts.code === "EACCES") {
    return "never-started";
  }
  const exited = facts.status !== null && facts.status !== 0;
  if (exited) {
    return "exited-nonzero";
  }
  return "unclassified";
}

/** The first clause: which bound fired, how long it ran, and what it had managed to print. */
function headline({
  kind,
  facts,
  elapsedMs,
  boundMs,
  printedBytes,
}: {
  kind: ClientFailureKind;
  facts: ClientFailureFacts;
  elapsedMs: number;
  boundMs: number;
  printedBytes: number;
}): string {
  const ran = `after ${seconds({ ms: elapsedMs })}`;
  if (kind === "killed-at-bound") {
    return (
      `the browser client was killed at its own ${seconds({ ms: boundMs })} process bound ${ran} ` +
      `(${token({ value: facts.signal })}), ${printed({ printedBytes })}`
    );
  }
  if (kind === "output-overflowed") {
    return `the browser client printed more than one invocation will buffer, ${ran}`;
  }
  if (kind === "never-started") {
    return `the browser client could not be started at all (${token({ value: facts.code })})`;
  }
  if (kind === "exited-nonzero") {
    return `the browser client exited with status ${String(facts.status)} ${ran}, ${printed({ printedBytes })}`;
  }
  return `the browser client failed ${ran} with ${token({ value: facts.code })}, ${printed({ printedBytes })}`;
}

/**
 * What the client had printed by the time it died — and the sentence that makes an empty one a finding.
 *
 * A hung client prints nothing, which proves it was waiting on the RELAY rather than on a page — never which
 * step of the snippet it stopped in, because several of them are unbounded too (module header). Saying only
 * "0 bytes" would leave the next reader to work the provable half out again, which is the whole cost this
 * module was written to stop paying.
 */
function printed({ printedBytes }: { printedBytes: number }): string {
  if (printedBytes === 0) {
    return (
      "having printed nothing at all — so no page snippet result came back, and this is the client waiting " +
      "on the relay rather than a page that would not load"
    );
  }
  return `after printing ${String(printedBytes)} byte(s)`;
}

/** What the matched phrases say, or nothing at all when none matched. */
function phraseSentence({ phrases }: { phrases: readonly ClientPhraseId[] }): string {
  const said = CLIENT_PHRASES.filter((phrase) => phrases.includes(phrase.id)).map((phrase) => phrase.says);
  if (said.length === 0) {
    return "";
  }
  return `; it said ${said.join("; ")}`;
}

/** A token from outside, printed only when it is shaped like one. */
function token({ value }: { value: string | null }): string {
  if (value !== null && TOKEN_SHAPE.test(value)) {
    return value;
  }
  return "an unnamed code";
}

/** A duration a reader can compare to a bound, at one decimal place. */
function seconds({ ms }: { ms: number }): string {
  return `${(ms / 1_000).toFixed(1)}s`;
}

/** A string field of a thrown error, or `null` when it is anything else. */
function stringOrNull({ value }: { value: unknown }): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

/** A numeric field of a thrown error, or `null` when it is anything else. */
function numberOrNull({ value }: { value: unknown }): number | null {
  if (typeof value === "number") {
    return value;
  }
  return null;
}

/** One of the child's output streams as text, or the empty string when it is absent or not a string. */
function textOrEmpty({ value }: { value: unknown }): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}
