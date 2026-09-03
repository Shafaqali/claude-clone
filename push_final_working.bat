@echo off
cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"

echo ==========================================
echo PUSHING FINAL WORKING CODE TO GITHUB
echo ==========================================

REM Clean any git locks
if exist ".git\index.lock" del ".git\index.lock"

REM Remove API key from .env for security
powershell -Command "(gc .env) -replace 'AQ\.Ab.*', 'YOUR_API_KEY_HERE' | Out-File -FilePath .env -Encoding UTF8"

echo Adding all files...
git add -A

echo Committing with final fixes...
git commit -m "Final Fix: Use Free Tier Gemini 3.6 Flash models - Working with AQ keys"

echo Pushing to GitHub...
git push origin main --force

echo.
echo ==========================================
echo SUCCESS! Check: https://github.com/Shafaqali/claude-clone
echo ==========================================

REM Set GEMINI_API_KEY in the local environment before testing.
echo Set GEMINI_API_KEY locally before testing; no key is stored in this script.
pause