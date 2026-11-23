/**
 * The usage line of `slopweaver doctor`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/doctor.ts` reads it on every invocation, so it must not pull the command
 * module onto every invocation's load path (`src/__tests__/unit/cli/manifestBarrelClosure.test.ts`).
 */

/** The usage block, printed by `--help`. */
export const DOCTOR_USAGE =
  "usage: slopweaver doctor [--deep] [--json]\n" +
  "  Can this machine run Slopweaver, and what state is its home in. Exits 3 when an environment probe is FATAL.\n" +
  "  --deep   also run the probes that cost a subprocess or a socket: `gh auth token`, a cmux socket ping,\n" +
  "           and an interactive zsh startup (which runs your whole profile)\n" +
  "  --json   the machine-readable report onboarding branches on";
