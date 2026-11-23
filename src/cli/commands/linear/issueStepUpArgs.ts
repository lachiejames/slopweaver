/**
 * The `linear issue` flags graduated autonomy for Linear added: `--unasked` with the three accounts its autonomy-ledger row carries, `--rewrite-filed` with the
 * instant it is conditional on, and `--move-team`. Pure — it reads parsed flag values and returns either the
 * typed arguments or every reason they do not stand together.
 *
 * Its own module because `./core.ts` sits on the file-size ratchet's debt list.
 */

/**
 * The three accounts of an act taken without asking, as the autonomy ledger wants them: `why` for the next
 * session, `said` for them, `bySession` for provenance. See `skills/autonomy/SKILL.md`.
 */
export interface UnaskedNote {
  readonly why: string;
  readonly said: string;
  readonly bySession: string;
}

/** The parsed step-up arguments, or the reasons they were refused. */
export interface IssueStepUpArgs {
  readonly moveTeam: boolean;
  /**
   * Replace the body of an issue slopweaver did NOT create, conditional on the issue's `updatedAt` still being
   * the instant the session read it at. Undefined when the flag is absent.
   */
  readonly rewriteFiled: { readonly expectUpdatedAt: string } | undefined;
  /** Present when the write is an act taken without asking, and so journalled. */
  readonly unasked: UnaskedNote | undefined;
}

/** A flag's string value, or undefined. */
function text({ values, name }: { values: Readonly<Record<string, unknown>>; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Every reason `--rewrite-filed` and `--move-team` do not stand with the rest of the invocation.
 *
 * @param verb which of `create`/`update` was invoked — both flags are update-only
 * @param fieldsOnly whether `--fields-only` was given, which sends no body for `--rewrite-filed` to replace
 * @param rewriteFiled whether `--rewrite-filed` was given
 * @param moveTeam whether `--move-team` was given
 * @param expectUpdatedAt the `--expect-updated-at` value
 * @returns one line per refusal
 */
function updateOnlyErrors({
  verb,
  fieldsOnly,
  rewriteFiled,
  moveTeam,
  expectUpdatedAt,
}: {
  verb: "create" | "update";
  fieldsOnly: boolean;
  rewriteFiled: boolean;
  moveTeam: boolean;
  expectUpdatedAt: string | undefined;
}): readonly string[] {
  const errors: string[] = [];
  if (verb === "create" && (rewriteFiled || moveTeam)) {
    errors.push("--rewrite-filed and --move-team act on an existing issue, so they are update-only");
  }
  if (rewriteFiled && fieldsOnly) {
    errors.push("--rewrite-filed replaces the body and --fields-only sends none; pick one");
  }
  if (rewriteFiled && expectUpdatedAt === undefined) {
    errors.push(
      "--rewrite-filed needs --expect-updated-at <iso>: the issue's updatedAt as you read it (`linear read <id> --json`), so an edit made since refuses the write",
    );
  }
  if (!rewriteFiled && expectUpdatedAt !== undefined) {
    errors.push("--expect-updated-at only conditions a --rewrite-filed write");
  }
  return errors;
}

/**
 * Every reason the `--unasked` accounts do not stand: all three or none, and none without `--unasked`.
 *
 * @param unasked whether `--unasked` was given
 * @param accounts the three account flags' values
 * @returns one line per refusal
 */
function unaskedErrors({
  unasked,
  accounts,
}: {
  unasked: boolean;
  accounts: {
    readonly why: string | undefined;
    readonly said: string | undefined;
    readonly bySession: string | undefined;
  };
}): readonly string[] {
  const given = [accounts.why, accounts.said, accounts.bySession].filter((value) => value !== undefined).length;
  if (unasked && given < 3) {
    return [
      "--unasked journals the act to the autonomy ledger, so --why, --said and --by-session are all required with it",
    ];
  }
  if (!unasked && given > 0) {
    return [
      "--why, --said and --by-session are the accounts of an --unasked act; without --unasked nothing is journalled",
    ];
  }
  return [];
}

/**
 * The `--unasked` note out of parsed flag values: all three accounts with the flag, none without it.
 *
 * Shared by every Linear verb that journals an unasked act, so `linear issue` and `linear team-membership`
 * refuse the same half-given note in the same words.
 *
 * @param values the flag values `parseFlags` produced
 * @returns the note when `--unasked` was given whole, plus every refusal
 */
export function unaskedNoteOf({ values }: { values: Readonly<Record<string, unknown>> }): {
  readonly note: UnaskedNote | undefined;
  readonly errors: readonly string[];
} {
  const unasked = values["unasked"] === true;
  const accounts = {
    bySession: text({ name: "by-session", values }),
    said: text({ name: "said", values }),
    why: text({ name: "why", values }),
  };
  const note =
    unasked && accounts.why !== undefined && accounts.said !== undefined && accounts.bySession !== undefined
      ? { bySession: accounts.bySession, said: accounts.said, why: accounts.why }
      : undefined;
  return { errors: unaskedErrors({ accounts, unasked }), note };
}

/**
 * Parse the step-up flags out of an already-parsed `linear issue` invocation.
 *
 * @param values the flag values `parseFlags` produced
 * @param verb which of `create`/`update` was invoked
 * @param fieldsOnly whether `--fields-only` was given
 * @returns the typed arguments plus every refusal, accumulated rather than short-circuited
 */
export function issueStepUpArgsOf({
  values,
  verb,
  fieldsOnly,
}: {
  values: Readonly<Record<string, unknown>>;
  verb: "create" | "update";
  fieldsOnly: boolean;
}): { readonly args: IssueStepUpArgs; readonly errors: readonly string[] } {
  const rewriteFiled = values["rewrite-filed"] === true;
  const moveTeam = values["move-team"] === true;
  const expectUpdatedAt = text({ name: "expect-updated-at", values });
  const unasked = unaskedNoteOf({ values });
  const errors = [
    ...updateOnlyErrors({ expectUpdatedAt, fieldsOnly, moveTeam, rewriteFiled, verb }),
    ...unasked.errors,
  ];
  const note = unasked.note;
  return {
    args: {
      moveTeam,
      rewriteFiled: rewriteFiled && expectUpdatedAt !== undefined ? { expectUpdatedAt } : undefined,
      unasked: note,
    },
    errors,
  };
}
