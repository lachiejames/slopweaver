/**
 * `slopweaver fathom discover` over injected edges — find share links in Fathom's own mail that the fathom
 * source holds no transcript of yet.
 *
 * ## Why it reads the mailbox live rather than the gmail corpus
 *
 * The obvious input is the recap mail already in gmail bronze, and it cannot work: the gmail projection keeps
 * a message's text body and never stores its HTML link targets (`ParsedGmailMessage.htmlLinks` — "nothing
 * downstream stores this field"), and none of the four sampled recaps in gmail bronze carried
 * its share link. So discovery reads the recap mails through
 * the Gmail door itself (`gmail list`/`gmail read`'s own readers, read grant only) and takes the tokens from
 * the body AND the HTML `href`s.
 *
 * Generic by construction: the query is Fathom's sender, never a customer's name, so a colleague sharing any
 * call is enough for it to be found.
 */
import { shareTokensIn } from "../../../corpus/fathom/sharePage.js";
import { err, ok, type Result } from "../../../lib/result.js";

import { type FathomIngestReport, settleLines, shareLines } from "./shareCore.js";

/** One Fathom mail, reduced to what discovery reads. */
export interface FathomMail {
  readonly id: string;
  readonly sentAtIso: string | undefined;
  readonly subject: string | undefined;
  /** Whether it still carries Gmail's INBOX label — the one thing `clear-inbox` could change. */
  readonly inInbox: boolean;
  /** The mail's text body and its HTML link targets. */
  readonly texts: readonly string[];
}

/** One share link found, and the mail it was first found in. */
export interface DiscoveredShare {
  readonly token: string;
  readonly url: string;
  readonly mailId: string;
  readonly sentAtIso: string | undefined;
  readonly subject: string | undefined;
  /** Whether the fathom source already holds a verb-read transcript of it. */
  readonly held: boolean;
}

/**
 * How much of Fathom's mail one pass read. A listing is ONE page, capped at 100, so a mailbox holding more
 * Fathom mail than that is read newest-first and the rest is not seen; the report says so rather than letting
 * a count of links read as the whole history.
 */
export interface FathomMailCoverage {
  /** Fathom mails read in full. */
  readonly read: number;
  /** Gmail's own estimate of how many mails match, or undefined when it gave none. */
  readonly matchingEstimate: number | undefined;
  /** Whether Gmail said more mail matches than this page read. */
  readonly more: boolean;
}

/** The edges discovery reads through. */
export interface FathomDiscoverDeps {
  /** Read up to `limit` Fathom mails in full, newest first, and say how much of the match that was. */
  readonly fathomMail: (args: {
    home: string;
    limit: number;
  }) => Promise<Result<{ mails: readonly FathomMail[]; coverage: FathomMailCoverage }, string>>;
  /** Every share token the fathom source already holds a transcript for, or why its bronze could not be read. */
  readonly heldTokens: (args: { home: string }) => Result<ReadonlySet<string>>;
}

/**
 * Every distinct share link across the mails, each attributed to the first mail that carried it. Pure.
 *
 * @param mails the Fathom mails, in the order they were read
 * @param held the tokens the fathom source already holds
 * @returns one entry per token, in first-seen order
 */
export function sharesInMail({
  mails,
  held,
}: {
  mails: readonly FathomMail[];
  held: ReadonlySet<string>;
}): readonly DiscoveredShare[] {
  const found: DiscoveredShare[] = [];
  const seen = new Set<string>();
  for (const mail of mails) {
    for (const token of shareTokensIn({ texts: mail.texts })) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      found.push({
        held: held.has(token),
        mailId: mail.id,
        sentAtIso: mail.sentAtIso,
        subject: mail.subject,
        token,
        url: `https://fathom.video/share/${token}`,
      });
    }
  }
  return found;
}

/**
 * Read Fathom's mail and report every share link, held or not.
 *
 * @param home the Slopweaver home
 * @param limit how many Fathom mails to read
 * @param deps the mail reader and the bronze reader
 * @returns every share link found and how much of Fathom's mail was read, or why the mail could not be read
 */
export async function discoverShares({
  home,
  limit,
  deps,
}: {
  home: string;
  limit: number;
  deps: FathomDiscoverDeps;
}): Promise<Result<{ shares: readonly DiscoveredShare[]; coverage: FathomMailCoverage }, string>> {
  const read = await deps.fathomMail({ home, limit });
  if (read.isErr()) {
    return err(read.error);
  }
  const held = deps.heldTokens({ home });
  if (held.isErr()) {
    return err(held.error.join("; "));
  }
  return ok({
    coverage: read.value.coverage,
    shares: sharesInMail({ held: held.value, mails: read.value.mails }),
  });
}

/**
 * The line saying how much of Fathom's mail a pass read, and what to do when it was not all of it. Pure.
 *
 * @param coverage how many mails were read against how many match
 * @returns one line
 */
export function coverageLine({ coverage }: { coverage: FathomMailCoverage }): string {
  const of = coverage.matchingEstimate === undefined ? "" : ` of about ${String(coverage.matchingEstimate)}`;
  if (!coverage.more) {
    return `  read all ${String(coverage.read)} Fathom mail(s)`;
  }
  return (
    `  read the newest ${String(coverage.read)}${of} Fathom mail(s); older ones were NOT read, so a share only ` +
    "they carry is not listed — raise --limit (up to 100), or share that link by hand"
  );
}

/** When a share's mail was sent, or a placeholder said out loud when the mail carried no date. */
function sentAt({ sentAtIso }: { sentAtIso: string | undefined }): string {
  if (sentAtIso !== undefined) {
    return sentAtIso;
  }
  return "(undated)";
}

/**
 * The human report of a discovery pass.
 *
 * @param shares every share link found
 * @returns the lines to print, in order
 */
export function discoverLines({ shares }: { shares: readonly DiscoveredShare[] }): readonly string[] {
  const fresh = shares.filter((share) => !share.held).length;
  const lines = [
    `fathom discover — ${String(shares.length)} share link(s) in Fathom's mail, ${String(fresh)} not yet held`,
  ];
  for (const share of shares) {
    const when = sentAt({ sentAtIso: share.sentAtIso });
    lines.push(`  ${share.held ? "held" : "NEW "} ${share.url}  ${when}`);
  }
  return lines;
}

/**
 * Everything a discovery pass prints to stdout, in order: one JSON document under `--json`, else the
 * discovery report followed by each ingested share's own report. Pure.
 *
 * @param shares every share link found
 * @param coverage how much of Fathom's mail the pass read
 * @param report what `--ingest` stored and why each other link was not; empty when it was not asked for
 * @param json whether the caller asked for the machine-readable document
 * @returns the lines to print
 */
export function discoverOutputLines({
  shares,
  coverage,
  report,
  json,
}: {
  shares: readonly DiscoveredShare[];
  coverage: FathomMailCoverage;
  report: FathomIngestReport;
  json: boolean;
}): readonly string[] {
  if (json) {
    const document = { coverage, failures: report.failures, ingested: report.outcomes, settle: report.settle, shares };
    return [JSON.stringify(document, null, 1)];
  }
  return [
    ...discoverLines({ shares }),
    coverageLine({ coverage }),
    ...report.outcomes.flatMap((outcome) => shareLines({ outcome })),
    ...settleLines({ settle: report.settle }),
  ];
}
