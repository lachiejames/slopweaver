/**
 * The typed shape of a standard operating procedure, before it is rendered.
 *
 * Split from `schema.ts` so the SHAPE is readable without the Zod that enforces it, matching how the
 * proposal, Linear and GitHub forms are laid out. Nothing here validates; nothing here renders.
 *
 * ## The sections are FIELDS, and they came from the org's own SOPs
 *
 * Every section below was read off the standard operating procedures the organisation has already written,
 * not invented for this form. Measured over the 52 pages in the local corpus whose title begins `SOP`
 * (`grep -h '"title":"SOP' $SLOPWEAVER_HOME/corpus/bronze/notion/*.jsonl`, section headings counted):
 * purpose 12, steps 12, scope 8, prerequisites 6 plus "before you start" 4, notes 5, "when this applies" 4
 * plus "when to use this" 3, related 7 plus "related SOPs" 4 plus references 4, ownership and review 3.
 * The best of them — the leaver-asset SOP — carries every one of those, an explicit "does not apply to", a
 * review frequency and a version history.
 *
 * Making them fields rather than free markdown is what makes that order a property of the type instead of
 * something a check hopes to find. An SOP that reorders its sections, drops one, or invents a thirteenth is
 * unrepresentable rather than merely refused.
 */

/** Who owns the procedure, and who to ask about it. */
interface SopOwner {
  /** The owning function, as the org writes it — `IT / Platform`. */
  readonly role: string;
  /** The named person accountable for the content. A role with no name is nobody. */
  readonly person: string;
  /** Where to reach them: a channel, an address, a rota. */
  readonly contact: string;
}

/** One step of the procedure. */
export interface SopStep {
  /** What is done, in the imperative. Becomes the step's heading. */
  readonly action: string;
  /** Who does it. A step with no actor is the gap that sends a request round three teams. */
  readonly who: string;
  /** The expansion: the link to click, the field to set, the thing to check afterwards. */
  readonly detail?: string | undefined;
}

/** One case the happy path does not cover, and what to do in it. */
export interface SopException {
  readonly situation: string;
  readonly whatToDo: string;
}

/** A link, with the words it sits on. */
export interface SopLink {
  readonly text: string;
  readonly url: string;
}

/** What this procedure covers, and what it deliberately does not. */
interface SopScope {
  readonly covers: readonly string[];
  /**
   * What this SOP does NOT cover.
   *
   * Required, and non-empty. The question that produced this whole form was "does this apply to external
   * contractors?", and an SOP that never says what it excludes cannot answer it — the reader is left
   * inferring an absence, which is the failure mode rather than an edge case.
   */
  readonly doesNotCover: readonly string[];
}

/** When the procedure stops being enough, and who takes it then. */
interface SopEscalation {
  /** The condition that ends this SOP's authority. */
  readonly when: string;
  /** Who it goes to then — a person, a rota, a channel. */
  readonly to: string;
}

/** A filled SOP form. */
export interface SopForm {
  /** The page title, without its emoji. The house convention is `SOP: <what it does>`. */
  readonly title: string;
  /** The emoji icon. A Notion page icon is a property, so it never appears in the body. */
  readonly emoji: string;
  readonly owner: SopOwner;
  /** The date this content was last true, as `YYYY-MM-DD`. */
  readonly lastUpdated: string;
  /** How often it is re-checked — `annually, or when the tooling changes`. */
  readonly reviewCadence: string;
  /** Why the procedure exists, in plain terms. */
  readonly purpose: string;
  /** The trigger: the situation in which a reader should be following this page. */
  readonly whenThisApplies: string;
  readonly scope: SopScope;
  /** Access, approvals and information needed before step one. Empty when genuinely nothing is. */
  readonly beforeYouStart: readonly string[];
  readonly steps: readonly SopStep[];
  /** The cases the happy path does not cover. Empty when there are honestly none. */
  readonly exceptions: readonly SopException[];
  readonly escalation: SopEscalation;
  /** Neighbouring SOPs, policies and references. Empty when there are none. */
  readonly related: readonly SopLink[];
  /**
   * Where this procedure came from — the thread, ticket or page it was distilled out of.
   *
   * Required. A tag-drafted SOP that does not carry its own source is a page asserting a process with no way
   * to check it against what actually happened, and the reader cannot tell the difference.
   */
  readonly source: SopLink;
}
