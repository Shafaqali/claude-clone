import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { verifyAuth, createAdminClient } from "@supabase/server/core";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_MODEL = "gemini-3.8-flash";
const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const GENERATION_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 8192);
const retryAttempts = Number(process.env.GEMINI_RETRY_ATTEMPTS);
const retryBaseDelay = Number(process.env.GEMINI_RETRY_BASE_DELAY_MS);
const GEMINI_RETRY_ATTEMPTS = Number.isFinite(retryAttempts)
  ? Math.min(5, Math.max(1, retryAttempts))
  : 3;
const GEMINI_RETRY_BASE_DELAY_MS = Number.isFinite(retryBaseDelay)
  ? Math.min(5000, Math.max(100, retryBaseDelay))
  : 900;
const AVAILABLE_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", note: "Recommended" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", note: "Stable fallback" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", note: "Fast fallback" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", note: "Legacy capacity" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", note: "Legacy lightweight" }
];
const FALLBACK_MODELS = [MODEL, ...AVAILABLE_MODELS.map(model => model.id)]
  .filter((model, index, models) => models.indexOf(model) === index);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_AUTH_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const SUPABASE_DB_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY);
const SUPABASE_ISSUER = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1` : undefined;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
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

let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (!SUPABASE_DB_CONFIGURED) return null;
  if (!supabaseAdmin) {
    supabaseAdmin = createAdminClient();
  }
  return supabaseAdmin;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(error) {
  return String(error?.message || error || "");
}

function isGemini3Model(modelName = "") {
  return /^gemini-3(?:\.|-)/i.test(modelName);
}

function generationConfigFor(modelName) {
  const config = {
    maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS
  };

  // Gemini 3+ rejects some old sampling parameters on the legacy endpoint.
  if (!isGemini3Model(modelName)) {
    config.temperature = 0.55;
  }

  return config;
}

function isSuspendedKeyError(error) {
  const message = errorText(error);
  return /suspended|CONSUMER_SUSPENDED/i.test(message);
}

function isInvalidApiKeyError(error) {
  const message = errorText(error);
  return /API key not valid|API_KEY_INVALID|invalid API key|key is invalid|invalid key/i.test(message);
}

function isAuthOrPermissionError(error) {
  const message = errorText(error);
  return /\b(401|403)\b|Forbidden|API key|permission/i.test(message);
}

function isRetryableGeminiError(error) {
  const message = errorText(error);
  return /\b(429|500|502|503|504)\b|high demand|overload|overloaded|temporar(?:y|ily)|unavailable|rate limit|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message);
}

function isGeminiCapacityError(error) {
  const message = errorText(error);
  return /\b503\b|high demand|overload|overloaded|unavailable|UNAVAILABLE/i.test(message);
}

function userFacingGeminiError(error, triedModels = []) {
  const message = errorText(error) || "Gemini request failed.";

  if (isSuspendedKeyError(error)) {
    return "Gemini API key is suspended. Create a new key in Google AI Studio, update GEMINI_API_KEY, and restart the server.";
  }

  if (isInvalidApiKeyError(error)) {
    return "Invalid Gemini API key. Check GEMINI_API_KEY in your environment variables, then restart/redeploy the server.";
  }

  if (isAuthOrPermissionError(error)) {
    return "Gemini rejected this API key or project permission. Check the key in Google AI Studio, then restart/redeploy the server.";
  }

  if (isGeminiCapacityError(error)) {
    return `Gemini is temporarily busy. I tried these models: ${triedModels.join(", ")}. Please retry in a minute, or set GEMINI_MODEL=gemini-3.8-flash on the server.`;
  }

  if (/quota|429|RESOURCE_EXHAUSTED/i.test(message)) {
    return "API quota or rate limit reached. Wait a moment before trying again, or check your Gemini API usage limits.";
  }

  if (/unavailable|not found/i.test(message)) {
    return `Model access issue. Your API key may not have access to one of the requested Gemini models. Tried models: ${triedModels.join(", ")}.`;
  }

  return message;
}

async function retryGeminiOperation(operation, modelName) {
  let lastError = null;

  for (let attempt = 1; attempt <= GEMINI_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error) || attempt === GEMINI_RETRY_ATTEMPTS) {
        throw error;
      }

      const delay = GEMINI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`Gemini ${modelName} retry ${attempt}/${GEMINI_RETRY_ATTEMPTS} after ${delay}ms:`, errorText(error));
      await sleep(delay);
    }
  }

  throw lastError;
}

async function openGeminiStream(modelName, history, messageContent, context) {
  return retryGeminiOperation(async () => {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt(context),
      generationConfig: generationConfigFor(modelName)
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(messageContent);
    const iterator = result.stream[Symbol.asyncIterator]();
    const firstChunk = await iterator.next();

    return { result, iterator, firstChunk };
  }, modelName);
}

function writeGeminiChunk(res, chunk) {
  const text = chunk?.text?.();
  if (text) res.write(text);
}

function expressToWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach(item => headers.append(key, item));
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const url = `${req.protocol}://${req.get("host")}${req.originalUrl || req.url}`;
  return new Request(url, { method: req.method, headers });
}

async function requireUser(req, res, next) {
  if (!SUPABASE_DB_CONFIGURED) {
    return res.status(503).json({
      error: "Supabase is not configured. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, and SUPABASE_JWKS_URL."
    });
  }

  const { data: auth, error } = await verifyAuth(expressToWebRequest(req), {
    auth: "user",
    issuer: SUPABASE_ISSUER
  });

  if (error) {
    return res.status(error.status || 401).json({
      error: "Authentication required.",
      code: error.code || "AUTH_ERROR"
    });
  }

  const id = auth.userClaims?.id || auth.jwtClaims?.sub;
  if (!id) {
    return res.status(401).json({ error: "Authentication token does not include a user id." });
  }

  req.user = {
    id,
    email: auth.userClaims?.email || auth.jwtClaims?.email || ""
  };
  next();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function sanitizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(message => ["user", "assistant"].includes(message?.role) && typeof message.content === "string")
    .slice(-200)
    .map(message => {
      const clean = {
        role: message.role,
        content: message.content.slice(0, 100000)
      };

      if (message.attachment && typeof message.attachment === "object") {
        const attachment = message.attachment;
        clean.attachment = {
          name: String(attachment.name || "").slice(0, 255),
          type: String(attachment.type || "").slice(0, 40),
          size: Number(attachment.size || 0),
          mimeType: String(attachment.mimeType || "").slice(0, 120),
          base64: typeof attachment.base64 === "string" && attachment.base64.length <= 2000000
            ? attachment.base64
            : null
        };
      }

      return clean;
    });
}

function formatChat(row) {
  return {
    id: row.id,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages : [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

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
1. Prefer complete, working files over partial snippets.
2. Use this artifact format for every generated file:
   ### \`filename.ext\`
   \`\`\`language
   complete file content
   \`\`\`
3. Include all files needed to run the result, such as index.html, styles.css, script.js, README.md, package.json, or config files.
4. Do not stop inside a code block. If the request is too large, create a smaller complete version first and then explain what can be expanded next.
5. Use appropriate syntax and formatting, with helpful comments only where they add clarity.

If the user asks you to perform an action you cannot actually perform, clearly say so instead of pretending.

Current application context:
${context.slice(0, 12000)}`;
}

app.get("/api/config", (req, res) => {
  res.json({
    supabase: {
      configured: SUPABASE_AUTH_CONFIGURED,
      databaseConfigured: SUPABASE_DB_CONFIGURED,
      url: SUPABASE_AUTH_CONFIGURED ? SUPABASE_URL : "",
      publishableKey: SUPABASE_AUTH_CONFIGURED ? SUPABASE_PUBLISHABLE_KEY : ""
    }
  });
});

app.get("/api/me", requireUser, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/chats", requireUser, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("chats")
      .select("id,title,messages,created_at,updated_at")
      .eq("user_id", req.user.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    res.json({ chats: (data || []).map(formatChat) });
  } catch (error) {
    res.status(500).json({
      error: "Could not load chats from Supabase.",
      details: error.message,
      hint: "Run the SQL in supabase/schema.sql if the chats table does not exist."
    });
  }
});

app.put("/api/chats/:id", requireUser, async (req, res) => {
  const { id } = req.params;
  const { title = "New conversation", messages = [] } = req.body || {};

  if (!isUuid(id)) {
    return res.status(400).json({ error: "Invalid chat id." });
  }

  const cleanTitle = String(title || "New conversation").replace(/\s+/g, " ").slice(0, 120);
  const cleanMessages = sanitizeMessages(messages);
  const now = new Date().toISOString();

  try {
    const admin = getSupabaseAdmin();
    const update = await admin
      .from("chats")
      .update({
        title: cleanTitle,
        messages: cleanMessages,
        updated_at: now
      })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select("id,title,messages,created_at,updated_at")
      .maybeSingle();

    if (update.error) throw update.error;

    if (update.data) {
      return res.json({ chat: formatChat(update.data) });
    }

    const insert = await admin
      .from("chats")
      .insert({
        id,
        user_id: req.user.id,
        title: cleanTitle,
        messages: cleanMessages,
        created_at: now,
        updated_at: now
      })
      .select("id,title,messages,created_at,updated_at")
      .single();

    if (insert.error) throw insert.error;
    res.status(201).json({ chat: formatChat(insert.data) });
  } catch (error) {
    const duplicateId = error.code === "23505";
    res.status(duplicateId ? 409 : 500).json({
      error: duplicateId
        ? "A chat with this id already exists."
        : "Could not save chat to Supabase.",
      details: error.message
    });
  }
});

app.delete("/api/chats/:id", requireUser, async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) {
    return res.status(400).json({ error: "Invalid chat id." });
  }

  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("chats")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    res.status(500).json({
      error: "Could not delete chat from Supabase.",
      details: error.message
    });
  }
});

// Quick test endpoint
app.get("/api/test-key", async (req, res) => {
  if (!client) {
    return res.json({ 
      error: "No API key configured",
      solution: "Add GEMINI_API_KEY to .env file"
    });
  }
  
  let lastError = null;
  const triedModels = [];

  try {
    for (const testModel of FALLBACK_MODELS) {
      triedModels.push(testModel);

      try {
        const model = client.getGenerativeModel({
          model: testModel,
          generationConfig: generationConfigFor(testModel)
        });
        const result = await retryGeminiOperation(
          () => model.generateContent("Say 'Hello, API key is working!'"),
          testModel
        );
        const response = await result.response;

        return res.json({
          success: true,
          message: response.text(),
          model: testModel,
          triedModels
        });
      } catch (error) {
        lastError = error;
        console.warn(`Test-key model ${testModel} failed:`, errorText(error));

        if (isSuspendedKeyError(error) || isInvalidApiKeyError(error)) {
          break;
        }
      }
    }

    throw lastError;
  } catch (error) {
    res.status(isSuspendedKeyError(error) || isInvalidApiKeyError(error) ? 403 : 503).json({
      error: userFacingGeminiError(error, triedModels),
      details: errorText(error),
      triedModels,
      solution: "Check your API key and model access in Google AI Studio."
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
    retryAttempts: GEMINI_RETRY_ATTEMPTS,
    availableModels: AVAILABLE_MODELS,
    supabase: {
      configured: SUPABASE_AUTH_CONFIGURED,
      databaseConfigured: SUPABASE_DB_CONFIGURED
    }
  });
});

app.get("/api/models", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.json({ models: AVAILABLE_MODELS, defaultModel: MODEL, live: false });
  }

  try {
    // For now, just return the verified working models
    res.json({
      models: AVAILABLE_MODELS,
      defaultModel: MODEL,
      live: true
    });
  } catch (error) {
    console.error("Models API error:", error);
    res.json({ models: AVAILABLE_MODELS, defaultModel: MODEL, live: false });
  }
});

// Test endpoint for image analysis
app.post("/api/test-image", async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Gemini API not configured" });
  }
  
  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) {
    return res.status(400).json({ error: "base64 and mimeType required" });
  }
  
  let lastError = null;
  const triedModels = [];

  try {
    for (const testModel of FALLBACK_MODELS) {
      triedModels.push(testModel);

      try {
        const model = client.getGenerativeModel({
          model: testModel,
          generationConfig: generationConfigFor(testModel)
        });
        const result = await retryGeminiOperation(
          () => model.generateContent([
            "Describe this image briefly:",
            {
              inlineData: {
                data: base64,
                mimeType: mimeType
              }
            }
          ]),
          testModel
        );

        const response = await result.response;
        return res.json({
          success: true,
          description: response.text(),
          model: testModel,
          triedModels
        });
      } catch (error) {
        lastError = error;
        console.warn(`Image test model ${testModel} failed:`, errorText(error));

        if (isSuspendedKeyError(error) || isInvalidApiKeyError(error)) {
          break;
        }
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Image test error:', error);
    res.status(isSuspendedKeyError(error) || isInvalidApiKeyError(error) ? 403 : 503).json({
      error: userFacingGeminiError(error, triedModels),
      details: errorText(error),
      triedModels
    });
  }
});

app.post("/api/chat", async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Add GEMINI_API_KEY to .env."
    });
  }

  const { messages = [], context = "", images = [], model: requestedModel } = req.body || {};
  const selectedModel = typeof requestedModel === "string" && /^gemini-[a-z0-9._-]+$/i.test(requestedModel)
    ? requestedModel
    : MODEL;
  
  console.log('Chat request received:', { 
    messageCount: messages.length, 
    hasContext: Boolean(context),
    imageCount: images.length,
    selectedModel: selectedModel,
    lastMessage: messages[messages.length - 1]?.content?.substring(0, 100)
  });
  
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "At least one message is required." });
  }

  const history = cleanHistory(messages.slice(0, -1));
  const lastMessage = messages[messages.length - 1];

  let messageContent = [{ text: lastMessage.content }];

  if (images && images.length > 0) {
    console.log('Processing images for Gemini:', images.length);
    for (const img of images) {
      if (img.base64 && img.mimeType) {
        console.log('Adding image:', { mimeType: img.mimeType, base64Length: img.base64.length });
        messageContent.push({
          inlineData: {
            data: img.base64,
            mimeType: img.mimeType
          }
        });
      } else {
        console.log('Invalid image data:', img);
      }
    }
  }

  console.log('Final messageContent:', messageContent.length, 'parts');

  const modelFallbacks = [selectedModel, ...FALLBACK_MODELS]
    .filter((model, index, models) => models.indexOf(model) === index);

  let lastError = null;
  const triedModels = [];
  
  for (const testModel of modelFallbacks) {
    triedModels.push(testModel);

    try {
      console.log(`Trying model: ${testModel}`);
      const { result, iterator, firstChunk } = await openGeminiStream(
        testModel,
        history,
        messageContent,
        context
      );

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Model", testModel);
      res.setHeader("X-Model-Attempts", triedModels.join(","));

      if (!firstChunk.done) {
        writeGeminiChunk(res, firstChunk.value);
      }

      try {
        while (true) {
          const chunk = await iterator.next();
          if (chunk.done) break;
          writeGeminiChunk(res, chunk.value);
        }

        const response = await result.response;
        const finishReason = response?.candidates?.[0]?.finishReason;
        if (finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(finishReason)) {
          const limitNote = finishReason === "MAX_TOKENS"
            ? "\n\n---\n_Generation reached the model output limit. Ask me to continue and I will continue from the last complete file._"
            : `\n\n---\n_Generation stopped with finish reason: ${finishReason}._`;
          res.write(limitNote);
        }

        res.end();
        return;
      } catch (streamError) {
        console.error(`Gemini stream interrupted for ${testModel}:`, errorText(streamError));
        const interruptionNote = isRetryableGeminiError(streamError)
          ? "\n\n---\n_Gemini connection was interrupted while streaming. Please retry; the server will automatically try fallback models again._"
          : `\n\n---\n_Generation stopped: ${errorText(streamError)}_`;
        res.write(interruptionNote);
        res.end();
        return;
      }
      
    } catch (error) {
      console.error(`Model ${testModel} failed before stream start:`, errorText(error));
      lastError = error;
      
      if (isSuspendedKeyError(error)) {
        return res.status(403).json({
          error: "Gemini API key is suspended. Create a new key in Google AI Studio, update GEMINI_API_KEY in .env, and restart the server."
        });
      }
      
      if (isInvalidApiKeyError(error)) {
        return res.status(403).json({
          error: "Invalid Gemini API key. Check GEMINI_API_KEY in your environment variables, then restart/redeploy the server."
        });
      }
      
      if (testModel !== modelFallbacks[modelFallbacks.length - 1]) {
        continue;
      }
    }
  }

  // If we get here, all models failed
  console.error('All models failed. Last error:', lastError);
  if (!res.headersSent) {
    const status = isGeminiCapacityError(lastError) || isRetryableGeminiError(lastError) ? 503 : 500;
    res.status(status).json({
      error: userFacingGeminiError(lastError, triedModels),
      details: errorText(lastError),
      triedModels
    });
  } else {
    res.end();
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
      
      // Better MIME type detection
      let mimeType;
      const ext = path.extname(fileName).toLowerCase();
      switch (ext) {
        case '.jpg':
        case '.jpeg':
          mimeType = 'image/jpeg';
          break;
        case '.png':
          mimeType = 'image/png';
          break;
        case '.gif':
          mimeType = 'image/gif';
          break;
        case '.webp':
          mimeType = 'image/webp';
          break;
        case '.svg':
          mimeType = 'image/svg+xml';
          break;
        case '.bmp':
          mimeType = 'image/bmp';
          break;
        case '.tiff':
        case '.tif':
          mimeType = 'image/tiff';
          break;
        default:
          mimeType = 'image/jpeg'; // fallback
      }
      
      console.log(`Image processed: ${fileName}, MIME: ${mimeType}, Size: ${base64Image.length}`);
      
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
