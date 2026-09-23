import { describe, it, expect } from "bun:test";

import { Effect } from "effect";

import { OpenOfficePlugin, isBlockedTool, blockBinary } from "@/plugin/index";

const run = (ctx: Record<string, unknown>) =>
  Effect.runPromise(
    Effect.scoped(OpenOfficePlugin.effect({ options: {}, ...ctx } as never))
  );

describe("live host tool registration", () => {
  it("registers officecli + edit and hooks execute.before", async () => {
    const added: { name?: string }[] = [];
    const hooks: string[] = [];
    await run({
      tool: {
        hook: (name: string) => {
          hooks.push(name);
          return Effect.void;
        },
        transform: (
          register: (e: { add: (t: { name?: string }) => void }) => void
        ) => {
          register({ add: (t) => added.push(t) });
          return Effect.void;
        },
      },
    });
    expect(added.map((t) => t.name)).toEqual(["officecli", "edit"]);
    expect(hooks).toEqual(["execute.before"]);
  });

  it("blocks binary paths and allows text", () => {
    expect(() => blockBinary("write", { path: "/tmp/a.docx" })).toThrow(
      /officecli/u
    );
    expect(() => blockBinary("read", { filePath: "/tmp/a.pdf" })).toThrow(
      /officecli/u
    );
    expect(() => blockBinary("read", { filePath: "/tmp/a.md" })).not.toThrow();
    expect(isBlockedTool("edit")).toBe(true);
    expect(isBlockedTool("read")).toBe(false);
  });
});
