/**
 * Lazy manifest for the `sop` noun — a standard operating procedure as a typed form.
 *
 * Only ONE verb writes outside the machine. `draft` renders the house markdown from a validated form;
 * `lint` judges a drafted document; `publish` lint-gates it and hands the bytes to `notion page`.
 *
 * `publish` declares `external-write` and `doorRouted` because it is the verb an operator invokes to put a
 * page in a workspace, even though the door record is written one layer down by `notion page` itself. There
 * is one Notion write path in this program and an SOP is one caller of it — a second one would have its own
 * ledger, its own ownership rules and its own way to be wrong.
 *
 * There is deliberately no register noun here and no teaser. An SOP has no decision to track — its lifecycle
 * is the review cadence printed on its own page — and announcing that a procedure now exists is the owner's
 * act under their own name, through `slack post --as me`.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const DRAFT_USAGE =
  "usage: slopweaver sop draft --form <json|-> [--out <path.md>] [--form-example] [--json]\n" +
  "  Renders the house SOP markdown from a filled form. Pure code, no model, no network.\n" +
  "  --form           the filled form as inline JSON, or `-` to read it from stdin\n" +
  "  --form-example   print a complete, already-valid --form and exit. Run this FIRST if you have not\n" +
  "                   filled this form before\n" +
  "  --out            write the draft here instead of to stdout, so it can be edited before publishing";

const LINT_USAGE =
  "usage: slopweaver sop lint <path-to-draft.md> [--json]\n" +
  "  The house gate: every section present and in order, every step naming who performs it, no unfilled\n" +
  "  TODO, an openable source link, and the unreviewed-draft notice still in place. Exits non-zero on a\n" +
  "  finding; every finding blocks, because each one is a section a reader needs in order to act.\n" +
  "  --json           emit the findings as one machine-readable document";

const PUBLISH_USAGE =
  "usage: slopweaver sop publish <path-to-draft.md> [--parent <page>] [--page <id>] [--title <text>] " +
  "[--icon <emoji>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Lint-gated publish through `notion page`. REFUSES a document with a blocking finding. It publishes a\n" +
  "  page and tells nobody: announcing a new procedure is the owner's act, under their own name.\n" +
  "  --parent         where a FIRST publish is created; the page inherits that parent's permissions\n" +
  "  --page           replace this page in place, keeping its id and URL\n" +
  "  --dry-run        lint, resolve the destination, and perform no effect";

export const sopManifest: Readonly<Record<string, VerbManifestEntry>> = {
  draft: lazy({
    load: () => import("../commands/sop/run.js").then((m) => m.sopDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      // `--out` makes `runSopDraft` write the draft to a file through `productionSopDeps`' `writeFileSync`.
      effect: "local-state",
      example: "slopweaver sop draft --form-example",
      parseRejectIsIoFree: true,
      summary: "Render the house SOP markdown from a typed form — pure code, no model",
      usage: DRAFT_USAGE,
    },
  }),
  lint: lazy({
    load: () => import("../commands/sop/run.js").then((m) => m.sopLintCommand),
    meta: {
      createsWorkItem: false,
      // A blocking finding is the verb WORKING: it ran perfectly and found something, exactly like `doctor`
      // reporting an unhealthy environment. A thrown error would still be a real bug.
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver sop lint ./draft.md",
      parseRejectIsIoFree: true,
      summary: "Gate a drafted SOP on its sections, its steps' actors, its placeholders and its source",
      usage: LINT_USAGE,
    },
  }),
  publish: lazy({
    load: () => import("../commands/sop/run.js").then((m) => m.sopPublishCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver sop publish ./draft.md --parent <page-url> --dry-run",
      parseRejectIsIoFree: true,
      summary: "Lint-gated publish of a drafted SOP to Notion, through the one write path",
      usage: PUBLISH_USAGE,
    },
  }),
};
