import { loadState, saveState, activeChat } from "./storage.js";
import { renderMarkdown, plainText } from "./markdown.js";
import { streamChat, uploadFile, checkHealth } from "./api.js";
import { startListening, speak } from "./voice.js";
import { runTool } from "./tools.js";

const $ = s => document.querySelector(s);
const state = loadState();
if (!state.activeChatId) state.activeChatId = state.chats[0].id;

let controller = null;
let attachedContext = null;

const els = {
  sidebar: $("#sidebar"), overlay: $("#overlay"), chatList: $("#chatList"),
  messages: $("#messages"), welcome: $("#welcome"), composer: $("#composer"),
  send: $("#sendBtn"), stop: $("#stopBtn"), attachment: $("#attachmentPreview"),
  file: $("#fileInput"), settings: $("#settingsDialog"), modelMenu: $("#modelMenu"),
  modelName: $("#modelName"), toolPopover: $("#toolPopover")
};

function current() { return activeChat(state); }

function save() {
  state.chats.forEach(c => c.updatedAt = c.id === state.activeChatId ? Date.now() : c.updatedAt);
  saveState(state);
}

function removeAttachment() {
  attachedContext = null;
  els.attachment.classList.add("hidden");
  els.attachment.innerHTML = "";
  els.file.value = ""; // Clear the file input
  
  // Show a brief notification
  const notification = document.createElement('div');
  notification.textContent = 'File removed';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text);
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 200);
  }, 1500);
}

// Make removeAttachment available globally
window.removeAttachment = removeAttachment;

// Test function for debugging image uploads
window.testImageUpload = async function(file) {
  try {
    console.log('Testing image upload:', file.name);
    const result = await uploadFile(file);
    console.log('Upload result:', result);
    
    if (result.type === 'image' && result.base64) {
      console.log('Testing Gemini image analysis...');
      const response = await fetch('/api/test-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: result.base64,
          mimeType: result.mimeType
        })
      });
      
      const testResult = await response.json();
      console.log('Gemini test result:', testResult);
      return testResult;
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
};

function applyTheme() {
  const theme = state.settings.theme || "system";
  document.documentElement.dataset.theme = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
}

function renderChatList() {
  const query = $("#searchChats").value.toLowerCase();
  els.chatList.innerHTML = "";
  state.chats
    .filter(c => c.title.toLowerCase().includes(query))
    .sort((a,b) => b.updatedAt - a.updatedAt)
    .forEach(chat => {
      const row = document.createElement("div");
      row.className = `chat-item ${chat.id === state.activeChatId ? "active" : ""}`;
      row.innerHTML = `<span>◦</span><span class="title"></span><button class="chat-delete" title="Delete">×</button>`;
      row.querySelector(".title").textContent = chat.title;
      row.addEventListener("click", e => {
        if (e.target.closest(".chat-delete")) return;
        state.activeChatId = chat.id; save(); renderAll(); closeMobile();
      });
      row.querySelector(".chat-delete").addEventListener("click", e => {
        e.stopPropagation();
        if (state.chats.length === 1) return;
        state.chats = state.chats.filter(c => c.id !== chat.id);
        if (state.activeChatId === chat.id) state.activeChatId = state.chats[0].id;
        save(); renderAll();
      });
      els.chatList.appendChild(row);
    });
}

function renderMessages() {
  const chat = current();
  els.messages.innerHTML = "";
  els.welcome.classList.toggle("hidden", chat.messages.length > 0);

  chat.messages.forEach((message, index) => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble message-content";
    bubble.innerHTML = message.role === "assistant"
      ? renderMarkdown(message.content)
      : `<p>${escapeHtml(message.content).replace(/\n/g,"<br>")}</p>`;

    if (message.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.innerHTML = `<button data-copy>Copy</button>${state.settings.voice === "on" ? "<button data-speak>Read aloud</button>" : ""}`;
      actions.querySelector("[data-copy]").onclick = () => navigator.clipboard?.writeText(message.content);
      actions.querySelector("[data-speak]")?.addEventListener("click", () => speak(message.content));
      bubble.appendChild(actions);
    }

    bubble.querySelectorAll("[data-copy-code]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await navigator.clipboard?.writeText(decodeURIComponent(btn.dataset.copyCode));
        btn.textContent = "Copied";
        setTimeout(() => btn.textContent = "Copy", 1000);
      });
    });

    if (message.role === "assistant") {
      article.innerHTML = `<div class="message-avatar">A</div>`;
      article.appendChild(bubble);
    } else {
      article.appendChild(bubble);
    }
    els.messages.appendChild(article);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function renderAll() {
  renderChatList();
  renderMessages();
  els.modelName.textContent = state.settings.model.includes("pro") ? "Gemini Pro" : "Gemini Flash";
  applyTheme();
  autosize();
}

function newChat() {
  const chat = { id: crypto.randomUUID(), title: "New conversation", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  attachedContext = null;
  els.attachment.classList.add("hidden");
  save(); renderAll(); els.composer.focus(); closeMobile();
}

function autosize() {
  els.composer.style.height = "auto";
  els.composer.style.height = Math.min(els.composer.scrollHeight, 180) + "px";
  els.send.disabled = !els.composer.value.trim() || Boolean(controller);
}

async function sendMessage(text = els.composer.value.trim()) {
  if (!text || controller) return;

  const chat = current();
  const userMessage = { role: "user", content: text };
  chat.messages.push(userMessage);

  if (chat.title === "New conversation") {
    chat.title = text.replace(/\s+/g, " ").slice(0, 42) || "New conversation";
  }

  els.composer.value = "";
  attachedContext = null;
  els.attachment.classList.add("hidden");
  save(); renderAll();

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
    attachedContext?.content ? `Attached file: ${attachedContext.name}\n${attachedContext.content}` : ""
  ].filter(Boolean).join("\n\n");

  // Prepare images array if we have an image attachment
  const images = [];
  if (attachedContext?.type === "image") {
    console.log('Adding image to chat:', {
      hasBase64: Boolean(attachedContext.base64),
      mimeType: attachedContext.mimeType,
      base64Length: attachedContext.base64?.length
    });
    images.push({
      base64: attachedContext.base64,
      mimeType: attachedContext.mimeType
    });
  }
  console.log('Sending chat with images:', images.length);

  try {
    await streamChat(chat.messages.slice(0, -1), context, controller.signal, (_, full) => {
      assistant.content = full;
      bubble.innerHTML = renderMarkdown(full) || `<div class="typing"><i></i><i></i><i></i></div>`;
      els.messages.scrollTop = els.messages.scrollHeight;
    }, images);
    save();
    renderMessages();
    if (state.settings.voice === "on") speak(assistant.content);
  } catch (error) {
    if (error.name === "AbortError") {
      assistant.content += assistant.content ? "\n\n_Generation stopped._" : "_Generation stopped._";
    } else {
      assistant.content = `**Error:** ${error.message}`;
    }
    save(); renderMessages();
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
    $("#apiStatus").textContent = data.configured
      ? `Connected · ${data.model}`
      : "Gemini API key not configured. Add it to .env.";
  }).catch(() => $("#apiStatus").textContent = "Server unavailable.");
}

function closeMobile() {
  els.sidebar.classList.remove("open");
  els.overlay.classList.add("hidden");
}

$("#newChatBtn").onclick = newChat;
$("#openSidebar").onclick = () => { els.sidebar.classList.add("open"); els.overlay.classList.remove("hidden"); };
$("#closeSidebar").onclick = closeMobile;
els.overlay.onclick = closeMobile;
$("#searchChats").oninput = renderChatList;

$("#composer").addEventListener("input", autosize);
$("#composer").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); sendMessage();
  }
});
$("#sendBtn").onclick = () => sendMessage();
$("#stopBtn").onclick = () => controller?.abort();

document.querySelectorAll("[data-prompt]").forEach(btn => {
  btn.onclick = () => sendMessage(btn.dataset.prompt);
});

$("#attachBtn").onclick = () => els.file.click();
els.file.onchange = async () => {
  const file = els.file.files[0];
  if (!file) return;
  
  els.attachment.classList.remove("hidden");
  els.attachment.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; margin: 8px 0;">
      <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
        <div style="width: 32px; height: 32px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
          📄
        </div>
        <div>
          <div style="font-weight: 600; font-size: 13px;">Processing...</div>
          <div style="font-size: 11px; color: var(--muted);">${file.name}</div>
        </div>
      </div>
      <button onclick="removeAttachment()" style="background: none; border: none; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px; border-radius: 4px;" title="Remove file">×</button>
    </div>
  `;
  
  try {
    attachedContext = await uploadFile(file);
    console.log('Uploaded file:', attachedContext); // Debug log
    console.log('File type detected:', attachedContext.type);
    console.log('Has base64:', Boolean(attachedContext.base64));
    
    // Handle different file types with better UI
    if (attachedContext.type === "image") {
      // Show image preview with remove button
      els.attachment.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; margin: 8px 0;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <img src="data:${attachedContext.mimeType};base64,${attachedContext.base64}" 
                 style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
            <div>
              <div style="font-weight: 600; font-size: 13px; color: var(--text);">📷 Image attached</div>
              <div style="font-size: 11px; color: var(--muted);">${escapeHtml(attachedContext.name)} • ${attachedContext.analysis}</div>
            </div>
          </div>
          <button onclick="removeAttachment()" style="background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1;" title="Remove image">×</button>
        </div>
      `;
      if (!els.composer.value.trim()) {
        els.composer.value = `Please analyze this image: ${attachedContext.name}`;
      }
    } else if (attachedContext.type === "text") {
      // Show text file info with remove button
      els.attachment.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; margin: 8px 0;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <div style="width: 32px; height: 32px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
              📄
            </div>
            <div>
              <div style="font-weight: 600; font-size: 13px; color: var(--text);">📝 ${escapeHtml(attachedContext.name)}</div>
              <div style="font-size: 11px; color: var(--muted);">${(attachedContext.size/1024).toFixed(1)} KB • ${attachedContext.analysis}</div>
            </div>
          </div>
          <button onclick="removeAttachment()" style="background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1;" title="Remove file">×</button>
        </div>
      `;
      if (!els.composer.value.trim()) {
        els.composer.value = `Please analyze the attached file: ${attachedContext.name}`;
      }
    } else if (attachedContext.type === "document") {
      // Show document info with remove button
      els.attachment.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; margin: 8px 0;">
          <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <div style="width: 32px; height: 32px; background: var(--accent); border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
              📋
            </div>
            <div>
              <div style="font-weight: 600; font-size: 13px; color: var(--text);">📋 ${escapeHtml(attachedContext.name)}</div>
              <div style="font-size: 11px; color: var(--muted);">${(attachedContext.size/1024).toFixed(1)} KB • ${attachedContext.analysis}</div>
            </div>
          </div>
          <button onclick="removeAttachment()" style="background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1;" title="Remove document">×</button>
        </div>
      `;
      if (!els.composer.value.trim()) {
        els.composer.value = `I've uploaded a document: ${attachedContext.name}. Please help me with it.`;
      }
    }
    
    autosize();
  } catch (error) {
    console.error('Upload error:', error); // Debug log
    els.attachment.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--surface-2); border-radius: 8px; margin: 8px 0; border-left: 3px solid #ef4444;">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <div style="width: 32px; height: 32px; background: #ef4444; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
            ⚠️
          </div>
          <div>
            <div style="font-weight: 600; font-size: 13px; color: #ef4444;">Upload failed</div>
            <div style="font-size: 11px; color: var(--muted);">${error.message}</div>
          </div>
        </div>
        <button onclick="removeAttachment()" style="background: none; border: none; color: var(--muted); font-size: 18px; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1;" title="Remove">×</button>
      </div>
    `;
  }
};

$("#voiceBtn").onclick = () => {
  startListening({
    onText: text => {
      els.composer.value = text;
      autosize();
    },
    onError: msg => alert(msg)
  });
};

$("#toolBtn").onclick = () => els.toolPopover.classList.toggle("hidden");
els.toolPopover.querySelectorAll("[data-tool]").forEach(btn => {
  btn.onclick = async () => {
    const tool = btn.dataset.tool;
    let input = "";
    if (tool === "calculator") input = prompt("Expression, e.g. (25*4)+10") || "";
    try {
      const result = await runTool(tool, input);
      els.composer.value = tool === "calculator" ? `Calculate ${input}` : "What time is it?";
      await sendMessage(`${tool === "calculator" ? `The calculator returned ${result.result}.` : `The current local server time is ${result.result} (${result.timezone}).`} Please provide this result to me naturally.`);
    } catch (e) { alert(e.message); }
    els.toolPopover.classList.add("hidden");
  };
});

$("#modelBtn").onclick = () => els.modelMenu.classList.toggle("hidden");
els.modelMenu.querySelectorAll("[data-model]").forEach(btn => {
  btn.onclick = () => {
    state.settings.model = btn.dataset.model;
    // Model selection is persisted; server uses GEMINI_MODEL for actual requests.
    save(); renderAll(); els.modelMenu.classList.add("hidden");
  };
});

$("#themeBtn").onclick = () => {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  save(); applyTheme();
};

$("#settingsBtn").onclick = openSettings;
$("#settingsTopBtn").onclick = openSettings;
$("#closeSettings").onclick = () => els.settings.close();
$("#saveSettings").onclick = () => {
  state.settings.theme = $("#appearanceSelect").value;
  state.settings.voice = $("#voiceSelect").value;
  state.settings.context = $("#systemContext").value.trim();
  save(); applyTheme(); els.settings.close(); renderAll();
};

$("#exportBtn").onclick = () => {
  const chat = current();
  const md = `# ${chat.title}\n\n` + chat.messages.map(m => `## ${m.role === "user" ? "You" : "Assistant"}\n\n${m.content}`).join("\n\n");
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${chat.title.replace(/[^\w]+/g,"-").toLowerCase() || "conversation"}.md`; a.click();
  URL.revokeObjectURL(url);
};

document.addEventListener("click", e => {
  if (!e.target.closest(".model-picker")) els.modelMenu.classList.add("hidden");
  if (!e.target.closest("#toolBtn") && !e.target.closest("#toolPopover")) els.toolPopover.classList.add("hidden");
});

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault(); newChat();
  }
});

matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
renderAll();
checkHealth().then(data => console.log("API:", data)).catch(() => {});
