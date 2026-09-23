import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Host invoke surface: the structured contract the app UI drives, separate from the
// agent-facing officecli tool. Returns objects (office.preview) or action strings;
// never Tool.Context — the session is resolved from the lock when not provided.
import { Effect, Schema } from "effect";

import * as Comments from "@/core/comments";
import * as Draft from "@/core/draft";
import { captureQuiet } from "@/plugin/capture";
import { officecliInvokes } from "@/plugin/invoke-names";
import { fail } from "@/plugin/tools/boundary";
import { officecliInput, officecliTool } from "@/plugin/tools/officecli";
import type { OfficeCliInput } from "@/plugin/tools/officecli";

export { officecliInvokes } from "@/plugin/invoke-names";

// ponytail: data URLs above 20 MB would bloat the invoke payload; host falls back to the built-in preview
const officePreviewFileCapBytes = 20 * 1024 * 1024;

const officePreviewMimes: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const strParam = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const decodeInvokeArgs = (
  name: string,
  value: Record<string, unknown>
): OfficeCliInput => {
  try {
    return Schema.decodeUnknownSync(officecliInput)(value);
  } catch (error) {
    return fail(
      `invalid ${name} params: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const officePreviewFileUrl = (
  filePath: string,
  ext: string
): string | undefined => {
  const data = readFileSync(filePath);
  if (data.length > officePreviewFileCapBytes) {
    return undefined;
  }
  return `data:${officePreviewMimes[ext]};base64,${data.toString("base64")}`;
};

const officePreview = async (input: unknown): Promise<unknown> => {
  const params: Record<string, unknown> =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const filePath = strParam(params.filePath) ?? strParam(params.filename);
  if (!filePath) {
    return fail("office.preview requires filePath");
  }
  const ext = path.extname(filePath).toLowerCase();
  const sessions = Draft.draftSessions(filePath);
  const managed =
    sessions.length > 0 ||
    (officePreviewMimes[ext] !== undefined && existsSync(filePath));
  if (!managed) {
    return { managed: false };
  }
  // ponytail: draft selection prefers the requesting session, else the most recent draft by mtime
  const wanted = strParam(params.sessionID);
  const draftSession =
    wanted !== undefined && sessions.includes(wanted)
      ? wanted
      : Draft.mostRecentDraftSession(filePath);
  const target = draftSession
    ? Draft.draftPath(filePath, draftSession)
    : filePath;
  const lock = Draft.status(filePath);
  const result: Record<string, unknown> = {
    comments: await Comments.preview(target),
    contentType: "markdown",
    filename: path.basename(filePath),
    managed: true,
    source: draftSession ? "draft" : "file",
  };
  if (draftSession) {
    // extraction failure (corrupt zip, pandoc missing): omit content — the host
    // falls back to its built-in preview; raw zip bytes would render as garbage
    try {
      result.content = await Draft.draftMarkdown(filePath, draftSession);
    } catch (error) {
      // no content key — captured so the silent host-preview fallback is not invisible
      captureQuiet(
        "host",
        "preview-content",
        { draftSession, filePath },
        error
      );
    }
  } else {
    result.fileUrl = officePreviewFileUrl(filePath, ext);
  }
  if (lock) {
    result.lock = {
      owner: lock.owner,
      sessionID: lock.sessionID,
      stale: lock.stale,
    };
  }
  return result;
};

export const runOfficecliInvoke = async (
  name: string,
  input: unknown
): Promise<unknown> => {
  // office.preview never reaches officecliTool, so its failures are captured here. Success is not:
  // capturing it would JSON.stringify a data-URL preview of up to 20 MB on every UI poll.
  if (name === "office.preview") {
    try {
      return await officePreview(input);
    } catch (error) {
      captureQuiet("host", "preview", input, error);
      throw error;
    }
  }
  // early failures (unknown invoke, bad params) never reach officecliTool.execute where Captures live
  const params: Record<string, unknown> =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  let args: OfficeCliInput;
  const filePath = strParam(params.filePath) ?? strParam(params.filename);
  try {
    const action = officecliInvokes[name];
    if (!action) {
      return fail(`unknown invoke ${name}`);
    }
    if (!filePath) {
      return fail(`${name} requires filePath`);
    }
    args = decodeInvokeArgs(name, { ...params, action, filePath });
  } catch (error) {
    captureQuiet("host", name, input, error);
    throw error;
  }
  const sessionID =
    strParam(params.sessionID) ??
    Draft.lockSession(filePath) ??
    "openoffice-invoke";
  const context = {
    agent: "openoffice-invoke",
    id: "openoffice-invoke",
    messageID: "openoffice-invoke",
    progress: () => Effect.void,
    sessionID,
  } as never;
  const result = await Effect.runPromise(officecliTool.execute(args, context));
  return result.output as string;
};
