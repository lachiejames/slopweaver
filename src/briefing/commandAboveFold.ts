/**
 * The one rule about WHERE a command the owner has to type may sit: never only behind a click.
 *
 * A me-facing card that asks the owner to mint a setup token and puts both commands in its `detail` field
 * leaves the command unfindable when the projection drops that field (`./openPageCards.ts`): the rendered card
 * shows six cells and no fold at all, while its `what` still says "the two commands in the detail".
 *
 * Carrying `detail` through fixes a dropped fold. It does not fix the card, because a command behind a
 * `<details>` is still a command the owner has to go looking for — and the whole reason the owner is reading a
 * me-facing card is that the next step is in their hands. So the fold is where the EXPLANATION goes and the
 * command itself belongs above it, stated once in the cells the owner cannot avoid.
 *
 * ## The criterion is STRUCTURAL first, lexical second — and the other way round does not survive measurement
 *
 * The obvious rule is lexical: a known command head followed by a subcommand, matched anywhere in the card's
 * text. MEASURED over every JSON document in one supervisor-scratch handoff directory under
 * `$SLOPWEAVER_HOME/supervisor-scratch`, that criterion matches `slopweaver and`, `slopweaver at`, `slopweaver against`, `slopweaver as`,
 * `slopweaver runs`, `claude code`, `claude session` and `git watch` — 14 hits on `open-pages.json` alone and
 * not one of them a command. Reproduce it by grepping that directory for those phrases; every one is prose.
 *
 * So the first test is the run's KIND. A `code` run is the vocabulary's own way of saying "this is a literal
 * you type" (`../outbound/briefing/types.ts`'s `BriefingInline`), and a composer writing prose about the
 * slopweaver verbs never reaches for it. The lexical half then only has to separate a command from an
 * identifier, which is what {@link COMMAND_HEADS} and the two-token floor do.
 *
 * ## The two sides of the comparison are deliberately different shapes
 *
 * A command is found as a `code` RUN and looked for as PLAIN TEXT. That asymmetry is required rather than
 * sloppy: an open-page card's above-the-fold cells are plain strings turned into one text run by
 * `./openPageCards.ts`, so they can never carry a `code` run at all, and a rule demanding one above the fold
 * would be unsatisfiable for exactly the card class that caused the incident.
 *
 * ## The trade it takes, and the escape written into the shape
 *
 * Reading every `code` run refuses a fold that cites a command as EVIDENCE — "the failing step was
 * `yarn validate`" — as readily as one that hides an instruction, because nothing decidable separates the
 * two. That is the same trade `./ownHandAction.ts` takes, and like that rule the escape is part of the
 * shape rather than a marker: a command a session already ran is not a literal the owner types, so it is not a
 * `code` run at all. Write it as plain text and this rule never sees it. The refusal says so, because an
 * escape a composer has to infer is one they will instead satisfy by surfacing a command the owner does not need.
 *
 * Pure: text in, the hidden command or `undefined` out. No I/O, no clock.
 */

import type { BriefingContent, BriefingFold } from "../outbound/briefing/types.js";

/**
 * The command heads this rule recognises — the tools the fleet actually hands the owner.
 *
 * A closed list rather than "any first word", because the point is to tell a command from an identifier and
 * an unknown head is far more likely to be the latter. Missing one costs a refusal that does not fire;
 * admitting every word costs a refusal that fires on `plan-four`.
 *
 * `mdutil`, `launchctl` and `defaults` are here because a page once handed the owner all three by hand, not
 * because a macOS tool belongs on a fleet's list by default. The cloud clients (`aws`,
 * `gcloud`, `op`, `psql`, `supabase`) are the ones a session cannot run for the owner — a sign-in they own —
 * which is the same reason the setup-token card existed at all. Adding a head is cheap and safe; the only
 * cost of a missing one is a refusal that does not fire.
 */
const COMMAND_HEADS: ReadonlySet<string> = new Set([
  "aws",
  "brew",
  "cat",
  "claude",
  "defaults",
  "docker",
  "gcloud",
  "gh",
  "git",
  "launchctl",
  "mdutil",
  "node",
  "npm",
  "npx",
  "op",
  "open",
  "pbpaste",
  "pnpm",
  "psql",
  "slopweaver",
  "ssh",
  "sudo",
  "supabase",
  "yarn",
]);

/**
 * One text normalised for comparison: lowercased, backticks dropped, every run of whitespace one space.
 *
 * Backticks go because a composer writing the command into a plain-string cell has no `code` run available
 * and reaches for them instead — `./openPageCards.ts`'s cells are exactly that case, and a card that names
 * the command as `` `claude setup-token` `` above the fold has named it.
 *
 * @param text either side of the comparison
 * @returns the comparable form
 */
function normalise({ text }: { text: string }): string {
  return text.toLowerCase().replaceAll("`", "").replace(/\s+/g, " ").trim();
}

/**
 * Whether one `code` run's text is a COMMAND rather than an identifier.
 *
 * Two tokens minimum, because a one-token `code` run is a name — `plan-four`, `detail`, `main`. The head is
 * the first token of the whole string, so a pipeline is judged by what it starts with: `pbpaste | slopweaver
 * claude token --plan plan-four --stdin` is a `pbpaste` command.
 *
 * **Only ever feed this a `code` run.** It is the LEXICAL half of the criterion and it cannot tell prose
 * from a command on its own: `slopweaver and the fleet` and `claude session` pass it, exactly as the
 * measurement in this file's overview found. What separates them is the run's KIND, and both callers get
 * that right by construction — the form walks `code` runs out of the fold ({@link codeRunsOfFold}), the gate
 * walks `<code>` elements out of the markup. Handing this a sentence is a defect in the caller, not a hole
 * in the test: the test below asserts the structural filter rather than pretending this function has one.
 *
 * @param text the `code` run's own text
 * @returns whether it is something the owner would type
 */
export function isCommand({ text }: { text: string }): boolean {
  const tokens = normalise({ text })
    .split(" ")
    .filter((token) => token.length > 0);
  const head = tokens[0];
  if (head === undefined || tokens.length < 2) {
    return false;
  }
  return COMMAND_HEADS.has(head);
}

/**
 * The first command that sits below the fold and nowhere above it.
 *
 * @param commands every `code` run found inside the card's fold, in the order they appear
 * @param aboveFold the card's above-the-fold plain text, every cell joined
 * @returns the hidden command as the composer wrote it, or `undefined` when every one is named above
 */
export function hiddenCommand({
  commands,
  aboveFold,
}: {
  commands: readonly string[];
  aboveFold: string;
}): string | undefined {
  const visible = normalise({ text: aboveFold });
  return commands.find((command) => isCommand({ text: command }) && !visible.includes(normalise({ text: command })));
}

/**
 * The shape that fixes a hidden command, worded once so the form and the gate cannot drift apart on it.
 *
 * @internal — the sentence {@link commandAboveFoldRefusal} ends in; both surfaces go through that function
 * rather than composing their own line, so nothing outside this file names this constant.
 *
 * It names the priority order on purpose. Surfacing a command spends words against `./caps.ts`'s
 * `WHAT_MAX_WORDS` — the binding cap here at 60, not the whole-card 200 — so a card can be pushed over by
 * this rule, and the fix when that happens is to fold the OTHER prose rather than to re-hide the command.
 */
const COMMAND_ABOVE_FOLD_ADVICE =
  "A command you have to type belongs in the cells you cannot avoid, not behind a click — put it in `what` " +
  "verbatim and leave the explanation in the fold. If that runs the cell over its cap, fold other prose: " +
  "never the command. If it is EVIDENCE rather than something you run — a command a session already ran — " +
  "it is not a `code` run: write it as plain text and this rule leaves it alone.";

/**
 * The gate's refusal for one hidden command.
 *
 * @param command the command {@link hiddenCommand} found, as the composer wrote it
 * @returns one line naming the command and the shape that replaces it
 */
export function commandAboveFoldRefusal({ command }: { command: string }): string {
  return `the card asks you to run \`${command}\` and names it only inside the fold. ${COMMAND_ABOVE_FOLD_ADVICE}`;
}

/**
 * Every `code` run inside one fold, at every depth, in reading order.
 *
 * Recurses through nested folds because `BriefingBlock`'s `fold` member makes progressive disclosure
 * recursive — a command two clicks down is more hidden than one a click down, not less. A paste block is
 * deliberately NOT read: it is a value the owner copies with a button, which is the opposite of a command to
 * find and type, and it already renders its own control.
 *
 * @param fold the card's detail, or any fold nested inside one
 * @returns each `code` run's text, unfiltered — {@link isCommand} decides which are commands
 */
export function codeRunsOfFold({ fold }: { fold: BriefingFold }): readonly string[] {
  const found: string[] = [];
  for (const block of fold.blocks) {
    if (block.kind === "para") {
      found.push(...codeRunsOfContent({ content: block.content }));
    }
    if (block.kind === "list") {
      for (const item of block.items) {
        found.push(...codeRunsOfContent({ content: item }));
      }
    }
    if (block.kind === "fold") {
      found.push(...codeRunsOfFold({ fold: block.fold }));
    }
  }
  return found;
}

/**
 * Every `code` run in one cell's content.
 *
 * @param content the cell's runs
 * @returns each `code` run's text, in order
 */
function codeRunsOfContent({ content }: { content: BriefingContent }): readonly string[] {
  return content.filter((run) => run.kind === "code").map((run) => run.text);
}
