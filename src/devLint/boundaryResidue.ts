/**
 * The boundary-residue gate — the PR3.6 ratchet that keeps every EXTERNAL network/model call behind a
 * `safe*` wrapper (so a throw becomes a typed {@link ../lib/ingestError.IngestError}, never a lossy
 * boolean or a swallowed try/catch). It re-skins the archive's `check:neverthrow-service-boundaries`:
 * one rule — a boundary token (an SDK client call, a GraphQL `rawRequest`, any `.complete`, an
 * embedder `.embed*`) is a violation UNLESS it sits inside the parentheses of a `safe*` call.
 *
 * Scope (deliberate): the SDK / HTTP / LLM / embed boundaries — the calls whose thrown errors the old
 * `isTransientError` boolean flattened. Filesystem writes are routed through `safeFs` where the tiering
 * path benefits (jsonFile / vectorCacheStore / distil), but are NOT policed repo-wide, to avoid churning
 * the many pre-existing atomic-write edges (watermarks, ledgers, corpus writer) this refactor doesn't touch.
 *
 * Pure {@link scanBoundaryContent} (unit-tested with inline fixtures — string/comment noise is stripped so
 * a token NAMED in prose never trips it) + an effectful {@link runBoundaryResidue} edge that walks the
 * the working tree. The scanner's own files + `*.test.ts` + the dev-lint fixtures are excluded.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/** One boundary hit: where it is + which external call was left unwrapped. */
export interface BoundaryHit {
  readonly path: string;
  readonly line: number;
  readonly label: string;
  readonly excerpt: string;
}

interface BoundaryToken {
  readonly label: string;
  readonly re: RegExp;
  /**
   * Which `safe*` openers may sanction THIS token. Per-token rather than global (PR5.2.1b): before, any
   * opener sanctioned any token, so a Slack call nested inside a `safeFsAsync` passed the gate while
   * bypassing the shared 429 block entirely. An SDK/HTTP boundary must now be inside `safeProviderCall`
   * specifically — that is what turns a future unmigrated call site into a red gate rather than a review
   * catch. The LLM and embed tokens keep their own openers, because they are not provider calls and have
   * no rate registry, scope or block to belong to.
   */
  readonly openers?: RegExp;
  /**
   * When set, the token only applies to a file that IMPORTS this module specifier. The Codex thread surface
   * (`.startThread`/`.resumeThread`/`.run`) needs it: `.run(` is far too generic to match repo-wide (a
   * limiter's `job.run()` is not a model call), but inside the one file that imports the Codex SDK it is
   * exactly the boundary. Matched against the RAW content, because {@link stripNoise} blanks the import's
   * module-specifier string before the scan sees it.
   */
  readonly onlyWhenImporting?: string;
}

/** The paced provider door — the ONLY sanction for an SDK/HTTP boundary. */
const PROVIDER_OPENER = /\bsafeProviderCall$/;

/** The Codex SDK's package specifier — the scoping key for the thread-surface tokens below. */
const CODEX_SDK_SPECIFIER = "@openai/codex-sdk";

/**
 * The external-boundary call shapes. Each must sit inside a `safe*` wrapper. The `safe*` helpers
 * themselves call `execute()` (no token), so they never match; a token NAMED in a comment is stripped
 * before the scan, so prose ("the raw `client.*` boundary") never trips it.
 */
const BOUNDARY_TOKENS: readonly BoundaryToken[] = [
  // The Slack/Notion SDK client surfaces used in the connectors (incl. the PR4.2 structural lanes:
  // Slack `team.info`/`usergroups.list`), plus the PR5 WRITE surfaces. `chat` and `files` were MISSING
  // until PR5 added them, which meant a raw `client.chat.postMessage` outside a `safe*` wrapper — the
  // single most dangerous call in the program — sailed straight through this gate.
  {
    label: "sdk-client-call",
    openers: PROVIDER_OPENER,
    re: /\bclient\.(?:conversations|users|auth|blocks|chat|comments|dataSources|files|search|team|usergroups)\b/,
  },
  // Notion's page surface, scoped to the Notion SDK. `client.pages.create` and `client.pages.updateMarkdown`
  // are this program's only Notion MUTATIONS, and until the write lane landed this gate could not see either
  // of them. It is a separate token rather than another alternative in the shared list above because
  // `client.pages` is also the Cloudflare SDK's Pages surface: widening the shared pattern flagged three
  // calls in `atlas/cloudflare/readers/pages.ts`, which wrap their boundary in `try`/`mapCloudflareError`
  // rather than in `safeProviderCall`. That is a real, PRE-EXISTING gap in the Cloudflare atlas — every
  // Cloudflare reader is built that way — and it is not this token's business to assert an audit of it.
  {
    label: "notion-pages-call",
    onlyWhenImporting: "@notionhq/client",
    openers: PROVIDER_OPENER,
    re: /\bclient\.pages\b/,
  },
  // Octokit's REST + GraphQL surfaces. ADDED in PR5.2.1b: this gate was blind to GitHub entirely, so the
  // three raw calls in `corpus/github/fetch.ts` had no typed-error wrapper at all and nothing said so.
  // `request` joined in github-stack-verbs Phase 2: the three new stack REST endpoints have no typed
  // convenience method yet, so `client.request("POST /repos/{owner}/{repo}/stacks", ...)` is how this
  // codebase calls them — the literal escape hatch, not a lesser-scanned one.
  { label: "octokit-call", openers: PROVIDER_OPENER, re: /\bclient\.(?:rest|graphql|request)\b/ },
  // The Linear GraphQL transport.
  { label: "graphql-raw-request", openers: PROVIDER_OPENER, re: /\.rawRequest\s*\(/ },
  // The Outlook door's Graph SDK. Every request starts `graph.api(` — the door names its client `graph` so
  // this can be one token — and its terminal `.get()`/`.post()`/`.patch()` must sit in the same `execute`.
  // A bare `.api(` would also match unrelated seams named `api` (`deps.api(` in the review-state reader).
  { label: "graph-api-call", openers: PROVIDER_OPENER, re: /\bgraph\s*\.api\s*\(/ },
  // MSAL's three network calls: the consent URL (pinned discovery makes it local, but nothing may assume
  // that), the code redemption, and the silent refresh that rotates the refresh token.
  {
    label: "msal-token-call",
    openers: PROVIDER_OPENER,
    re: /\.(?:acquireTokenSilent|acquireTokenByCode|getAuthCodeUrl)\s*\(/,
  },
  // No headless model transport exists. A `.complete(` call is therefore never sanctionable by a wrapper.
  { label: "llm-complete", re: /\.complete\s*\(/ },
  // The Codex second brain. ADDED with the built-in orchestration capability: this gate recognised
  // `.complete(`, `.rawRequest(` and the provider surfaces, but NOTHING in the Codex SDK — so a raw,
  // unwrapped `thread.run()` passed clean, which is the same blindness recorded above for GitHub before
  // PR5.2.1b. Scoped to the SDK-importing file so a limiter's `job.run()` is not a false positive.
  //
  // Deliberately covers only the calls that REACH THE MODEL. Thread CREATION (`startThread`/`resumeThread`)
  // is synchronous and returns an object rather than a promise, so it cannot sit inside an async `safe*`
  // wrapper; it is policed instead by `schedulerBypass`, which restricts both the SDK import and the
  // construction site to one sanctioned factory. Two gates, one invariant, neither redundant.
  {
    label: "codex-thread-call",
    onlyWhenImporting: CODEX_SDK_SPECIFIER,
    openers: /\bsafeCodex$/,
    re: /\.(?:run|runStreamed)\s*\(/,
  },
];

/** Every `safe*` wrapper opener, used to FIND candidate ranges; which one sanctions what is per-token. */
const SAFE_OPENER = /\bsafe(?:ProviderCall|Codex|Embed|FsAsync|Fs)$/;

/** The noise scanner's state: normal code, a `//` line comment, a `/* *​/` block, or a string/template body. */
type NoiseState = "code" | "line" | "block" | "single" | "double" | "template";

/** One transition: the next state, the characters to emit, and how many input characters it consumed. */
interface NoiseStep {
  readonly state: NoiseState;
  readonly emit: string;
  readonly consumed: number;
}

/** In CODE: a comment/string opener switches state (emitting one blank); any other char passes through. */
function stepCode({ c, next }: { c: string; next: string | undefined }): NoiseStep {
  if (c === "/" && next === "/") {
    return { consumed: 1, emit: " ", state: "line" };
  }
  if (c === "/" && next === "*") {
    return { consumed: 1, emit: " ", state: "block" };
  }
  if (c === "'") {
    return { consumed: 1, emit: " ", state: "single" };
  }
  if (c === '"') {
    return { consumed: 1, emit: " ", state: "double" };
  }
  if (c === "`") {
    return { consumed: 1, emit: " ", state: "template" };
  }
  return { consumed: 1, emit: c, state: "code" };
}

/** In a LINE comment: blank every char; a newline returns to code. */
function stepLine({ c, blank }: { c: string; blank: string }): NoiseStep {
  return { consumed: 1, emit: blank, state: c === "\n" ? "code" : "line" };
}

/** In a BLOCK comment: blank every char; the closing `*​/` returns to code (blanking both chars). */
function stepBlock({ c, next, blank }: { c: string; next: string | undefined; blank: string }): NoiseStep {
  if (c === "*" && next === "/") {
    return { consumed: 2, emit: `${blank} `, state: "code" };
  }
  return { consumed: 1, emit: blank, state: "block" };
}

/** In a STRING/TEMPLATE body: blank every char; an escape blanks the next too; the closing quote ends it. */
function stepStringBody({
  state,
  c,
  next,
  blank,
}: {
  state: NoiseState;
  c: string;
  next: string | undefined;
  blank: string;
}): NoiseStep {
  if (c === "\\") {
    return { consumed: 2, emit: `${blank}${next === "\n" ? "\n" : " "}`, state };
  }
  const closes =
    (state === "single" && c === "'") || (state === "double" && c === '"') || (state === "template" && c === "`");
  return { consumed: 1, emit: blank, state: closes ? "code" : state };
}

/** Dispatch the per-character transition by current state. Pure. */
function advanceNoise({
  state,
  c,
  next,
  blank,
}: {
  state: NoiseState;
  c: string;
  next: string | undefined;
  blank: string;
}): NoiseStep {
  if (state === "code") {
    return stepCode({ c, next });
  }
  if (state === "line") {
    return stepLine({ blank, c });
  }
  if (state === "block") {
    return stepBlock({ blank, c, next });
  }
  return stepStringBody({ blank, c, next, state });
}

/**
 * Blank the contents of string literals + comments (preserving length + newlines), so paren-matching and
 * token detection see only CODE. Prevents a boundary token named in a comment/string from being scanned.
 * A thin fold over the pure {@link advanceNoise} state machine.
 *
 * @param content the raw source
 * @returns the source with string/comment interiors replaced by spaces
 */
export function stripNoise({ content }: { content: string }): string {
  const out: string[] = [];
  let state: NoiseState = "code";
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i]!;
    const next = content[i + 1];
    const step = advanceNoise({ blank: c === "\n" ? "\n" : " ", c, next, state });
    out.push(step.emit);
    state = step.state;
    i += step.consumed - 1;
  }
  return out.join("");
}

/** One `safe*` wrapper's argument range, tagged with the opener that produced it. */
interface SafeRange {
  readonly start: number;
  readonly end: number;
  readonly opener: string;
}

/** The index ranges lying inside a `safe*` wrapper's parentheses (noise-stripped code), each tagged. */
function safeRanges({ code }: { code: string }): readonly SafeRange[] {
  const ranges: SafeRange[] = [];
  const open: { atDepth: number; start: number; opener: string }[] = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i]!;
    if (c === "(") {
      depth += 1;
      const before = code.slice(Math.max(0, i - 24), i);
      const match = SAFE_OPENER.exec(before);
      if (match !== null) {
        open.push({ atDepth: depth, opener: match[0], start: i + 1 });
      }
    } else if (c === ")") {
      const top = open[open.length - 1];
      if (top?.atDepth === depth) {
        open.pop();
        ranges.push({ end: i, opener: top.opener, start: top.start });
      }
      depth -= 1;
    }
  }
  return ranges;
}

/**
 * Whether an index sits inside a range opened by a wrapper this token ACCEPTS.
 *
 * Nesting is why the opener has to be matched per range rather than per file: a boundary token wrapped in
 * `safeFsAsync(... safeProviderCall(...) ...)` is inside two ranges, and it is sanctioned because the INNER
 * one is a provider door — while the same token inside `safeFsAsync` alone is not.
 */
function inSafeRange({
  ranges,
  index,
  openers,
}: {
  ranges: readonly SafeRange[];
  index: number;
  openers: RegExp | undefined;
}): boolean {
  return openers !== undefined && ranges.some((r) => index >= r.start && index < r.end && openers.test(r.opener));
}

/**
 * Whether a file imports a module specifier. Deliberately matched against the RAW content: the specifier
 * lives in a string literal, and {@link stripNoise} blanks every string before the scan runs.
 */
function importsModule({ content, specifier }: { content: string; specifier: string }): boolean {
  return content.includes(`"${specifier}"`) || content.includes(`'${specifier}'`);
}

/** The tokens in scope for one file: the unscoped ones, plus any whose required import is present. */
function applicableTokens({ content }: { content: string }): readonly BoundaryToken[] {
  return BOUNDARY_TOKENS.filter(
    (t) => t.onlyWhenImporting === undefined || importsModule({ content, specifier: t.onlyWhenImporting }),
  );
}

/**
 * Pure: every unwrapped boundary token in one file's content. A token inside a `safe*` wrapper's parens is
 * allowed; anywhere else (a bare `await`, a raw try/catch) is a hit. Never throws.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each unwrapped-boundary hit (empty when clean)
 */
export function scanBoundaryContent({ path, content }: { path: string; content: string }): readonly BoundaryHit[] {
  const code = stripNoise({ content });
  const ranges = safeRanges({ code });
  const hits: BoundaryHit[] = [];
  for (const { label, re, openers } of applicableTokens({ content })) {
    const rx = new RegExp(re.source, "g");
    let match = rx.exec(code);
    while (match !== null) {
      if (!inSafeRange({ index: match.index, openers, ranges })) {
        hits.push({ excerpt: match[0], label, line: code.slice(0, match.index).split("\n").length, path });
      }
      match = rx.exec(code);
    }
  }
  return hits.toSorted((a, b) => a.line - b.line);
}

/**
 * This gate's declared scan predicate: a non-test `.ts` file under `src/`, `eval/` or `hooks/`, not this
 * gate's own source (its text necessarily contains the forbidden words it looks for).
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: gateSelfFiles({ stem: "boundaryResidue" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it; this gate's OWN sources are excluded, because their text
 *   contains the very patterns they look for
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code (0 clean, 1 unwrapped boundary found or not a git checkout)
 */
export function runBoundaryResidue(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("boundary-residue: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<BoundaryHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanBoundaryContent({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "boundary-residue",
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
    process.stdout.write(`boundary-residue: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "boundary-residue" }),
      detail: `${String(hits.length)} unwrapped-boundary hit(s)`,
    })}\n`,
  );
  return 1;
}
