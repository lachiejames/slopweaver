/**
 * The typed shape of a golden proposal, before it is rendered.
 *
 * Split from `schema.ts` so the SHAPE is readable without the Zod that enforces it, matching how the Linear
 * and GitHub forms are laid out. Nothing here validates; nothing here renders.
 *
 * The five sections are FIELDS rather than free markdown, which is what makes the golden order a property of
 * the type instead of something a lint check hopes to find. A proposal that reorders its sections, or invents
 * a sixth, is unrepresentable rather than merely refused.
 */

/** One row of the linked evidence table under "What the data shows". */
export interface EvidenceRow {
  /** The exact thing being pointed at — a pipeline, a run, a query, a row. */
  readonly point: string;
  /** What it shows, with the figure linked over its own words. */
  readonly shows: string;
  /** The words the source link sits on. */
  readonly sourceText: string;
  /** Where the source link goes. */
  readonly sourceUrl: string;
}

/** The cropped, annotated hero shot that opens "What the data shows". */
interface HeroShot {
  /** The image URL. Notion embeds an external image by URL, so a local path cannot be published. */
  readonly url: string;
  /** The italic "Above: …" line under the shot. */
  readonly caption: string;
  /** The words the frozen-source link sits on. */
  readonly sourceText: string;
  /** Where the frozen-source link goes. */
  readonly sourceUrl: string;
}

/** One option in the collapsed "Options considered" toggle. */
export interface ConsideredOption {
  readonly option: string;
  readonly pros: string;
  readonly cons: string;
  /** Exactly one option is the recommendation, and the renderer marks it in place. */
  readonly recommended: boolean;
}

/** A diagram or a real code excerpt inside "The fix". */
interface FixDiagram {
  /** The fence language — `mermaid` for a diagram, or a real language for an excerpt. */
  readonly language: string;
  readonly code: string;
}

/** One row of the "what this solves vs what it doesn't" table. */
export interface ScopeRow {
  readonly solves: string;
  readonly notYet: string;
  readonly whatItWouldTake: string;
}

/** One question for the named stakeholder. */
interface OpenQuestion {
  /** A short key naming what the question is about, rendered in bold. */
  readonly key: string;
  readonly question: string;
}

/** A filled golden-proposal form. */
export interface ProposalForm {
  /** The page title, without its emoji. */
  readonly title: string;
  /** The emoji icon. A Notion page icon is a property, so it never appears in the body. */
  readonly emoji: string;
  /** The problem and why it matters, at a glance. No figures and no citations — those live below. */
  readonly tldr: string;
  readonly data: {
    /** Optional prose introducing the evidence table. */
    readonly intro?: string | undefined;
    readonly hero?: HeroShot | undefined;
    readonly rows: readonly EvidenceRow[];
  };
  readonly fix: {
    /** The fix in plain terms, linking real files rather than a placeholder snippet. */
    readonly body: string;
    readonly diagram?: FixDiagram | undefined;
    /** Folded into a `<details>` toggle, never its own section. */
    readonly optionsConsidered: readonly ConsideredOption[];
  };
  readonly scope: {
    readonly rows: readonly ScopeRow[];
    /** The weakest part of the argument, named before a reviewer can name it. */
    readonly weakestPart: string;
  };
  readonly questions: {
    /** Who the questions are addressed to. */
    readonly addressedTo: string;
    readonly items: readonly OpenQuestion[];
  };
  /** The "verifiable detail for agents" appendix, folded into a toggle. */
  readonly appendix?: string | undefined;
  /**
   * The concise Slack version, posted with the proposal link above it.
   *
   * Carried on the FORM rather than derived from the doc, because it is authored rather than extracted: the
   * owner's own worked example runs to several hundred words and was judged too verbose,
   * so the short version is a separate act of writing, not a summary of the long one.
   */
  readonly slackTeaser: string;
}
