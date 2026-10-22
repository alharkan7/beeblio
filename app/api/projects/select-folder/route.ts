import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { getUser } from "@/lib/auth/session";
import { selectFolderLinux } from "@/lib/folder-picker-linux";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";

async function selectFolderDarwin(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Choose a Beeblio project folder")',
      ],
      { timeout: 120000 },
    );
    return stdout.trim() || null;
  } catch (error) {
    // AppleScript reports the user cancelling the chooser as error -128.
    if ((error as { stderr?: string } | null)?.stderr?.includes("(-128)")) return null;
    throw error;
  }
}

async function selectFolderWindows(): Promise<string | null> {
  const psScript = `
                    function Get-Folder {
                      try {
                        Add-Type -AssemblyName System.Windows.Forms
                        $AssemblyFullName = 'System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089'
                        $Assembly = [System.Reflection.Assembly]::Load($AssemblyFullName)
                        $dialog = New-Object System.Windows.Forms.OpenFileDialog
                        $dialog.AddExtension = $false
                        $dialog.CheckFileExists = $false
                        $dialog.DereferenceLinks = $true
                        $dialog.Filter = "Folders|\`n"
                        $dialog.Multiselect = $false
                        $dialog.Title = "Choose a Beeblio project folder"
                        $dialogType = $dialog.GetType()
                        $dialogInterfaceType = $Assembly.GetType('System.Windows.Forms.FileDialogNative+IFileDialog')
                        $iFileDialog = $dialogType.GetMethod('CreateVistaDialog', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($dialog, $null)
                        $null = $dialogType.GetMethod('OnBeforeVistaDialog', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($dialog, $iFileDialog)
                        [uint32]$pickFoldersOption = $Assembly.GetType('System.Windows.Forms.FileDialogNative+FOS').GetField('FOS_PICKFOLDERS').GetValue($null)
                        [uint32]$options = $dialogType.GetMethod('get_Options', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($dialog, $null) -bor $pickFoldersOption
                        $null = $dialogInterfaceType.GetMethod('SetOptions', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($iFileDialog, $options)
                        $events = [System.Activator]::CreateInstance($AssemblyFullName, 'System.Windows.Forms.FileDialog+VistaDialogEvents', $false, 0, $null, $dialog, $null, $null).Unwrap()
                        [uint32]$cookie = 0
                        $params = @($events, $cookie)
                        $null = $dialogInterfaceType.GetMethod('Advise', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($iFileDialog, $params)

                        $owner = New-Object System.Windows.Forms.Form
                        $owner.TopMost = $true
                        $owner.Opacity = 0
                        $owner.Show()
                        $result = $dialogInterfaceType.GetMethod('Show', @('NonPublic', 'Public', 'Static', 'Instance')).Invoke($iFileDialog, @($owner.Handle))
                        $owner.Dispose()

                        if ($result -eq 0) {
                          [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                          return $dialog.FileName
                        }
                        return $null
                      } catch {
                        $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
                        $fbd.Description = "Choose a Beeblio project folder"
                        $fbd.ShowNewFolderButton = $true
                        $owner = New-Object System.Windows.Forms.Form
                        $owner.TopMost = $true
                        $owner.Opacity = 0
                        $owner.Show()
                        $fbdResult = $fbd.ShowDialog($owner)
                        $owner.Dispose()
                        if ($fbdResult -eq [System.Windows.Forms.DialogResult]::OK) {
                          [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
                          return $fbd.SelectedPath
                        }
                        return $null
                      }
                    }
                    $folder = Get-Folder
                    if ($folder) { Write-Output $folder }
                  `;

  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-EncodedCommand", encoded],
    { timeout: 120000 },
  );
  return stdout.trim() || null;
}

export async function POST() {
  if (!(await getUser()))
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    let folderPath: string | null = null;
    if (process.platform === "darwin") {
      folderPath = await selectFolderDarwin();
    } else if (process.platform === "win32") {
      folderPath = await selectFolderWindows();
    } else if (process.platform === "linux") {
      folderPath = await selectFolderLinux();
    } else {
      return Response.json(
        { error: "Enter an absolute folder path on this computer" },
        { status: 501 },
      );
    }

    if (!folderPath) {
      return Response.json(
        { error: "Folder selection cancelled" },
        { status: 400 },
      );
    }

    const realPath = await fs.realpath(folderPath);
    return Response.json({ folderPath: realPath });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not open the folder picker",
      },
      { status: 500 },
    );
  }
}
