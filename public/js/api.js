export async function checkHealth() {
  const response = await fetch("/api/health");
  return response.json();
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/upload", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed");
  return data;
}

export async function streamChat(messages, context, signal, onToken) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ messages, context }),
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