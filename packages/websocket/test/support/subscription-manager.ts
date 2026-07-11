import { Effect, Option } from "effect"
import type { SubscriptionManager } from "../../src/index"

/** 测试通过生产路由 seam 发布已解码消息，不向生产接口添加直接注入能力。 */
export const publishMatched = (
  manager: SubscriptionManager,
  parsed: unknown,
  decoded: unknown,
): Effect.Effect<void> =>
  manager.match(parsed).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.dieMessage("没有匹配的订阅实例"),
        onSome: (target) => target.publish(decoded),
      }),
    ),
  )
