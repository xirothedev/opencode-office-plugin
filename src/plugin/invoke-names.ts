// ponytail: name→action map split from host so plugin load can register invokes without pulling the document graph; type import erases at compile time
import type { OfficeCliInput } from "@/plugin/tools/officecli";

// ponytail: host-facing invoke names mirror officecli actions so the app drives the same code path as the agent tool
export const officecliInvokes: Record<string, OfficeCliInput["action"]> = {
  "office.accept": "accept",
  "office.comment.approve": "approve",
  "office.comment.create": "comment",
  "office.comment.delete": "delete-comment",
  "office.comment.deny": "deny-comment",
  "office.comment.edit": "edit-comment",
  "office.comment.resolve": "resolve-comment",
  "office.edit.save": "edit",
  "office.preview": "preview",
};
