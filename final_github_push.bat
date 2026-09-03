@echo off
echo ========================================
echo FINAL GITHUB PUSH - CLAUDE AI AGENT  
echo ========================================

cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"

echo Step 1: Adding files...
git add . 2>nul

echo Step 2: Committing...
git commit -m "Complete: Claude AI Agent with Gemini 3.6 Flash + AQ Key Support + File Upload + Voice Features"

echo Step 3: Pushing to GitHub...
git push origin main --force

echo.
if %errorlevel% == 0 (
    echo ========================================
    echo ✅ SUCCESS! CODE PUSHED TO GITHUB
    echo 📂 Repository: https://github.com/Shafaqali/claude-clone  
    echo 🚀 Features: Gemini 3.6 Flash, AQ Keys, File Upload, Voice
    echo ========================================
) else (
    echo ❌ Push failed. Check your GitHub credentials.
    echo Try: git config --global credential.helper manager
)

echo.
echo Set GEMINI_API_KEY locally before running the app; no key is stored in this script.

echo Local .env restored for development.
pause