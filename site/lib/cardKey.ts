/**
 * The key a console card is named by, `<kind>:<id>`: what `?open=` carries, what `read_page` names and what a
 * steer's `about` records. A restatement of `src/talk/cardKey.ts`, which `site/` cannot import;
 * `__tests__/unit/consoleLinkMirror.test.ts` holds the two to the same source text.
 *
 * `recipe:<id>` names an Automations card — an automation a steer is about — and no Queue card. `align:<id>` names
 * an Alignment-page question no register holds: a voice scenario, or a general-ruling question. `candidate:<id>` names
 * a proposed workstream on the Workstreams page, which no register holds either.
 */

/** A card key. Anchored, so a longer string carrying one does not pass. */
export const CARD_KEY = /^(ask|hand|draft|post|review|import|pr|act|recipe|align|candidate):[A-Za-z0-9._-]{1,160}$/u;
