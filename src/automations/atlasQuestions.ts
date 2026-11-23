/**
 * Each atlas's own `question`, loaded once for the Automations page so an atlas refresh can say what it is for in
 * the atlas's own words. The effectful half of `./purpose.ts`'s atlas branch: descriptors are lazy thunks
 * (`../atlas/kit/registration.ts`), so a synchronous fold cannot reach them.
 */
import { atlasRegistrations } from "../atlas/registry.js";

/** The questions by platform, and a line for each descriptor that would not load — said, never read as absent. */
export interface AtlasQuestions {
  readonly questions: ReadonlyMap<string, string>;
  readonly issues: readonly string[];
}

/**
 * Load every registered atlas's question.
 *
 * @returns the questions by platform, and why any descriptor would not load
 */
export async function loadAtlasQuestions(): Promise<AtlasQuestions> {
  const settled = await Promise.allSettled(
    atlasRegistrations().map(async (registration) => ({
      platform: registration.platform,
      question: (await registration.readDescriptor()).question,
    })),
  );
  const questions = new Map<string, string>();
  const issues: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      questions.set(outcome.value.platform, outcome.value.question);
      return;
    }
    const platform = atlasRegistrations()[index]!.platform;
    const why = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    issues.push(`the ${platform} atlas descriptor would not load, so its refresh is not named: ${why}`);
  });
  return { issues, questions };
}
