export async function runTool(name, input = "") {
  const response = await fetch("/api/tool", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, input })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Tool failed");
  return data;
}

export async function createFileFromChat(filename, content) {
  try {
    const response = await fetch("/api/create-file", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ filename, content })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    
    // Show success notification
    showNotification(`File '${filename}' created successfully!`, 'success');
    return data;
  } catch (error) {
    showNotification(`Failed to create file: ${error.message}`, 'error');
    throw error;
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
  `;
  
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 4000);
}