/**
 * The escape-hatch rows for the PROOF CAPTURE surface — the verbs that write a screenshot or a recording for a
 * pull request's Proof cell, and the local page that carries them to the owner.
 *
 * A file rather than a section of `./registry.ts` for the reason `./codexPassHatches.ts` gives: the register
 * sheds a whole surface to a sibling, and `ESCAPE_HATCHES` spreads it back in, so there is still one register.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the proof capture surface. */
export const PROOF_CAPTURE_HATCHES = [
  {
    caught:
      "the capture would be written inside a git checkout, where it can be committed into a pull request; proof output is written outside every checkout",
    command:
      "slopweaver <proof yarn-why|proof cassette|browser shot|browser act|browser console-shot|slack shot|datadog shot|notion verify> --out",
    exceptions: ["the checkout is a throwaway fixture repository minted for this one capture and deleted with it"],
    id: "proof-output-in-tree",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PROOF_OUTPUT_IN_TREE" },
    lane: "ambient",
    reader: "src/proofPath/outputGuardEffects.ts",
    standing: "proposed",
  },
  {
    caught:
      "the tape types slower than 10ms a character, so a reader sits through the typing with no way to skip it (measured: fifteen seconds to type one prompt)",
    command: "slopweaver proof cassette",
    exceptions: [
      "the typing speed IS the claim — the change under proof is how a UI reacts to human-speed keystrokes, such as a debounce or an autocomplete",
    ],
    id: "slow-cassette",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_SLOW_CASSETTE" },
    lane: "ambient",
    reader: "src/cli/commands/proof/cassette.ts",
    standing: "proposed",
  },
  {
    caught:
      "the page carries an image the console cannot load, a machine timestamp in its prose, an identifier or URL that is not a link, or a raw session, call, turn or run id, and the owner reads it in the console, where a broken image, a clock stamp, a bare ticket key and a uuid are all they see",
    command: "slopweaver page publish",
    exceptions: [
      "the page is ABOUT a timestamp format, a log line or a payload, and the raw stamp in running text is the subject rather than a way of telling the time",
      "the image is published into the page directory by a later step of the same run, and the page is republished once it is there",
      "the identifier names something with no address anywhere — a Linear key in a workspace this install cannot read — and the page says so beside it",
    ],
    id: "page-lint",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PAGE_LINT" },
    lane: "ambient",
    reader: "src/cli/commands/page/publishRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
