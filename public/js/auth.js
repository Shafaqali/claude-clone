import { getAppConfig } from "./api.js";

let supabase = null;
let createSupabaseClient = null;
let supabaseConfig = {
  configured: false,
  databaseConfigured: false,
  url: "",
  publishableKey: ""
};

function authRedirectTo() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function loadSupabaseClientFactory() {
  if (!createSupabaseClient) {
    const module = await import("https://esm.sh/@supabase/supabase-js@2");
    createSupabaseClient = module.createClient;
  }
  return createSupabaseClient;
}

export async function initAuth() {
  const config = await getAppConfig();
  supabaseConfig = config.supabase || supabaseConfig;

  if (!supabaseConfig.configured) {
    return { configured: false, databaseConfigured: false, session: null, user: null };
  }

  const createClient = await loadSupabaseClientFactory();
  supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  return {
    configured: true,
    databaseConfigured: Boolean(supabaseConfig.databaseConfigured),
    session: data.session,
    user: data.session?.user || null
  };
}

export function isAuthConfigured() {
  return Boolean(supabaseConfig.configured && supabase);
}

export function isDatabaseConfigured() {
  return Boolean(supabaseConfig.databaseConfigured);
}

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export function onAuthChange(callback) {
  if (!supabase) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data.subscription;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectTo()
    }
  });
  if (error) throw error;
  return data;
}

export async function resendConfirmation(email) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: authRedirectTo()
    }
  });
  if (error) throw error;
  return data;
}

export async function sendPasswordReset(email) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectTo()
  });
  if (error) throw error;
  return data;
}

export async function updatePassword(password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function authHeaders() {
  const session = await getSession();
  if (!session?.access_token) throw new Error("Please sign in again.");
  return {
    Authorization: `Bearer ${session.access_token}`
  };
}
