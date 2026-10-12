import { loadState, saveState, activeChat, setStateScope } from "./storage.js";
import { renderMarkdown } from "./markdown.js";
import { hydrateIcons, icon } from "./icons.js";
import {
  streamChat,
  uploadFile,
  checkHealth,
  fetchCloudChats,
  saveCloudChat,
  deleteCloudChat
} from "./api.js";
import {
  initAuth,
  isAuthConfigured,
  isDatabaseConfigured,
  getUser,
  onAuthChange,
  signIn,
  signUp,
  resendConfirmation,
  sendPasswordReset,
  updatePassword,
  signOut,
  authHeaders
} from "./auth.js";
import { startListening, speak } from "./voice.js";
import { runTool } from "./tools.js";

const availableModels = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite" }
];

const $ = selector => document.querySelector(selector);
let state = loadState();
if (!state.activeChatId) state.activeChatId = state.chats[0].id;

let controller = null;
let attachedContext = null;
let currentUser = null;
let authReady = false;
let databaseReady = false;
let authMode = "signin";
let authBusy = false;
let recoveryModeActive = false;
let lastConfirmationEmail = "";
let activeArtifact = null;
let activeArtifactGroup = [];
let artifactView = "preview";
const saveTimers = new Map();
const LANG_EXTENSIONS = {
  bash: "sh",
  csharp: "cs",
  css: "css",
  html: "html",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  md: "md",
  php: "php",
  python: "py",
  py: "py",
  shell: "sh",
  sql: "sql",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yml",
  yml: "yml"
};
const PREVIEW_EXTENSIONS = new Set(["html", "htm", "svg", "md", "markdown"]);

const els = {
  appShell: $("#appShell"),
  authScreen: $("#authScreen"),
  authForm: $("#authForm"),
  authTitle: $("#authTitle"),
  authSubtitle: $("#authSubtitle"),
  authTabs: $("#authTabs"),
  authSignInTab: $("#authSignInTab"),
  authSignUpTab: $("#authSignUpTab"),
  authEmailWrap: $("#authEmailWrap"),
  authEmail: $("#authEmail"),
  authPasswordWrap: $("#authPasswordWrap"),
  authPassword: $("#authPassword"),
  authConfirmWrap: $("#authConfirmWrap"),
  authConfirmPassword: $("#authConfirmPassword"),
  authSubmit: $("#authSubmitBtn"),
  authMessage: $("#authMessage"),
  forgotPassword: $("#forgotPasswordBtn"),
  resendConfirmation: $("#resendConfirmationBtn"),
  backToSignIn: $("#backToSignInBtn"),
  signOut: $("#signOutBtn"),
  profileName: $("#profileName"),
  profileEmail: $("#profileEmail"),
  sidebar: $("#sidebar"),
  overlay: $("#overlay"),
  chatList: $("#chatList"),
  messages: $("#messages"),
  welcome: $("#welcome"),
  composer: $("#composer"),
  send: $("#sendBtn"),
  stop: $("#stopBtn"),
  attachment: $("#attachmentPreview"),
  file: $("#fileInput"),
  settings: $("#settingsDialog"),
  modelMenu: $("#modelMenu"),
  modelName: $("#modelName"),
  toolPopover: $("#toolPopover"),
  brand: $("#brandButton"),
  artifactPanel: $("#artifactPanel"),
  artifactTitle: $("#artifactTitle"),
  artifactMeta: $("#artifactMeta"),
  artifactDownload: $("#artifactDownloadBtn"),
  artifactCopy: $("#artifactCopyBtn"),
  artifactClose: $("#artifactCloseBtn"),
  artifactPreviewTab: $("#artifactPreviewTab"),
  artifactCodeTab: $("#artifactCodeTab"),
  artifactPreview: $("#artifactPreview"),
  artifactCode: $("#artifactCode"),
  artifactEmpty: $("#artifactEmpty")
};

function current() {
  return activeChat(state);
}

function loadScopedState() {
  state = loadState(currentUser?.id || null);
  if (!state.activeChatId) state.activeChatId = state.chats[0].id;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileExtension(name = "") {
  const clean = name.split(/[?#]/)[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function languageExtension(language = "") {
  return LANG_EXTENSIONS[language.toLowerCase()] || "txt";
}

function sanitizeArtifactName(name = "") {
  return String(name)
    .trim()
    .replace(/^[-*#\s`"'[\]()]+/, "")
    .replace(/[`"'[\]()]+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[<>:"|?*]/g, "")
    .slice(0, 120);
}

function inferArtifactName(before, language, index) {
  const context = before.split("\n").slice(-8).join("\n");
  const filenamePattern = "([A-Za-z0-9][A-Za-z0-9_./ -]*\\.[A-Za-z0-9]{1,8})";
  const direct = context.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?\\\`?${filenamePattern}\\\`?\\s*$`, "i"));
  const labeled = context.match(new RegExp(`(?:file|filename|path)\\s*[:\\-]\\s*\\\`?${filenamePattern}\\\`?`, "i"));
  const found = sanitizeArtifactName((labeled || direct)?.[1] || "");
  if (found) return found;

  const ext = languageExtension(language);
  if (ext === "html" && index === 0) return "index.html";
  if (ext === "css" && index <= 1) return "styles.css";
  if (ext === "js" && index <= 2) return "script.js";
  return `artifact-${index + 1}.${ext}`;
}

function artifactLabel(artifact) {
  const ext = artifact.extension || fileExtension(artifact.name);
  const labels = {
    css: "Stylesheet",
    html: "HTML",
    htm: "HTML",
    js: "JavaScript",
    json: "JSON",
    jsx: "React",
    md: "Markdown",
    py: "Python",
    svg: "SVG",
    ts: "TypeScript",
    tsx: "React TS"
  };
  return labels[ext] || (artifact.language ? artifact.language.toUpperCase() : "Code");
}

function artifactMime(artifact) {
  const ext = artifact.extension;
  return {
    css: "text/css",
    html: "text/html",
    htm: "text/html",
    js: "text/javascript",
    json: "application/json",
    md: "text/markdown",
    svg: "image/svg+xml",
    txt: "text/plain"
  }[ext] || "text/plain";
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isArtifactHeadingLine(line = "") {
  const filenamePattern = "[A-Za-z0-9][A-Za-z0-9_./ -]*\\.[A-Za-z0-9]{1,8}";
  return new RegExp(`^(?:#{1,6}\\s*)?(?:(?:file|filename|path)\\s*[:\\-]\\s*)?\`?${filenamePattern}\`?\\s*$`, "i")
    .test(line.trim());
}

function previousLine(content, index) {
  const lineEnd = content.lastIndexOf("\n", Math.max(0, index - 1));
  if (lineEnd === -1) return null;
  const lineStart = content.lastIndexOf("\n", Math.max(0, lineEnd - 1)) + 1;
  return {
    start: lineStart,
    end: lineEnd + 1,
    text: content.slice(lineStart, lineEnd)
  };
}

function artifactBlockStart(content, fenceStart) {
  let cursor = fenceStart;

  for (let i = 0; i < 3; i += 1) {
    const line = previousLine(content, cursor);
    if (!line) break;

    if (!line.text.trim()) {
      cursor = line.start;
      continue;
    }

    if (isArtifactHeadingLine(line.text)) return line.start;
    break;
  }

  return fenceStart;
}

function removeRanges(content, ranges) {
  if (!ranges.length) return content;

  let output = "";
  let cursor = 0;
  ranges.sort((a, b) => a.start - b.start).forEach(range => {
    output += content.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  });

  return `${output}${content.slice(cursor)}`
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseArtifacts(content = "") {
  const artifacts = [];
  const ranges = [];
  const pattern = /```([\w.+#-]*)[^\S\r\n]*(?:\r?\n)?/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const language = (match[1] || "code").toLowerCase();
    const codeStart = pattern.lastIndex;
    const closeIndex = content.indexOf("```", codeStart);
    const complete = closeIndex !== -1;
    const codeEnd = complete ? closeIndex : content.length;
    let code = content.slice(codeStart, codeEnd).trimEnd();
    let end = complete ? closeIndex + 3 : content.length;

    if (!complete) {
      const note = code.match(/\n{2,}---\n_[\s\S]*$/);
      if (note) {
        code = code.slice(0, note.index).trimEnd();
        end = codeStart + note.index;
      }
    }

    if (!code.trim()) {
      pattern.lastIndex = complete ? closeIndex + 3 : content.length;
      if (!complete) break;
      continue;
    }

    const name = inferArtifactName(content.slice(0, match.index), language, artifacts.length);
    const extension = fileExtension(name) || languageExtension(language);
    const start = artifactBlockStart(content, match.index);

    artifacts.push({
      id: `${artifacts.length}-${name}`,
      name,
      downloadName: name.split(/[\\/]/).pop() || name,
      language,
      extension,
      code,
      bytes: new TextEncoder().encode(code).length,
      incomplete: !complete
    });
    ranges.push({ start, end });

    pattern.lastIndex = complete ? end : content.length;
    if (!complete) break;
  }

  return {
    artifacts,
    displayContent: removeRanges(content, ranges)
  };
}

function extractArtifacts(content = "") {
  return parseArtifacts(content).artifacts;
}

function artifactMetaText(artifact) {
  const partial = artifact.incomplete ? " - partial" : "";
  return `${artifactLabel(artifact)} - ${formatBytes(artifact.bytes)}${partial}`;
}

function canPreviewArtifact(artifact, group = []) {
  if (!artifact) return false;
  if (PREVIEW_EXTENSIONS.has(artifact.extension)) return true;
  return Boolean(group.some(item => ["html", "htm"].includes(item.extension)));
}

function injectArtifactsIntoHtml(html, artifacts) {
  let output = html;
  const styles = artifacts
    .filter(item => item.extension === "css")
    .map(item => `<style data-artifact="${escapeHtml(item.name)}">\n${item.code.replace(/<\/style/gi, "<\\/style")}\n</style>`)
    .join("\n");
  const scripts = artifacts
    .filter(item => ["js", "jsx", "ts", "tsx"].includes(item.extension))
    .map(item => `<script data-artifact="${escapeHtml(item.name)}">\n${item.code.replace(/<\/script/gi, "<\\/script")}\n</script>`)
    .join("\n");

  artifacts.filter(item => item.extension === "css").forEach(item => {
    const names = [item.name, item.downloadName].filter(Boolean).map(escapeRegExp).join("|");
    if (names) {
      output = output.replace(new RegExp(`<link[^>]+href=["'][^"']*(?:${names})["'][^>]*>`, "gi"), "");
    }
  });

  artifacts.filter(item => ["js", "jsx", "ts", "tsx"].includes(item.extension)).forEach(item => {
    const names = [item.name, item.downloadName].filter(Boolean).map(escapeRegExp).join("|");
    if (names) {
      output = output.replace(new RegExp(`<script[^>]+src=["'][^"']*(?:${names})["'][^>]*>\\s*</script>`, "gi"), "");
    }
  });

  output = /<\/head>/i.test(output) ? output.replace(/<\/head>/i, `${styles}\n</head>`) : `${styles}\n${output}`;
  output = /<\/body>/i.test(output) ? output.replace(/<\/body>/i, `${scripts}\n</body>`) : `${output}\n${scripts}`;
  return output;
}

function buildPreviewDocument(artifact, group = []) {
  const htmlArtifact = ["html", "htm"].includes(artifact.extension)
    ? artifact
    : group.find(item => ["html", "htm"].includes(item.extension));

  if (htmlArtifact) {
    return injectArtifactsIntoHtml(htmlArtifact.code, group);
  }

  if (artifact.extension === "svg") {
    return `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${artifact.code}</body></html>`;
  }

  if (["md", "markdown"].includes(artifact.extension)) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:15px/1.6 system-ui;margin:32px;max-width:760px}code,pre{background:#f2f4f5;padding:2px 4px;border-radius:4px}pre{padding:14px;overflow:auto}</style></head><body>${renderMarkdown(artifact.code)}</body></html>`;
  }

  return "";
}

function downloadArtifact(artifact) {
  const blob = new Blob([artifact.code], { type: artifactMime(artifact) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.downloadName;
  link.click();
  URL.revokeObjectURL(url);
}

function renderArtifactPanel() {
  if (!activeArtifact) {
    els.artifactPanel.classList.add("hidden");
    els.artifactPreview.srcdoc = "";
    return;
  }

  const previewable = canPreviewArtifact(activeArtifact, activeArtifactGroup);
  artifactView = previewable ? artifactView : "code";
  els.artifactPanel.classList.remove("hidden");
  els.artifactTitle.textContent = activeArtifact.name;
  els.artifactMeta.textContent = artifactMetaText(activeArtifact);
  els.artifactPreviewTab.disabled = !previewable;
  els.artifactPreviewTab.classList.toggle("active", artifactView === "preview");
  els.artifactCodeTab.classList.toggle("active", artifactView === "code");
  els.artifactCode.textContent = activeArtifact.code;

  const showPreview = artifactView === "preview" && previewable;
  els.artifactPreview.classList.toggle("hidden", !showPreview);
  els.artifactCode.classList.toggle("hidden", artifactView !== "code");
  els.artifactEmpty.classList.toggle("hidden", artifactView !== "preview" || previewable);
  els.artifactPreview.srcdoc = showPreview ? buildPreviewDocument(activeArtifact, activeArtifactGroup) : "";
}

function openArtifact(artifact, group = [artifact]) {
  activeArtifact = artifact;
  activeArtifactGroup = group;
  artifactView = canPreviewArtifact(artifact, group) ? "preview" : "code";
  renderArtifactPanel();
}

function closeArtifactPanel() {
  activeArtifact = null;
  activeArtifactGroup = [];
  renderArtifactPanel();
}

function createArtifactCards(artifacts) {
  const wrap = document.createElement("div");
  wrap.className = "artifact-cards";

  artifacts.forEach(artifact => {
    const card = document.createElement("div");
    card.className = "artifact-card";
    card.innerHTML = `
      <button class="artifact-card-main" type="button">
        <span class="artifact-card-icon">${icon(["html", "htm", "svg"].includes(artifact.extension) ? "eye" : "code")}</span>
        <span><strong></strong><small>${escapeHtml(artifactMetaText(artifact))}</small></span>
      </button>
      <button class="artifact-card-download" type="button" title="Download ${escapeHtml(artifact.downloadName)}" aria-label="Download ${escapeHtml(artifact.downloadName)}">${icon("download")}</button>
    `;
    card.querySelector("strong").textContent = artifact.name;
    card.querySelector(".artifact-card-main").addEventListener("click", () => openArtifact(artifact, artifacts));
    card.querySelector(".artifact-card-download").addEventListener("click", event => {
      event.stopPropagation();
      downloadArtifact(artifact);
    });
    wrap.appendChild(card);
  });

  return wrap;
}

function cleanChatForCloud(chat) {
  return {
    id: chat.id,
    title: chat.title,
    messages: chat.messages.map(message => {
      const clean = {
        role: message.role,
        content: message.content
      };

      if (message.attachment) {
        clean.attachment = {
          ...message.attachment,
          base64: typeof message.attachment.base64 === "string" && message.attachment.base64.length <= 2000000
            ? message.attachment.base64
            : null
        };
      }

      return clean;
    })
  };
}

async function cloudHeaders() {
  if (!authReady || !databaseReady || !currentUser) return null;
  return authHeaders();
}

function queueCloudSave(chat) {
  if (!authReady || !databaseReady || !currentUser || !chat?.id) return;
  clearTimeout(saveTimers.get(chat.id));
  saveTimers.set(chat.id, setTimeout(async () => {
    try {
      const headers = await cloudHeaders();
      if (headers) await saveCloudChat(cleanChatForCloud(chat), headers);
    } catch (error) {
      console.warn("Cloud save failed:", error.message);
    } finally {
      saveTimers.delete(chat.id);
    }
  }, 500));
}

function save({ sync = true } = {}) {
  state.chats.forEach(chat => {
    if (chat.id === state.activeChatId) chat.updatedAt = Date.now();
  });
  saveState(state);
  if (sync) queueCloudSave(current());
}

async function syncAllChatsToCloud() {
  if (!authReady || !databaseReady || !currentUser) return;
  try {
    const headers = await cloudHeaders();
    if (!headers) return;
    await Promise.all(state.chats.map(chat => saveCloudChat(cleanChatForCloud(chat), headers)));
  } catch (error) {
    console.warn("Initial cloud sync failed:", error.message);
  }
}

async function loadCloudState() {
  if (!authReady || !databaseReady || !currentUser) return;

  try {
    const headers = await cloudHeaders();
    const cloudChats = await fetchCloudChats(headers);

    if (cloudChats.length) {
      state.chats = cloudChats;
      state.activeChatId = cloudChats.some(chat => chat.id === state.activeChatId)
        ? state.activeChatId
        : cloudChats[0].id;
      saveState(state);
    } else if (state.chats.some(chat => chat.messages.length > 0)) {
      await syncAllChatsToCloud();
    }
  } catch (error) {
    console.warn("Cloud load failed:", error.message);
  }
}

function showAuth(message = "") {
  closeArtifactPanel();
  els.authScreen.classList.remove("hidden");
  els.appShell.classList.add("hidden");
  setAuthMessage(message);
}

function showApp() {
  els.authScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");
}

function setAuthMessage(message = "", type = "") {
  els.authMessage.textContent = message;
  els.authMessage.classList.toggle("error", type === "error");
  els.authMessage.classList.toggle("success", type === "success");
}

function setAuthBusy(isBusy) {
  authBusy = isBusy;
  els.authSubmit.disabled = isBusy;
  els.authSignInTab.disabled = isBusy;
  els.authSignUpTab.disabled = isBusy;
  els.forgotPassword.disabled = isBusy;
  els.resendConfirmation.disabled = isBusy;
  els.backToSignIn.disabled = isBusy;
  els.authEmail.disabled = isBusy;
  els.authPassword.disabled = isBusy;
  els.authConfirmPassword.disabled = isBusy;
}

function isPasswordRecoveryUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get("type") === "recovery" || query.get("type") === "recovery";
}

function setAuthMode(mode, message = "", type = "") {
  authMode = mode;
  setAuthMessage(message, type);

  const copy = {
    signin: {
      title: "Welcome back",
      subtitle: "Sign in to continue.",
      submit: "Sign in"
    },
    signup: {
      title: "Create account",
      subtitle: "Start syncing your conversations.",
      submit: "Create account"
    },
    reset: {
      title: "Reset password",
      subtitle: "Send a recovery link to your email.",
      submit: "Send reset link"
    },
    update: {
      title: "Set new password",
      subtitle: "Choose a new password for your account.",
      submit: "Update password"
    }
  }[mode];

  els.authTitle.textContent = copy.title;
  els.authSubtitle.textContent = copy.subtitle;
  els.authSubmit.textContent = copy.submit;

  els.authTabs.classList.toggle("hidden", mode === "reset" || mode === "update");
  els.authSignInTab.classList.toggle("active", mode === "signin");
  els.authSignUpTab.classList.toggle("active", mode === "signup");
  els.authEmailWrap.classList.toggle("hidden", mode === "update");
  els.authPasswordWrap.classList.toggle("hidden", mode === "reset");
  els.authConfirmWrap.classList.toggle("hidden", mode !== "signup" && mode !== "update");
  els.forgotPassword.classList.toggle("hidden", mode !== "signin");
  els.resendConfirmation.classList.add("hidden");
  els.backToSignIn.classList.toggle("hidden", mode === "signin" || mode === "update");

  els.authEmail.required = mode !== "update";
  els.authPassword.required = mode !== "reset";
  els.authConfirmPassword.required = mode === "signup" || mode === "update";
  els.authPassword.autocomplete = mode === "signin" ? "current-password" : "new-password";
  els.authConfirmPassword.value = "";

  if (mode === "reset") {
    els.authEmail.focus();
  } else if (mode === "update") {
    els.authPassword.focus();
  }
}

function normalizedEmail() {
  return els.authEmail.value.trim().toLowerCase();
}

function isEmailNotConfirmedError(error) {
  return /email not confirmed|email_not_confirmed/i.test(`${error?.message || ""} ${error?.code || ""}`);
}

function showConfirmationHelp(email, message = "Email not confirmed. Check your inbox or resend the confirmation link.", type = "error") {
  lastConfirmationEmail = email;
  setAuthMode("signin", message, type);
  els.authEmail.value = email;
  els.resendConfirmation.classList.remove("hidden");
}

function validatePasswordPair() {
  const password = els.authPassword.value;
  const confirm = els.authConfirmPassword.value;

  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
  if ((authMode === "signup" || authMode === "update") && password !== confirm) {
    throw new Error("Passwords do not match.");
  }

  return password;
}

function updateProfile() {
  const email = currentUser?.email || "";
  els.signOut.classList.toggle("hidden", !currentUser);
  els.profileName.textContent = currentUser ? "Signed in" : "Personal Agent";
  els.profileEmail.textContent = currentUser
    ? email
    : authReady
      ? "Sign in to sync"
      : "Local workspace";
}

function applyTheme() {
  const theme = state.settings.theme || "system";
  document.documentElement.dataset.theme = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
}

function renderChatList() {
  const query = $("#searchChats").value.toLowerCase();
  els.chatList.innerHTML = "";
  const filtered = state.chats
    .filter(chat => chat.title.toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = query ? "No chats match your search." : "No chats yet.";
    els.chatList.appendChild(empty);
    return;
  }

  filtered.forEach(chat => {
    const row = document.createElement("div");
    row.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
    row.innerHTML = `${icon("message", "chat-row-icon")}<span class="title"></span><button class="chat-delete" title="Delete chat" aria-label="Delete chat">${icon("x")}</button>`;
    row.querySelector(".title").textContent = chat.title;
    row.title = chat.title;
    row.addEventListener("click", event => {
      if (event.target.closest(".chat-delete")) return;
      state.activeChatId = chat.id;
      closeArtifactPanel();
      save({ sync: false });
      renderAll();
      closeMobile();
    });
    row.querySelector(".chat-delete").addEventListener("click", async event => {
      event.stopPropagation();
      if (state.chats.length === 1) return;
      state.chats = state.chats.filter(item => item.id !== chat.id);
      if (state.activeChatId === chat.id) state.activeChatId = state.chats[0].id;
      save({ sync: false });
      renderAll();

      try {
        const headers = await cloudHeaders();
        if (headers) await deleteCloudChat(chat.id, headers);
      } catch (error) {
        console.warn("Cloud delete failed:", error.message);
      }
    });
    els.chatList.appendChild(row);
  });
}

function attachmentMarkup(attachment) {
  if (!attachment) return "";

  if (attachment.type === "image" && attachment.base64) {
    return `
      <div class="message-attachment">
        <img src="data:${attachment.mimeType};base64,${attachment.base64}" alt="">
        <div>
          <strong>Image</strong>
          <small>${escapeHtml(attachment.name)} - ${Math.round(attachment.size / 1024)} KB</small>
        </div>
      </div>
    `;
  }

  return `
    <div class="message-attachment">
      <div class="file-chip">${icon(attachment.type === "document" ? "fileText" : "file")}</div>
      <div>
        <strong>${attachment.type === "document" ? "Document" : "File"}</strong>
        <small>${escapeHtml(attachment.name)} - ${Math.round(attachment.size / 1024)} KB</small>
      </div>
    </div>
  `;
}

function bindCodeCopyButtons(root) {
  root.querySelectorAll("[data-copy-code]").forEach(button => {
    button.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(decodeURIComponent(button.dataset.copyCode));
      button.textContent = "Copied";
      setTimeout(() => button.textContent = "Copy", 1000);
    });
  });
}

function renderAssistantBubble(bubble, content, { streaming = false } = {}) {
  const { artifacts, displayContent } = parseArtifacts(content);
  const rendered = renderMarkdown(displayContent);
  bubble.innerHTML = rendered || (streaming ? `<div class="typing"><i></i><i></i><i></i></div>` : "");

  if (artifacts.length) {
    bubble.insertBefore(createArtifactCards(artifacts), bubble.firstChild);
  }

  bindCodeCopyButtons(bubble);
  return artifacts;
}

function renderMessages() {
  const chat = current();
  els.messages.innerHTML = "";
  els.welcome.classList.toggle("hidden", chat.messages.length > 0);

  chat.messages.forEach(message => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble message-content";

    if (message.role === "assistant") {
      renderAssistantBubble(bubble, message.content);
    } else {
      bubble.innerHTML = attachmentMarkup(message.attachment) + `<p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>`;
    }

    if (message.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.innerHTML = `<button data-copy>${icon("copy")}<span>Copy</span></button>${state.settings.voice === "on" ? `<button data-speak>${icon("volume")}<span>Read aloud</span></button>` : ""}`;
      actions.querySelector("[data-copy]").onclick = () => navigator.clipboard?.writeText(message.content);
      actions.querySelector("[data-speak]")?.addEventListener("click", () => speak(message.content));
      bubble.appendChild(actions);
    }

    if (message.role === "assistant") {
      article.innerHTML = `<div class="message-avatar">${icon("bot")}</div>`;
    }
    article.appendChild(bubble);
    els.messages.appendChild(article);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderAll() {
  renderChatList();
  renderMessages();
  const selected = availableModels.find(model => model.id === state.settings.model);
  els.modelName.textContent = selected?.name || "Gemini";
  applyTheme();
  applySidebarCollapsed();
  updateProfile();
  autosize();
}

function newChat() {
  const chat = {
    id: crypto.randomUUID(),
    title: "New conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  attachedContext = null;
  closeArtifactPanel();
  els.attachment.classList.add("hidden");
  save({ sync: false });
  renderAll();
  els.composer.focus();
  closeMobile();
}

function autosize() {
  els.composer.style.height = "auto";
  els.composer.style.height = Math.min(els.composer.scrollHeight, 180) + "px";
  els.send.disabled = !els.composer.value.trim() || Boolean(controller);
}

function removeAttachment() {
  attachedContext = null;
  els.attachment.classList.add("hidden");
  els.attachment.innerHTML = "";
  els.file.value = "";
}

window.removeAttachment = removeAttachment;

async function sendMessage(text = els.composer.value.trim()) {
  if (!text || controller) return;

  const chat = current();
  const userMessage = { role: "user", content: text };

  if (attachedContext) {
    userMessage.attachment = {
      name: attachedContext.name,
      type: attachedContext.type,
      size: attachedContext.size,
      mimeType: attachedContext.mimeType,
      base64: attachedContext.type === "image" ? attachedContext.base64 : null
    };
  }

  chat.messages.push(userMessage);

  if (chat.title === "New conversation") {
    chat.title = text.replace(/\s+/g, " ").slice(0, 42) || "New conversation";
  }

  els.composer.value = "";
  const currentAttachment = attachedContext;
  attachedContext = null;
  els.attachment.classList.add("hidden");
  save();
  renderAll();

  const assistant = { role: "assistant", content: "" };
  chat.messages.push(assistant);
  renderMessages();

  const article = els.messages.lastElementChild;
  const bubble = article.querySelector(".message-content");
  bubble.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
  controller = new AbortController();
  els.stop.classList.remove("hidden");
  els.send.classList.add("hidden");

  const context = [
    state.settings.context,
    currentAttachment?.content ? `Attached file: ${currentAttachment.name}\n${currentAttachment.content}` : ""
  ].filter(Boolean).join("\n\n");

  const images = [];
  if (currentAttachment?.type === "image" && currentAttachment.base64 && currentAttachment.mimeType) {
    images.push({
      base64: currentAttachment.base64,
      mimeType: currentAttachment.mimeType
    });
  }

  try {
    await streamChat(chat.messages.slice(0, -1), context, controller.signal, (_, full) => {
      assistant.content = full;
      renderAssistantBubble(bubble, full, { streaming: true });
      els.messages.scrollTop = els.messages.scrollHeight;
    }, images, state.settings.model);
    save();
    renderMessages();
    const artifacts = extractArtifacts(assistant.content);
    if (artifacts.length) openArtifact(artifacts[0], artifacts);
    if (state.settings.voice === "on") speak(assistant.content);
  } catch (error) {
    if (error.name === "AbortError") {
      assistant.content += assistant.content ? "\n\n_Generation stopped._" : "_Generation stopped._";
    } else {
      const quota = error.message.includes("quota") || error.message.includes("429");
      assistant.content = quota
        ? "**Error:** API quota exceeded. Wait a moment before trying again or check your Gemini usage limits."
        : `**Error:** ${error.message}`;
    }
    save();
    renderMessages();
  } finally {
    controller = null;
    els.stop.classList.add("hidden");
    els.send.classList.remove("hidden");
    autosize();
  }
}

function openSettings() {
  $("#appearanceSelect").value = state.settings.theme;
  $("#voiceSelect").value = state.settings.voice;
  $("#systemContext").value = state.settings.context;
  els.settings.showModal();
  checkHealth().then(data => {
    const gemini = data.configured ? `Gemini connected - ${data.model}` : "Gemini API key not configured.";
    const supabase = data.supabase?.databaseConfigured ? "Supabase sync ready." : "Supabase sync not configured.";
    $("#apiStatus").textContent = `${gemini} ${supabase}`;
  }).catch(() => $("#apiStatus").textContent = "Server unavailable.");
}

function closeMobile() {
  els.sidebar.classList.remove("open");
  els.overlay.classList.add("hidden");
}

function applySidebarCollapsed() {
  els.sidebar.classList.toggle("collapsed", Boolean(state.settings.sidebarCollapsed));
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (authBusy) return;

  setAuthBusy(true);
  try {
    if (authMode === "signin") {
      setAuthMessage("Signing in...");
      const data = await signIn(normalizedEmail(), els.authPassword.value);
      currentUser = data.user;
      await enterApp();
      return;
    }

    if (authMode === "signup") {
      const email = normalizedEmail();
      const password = validatePasswordPair();
      setAuthMessage("Creating account...");
      const data = await signUp(email, password);

      if (data.session) {
        currentUser = data.user;
        await enterApp();
      } else {
        currentUser = null;
        showConfirmationHelp(email, "Account created. Check your email before signing in.", "success");
      }
      return;
    }

    if (authMode === "reset") {
      setAuthMessage("Sending reset link...");
      await sendPasswordReset(normalizedEmail());
      setAuthMode("signin", "Password reset link sent. Check your email.", "success");
      return;
    }

    if (authMode === "update") {
      const password = validatePasswordPair();
      setAuthMessage("Updating password...");
      await updatePassword(password);
      const user = await getUser();
      currentUser = user;
      recoveryModeActive = false;
      setAuthMessage("Password updated.", "success");
      await enterApp();
    }
  } catch (error) {
    if (isEmailNotConfirmedError(error)) {
      showConfirmationHelp(normalizedEmail());
    } else {
      setAuthMessage(error.message, "error");
    }
  } finally {
    setAuthBusy(false);
  }
}

async function handleResendConfirmation() {
  if (authBusy) return;
  const email = lastConfirmationEmail || normalizedEmail();

  if (!email) {
    setAuthMessage("Enter your email first.", "error");
    return;
  }

  setAuthBusy(true);
  try {
    setAuthMessage("Sending confirmation email...");
    await resendConfirmation(email);
    showConfirmationHelp(email, "Confirmation email sent. Check your inbox.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
  } finally {
    setAuthBusy(false);
  }
}

async function handleSignOut() {
  try {
    await signOut();
  } finally {
    currentUser = null;
    setStateScope(null);
    state = loadState(null);
    closeArtifactPanel();
    setAuthMode("signin");
    showAuth();
  }
}

async function enterApp() {
  showApp();
  loadScopedState();
  updateProfile();
  await loadCloudState();
  renderAll();
}

function bindEvents() {
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.authSignInTab.addEventListener("click", () => setAuthMode("signin"));
  els.authSignUpTab.addEventListener("click", () => setAuthMode("signup"));
  els.forgotPassword.addEventListener("click", () => setAuthMode("reset"));
  els.resendConfirmation.addEventListener("click", handleResendConfirmation);
  els.backToSignIn.addEventListener("click", () => setAuthMode("signin"));
  els.signOut.addEventListener("click", handleSignOut);

  $("#newChatBtn").onclick = newChat;
  $("#openSidebar").onclick = () => {
    els.sidebar.classList.add("open");
    els.overlay.classList.remove("hidden");
  };
  $("#closeSidebar").onclick = closeMobile;
  els.overlay.onclick = closeMobile;
  $("#searchChats").oninput = renderChatList;

  els.brand.onclick = () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    save({ sync: false });
    applySidebarCollapsed();
  };

  els.composer.addEventListener("input", autosize);
  els.composer.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  els.send.onclick = () => sendMessage();
  els.stop.onclick = () => controller?.abort();

  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.onclick = () => sendMessage(button.dataset.prompt);
  });

  $("#attachBtn").onclick = () => els.file.click();
  els.file.onchange = handleFileSelected;

  $("#voiceBtn").onclick = () => {
    startListening({
      onText: text => {
        els.composer.value = text;
        autosize();
      },
      onError: message => alert(message)
    });
  };

  $("#toolBtn").onclick = () => els.toolPopover.classList.toggle("hidden");
  els.toolPopover.querySelectorAll("[data-tool]").forEach(button => {
    button.onclick = async () => {
      const tool = button.dataset.tool;
      let input = "";
      if (tool === "calculator") input = prompt("Expression, e.g. (25*4)+10") || "";
      try {
        const result = await runTool(tool, input);
        const message = tool === "calculator"
          ? `The calculator returned ${result.result}. Please provide this result to me naturally.`
          : `The current local server time is ${result.result} (${result.timezone}). Please provide this result to me naturally.`;
        await sendMessage(message);
      } catch (error) {
        alert(error.message);
      }
      els.toolPopover.classList.add("hidden");
    };
  });

  $("#modelBtn").onclick = () => els.modelMenu.classList.toggle("hidden");
  els.modelMenu.querySelectorAll("[data-model]").forEach(button => {
    button.onclick = () => {
      state.settings.model = button.dataset.model;
      save();
      renderAll();
      els.modelMenu.classList.add("hidden");
    };
  });

  $("#themeBtn").onclick = () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    save({ sync: false });
    applyTheme();
  };

  $("#settingsBtn").onclick = openSettings;
  $("#settingsTopBtn").onclick = openSettings;
  $("#closeSettings").onclick = () => els.settings.close();
  $("#saveSettings").onclick = () => {
    state.settings.theme = $("#appearanceSelect").value;
    state.settings.voice = $("#voiceSelect").value;
    state.settings.context = $("#systemContext").value.trim();
    save();
    applyTheme();
    els.settings.close();
    renderAll();
  };

  $("#exportBtn").onclick = exportCurrentChat;
  els.artifactClose.onclick = closeArtifactPanel;
  els.artifactDownload.onclick = () => {
    if (activeArtifact) downloadArtifact(activeArtifact);
  };
  els.artifactCopy.onclick = async () => {
    if (!activeArtifact) return;
    await navigator.clipboard?.writeText(activeArtifact.code);
    els.artifactCopy.title = "Copied";
    setTimeout(() => els.artifactCopy.title = "Copy code", 900);
  };
  els.artifactPreviewTab.onclick = () => {
    artifactView = "preview";
    renderArtifactPanel();
  };
  els.artifactCodeTab.onclick = () => {
    artifactView = "code";
    renderArtifactPanel();
  };

  document.addEventListener("click", event => {
    if (!event.target.closest(".model-picker")) els.modelMenu.classList.add("hidden");
    if (!event.target.closest("#toolBtn") && !event.target.closest("#toolPopover")) {
      els.toolPopover.classList.add("hidden");
    }
  });

  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      newChat();
    }
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
}

async function handleFileSelected() {
  const file = els.file.files[0];
  if (!file) return;

  els.attachment.classList.remove("hidden");
  els.attachment.innerHTML = `
    <div class="attachment-row">
      <div><strong>Processing...</strong><small>${escapeHtml(file.name)}</small></div>
      <button onclick="removeAttachment()" title="Remove file" aria-label="Remove file">${icon("x")}</button>
    </div>
  `;

  try {
    attachedContext = await uploadFile(file);
    const label = attachedContext.type === "image"
      ? "Image ready"
      : attachedContext.type === "document"
        ? "Document ready"
        : "File ready";
    const preview = attachedContext.type === "image" && attachedContext.base64
      ? `<img src="data:${attachedContext.mimeType};base64,${attachedContext.base64}" alt="">`
      : `<div class="file-chip">${icon(attachedContext.type === "document" ? "fileText" : "file")}</div>`;

    els.attachment.innerHTML = `
      <div class="attachment-row">
        <div class="attachment-main">
          ${preview}
          <div><strong>${label}</strong><small>${escapeHtml(attachedContext.name)} - ${attachedContext.analysis}</small></div>
        </div>
        <button onclick="removeAttachment()" title="Remove file" aria-label="Remove file">${icon("x")}</button>
      </div>
    `;
    autosize();
  } catch (error) {
    els.attachment.innerHTML = `
      <div class="attachment-row error">
        <div><strong>Upload failed</strong><small>${escapeHtml(error.message)}</small></div>
        <button onclick="removeAttachment()" title="Remove" aria-label="Remove file">${icon("x")}</button>
      </div>
    `;
  }
}

function exportCurrentChat() {
  const chat = current();
  const markdown = `# ${chat.title}\n\n` + chat.messages
    .map(message => `## ${message.role === "user" ? "You" : "Assistant"}\n\n${message.content}`)
    .join("\n\n");
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${chat.title.replace(/[^\w]+/g, "-").toLowerCase() || "conversation"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

async function bootstrap() {
  hydrateIcons();
  bindEvents();
  setAuthMode("signin", "Checking session...");
  const recoveryFromUrl = isPasswordRecoveryUrl();
  recoveryModeActive = recoveryFromUrl;

  if (!availableModels.some(model => model.id === state.settings.model)) {
    state.settings.model = "gemini-3.8-flash";
    saveState(state);
  }

  try {
    const auth = await initAuth();
    authReady = isAuthConfigured();
    databaseReady = isDatabaseConfigured();
    currentUser = auth.user;

    onAuthChange(async (event, session) => {
      currentUser = session?.user || null;
      if (event === "PASSWORD_RECOVERY") {
        recoveryModeActive = true;
        setAuthMode("update", "Enter a new password for your account.");
        showAuth();
        return;
      }

      if (recoveryModeActive && currentUser) {
        setAuthMode("update", "Enter a new password for your account.");
        showAuth();
        return;
      }

      if (currentUser) {
        await enterApp();
      } else if (authReady) {
        state = loadState(null);
        setAuthMode("signin");
        showAuth();
      }
    });

    if (authReady && recoveryFromUrl) {
      if (currentUser) {
        setAuthMode("update", "Enter a new password for your account.");
      } else {
        setAuthMode("reset", "Recovery link expired. Send a new reset link.", "error");
      }
      showAuth();
      return;
    }

    if (authReady && !currentUser) {
      setAuthMode("signin");
      showAuth();
      return;
    }
  } catch (error) {
    console.warn("Auth unavailable:", error.message);
    authReady = false;
    databaseReady = false;
  }

  if (!authReady) {
    setAuthMode("signin", "Supabase is not configured. Add .env values and restart the server.", "error");
    showAuth();
    return;
  }

  await enterApp();
  checkHealth().then(data => console.log("API:", data)).catch(() => {});
}

bootstrap();
