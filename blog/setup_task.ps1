# 월~금 자동 실행 작업을 Windows 작업 스케줄러에 등록합니다.
# 사용법 (PowerShell에서 blog 폴더로 이동한 뒤):  powershell -ExecutionPolicy Bypass -File .\setup_task.ps1
# 글 작성에 10~20분이 걸리므로, 게시 시각(config.json의 post_hour)보다 25분 먼저 시작합니다.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$config = Get-Content (Join-Path $here "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$python = (Get-Command python -ErrorAction Stop).Source

$start = (Get-Date -Hour $config.post_hour -Minute 0 -Second 0).AddMinutes(-25)
$action = New-ScheduledTaskAction -Execute $python -Argument "run_daily.py" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $start
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "NasumBlogDaily" -Action $action -Trigger $trigger -Settings $settings `
    -Description "나섬요양원 블로그 자동 글쓰기 (월~금)" -Force | Out-Null

Write-Host ("등록 완료: 월~금 {0:HH:mm} 시작, {1}시 정각~{1}시 {2}분 사이 무작위 게시" -f $start, $config.post_hour, $config.random_delay_minutes)
Write-Host "지금 바로 시험하려면:  Start-ScheduledTask -TaskName NasumBlogDaily"
Write-Host "해제하려면:            Unregister-ScheduledTask -TaskName NasumBlogDaily"
