Option Explicit
Dim fileSystem, shell, projectRoot, scriptPath, powerShell, quote
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectRoot = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
scriptPath = fileSystem.BuildPath(projectRoot, "scripts\open-desktop.ps1")
powerShell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
quote = Chr(34)
shell.Run quote & powerShell & quote & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & quote & scriptPath & quote, 0, False
