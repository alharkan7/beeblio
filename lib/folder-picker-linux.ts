import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type RunPicker = (command: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;

export async function selectFolderLinux(run: RunPicker = execFileAsync): Promise<string | null> {
  for (const [command, args] of [
    ["zenity", ["--file-selection", "--directory", "--title=Choose a Beeblio project folder"]],
    ["kdialog", ["--getexistingdirectory", "--title", "Choose a Beeblio project folder"]],
  ] as const) {
    try {
      const { stdout } = await run(command, [...args], { timeout: 120000 });
      return stdout.trim() || null;
    } catch (error) {
      const code = (error as { code?: string | number } | null)?.code;
      // Both dialogs use exit status 1 when the user cancels.
      if (code === 1) return null;
      // Only try another picker when this executable is not installed.
      if (code !== "ENOENT") throw error;
    }
  }
  throw new Error("Folder selection requires zenity or kdialog on Linux. Install one of these tools or paste an absolute folder path.");
}
