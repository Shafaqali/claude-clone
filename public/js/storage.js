const KEY = "personal-agent-state-v1";

const defaultState = () => ({
  chats: [{
    id: crypto.randomUUID(),
    title: "New conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  }],
  activeChatId: null,
  settings: {
    theme: "system",
    voice: "off",
    context: "",
    model: "gemini-2.5-flash"
  }
});

export function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed?.chats?.length) return parsed;
  } catch {}
  const state = defaultState();
  state.activeChatId = state.chats[0].id;
  saveState(state);
  return state;
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function activeChat(state) {
  return state.chats.find(c => c.id === state.activeChatId) || state.chats[0];
}