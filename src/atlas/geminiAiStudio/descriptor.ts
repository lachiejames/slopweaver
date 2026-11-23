/**
 * What this atlas declares about itself, including the two things it cannot do and the one it will never do.
 *
 * ## Three surfaces, and only one of them is filled
 *
 * A descriptor's `status` is static, which is the trap `jumpcloud/descriptor.ts` names: a surface declared
 * `filled` in source is filled on every install, including one where the acquisition has never run. So each
 * flag below is a claim this build can actually make, and the compiled one is derived from the store by
 * `surfaceFill.ts` rather than believed from this file.
 *
 * - `discovery-specification` is `filled` once `atlas gemini-ai-studio sync` has run — it needs no
 *   credential and reaches no project.
 * - `gemini-api` is `declared-unfilled`: this installation holds no Gemini API key, so nothing has ever
 *   called the platform. Every compiled operation is a declaration, not a capability.
 * - `studio-and-app-pages` is `declared-unfilled` because no page has been visited. 23 pages across two
 *   products are DECLARED (`browserPages.ts`), which is what makes the emptiness measurable rather than
 *   invisible.
 *
 * ## Why this atlas holds NO entity, and its Microsoft 365 sibling holds them all
 *
 * `docs/atlas-intent/06-holdings.md` is a test, not a preference: does something better suited already hold this
 * platform's entities? For Microsoft 365 the answer is no — nothing else here holds that directory — so its
 * atlas holds everything reachable. Here the answer is YES, and it is the reason this row was registered
 * the way it was: this organisation's Gemini footprint is a Google Workspace fact, and the Google Admin
 * atlas is the row better suited to hold it. So every kind carries a `held-elsewhere` cell naming that
 * holder, and this atlas maps the interface alone.
 *
 * That holder is itself a SURFACE MAP, which is not what this row anticipated when it named it. The
 * `entities-holder-is-a-surface-map` gap says so on every kind — the Google Admin atlas maps the licence
 * assignments, the policy schemas and the usage reports with the administrator scope each one needs, and
 * holds none of the records. A `held-elsewhere` cell a reader takes as "somebody has these" would be the
 * unfalsifiable claim `kit/contract.ts` warns about, wearing a truer-sounding name.
 *
 * ## `excludes` is where the surface-map decision is written down for a reader
 *
 * `kit/contract.ts` requires it and says why: what an atlas deliberately does NOT hold is the fact a reader
 * needs most and the one nobody writes unless a type demands it.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { GEMINI_AI_STUDIO_ATLAS_PLATFORM, GEMINI_AI_STUDIO_KINDS, GEMINI_AI_STUDIO_VISIBILITY_SCOPE } from "./model.js";

/** This atlas, as it declares itself. */
export const GEMINI_AI_STUDIO_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every ENTITY of this organisation's, on every kind. That is the owner's ruling applied to " +
        "this platform (`docs/atlas-intent/06-holdings.md`): who is licensed for Gemini, which admin policies govern " +
        "it and what the console reports as usage are Google Workspace facts, and the Google Admin atlas is " +
        "the row better suited to hold them. Every kind carries a `held-elsewhere` coverage cell naming that " +
        "holder rather than an `excluded` one, because the two make different claims — `excluded` invites a " +
        "reader to treat the data as unavailable, and it is not, it is somebody else's",
      ground: "held-elsewhere",
      holder: "the google-admin atlas, which holds Workspace licensing, policy and usage",
    },
    {
      because:
        "every project-scoped resource the API itself would return — tuned models, uploaded files, cached " +
        "contents, corpora, file-search stores and batch jobs. Nothing here has ever called the platform, so " +
        "these are absent for want of a credential rather than by decision, and each kind's `not-configured` " +
        "cell says so with the key that would change it",
      ground: "not-fetched",
      wouldBeClosedBy: "configuring a Gemini API key, which each kind's `not-configured` cell already names",
    },
    {
      because:
        "every mutation and every inference call. 136 of the 222 declared operations either change state or run " +
        "a model, and this atlas will call none of them: no content is generated, no embedding is requested, " +
        "no file is uploaded, no tuned model is created. Each is still recorded as a row, because an atlas " +
        "that omitted them would answer `the Gemini API offers no way to do that`, which is false",
      ground: "never-acted",
    },
    {
      because:
        "the ROWS of the voluminous families — the long-running operation streams under `operations` and the " +
        "platform-emitted `generatedFiles` listing. Each of those operations IS held, with the rule that " +
        "classified it and the reason in English; what is never held is a row per record. That is a " +
        "disposition rather than an exclusion, and `dispositions.ts` applies it per operation rather than per " +
        "product area",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "the long-running operation streams and the platform-emitted `generatedFiles` listing accumulate one record per invocation rather than per thing a person made",
        wouldBeMeasuredBy: "`GET /v1beta/operations` paged to exhaustion once a Gemini API key is configured",
      },
    },
    {
      because:
        "any response VALUE, on any surface. The compiled channel calls nothing at all, so every field it holds " +
        "is a NAME — a method, a path shape, a parameter, a response field, a scope",
      ground: "names-not-values",
    },
    {
      because:
        "the Gemini surfaces inside other Google products — the side panel in Gmail, Docs and Drive, and " +
        "`gemini.google.com/share` links. Those are reached through a different product's own navigation, and " +
        "declaring them here would be a second, competing copy of the surface map the Google Workspace rows own",
      ground: "out-of-platform",
    },
  ],
  kinds: [...GEMINI_AI_STUDIO_KINDS],
  platform: GEMINI_AI_STUDIO_ATLAS_PLATFORM,
  question:
    "what can be asked of Google's Gemini platform and where — every operation the three published " +
    "discovery documents declare with its parameters and response fields, where the versions disagree, " +
    "every AI Studio and Gemini app page that reaches the same platform through a browser, and which store " +
    "holds this organisation's own Gemini entities instead of this one",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas gemini-ai-studio sync",
  surfaces: [
    {
      denominator: {
        because:
          "Gemini AI Studio publishes no catalogue of its `discovery-specification` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "discovery-specification",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Gemini AI Studio publishes no catalogue of its `gemini-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "gemini-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Gemini API key, so nothing has ever called the platform. Minting one " +
        "is new credentialled access and new spend against a Google project, which is the owner's to grant " +
        "rather than a piece of work — recorded as the `api-credential-absent` gap. It would fill the " +
        "project-scoped resources only; this organisation's own Gemini entities would still be the Google " +
        "Admin atlas's. This flips to filled in the commit that lands a client and proves it, never before",
    },
    {
      denominator: {
        because:
          "Gemini AI Studio publishes no catalogue of its `studio-and-app-pages` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "studio-and-app-pages",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "23 pages across AI Studio and the Gemini app are declared and NONE has been visited: no walk verb " +
        "ships in this commit, so nothing has been reached, photographed or graded. The transport exists " +
        "and is proven elsewhere (`atlas/kit/walkTransport.ts`, the owner's real Chrome through the " +
        "extension relay). A surface is filled by pages actually reached, never by a transport that could " +
        "reach them",
    },
  ],
  visibilityScope: GEMINI_AI_STUDIO_VISIBILITY_SCOPE,
};
