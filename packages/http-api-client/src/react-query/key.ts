export type NonEmptyKey<Key extends string> = Key extends "" ? never : Key

export const assertNonEmptyKey = (key: string): void => {
  if (key.length === 0) {
    throw new TypeError("React Query descriptor key must not be empty")
  }
}
