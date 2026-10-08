<#
.SYNOPSIS
    radiooooo-scrobbler インストールの解除

.DESCRIPTION
    自動化スクリプトが生成した Chrome / Edge ショートカットを削除します。
#>

[CmdletBinding()]
param()

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = "$PSScriptRoot\install.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

function Get-ExistingShortcut {
    param([string]$Browser)
    $browserName = if ($Browser -eq "edge") { "Microsoft Edge" } else { "Google Chrome" }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $startMenu = [Environment]::GetFolderPath("CommonStartMenu")

    $candidates = @()
    if (Test-Path $desktop) { $candidates += Get-ChildItem -Path $desktop -Filter "*.lnk" }
    if (Test-Path $startMenu) { $candidates += Get-ChildItem -Path $startMenu -Recurse -Filter "*.lnk" }

    foreach ($link in $candidates) {
        try {
            $wsh = New-Object -ComObject WScript.Shell
            $shellLink = $wsh.CreateShortcut($link.FullName)
            $target = $shellLink.TargetPath
            $args = $shellLink.Arguments

            if (($target -like "*$browserName*" -or $target -like "*$Browser.exe*") -and
                ($args -like "*load-extension*" -or $args -like "*Radiooooo*")) {
                return $link.FullName
            }
        } catch { }
    }
    return $null
}

Write-Host "ラジオoooo-scrobbler のインストールを解除します" -ForegroundColor Yellow

$chrome = Get-ExistingShortcut "chrome"
if ($chrome) {
    Write-Log "Chrome 拡張ショートカットを削除します：$chrome"
    Remove-Item $chrome -Force
    Write-Host "削除しました：$chrome"
} else {
    Write-Host "Chrome の拡張ショートカットは見つかりませんでした"
}

$edge = Get-ExistingShortcut "edge"
if ($edge) {
    Write-Log "Edge 拡張ショートカットを削除します：$edge"
    Remove-Item $edge -Force
    Write-Host "削除しました：$edge"
} else {
    Write-Host "Edge の拡張ショートカットは見つかりませんでした"
}

Write-Host "`n解除が完了しました。" -ForegroundColor Green
