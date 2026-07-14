type IsStaticString<Key extends string> = string extends Key
  ? false
  : Key extends ""
    ? true
    : Key extends `${infer _First}${infer Rest}`
      ? string extends Rest
        ? false
        : IsStaticString<Rest>
      : false

export type StaticNonEmptyKey<Key extends string> = Key extends ""
  ? never
  : IsStaticString<Key> extends true
    ? Key
    : never

export const assertNonEmptyKey = (key: string): void => {
  if (key.length === 0) {
    throw new TypeError("React Query descriptor key must not be empty")
  }
}
