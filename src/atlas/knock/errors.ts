/**
 * The typed refusals a walk of the Knock dashboard authors before it visits a single page: a dashboard the
 * root probe could not reach, and one that answered with its sign-in wall.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to `src/atlas/knock/`. The root probe
 * answers the page-walk kit's `readonly string[]` seam, so each refusal is built here and turned into the
 * lines that seam carries by {@link knockAtlasErrorLines}, where it is authored. The publish lock's refusal
 * is not here: this atlas takes the kit's own lock, whose refusal is the kit's.
 *
 * No variant carries the account or environment slug. The probe asks for the bare origin, so the transport
 * reason it quotes names neither; `detail` is that reason and nothing else.
 *
 * Pure: values in, values out.
 */

/** A refusal said in one sentence. */
interface OneLine<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A refusal said over several lines, each printed on its own. */
interface ManyLines<C extends string> extends OneLine<C> {
  readonly reasons: readonly string[];
}

/**
 * Every refusal a Knock dashboard walk authors.
 * @internal
 */
export type KnockAtlasError = (OneLine<"ROOT_UNREACHABLE"> & { readonly detail: string }) | ManyLines<"SIGNED_OUT">;

/** How each refusal is raised — the one place its words live, so a test built from it catches a drift. */
export const KnockAtlasErrors = {
  rootUnreachable: ({ detail }: { detail: string }): KnockAtlasError => ({
    code: "ROOT_UNREACHABLE",
    detail,
    message: `could not reach the Knock dashboard to learn its account root: ${detail}`,
  }),
  signedOut: (): KnockAtlasError => {
    const reasons = [
      "the Knock dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Knock dashboard in your own Chrome and run the walk again",
    ];
    return { code: "SIGNED_OUT", message: reasons.join("; "), reasons };
  },
} as const;

/**
 * The lines a {@link KnockAtlasError} prints: the sign-in refusal's two reasons one per line, as the
 * `readonly string[]` it replaced did, and the unreachable dashboard as its one sentence.
 *
 * @param error the dashboard walk's refusal being printed
 * @returns one line per reason, in the order they are read
 */
export function knockAtlasErrorLines({ error }: { error: KnockAtlasError }): readonly string[] {
  if (error.code === "SIGNED_OUT") {
    return error.reasons;
  }
  return [error.message];
}
