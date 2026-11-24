/**
 * Every `slopweaver fresh-cut …` verb's usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/freshCut.ts` reads these strings on every invocation that enumerates the
 * manifest barrel, so they cannot live in the command module without dragging git and the hygiene scanners onto
 * every unrelated command's load path. Keep it importing nothing.
 */

/** `slopweaver fresh-cut produce`'s usage line. */
export const FRESH_CUT_PRODUCE_USAGE =
  "usage: slopweaver fresh-cut produce --commit <sha> --out <absolute-dir> [--source <checkout>] [--home <dir>] [--json]\n" +
  "  Write ONE parentless commit over exactly <sha>'s tree into a NEW local repository at --out, outside every\n" +
  "  checkout, signed as the GitHub token owner's no-reply address, and record the source SHA, tree hash and new\n" +
  "  root SHA under <home>/fresh-cuts/<record-id>/. <sha> must be on the source's local main. No remote, no push.";

/** `slopweaver fresh-cut verify`'s usage line. */
export const FRESH_CUT_VERIFY_USAGE =
  "usage: slopweaver fresh-cut verify --record <record-id> [--source <checkout>] [--home <dir>] [--json]\n" +
  "  Re-derive the cut's tree from its recorded source SHA and refuse on any difference, then scan every file of\n" +
  "  the cut with the hygiene gate and every private term, owner-address rows included. A private-term match\n" +
  "  wholly inside this repository's own address, the code-owner file's owner account or the README's one owner\n" +
  "  link, exactly as the hygiene gate forgives each, or one that is a TEST-NET or 1.2.3.4 address, is counted as\n" +
  '  exempt instead. A finding the reviewed-residue list accepts is taken out and counted as "reviewed, accepted".\n' +
  "  Findings go to\n" +
  "  <home>/fresh-cuts/<record-id>/verify-<instant>.json, never to the terminal. Exits 1 on any finding.";

/** `slopweaver fresh-cut accept`'s usage line. */
export const FRESH_CUT_ACCEPT_USAGE =
  "usage: slopweaver fresh-cut accept --record <record-id> --path <file> --line <n> --class owner-address\n" +
  "         --as placeholder|not-an-address [--source <checkout>] [--home <dir>] [--json]\n" +
  "       slopweaver fresh-cut accept --record <record-id> --path <file> --line <n> --class <other class>\n" +
  "         --anchor transcript:<session>#<turn> [--source <checkout>] [--home <dir>] [--json]\n" +
  "  Accept one finding of the cut, at the path and line the verify report names. An owner-address finding is\n" +
  "  accepted when THIS visible session read it and judged it a placeholder or no address at all. Any other class\n" +
  "  is accepted only on --anchor, the owner's own turn ruling on it, which is resolved in the local transcripts\n" +
  "  first; that entry counts in this one record and tree only. Appends one entry to\n" +
  "  <home>/fresh-cuts/reviewed-residue.jsonl\n" +
  "  keyed by the path, the class and the SHA-256 of the line, so a later change to that line refuses again.\n" +
  "  Refused for --anchor on owner-address, --as or no anchor on any other class, an anchor naming no owner turn,\n" +
  "  a line the verify does not flag, one already accepted, and when no single visible session is named. Prints\n" +
  "  the entry id and class, never the path, line, text or anchor.";
