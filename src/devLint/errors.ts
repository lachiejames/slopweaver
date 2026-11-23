/**
 * The typed failures a lint gate's INPUT can raise — a committed debt list or floor file that is missing, will
 * not parse or has the wrong shape, and a register a gate reads out of a test file that has moved.
 *
 * A union of its own per `.claude/rules/error-handling.md`. It is deliberately NOT how a gate refuses: a
 * policy refusal renders through `lintGateRefusal` and is classified by `gateOutcome`
 * (`refusal/render.ts`), and nothing here reaches either. These are FACTS — an input the gate never saw —
 * which each gate's runner prints as `<gate>: <message>` and exits 1. Every variant is one sentence, so a
 * caller displays `message` and branches on `code`.
 *
 * Pure: values in, values out.
 */

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure about one committed input, named by how its gate labels it. */
interface Labelled<C extends string> extends Plain<C> {
  readonly label: string;
}

/** Every failure a lint gate's input raises. */
export type DevLintInputError =
  | (Labelled<"BASELINE_MALFORMED"> & { readonly detail: string })
  | (Labelled<"BASELINE_SHAPE_INVALID"> & { readonly expected: string })
  | Labelled<"OFFENDER_LIST_INVALID">
  | (Plain<"BASELINE_UNREADABLE"> & { readonly kind: CommittedInputKind; readonly path: string })
  | (Plain<"REGISTER_DECLARATION_MISSING"> & { readonly path: string; readonly declaration: string })
  | (Plain<"REGISTER_EMPTY"> & { readonly path: string })
  | (Labelled<"TRADEOFF_PATH_DUPLICATE"> & { readonly path: string });

/** How a gate names the committed file it reads: measured state, a debt list, or a register of owner approvals. */
export type CommittedInputKind = "floor file" | "debt list" | "tradeoff register";

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DevLintInputErrors = {
  baselineMalformed: ({ detail, label }: { detail: string; label: string }): DevLintInputError => ({
    code: "BASELINE_MALFORMED",
    detail,
    label,
    message: `${label}: ${detail}`,
  }),
  baselineShapeInvalid: ({ expected, label }: { expected: string; label: string }): DevLintInputError => ({
    code: "BASELINE_SHAPE_INVALID",
    expected,
    label,
    message: `${label}: unexpected shape (expected ${expected})`,
  }),
  baselineUnreadable: ({ kind, path }: { kind: CommittedInputKind; path: string }): DevLintInputError => ({
    code: "BASELINE_UNREADABLE",
    kind,
    message: `${kind} missing or unreadable at ${path}`,
    path,
  }),
  offenderListInvalid: ({ label }: { label: string }): DevLintInputError => ({
    code: "OFFENDER_LIST_INVALID",
    label,
    message: `${label}: expected { "offenders": string[] }`,
  }),
  registerDeclarationMissing: ({ declaration, path }: { declaration: string; path: string }): DevLintInputError => ({
    code: "REGISTER_DECLARATION_MISSING",
    declaration,
    message: `${path} no longer declares \`${declaration}\``,
    path,
  }),
  registerEmpty: ({ path }: { path: string }): DevLintInputError => ({
    code: "REGISTER_EMPTY",
    message: `${path}'s UNGUARDED register parsed as empty`,
    path,
  }),
  tradeoffPathDuplicate: ({ label, path }: { label: string; path: string }): DevLintInputError => ({
    code: "TRADEOFF_PATH_DUPLICATE",
    label,
    message: `${label}: ${path} has more than one row, and one file has one recorded tradeoff`,
    path,
  }),
} as const;
