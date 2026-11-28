/**
 * The creation door's two "show me the shape" flags — `--form-example`/`--file-example`, read by
 * `github stack push`. Split out purely to keep that verb's own file under the line-count ceiling.
 */
import { renderAuthoringFile } from "../../../outbound/github/authoringFile.js";
import { EXAMPLE_PR_FORM } from "../../../outbound/github/formExample.js";
import { prVoiceBriefLines } from "../../../outbound/github/voiceBrief.js";

/**
 * Print the voice brief, then a blank line, before either example: the example is what a composer reads
 * before drafting, so the brief rides it the way `slack voice-rules` rides a Slack draft.
 *
 * @param deps the output sink
 */
function printVoiceBrief({ deps }: { deps: { out: (args: { line: string }) => void } }): void {
  for (const line of prVoiceBriefLines({})) {
    deps.out({ line });
  }
  deps.out({ line: "" });
}

/**
 * Print the one canonical example form — the same object the CLI tests assert is valid — and exit.
 *
 * No token, no network, no filesystem beyond stdout: this is the answer to "what shape does `--form` want",
 * not a preview of a real invocation.
 *
 * @param deps the output sink
 */
function printFormExample({ deps }: { deps: { out: (args: { line: string }) => void } }): void {
  printVoiceBrief({ deps });
  deps.out({
    line:
      'a complete, valid --form (inline runs use kind "text"|"strong"|"em"|"code"|"link"; a proof slot is ' +
      '{"kind":"reason",...}, {"kind":"screenshot",...} with an image hosted by `slopweaver github attach`, or ' +
      '{"kind":"quote",...} holding text output verbatim; ' +
      "the badges are derived, never written):",
  });
  deps.out({ line: JSON.stringify(EXAMPLE_PR_FORM, null, 2) });
}

/**
 * Print the one canonical example authoring file — `--form-example`'s counterpart for `--file` — and exit.
 *
 * No token, no network, no filesystem beyond stdout: the answer to "what shape does `--file` want".
 *
 * @param deps the output sink
 */
function printFileExample({ deps }: { deps: { out: (args: { line: string }) => void } }): void {
  printVoiceBrief({ deps });
  deps.out({
    line: "a complete, valid --file (a markdown+frontmatter authoring file, the human-editable alternative to --form's JSON):",
  });
  deps.out({ line: renderAuthoringFile({ form: EXAMPLE_PR_FORM }) });
}

/**
 * Print whichever example the caller asked for, or neither. The creation door's two "show me the shape"
 * flags.
 *
 * @param args whether `--form-example`/`--file-example` were given
 * @param deps the output sink
 * @returns whether an example was printed (the caller should exit)
 */
export function printedExample({
  args,
  deps,
}: {
  args: { readonly formExample: boolean; readonly fileExample: boolean };
  deps: { out: (args: { line: string }) => void };
}): boolean {
  if (args.formExample) {
    printFormExample({ deps });
    return true;
  }
  if (args.fileExample) {
    printFileExample({ deps });
    return true;
  }
  return false;
}
