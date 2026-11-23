<#
.SYNOPSIS
  Installs the Claude Code token-saver setup into ~/.claude (backs up first, merges instead of overwriting).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -CompactWindow 150000
#>
param(
    [string]$ClaudeDir = (Join-Path $env:USERPROFILE '.claude'),
    [int]$CompactWindow = 200000,
    [switch]$SkipExploreOverride
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required (status line + settings merge).' }
if ($CompactWindow -lt 100000) { throw 'Claude Code requires autoCompactWindow >= 100000.' }
New-Item -ItemType Directory -Force $ClaudeDir | Out-Null

# 1. Backup
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $ClaudeDir "token-saver-backup-$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null
foreach ($rel in 'settings.json', 'CLAUDE.md', 'statusline.js', 'hooks\status-hook.js', 'agents\validator.md', 'agents\fixer.md', 'agents\Explore.md', 'skills\handoff\SKILL.md', 'skills\compact-plan\SKILL.md') {
    $src = Join-Path $ClaudeDir $rel
    if (Test-Path $src) {
        $dst = Join-Path $backup $rel
        New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
        Copy-Item $src $dst
    }
}
Write-Host "Backup: $backup"

# 2. Subagents, skill, status line script
New-Item -ItemType Directory -Force (Join-Path $ClaudeDir 'agents') | Out-Null
$agents = @('validator.md', 'fixer.md')
if (-not $SkipExploreOverride) { $agents += 'Explore.md' }
foreach ($a in $agents) { Copy-Item (Join-Path $repo "agents\$a") (Join-Path $ClaudeDir "agents\$a") -Force }
$skills = @('handoff', 'compact-plan')
foreach ($sk in $skills) {
    New-Item -ItemType Directory -Force (Join-Path $ClaudeDir "skills\$sk") | Out-Null
    Copy-Item (Join-Path $repo "skills\$sk\SKILL.md") (Join-Path $ClaudeDir "skills\$sk\SKILL.md") -Force
}
Copy-Item (Join-Path $repo 'statusline.js') (Join-Path $ClaudeDir 'statusline.js') -Force
New-Item -ItemType Directory -Force (Join-Path $ClaudeDir 'hooks') | Out-Null
Copy-Item (Join-Path $repo 'hooks\status-hook.js') (Join-Path $ClaudeDir 'hooks\status-hook.js') -Force
Write-Host "Agents: $($agents -join ', '); skills: /$($skills -join ', /'); statusline.js; hooks/status-hook.js"

# 3. CLAUDE.md: insert or replace a marked block, keep everything else
$begin = '<!-- token-saver:begin -->'
$end = '<!-- token-saver:end -->'
$block = "$begin`n" + ([IO.File]::ReadAllText((Join-Path $repo 'CLAUDE.md')).Trim()) + "`n$end"
$target = Join-Path $ClaudeDir 'CLAUDE.md'
if (Test-Path $target) {
    $current = [IO.File]::ReadAllText($target)
    $pattern = [regex]::Escape($begin) + '[\s\S]*?' + [regex]::Escape($end)
    if ($current -match $pattern) {
        $new = [regex]::Replace($current, $pattern, { param($m) $block })
    } else {
        $new = $current.TrimEnd() + "`n`n" + $block + "`n"
    }
} else {
    $new = $block + "`n"
}
[IO.File]::WriteAllText($target, $new, $utf8)
Write-Host 'CLAUDE.md: token-saver block written'

# 4. settings.json merge (auto-compact window + status line)
Write-Host 'settings.json:'
node (Join-Path $repo 'scripts\merge-settings.js') (Join-Path $ClaudeDir 'settings.json') (Join-Path $ClaudeDir 'statusline.js') $CompactWindow
if ($LASTEXITCODE -ne 0) { throw 'settings merge failed; settings.json left unchanged.' }

Write-Host "`nDone. Start a new Claude Code session to pick up the changes."
