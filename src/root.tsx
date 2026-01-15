import React, { useEffect, useState } from "react";
import App from "./App";
import Login from "./auth/login";

const AUTH_KEY = "windpro_auth_v1";

type AuthState = { email: string; name: string } | null;

function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function Root() {
  // 1) La pornire, citim userul salvat din localStorage
  const [auth, setAuth] = useState<AuthState>(() =>
    safeParse<AuthState>(localStorage.getItem(AUTH_KEY), null)
  );

  // 2) Ori de cate ori se schimba auth, salvam in localStorage
  useEffect(() => {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  }, [auth]);

  // 3) Login: seteaza userul si il salveaza automat (prin useEffect)
  const handleLogin = (data: { email: string; name: string }) => {
    setAuth({
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
    });
  };

  // 4) Logout: sterge userul salvat
  const handleLogout = () => setAuth(null);

  // Daca nu e logat -> Login
  if (!auth) return <Login onLogin={handleLogin} />;

  // Daca e logat -> App
  return (
    <App
      forcedLoginEmail={auth.email}
      forcedName={auth.name}
      onLogout={handleLogout}
    />
  );
}
