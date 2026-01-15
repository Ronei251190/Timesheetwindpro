// src/Root.tsx
import React, { useEffect, useState } from "react";
import App from "./App";
import Login from "./auth/Login";
import { clearSession, getSession } from "./auth/auth";

export default function Root() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const s = getSession();
    setLoggedIn(!!s);
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <div>
      {/* mic top bar pt logout (optional) */}
      <div style={{ padding: 10, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => {
            clearSession();
            setLoggedIn(false);
          }}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Logout
        </button>
      </div>

      <App />
    </div>
  );
}
