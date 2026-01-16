import { StrictMode, useEffect, useState } from "react";
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
  const [auth, setAuth] = useState<AuthState>(() =>
    safeParse<AuthState>(localStorage.getItem(AUTH_KEY), null)
  );

  useEffect(() => {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  }, [auth]);

  const handleLogin = (data: { email: string; name: string }) => {
    setAuth({
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
    });
  };

  const handleLogout = () => setAuth(null);

  return (
    <StrictMode>
      {!auth ? (
        <Login onLogin={handleLogin} />
      ) : (
        <App forcedLoginEmail={auth.email} forcedName={auth.name} onLogout={handleLogout} />
      )}
    </StrictMode>
  );
}
