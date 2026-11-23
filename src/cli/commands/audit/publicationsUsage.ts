/**
 * `slopweaver audit publications`'s usage line, and nothing else.
 *
 * A LEAF on purpose, like `./hygieneUsage.ts`: `cli/manifests/audit.ts` reads it on every invocation. Import only other
 * leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The command's complete help text. */
export const AUDIT_PUBLICATIONS_USAGE =
  "usage: slopweaver audit publications [--repo <owner/repo>] [--expect <door>:<class>:<link>]... [--json]\n" +
  "                                     [--fire --by-session <session>] [--home <dir>]\n" +
  "  Reads back what the fleet has PUBLISHED and judges it with the outbound privacy check the write doors run:\n" +
  "  installation state (session ids, home paths), the hygiene gate's refusals, and the private terms.\n" +
  "  GitHub: every pull request, issue, comment, review and review comment on --repo (default: this repository).\n" +
  "  Slack, Linear, Notion: every object the fleet's own write journals record it wrote, read back as it is now.\n" +
  "  A door with no credential, or one it could not read whole, is partial, never clean; the others are still read.\n" +
  "  Uploaded files are counted, never read.\n" +
  "  --expect      a finding the run must produce, named by class and link only; exits 1 when one is missed\n" +
  "  --json        emit the counts as one machine-readable document\n" +
  "  --fire        once the report is written, run the publication-leak monitor pass over it, whatever it found\n" +
  "  --by-session  which session is running it; provenance on every card the pass writes, never proof\n" +
  "  Counts only: no finding, link or matched text is printed. Each finding (class, door, link, never the term) is\n" +
  "  written 0600 under $SLOPWEAVER_HOME/evidence/publication-audit/, which the publication-leak monitor reads\n" +
  "  to raise one floating note and Queue card per finding. A private-terms file that is absent, unreadable\n" +
  "  or invalid refuses the run before any read. Exits 0 when all four doors read completely, nothing was\n" +
  "  found and every expectation was met. Under --fire a run that worked over a report that is not clean\n" +
  "  exits 3, which a scheduler stamps rather than retries; 1 is a failed pass or a missed expectation";
