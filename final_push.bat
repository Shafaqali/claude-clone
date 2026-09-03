@echo off
cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"
echo Pushing to GitHub repository...
git push origin main
if %errorlevel% neq 0 (
    echo First push failed, trying force push...
    git push origin main --force-with-lease
)
echo.
echo Push completed! Check: https://github.com/Shafaqali/claude-clone
pause