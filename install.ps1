# ponytail: native Windows — one file, stdlib only (powershell + node), mirrors install.sh
param(
  [switch]$Global,
  [string]$Project = ".",
  [switch]$Local,
  [switch]$SkillOnly,
  [switch]$PluginOnly,
  [switch]$Help
)
$PLUGIN="@xirothedev/openoffice-plugin-opencode"
$SCRIPT_DIR=$PSScriptRoot
if (-not $SCRIPT_DIR) { $SCRIPT_DIR=Split-Path -Parent $MyInvocation.MyCommand.Path }
$SKILL_SRC=Join-Path $SCRIPT_DIR "skills/office"
if ($Help) { Write-Host "Usage: .\install.ps1 [-Global] [-Project DIR] [-Local] [-SkillOnly] [-PluginOnly]"; exit 0 }

# decide target (cross-OS: %APPDATA%/opencode on Windows else ~/.config)
$GlobalBase=if ($env:APPDATA) { Join-Path $env:APPDATA "opencode" } else { Join-Path $HOME ".config/opencode" }
if ($Global) { $TARGET=$GlobalBase }
else {
  if ((Test-Path (Join-Path $Project "opencode.json")) -or (Test-Path (Join-Path $Project "opencode.jsonc"))) { $TARGET=$Project }
  elseif ($Project -ne ".") { $TARGET=$Project }
  else { $TARGET=$GlobalBase; Write-Host "no ./opencode.json, using global $TARGET" }
}
New-Item -ItemType Directory -Force -Path $TARGET | Out-Null
if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) { Write-Host "warn: pandoc not found — DOCX/XLSX/PPTX write needs pandoc (choco install pandoc)" }

# plugin
if (-not $SkillOnly) {
  $CFG=Join-Path $TARGET "opencode.json"
  if (Test-Path (Join-Path $TARGET "opencode.jsonc")) { $CFG=Join-Path $TARGET "opencode.jsonc" }
  if (-not (Test-Path $CFG)) { Set-Content $CFG '{"plugins":[]}' }
  $PKG=$PLUGIN
  $code=@'
const fs=require("fs"), p=process.argv[1], pkg=process.argv[2];
const raw=fs.readFileSync(p,"utf8").replace(/\/\/.*$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"");
const j=JSON.parse(raw); j.plugins=j.plugins||[];
if(!j.plugins.some(x=> (typeof x==="string"?x:x.package)===pkg)) j.plugins.push(pkg);
fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n"); console.log("plugin →", p, ":", pkg);
'@
  node -e $code $CFG $PKG
  if ($Local) {
    Write-Host "local: linking plugin via bun link"
    Push-Location $SCRIPT_DIR; try { bun link --global } catch { Write-Host "bun link failed — ensure bun is installed" } finally { Pop-Location }
    Push-Location $TARGET; try { bun link $PLUGIN --global } catch { Write-Host "hint: cd $TARGET; bun link $PLUGIN --global" } finally { Pop-Location }
  }
}
# skill
if (-not $PluginOnly) {
  if (-not (Test-Path $SKILL_SRC)) { Write-Host "skill src $SKILL_SRC not found"; exit 1 }
  $SKILL_DST=if ($TARGET -eq $GlobalBase) { Join-Path $TARGET "skills/office" } else { Join-Path $TARGET ".opencode/skills/office" }
  New-Item -ItemType Directory -Force -Path (Split-Path $SKILL_DST) | Out-Null
  if (Test-Path $SKILL_DST) { Remove-Item -Recurse -Force $SKILL_DST }
  Copy-Item -Recurse -Force $SKILL_SRC $SKILL_DST
  Write-Host "skill → $SKILL_DST"
}
Write-Host "done. restart opencode2 and try: Create a Word document at /tmp/test.docx"
Write-Host "verify: opencode2 api get /api/plugin | Select-String openoffice"
