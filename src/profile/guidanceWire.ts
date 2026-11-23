/**
 * The guidance wire: the shape `slopweaver profile guidance --json` prints, the sources it lists in rank order, and the
 * one source read from text alone (`AGENTS.md`'s doctrine).
 *
 * A leaf on purpose, importing nothing. The Alignment page's reader (`site/components/live/readGuidance.ts`) restates
 * these source ids, and `site/__tests__/unit/guidanceMirror.test.ts` binds the copy by importing this file into the
 * site's own TypeScript program — where Next's `ProcessEnv` rejects any `src/` module that spawns a process. The
 * readers of every other source stay in `./guidance.ts`, whose type imports reach exactly those modules.
 */

/** The three ranks, highest first. */
const GUIDANCE_LEVELS = ["doctrine", "standing-rules", "rulings"] as const;

/** One rank. */
export type GuidanceLevel = (typeof GUIDANCE_LEVELS)[number];

/**
 * One line of guidance: what it says, and where a reader goes to check it, and what an Alignment card relates it by.
 *
 * `body` is everything the entry says — a doctrine rule's whole paragraph, where `text` is only its title — so a card
 * can tell which entries name the words of its act's kind. `kinds` and `subjectPrefix` are a class steer's exact
 * membership (`../autonomy/classSteer.ts`'s `classAdmits`): the kinds it settles and, when scoped, the subject an act
 * must start with. Every other source settles no kind, so its `kinds` is empty and its `subjectPrefix` null.
 */
export interface GuidanceEntry {
  readonly text: string;
  readonly citation: string;
  readonly body: string;
  readonly kinds: readonly string[];
  readonly subjectPrefix: string | null;
}

/**
 * An entry that settles no kind of act, its body its text unless it says more.
 *
 * @param body the entry's whole wording, when it says more than its text
 * @returns the entry, settling no kind
 */
export function plainEntry({ text, citation, body }: { text: string; citation: string; body?: string }): GuidanceEntry {
  const entry: GuidanceEntry = { body: text, citation, kinds: [], subjectPrefix: null, text };
  if (body === undefined) {
    return entry;
  }
  return { ...entry, body };
}

/** What one source read: its entries and anything in it that would not read, or the one reason none of it did. */
export type GuidanceSourceState =
  | { readonly kind: "read"; readonly entries: readonly GuidanceEntry[]; readonly gaps: readonly string[] }
  | { readonly kind: "unreadable"; readonly why: string };

/** One source as the wire carries it. */
interface GuidanceSource {
  readonly id: GuidanceSourceId;
  readonly level: GuidanceLevel;
  readonly label: string;
  readonly state: GuidanceSourceState;
}

/** The whole read, as `profile guidance --json` prints it. */
export interface GuidanceWire {
  readonly readAtIso: string;
  readonly sources: readonly GuidanceSource[];
}

/** Every source, in the order the wire lists them: rank first, then narrowest last. */
export const GUIDANCE_SOURCES = [
  { id: "doctrine", label: "Doctrine (AGENTS.md)", level: "doctrine" },
  { id: "class-steers", label: "Standing rules (class steers)", level: "standing-rules" },
  { id: "general-rulings", label: "General rulings", level: "rulings" },
  { id: "ruling-gates", label: "Ruling gates in force", level: "rulings" },
  { id: "standing-asks", label: "Standing asks", level: "rulings" },
  { id: "memories", label: "Feedback memories", level: "rulings" },
  { id: "owner-profile", label: "Owner profile", level: "rulings" },
] as const satisfies readonly { id: string; label: string; level: GuidanceLevel }[];

/** One source's id. */
export type GuidanceSourceId = (typeof GUIDANCE_SOURCES)[number]["id"];

/**
 * A source that read, with no gaps.
 *
 * @param entries every entry the source holds
 * @returns the read state
 */
export function readState({ entries }: { entries: readonly GuidanceEntry[] }): GuidanceSourceState {
  return { entries, gaps: [], kind: "read" };
}

/**
 * The opening of one numbered doctrine rule: `**3 · One door.**`, the bold sometimes closing before the full stop
 * (`**4 · The command surface is SKILLS**,`).
 */
const DOCTRINE_RULE = /^\*\*(\d+) · (.+?)\*\*/u;

/** The heading the numbered rules sit under. */
const DOCTRINE_HEADING = "## Operating doctrine";

/**
 * Every numbered rule under `AGENTS.md`'s operating-doctrine heading, as one line each: its number and title.
 *
 * Only the section under the heading is read, so a bold numbered line elsewhere in the file is never mistaken for a
 * rule. A file with no such heading is unreadable, never empty: doctrine is always written, so its absence means the
 * file this read is not the one that holds it.
 *
 * @param text the file's contents
 * @returns the rules, or why none could be read
 */
export function doctrineState({ text }: { text: string }): GuidanceSourceState {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === DOCTRINE_HEADING);
  if (start === -1) {
    return { kind: "unreadable", why: `AGENTS.md has no "${DOCTRINE_HEADING}" heading` };
  }
  const after = lines.slice(start + 1);
  const next = after.findIndex((line) => line.startsWith("## "));
  const section = next === -1 ? after : after.slice(0, next);
  const entries = section.flatMap((line, index): GuidanceEntry[] => {
    const match = DOCTRINE_RULE.exec(line);
    if (match === null) {
      return [];
    }
    const [, number, title] = match;
    // The rule's paragraph runs to the next blank line.
    const rest = section.slice(index);
    const end = rest.findIndex((candidate) => candidate.trim().length === 0);
    const paragraph = (end === -1 ? rest : rest.slice(0, end)).map((kept) => kept.trim()).join(" ");
    return [plainEntry({ body: paragraph, citation: `AGENTS.md rule ${number!}`, text: title!.replace(/\.$/u, "") })];
  });
  return readState({ entries });
}

/**
 * The wire: every source in {@link GUIDANCE_SOURCES} order, each with its rank and label.
 *
 * @param readAtIso when the read was made
 * @param states each source's state, keyed by its id
 * @returns the wire
 */
export function guidanceWire({
  readAtIso,
  states,
}: {
  readAtIso: string;
  states: Readonly<Record<GuidanceSourceId, GuidanceSourceState>>;
}): GuidanceWire {
  return {
    readAtIso,
    sources: GUIDANCE_SOURCES.map((source) => ({ ...source, state: states[source.id] })),
  };
}
