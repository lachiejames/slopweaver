/**
 * The usage text the drafting-workflow proposal verbs print (`draft`, `lint`, `intake`, `teaser`), and nothing
 * else.
 *
 * A LEAF on purpose, like `./publishUsage.ts`: `cli/manifests/proposal.ts` reads these strings on EVERY
 * invocation, so they live apart from the command modules that would drag a verb's whole import graph onto
 * every unrelated verb's load path. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `proposal draft --help`. */
export const DRAFT_USAGE =
  "usage: slopweaver proposal draft --form <json|-> [--out <path.md>] [--form-example] [--json] [--home <dir>]\n" +
  "  Renders the golden proposal markdown from a filled form. Pure code, no model, no network.\n" +
  "  --form           the filled form as inline JSON, or `-` to read it from stdin\n" +
  "  --form-example   print a complete, already-valid --form and exit. Run this FIRST if you have not\n" +
  "                   filled this form before\n" +
  "  --out            write the draft here instead of to stdout, so it can be edited before publishing\n" +
  "  --home           resolve the operator's private voice rules from this Slopweaver state home";

/** `proposal lint --help`. */
export const LINT_USAGE =
  "usage: slopweaver proposal lint <path-to-draft.md> [--json] [--home <dir>]\n" +
  "  The golden gate: section order, hero placement, every figure's citation, and the operator's own\n" +
  "  voice rules. Exits non-zero when a finding BLOCKS a publish; warnings alone still exit zero.\n" +
  "  --json           emit the findings as one machine-readable document\n" +
  "  --home           resolve the operator's private voice rules from this Slopweaver state home";

/** `proposal intake --help`. */
export const INTAKE_USAGE =
  'usage: slopweaver proposal intake --brief "<what this is about>" [--id <slug>] [--json] [--home <dir>]\n' +
  "  Seeds the gap questions a stakeholder answers BEFORE a draft exists, and gives the proposal the stable\n" +
  "  local id every later verb uses. Exits non-zero while a blocking question is open; that is a status.\n" +
  "  --id             name the intake yourself instead of deriving a slug from the brief\n" +
  "  --home           write the intake under this Slopweaver state home";

/** `proposal teaser --help`. */
export const TEASER_USAGE =
  "usage: slopweaver proposal teaser --form <json|-> [--page <url>] [--intake <id>] [--json] [--home <dir>]\n" +
  "  Renders the Slack announce form: ONE message, the proposal link leading the short version from the\n" +
  "  form's own slackTeaser field. It PRINTS a form and never posts; the send is `slack post` under your own name.\n" +
  "  --page           the published page's URL\n" +
  "  --intake         read the page URL from the intake this proposal published under";
