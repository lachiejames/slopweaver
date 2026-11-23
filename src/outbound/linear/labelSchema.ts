/**
 * The strict schema for `slopweaver linear label create` — see `./labelTypes.ts` for the shape and why it has
 * two kinds.
 *
 * Three refusals are about meaning rather than type, and each is a write Linear would accept and a reader
 * would misread: a name with a line break (a label renders on one line, everywhere), a `groupType` on a label
 * that is not a group (it would describe members that cannot exist), and a group nested under a parent
 * (Linear's UI offers one level of grouping, and nothing here has measured what a second level does).
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import type { LinearIssueLabelFields, LinearLabelCreateForm, LinearProjectLabelFields } from "./labelTypes.js";

/** A label name: non-empty, one line, no surrounding whitespace that would make two labels look alike. */
const labelNameSchema = z
  .string()
  .min(1)
  .refine((name) => !/[\r\n]/.test(name), "a label name is one line; it renders on one line everywhere")
  .refine((name) => name.trim() === name, "a label name has no leading or trailing whitespace");

/** Linear stores a label colour as a six-digit hex string. */
const labelColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a label colour is a six-digit hex string such as #5e6ad2");

/** The fields every label kind shares. */
const sharedLabelFields = {
  color: labelColorSchema.optional(),
  description: z.string().min(1).optional(),
  isGroup: z.boolean().optional(),
  name: labelNameSchema,
  parentId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
};

/** A group nested under a parent is refused rather than sent: one level of grouping is what is known. */
function groupHasNoParent({
  fields,
}: {
  fields: { isGroup?: boolean | undefined; parentId?: string | undefined };
}): boolean {
  return fields.isGroup !== true || fields.parentId === undefined;
}

const GROUP_PARENT_MESSAGE = "a label group cannot itself sit under a parent; drop parentId or isGroup";

const issueLabelFieldsSchema = strictForm({
  ...sharedLabelFields,
  groupType: z.union([z.literal("singleSelect"), z.literal("multiSelect")]).optional(),
})
  .refine((fields) => groupHasNoParent({ fields }), GROUP_PARENT_MESSAGE)
  .refine(
    (fields) => fields.groupType === undefined || fields.isGroup === true,
    "groupType describes a group's members, so it needs isGroup: true",
  ) satisfies z.ZodType<LinearIssueLabelFields>;

const projectLabelFieldsSchema = strictForm(sharedLabelFields).refine(
  (fields) => groupHasNoParent({ fields }),
  GROUP_PARENT_MESSAGE,
) satisfies z.ZodType<LinearProjectLabelFields>;

/** A complete `linear label create` write. */
export const linearLabelCreateFormSchema = z.discriminatedUnion("kind", [
  strictForm({ fields: issueLabelFieldsSchema, kind: z.literal("issue") }),
  strictForm({ fields: projectLabelFieldsSchema, kind: z.literal("project") }),
]) satisfies z.ZodType<LinearLabelCreateForm>;
