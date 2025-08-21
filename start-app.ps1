# =========================
# Start App Automation Script (ALL-IN-ONE)
# =========================

# -------------------------
# 0. 환경 변수
# -------------------------
$backendPath = "C:\student-schedule-app-full\backend"
$frontendPath = "C:\student-schedule-app-full\frontend"
$backendPort = 5000
$frontendPort = 5173
$frontendUrl = "http://localhost:$frontendPort"

# -------------------------
# 1. 포트 점유 확인 및 종료 함수
# -------------------------
function Kill-Port($port) {
    Write-Host "🔍 Checking if port $port is in use..." -ForegroundColor Yellow
    $procId = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
    if ($procId) {
        Write-Host "⚠️ Port $port is in use by PID $procId. Terminating process..." -ForegroundColor Red
        Stop-Process -Id $procId -Force
        Write-Host "✅ Process on port $port killed." -ForegroundColor Green
    } else {
        Write-Host "✅ Port $port is free." -ForegroundColor Green
    }
}

# -------------------------
# 2. 포트 해제 (5000 + 5173)
# -------------------------
Kill-Port $backendPort
Kill-Port $frontendPort

# -------------------------
# 3. ✅ 프론트엔드 클린업 + 의존성 재설치
# -------------------------
Write-Host "🧹 Cleaning frontend node_modules and package-lock.json..." -ForegroundColor Yellow
if (Test-Path "$frontendPath\node_modules") {
    Remove-Item -Recurse -Force "$frontendPath\node_modules"
    Write-Host "✅ node_modules deleted." -ForegroundColor Green
} else {
    Write-Host "ℹ️ node_modules folder not found." -ForegroundColor Gray
}

if (Test-Path "$frontendPath\package-lock.json") {
    Remove-Item -Force "$frontendPath\package-lock.json"
    Write-Host "✅ package-lock.json deleted." -ForegroundColor Green
} else {
    Write-Host "ℹ️ package-lock.json not found." -ForegroundColor Gray
}

Write-Host "📦 Installing frontend dependencies (npm install)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "cd '$frontendPath'; npm install" -Wait

# -------------------------
# 4. 백엔드 실행 (항상 5000)
# -------------------------
Write-Host "▶️ Starting backend on port $backendPort..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "cd '$backendPath'; npm start" -NoNewWindow

# ✅ 백엔드 기동 대기
Start-Sleep -Seconds 4

# -------------------------
# 5. 프론트엔드 실행 (항상 5173)
# -------------------------
Write-Host "▶️ Starting frontend on port $frontendPort..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "cd '$frontendPath'; npm run dev -- --port $frontendPort" -NoNewWindow

# ✅ 프론트엔드 기동 대기
Start-Sleep -Seconds 3

# -------------------------
# 6. 브라우저 자동 실행
# -------------------------
Write-Host "🌐 Opening browser at $frontendUrl..." -ForegroundColor Yellow
Start-Process $frontendUrl

Write-Host "✅ All services started successfully! (Backend:$backendPort | Frontend:$frontendPort)" -ForegroundColor Green
