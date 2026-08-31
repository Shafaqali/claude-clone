export async function checkHealth() {
  const response = await fetch("/api/health");
  return response.json();
}

export async function getModels() {
  const response = await fetch("/api/models");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load models");
  return data;
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed");
  return data;
}

export async function streamChat(messages, context, signal, onToken, images = [], model) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ messages, context, images, model }),
    signal
  });

  if (!response.ok) {
    let error = "Request failed";
    try { error = (await response.json()).error || error; } catch {}
    throw new Error(error);
  }

  if (!response.body) throw new Error("Streaming is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onToken?.(chunk, full);
  }
  return full;
}

export async function createFile(filename, content, type = "text") {
  const response = await fetch("/api/create-file", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ filename, content, type })
  });
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "File creation failed");
  return data;
}
