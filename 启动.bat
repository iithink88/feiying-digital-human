@echo off
chcp 65001 >nul
setlocal
title 飞影数字人视频工坊 - 图形界面
cd /d "%~dp0"

rem 清理可能残留的 server.js 进程
for /f "tokens=2" %%a in ('wmic process where "name='node.exe' and CommandLine like '%%server.js%%'" get ProcessId /value 2^>nul ^| find "="') do (
    taskkill /F /PID %%a >nul 2>&1
)

rem 逐个候选路径找 Node
set NODE_EXE=
where node >nul 2>&1
if not errorlevel 1 set NODE_EXE=node
if defined NODE_EXE goto RUN

if exist "C:/Program Files/nodejs/node.exe" set "NODE_EXE=C:/Program Files\nodejs\node.exe"
if defined NODE_EXE goto RUN

if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if defined NODE_EXE goto RUN

goto NONODE

:RUN
set LOGFILE=启动日志_%date:~0,4%%date:~5,2%%date:~8,2%%time:~0,2%%time:~3,2%.txt
echo [%date% %time%] 启动开始 > "%LOGFILE%"
echo [%date% %time%] 找到 Node：%NODE_EXE% >> "%LOGFILE%"
echo ========================================
echo   飞影数字人视频工坊 - 图形界面
echo   浏览器将自动打开，请勿关闭本窗口
echo   关闭本窗口则服务停止
echo ========================================
echo.
"%NODE_EXE%" gui/server.js >> "%LOGFILE%" 2>&1
echo [%date% %time%] 服务器已退出，代码 %errorlevel% >> "%LOGFILE%"
echo.
echo 服务器已停止。若为意外退出，请查看同目录下的日志文件
pause
goto END

:NONODE
echo ========================================
echo   未找到 Node.js
echo   请安装 Node.js 18+ 或确认 WorkBuddy 自带的 Node 可用
echo ========================================
pause

:END
