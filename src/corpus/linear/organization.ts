/**
 * The ONE hand-written `organization` read in the Linear source lanes, and why it is not
 * `LinearDocument.OrganizationDocument`.
 *
 * `@linear/sdk` ships a document for this root field, so this sits INSIDE the `linear-sdk-documents` gate's
 * criterion and is refused without the marker below. The reason is a field the generated fragment selects
 * rather than one it omits: **`Organization.authSettings`**, the workspace's authentication configuration,
 * which is on the deny-list `src/atlas/linear/settings.ts` carries for exactly this class — the `Webhook`
 * row of `settingSurfaces.ts` is exempt because the SDK's fragment selects the webhook SIGNING SECRET, and
 * its `UserSettings` row because that one selects `calendarHash`. Reproduce:
 *
 *     yarn tsx -e 'import{LinearDocument as d}from"@linear/sdk";
 *       console.log(String(d.OrganizationDocument).includes("authSettings"))'
 *
 * Three callers, ONE document, so there is one marker and one reason in the tree rather than a set that can
 * drift apart. Its six fields are the union of what they read, which is still forty-odd fields narrower than
 * the generated fragment:
 *
 * - `../linear/structureRows.ts` files an `org` structure row, and a structure row stores the whole payload as
 *   its `raw` — so the SDK's document would put `authSettings` into bronze, permanently, to obtain five
 *   scalars.
 * - `./writeAssets.ts` asks which content types the workspace restricts uploads to, before every attachment.
 * - `../../live/linear/states.ts` stamps a state catalog with the `urlKey` of the workspace the token reached.
 *
 * The day Linear's own SDK stops selecting `authSettings`, delete this file and every call site takes
 * `LinearDocument.OrganizationDocument` directly. Nothing else here has to change.
 */

/**
 * The workspace object, narrowed to the six fields this repo's source lanes actually read.
 *
 * `allowedFileUploadContentTypes` is `null` on an UNRESTRICTED workspace rather than an empty array — see
 * `./writeAssets.ts`'s `allowedUploadTypesFrom`, which is where that distinction is kept.
 */
// linear-sdk-documents-exempt: v92's Organization fragment selects authSettings, a credential this repo must not receive
export const ORGANIZATION_QUERY = `query LinearOrganization {
  organization { id name urlKey userCount samlEnabled allowedFileUploadContentTypes }
}`;
