# Remove only the superseded terrain version after v2 data and Blender checks pass.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPrefix = $taskRoot.TrimEnd('\') + '\'
$taskDocs = Join-Path $taskRoot 'docs\mountain-preparation'
$download = Get-Content -LiteralPath (Join-Path $taskDocs 'terrain-v2-download-manifest.json') -Raw | ConvertFrom-Json
$processing = Get-Content -LiteralPath (Join-Path $taskDocs 'terrain-v2-processing-manifest.json') -Raw | ConvertFrom-Json
$blender = Get-Content -LiteralPath (Join-Path $taskDocs 'terrain-v2-blender-validation.json') -Raw | ConvertFrom-Json
if ($download.status -ne 'complete' -or $download.sources.Count -ne 4) { throw 'Four new source files must be complete.' }
if ($processing.status -notin @('complete','passed')) { throw 'New terrain processing must pass.' }
if ($processing.regions.Count -ne 4 -or -not $processing.shared_city_grid_check.all_overlap_pixels_exactly_equal) { throw 'Four regions and matching city overlap required.' }
if ($blender.status -ne 'passed' -or $blender.stages.Count -ne 12) { throw 'All twelve Blender verification stages must pass.' }
$taskVerifyFiles = @($download.sources) + @($blender.outputs) + @($processing.outputs)
foreach ($region in $processing.regions) { $taskVerifyFiles += @($region.outputs) }
foreach ($entry in $taskVerifyFiles) {
    $taskFile = if ($entry.local_path) { $entry.local_path } else { $entry.path }
    $taskAbsolute = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskFile))
    if (-not $taskAbsolute.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Verification path escapes workspace.' }
    $taskHash = (Get-FileHash -LiteralPath $taskAbsolute -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskHash -ne $entry.sha256) { throw "New file changed: $taskFile" }
}

# This fixed allowlist excludes Python dependencies, web assets and other output.
$taskTargets = @(
    'output\terrain',
    'output\blender-validation',
    'artifacts\mountain-prep\terrain',
    'artifacts\mountain-prep\blender-validation',
    'artifacts\mountain-prep\blender-runtime-probe.py',
    'artifacts\mountain-prep\probe-gedtm.py',
    'docs\mountain-preparation\terrain-download-manifest.json',
    'docs\mountain-preparation\terrain-processing-manifest.json',
    'docs\mountain-preparation\terrain-regions.json',
    'docs\mountain-preparation\blender-runtime-validation.json',
    'scripts\download-terrain.py',
    'scripts\prepare-terrain.py',
    'scripts\verify-blender.py'
)
$taskAuditPath = Join-Path $taskDocs 'terrain-v2-replacement-manifest.json'
if (Test-Path -LiteralPath $taskAuditPath) {
    $taskPriorAudit = Get-Content -LiteralPath $taskAuditPath -Raw | ConvertFrom-Json
    $taskStillPresent = @($taskTargets | Where-Object { Test-Path -LiteralPath (Join-Path $taskRoot $_) })
    if ($taskPriorAudit.status -eq 'complete' -and $taskStillPresent.Count -eq 0) {
        Write-Output 'Old terrain already removed; existing deletion inventory retained.'
        return
    }
}
$taskInventory = @()
$taskResolved = @()
foreach ($taskRelative in $taskTargets) {
    $taskAbsolute = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelative))
    if (-not $taskAbsolute.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase) -or $taskAbsolute -eq $taskRoot) {
        throw "Delete target escapes workspace: $taskRelative"
    }
    if (Test-Path -LiteralPath $taskAbsolute) {
        $taskItem = Get-Item -LiteralPath $taskAbsolute -Force
        if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No symbolic-link delete targets allowed.' }
        if ($taskItem.PSIsContainer -and @(Get-ChildItem -LiteralPath $taskAbsolute -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'No reparse points inside delete directories allowed.' }
        $taskFiles = if ($taskItem.PSIsContainer) { @(Get-ChildItem -LiteralPath $taskAbsolute -Recurse -File -Force) } else { @($taskItem) }
        foreach ($taskOld in $taskFiles) {
            if ($taskOld.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No symbolic links inside delete targets allowed.' }
            if (-not $taskOld.FullName.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Old file escaped workspace.' }
            $taskInventory += [ordered]@{
                path = [IO.Path]::GetRelativePath($taskRoot, $taskOld.FullName).Replace('\','/')
                bytes = $taskOld.Length
                sha256 = (Get-FileHash -LiteralPath $taskOld.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
        $taskResolved += [ordered]@{ relative = $taskRelative; absolute = $taskAbsolute }
    }
}
$taskOldBytes = 0L
foreach ($taskRecord in $taskInventory) { $taskOldBytes += [long]$taskRecord['bytes'] }
$taskAudit = [ordered]@{
    schema_version = 2
    status = 'validated_pending_delete'
    user_request = 'Re-download the four recommended terrain types and delete previous models/data.'
    old_assets = $taskInventory
    old_file_count = $taskInventory.Count
    old_bytes = $taskOldBytes
    prior_tanglang_approximate_high_point_wgs84 = @(113.980943,22.576248)
    replacement_reports = @('terrain-v2-download-manifest.json','terrain-v2-processing-manifest.json','terrain-v2-blender-validation.json')
    historical_record_retained = 'terrain-access-check.json: initial HEAD access metadata only, no height payload'
    targets = $taskResolved
    updated_utc = [DateTime]::UtcNow.ToString('o')
}
$taskAudit | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $taskAuditPath -Encoding utf8
foreach ($taskTarget in $taskResolved) {
    # Resolved paths were checked before any recursive filesystem operation.
    Remove-Item -LiteralPath $taskTarget.absolute -Recurse -Force
    if (Test-Path -LiteralPath $taskTarget.absolute) { throw "Old target still exists: $($taskTarget.relative)" }
}
$taskAudit.status = 'complete'
$taskAudit.updated_utc = [DateTime]::UtcNow.ToString('o')
$taskAudit['all_old_targets_absent'] = $true
$taskAudit | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $taskAuditPath -Encoding utf8
Write-Output ("Deleted {0} old files, {1} bytes; v2 validation passed." -f $taskAudit.old_file_count, $taskAudit.old_bytes)
