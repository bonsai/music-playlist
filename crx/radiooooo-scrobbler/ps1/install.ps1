<#
.SYNOPSIS
    radiooooo-scrobbler のインストール自動化
    Chrome / Edge に manifest V3 拡張をロードするショートカットを生成します。

.DESCRIPTION
    - npm run build:win でビルド（dist フォルダがあればスキップ）
    - ローカル展開フォルダに展開
    - Chrome / Edge のショートカットに --load-extension を付与して作成
    - 処理は install.log に記録されます

.PARAMETER Rebuild
    ビルドを強制的にやり直す
#>

[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$Uninstall,
    [string]$Target = "all"  # chrome / edge / all
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distLocal = "$scriptRoot\dist"
$chromeExt = "Radiooooo → Last.fm Scrobbler"
$logFile = "$PSScriptRoot\install.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] [$Level] $Message"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

function Get-ExtensionFolder {
    # npm run build:win の出力先に合わせています
    $altWinPath = "C:\Users\0501JP\radiooooo-scrobbler-dist"
    if (Test-Path $altWinPath) {
        return $altWinPath
    }
    "$PSScriptRoot\dist"
}

function Get-ChromePath {
    param([string]$Browser)

    $paths = @{
        chrome = @(
            "C:\Program Files\Google\Chrome\Application\chrome.exe"
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
        edge = @(
            "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
            "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
        )
    }

    foreach ($p in $paths[$Browser]) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Get-ExistingShortcut {
    param([string]$Browser)
    $browserName = if ($Browser -eq "edge") { "Microsoft Edge" } else { "Google Chrome" }

    # デスクトップ + スターターにある拡張付きショートカットを検出
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

            if ($target -like "*$browserName*" -or $target -like "*$Browser.exe*") {
                if ($args -like "*load-extension*" -or $args -like "*Radiooooo*") {
                    return $link.FullName, $target, $args
                }
            }
        } catch {
            # 破損リンクなどはスキップ
        }
    }
    return $null
}

function New-Shortcut {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$Arguments = "",
        [string]$Description = "",
        [string]$IconLocation = ""
    )

    $wsh = New-Object -ComObject WScript.Shell
    $link = $wsh.CreateShortcut($ShortcutPath)
    $link.TargetPath = $TargetPath
    $link.Arguments = $Arguments
    $link.WorkingDirectory = $distLocal
    $link.Description = $Description
    if ($IconLocation) { $link.IconLocation = $IconLocation }
    $link.Save()
}

function Install {
    Write-Log "インストール処理を開始します"

    # 1. ビルド
    $extensionFolder = Get-ExtensionFolder
    if (-not (Test-Path $extensionFolder) -or $Rebuild) {
        Write-Log "ビルドを実行します：npm run build:win"
        & npm run build:win
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ビルドに失敗しました（ExitCode=$LASTEXITCODE）" -Level "ERROR"
            throw "ビルドに失敗しました。install.log を確認してください"
        }
    } else {
        Write-Log "dist フォルダは最新です"
    }

    if (-not (Test-Path "$extensionFolder\manifest.json")) {
        Write-Log "manifest.json が見つかりません" -Level "ERROR"
        throw "ビルド成果物が期待される場所にありません：$extensionFolder"
    }

    # 2. Chrome / Edge のショートカットを作成
    if ($Target -eq "all" -or $Target -eq "chrome") {
        $chromePath = Get-ChromePath "chrome"
        if ($chromePath) {
            Process-Browser "chrome" $chromePath $extensionFolder
        } else {
            Write-Log "Chrome が見つかりませんでした。スキップします" -Level "WARN"
        }
    }

    if ($Target -eq "all" -or $Target -eq "edge") {
        $edgePath = Get-ChromePath "edge"
        if ($edgePath) {
            Process-Browser "edge" $edgePath $extensionFolder
        } else {
            Write-Log "Edge が見つかりませんでした。スキップします" -Level "WARN"
        }
    }

    Write-Log "インストールが完了しました"
    Write-Log "拡張アイコンから「設定」を開いて API key / Shared secret を登録してください"
}

function Process-Browser {
    param([string]$Browser, [string]$BrowserPath, [string]$ExtensionFolder)

    $existing, $existingTarget, $existingArgs = Get-ExistingShortcut $Browser
    $browserName = if ($Browser -eq "edge") { "Microsoft Edge" } else { "Google Chrome" }

    $arguments = "https://app.radiooooo.com/ --load-extension=`"$ExtensionFolder`""

    if ($existing) {
        # 既存の拡張付きショートカットを置換
        Write-Log "既存の $browserName 拡張ショートカットを置換します：$existing"
        Remove-Item $existing -Force
    }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = "$desktop\Radiooooo → Last.fm Scrobbler.lnk"

    New-Shortcut `
        -ShortcutPath $shortcutPath `
        -TargetPath $BrowserPath `
        -Arguments $arguments `
        -Description "$browserName — Radiooooo Last.fm Scrobbler 1.0.0" `
        -IconLocation "$BrowserPath,0"

    Write-Log "$browserName のショートカットを作成しました：$shortcutPath"
    Write-Log "起動引数：$arguments"
}

function Uninstall {
    Write-Log "アンインストール処理を開始します"

    $existing, $existingTarget, $existingArgs = Get-ExistingShortcut "chrome"
    if ($existing) {
        Write-Log "Chrome 拡張ショートカットを削除します：$existing"
        Remove-Item $existing -Force
    }

    $existing, $existingTarget, $existingArgs = Get-ExistingShortcut "edge"
    if ($existing) {
        Write-Log "Edge 拡張ショートカットを削除します：$existing"
        Remove-Item $existing -Force
    }

    Write-Log "アンインストールが完了しました"
}

# ----------------------------------------------------------------------

if (Test-Path $logFile) {
    Add-Content -Path $logFile -Value ""
    Add-Content -Path $logFile -Value ("=" * 60)
    Add-Content -Path $logFile -Value ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 開始")
}

try {
    if ($Uninstall) {
        Uninstall
    } else {
        Install
    }
} catch {
    Write-Log "エラー：$($_.Exception.Message)" -Level "ERROR"
    Write-Host "エラーが発生しました：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
