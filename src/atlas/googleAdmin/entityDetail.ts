/**
 * What one Google Admin atlas entity's `detail` may hold — one schema per channel's shape, and their union.
 *
 * An operation and a declared record shape come from the `discovery` channel, a console page from
 * `admin-console`, and a live record from `admin-api`. `model.ts` carries the entity those details sit on.
 */
import { z } from "zod";

import { GOOGLE_ADMIN_APIS, GOOGLE_ADMIN_DOCUMENTS, GOOGLE_ADMIN_PAGINGS } from "./surfaceNaming.js";

/**
 * What one published operation declares — the compiled surface map, one entity per operation.
 *
 * Every field is a NAME Google published. There is no value here and there cannot be: nothing in this
 * detail was fetched from this Workspace account, so the whole `discovery` channel is publishable on an
 * install holding no administrator credential at all.
 * @internal
 */
export const googleAdminOperationDetailSchema = z
  .object({
    api: z.enum(GOOGLE_ADMIN_APIS),
    baseUrl: z.string().min(1),
    description: z.string().min(1).nullable(),
    /** One of the four dispositions — `dispositions.ts` carries the rules that decide it. */
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why this is not a plain entity. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    document: z.enum(GOOGLE_ADMIN_DOCUMENTS),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "side-effecting", "egressing"]).nullable(),
    /** Google's own method id. Not unique across documents — `surfaceNaming.ts` carries the measurement. */
    id: z.string().min(1),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    paging: z.enum(GOOGLE_ADMIN_PAGINGS),
    parameters: z.array(z.string().min(1)),
    parametersRequired: z.array(z.string().min(1)),
    path: z.string().min(1),
    requestSchema: z.string().min(1).nullable(),
    responseFields: z.array(z.string().min(1)),
    responseSchema: z.string().min(1).nullable(),
    /** The administrator scopes Google declares. EMPTY for nineteen of them — `gaps.ts` says so out loud. */
    scopes: z.array(z.string().min(1)),
    supportsMediaUpload: z.boolean(),
  })
  .strict();

/**
 * What one published operation declares.
 * @internal
 */
export type GoogleAdminOperationDetail = z.infer<typeof googleAdminOperationDetailSchema>;

/**
 * What a record of one kind DECLARES, from Google's own schema for it.
 *
 * The half of a shape index that needs no credential, and the reason a kind that holds no rows still
 * answers a question. It is deliberately not an entity of the kind it describes: a `reports-activities`
 * file carries one of these and zero audit events, which is the shape-index disposition made visible on
 * disk rather than asserted in prose.
 * @internal
 */
export const googleAdminRecordShapeDetailSchema = z
  .object({
    /** Every field name the schema declares, sorted. */
    fields: z.array(z.string().min(1)).min(1),
    /** Google's own schema name, e.g. `User` — the handle back into the discovery document. */
    schemaName: z.string().min(1),
    /** The operation whose declared response carried it, so the derivation is reproducible. */
    sourceOperation: z.string().min(1),
  })
  .strict();

/**
 * What a record of one kind declares.
 * @internal
 */
export type GoogleAdminRecordShapeDetail = z.infer<typeof googleAdminRecordShapeDetailSchema>;

/**
 * What one page of the Admin console IS — where the browser walk lands.
 *
 * Declared now and written by no code yet, deliberately. The schema is what a walk has to satisfy, and
 * having it in the model is what makes `admin-console` a surface this atlas DECLARES rather than one it
 * is silent about. `descriptor.ts` carries the measurement that blocks the walk today.
 * @internal
 */
export const googleAdminPageDetailSchema = z
  .object({
    /** The console route, e.g. `/ac/users` — the exact address a proof screenshot is taken at. */
    route: z.string().min(1),
    /** The page's own title as rendered, or `null` when the walk could not read one. */
    title: z.string().min(1).nullable(),
    /** Where the browser actually settled, which is how a redirect to a sign-in becomes visible. */
    settledUrl: z.string().min(1),
  })
  .strict();

/**
 * What one page of the Admin console is.
 * @internal
 */
export type GoogleAdminPageDetail = z.infer<typeof googleAdminPageDetailSchema>;

/**
 * What one LIVE record is — the `admin-api` channel's own detail, and the one that carries no values.
 *
 * ## Why the field NAMES are stored and the values are not
 *
 * This is the only detail here describing a real row of the organisation's own data, and a `directory-users`
 * fill would otherwise write every colleague's name and address into `$SLOPWEAVER_HOME` on the strength of
 * one consent. `jumpcloud/sensitiveFields.ts` and `jumpcloud/withheld.ts` are what a sibling atlas built
 * before it stored values, and this atlas has no equivalent yet — so the fill stores what an ATLAS is for
 * and stops there. The key says the record exists and can be addressed, and the field names say what asking
 * for it would return.
 *
 * `withheldValues` is a literal `true` rather than an omission, deliberately: withholding that is visible
 * on disk is a decision a reader can find, while a detail that simply has no values reads like a detail
 * that found none. A fill that later stores values earns a second field beside this one and a sensitivity
 * pass to go with it.
 * @internal
 */
export const googleAdminLiveRecordDetailSchema = z
  .object({
    /** Every field name Google returned for this record, sorted. */
    fields: z.array(z.string().min(1)),
    /** The registry method id that read it, so the derivation is reproducible. */
    operation: z.string().min(1),
    /** Always true — see this schema's own prose for why it is a stored field rather than an absence. */
    withheldValues: z.literal(true),
  })
  .strict();

/**
 * What one live record is.
 * @internal
 */
export type GoogleAdminLiveRecordDetail = z.infer<typeof googleAdminLiveRecordDetailSchema>;

/**
 * What one entity IS, across every detail shape this atlas can hold.
 *
 * A plain union rather than a discriminated one, because no two members share a required field and Zod
 * resolves them unambiguously on their required keys.
 * @internal
 */
export const googleAdminEntityDetailSchema = z.union([
  googleAdminOperationDetailSchema,
  googleAdminRecordShapeDetailSchema,
  googleAdminPageDetailSchema,
  googleAdminLiveRecordDetailSchema,
]);

/**
 * What one entity is.
 * @internal
 */
export type GoogleAdminEntityDetail = z.infer<typeof googleAdminEntityDetailSchema>;
