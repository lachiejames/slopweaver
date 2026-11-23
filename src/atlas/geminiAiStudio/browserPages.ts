/**
 * The AI Studio and Gemini app navigation surface — every page this atlas declares.
 *
 * ## Nothing in this file has been visited, and it says so rather than implying otherwise
 *
 * Every route below is taken from the two products' own navigation, not from a walk. No page here has been
 * reached, photographed or graded; the `studio-and-app-pages` surface is `declared-unfilled` in the
 * descriptor for exactly that reason, and each declared page carries a `browser-page-not-attempted` gap
 * until a walk changes it. The Notion atlas is the cautionary case: its first list was written from the same
 * kind of reasonable inference and a live walk proved it was not the surface the product serves. Expect
 * this list to be wrong in the same way and to be corrected by measurement, which is what the walk is for.
 *
 * ## The list NEVER SHRINKS
 *
 * The owner requires the WHOLE browser surface, never a subset. A route that turns out to be
 * unreachable is recorded as a GAP against the page, never deleted from this file: an atlas that quietly
 * drops what it could not reach reports a smaller platform rather than a partial look at a large one, which
 * is the exact dishonesty coverage exists to prevent.
 *
 * ## Both products are single-page applications, so HTTP status cannot grade them
 *
 * AI Studio and the Gemini app both render a client-side shell and answer 200 for a route that does not
 * exist, then show an error inside the application — the same shape that made the first Notion walk report
 * pages as reached that were all one not-found shell. A walk here must grade on the rendered title
 * and on what the page's own calls returned, never on the status code alone.
 *
 * ## The Google Admin console's Gemini pages are deliberately NOT declared here
 *
 * Those pages govern this organisation's Gemini footprint — who is licensed, which policies apply, what the
 * console reports as usage — and by the owner's ruling (`docs/atlas-intent/06-holdings.md`) that is the Google
 * Admin atlas's to hold, which is the whole reason this row is a surface map. Declaring them here would be a
 * second copy of somebody else's surface. `sync.ts` records the pointer as a `held-elsewhere` coverage cell
 * instead, which is a claim a reader can follow rather than a page this atlas pretends to own.
 */

/**
 * The products this atlas declares pages under, and the origin each is addressed at.
 */
export const GEMINI_AI_STUDIO_PRODUCT_ORIGINS = {
  "ai-studio": "https://aistudio.google.com",
  "gemini-app": "https://gemini.google.com",
} as const;

/**
 * One product this atlas declares pages under.
 *
 * @internal
 */
export type GeminiAiStudioProduct = keyof typeof GEMINI_AI_STUDIO_PRODUCT_ORIGINS;

/**
 * One declared page: where it is, what it shows, and what it takes to see it.
 *
 * @internal
 */
export interface GeminiAiStudioBrowserPage {
  /** Which product it belongs to. */
  readonly product: GeminiAiStudioProduct;
  /** A stable name for the page, used as its provider key and never derived from the URL. */
  readonly surface: string;
  /** The path, relative to the product's origin. */
  readonly path: string;
  /** What a reader learns from this page that no other page gives them. */
  readonly description: string;
  /**
   * The entitlement this page is believed to need, or `null` when any signed-in Google account can open it.
   * A BELIEF until a walk measures it, and recorded so a redirect to a sign-up wall can be read as a stated
   * ceiling rather than as a broken route.
   */
  readonly believedToNeed: string | null;
}

/**
 * Every page this atlas declares, grouped by product in the order each product's own navigation lists them.
 *
 * The AI Studio run is much the longer of the two, and that is the shape of the platform rather than an
 * emphasis: AI Studio is where the API surface this atlas compiles is actually operated — its keys, its
 * quota, its tuned models and its batches — while the Gemini app is a consumer surface with almost no
 * configuration of its own.
 */
export const GEMINI_AI_STUDIO_BROWSER_PAGES: readonly GeminiAiStudioBrowserPage[] = [
  // --- Google AI Studio: the console over the API this atlas compiles ---
  {
    believedToNeed: null,
    description: "the AI Studio entry point, which redirects to the current default prompt workspace",
    path: "/",
    product: "ai-studio",
    surface: "studio-root",
  },
  {
    believedToNeed: null,
    description: "the chat prompt workspace — the default surface, and where a model is selected and run",
    path: "/prompts/new_chat",
    product: "ai-studio",
    surface: "studio-prompt-chat",
  },
  {
    believedToNeed: null,
    description: "the freeform prompt workspace, which exposes the raw request rather than a chat transcript",
    path: "/prompts/new_freeform",
    product: "ai-studio",
    surface: "studio-prompt-freeform",
  },
  {
    believedToNeed: null,
    description: "the structured prompt workspace, where few-shot examples are entered as a table",
    path: "/prompts/new_structured",
    product: "ai-studio",
    surface: "studio-prompt-structured",
  },
  {
    believedToNeed: null,
    description:
      "API keys — the page that governs every credential the live channel would need, and the reason that " +
      "channel is unfilled rather than unreachable",
    path: "/apikey",
    product: "ai-studio",
    surface: "studio-api-keys",
  },
  {
    believedToNeed: null,
    description: "the saved prompt library, which is the browser's own view of what a person has kept",
    path: "/library",
    product: "ai-studio",
    surface: "studio-library",
  },
  {
    believedToNeed: null,
    description: "tuned models — the browser surface over the `tunedModels` resource this atlas compiles",
    path: "/tune",
    product: "ai-studio",
    surface: "studio-tuned-models",
  },
  {
    believedToNeed: null,
    description: "the Live API workspace, a streaming session surface the discovery documents do not describe",
    path: "/live",
    product: "ai-studio",
    surface: "studio-live",
  },
  {
    believedToNeed: null,
    description: "the media generation workspace — image and video, over the `predict` operations",
    path: "/gen-media",
    product: "ai-studio",
    surface: "studio-generate-media",
  },
  {
    believedToNeed: null,
    description: "the speech generation workspace",
    path: "/generate-speech",
    product: "ai-studio",
    surface: "studio-generate-speech",
  },
  {
    believedToNeed: null,
    description: "the starter apps gallery, which is where AI Studio publishes its own worked examples",
    path: "/starter-apps",
    product: "ai-studio",
    surface: "studio-starter-apps",
  },
  {
    believedToNeed: null,
    description: "usage and quota — what this account has spent against its rate limits",
    path: "/usage",
    product: "ai-studio",
    surface: "studio-usage",
  },
  {
    believedToNeed: null,
    description: "the plan and billing tier this project is on, which decides which models answer at all",
    path: "/plan_information",
    product: "ai-studio",
    surface: "studio-plan",
  },
  {
    believedToNeed: null,
    description: "AI Studio settings — the account-level preferences page",
    path: "/settings",
    product: "ai-studio",
    surface: "studio-settings",
  },
  {
    believedToNeed: null,
    description: "the changelog, which is the only published record of when a model or an endpoint moved",
    path: "/changelog",
    product: "ai-studio",
    surface: "studio-changelog",
  },
  {
    believedToNeed: null,
    description: "the service status page for the Gemini API",
    path: "/status",
    product: "ai-studio",
    surface: "studio-status",
  },
  {
    believedToNeed: null,
    description: "the prompt history, which the browser holds and the API does not expose at all",
    path: "/history",
    product: "ai-studio",
    surface: "studio-history",
  },
  {
    believedToNeed: null,
    description: "the batch jobs surface, over the `batches` resource this atlas compiles",
    path: "/batch",
    product: "ai-studio",
    surface: "studio-batch",
  },
  // --- The Gemini app: the consumer surface over the same models ---
  {
    believedToNeed: null,
    description: "the Gemini conversation surface itself",
    path: "/app",
    product: "gemini-app",
    surface: "gemini-app-root",
  },
  {
    believedToNeed: null,
    description: "the Gems manager — saved custom assistants, which exist on no API resource this atlas holds",
    path: "/gems/view",
    product: "gemini-app",
    surface: "gemini-app-gems",
  },
  {
    believedToNeed: null,
    description: "the Gem editor, which is where a Gem's instructions and files are set",
    path: "/gems/create",
    product: "gemini-app",
    surface: "gemini-app-gem-editor",
  },
  {
    believedToNeed: null,
    description: "saved info — the standing context the app carries between conversations",
    path: "/saved-info",
    product: "gemini-app",
    surface: "gemini-app-saved-info",
  },
  {
    believedToNeed: "a Google Workspace account with the Gemini extensions policy enabled",
    description: "connected apps and extensions, which is where the app's reach into other Google products is set",
    path: "/extensions",
    product: "gemini-app",
    surface: "gemini-app-extensions",
  },
];

/**
 * The absolute address of one declared page.
 *
 * @param page the declared page
 * @returns the URL a browser would be sent to
 */
export function geminiAiStudioPageUrl({ page }: { page: GeminiAiStudioBrowserPage }): string {
  return `${GEMINI_AI_STUDIO_PRODUCT_ORIGINS[page.product]}${page.path}`;
}
