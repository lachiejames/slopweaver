/**
 * Lazy manifest for the `notion` noun: bounded named-object reads, plus the page WRITE lane.
 *
 * `page` carries `create`/`update` as sub-commands rather than as separate verbs, mirroring the
 * `linear issue` precedent. `--private` is deliberately absent: Notion refuses workspace-parented page
 * creation from an internal integration, so a created page inherits its PARENT's permissions and privacy is
 * a property of where you publish rather than of a flag this verb could honour.
 */

import { lazy, type VerbManifestEntry } from "../manifest.js";

const READ_USAGE =
  "usage: slopweaver notion read <notion-id-or-url> [--kind <page|database>] [--limit <1..100>]\n" +
  "       [--after <cursor>] [--nested-calls <n>] [--pdf] [--json] [--home <dir>]\n" +
  "  Reads one named object from the provider now; it does not search the workspace or consult history.\n" +
  "  A page read expands every block nested beneath its slice (toggles, headings, columns, tables, synced\n" +
  "  blocks) into data.blockTree; child pages and databases are named in data.nested.linkedObjects, not read\n" +
  "  --limit           cap returned top-level blocks (default 25, maximum 100, Notion's own page ceiling)\n" +
  "  --nested-calls    child-list calls the nested expansion may spend (default 400, maximum 2000); a\n" +
  "                    ceiling hit is named in residue and data.nested, never passed off as a whole page\n" +
  "  --pdf             open the Notion-hosted files this read addresses — a row's own `files` properties\n" +
  "                    and this slice's file blocks, nested ones included — and carry what they SAY.\n" +
  "                    Anything linking to another site is counted in residue and never fetched; at\n" +
  "                    most 10 files per read\n" +
  "  --after           continue past that ceiling: pass the previous read's data.blocks.nextCursor and\n" +
  "                    repeat while data.blocks.hasMore is true. Page reads only; a database has no blocks\n" +
  "  --json            emit one machine-readable document with freshness, coverage and residue\n" +
  "  --kind            choose the Notion endpoint explicitly (default page); database rows are not traversed\n" +
  "  --home            resolve the credential from this Slopweaver state home";

const ATTACH_USAGE =
  "usage: slopweaver notion attach --page <page> --from <md-path|-> [--media-base <dir>] [--dry-run] " +
  "[--json] [--home <dir>] [--overwrite-external-edit <why>]\n" +
  "  attach        upload each `![caption](file:./shot.png)` and `[caption](file:./doc.pdf)` placeholder's\n" +
  "                file into Notion's own storage and insert its block AT that placeholder's position,\n" +
  "                never appended to the end. A `!` means an image block, no `!` means a `pdf` block\n" +
  "  --from        the AUTHORED markdown, still carrying its placeholders — it is what says which file\n" +
  "                belongs at which marker; the published page no longer knows\n" +
  "  --media-base  resolve relative placeholder paths against this directory (default: --from's own)\n" +
  "  --dry-run     list the placeholders and where each block would land, no effect\n" +
  "  --overwrite-external-edit  overwrite a page a human genuinely edited since slopweaver last wrote it;\n" +
  "                requires a reason, journaled with who last edited the page and when. A byte-identical\n" +
  "                touch (a display toggle) needs no flag at all — it is not treated as an edit\n" +
  "  Re-running is a no-op for anything already attached, so a partial failure is fixed by running it again";

const VERIFY_USAGE =
  "usage: slopweaver notion verify <page-id-or-url> [--observation <path|->] [--out <dir>] " +
  "[--cell-lines <n>] [--json] [--home <dir>]\n" +
  "  Reports what the page actually rendered — link cells that did not become links, mermaid blocks not\n" +
  "  showing their diagram, and cells past the line budget\n" +
  "  With no --observation it prints the BRIEF: what to open in your own Chrome and the measurement script\n" +
  "  to run there. Nothing here launches a browser (docs/browser-route.md)\n" +
  "  --observation  the JSON that script returned, as a file or `-` for stdin; judging it is the check\n" +
  "  --out         where the brief tells the session to save screenshots (default:\n" +
  "                $SLOPWEAVER_HOME/notion-renders/<page-id>)\n" +
  "  --cell-lines  how many rendered lines a table cell may occupy before it is called out (default 6)\n" +
  "  Exit 0 clean, 3 the check ran and found problems, 1 the check could NOT run — never read 1 as a pass";

const PAGE_USAGE =
  "usage: slopweaver notion page <create|update|archive|move> --body <md-path|-> [--parent <page>] " +
  "[--page <page>] [--to <page>] [--title <text>] [--icon <emoji>] [--media-base <dir>] [--adopt] " +
  "[--dry-run] [--json] [--home <dir>] [--overwrite-external-edit <why>]\n" +
  "  create        create a page under --parent; the new page inherits that parent's permissions, because\n" +
  "                Notion refuses workspace-parented creation from an internal integration\n" +
  "  update        replace --page's whole content in place, keeping its id and URL; only pages slopweaver\n" +
  "                created, and refused when anyone but the integration last edited it\n" +
  "  archive       move --page to Notion's trash, where it is recoverable for thirty days; no body is sent\n" +
  "  move          re-parent --page under --to, keeping its id, its URL and every block. No body is sent and\n" +
  "                no external-edit check applies, because nothing inside the page is replaced — but the\n" +
  "                page's permissions become the destination's, so its audience changes\n" +
  "  --to          move only: the page --page is moved under. Notion refuses a workspace-level move from an\n" +
  "                internal integration, exactly as it refuses a workspace-level create\n" +
  "  --body        the markdown body (`-` reads stdin); the title is a page property, so no H1 in the body\n" +
  "  --media-base  resolve relative `file:` placeholders against this directory (default: --body's\n" +
  "                own directory, or the working directory when the body is read from stdin)\n" +
  "  --adopt       record ownership of a page missing from the ledger, and only when the integration is\n" +
  "                still its last editor — the recovery path for a create whose response was lost\n" +
  "  --overwrite-external-edit  overwrite a page a human genuinely edited since slopweaver last wrote it;\n" +
  "                requires a reason, journaled with who last edited the page and when. A byte-identical\n" +
  "                touch (a display toggle) needs no flag at all — it is not treated as an edit\n" +
  "  --dry-run     print the resolved destination and the exact markdown that would be sent, no effect";

export const notionManifest: Readonly<Record<string, VerbManifestEntry>> = {
  attach: lazy({
    load: () => import("../commands/notion/mediaRun.js").then((m) => m.notionAttachCommand),
    meta: {
      // Nothing new appears in anyone's sidebar: this finishes a page that already exists.
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver notion attach --page <page-url> --from draft.md --dry-run",
      parseRejectIsIoFree: true,
      summary: "Upload a markdown body's local images and PDFs into Notion, each at its placeholder's position",
      usage: ATTACH_USAGE,
    },
  }),
  page: lazy({
    load: () => import("../commands/notion/pageRun.js").then((m) => m.notionPageCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver notion page create --parent <page-url> --title 'Draft' --body draft.md --dry-run",
      parseRejectIsIoFree: true,
      summary: "Create, replace, move or archive one page — rendered by code, through the door",
      usage: PAGE_USAGE,
    },
  }),
  verify: lazy({
    load: () => import("../commands/notion/verifyRun.js").then((m) => m.notionVerifyCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      // With `--observation`, `runNotionVerify` creates its screenshot directory before judging. It launches no browser.
      effect: "local-state",
      example: "slopweaver notion verify <page-url>",
      parseRejectIsIoFree: true,
      summary: "Brief a published page's render check for your own Chrome, then judge the observation it returns",
      usage: VERIFY_USAGE,
    },
  }),
  read: lazy({
    load: () => import("../commands/providerRead/run.js").then((m) => m.notionReadCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver notion read <page-url> --json",
      parseRejectIsIoFree: true,
      summary: "Read one current page or database object with explicit body and traversal bounds",
      usage: READ_USAGE,
    },
  }),
};
