/**
 * The scan `github exposure sweep` runs over every piece of public text: the existing hygiene scan's leak classes
 * and private denylist (`../../hygiene/scan.ts`), the forbidden-identifier rules (`../../hygiene/identifierScan.ts`,
 * through the repository-content scanner that forgives this repository's own address), and a mailbox-address rule.
 *
 * ## Why a mailbox rule, when the hygiene gate has none
 *
 * The hygiene gate guards committed FILES, where an address is rare and a fixture's is synthetic. What a switch to
 * public exposes beyond the files is mostly identity: every commit's author and committer address, pushed commits
 * in the events feed, a co-author trailer in a message. GitHub's own no-reply forms and the reserved example
 * domains are not a mailbox anybody owns, so they are left out; every other address is a finding.
 *
 * ## One home directory is a finding, and it is the one running the sweep
 *
 * The leak class `absolute-home-path` matches any `/Users/<name>` or `/home/<name>`, and in what a repository
 * publishes nearly all of them are the repository's own placeholders: test output in a job log, a fixture in a
 * diff, `skills/home/` in a path. MEASURED on this repository's first full sweep: 32,907 hits over 108 distinct
 * paths, every one a placeholder (`/Users/someone`, `/home/acme`) or a hosted runner's account (the diffs' half:
 * `git log -p --all | grep -o -E "/(Users|home)/[A-Za-z0-9._-]+" | sort | uniq -c | sort -rn`). The reference scan
 * reached the same conclusion over committed files (`../../hygiene/referenceScan.ts`). The one home a log or a diff
 * from this machine can actually carry is the account the sweep runs as, so that path, exactly, is the finding;
 * a person's name in any other home is the identifier rules' and the denylist's to catch.
 *
 * A finding carries the matched text, because the owner has to see what to act on. It lives only in the state home
 * (`./exposureFindingsStore.ts`); the printed report carries counts by rule, never a match.
 */

import type { IdentifierScanner } from "../../hygiene/identifierScan.js";
import { SYNTHETIC_WORKSPACE_ID_LABEL, scanContent } from "../../hygiene/scan.js";
import type { GithubExposureSurfaceId } from "./exposureModel.js";
import type { GithubExposureText } from "./exposureTexts.js";

/** The leak class a `/Users/<name>` or `/home/<name>` path is reported under in `../../hygiene/scan.ts`. */
const ABSOLUTE_HOME_PATH_LABEL = "absolute-home-path";

/** The label a real mailbox address is reported under. */
const MAILBOX_ADDRESS_RULE = "mailbox-address";

const MAILBOX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gu;

/** Domains no person receives mail at: GitHub's no-reply relay and the names reserved for examples (RFC 2606). */
const NON_MAILBOX_DOMAIN =
  /(?:^|\.)(?:users\.noreply\.github\.com|example\.(?:com|net|org)|example|test|invalid|localhost)$/u;

/** Local parts that name a relay rather than a person, and the SSH remote GitHub prints in every clone hint. */
const NON_MAILBOX_LOCAL = /^(?:no-?reply|git)$/iu;

/** One thing the sweep found, where, and under which rule. Written to the state home; never printed. */
export interface GithubExposureFinding {
  readonly surface: GithubExposureSurfaceId;
  readonly locator: string;
  readonly field: string;
  /** 1-based, within the field's text. */
  readonly line: number;
  readonly rule: string;
  readonly match: string;
}

/** A scan bound to one run's denylist and identifier rules. */
export interface GithubExposureScanner {
  readonly scan: (args: { text: GithubExposureText }) => readonly GithubExposureFinding[];
}

/**
 * Whether an address is a mailbox somebody owns. Pure.
 *
 * @param address the matched address
 * @returns false for a no-reply relay, GitHub's SSH remote and a reserved example domain
 */
export function isMailboxAddress({ address }: { address: string }): boolean {
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();
  return !NON_MAILBOX_LOCAL.test(local) && !NON_MAILBOX_DOMAIN.test(domain);
}

/** Every real mailbox address in a text, with its line. */
function mailboxHits({ content }: { content: string }): readonly { line: number; match: string }[] {
  return content.split("\n").flatMap((lineText, index) =>
    [...lineText.matchAll(MAILBOX)]
      .map((found) => found[0])
      .filter((address) => isMailboxAddress({ address }))
      .map((match) => ({ line: index + 1, match })),
  );
}

/** The UTF-16 offset each line of a text starts at. */
function lineStarts({ content }: { content: string }): readonly number[] {
  const starts = [0];
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** Every forbidden identifier in a text, with its line and the exact text the rule matched. */
function identifierHits({
  identifiers,
  content,
}: {
  identifiers: IdentifierScanner;
  content: string;
}): readonly { line: number; rule: string; match: string }[] {
  const hits = identifiers.scan({ content, path: "exposure" });
  if (hits.length === 0) {
    return [];
  }
  const starts = lineStarts({ content });
  const spans = identifiers.spans({ content });
  return hits.map((hit) => {
    // `scan` numbers lines from 1 over the same text, so both starts are defined.
    const from = starts[hit.line - 1]!;
    const to = hit.line < starts.length ? starts[hit.line]! : content.length + 1;
    const matched = spans
      .filter((span) => span.kind === hit.kind && span.offset >= from && span.offset < to)
      .map((span) => content.slice(span.offset, span.offset + span.length));
    return { line: hit.line, match: [...new Set(matched)].join(" | "), rule: hit.kind };
  });
}

/**
 * Bind the scan to one run's rules.
 *
 * @param denylist the private denylist's words, loaded from the state home
 * @param identifiers the forbidden-identifier scanner, one per run so its caches are shared
 * @param ownHome the home directory of the account running the sweep, the one home path reported
 * @returns the scanner
 */
export function githubExposureScanner({
  denylist,
  identifiers,
  ownHome,
}: {
  denylist: readonly string[];
  identifiers: IdentifierScanner;
  ownHome: string;
}): GithubExposureScanner {
  return {
    scan: ({ text }) => {
      const where = { field: text.field, locator: text.locator, surface: text.surface };
      // A text read whole starts at its own line 1; only a batch of a longer log carries where it began.
      const { lineOffset: offset = 0 } = text;
      const leaks = scanContent({ content: text.text, denylist, path: "exposure" })
        .filter((hit) => hit.label !== SYNTHETIC_WORKSPACE_ID_LABEL)
        .filter((hit) => hit.label !== ABSOLUTE_HOME_PATH_LABEL || hit.excerpt === ownHome)
        .map((hit) => ({ ...where, line: hit.line, match: hit.excerpt, rule: hit.label }));
      const named = identifierHits({ content: text.text, identifiers }).map((hit) => ({ ...where, ...hit }));
      const mailboxes = mailboxHits({ content: text.text }).map((hit) => ({
        ...where,
        ...hit,
        rule: MAILBOX_ADDRESS_RULE,
      }));
      return [...leaks, ...named, ...mailboxes].map((finding) => ({ ...finding, line: finding.line + offset }));
    },
  };
}
