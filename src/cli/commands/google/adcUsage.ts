/**
 * `google adc`'s usage text — a leaf, so the manifest barrel can quote it without loading the command.
 */

/** The one usage line the manifest and the verb both print. */
export const GOOGLE_ADC_USAGE_LINE =
  "usage: slopweaver google adc [--row <slug>] [--unblocks <text>] [--cites <url,url>] [--context work|slopweaver] [--wait] [--timeout-seconds <n>] [--home <dir>]";

/** The whole usage, printed on `--help` and on a parse error. */
export const GOOGLE_ADC_USAGE =
  `${GOOGLE_ADC_USAGE_LINE}\n` +
  "  Read whether Google Application Default Credentials work on this machine, WITHOUT running a sign-in.\n" +
  "  A seat never runs `gcloud auth application-default login` itself: its localhost redirect listener dies\n" +
  "  with the seat's shell, and the owner's sign-in then lands on a broken page. When a sign-in is the fix, this prints\n" +
  "  the one `hand post` line for the supervisor (the owner's floating note carries the command to their own terminal)\n" +
  "  and exits 3. --wait reads until the credential works, noticing the owner's sign-in within seconds of the file\n" +
  "  changing; run it in the BACKGROUND with a long --timeout-seconds (e.g. 28800) so its completion resumes\n" +
  "  you. Exits 0 valid, 3 a sign-in is needed, 4 still waiting at the timeout, 1 a failure a sign-in cannot fix.";
