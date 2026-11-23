/**
 * The no-private-browser-profile gate — machine-enforces the owner's rule: the real browser, the owner's own
 * Chrome, is the only browser anything here drives, for everything including e2e tests, ad hoc Playwright
 * scripts, the Playwright MCP and atlases, with no separate Chrome profile. The whole rule is in `docs/browser-route.md`, and what it retired in
 * `docs/browser-route/screenshot-reading-and-retirement.md`.
 *
 * ## Why a gate and not a convention
 *
 * Because this class regenerates. Four independent lanes in this repository each grew its own
 * `chromium.launchPersistentContext` against its own `0700` profile under `$SLOPWEAVER_HOME` — GitHub's
 * attachment session, Notion's render check, the Slack atlas's driven browser, and `datadog shot` — and
 * each was individually well-reasoned at the time. Every one of them was written by someone who had read
 * the previous one. A rule that lives only in prose gets re-derived by the next lane that needs a browser,
 * which is exactly what happened here, and what cost the owner two hours.
 *
 * ## The criterion, stated rather than counted
 *
 * A source file fails when it does any of:
 *
 * - calls `chromium.launch`, `chromium.launchPersistentContext` or `chromium.connectOverCDP` (or the
 *   `firefox`/`webkit`/`puppeteer` equivalents) while naming a **profile directory or a user-data path**;
 * - passes a `--user-data-dir` or a `--remote-debugging-port` argument, meaning the flag appears INSIDE a
 *   string literal;
 * - spells a browser EXECUTABLE path inside a string literal.
 *
 * ## The fourth half: a browser binary written down is a launch with no profile behind it
 *
 * Measured: the Playwright relay opened its connect page in the owner's PERSONAL
 * profile because that is the profile Chrome was last used in. The relay hands Chrome exactly one argument —
 * the connect URL — so the profile is whatever Chrome feels like, and the fix is to launch it through
 * `src/browser/profilePin.ts`'s shim, which carries `--profile-directory` from the recorded choice.
 *
 * That module resolves Chrome through `playwright-core`'s OWN registry, so no absolute browser path is
 * written down anywhere in this repository — which is what lets the pattern be an outright ban rather than
 * an allowlist. A file that spells `/Applications/Google Chrome.app/...` is a file about to spawn a browser
 * without saying which profile, which is the failure the rule names.
 *
 * ## What it deliberately does NOT ban, and why that is the ruling rather than a loophole
 *
 * **A bare Playwright import.** The first cut of this gate failed any file importing `playwright`, and that
 * was one step wider than the rule it enforces: Playwright is itself a thing that should point at the owner's
 * real browser, in e2e tests, ad hoc scripts and the Playwright MCP alike. The rule bans a
 * PROFILE, not a tool, and covers the WHOLE browser surface, deterministic in a single command, with no subset.
 *
 * What actually regenerated across four independent lanes was `launchPersistentContext` against a `0700`
 * directory under `$SLOPWEAVER_HOME`. That is what they had in common, and it is what this now matches — so
 * the narrower criterion still catches all four, and stops refusing the wanted transport.
 *
 * The `--remote-debugging-port` half stays, and it is not decoration. Driving the owner's real Chrome is done
 * through `playwright-core`'s own extension relay (`extensionContextFactory`, which ends in
 * `chromium.connectOverCDP(relay.cdpEndpoint())` against the DEFAULT profile), never by asking Chrome to
 * open a port — and a lane that reaches for the port is a lane about to mint a second profile to make it
 * work.
 *
 * Pure {@link scanPrivateBrowserProfile} + an effectful {@link runPrivateBrowserProfile} edge, matching the
 * other gates in this directory.
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

/**
 * One violation: where it is, and which half of the criterion it tripped.
 * @internal
 */
export interface PrivateProfileHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** One pattern in the criterion, and the sentence a reader gets when they trip it. */
interface BrowserPattern {
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * The criterion, as patterns.
 *
 * Text rather than an AST walk, and that is a judgement rather than laziness: two of the three halves are
 * not expressions at all — a `--user-data-dir` inside a shell script or an argv array has no node to match,
 * and a driver package named in a `package.json` dependency block has none either. The false-positive risk
 * a text scan carries is answered by the patterns being specific: `chromium.launch`, not `launch`.
 */
const PATTERNS: readonly BrowserPattern[] = [
  {
    pattern: /\b(?:chromium|firefox|webkit|puppeteer)\s*\.\s*launchPersistentContext\s*\(/,
    why: "launches a browser against a profile directory of its own",
  },
  {
    pattern:
      /\b(?:chromium|firefox|webkit|puppeteer)\s*\.\s*(?:launch|connectOverCDP)\s*\([^)]*(?:userDataDir|profileDir|ProfileDir)/,
    why: "launches or attaches to a browser against a named profile directory",
  },
  { pattern: /["'][^"']*--user-data-dir\b/, why: "names a browser profile directory" },
  { pattern: /["'][^"']*--remote-debugging-port\b/, why: "asks a browser to expose a debugging port" },
  {
    pattern:
      /["'](?:[^"']*Chrom(?:e|ium)\.app\/Contents\/MacOS\/(?:Google Chrome|Chromium)|\/(?:usr|opt)\/bin\/(?:google-)?chrom(?:e|ium))["']/,
    why: "spells out a browser's own executable, and a launch that names its binary names no profile",
  },
];

/** What every violation tells the reader to do instead. */
const CORRECTION =
  "Owner ruling (docs/browser-route.md): the owner's real work Chrome is the only browser anything " +
  "here drives, and no verb mints a profile of its own. Playwright itself is FINE and is what is " +
  "wanted — drive the owner's real Chrome through playwright-core's extension relay, which resolves to the default " +
  "profile. A leg that needs only a signed-in cookie reads the owner's own jar (src/browser/cookieJar.ts). There " +
  "is no exemption marker, because a file that needs one has re-invented the lane this gate keeps retired. " +
  "A browser binary is resolved through playwright-core's own registry and launched through the profile pin " +
  "(src/browser/profilePin.ts), never written down here.";

/**
 * Every violation in `content`. Pure — a line scan, so it reads a shell script and a `.ts` file alike.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanPrivateBrowserProfile({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly PrivateProfileHit[] {
  const hits: PrivateProfileHit[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const { pattern, why } of PATTERNS) {
      if (pattern.test(text)) {
        hits.push({ line: index + 1, message: `this line ${why}. ${CORRECTION}`, path });
        return;
      }
    }
  });
  return hits;
}

/** This gate's declared scan predicate: every source file, minus its own and its documentation. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "noPrivateBrowserProfile" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan every source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runPrivateBrowserProfile(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("no-private-browser-profile: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<PrivateProfileHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanPrivateBrowserProfile({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "no-private-browser-profile",
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
    process.stdout.write(`no-private-browser-profile: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "no-private-browser-profile" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
