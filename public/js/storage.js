const BASE_KEY = "personal-agent-state-v1";
let activeKey = BASE_KEY;

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
    model: "gemini-3.8-flash"
  }
});

function keyForUser(userId) {
  return userId ? `${BASE_KEY}:user:${userId}` : BASE_KEY;
}

function normalizeState(parsed) {
  const defaults = defaultState();
  const state = {
    ...defaults,
    ...parsed,
    settings: {
      ...defaults.settings,
      ...(parsed.settings || {})
    }
  };

  if (!state.activeChatId || !state.chats.some(chat => chat.id === state.activeChatId)) {
    state.activeChatId = state.chats[0].id;
  }

  return state;
}

export function setStateScope(userId = null) {
  activeKey = keyForUser(userId);
}

export function loadState(userId) {
  if (userId !== undefined) setStateScope(userId);

  try {
    const parsed = JSON.parse(localStorage.getItem(activeKey));
    if (parsed?.chats?.length) {
      return normalizeState(parsed);
    }
  } catch {}

  const state = defaultState();
  state.activeChatId = state.chats[0].id;
  saveState(state);
  return state;
}

export function saveState(state) {
  localStorage.setItem(activeKey, JSON.stringify(state));
}

export function activeChat(state) {
  return state.chats.find(c => c.id === state.activeChatId) || state.chats[0];
}
