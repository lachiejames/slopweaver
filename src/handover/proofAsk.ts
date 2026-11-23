/**
 * What proof the owner's words ask a pull request body to carry, and what the body actually carries.
 *
 * A seat can settle a row `--as answered` with a bare pull request URL as its witness, under a row whose stored words
 * ask for before and after proof with screenshots, links to the runs in GitHub, and links and screenshots from
 * Datadog test optimisation or CI visibility. Without this check nothing reads the body, so the settle passes
 * unverified. This module is that check: a closed set of asked-for items read off the owner's words, and the same
 * items counted in the body's markdown, so a refusal names the one it lacks and a pass names what it found.
 *
 * It is a PRESENCE check and says so. A body can carry a run link to a passing run that shows nothing; what this buys
 * is that the receipt names each run and link, so the next reader judges evidence rather than a URL.
 *
 * Pure: words and markdown in, verdicts out.
 */

/**
 * One kind of proof the owner's words can ask for.
 *
 * @internal — flows through {@link ProofAsk} and {@link ProofVerdict}, unnamed by callers.
 */
export type ProofItem = "screenshot" | "github-run" | "datadog";

/** Every item, in the order a verdict lists them. */
const PROOF_ITEMS: readonly ProofItem[] = ["screenshot", "github-run", "datadog"];

/**
 * The phrases that ask for each item. "image" is deliberately absent: a pasted picture reaches the owner's words as
 * an `[Image #<n>]` placeholder, which asks for nothing. "run" alone is absent too — "run the tests" is a verb — so a run link is
 * asked for only by a phrase naming a run as a thing to link or a run in GitHub/CI.
 */
const ASKS: Readonly<Record<ProofItem, readonly RegExp[]>> = {
  datadog: [/\bdatadog\b/iu, /\btest\s+optimi[sz]ation\b/iu, /\bci\s+visibility\b/iu],
  "github-run": [
    /\b(?:github|ci|actions|workflow|pipeline)\s+runs?\b/iu,
    /\blinks?\s+to\s+(?:the\s+|those\s+|these\s+|a\s+|each\s+|its\s+|both\s+)?runs?\b/iu,
    /\bruns?\s+in\s+(?:github|ci)\b/iu,
    /\brun\s+links?\b/iu,
  ],
  screenshot: [
    /\bscreen\s?shots?\b/iu,
    /\bscreen\s+recordings?\b/iu,
    /\bscreencasts?\b/iu,
    /\bvideos?\b/iu,
    /\bpictures?\b/iu,
  ],
};

/** "before and after", which raises a screenshot and a run link to two each — one of each side. */
const BEFORE_AND_AFTER = /\bbefore\s*(?:and|&|\/)\s*after\b/iu;

/**
 * Where one clause of the owner's words ends: a sentence stop, a semicolon, a line break, or "but", which turns a thought. A clause
 * is the unit a negation scopes over, so "no rush but screenshots please" still asks for a screenshot.
 */
const CLAUSE_BREAK = /[.;!?\n]+|\bbut\b/iu;

/**
 * A clause that negates — "no screenshots needed", "don't bother with a Datadog link" — asks for nothing in it, and so does one asking to take an item AWAY — "please remove the screenshots". Coarse on
 * purpose: a double negative ("not done without screenshots") reads as no ask, which fails OPEN to the settle as it was
 * before this gate, never shut on a settle the owner would call fine.
 */
const NEGATION =
  /\b(?:no|not|never|without|skip|nor|none|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|won'?t|needn'?t|remove|delete|drop|strip|get\s+rid)\b/iu;

/**
 * A clause that ASKS: one naming proof, or a request verb. A clause that only mentions an item — "Datadog is too
 * expensive" — asks for nothing in it. "link" is deliberately no cue, so "the run links are broken"
 * stays a remark. Residue, stated: a cue and an item in one clause that still ask for nothing ("I'd want Datadog
 * gone") read as an ask, and a false refusal costs a hatch carrying its reason, never a wrong settlement.
 */
const ASK_CUE =
  /\b(?:proof|prove|evidence|expect(?:ed|ing)?|want(?:ed)?|need(?:ed|s)?|please|add|include|attach|show|put|post|share|paste|provide|should|must|would\s+(?:like|help|be\s+(?:good|great|nice))|could\s+you|can\s+you)\b/iu;

/** What the owner's words ask a body to carry. */
export interface ProofAsk {
  /** The items asked for, in {@link PROOF_ITEMS} order, each once. */
  readonly items: readonly ProofItem[];
  /** Whether the owner asked for a before and an after, which needs two screenshots and two runs rather than one. */
  readonly beforeAndAfter: boolean;
}

/**
 * The proof items a set of the owner's words asks for.
 *
 * @param words every quote of the owner's the row holds, each read on its own so no phrase is spelled across two of them;
 *   an item asked in any one of them is asked
 * @returns the items asked, empty when the words ask for no proof at all
 */
export function proofAskedIn({ words }: { words: readonly string[] }): ProofAsk {
  const clauses = words
    .flatMap((quote) => quote.split(CLAUSE_BREAK))
    .filter((clause) => ASK_CUE.test(clause) && !NEGATION.test(clause));
  const asks = ({ pattern }: { pattern: RegExp }): boolean => clauses.some((clause) => pattern.test(clause));
  return {
    beforeAndAfter: asks({ pattern: BEFORE_AND_AFTER }),
    items: PROOF_ITEMS.filter((item) => ASKS[item].some((pattern) => asks({ pattern }))),
  };
}

/** A GitHub-hosted picture or video: what a screenshot pasted into a pull request becomes. A badge is not one. */
const ATTACHMENT =
  /https:\/\/(?:github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>\]]+)/giu;

/** An Actions run link; the run is the `owner/repo` and the id, so a job link and its run's link are one run. */
const RUN = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/actions\/runs\/(\d+)/giu;

/**
 * A link into Datadog, on any of its sites. The host must END at `datadoghq.com` or `.eu`, so a lookalike such as
 * `datadoghq.com.example.org` or `app.datadoghq.com@example.org` is not one.
 */
const DATADOG = /https:\/\/(?:[a-z0-9-]+\.)*datadoghq\.(?:com|eu)(?=[/?#\s)"'<>\]]|$)[^\s)"'<>\]]*/giu;

/** What a body carries of each item, each value once, in the order the body first names it. */
export type ProofCarried = Readonly<Record<ProofItem, readonly string[]>>;

/** Every distinct match of `pattern` in `body`, spelled by `spell`. */
function distinct({
  body,
  pattern,
  spell,
}: {
  body: string;
  pattern: RegExp;
  spell: (match: RegExpExecArray) => string;
}): readonly string[] {
  return [...new Set([...body.matchAll(pattern)].map(spell))];
}

/**
 * What a pull request body's markdown carries of each proof item.
 *
 * @param body the body as GitHub stores it
 * @returns each item's distinct values: attachment URLs, `owner/repo run <id>`, and Datadog links
 */
export function proofCarriedIn({ body }: { body: string }): ProofCarried {
  return {
    datadog: distinct({ body, pattern: DATADOG, spell: (match) => match[0] }),
    "github-run": distinct({ body, pattern: RUN, spell: (match) => `${match[1]!} run ${match[2]!}` }),
    screenshot: distinct({ body, pattern: ATTACHMENT, spell: (match) => match[0] }),
  };
}

/** One asked-for item, judged against the body. */
export interface ProofVerdict {
  readonly item: ProofItem;
  /** How many distinct values the ask needs: two of a screenshot or a run when the owner asked for a before and an after. */
  readonly needed: number;
  /** What the body carries of it. */
  readonly found: readonly string[];
}

/**
 * Each item the owner's words ask for, with what the body carries of it.
 *
 * @param asked what {@link proofAskedIn} read off the owner's words
 * @param carried what {@link proofCarriedIn} read off the body
 * @returns one verdict per asked item; a verdict whose `found` is shorter than `needed` is a lack
 */
export function judgeProof({ asked, carried }: { asked: ProofAsk; carried: ProofCarried }): readonly ProofVerdict[] {
  return asked.items.map((item) => {
    const needed = asked.beforeAndAfter && item !== "datadog" ? 2 : 1;
    return { found: carried[item], item, needed };
  });
}

/**
 * Whether a verdict is short of what was asked.
 *
 * @returns true when the body carries fewer distinct values than the ask needs
 */
export function proofLacking({ verdict }: { verdict: ProofVerdict }): boolean {
  return verdict.found.length < verdict.needed;
}

/** How a verdict's item reads in a sentence. */
const ITEM_NOUN: Readonly<Record<ProofItem, string>> = {
  datadog: "Datadog link",
  "github-run": "GitHub run link",
  screenshot: "screenshot (a GitHub attachment)",
};

/**
 * One line saying what the body carries of an item, or what it lacks.
 *
 * @returns the line, naming the run ids and links found so a reader judges the evidence rather than the count
 */
export function proofVerdictLine({ verdict }: { verdict: ProofVerdict }): string {
  const noun = ITEM_NOUN[verdict.item];
  const have = `${String(verdict.found.length)} found, ${String(verdict.needed)} needed`;
  if (verdict.found.length === 0) {
    return `${noun}: none in the body (${have})`;
  }
  return `${noun}: ${have} — ${verdict.found.join(", ")}`;
}

/** The hosts a GitHub pull request page is served from, as `URL` normalises them. */
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);

/** A pull request page's path: the PR itself or one of its own tabs, a trailing slash allowed. */
const PULL_PATH = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)(?:\/(?:files|commits|checks))?\/?$/iu;

/**
 * The pull request a witness names, when the witness is that URL and nothing else.
 *
 * Parsed as a URL rather than matched as text, so every spelling of the same page — a host in any case, `www.`, an
 * explicit `:443`, `http:`, a query string, one of its own tabs — is the same pull request and cannot slip past the
 * read. A comment permalink (a `#` fragment), a run link or prose around the URL is not bare:
 * each points at something more specific than the pull request, which is a different claim this check does not judge.
 *
 * @param witness `--witness`, trimmed
 * @returns the canonical URL, or undefined when the witness is not a bare pull request URL
 */
export function barePullRequestUrl({ witness }: { witness: string }): string | undefined {
  if (!URL.canParse(witness)) {
    return undefined;
  }
  const url = new URL(witness);
  const web = url.protocol === "https:" || url.protocol === "http:";
  const plain = url.port === "" && url.username === "" && url.password === "" && url.hash === "";
  const match = PULL_PATH.exec(url.pathname);
  if (!web || !plain || !GITHUB_HOSTS.has(url.hostname) || match === null) {
    return undefined;
  }
  return `https://github.com/${match[1]!}/${match[2]!}/pull/${match[3]!}`;
}
