/*
 * The one value the provider-read test files share: the instant every fake clock answers, so a document's
 * `readAtIso` is asserted exactly. Pure data; nothing here touches a disk or a provider.
 */
export const NOW = "2026-08-09T12:00:00.000Z";
