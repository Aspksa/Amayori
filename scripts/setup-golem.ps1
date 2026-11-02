param([switch]$Force)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$dest=Join-Path $root 'modules\project-golem'
$source='https://github.com/CyberMagician/Project_Golem.git'
if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){throw 'Install Git for Windows'}
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
if(Test-Path (Join-Path $dest '.git')){
 if($Force){git -C $dest pull --ff-only; if($LASTEXITCODE -ne 0){throw 'Golem update failed'}}
}else{
 if(Test-Path $dest){throw 'Golem directory exists without git metadata. Back it up before retrying'}
 git clone --depth 1 $source $dest
 if($LASTEXITCODE -ne 0){throw 'Golem clone failed'}
}
Write-Host ('Golem source ready at '+$dest)
Write-Host 'Golem execution is disabled. Dependencies are not installed automatically.'
