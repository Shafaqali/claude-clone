import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 } // Increased to 50MB for images/documents
});

const client = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

function cleanHistory(messages = []) {
  return messages
    .filter(m => ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-30)
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content.slice(0, 30000) }]
    }));
}

function systemPrompt(context = "") {
  return `You are a highly capable personal AI agent with advanced file analysis and creation capabilities. Be helpful, accurate, concise when appropriate, and transparent about uncertainty.

Key Capabilities:
- Analyze text files, code, configuration files, and documents
- Analyze and describe images in detail (JPG, PNG, GIF, WebP, SVG, etc.)
- Create files based on user requirements (code, documents, configurations)
- Help with programming, writing, analysis, and problem-solving

You are running inside a private Claude-inspired application. Do not claim to be Claude or Anthropic.
Use Markdown for readable answers. For programming requests, provide practical, complete code and explain important decisions.

When users ask you to create files:
1. Provide the complete file content
2. Use appropriate syntax and formatting
3. Include helpful comments where needed
4. You can create any type of text file (code, config, documentation, etc.)

If the user asks you to perform an action you cannot actually perform, clearly say so instead of pretending.

Current application context:
${context.slice(0, 12000)}`;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL
  });
});

app.post("/api/chat", async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Add GEMINI_API_KEY to .env."
    });
  }

  const { messages = [], context = "", images = [] } = req.body || {};
  console.log('Chat request received:', { 
    messageCount: messages.length, 
    hasContext: Boolean(context),
    imageCount: images.length,
    lastMessage: messages[messages.length - 1]?.content?.substring(0, 100)
  });
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "At least one message is required." });
  }

  try {
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt(context)
    });

    const history = cleanHistory(messages.slice(0, -1));
    const lastMessage = messages[messages.length - 1];
    
    // Prepare the content for the last message
    let messageContent = [{ text: lastMessage.content }];
    
    // Add images if provided
    if (images && images.length > 0) {
      for (const img of images) {
        if (img.base64 && img.mimeType) {
          messageContent.push({
            inlineData: {
              data: img.base64,
              mimeType: img.mimeType
            }
          });
        }
      }
    }

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(messageContent);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Model", MODEL);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(text);
    }
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error?.message || "Gemini request failed."
      });
    } else {
      res.end();
    }
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const textFiles = /\.(txt|md|json|csv|js|jsx|ts|tsx|html|css|xml|yaml|yml|sql|py|php|java|c|cpp|h|env|log|ini|cfg|conf|sh|bat|ps1|dockerfile|gitignore|readme)$/i;
  const imageFiles = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i;
  const documentFiles = /\.(pdf|doc|docx|rtf|odt)$/i;
  const dataFiles = /\.(xlsx|xls|csv|tsv)$/i;
  
  try {
    const fileName = req.file.originalname;
    const fileSize = req.file.size;
    
    // Handle different file types
    if (textFiles.test(fileName)) {
      // Text files - read content directly
      const content = await fs.readFile(req.file.path, "utf8");
      await fs.unlink(req.file.path).catch(() => {});
      
      res.json({
        name: fileName,
        size: fileSize,
        type: "text",
        content: content.slice(0, 100000), // Increased limit
        analysis: `Text file with ${content.split('\n').length} lines`
      });
      
    } else if (imageFiles.test(fileName)) {
      // Images - convert to base64 for Gemini Vision API
      const imageBuffer = await fs.readFile(req.file.path);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = `image/${path.extname(fileName).slice(1).toLowerCase()}`;
      
      await fs.unlink(req.file.path).catch(() => {});
      
      res.json({
        name: fileName,
        size: fileSize,
        type: "image",
        mimeType: mimeType,
        base64: base64Image,
        analysis: `Image file (${Math.round(fileSize/1024)}KB)`
      });
      
    } else if (documentFiles.test(fileName)) {
      // Documents - placeholder for future PDF/Doc parsing
      await fs.unlink(req.file.path).catch(() => {});
      
      res.json({
        name: fileName,
        size: fileSize,
        type: "document",
        content: `[Document file: ${fileName}]`,
        analysis: `Document file - content extraction not yet implemented`
      });
      
    } else {
      // Unsupported file type
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(415).json({
        error: `Unsupported file type. Supported: text files, images (jpg, png, gif, etc.), and documents.`
      });
    }
    
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Could not process uploaded file." });
  }
});

app.post("/api/create-file", async (req, res) => {
  const { filename, content, type = "text" } = req.body;
  
  if (!filename || !content) {
    return res.status(400).json({ error: "Filename and content are required." });
  }
  
  try {
    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(filename);
    const filePath = path.join(uploadDir, `generated_${Date.now()}_${safeName}`);
    
    if (type === "base64") {
      // Handle base64 content (for images)
      const buffer = Buffer.from(content, 'base64');
      await fs.writeFile(filePath, buffer);
    } else {
      // Handle text content
      await fs.writeFile(filePath, content, 'utf8');
    }
    
    res.json({
      success: true,
      message: `File '${safeName}' created successfully`,
      path: filePath,
      size: content.length
    });
    
  } catch (error) {
    res.status(500).json({ error: "Failed to create file: " + error.message });
  }
});

app.post("/api/tool", (req, res) => {
  const { name, input } = req.body || {};

  if (name === "calculator") {
    const expression = String(input || "").trim();
    if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
      return res.status(400).json({ error: "Only basic arithmetic is allowed." });
    }
    try {
      const value = Function(`"use strict"; return (${expression})`)();
      return res.json({ result: String(value) });
    } catch {
      return res.status(400).json({ error: "Invalid expression." });
    }
  }

  if (name === "time") {
    return res.json({
      result: new Date().toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
  }

  res.status(404).json({ error: "Unknown tool." });
});

app.use((req, res, next) => {
  // Only serve index.html for non-static file requests
  if (req.path.startsWith('/api/') || 
      req.path.startsWith('/css/') || 
      req.path.startsWith('/js/') || 
      req.path.includes('.')) {
    next();
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Personal AI Agent running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});