/*
 * The structured-form fixture and the failure-message extractor every split Linear issue schema test reads.
 */

/**
 * A valid structured issue form, with the named fields replaced or added.
 *
 * @returns the enforced structured shape with each override spread over it
 */
export function structured(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    aiPrompt: [{ kind: "para", text: "**Goal.** Fix it." }],
    kind: "structured",
    problem: [{ kind: "para", text: "It is broken." }],
    solution: [{ kind: "para", text: "Unbreak it." }],
    ...overrides,
  };
}

/**
 * The first issue's message, resolved without a conditional so a wrong-branch pass is impossible.
 *
 * @returns the message of the first issue a failed parse reported
 */
export function firstMessage({
  result,
}: {
  result: { success: boolean; error?: { issues: { message: string }[] } };
}): string {
  return result.error!.issues[0]!.message;
}
