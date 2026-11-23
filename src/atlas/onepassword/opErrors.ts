/**
 * The typed failures of the `op` boundary — `opCli.ts`'s allowlist and argv checks, its subprocess call, and
 * the account guard in `credentials.ts` that decides what may become an `--account` argv element.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside the Events API and generation unions
 * rather than inside one of them: nothing that runs `op` also reads the Events API or writes a generation.
 * A variant carrying `reasons` keeps one line per problem, and {@link onepasswordOpErrorLines} is how a
 * caller prints them without re-composing the joined `message`.
 *
 * No variant carries the child's environment (it holds the `op` session), the full argv with its
 * `--account`, or `op`'s stdout (credential-store output) — only the allowlisted argv and the lines the
 * boundary has always printed.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "../../lib/errorMessage.js";

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** Every way the `op` boundary can refuse or fail a call. */
export type OnepasswordOpError =
  | (Plain<"ACCOUNT_MALFORMED"> & { readonly name: string })
  | (Listed<"SURFACE_NOT_ALLOWED"> & { readonly surface: string })
  | (Plain<"PARENT_ID_MISSING"> & { readonly surface: string })
  | (Plain<"PARENT_ID_UNEXPECTED"> & { readonly surface: string })
  | (Plain<"ID_MALFORMED"> & { readonly id: string })
  | (Listed<"CALL_FAILED"> & { readonly argv: readonly string[] })
  | (Listed<"OUTPUT_UNPARSEABLE"> & { readonly argv: readonly string[] })
  | (Plain<"SIGNIN_OUTPUT_UNPARSEABLE"> & { readonly exportLines: number });

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const OnepasswordOpErrors = {
  accountMalformed: ({ name }: { name: string }): OnepasswordOpError => ({
    code: "ACCOUNT_MALFORMED",
    message: `${name} is not a plain account shorthand or sign-in address — refusing to put it in an argv`,
    name,
  }),
  callFailed: ({
    argv,
    stderr,
    cause,
  }: {
    argv: readonly string[];
    stderr: string;
    cause: unknown;
  }): OnepasswordOpError => ({
    ...listed({
      code: "CALL_FAILED",
      reasons: [
        `op ${argv.join(" ")} failed`,
        ...(stderr.trim() === "" ? [] : [`  ${stderr.trim().split("\n").slice(0, 4).join(" / ")}`]),
        `  ${errorMessage({ error: cause })}`,
      ],
    }),
    argv,
  }),
  idMalformed: ({ id }: { id: string }): OnepasswordOpError => ({
    code: "ID_MALFORMED",
    id,
    message: `refusing to put "${id}" in an \`op\` argv: it is not shaped like a 1Password identifier`,
  }),
  outputUnparseable: ({ argv }: { argv: readonly string[] }): OnepasswordOpError => ({
    ...listed({
      code: "OUTPUT_UNPARSEABLE",
      reasons: [
        `op ${argv.join(" ")} returned output this atlas could not parse as JSON`,
        "the output is deliberately not printed — it came from a credential store",
      ],
    }),
    argv,
  }),
  parentIdMissing: ({ surface }: { surface: string }): OnepasswordOpError => ({
    code: "PARENT_ID_MISSING",
    message: `the ${surface} surface is a per-parent call and was given no parent id`,
    surface,
  }),
  parentIdUnexpected: ({ surface }: { surface: string }): OnepasswordOpError => ({
    code: "PARENT_ID_UNEXPECTED",
    message: `the ${surface} surface takes no parent id but was given one`,
    surface,
  }),
  signinOutputUnparseable: ({ exportLines }: { exportLines: number }): OnepasswordOpError => ({
    code: "SIGNIN_OUTPUT_UNPARSEABLE",
    exportLines,
    message: `op signin printed ${String(exportLines)} \`export OP_SESSION_…\` line(s), not exactly one — the output is deliberately not printed, it carries a session token`,
  }),
  surfaceNotAllowed: ({ surface }: { surface: string }): OnepasswordOpError => ({
    ...listed({
      code: "SURFACE_NOT_ALLOWED",
      reasons: [
        `refusing to run \`op\` for the surface "${surface}": it is not in the closed command allowlist`,
        "every provider call this atlas may make is named in inventory.ts — adding one is a deliberate change, not a parameter",
      ],
    }),
    surface,
  }),
} as const;

/**
 * The lines one failure prints, exactly as the boundary returned them before it had a type: a list-carrying
 * failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function onepasswordOpErrorLines({ error }: { error: OnepasswordOpError }): readonly string[] {
  if (error.code === "SURFACE_NOT_ALLOWED" || error.code === "CALL_FAILED" || error.code === "OUTPUT_UNPARSEABLE") {
    return error.reasons;
  }
  return [error.message];
}
