/**
 * The argv `sweep apply` hands one register verb in process, and the line its ledger row records for that call.
 */

/** One register verb's argv, and the line the ledger records for it. */
export interface RegisterVerbCall {
  readonly argv: readonly string[];
  readonly line: string;
}

/**
 * The argv one register verb expects, padded to the position its own runner slices from.
 *
 * Every `handover` runner takes the WHOLE process argv and slices `VERB_ARG_OFFSET` off the front, so calling
 * one in process means handing it an argv shaped the way the router would have. The two leading placeholders
 * stand for `node` and the entry script, and are never read.
 *
 * @param verb the handover verb to run
 * @param rest that verb's own arguments
 * @returns the argv to pass, and the line to journal
 */
export function registerVerbArgv({ verb, rest }: { verb: string; rest: readonly string[] }): RegisterVerbCall {
  return {
    argv: ["node", "slopweaver", "handover", verb, ...rest],
    line: `slopweaver handover ${verb} ${rest.join(" ")}`,
  };
}
