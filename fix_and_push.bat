@echo off
cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"
echo Fixing git and pushing...

REM Remove any git lock files
if exist ".git\index.lock" del ".git\index.lock"
if exist ".git\HEAD.lock" del ".git\HEAD.lock"

REM Add all files
git add -A

REM Commit with updated models
git commit -m "Fix: Update to Gemini 1.5 Flash models (deprecated 2.0-flash removed)"

REM Push to GitHub
git push origin main --force

echo.
echo ====================================
echo PUSH COMPLETED!
echo Check: https://github.com/Shafaqali/claude-clone
echo ====================================
pause