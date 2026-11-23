/**
 * `slopweaver compact heal-refs`'s usage line, and nothing else — a LEAF, so the manifest can quote it
 * without pulling the command's corpus readers onto every unrelated invocation's load path.
 */

/** `slopweaver compact heal-refs`'s usage line. */
export const COMPACT_HEAL_REFS_USAGE =
  "usage: slopweaver compact heal-refs [--apply] [--home <dir>]\n" +
  "  Find every Notion record whose latest version names a content-addressed attachment or body by a digest\n" +
  "  redact's digit pass carved up (`sha256:…[number]…`, written by an earlier version), and rewrite each ref to the one\n" +
  "  stored file it named: exactly one stored name matches, the file re-hashes to it, and an attachment is the\n" +
  "  byte count its ref recorded. Anything else is refused by ref and left alone. No provider is called.\n" +
  "  Dry-run by default: prints what it would heal and why anything would be refused.\n" +
  "  --apply  append the healed versions through the one bronze write path, then re-run the census and name\n" +
  "           every record still damaged. Exits 1 when any is.";
