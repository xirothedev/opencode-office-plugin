import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

export const fail = (message: string): never => {
  throw new Tool.Error({ message });
};

export const toToolError = (error: unknown): Tool.Error => {
  if (error instanceof Tool.Error) {
    return error;
  }
  return new Tool.Error({
    message: error instanceof Error ? error.message : String(error),
  });
};

export const tryExecute = <A>(
  run: () => Promise<A>
): Effect.Effect<A, Tool.Error> =>
  Effect.tryPromise({
    catch: toToolError,
    try: run,
  });
