/*
 * The pure source and report builders the access-review render-core test files share. Each builds an in-memory
 * jumpcloud or Vanta roster source from the people or spells a case describes, stamped with one fixed read
 * instant, so no case touches a store, the clock or the filesystem. They moved here when `renderCores.test.ts`
 * was split by the core module under test.
 */
import { ROSTER_SPINE } from "../../../../../../accessReview/levels.js";
import {
  type AccessReviewReport,
  buildAccessReview,
  type PlatformSource,
} from "../../../../../../accessReview/report.js";
import { entity, kindView, personDetail, snapshot } from "../../../../accessReview/fixtures.js";

/** The instant every builder here stamps as each kind's last successful read. */
export const READ_STAMP = "2026-09-06T00:00:00.000Z";

/**
 * A jumpcloud source holding the people a caller describes.
 *
 * @returns a source that read, one systemusers record per person, an admin role attached only where one is named
 */
export function jumpcloudSource({
  people,
}: {
  people: readonly { readonly email: string; readonly state: string; readonly role: string | null }[];
}): PlatformSource {
  return {
    platform: "jumpcloud",
    refusal: null,
    snapshot: snapshot({
      kinds: [
        kindView({
          entities: people.map((person, index) =>
            entity({
              detail: {
                displayname: "A Person",
                email: person.email,
                state: person.state,
                ...(person.role === null ? {} : { admin: { roleName: person.role } }),
              },
              providerId: `v1-systemusers-get:${String(index)}`,
            }),
          ),
          kind: "systemusers",
          lastSuccessAt: READ_STAMP,
        }),
      ],
      platform: "jumpcloud",
    }),
  };
}

/**
 * A spine source holding one employment spell per entry.
 *
 * @returns a Vanta source that read, one roster-spine person record per spell
 */
export function spineSource({
  spells,
}: {
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): PlatformSource {
  return {
    platform: "vanta",
    refusal: null,
    snapshot: snapshot({
      kinds: [
        kindView({
          entities: spells.map((spell, index) =>
            entity({
              detail: personDetail({
                display: "A Person",
                email: spell.email,
                endDate: spell.endDate,
                status: spell.status,
              }),
              providerId: `person:${String(index)}`,
            }),
          ),
          kind: ROSTER_SPINE.kind,
          lastSuccessAt: READ_STAMP,
        }),
      ],
      platform: "vanta",
    }),
  };
}

/**
 * One report over one jumpcloud person and one spine spell.
 *
 * @returns the access review built over exactly those two sources, jumpcloud first
 */
export function reportOf({
  people,
  spells,
}: {
  people: readonly { readonly email: string; readonly state: string; readonly role: string | null }[];
  spells: readonly { readonly email: string; readonly status: string; readonly endDate: string | null }[];
}): AccessReviewReport {
  return buildAccessReview({ sources: [jumpcloudSource({ people }), spineSource({ spells })] });
}
