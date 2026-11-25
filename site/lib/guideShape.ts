/**
 * The shape of one integration's Settings page: its numbered Configure steps and the facts beside them. Its own
 * module so the key-paste guides (`./integrationGuides.ts`) and the browser-consent guides (`./consentGuides.ts`)
 * share one type without importing each other.
 */

/** One numbered Configure step. */
export interface GuideStep {
  /** What the step does, as a short heading. */
  readonly title: string;
  /** How, in the provider's own menu names. */
  readonly detail: string;
  /** The provider page the step happens on, when one address serves every install. */
  readonly link?: { readonly href: string; readonly label: string };
  /** The store files this step's paste fields write (`SecretFields`), in the order they are made. */
  readonly paste?: readonly string[];
  /** The browser-consent verb this step runs. */
  readonly verb?: string;
}

/** One integration's page: its pitch, its steps and the facts column. */
export interface IntegrationGuide {
  /** The id in `INTEGRATIONS` (`./integrations.ts`). */
  readonly id: string;
  /** What connecting it gets you, in a line short enough for a card. */
  readonly pitch: string;
  /** The longer line under the integration's name once opened. */
  readonly overview: string;
  readonly steps: readonly GuideStep[];
  /** Where what you paste is kept. */
  readonly storedAs: string;
  /** What in Slopweaver reads through it. */
  readonly usedBy: string;
  /** What the credential can reach. */
  readonly reach: string;
  /** How to take it away again. */
  readonly disconnect: string;
}
