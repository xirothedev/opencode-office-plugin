import { Effect } from "effect"
import { Tool } from "@opencode-ai/schema/tool"

export function fail(message: string): never {
  throw new Tool.Error({ message })
}

export function toToolError(error: unknown): Tool.Error {
  if (error instanceof Tool.Error) {
    return error
  }
  return new Tool.Error({
    message: error instanceof Error ? error.message : String(error),
  })
}

export function tryExecute<A>(run: () => Promise<A>): Effect.Effect<A, Tool.Error> {
  return Effect.tryPromise({
    try: run,
    catch: toToolError,
  })
}
