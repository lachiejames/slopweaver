/**
 * The one number `github vuln surfaces` decides by, in a LEAF so the verb's parser can default a flag to it
 * without loading the TypeScript compiler the derivation itself needs.
 */

/**
 * The fan-in at which the answer becomes `everywhere` rather than a list: reached by EITHER the number of
 * modules that import the package directly, or the number of features (components) that pull it in.
 *
 * Both, because each misses a case alone. MEASURED on acme/acme-admin at staging, as
 * direct importers / features: `@pdfme/ui` 1/1, `mailparser` 2/2, `date-fns` 1/2, `dompurify` 3/6 — the local
 * dependencies a reviewer can test in a few places — against `lodash` 31/18, `zod` 400/352 and `dayjs` 637/603,
 * the ones the reviewer named as "everywhere". Features alone would list lodash's 18; importers alone would
 * list a single wrapper imported by forty components. The largest local reading is 6 and the smallest
 * ubiquitous one 18; 12 sits between them. Reproduce:
 *
 * ```bash
 * for p in @pdfme/ui mailparser date-fns dompurify lodash zod dayjs; do
 *   slopweaver github vuln surfaces --package "$p" --checkout ~/dev/acme-admin --json |
 *     jq -r --arg p "$p" '"\($p) \(.seeds | length)/\(.features | length)"'
 * done
 * ```
 */
export const DEFAULT_EVERYWHERE_AT = 12;
