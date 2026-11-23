/**
 * The effectful half of `../../admit/declinedAtlasGate.ts` — grade the atlases an answer's blind spots
 * actually NAME, and hand the gradings down as data.
 *
 * ## Why only the named ones
 *
 * MEASURED on a real install: `time slopweaver atlas doctor --json` took over ten seconds
 * across a few dozen atlases, because grading loads entities and one directory atlas alone holds hundreds of
 * thousands of them. The gate runs at the answer pre-flight AND again at the door, so a full sweep would cost
 * over twenty seconds per turn. The
 * selector that decides what to grade is pure and reads only the answer's own strings, so an answer naming
 * no atlas — nearly all of them — makes no call here at all.
 *
 * ## Answerability is the registry's own verdict, not a second opinion
 *
 * `atlas/registry.ts` wraps every `readSnapshot` in `refuseUnanswerableAtlas`, which refuses exactly the
 * `unpublished` and `dark` grades. So a snapshot that comes back OK is the same "this atlas can answer"
 * that `slopweaver atlas <platform> read` acts on, rather than a grading this module re-derives and can
 * disagree with.
 */
import { atlasesNamedInBlindSpots, type DeclinedAtlasReading } from "../../admit/declinedAtlasGate.js";
import type { AtlasPlatformRegistration } from "../../atlas/kit/registration.js";
import { atlasPlatforms, findAtlasPlatform } from "../../atlas/registry.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";

/**
 * Grade every registered atlas this answer's blind spots name.
 *
 * @param answer the composed answer, read only for `grounding.evidence.couldNotSee.blindSpots`
 * @param home the state home the generations are read from, when the caller has one to pass
 * @param platforms lists every platform this build has; the real registry unless a test supplies its own
 * @param find looks one platform's registration up; the real, answerability-guarded registry lookup by default
 * @returns one reading per named platform, in registry order; empty when no blind spot names an atlas
 */
export async function declinedAtlasReadings({
  answer,
  home,
  platforms = atlasPlatforms,
  find = findAtlasPlatform,
}: {
  answer: AnswerFormAnswer;
  home: string | undefined;
  platforms?: () => readonly string[];
  find?: (args: { platform: string }) => Pick<AtlasPlatformRegistration, "readSnapshot"> | null;
}): Promise<readonly DeclinedAtlasReading[]> {
  const named = atlasesNamedInBlindSpots({
    blindSpots: answer.grounding.evidence.couldNotSee.blindSpots,
    platforms: platforms(),
  });
  const readings: DeclinedAtlasReading[] = [];
  for (const platform of named) {
    const registration = find({ platform });
    if (registration === null) {
      continue;
    }
    const snapshot = await registration.readSnapshot(home === undefined ? {} : { home });
    if (snapshot.isErr()) {
      readings.push({ answerable: false, kinds: [], platform });
      continue;
    }
    readings.push({
      answerable: true,
      kinds: snapshot.value.kinds.map((kind) => kind.kind),
      platform,
    });
  }
  return readings;
}
