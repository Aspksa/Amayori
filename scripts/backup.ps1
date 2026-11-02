param([ValidateSet('backup','list','restore')][string]$Action='backup',[string]$Name='')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$data=Join-Path $root 'data'
$backups=Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $backups | Out-Null
if($Action -eq 'list'){Get-ChildItem $backups -Directory | Select-Object -ExpandProperty Name;exit}
if($Action -eq 'backup'){
 $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
 $dest=Join-Path $backups $stamp
 New-Item -ItemType Directory -Force -Path $dest | Out-Null
 if(Test-Path $data){Copy-Item $data (Join-Path $dest 'data') -Recurse -Force}
 Write-Host ('Backup created: '+$dest)
 exit
}
if($Name -notmatch '^\d{8}-\d{6}-\d{3}$'){throw 'Invalid backup name'}
$src=Join-Path $backups $Name
if(-not (Test-Path (Join-Path $src 'data'))){throw 'Backup missing'}
Write-Host 'Stop Amayori server before restoring.'
$safety=Join-Path $backups ('before-restore-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
if(Test-Path $data){Copy-Item $data $safety -Recurse -Force;Remove-Item $data -Recurse -Force}
Copy-Item (Join-Path $src 'data') $data -Recurse -Force
Write-Host ('Restored '+$Name+'. Safety copy: '+$safety)
