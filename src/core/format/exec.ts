import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ponytail: single spawn seam for pandoc. Tests mock this module via
// mock.module, never node:child_process — a partial builtin mock breaks
// unrelated importers (e.g. sharp imports spawnSync) at link time.
export const runCommand = async (cmd: string): Promise<void> => {
  await execAsync(cmd);
};
