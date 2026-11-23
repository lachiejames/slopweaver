/**
 * `slopweaver linear briefing`'s usage line, and nothing else.
 *
 * A LEAF on purpose, the same as `labelsUsage.ts`: `cli/manifests/linearBriefing.ts` reads it on every
 * invocation, so it imports nothing at all. `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on
 * anything else.
 */

/** `slopweaver linear briefing`'s usage line. */
export const LINEAR_BRIEFING_USAGE =
  "usage: slopweaver linear briefing build --form <json|-> --out <dir> [--json]\n" +
  "  Validates one end-of-day Linear briefing and writes its bundle: every proposed write as the form its own\n" +
  "  `slopweaver linear` verb sends, the exact command (and dry run) per write, the doc's `## On the owner's word`\n" +
  "  section and the page fragment. Writes nothing to Linear — the owner's yes runs the printed commands\n" +
  "  --form            the briefing as JSON, or `-` to read it from stdin\n" +
  "  --out             the bundle directory; its `forms/` is rewritten to match this briefing exactly\n" +
  "  --json            emit one machine-readable document\n" +
  "  Procedure: skills/automation/reference/linear-briefing.md";
