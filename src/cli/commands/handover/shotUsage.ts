/** `slopweaver handover shot`'s help — a leaf, so `./shotRun.ts` holds only the run and the manifest can quote it. */

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const SHOT_USAGE =
  "usage: slopweaver handover shot <slug> --shot <png> --box <x,y,width,height=label> [--box ...] " +
  "[--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Gives an OPEN ask the picture its Queue card shows, with a red box and a short label on each part the owner is meant\n" +
  "to read — the field that is stale, the number to look at. A picture is attached here, never named as a path\n" +
  "in the card's prose, which the recording verbs refuse.\n" +
  "\n" +
  "  --shot  the PNG, stored 0600 under the home by its SHA-256 before the row names it\n" +
  "  --box   one region in IMAGE pixels and its label, at most 60 characters: `120,80,300,40=stale`. Repeat it,\n" +
  "          1 to 9 times, in the order the card numbers them; refused outside the picture or with no --box\n" +
  "\n" +
  "Replaces whatever picture the row carried. A run parked on the owner takes it in its journal, bound to the open\n" +
  "question; a registered ask takes it in its front matter. A row not open on the owner is refused. Needs no claim.\n" +
  "\n" +
  "example: slopweaver handover shot vanta-evidence --shot ~/shots/net-93.png --box 40,212,380,36=stale";
