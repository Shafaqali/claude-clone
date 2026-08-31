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
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }
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
  return `You are a highly capable personal AI agent. Be helpful, accurate, concise when appropriate, and transparent about uncertainty.
You are running inside a private Claude-inspired application. Do not claim to be Claude or Anthropic.
Use Markdown for readable answers. For programming requests, provide practical, complete code and explain important decisions.
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

  const { messages = [], context = "" } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "At least one message is required." });
  }

  try {
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt(context)
    });

    const history = cleanHistory(messages.slice(0, -1));
    const last = messages[messages.length - 1];

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(last.content);

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

  const allowed = /\.(txt|md|json|csv|js|jsx|ts|tsx|html|css|xml|yaml|yml|sql|py|php|java|c|cpp|h|env)$/i;
  try {
    if (!allowed.test(req.file.originalname)) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(415).json({
        error: "This demo supports text/code files only."
      });
    }

    const content = await fs.readFile(req.file.path, "utf8");
    await fs.unlink(req.file.path).catch(() => {});

    res.json({
      name: req.file.originalname,
      size: req.file.size,
      content: content.slice(0, 50000)
    });
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: "Could not read uploaded file." });
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