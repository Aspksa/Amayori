# Thin wrapper: the real logic lives in scripts/backup.mjs so it can be tested
# and so one implementation covers both the data folder and PostgreSQL.
param([ValidateSet('backup','list','restore')][string]$Action='backup',[string]$Name='')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$script=Join-Path $PSScriptRoot 'backup.mjs'
& node.exe $script $Action $Name
exit $LASTEXITCODE
