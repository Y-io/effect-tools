export const defineProtocol = <
  const Definition extends {
    readonly schema: unknown
    readonly match: unknown
    readonly subscription: unknown
  },
>(
  definition: Definition,
): Definition => definition
