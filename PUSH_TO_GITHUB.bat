@echo off
echo ==========================================
echo 🚀 PUSHING CLAUDE AI AGENT TO GITHUB
echo ==========================================
echo.
echo ✨ Features Added:
echo - PWA Support (Progressive Web App)
echo - Gemini 3.6 Flash (Latest Free Model) 
echo - AQ. API Key Support
echo - Beautiful Claude AI Icon
echo - Service Worker for Offline
echo - Complete Documentation
echo.

cd /d "c:\Users\conne\Downloads\personal-claude-agent-ready"

echo 📦 Adding all files...
git add -A

echo 📝 Creating commit...
git commit -m "🚀 Complete Claude AI Agent v2.0

✨ Features:
- PWA (Progressive Web App) support
- Gemini 3.6 Flash integration (latest free model)
- AQ. API key support (Google's new format)
- Beautiful Claude AI themed icons
- Service Worker for offline functionality
- File upload (images, documents, text)
- Voice input/output capabilities
- Dark/Light themes with system detection
- Streaming responses with markdown rendering
- Local conversation persistence
- Export conversations as markdown
- Search functionality
- Agent tools (calculator, time)
- Complete error handling and fallbacks

🛠️ Technical:
- Express.js backend with secure API handling
- Modern ES6+ frontend with modular architecture
- Responsive design for mobile/desktop
- PWA manifest and service worker
- Comprehensive documentation and setup guide

🔒 Security:
- Server-side API key handling only
- No external data logging
- Local storage for conversations"

echo 🌐 Pushing to GitHub...
git push origin main --force

echo.
if %errorlevel% == 0 (
    echo ==========================================
    echo ✅ SUCCESS! CLAUDE AI AGENT UPLOADED!
    echo ==========================================
    echo.
    echo 🔗 Repository: https://github.com/Shafaqali/claude-clone
    echo 📱 PWA Ready: Can be installed as mobile/desktop app
    echo 🤖 AI Model: Gemini 3.6 Flash (Free Tier)
    echo 🎨 Features: Complete Claude-style interface
    echo.
    echo 🚀 Next Steps:
    echo 1. Visit your GitHub repository
    echo 2. Deploy to Render/Vercel/Railway
    echo 3. Add GEMINI_API_KEY environment variable
    echo 4. Share with users as PWA!
    echo.
) else (
    echo ❌ Push failed. Check credentials and try again.
)

echo Set GEMINI_API_KEY locally for development; no key is stored in this script.

echo ✅ Local environment restored.
echo.
pause