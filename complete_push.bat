@echo off
cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"
echo ================================
echo PUSHING ALL CODE TO GITHUB
echo ================================
echo.
echo Step 1: Checking current status...
git status
echo.
echo Step 2: Adding all files...
git add .
echo.
echo Step 3: Checking what changed...
git status
echo.
echo Step 4: Pushing to GitHub (may ask for credentials)...
git push origin main
echo.
echo Step 5: If that failed, trying force push...
git push origin main --force-with-lease
echo.
echo ================================
echo COMPLETED! Check: https://github.com/Shafaqali/claude-clone
echo ================================
pause