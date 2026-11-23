/**
 * A noun's earlier name, still answering.
 *
 * `recipe` is the automations noun's earlier name, kept answering so that nothing breaks. Hundreds of handover docs, board rows and transcripts print
 * `slopweaver recipe <verb>`, and a session copies such a line verbatim, so the old noun answers for as long
 * as anything on disk still says it. Dispatch rewrites the noun once, ahead of everything that reads it, so
 * every downstream reader — the ruling gate, help, the stale-seat warning, the verb itself — sees one name.
 *
 * Pure: no I/O.
 */

/** Every noun alias, old name to the noun it now means. */
export const NOUN_ALIASES: Readonly<Record<string, string>> = {
  recipe: "automation",
};

/**
 * The noun a word names, with an alias resolved.
 *
 * @param noun a noun as typed, old or current
 * @returns the current noun, or the word unchanged when it is no alias
 */
export function canonicalNoun({ noun }: { noun: string }): string {
  return Object.hasOwn(NOUN_ALIASES, noun) ? NOUN_ALIASES[noun]! : noun;
}

/**
 * The process argv with its noun (`argv[2]`) resolved through {@link NOUN_ALIASES}.
 *
 * @param argv the full process argv ([node, cli, noun, verb, …])
 * @returns the same argv when its noun is current, else a copy naming the current noun
 */
export function canonicalArgv({ argv }: { argv: readonly string[] }): readonly string[] {
  const noun = argv[2];
  if (noun === undefined || !Object.hasOwn(NOUN_ALIASES, noun)) {
    return argv;
  }
  return [...argv.slice(0, 2), canonicalNoun({ noun }), ...argv.slice(3)];
}
