@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo [INFO] Root: %ROOT%

if not exist "backend\.env" (
  if exist "backend\.env.example" (
    copy /Y "backend\.env.example" "backend\.env" >nul
    echo [INFO] backend\.env created from template.
  )
)

if not exist "frontend\.env.local" (
  if exist "frontend\.env.local.example" (
    copy /Y "frontend\.env.local.example" "frontend\.env.local" >nul
    echo [INFO] frontend\.env.local created from template.
  )
)

call :kill_port 8000
call :kill_port 3000

if not exist "backend\.venv\Scripts\python.exe" (
  echo [INFO] Creating backend virtual environment...
  where py >nul 2>nul
  if %errorlevel%==0 (
    py -3.12 -m venv "backend\.venv"
  ) else (
    python -m venv "backend\.venv"
  )
  if errorlevel 1 goto :error
)

echo [INFO] Installing backend dependencies...
call "backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto :error

echo [INFO] Installing frontend dependencies...
pushd "frontend"
call npm install
if errorlevel 1 (
  popd
  goto :error
)
popd

echo [INFO] Starting backend on http://localhost:8000 ...
call powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -WindowStyle Normal -WorkingDirectory '%ROOT%backend' -FilePath '.\\.venv\\Scripts\\python.exe' -ArgumentList '-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000'" >nul 2>nul

timeout /t 1 >nul

echo [INFO] Starting frontend on http://localhost:3000 ...
call powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -WindowStyle Normal -WorkingDirectory '%ROOT%frontend' -FilePath 'cmd.exe' -ArgumentList '/k','npm run dev -- -H 0.0.0.0 -p 3000'" >nul 2>nul

echo.
echo [DONE] Services started.
echo        Backend : http://localhost:8000
echo        Frontend: http://localhost:3000
echo.
exit /b 0

:kill_port
set "TARGET_PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
  taskkill /PID %%P /F >nul 2>nul
)
exit /b 0

:error
echo.
echo [ERROR] Setup/start failed.
echo [ERROR] Check the messages above.
exit /b 1
