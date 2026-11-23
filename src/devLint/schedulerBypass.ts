/**
 * The scheduler-BYPASS gate (PR5.2) — the third of the three rate-limit gaps.
 *
 * `resilience-residue` already bans hand-rolled backoff, and `boundary-residue` already bans a raw SDK call
 * outside a `safe*` wrapper. Neither stops the thing this file stops: a NEW SDK client, constructed
 * somewhere fresh, whose calls never reach the shared 429 block at all. That is not hand-rolled backoff and
 * it is not an unwrapped boundary — it is a whole second door, and the prior 18-integration system's own CI
 * had a rule for exactly this because it happened there.
 *
 * The invariant enforced is structural rather than behavioural, which is why a regex can hold it honestly:
 * **an SDK client may only be constructed in a sanctioned factory file.** Client construction is the
 * choke point. If every client is built in one of a handful of known files, then every call made through
 * one is made by code a reviewer has actually looked at, and widening the set is a visible diff rather than
 * an invisible drift.
 *
 * A legitimate new factory is added by BOTH listing its path in {@link SANCTIONED_CLIENT_FACTORIES} and
 * marking the line with a reason. Requiring both means neither an allowlist entry nobody justified nor a
 * marker nobody reviewed is enough on its own — and a marker in a file that is not allowlisted is itself a
 * violation, so the marker cannot be used to smuggle a client into an arbitrary file.
 *
 * Mirrors the other gates' shape: a PURE {@link scanSchedulerBypass} over file content (unit-tested with
 * inline fixtures, so this file never scans itself) plus an effectful entry that walks the sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { absentAs } from "#lib/absent.js";
import { appendAll } from "../lib/arrays.js";
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

/** The exemption marker a sanctioned construction line must carry, with a non-empty reason after it. */
const FACTORY_MARKER = /\/\/\s*devlint:\s*sdk-factory\s*--\s*\S/;

/**
 * The files permitted to construct an SDK client, and why each one is.
 *
 * Kept short on purpose. Every entry is a place where a reader auditing "what can this program talk to?"
 * has to look, so the value of the list is inversely proportional to its length.
 */
export const SANCTIONED_CLIENT_FACTORIES: Readonly<Record<string, string>> = {
  "src/cli/commands/slack/uploadReadiness.ts": "the bounded upload-readiness poll, which needs its own client",
  "src/cli/commands/slack/wallRunRead.ts":
    "the wall-run read's one-shot `auth.test`, alongside the read seam, to know which replies are ours",
  "src/cli/commands/slack/highStakesRead.ts":
    "the high-stakes gate's live reads under the send token: an `auth.test`, the day's history, and an " +
    "INCLUSIVE one-message anchor read the shared history seam does not offer. Every call goes through " +
    "`safeProviderCall`, so it shares the 429 block with every other Slack caller",
  "src/cli/commands/slack/probeRun.ts":
    "the read-only research probe: it calls `client.apiCall(method, params)` with parameters no typed seam " +
    "declares, which is the entire point — an undocumented argument is only testable if it can be sent. " +
    "Every call it makes still goes through `safeProviderCall`, so it shares the 429 block and the pacing " +
    "with the ingest; `atlas/slackApi/probePolicy.ts` is what keeps it read-only",
  "src/codex/client.ts": "the sole closed Codex factory — the choke point for the sandbox, not for pacing",
  "src/connect/probes.ts": "the connect/--check probes, which deliberately test a token BEFORE any seam trusts it",
  "src/corpus/notion/writeApi.ts":
    "the Notion WRITE lane: the ONLY client pinned to the markdown-endpoint API version (2026-03-11) and " +
    "the only one whose mutations never retry, because Notion assigns the page id and a retried create " +
    "publishes a second page. The read lanes stay on the SDK default version deliberately",
  "src/corpus/github/writeCtx.ts":
    "the GitHub WRITE lane: a client with SDK retries and throttling OFF and redirects unfollowed, so an " +
    "irreversible pulls.create is attempted exactly once. The read client in corpus/github/githubClient.ts retries " +
    "and was measured sending 8 POSTs on one 421, which is why this cannot reuse it. Split out of " +
    "./write.ts, which is a ratcheted offender, so the construction sits beside the log routing it takes " +
    "rather than under two hundred method shims",
  // MIGRATED in PR5.2.1b. These previously read "pending migration to the shared block": each paced itself
  // with a local `createRateScheduler` while its 429s stayed invisible to everyone else. Every call in them
  // now goes through `safeProviderCall`, so a rate-limited Linear or Notion stops the other callers in this
  // process. The local schedulers REMAIN, deliberately: they hold per-provider rates the registry does not
  // model, and folding them in would have changed those rates — an unmeasured behaviour change with no place
  // in a migration. They sit INSIDE the door's `execute`, so the order is block-wait, then pace, then one call.
  //
  // The two Linear READ entries this list used to carry — `linear/fetch.ts` and `linear/structures.ts` — are
  // GONE, and their absence is the point. Each built its own client and its own scheduler, and `makeLinearApi`
  // was called twice per refresh, so one process ran three independent pacers over one per-user quota. There
  // is now exactly one read client, in `linear/transport.ts`.
  "src/corpus/linear/transport.ts":
    "THE single Linear READ client. Every read lane — activity, members, structures — shares this one " +
    "client, scheduler and observer, because Linear's quota is per-USER: a scheduler that cannot see every " +
    "request cannot hold the budget",
  "src/corpus/linear/write.ts":
    "the Linear WRITE lane. It cannot reuse the read seam's client: that one labels every call " +
    "`linear.rawRequest` (endpoint class `read`) and retries transiently, and an irreversible create must " +
    "carry its own mutation label and never retry after an ambiguous response",
  // Was `notion/fetch.ts`. The client moved when the live seam was split out of that file, and this gate is
  // what noticed — the entry is a path, so a refactor that relocates a factory has to come back here and say so.
  "src/corpus/notion/liveApi.ts": "the Notion read lane; on the shared block, still locally paced at its own rate",
  "src/corpus/notion/structures.ts": "the Notion structural lane; on the shared block, still locally paced",
  "src/corpus/slack/api.ts": "the Slack READ seam — the one place a read client is built",
  "src/corpus/slack/structures.ts": "the PR4.2 structural read lane (team.info / usergroups.list)",
  "src/corpus/slack/workspaceLookupOnce.ts":
    "`browser present`'s one `auth.test`, split out of ./api.ts under the file-size cap: a client with a " +
    "request deadline and no retry at any layer, because it runs inside the console voice's browser budget; " +
    "its one call goes through `safeProviderCall` and the shared 429 block",
  "src/corpus/slack/writeApi.ts": "the Slack WRITE seam — where the REPEATABLE write client is built",
  "src/corpus/slack/atMostOnceClient.ts":
    "the non-retrying half of the Slack write seam, split out of ./writeApi.ts so the whole subject of a " +
    "call that must not be repeated — budget, brand and construction — is one short file. Its brand is what " +
    "stops the repeatable client reaching `deleteMessageOnceCall`, which a comment did not",
  "src/live/outlook/client.ts":
    "the Outlook door's one MSAL public client (/consumers, both discovery documents pinned) and one Graph " +
    "client (authentication then the wire, no SDK RetryHandler); every call either makes goes through " +
    "`safeProviderCall`",
  "src/corpus/slack/writeApiAccount.ts":
    "the live `users.info` read an as-me message makes for each person it tags, split out of ./writeApi.ts " +
    "under the file-size cap; one read (plus `auth.test` for another workspace's member), through the same " +
    "guarded client and shared rate block",
};

/**
 * The SDK client constructors this gate polices.
 *
 * NOTE on `codex-client`: it is here for the CHOKE-POINT half of this gate's invariant, not the rate-limit
 * half. Codex has no shared 429 block, no quota scope and no pacing registry to bypass — so unlike the four
 * above it, a second Codex client would not smuggle calls past the rate door. What it WOULD smuggle past is
 * the closed locked options object: `src/codex/client.ts` is the only place that builds
 * `Required<ThreadOptions>` with `sandboxMode`, and a `new Codex()` anywhere else could start a
 * thread that silently inherits the machine's `~/.codex/config.toml` — which on a real developer box was
 * measured set to `danger-full-access`. Same structural rule, different thing being protected.
 */
const CLIENT_CONSTRUCTORS: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: "slack-web-client", re: /new\s+(?:Guarded)?WebClient\s*\(/ },
  { label: "octokit-client", re: /new\s+Octokit\s*\(/ },
  { label: "linear-client", re: /new\s+LinearClient\s*\(/ },
  { label: "notion-client", re: /new\s+Client\s*\(\s*\{\s*auth/ },
  { label: "codex-client", re: /new\s+Codex\s*\(/ },
  { label: "msal-public-client", re: /new\s+PublicClientApplication\s*\(/ },
  { label: "graph-client", re: /\bClient\.init(?:WithMiddleware)?\s*\(/ },
];

/**
 * Packages whose IMPORT is restricted to a single owning file, and that owner.
 *
 * Constructor-spelling regexes are not enough on their own for a package whose whole safety story is one
 * closed options object: `import { Codex as Brain }`, a namespace import, or a dynamic `await import()`
 * all walk straight past `/new\s+Codex\s*\(/`. Policing the import instead makes the choke point about
 * PACKAGE OWNERSHIP, which is the property actually being protected — there is exactly one file allowed
 * to talk to the Codex SDK, and every thread it starts carries `sandboxMode`.
 */
export const RESTRICTED_PACKAGE_OWNERS: Readonly<Record<string, string>> = {
  // The Outlook door's two SDKs. Ownership rather than a constructor regex, for the Codex reason: a
  // `PublicClientApplication` built elsewhere would sign in against whatever authority its caller named,
  // and a Graph client built with the SDK's default middleware retries a POST beneath the door's own retry.
  "@azure/msal-node": "src/live/outlook/client.ts",
  "@microsoft/microsoft-graph-client": "src/live/outlook/client.ts",
  "@openai/codex-sdk": "src/codex/client.ts",
};

/** One bypass finding. */
export interface BypassHit {
  readonly path: string;
  readonly line: number;
  readonly label: string;
  readonly reason: "unsanctioned-factory" | "missing-marker" | "marker-outside-allowlist" | "restricted-import";
  readonly excerpt: string;
}

/**
 * Every restricted-package import in a file that does not own it.
 *
 * Matches the module specifier in ANY import form — named, aliased, namespace, side-effect, `require`, or a
 * dynamic `await import()` — because the specifier string is the one part every form shares. That is what
 * makes this stronger than a constructor regex: `import { Codex as Brain }` cannot hide from it.
 */
function importSyntaxFor({ pkg }: { pkg: string }): RegExp {
  // Escape every regex metacharacter; a package name legitimately contains `/`, `-` and `.`.
  const literal = pkg.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // The four real ways to name a module: `from "pkg"` (covers named/default/namespace, including a
  // multi-line import whose specifier sits on the closing line), a side-effect `import "pkg"`,
  // `require("pkg")`, and a dynamic `import("pkg")`. A bare string constant matches NONE of them, which is
  // what keeps a gate that merely NAMES the package (this file, boundaryResidue.ts) from flagging itself.
  return new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]${literal}['"]`, "g");
}

function restrictedImportHits({ content, path }: { content: string; path: string }): readonly BypassHit[] {
  const hits: BypassHit[] = [];
  for (const [pkg, owner] of Object.entries(RESTRICTED_PACKAGE_OWNERS)) {
    if (path === owner) {
      continue;
    }
    const rx = importSyntaxFor({ pkg });
    let match = rx.exec(content);
    while (match !== null) {
      const line = content.slice(0, match.index).split("\n").length;
      hits.push({ excerpt: match[0].trim(), label: pkg, line, path, reason: "restricted-import" });
      match = rx.exec(content);
    }
  }
  return hits;
}

/**
 * Every scheduler-bypass hit in one file. Pure — a test feeds it inline fixtures, so the gate stays
 * falsifiable without touching the filesystem.
 *
 * @param path the file's repo-relative path
 * @param content the file's text
 * @returns each hit (empty when clean)
 */
export function scanSchedulerBypass({ path, content }: { path: string; content: string }): readonly BypassHit[] {
  const sanctioned = Object.hasOwn(SANCTIONED_CLIENT_FACTORIES, path);
  const hits: BypassHit[] = [];
  appendAll({ from: restrictedImportHits({ content, path }), into: hits });
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    const marked = FACTORY_MARKER.test(line);
    if (marked && !sanctioned) {
      hits.push({
        excerpt: line.trim(),
        label: "marker",
        line: index + 1,
        path,
        reason: "marker-outside-allowlist",
      });
      return;
    }
    for (const { label, re } of CLIENT_CONSTRUCTORS) {
      const match = re.exec(line);
      if (match === null) {
        continue;
      }
      if (!sanctioned) {
        hits.push({ excerpt: match[0], label, line: index + 1, path, reason: "unsanctioned-factory" });
        continue;
      }
      // In a sanctioned file the marker is still required, on the construction line or the one above it, so
      // the REASON for each client lives beside the client rather than only in this file's allowlist.
      // `index > 0` proves the previous line exists; an honest assertion beats coalescing it away.
      const previous = index === 0 ? "" : lines[index - 1]!;
      if (!marked && !FACTORY_MARKER.test(previous)) {
        hits.push({ excerpt: match[0], label, line: index + 1, path, reason: "missing-marker" });
      }
    }
  });
  return hits;
}

/**
 * What the choke point actually buys for THIS client, so the remedy line is true rather than boilerplate.
 *
 * A provider client is choked so its calls reach the shared 429 block. Codex is choked for a different
 * reason entirely — it has no rate registry — so telling a Codex author about `providerCall.ts` would send
 * them to fix the wrong thing.
 */
function whatTheChokePointProtects({ label }: { label: string }): string {
  return label === "codex-client"
    ? "every thread it starts carries the closed locked options from src/codex/client.ts, rather than " +
        "silently inheriting the sandbox from the machine's ~/.codex/config.toml"
    : "every call it makes goes through the shared rate block (src/lib/providerCall.ts)";
}

/**
 * The failure line for one bypass: where the client was built, and why that matters.
 *
 * @param hit the offending construction site
 * @returns the line to print — it names the sanctioned factory, because a fresh client is a second door
 *   whose calls never reach the shared rate block
 */
export function bypassMessage({ hit }: { hit: BypassHit }): string {
  switch (hit.reason) {
    case "unsanctioned-factory":
      return (
        `${hit.path}:${String(hit.line)}: [${hit.label}] an SDK client is constructed here, but this file is not a ` +
        `sanctioned factory. Every client must be built in one, so ${whatTheChokePointProtects({ label: hit.label })}. ` +
        "Reuse an existing seam, or add this path to SANCTIONED_CLIENT_FACTORIES with a reason"
      );
    case "missing-marker":
      return (
        `${hit.path}:${String(hit.line)}: [${hit.label}] this sanctioned factory constructs a client without a ` +
        "`// devlint: sdk-factory -- <reason>` marker. The reason belongs beside the client, not only in the allowlist"
      );
    case "restricted-import":
      return (
        `${hit.path}:${String(hit.line)}: [${hit.label}] this package may only be imported by ` +
        `${absentAs({ value: RESTRICTED_PACKAGE_OWNERS[hit.label], whenAbsent: "its owning file" })}. Every thread must be started through that ` +
        "one closed adapter, so the locked options cannot be omitted or overridden. Import the adapter, not the SDK"
      );
    case "marker-outside-allowlist":
      return (
        `${hit.path}:${String(hit.line)}: an \`sdk-factory\` marker appears in a file that is NOT in ` +
        "SANCTIONED_CLIENT_FACTORIES. The marker cannot sanction a file by itself — that would let any file " +
        "become a factory by writing a comment"
      );
  }
}

/**
 * This gate's declared scan predicate: a non-test `.ts` file under `src/`, `eval/` or `hooks/`, not this
 * gate's own source (its text necessarily names the forbidden shapes it looks for).
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  selfFiles: gateSelfFiles({ stem: "schedulerBypass" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it; tests and this gate's own sources are excluded, because their
 *   text contains the very patterns they look for
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every in-scope source, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code
 */
export function runSchedulerBypass(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("scheduler-bypass: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<BypassHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanSchedulerBypass({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "scheduler-bypass",
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
    process.stdout.write(`scheduler-bypass: clean (${String(readCount)} sources scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${bypassMessage({ hit })}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "scheduler-bypass" }),
      detail: `${String(hits.length)} bypass risk(s)`,
    })}\n`,
  );
  return 1;
}
