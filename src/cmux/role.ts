/**
 * What KIND of session a cmux row is, and the colour that says so.
 *
 * The owner runs seventeen workspaces at once and every row renders identically. A workspace already carries
 * a colour field (`cmux workspace-action --action set-color`) and nothing was using it. This module decides
 * what that colour MEANS, once, so that spawn can set it and no call site has to invent one.
 *
 * **The distinction the colour draws is STANDING versus SPAWNED**, and it is the owner's own, ruled
 * after seeing the alternative rendered on the real fleet. Three surfaces are always on: the
 * supervisor the owner types into, the bot's Slack loop, and the recipe scheduler. Everything else is a workstream
 * session that was opened for one piece of work and will be closed again. Only the standing three carry a
 * colour; every spawned row is left plain.
 *
 * **The plain majority is the design, not a gap.** An earlier version of this file split the spawned rows
 * further — team-facing work in one colour, the owner's own tooling in another, the loop's ask and review
 * workers in a third. Photographed on the live sidebar it was too much colour to read, and the ruling
 * retired the team/tooling split outright on the grounds that those two are becoming the same thing. What
 * survives is stronger: a colour on a row means _this one is always running_, and nothing else has to be
 * inferred to know that.
 *
 * **Colour means role, and can never also mean urgency.** The lane glyph already carries urgency, and a
 * field with two meanings has none. That is why there is no `"blocked"` or `"failing"` role here.
 */

/**
 * The kinds of session worth telling apart on sight.
 *
 * Three standing surfaces and one catch-all. `session` is not a fallback that failed to classify — it is the
 * positive statement that a row is temporary, which is the whole content of the signal.
 */
export const SESSION_ROLES = ["supervisor", "bot", "scheduler", "session"] as const;

/** One of {@link SESSION_ROLES}. */
export type SessionRole = (typeof SESSION_ROLES)[number];

/**
 * The cmux named colour each role wears, or `undefined` for the roles that deliberately wear none.
 *
 * Every value is a name from cmux's own sixteen-colour palette, passed to `--color` verbatim rather than as
 * a hex, so the palette stays cmux's to change. The three are chosen against each other: green for the loop
 * because the only thing worth reading off it is whether it is running, teal beside it for the scheduler
 * because that is also autonomous and also on a clock but is plainly not the bot, and indigo well away from
 * both for the one row the owner types into.
 */
export const SESSION_ROLE_COLOURS: Readonly<Record<SessionRole, string | undefined>> = {
  bot: "Green",
  scheduler: "Teal",
  session: undefined,
  supervisor: "Indigo",
} as const;

/**
 * Whether a string is one of {@link SESSION_ROLES} — the guard a hand-written `role:` front-matter line has
 * to pass before anything downstream trusts it.
 *
 * @param value the candidate, straight off a doc's front matter
 * @returns true when `value` names a real role
 */
export function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === "string" && (SESSION_ROLES as readonly string[]).includes(value);
}

/**
 * Decide one workspace's role.
 *
 * Two tiers, first match wins, and there is no third:
 *
 * 1. **`declared`** — the call site knows outright, because the standing surfaces are each opened by a
 *    command that IS that surface: the scheduler's own plan builder, and a session booting the loop skill.
 * 2. **`docRole`** — a `role:` line in the handover doc, for a standing surface opened from a doc rather
 *    than from code. The loop's own doc is the live case.
 *
 * Anything else is `session`, and that is an answer rather than a failure to reach one. There is deliberately
 * no inference layer: an earlier version read the role off which repository the doc named, in order to split
 * team-facing work from the owner's own tooling. The ruling collapsed those two, which left that tier with
 * nothing to decide, so it is gone. A rule that infers nothing cannot infer wrongly, and a wrong colour is
 * worse than no colour because it is still believed.
 *
 * @param declared the role the call site knows for certain, when it knows one
 * @param docRole the role the handover doc's own front matter declares, when it declares one
 * @returns the role to colour the row by
 */
export function classifySessionRole({
  declared,
  docRole,
}: {
  declared?: SessionRole | undefined;
  docRole?: SessionRole | undefined;
}): SessionRole {
  if (declared !== undefined) {
    return declared;
  }
  if (docRole !== undefined) {
    return docRole;
  }
  return "session";
}

/**
 * The cmux named colour for a role, or `undefined` when the role wears none.
 *
 * A thin lookup rather than a raw index, so a caller reads the intent instead of learning that `undefined`
 * in the table means "leave this row plain".
 *
 * @param role the role to colour
 * @returns the cmux colour name, or `undefined` to leave the row uncoloured
 */
export function colourForRole({ role }: { role: SessionRole }): string | undefined {
  return SESSION_ROLE_COLOURS[role];
}
