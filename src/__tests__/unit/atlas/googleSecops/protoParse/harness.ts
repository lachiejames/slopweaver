/**
 * The one fixture the protoParse test files share: a single rpc declaration wrapped in the smallest proto file
 * that places it in `RuleService`. Pure text; nothing here touches a disk.
 */

/**
 * Wrap one rpc declaration in a minimal file.
 *
 * @param rpc the rpc text
 * @returns a whole proto file declaring it in `RuleService`
 */
export function oneRpc({ rpc }: { rpc: string }): string {
  return `package google.cloud.chronicle.v1;\nservice RuleService {\n${rpc}\n}\n`;
}
