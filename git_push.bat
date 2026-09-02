@echo off
echo Attempting to push to GitHub...
cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"
git push origin main
if %errorlevel% == 0 (
    echo SUCCESS: Code pushed to GitHub!
) else (
    echo FAILED: Push failed. Checking status...
    git status
    echo.
    echo Trying force push...
    git push origin main --force-with-lease
)
pause