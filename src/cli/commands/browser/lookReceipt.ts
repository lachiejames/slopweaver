/**
 * What `slopweaver browser open` and `browser read` print about a look: the page, its title, the viewport
 * picture when one was taken, and the observation id the next action cites.
 *
 * Pure. Split from `./actionCore.ts`, which keeps the flag parsing and the aim, scroll and posture renderers.
 */
import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";

/**
 * Render what a session and its first look came to.
 *
 * @param session the session that was opened
 * @param observation the first look taken through it
 * @returns the lines to print
 */
export function renderOpened({
  session,
  observation,
}: {
  session: InteractionSession;
  observation: PageObservation;
}): readonly string[] {
  return [
    `browser open: session ${session.id} on ${observation.url}`,
    `  title: ${observation.title}`,
    ...lookLine({ observation }),
    `  observation: ${observation.id}`,
    `  every later command names --session ${session.id}; \`browser close --session ${session.id}\` ends it`,
  ];
}

/**
 * The picture a look took, when it took one.
 *
 * The landing is the first screenshot, showing what is on the page.
 * So every look photographs the viewport, and this is where
 * the path is named. A look recorded by an older build carries no picture, and that is reported as an
 * absence rather than as a path to a file nobody wrote.
 *
 * @param observation the look
 * @returns the line, or nothing when the look carried no picture
 */
function lookLine({ observation }: { observation: PageObservation }): readonly string[] {
  if (observation.screenshotPath === null) {
    return [];
  }
  return [`  on screen: ${observation.screenshotPath} — the viewport, as you would see it`];
}

/**
 * Render a look at a page.
 *
 * @param observation the look
 * @returns the lines to print
 */
export function renderObservation({ observation }: { observation: PageObservation }): readonly string[] {
  return [
    `browser read: ${observation.url}`,
    `  title: ${observation.title}`,
    ...lookLine({ observation }),
    `  observation: ${observation.id}`,
    `  aim an action with --target <ref> --observation ${observation.id}`,
  ];
}
