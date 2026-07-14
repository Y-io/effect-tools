import { expect, test } from "bun:test"
import { Cause, Effect, Runtime } from "effect"
import { EffectDefect } from "../../src/react-query/index"
import { runEffect } from "../../src/react-query/effect"

test("runEffect 保留单一业务失败", async () => {
  const error = { _tag: "UserNotFound", id: "missing" } as const

  await expect(runEffect(Runtime.defaultRuntime, Effect.fail(error))).rejects.toBe(error)
})

test("runEffect 将 defect 包装为 EffectDefect", async () => {
  const defect = new Error("unexpected defect")

  await expect(runEffect(Runtime.defaultRuntime, Effect.die(defect))).rejects.toEqual(
    new EffectDefect({ cause: defect }),
  )
})

test("runEffect 将组合 Cause 包装为 EffectDefect", async () => {
  const effect = Effect.failCause(
    Cause.parallel(Cause.fail("left failure"), Cause.fail("right failure")),
  )

  await expect(runEffect(Runtime.defaultRuntime, effect)).rejects.toBeInstanceOf(EffectDefect)
})

test("runEffect 将 AbortSignal 中断包装为 EffectDefect", async () => {
  const controller = new AbortController()
  const result = runEffect(Runtime.defaultRuntime, Effect.never, {
    signal: controller.signal,
  })

  controller.abort()

  await expect(result).rejects.toBeInstanceOf(EffectDefect)
})
