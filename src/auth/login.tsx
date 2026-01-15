import React, { useMemo, useState } from "react";

export default function Login({
  onLogin,
}: {
  onLogin: (data: { email: string; name: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");

  // DOAR DEMO local (mâine facem lista de useri + parole generate)
  const DEMO_PASSWORD = "1234";

  const validEmail = useMemo(() => email.trim().includes("@"), [email]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail) return alert("Email invalid.");
    if (!name.trim()) return alert("Completează numele.");
    if (pass !== DEMO_PASSWORD) return alert("Parolă greșită (demo: 1234).");
    onLogin({ email: email.trim().toLowerCase(), name: name.trim() });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background:
          "radial-gradient(circle at 20% 20%, rgba(31,94,255,0.20), transparent 40%), radial-gradient(circle at 80% 30%, rgba(0,0,0,0.12), transparent 45%), linear-gradient(180deg, #0b1220, #0b1220)",
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          background: "rgba(255,255,255,0.94)",
          borderRadius: 18,
          padding: 22,
          border: "1px solid rgba(255,255,255,0.6)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#1f5eff",
              display: "grid",
              placeItems: "center",
              color: "white",
              fontWeight: 900,
              fontSize: 18,
            }}
          >
            WP
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>WindPro Timesheet MCE</div>
            <div style={{ opacity: 0.75 }}>Login cu email de companie</div>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label>
            <div style={{ fontWeight: 800, marginBottom: 6, opacity: 0.8 }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ex: borot@windpro.pl"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "2px solid #111",
                fontSize: 16,
              }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 800, marginBottom: 6, opacity: 0.8 }}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Bogdan Rotariu"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                fontSize: 16,
              }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 800, marginBottom: 6, opacity: 0.8 }}>Password</div>
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="demo: 1234"
              type="password"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                fontSize: 16,
              }}
            />
          </label>

          <button
            type="submit"
            style={{
              marginTop: 6,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #1f5eff",
              background: "#1f5eff",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            Login
          </button>

          <div style={{ fontSize: 13, opacity: 0.75 }}>
            *Acum e demo cu parola 1234. Mâine facem lista de utilizatori + parole diferite generate.
          </div>
        </form>
      </div>
    </div>
  );
}
