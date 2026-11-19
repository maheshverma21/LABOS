# Makes labos-hostinger.zip (source only, no node_modules/build output) for upload to Hostinger.
# package.json sits at the ROOT of the zip (no wrapper folder, no "./" prefix).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File hostinger\make-zip.ps1
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$out = Join-Path (Split-Path $root -Parent) "labos-hostinger.zip"
if (Test-Path $out) { Remove-Item $out -Force }
$items = @("apps","packages","tools","hostinger","deploy","package.json","package-lock.json",".gitignore",".gitattributes",".editorconfig") | Where-Object { Test-Path $_ }
tar -a -cf $out `
  --exclude=node_modules --exclude=.next --exclude=dist --exclude=.local-data `
  --exclude=.env --exclude="*.log" `
  $items
Write-Host "Created $out ($([math]::Round((Get-Item $out).Length/1MB,1)) MB)"
