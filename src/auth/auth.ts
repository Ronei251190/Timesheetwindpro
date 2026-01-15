// src/auth/auth.ts
const LS_SESSION = "windpro_session_v1";

export type SessionUser = {
  email: string;
  name?: string;
  loginAt: number;
};

export function getSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setSession(user: SessionUser) {
  localStorage.setItem(LS_SESSION, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(LS_SESSION);
}
