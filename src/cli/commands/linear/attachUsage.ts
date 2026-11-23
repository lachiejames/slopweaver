/**
 * `slopweaver linear attach`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/linear.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

import { ACKNOWLEDGEMENT_MIN_WORDS } from "../../../admit/inventedVisual.js";

/** `slopweaver linear attach`'s usage line. */
export const LINEAR_ATTACH_USAGE =
  "usage: slopweaver linear attach upload --file <path> [--alt <text>] [--acknowledge <reason>] " +
  "[--dry-run] [--json] [--home <dir>]\n" +
  "  upload             upload one local image, video or PDF to Linear's own asset storage and print the\n" +
  "                     permanent URL, plus the `media` block that embeds it in a comment, issue or\n" +
  "                     project-update form. No browser and no cookies — Linear's `fileUpload` mutation\n" +
  "                     takes the same API key every other verb on this noun uses\n" +
  "  --file <path>      the local file. Extension picks the content type; png, jpg, jpeg, gif, webp, pdf,\n" +
  "                     mp4, mov and webm are accepted. SVG is not — Linear renders one as a download\n" +
  "  --alt <text>       alt text for the printed media block (default the file's own name)\n" +
  "  --acknowledge <reason>  send a visual the invented-visual gate refuses — a shot of a page served from\n" +
  "                     this machine, a page or vector handed to an image slot, or a chart a plotting\n" +
  "                     library drew. Takes the REASON the real surface was unavailable, in at least\n" +
  `                     ${String(ACKNOWLEDGEMENT_MIN_WORDS)} words; the door records that the gate was waived\n` +
  "  --dry-run          classify the file and print the plan. Fully offline — no door record, nothing sent\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home holding the Linear credential and the door ledger";
