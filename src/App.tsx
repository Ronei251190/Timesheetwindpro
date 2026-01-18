import React, { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, endOfMonth, format, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import windproLogo from "./assets/windpro-logo.png";
import { USERS } from "./auth/users.local";

/** ===================== TYPES ===================== */
type WorkType =
  | "Offshore (Harbour / CTV) DAY SHIFT"
  | "Offshore (Harbour / CTV) NIGHT SHIFT"
  | "Offshore Day Shift (SOV)"
  | "Offshore Night Shift (SOV)"
  | "Offshore Standby (SOV)"
  | "Port / Harbour"
  | "Standby / On call at home"
  | "Mob / Demob rate"
  | "Overtime"
  | "Travel (8h x 22€ = 176€) one way"
  | "Car allowance"
  | "OFF / Rest"
  | "Bank holiday"
  | "Onshore Installation Supervisor"
  | "Site Manager"
  | "Service"
  | "Driving to site from home"
  | "Driving from site to home";

type ExpenseType = "Taxi" | "Hotel" | "Food" | "Diesel" | "Extra luggage" | "PPE" | "Other";
type PlatformType = "SOV" | "Jack-up" | "CTV / Harbour" | "N/A";

type Expense = {
  id: string;
  type: ExpenseType;
  amount: number;
  note: string;
  fileName?: string;
  fileDataUrl?: string; // local only
};

type DayEntry = {
  dateISO: string;
  workType: WorkType;
  hours: number;
  ratePerHour: number;
  location: string;
  serviceWorker: string;
  platformType: PlatformType;
  vesselPreset: string;
  vesselManual: string;
  workNote: string;
  expenses: Expense[];
};

type StoredUser = {
  name: string;
  defaultRatePerHour: number;
  entries: Record<string, DayEntry>;
  signatureByPeriod: Record<string, string | null>;
};

type SubmitStatus = "submitted" | "email_sent" | "failed";

type SubmitLog = {
  id: string;
  userEmail: string;
  userName: string;
  periodId: string; // YYYY-MM
  periodStartISO: string;
  periodEndISO: string;
  submittedAtISO: string; // new Date().toISOString()
  daysCount: number;
  totalHours: number;
  totalPay: number;
  totalExpenses: number;
  status: SubmitStatus;
  note?: string; // error details
};

type AppState = {
  // user login
  isUserLoggedIn: boolean;
  loginEmail: string;
  loginPass: string;

  // admin login
  isAdminLoggedIn: boolean;

  // period
  selectedPeriodId: string;
  selectedDateISO: string;

  // lock
  lockedPeriodIds: string[];

  // multi-select
  multiMode: boolean;
  multiSelectedISOs: string[];

  // users
  users: Record<string, StoredUser>;

  // audit
  submitLogs: SubmitLog[];
};

type Period = {
  id: string; // YYYY-MM
  label: string;
  startISO: string;
  endISO: string;
  invoiceDateISO: string;
};

/** ===================== ENV (ADMIN) ===================== */
const ADMIN_USER = (import.meta as any).env?.VITE_ADMIN_USER || "ADMIN";
const ADMIN_PASS = (import.meta as any).env?.VITE_ADMIN_PASS || ""; // must be set in Vercel env
const ADMIN_EMAILS_ENV = (import.meta as any).env?.VITE_ADMIN_EMAILS || "timesheet@windpro.pl";
const ADMIN_EMAILS = ADMIN_EMAILS_ENV.split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean);

/** ===================== CONSTS ===================== */
const LS_KEY = "windpro_timesheet_mce_with_admin_portal_v1";


const WORK_TYPES: WorkType[] = [
  "Offshore (Harbour / CTV) DAY SHIFT",
  "Offshore (Harbour / CTV) NIGHT SHIFT",
  "Offshore Day Shift (SOV)",
  "Offshore Night Shift (SOV)",
  "Offshore Standby (SOV)",
  "Port / Harbour",
  "Standby / On call at home",
  "Mob / Demob rate",
  "Overtime",
  "Travel (8h x 22€ = 176€) one way",
  "Car allowance",
  "OFF / Rest",
  "Bank holiday",
  "Onshore Installation Supervisor",
  "Site Manager",
  "Service",
  "Driving to site from home",
  "Driving from site to home",
];

const EXP_TYPES: ExpenseType[] = ["Taxi", "Hotel", "Food", "Diesel", "Extra luggage", "PPE", "Other"];
const PLATFORM_TYPES: PlatformType[] = ["SOV", "Jack-up", "CTV / Harbour", "N/A"];
const VESSEL_PRESETS = ["Blue Tern", "Discovery Wind", "Apollo Wind", "Nobelwind", "Aeolus", "SOV (Other)", "Jack-up (Other)"];

/** ===================== HELPERS ===================== */
const uid = (prefix = "id") => `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
const trim1 = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const normalizeEmail = (e: string) => trim1(e).toLowerCase();
const clampNum = (n: any, fallback = 0) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const todayISO = () => format(new Date(), "yyyy-MM-dd");
const inRangeISO = (dateISO: string, startISO: string, endISO: string) => dateISO >= startISO && dateISO <= endISO;

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function makeDefaultUser(): StoredUser {
  return { name: "", defaultRatePerHour: 0, entries: {}, signatureByPeriod: {} };
}

function makeDefaultEntry(dateISO: string, defaultRate: number): DayEntry {
  return {
    dateISO,
    workType: "Offshore Night Shift (SOV)",
    hours: 0,
    ratePerHour: clampNum(defaultRate, 0),
    location: "",
    serviceWorker: "",
    platformType: "SOV",
    vesselPreset: "Blue Tern",
    vesselManual: "Blue Tern",
    workNote: "",
    expenses: [],
  };
}

function generateMonthlyPeriods(fromYear = 2025, toYear = 2050): Period[] {
  const start = new Date(fromYear, 0, 1);
  const end = new Date(toYear, 11, 1);
  const out: Period[] = [];
  let cur = startOfMonth(start);

  while (cur <= end) {
    const s = startOfMonth(cur);
    const e = endOfMonth(cur);
    const id = format(cur, "yyyy-MM");
    out.push({
      id,
      label: `${format(cur, "yyyy")} - ${format(cur, "MMMM")}`,
      startISO: format(s, "yyyy-MM-dd"),
      endISO: format(e, "yyyy-MM-dd"),
      invoiceDateISO: format(e, "yyyy-MM-dd"),
    });
    cur = addMonths(cur, 1);
  }
  return out;
}

/** ===================== STORAGE ===================== */
const DEFAULT_STATE: AppState = {
  isUserLoggedIn: false,
  loginEmail: "",
  loginPass: "",

  isAdminLoggedIn: false,

  selectedPeriodId: format(new Date(), "yyyy-MM"),
  selectedDateISO: todayISO(),

  lockedPeriodIds: [],

  multiMode: false,
  multiSelectedISOs: [],

  users: {},
  submitLogs: [],
};

function loadState(): AppState {
  try {
    const raw = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);
    return {
      ...DEFAULT_STATE,
      ...raw,
      users: raw?.users || {},
      lockedPeriodIds: raw?.lockedPeriodIds || [],
      multiSelectedISOs: raw?.multiSelectedISOs || [],
      submitLogs: raw?.submitLogs || [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}
function saveState(s: AppState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

/** ===================== STYLES ===================== */
const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #ddd",
  fontFamily: "inherit",
  fontSize: 16,
};
const strongInput: React.CSSProperties = { ...input, border: "2px solid #111" };
const lbl: React.CSSProperties = { opacity: 0.8, marginBottom: 6 };

const smallBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const btnBlue: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #1f5eff",
  background: "#1f5eff",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGreen: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #178a3a",
  background: "#178a3a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnDark: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const badge = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  background: bg,
  color,
  fontWeight: 900,
  fontSize: 12,
});

/** ===================== PDF STYLES (compact) ===================== */
const pdfTh: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "6px 6px",
  textAlign: "left",
  fontWeight: 800,
  background: "#f5f6f8",
  fontSize: 10,
};
const pdfTd: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "6px 6px",
  verticalAlign: "top",
  fontSize: 10,
};

/** ===================== ERROR BOUNDARY ===================== */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: String(err?.message || err) };
  }
  componentDidCatch(err: any) {
    console.error("App crashed:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 20, fontFamily: "Arial" }}>
        <h2 style={{ marginTop: 0 }}>⚠️ App crashed</h2>
        <div style={{ padding: 12, border: "1px solid #f0bcbc", borderRadius: 12, background: "#fff6f6" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Error:</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{this.state.message}</div>
        </div>
      </div>
    );
  }
}

/** ===================== UI COMPONENTS ===================== */
function Card({ title, big, children }: { title: string; big: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", background: "white", borderRadius: 14, padding: 16 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{big}</div>
      <div style={{ opacity: 0.85 }}>{children}</div>
    </div>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 100%)",
          background: "white",
          borderRadius: 14,
          border: "1px solid #eee",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 14, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button style={smallBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/** ===================== LOGIN VIEW (USER + ADMIN BUTTON) ===================== */
function LoginView({
  email,
  password,
  setEmail,
  setPassword,
  onUserLogin,
  onOpenAdminLogin,
}: {
  email: string;
  password: string;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  onUserLogin: () => void;
  onOpenAdminLogin: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "linear-gradient(135deg, #0b1b3a, #0f3d91)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "rgba(255,255,255,0.95)",
          borderRadius: 18,
          border: "1px solid #e9e9e9",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={windproLogo} alt="WindPro" style={{ width: 90, height: "auto" }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>WindPro TimeSheet</div>
            <div style={{ opacity: 0.75, fontWeight: 700 }}>User Login</div>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button onClick={onOpenAdminLogin} style={smallBtn}>
              Admin portal
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={lbl}>Email</div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={strongInput}
            placeholder="ex: borot@windpro.pl"
            autoComplete="email"
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={lbl}>Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={strongInput}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <button onClick={onUserLogin} style={{ ...btnBlue, width: "100%", marginTop: 14 }}>
          Login
        </button>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>* Datele rămân salvate local în browser (localStorage).</div>
      </div>
    </div>
  );
}

/** ===================== ADMIN LOGIN ===================== */
function AdminLoginView({
  adminUser,
  adminPass,
  setAdminUser,
  setAdminPass,
  onAdminLogin,
  onBack,
  error,
}: {
  adminUser: string;
  adminPass: string;
  setAdminUser: (v: string) => void;
  setAdminPass: (v: string) => void;
  onAdminLogin: () => void;
  onBack: () => void;
  error: string;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "linear-gradient(135deg, #0b1b3a, #0f3d91)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "rgba(255,255,255,0.95)",
          borderRadius: 18,
          border: "1px solid #e9e9e9",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={windproLogo} alt="WindPro" style={{ width: 90, height: "auto" }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>WindPro TimeSheet</div>
            <div style={{ opacity: 0.75, fontWeight: 700 }}>Admin Portal</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <button onClick={onBack} style={smallBtn}>
              ← Back
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={lbl}>Admin Username</div>
          <input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} style={strongInput} placeholder="ADMIN" autoComplete="username" />
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={lbl}>Admin Password</div>
          <input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} style={strongInput} placeholder="••••••••" autoComplete="current-password" />
        </div>

        {error ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #f0bcbc", background: "#fff6f6", color: "#b55", fontWeight: 800 }}>
            {error}
          </div>
        ) : null}

        <button onClick={onAdminLogin} style={{ ...btnDark, width: "100%", marginTop: 14 }}>
          Admin Login
        </button>

        {!ADMIN_PASS ? (
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
            ⚠️ <b>Setează VITE_ADMIN_PASS</b> în Vercel Environment Variables, altfel admin login nu poate fi folosit.
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** ===================== ADMIN DASHBOARD ===================== */
function AdminDashboard({
  state,
  setState,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  const periods = useMemo(() => generateMonthlyPeriods(2025, 2050), []);
  const [periodId, setPeriodId] = useState(state.selectedPeriodId);
  const period = useMemo(() => periods.find((p) => p.id === periodId) || periods[0], [periods, periodId]);

  const logs = useMemo(() => {
    const sorted = [...(state.submitLogs || [])].sort((a, b) => (a.submittedAtISO < b.submittedAtISO ? 1 : -1));
    return sorted;
  }, [state.submitLogs]);

  const logsForPeriod = useMemo(() => logs.filter((l) => l.periodId === periodId), [logs, periodId]);

  const knownUsers = useMemo(() => {
    // “expected users” = cei care au conturi salvate în users (au intrat măcar o dată)
    const entries = Object.entries(state.users || {});
    const out = entries.map(([email, u]) => ({ email, name: trim1(u?.name) || "" }));
    out.sort((a, b) => a.email.localeCompare(b.email));
    return out;
  }, [state.users]);

  const submittedSet = useMemo(() => new Set(logsForPeriod.map((l) => l.userEmail.toLowerCase())), [logsForPeriod]);

  const submitted = useMemo(() => knownUsers.filter((u) => submittedSet.has(u.email.toLowerCase())), [knownUsers, submittedSet]);
  const missing = useMemo(() => knownUsers.filter((u) => !submittedSet.has(u.email.toLowerCase())), [knownUsers, submittedSet]);

  const statusChip = (s: SubmitStatus) => {
    if (s === "email_sent") return <span style={badge("#eaffef", "#178a3a")}>EMAIL SENT</span>;
    if (s === "failed") return <span style={badge("#fff1f1", "#b55")}>FAILED</span>;
    return <span style={badge("#eef3ff", "#1f5eff")}>SUBMITTED</span>;
  };

  const exportCsv = () => {
    const rows = [
      ["submittedAt", "userEmail", "userName", "periodId", "periodStart", "periodEnd", "days", "hours", "pay", "expenses", "status", "note"].join(","),
      ...logs.map((l) =>
        [
          l.submittedAtISO,
          l.userEmail,
          (l.userName || "").replaceAll(",", " "),
          l.periodId,
          l.periodStartISO,
          l.periodEndISO,
          String(l.daysCount),
          String(l.totalHours),
          String(l.totalPay),
          String(l.totalExpenses),
          l.status,
          (l.note || "").replaceAll(",", " ").replaceAll("\n", " "),
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `windpro_submit_logs_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAllLogs = () => {
    const ok = window.confirm("Ștergi toate submit logs? (doar local, în browserul ăsta)");
    if (!ok) return;
    setState((p) => ({ ...p, submitLogs: [] }));
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={windproLogo} alt="WindPro" style={{ width: 70, height: "auto" }} />
          <div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>Admin Portal</div>
            <div style={{ opacity: 0.7 }}>Submissions • Who is missing • Export</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button style={smallBtn} onClick={exportCsv}>
            Export CSV
          </button>
          <button style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} onClick={clearAllLogs}>
            Clear logs
          </button>
          <button style={smallBtn} onClick={() => setState((p) => ({ ...p, isAdminLoggedIn: false }))}>
            Logout Admin
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Pay period</div>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} style={{ ...input, maxWidth: 420 }}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.startISO} → {p.endISO})
              </option>
            ))}
          </select>
        </div>

        <div style={{ borderLeft: "1px solid #eee", paddingLeft: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Known users (local)</div>
          <div style={{ opacity: 0.85 }}>{knownUsers.length} users detected in this browser</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Tip: “Known users” apar după ce ei au făcut login cel puțin o dată pe device-ul acesta.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={period.label}>
          <div>
            {period.startISO} → {period.endISO} | Invoice {period.invoiceDateISO}
          </div>
        </Card>
        <Card title="Submitted (known users)" big={`${submitted.length}`}>
          <div style={{ opacity: 0.85 }}>{submitted.map((u) => u.email).slice(0, 3).join(", ")}{submitted.length > 3 ? "..." : ""}</div>
        </Card>
        <Card title="Missing (known users)" big={`${missing.length}`}>
          <div style={{ opacity: 0.85 }}>{missing.map((u) => u.email).slice(0, 3).join(", ")}{missing.length > 3 ? "..." : ""}</div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, marginTop: 16 }}>
        {/* LOGS */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Submissions log</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Submitted</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>User</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Period</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Days</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Hours</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Pay</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Expenses</th>
                  <th style={{ ...pdfTh, fontSize: 12 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td style={pdfTd} colSpan={8}>
                      No submissions yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td style={pdfTd}>{format(parseISO(l.submittedAtISO), "yyyy-MM-dd HH:mm")}</td>
                      <td style={pdfTd}>
                        <div style={{ fontWeight: 800 }}>{l.userEmail}</div>
                        <div style={{ opacity: 0.75 }}>{l.userName}</div>
                      </td>
                      <td style={pdfTd}>
                        <div style={{ fontWeight: 800 }}>{l.periodId}</div>
                        <div style={{ opacity: 0.75 }}>
                          {l.periodStartISO} → {l.periodEndISO}
                        </div>
                      </td>
                      <td style={pdfTd}>{l.daysCount}</td>
                      <td style={pdfTd}>{l.totalHours.toFixed(2)}</td>
                      <td style={pdfTd}>€ {l.totalPay.toFixed(2)}</td>
                      <td style={pdfTd}>€ {l.totalExpenses.toFixed(2)}</td>
                      <td style={pdfTd}>
                        {statusChip(l.status)}
                        {l.note ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Note: {l.note}</div> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MISSING */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Who still needs to submit</div>

          <div style={{ padding: 12, borderRadius: 12, border: "1px solid #eee", background: "#fafafa" }}>
            <div style={{ fontWeight: 900 }}>Period:</div>
            <div style={{ opacity: 0.85 }}>{period.startISO} → {period.endISO}</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>✅ Submitted</div>
            <div style={{ display: "grid", gap: 6 }}>
              {submitted.length === 0 ? <div style={{ opacity: 0.75 }}>None</div> : null}
              {submitted.map((u) => (
                <div key={u.email} style={{ padding: 10, borderRadius: 12, border: "1px solid #e7f7ec", background: "#f4fff7" }}>
                  <div style={{ fontWeight: 900 }}>{u.email}</div>
                  <div style={{ opacity: 0.8 }}>{u.name || "-"}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>⏳ Missing</div>
            <div style={{ display: "grid", gap: 6 }}>
              {missing.length === 0 ? <div style={{ opacity: 0.75 }}>None</div> : null}
              {missing.map((u) => (
                <div key={u.email} style={{ padding: 10, borderRadius: 12, border: "1px solid #ffe4e4", background: "#fff7f7" }}>
                  <div style={{ fontWeight: 900 }}>{u.email}</div>
                  <div style={{ opacity: 0.8 }}>{u.name || "-"}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, opacity: 0.75 }}>
            Dacă vrei centralizat pentru firmă (fără dependență de browser), îți fac Firestore/Google Sheet în 10-15 linii de API + dashboard.
          </div>
        </div>
      </div>
    </div>
  );
}

/** ===================== MAIN USER APP ===================== */
function TimesheetApp({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const periods = useMemo(() => generateMonthlyPeriods(2025, 2050), []);
  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === state.selectedPeriodId) || periods[0],
    [periods, state.selectedPeriodId]
  );

  const activeEmail = useMemo(() => normalizeEmail(state.loginEmail), [state.loginEmail]);
  const emailIsCompanyAdmin = useMemo(() => (activeEmail ? ADMIN_EMAILS.includes(activeEmail) : false), [activeEmail]);

  useEffect(() => {
    if (!activeEmail) return;
    setState((prev) =>
      prev.users[activeEmail] ? prev : { ...prev, users: { ...prev.users, [activeEmail]: makeDefaultUser() } }
    );
  }, [activeEmail, setState]);

  const activeUser = useMemo<StoredUser>(() => {
    if (!activeEmail) return makeDefaultUser();
    return state.users[activeEmail] || makeDefaultUser();
  }, [state.users, activeEmail]);

  useEffect(() => {
    if (!inRangeISO(state.selectedDateISO, selectedPeriod.startISO, selectedPeriod.endISO)) {
      setState((p) => ({ ...p, selectedDateISO: selectedPeriod.startISO, multiSelectedISOs: [] }));
    }
  }, [selectedPeriod.id, selectedPeriod.startISO, selectedPeriod.endISO, state.selectedDateISO, setState]);

  const isLocked = useMemo(() => state.lockedPeriodIds.includes(selectedPeriod.id), [state.lockedPeriodIds, selectedPeriod.id]);
  const entries = activeUser.entries || {};

  const currentEntry: DayEntry = useMemo(() => {
    const e = entries[state.selectedDateISO];
    if (e) return e;
    return makeDefaultEntry(state.selectedDateISO, activeUser.defaultRatePerHour);
  }, [entries, state.selectedDateISO, activeUser.defaultRatePerHour]);

  const setUserPatch = (patch: Partial<StoredUser>) => {
    if (!activeEmail) return;
    setState((prev) => ({
      ...prev,
      users: { ...prev.users, [activeEmail]: { ...(prev.users[activeEmail] || makeDefaultUser()), ...patch } },
    }));
  };

  const setEntry = (patch: Partial<DayEntry>) => {
    if (!activeEmail || isLocked) return;
    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const existing = u.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO, u.defaultRatePerHour);
      const nextEntry: DayEntry = { ...existing, ...patch, dateISO: prev.selectedDateISO };
      return {
        ...prev,
        users: { ...prev.users, [activeEmail]: { ...u, entries: { ...u.entries, [prev.selectedDateISO]: nextEntry } } },
      };
    });
  };

  const clearDay = () => {
    if (!activeEmail || isLocked) return;
    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      delete next[prev.selectedDateISO];
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });
  };

  /** Calendar */
  const monthStart = useMemo(() => startOfMonth(parseISO(selectedPeriod.startISO)), [selectedPeriod.startISO]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);
  const savedDatesInMonth = useMemo(() => {
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(Object.keys(entries).filter((d) => d.startsWith(monthStr)));
  }, [entries, monthStart]);

  /** Period entries */
  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  const ROWS_PER_PAGE = 17;
  const periodEntryPages = useMemo(() => (periodEntries.length ? chunk(periodEntries, ROWS_PER_PAGE) : [[]]), [periodEntries]);

  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce((acc, e) => acc + (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0), 0);
    const pay = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0) * clampNum(e.ratePerHour, 0), 0);
    return { hours: round2(hours), expenses: round2(expenses), pay: round2(pay), defaultRate: round2(clampNum(activeUser.defaultRatePerHour, 0)) };
  }, [periodEntries, activeUser.defaultRatePerHour]);

  /** Multi-select */
  const multiSet = useMemo(() => new Set(state.multiSelectedISOs), [state.multiSelectedISOs]);
  const toggleMultiISO = (iso: string) => {
    setState((p) => {
      const set = new Set(p.multiSelectedISOs);
      if (set.has(iso)) set.delete(iso);
      else set.add(iso);
      return { ...p, multiSelectedISOs: Array.from(set) };
    });
  };
  const clearMultiSelection = () => setState((p) => ({ ...p, multiSelectedISOs: [] }));
  const onCalendarPick = (iso: string) => (state.multiMode ? toggleMultiISO(iso) : setState((p) => ({ ...p, selectedDateISO: iso })));

  /** Expenses */
  const addExpense = () => {
    if (!activeEmail || isLocked) return;
    setEntry({ expenses: [...(currentEntry.expenses || []), { id: uid("exp"), type: "Taxi", amount: 0, note: "" }] });
  };
  const updateExpense = (id: string, patch: Partial<Expense>) => {
    if (!activeEmail || isLocked) return;
    const next = (currentEntry.expenses || []).map((e) =>
      e.id === id ? { ...e, ...patch, amount: patch.amount !== undefined ? clampNum(patch.amount, 0) : e.amount } : e
    );
    setEntry({ expenses: next });
  };
  const removeExpense = (id: string) => {
    if (!activeEmail || isLocked) return;
    setEntry({ expenses: (currentEntry.expenses || []).filter((e) => e.id !== id) });
  };
  const attachExpenseFile = (expenseId: string, file: File | null) => {
    if (!file) return;
    if (!activeEmail || isLocked) return;
    const reader = new FileReader();
    reader.onload = () => updateExpense(expenseId, { fileName: file.name, fileDataUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
  };

  /** Signature */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const activePeriodSig = useMemo(() => activeUser.signatureByPeriod?.[selectedPeriod.id] || null, [activeUser.signatureByPeriod, selectedPeriod.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activePeriodSig) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = activePeriodSig;
    }
  }, [activePeriodSig]);

  const sigDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
  };
  const sigMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
    ctx.stroke();
  };
  const sigUp = () => {
    drawing.current = false;
  };
  const signatureSave = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setUserPatch({ signatureByPeriod: { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: dataUrl } });
  };
  const signatureClear = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setUserPatch({ signatureByPeriod: { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: null } });
  };

  /** Lock/unlock */
  const lockPeriod = () =>
    setState((p) => (p.lockedPeriodIds.includes(selectedPeriod.id) ? p : { ...p, lockedPeriodIds: [...p.lockedPeriodIds, selectedPeriod.id] }));

  // IMPORTANT: unlock by Admin Portal only (not user)
  const unlockAdminLocal = () => {
    // allow only if email is in admin emails (extra safety)
    if (!emailIsCompanyAdmin) return alert("Not allowed.");
    const pass = window.prompt("Admin password (portal):");
    if (!pass || pass !== ADMIN_PASS) return alert("Wrong password.");
    setState((p) => ({ ...p, lockedPeriodIds: p.lockedPeriodIds.filter((id) => id !== selectedPeriod.id) }));
  };

  /** Copy modals */
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);
  const [copyMyDayOpen, setCopyMyDayOpen] = useState(false);
  const [copyColleagueOpen, setCopyColleagueOpen] = useState(false);
  const [colleagueCode, setColleagueCode] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  const applyCopyMyDay = () => {
    if (!activeEmail) return alert("Login first.");
    if (isLocked) return alert("Period is locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Select target days (multi-select).");

    const sourceISO = state.selectedDateISO;
    const sourceEntry = entries[sourceISO];
    if (!sourceEntry) return alert("Source day has no data.");

    const targets = state.multiSelectedISOs.filter((d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO) && d !== sourceISO);
    if (targets.length === 0) return alert("No valid targets.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...sourceEntry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyMyDayOpen(false);
  };

  const generateMyDayCode = () => {
    const e = entries[state.selectedDateISO];
    if (!e) return alert("No saved data on selected day.");
    const payload = { v: 1, type: "dayEntry", entry: e };
    const code = JSON.stringify(payload);
    setColleagueCode(code);
    try {
      void navigator.clipboard?.writeText(code);
    } catch {}
    alert("Code generated (copied if allowed).");
  };

  const importColleagueAndApply = () => {
    if (!activeEmail) return alert("Login first.");
    if (isLocked) return alert("Period is locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Select target days (multi-select).");

    let parsed: any;
    try {
      parsed = JSON.parse(colleagueCode);
    } catch {
      return alert("Invalid code (not JSON).");
    }
    if (!parsed || parsed.v !== 1 || parsed.type !== "dayEntry" || !parsed.entry) return alert("Invalid code.");

    const entry: DayEntry = parsed.entry;
    const targets = state.multiSelectedISOs.filter((d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO));
    if (targets.length === 0) return alert("No valid targets.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...entry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyColleagueOpen(false);
  };

  /** ===================== PDF builders ===================== */
const buildPdfForPeriod = async (scale = 2, quality = 0.92) => {
  const pdf = new jsPDF("p", "pt", "a4");

  for (let i = 0; i < periodEntryPages.length; i++) {
    const root = document.getElementById(`pdf-root-${i}`);
    if (!root) throw new Error("PDF root missing");

    await new Promise((r) => setTimeout(r, 40));

    const canvas = await html2canvas(root, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    // ✅ AICI ESTE CHEIA
    const imgData = canvas.toDataURL("image/jpeg", quality);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (i > 0) pdf.addPage();

    pdf.addImage(
      imgData,
      "JPEG",
      0,
      0,
      imgWidth,
      Math.min(imgHeight, pageHeight),
      undefined,
      "FAST"
    );
  }

  return pdf;
};

  const buildExpensesPdf = async (): Promise<jsPDF | null> => {
    const items = periodEntries.flatMap((day) =>
      (day.expenses || [])
        .filter((ex) => !!ex.fileDataUrl && !!ex.fileName)
        .map((ex) => ({
          dateISO: day.dateISO,
          type: ex.type,
          amount: Number(ex.amount) || 0,
          note: ex.note || "",
          fileName: ex.fileName!,
          dataUrl: ex.fileDataUrl!,
        }))
    );

    if (items.length === 0) return null;

    const pdf = new jsPDF("p", "pt", "a4");

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i > 0) pdf.addPage();

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text(`Expenses Attachments ${i + 1}/${items.length}`, 40, 45);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(`Date: ${it.dateISO}`, 40, 70);
      pdf.text(`Type: ${it.type}`, 40, 88);
      pdf.text(`Amount: € ${it.amount.toFixed(2)}`, 40, 106);
      pdf.text(`Note: ${it.note || "-"}`, 40, 124);
      pdf.text(`File: ${it.fileName}`, 40, 142);

      const isPdf = it.fileName.toLowerCase().endsWith(".pdf") || it.dataUrl.startsWith("data:application/pdf");
      if (isPdf) {
        pdf.setFont("helvetica", "bold");
        pdf.text("PDF attachment detected. Not embedded in this PDF (browser limitation).", 40, 175);
        continue;
      }

      const img = new Image();
      img.src = it.dataUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image load failed"));
      });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const x = 40;
      const y = 180;
      const maxW = pageW - 80;
      const maxH = pageH - y - 40;

      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;

      const fmt = it.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      pdf.addImage(it.dataUrl, fmt as any, x, y, w, h, undefined, "FAST");
    }

    return pdf;
  };

  const exportPdfPeriod = async () => {
    if (!activeEmail) return alert("Login first.");
    try {
      const pdf = await buildPdfForPeriod(2, 0.88);
      pdf.save(`Timesheet_${selectedPeriod.id}_${trim1(activeUser.name) || "User"}.pdf`);
    } catch (e: any) {
      console.error(e);
      alert(`PDF failed: ${e?.message || "unknown error"}`);
    }
  };

  /** ===================== SUBMIT (2 PDFs) + AUDIT LOG ===================== */
  const submitEmailAndLock = async () => {
    if (!activeEmail) return alert("Login first.");
    if (!trim1(activeUser.name)) return alert("Add your name.");
    if (isLocked) return alert("Period is already locked.");
    if (periodEntries.length === 0) return alert("No entries in selected period.");

    setSubmitBusy(true);
    setSubmitMsg("");

    // create audit log entry first
    const baseLog: SubmitLog = {
      id: uid("submit"),
      userEmail: activeEmail,
      userName: trim1(activeUser.name),
      periodId: selectedPeriod.id,
      periodStartISO: selectedPeriod.startISO,
      periodEndISO: selectedPeriod.endISO,
      submittedAtISO: new Date().toISOString(),
      daysCount: periodEntries.length,
      totalHours: round2(periodEntries.reduce((a, e) => a + clampNum(e.hours, 0), 0)),
      totalPay: round2(periodEntries.reduce((a, e) => a + clampNum(e.hours, 0) * clampNum(e.ratePerHour, 0), 0)),
      totalExpenses: round2(periodEntries.reduce((a, e) => a + (e.expenses || []).reduce((b, x) => b + clampNum(x.amount, 0), 0), 0)),
      status: "submitted",
    };

    setState((p) => ({ ...p, submitLogs: [baseLog, ...(p.submitLogs || [])] }));

    try {
      // PDF 1 – Timesheet
      const pdf1 = await buildPdfForPeriod(3, 0.92); // ✅ claritate mare

      const blob1 = pdf1.output("blob");

      // PDF 2 – Expenses attachments
      const pdf2 = await buildExpensesPdf();
      const blob2 = pdf2 ? pdf2.output("blob") : null;

      const to = "timesheet@windpro.pl";
      const subject = `WindPro Timesheet MCE ${format(parseISO(selectedPeriod.startISO), "dd/MM/yyyy")}-${format(
        parseISO(selectedPeriod.endISO),
        "dd/MM/yyyy"
      )}`;

      const messageText = `Hello,

Please find attached the timesheet for the selected period${blob2 ? " (including Expenses Attachments PDF)." : "."}

Kind regards,
${trim1(activeUser.name)}`;

      const messageHtml = `
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #111;">
          <p>Hello,</p>
          <p>Please find attached the timesheet for the selected period${blob2 ? " (including Expenses Attachments PDF)." : "."}</p>
          <p>Kind regards,<br/><b>${trim1(activeUser.name)}</b></p>
        </div>
      `;

      const safeName = trim1(activeUser.name).replace(/\s+/g, "_") || "User";
      const filename1 = `Timesheet_${selectedPeriod.id}_${safeName}.pdf`;
      const filename2 = `Expenses_${selectedPeriod.id}_${safeName}.pdf`;

      const API_BASE = window.location.hostname === "localhost" ? "https://windprotimesheet.vercel.app" : "";

      const form = new FormData();
      form.append("to", to);
      form.append("subject", subject);
      form.append("text", messageText);
      form.append("html", messageHtml);

      form.append("file1", blob1, filename1);
      if (blob2) form.append("file2", blob2, filename2);

      const resp = await fetch(`${API_BASE}/api/send-timesheet`, { method: "POST", body: form });
      const rawText = await resp.text();

      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText };
      }

      if (!resp.ok || !data?.ok) {
        const details = data?.details ? JSON.stringify(data.details).slice(0, 1200) : "";
        throw new Error(`${data?.error || "Send failed"} (${resp.status}) ${details}`);
      }

      // mark log as email_sent
      setState((p) => ({
        ...p,
        submitLogs: (p.submitLogs || []).map((x) => (x.id === baseLog.id ? { ...x, status: "email_sent" } : x)),
      }));
// ✅ create ticket for admin approval inbox
try {
  await fetch(`${API_BASE}/api/timesheet-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employeeEmail: activeEmail,
      employeeName: trim1(activeUser.name),
      period: `${format(parseISO(selectedPeriod.startISO), "dd/MM/yyyy")}-${format(
        parseISO(selectedPeriod.endISO),
        "dd/MM/yyyy"
      )}`,
      totalHours: baseLog.totalHours,
    }),
  });
} catch (e) {
  console.warn("timesheet-create failed:", e);
}


      lockPeriod();
      setSubmitMsg(`✅ Submitted + emailed + locked. Id: ${data?.id || "n/a"}`);
      setSubmitMenuOpen(false);
    } catch (err: any) {
      console.error(err);

      setState((p) => ({
        ...p,
        submitLogs: (p.submitLogs || []).map((x) => (x.id === baseLog.id ? { ...x, status: "failed", note: String(err?.message || err) } : x)),
      }));

      setSubmitMsg(`❌ Submit failed: ${err?.message || "unknown error"}`);
    } finally {
      setSubmitBusy(false);
    }
  };

  /** ===================== derived ===================== */
  const generatedStr = useMemo(() => format(new Date(), "dd/MM/yyyy, HH:mm"), [selectedPeriod.id]);
  const dayExpenseSum = useMemo(() => round2((currentEntry.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0)), [currentEntry.expenses]);
  const dayPay = useMemo(() => round2(clampNum(currentEntry.hours, 0) * clampNum(currentEntry.ratePerHour, 0)), [currentEntry.hours, currentEntry.ratePerHour]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={windproLogo} alt="WindPro" style={{ width: 70, height: "auto" }} />
          <div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>WindPro TimeSheet</div>
            <div style={{ opacity: 0.7 }}>PDF (Timesheet + Expenses PDF) • Submit = email + lock</div>
          </div>
        </div>

        <button style={smallBtn} onClick={() => setState((p) => ({ ...p, isUserLoggedIn: false }))}>
          Logout
        </button>
      </div>

      {/* TOP BAR */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "520px 1fr auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
        }}
      >
        {/* Email + Name */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Login email:</div>
            <input value={state.loginEmail} disabled style={strongInput} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Name:</div>
            <input
              value={activeUser.name}
              onChange={(e) => setUserPatch({ name: e.target.value })}
              placeholder="ex: Bogdan Rotariu"
              style={strongInput}
            />
          </div>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Status: <b>{isLocked ? "Locked" : "Editable"}</b>
          </div>
        </div>

        {/* Period */}
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodId}
            onChange={(e) => {
              const pid = e.target.value;
              setState((p) => ({ ...p, selectedPeriodId: pid, selectedDateISO: `${pid}-01`, multiSelectedISOs: [] }));
            }}
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", maxWidth: 360 }}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifySelf: "end", alignItems: "center" }}>
          <button onClick={exportPdfPeriod} style={btnBlue}>
            Export PDF (Timesheet)
          </button>

          <div style={{ position: "relative" }}>
            <button onClick={() => setSubmitMenuOpen((v) => !v)} style={btnGreen} disabled={submitBusy}>
              Submit ▾
            </button>

            {submitMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "110%",
                  width: 320,
                  background: "white",
                  border: "1px solid #eee",
                  borderRadius: 12,
                  boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
                  overflow: "hidden",
                  zIndex: 9999,
                }}
              >
                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={isLocked || submitBusy}
                  onClick={submitEmailAndLock}
                >
                  Submit (email + lock) — 2 PDFs
                </button>

                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={isLocked}
                  onClick={() => {
                    setSubmitMenuOpen(false);
                    setState((p) => ({ ...p, multiMode: true }));
                    setCopyMyDayOpen(true);
                  }}
                >
                  Copy my day (multi-select)
                </button>

                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={isLocked}
                  onClick={() => {
                    setSubmitMenuOpen(false);
                    setState((p) => ({ ...p, multiMode: true }));
                    setCopyColleagueOpen(true);
                  }}
                >
                  Copy my colleague (code)
                </button>
              </div>
            )}
          </div>

          {/* Unlock (optional local) */}
          <button onClick={unlockAdminLocal} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} title="Works only if your email is in VITE_ADMIN_EMAILS + correct admin password">
            Unlock (Admin)
          </button>
        </div>
      </div>

      {submitMsg ? (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #eee", background: "white" }}>
          {submitMsg}
        </div>
      ) : null}

      {/* CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={selectedPeriod.label}>
          <div>
            {selectedPeriod.startISO} → {selectedPeriod.endISO} | Invoice {selectedPeriod.invoiceDateISO}
          </div>
        </Card>
        <Card title="Hours (period)" big={totals.hours.toFixed(2)} />
        <Card title="Expenses (period)" big={`€ ${totals.expenses.toFixed(2)}`} />
        <Card title="Pay (period)" big={`€ ${totals.pay.toFixed(2)}`} />
      </div>

      {/* MAIN */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
        {/* LEFT */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{monthLabel}</div>
            <div style={{ opacity: 0.7 }}>Select days</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={state.multiMode}
                onChange={(e) => setState((p) => ({ ...p, multiMode: e.target.checked, multiSelectedISOs: [] }))}
              />
              Multi-select days
            </label>

            {state.multiMode ? (
              <button onClick={clearMultiSelection} style={smallBtn}>
                Clear selection ({state.multiSelectedISOs.length})
              </button>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12, opacity: 0.75 }}>
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} style={{ textAlign: "center" }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
            {(() => {
              const count = getDaysInMonth(monthStart);
              const firstDay = monthStart.getDay();
              const cells: { date: Date | null; iso?: string }[] = [];
              for (let i = 0; i < firstDay; i++) cells.push({ date: null });
              for (let d = 1; d <= count; d++) {
                const dt = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
                const iso = format(dt, "yyyy-MM-dd");
                cells.push({ date: dt, iso });
              }
              while (cells.length % 7 !== 0) cells.push({ date: null });

              return cells.map((cell, idx) => {
                if (!cell.date || !cell.iso) return <div key={idx} style={{ height: 44 }} />;
                const iso = cell.iso;
                const isSelectedDay = iso === state.selectedDateISO;
                const isMultiSelected = multiSet.has(iso);
                const saved = savedDatesInMonth.has(iso);

                return (
                  <button
                    key={iso}
                    onClick={() => onCalendarPick(iso)}
                    style={{
                      height: 44,
                      borderRadius: 999,
                      border: isSelectedDay ? "3px solid #1f5eff" : isMultiSelected ? "3px solid #111" : "1px solid transparent",
                      background: isMultiSelected ? "#111" : "white",
                      color: isMultiSelected ? "white" : "black",
                      cursor: "pointer",
                      position: "relative",
                      fontWeight: 700,
                    }}
                    title={saved ? "Saved day" : ""}
                  >
                    {format(cell.date, "d")}
                    {saved ? (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 6,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: isMultiSelected ? "white" : "#1f5eff",
                        }}
                      />
                    ) : null}
                  </button>
                );
              });
            })()}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature (per period)</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={isLocked}>
                Clear
              </button>
            </div>

            <canvas
              width={360}
              height={150}
              ref={canvasRef}
              onPointerDown={sigDown}
              onPointerMove={sigMove}
              onPointerUp={sigUp}
              onPointerLeave={sigUp}
              style={{
                width: "100%",
                height: 150,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                touchAction: "none",
                opacity: isLocked ? 0.6 : 1,
              }}
            />
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{format(parseISO(state.selectedDateISO), "EEEE, MMMM dd, yyyy")}</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>
                <div>
                  Date: <b>{state.selectedDateISO}</b>
                </div>
                <div>
                  Period: <b>{selectedPeriod.label}</b>
                </div>
                <div>Invoice date: {selectedPeriod.invoiceDateISO}</div>
              </div>
            </div>

            <button onClick={clearDay} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} disabled={isLocked}>
              Clear day
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Work</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 170px", gap: 12, alignItems: "end" }}>
              <label>
                <div style={lbl}>Work type</div>
                <select value={currentEntry.workType} disabled={isLocked} onChange={(e) => setEntry({ workType: e.target.value as WorkType })} style={{ ...input, padding: 10 }}>
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={lbl}>Hours</div>
                <input value={currentEntry.hours} disabled={isLocked} onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0) })} type="number" min={0} step="0.25" style={{ ...input, padding: 10 }} />
              </label>

              <label>
                <div style={lbl}>Payment rate (€ / hour) (per day)</div>
                <input value={currentEntry.ratePerHour} disabled={isLocked} onChange={(e) => setEntry({ ratePerHour: clampNum(e.target.value, 0) })} type="number" min={0} step="0.01" style={{ ...input, padding: 10 }} placeholder="ex: 44" />
              </label>
            </div>

            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Day pay: <b>€ {dayPay.toFixed(2)}</b> | Day expenses: <b>€ {dayExpenseSum.toFixed(2)}</b>
            </div>

            <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #eee", background: "#fafafa" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Default rate (optional)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, alignItems: "end" }}>
                <div style={{ opacity: 0.8 }}>Setează o rată default ca să se pre-completeze automat pentru zilele noi.</div>
                <input value={activeUser.defaultRatePerHour} onChange={(e) => setUserPatch({ defaultRatePerHour: clampNum(e.target.value, 0) })} type="number" min={0} step="0.01" style={{ ...input, padding: 10 }} placeholder="ex: 44" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <label>
                <div style={lbl}>Location</div>
                <input value={currentEntry.location} disabled={isLocked} onChange={(e) => setEntry({ location: e.target.value })} placeholder="ex: Borssele" style={input} />
              </label>

              <label>
                <div style={lbl}>Service Worker (SW)</div>
                <input value={currentEntry.serviceWorker} disabled={isLocked} onChange={(e) => setEntry({ serviceWorker: e.target.value })} placeholder="ex: 67008943" style={input} />
              </label>
            </div>

            <div style={{ marginTop: 14, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Platform</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <div style={lbl}>Platform</div>
                  <select value={currentEntry.platformType} disabled={isLocked} onChange={(e) => setEntry({ platformType: e.target.value as PlatformType })} style={input}>
                    {PLATFORM_TYPES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <div style={lbl}>Vessel (preset)</div>
                  <select
                    value={currentEntry.vesselPreset}
                    disabled={isLocked}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEntry({ vesselPreset: v, vesselManual: v });
                    }}
                    style={input}
                  >
                    {VESSEL_PRESETS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label style={{ display: "block", marginTop: 12 }}>
                <div style={lbl}>Vessel (manual)</div>
                <input value={currentEntry.vesselManual} disabled={isLocked} onChange={(e) => setEntry({ vesselManual: e.target.value })} placeholder="ex: Blue Tern" style={input} />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Work note</div>
              <input value={currentEntry.workNote} disabled={isLocked} onChange={(e) => setEntry({ workNote: e.target.value })} placeholder="ex: torque / HV test..." style={input} />
            </label>

            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Expenses</div>
                <button onClick={addExpense} style={smallBtn} disabled={isLocked}>
                  + Add
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {(currentEntry.expenses || []).map((ex) => (
                  <div key={ex.id} style={{ display: "grid", gridTemplateColumns: "220px 140px 1fr 120px 80px", gap: 10, alignItems: "center" }}>
                    <select value={ex.type} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { type: e.target.value as ExpenseType })} style={input}>
                      {EXP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <input type="number" min={0} step="0.01" value={ex.amount} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { amount: clampNum(e.target.value, 0) })} style={input} placeholder="Amount" />

                    <input value={ex.note} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { note: e.target.value })} style={input} placeholder="note..." />

                    <label style={{ ...smallBtn, display: "inline-flex", justifyContent: "center", alignItems: "center" }}>
                      Attach
                      <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} disabled={isLocked} onChange={(e) => attachExpenseFile(ex.id, e.target.files?.[0] || null)} />
                    </label>

                    <button onClick={() => removeExpense(ex.id)} style={{ ...smallBtn, borderColor: "#eee" }} disabled={isLocked}>
                      ✕
                    </button>

                    {ex.fileName ? <div style={{ gridColumn: "1 / -1", fontSize: 12, opacity: 0.8 }}>📎 {ex.fileName} (saved local)</div> : null}
                  </div>
                ))}
              </div>
            </div>

            {isLocked ? <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>This month is locked.</div> : null}
          </div>
        </div>
      </div>

      {/* COPY MY DAY MODAL */}
      <Modal open={copyMyDayOpen} title="Copy my day (multi-select)" onClose={() => setCopyMyDayOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Source day = <b>{state.selectedDateISO}</b>. Targets = selected days in calendar.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={smallBtn} onClick={() => setCopyMyDayOpen(false)}>
              Cancel
            </button>
            <button style={btnDark} onClick={applyCopyMyDay} disabled={isLocked}>
              Apply to selected days ({state.multiSelectedISOs.length})
            </button>
          </div>
        </div>
      </Modal>

      {/* COPY COLLEAGUE MODAL */}
      <Modal open={copyColleagueOpen} title="Copy my colleague (code)" onClose={() => setCopyColleagueOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>1) Generate code from your selected day OR paste code from colleague. 2) Apply to selected days.</div>
          <button style={btnBlue} onClick={generateMyDayCode}>
            Generate code from my selected day
          </button>
          <textarea value={colleagueCode} onChange={(e) => setColleagueCode(e.target.value)} placeholder='{"v":1,"type":"dayEntry","entry":{...}}' style={{ ...input, minHeight: 160, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={smallBtn} onClick={() => setCopyColleagueOpen(false)}>
              Cancel
            </button>
            <button style={btnDark} onClick={importColleagueAndApply} disabled={isLocked}>
              Import & apply to selected days ({state.multiSelectedISOs.length})
            </button>
          </div>
        </div>
      </Modal>

      {/* ===================== PDF TEMPLATE (HIDDEN) ===================== */}
      <div style={{ position: "absolute", left: -99999, top: 0, width: 794 }}>
        {periodEntryPages.map((pageEntries, pageIndex) => (
          <div
            key={pageIndex}
            id={`pdf-root-${pageIndex}`}
            style={{
              width: 794,
              padding: 18,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 10,
              lineHeight: 1.2,
              color: "#111",
              background: "white",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <img src={windproLogo} alt="WindPro" style={{ position: "absolute", top: 14, left: 14, width: 78, height: "auto", zIndex: 3 }} />

            <img
              src={windproLogo}
              alt="WindPro watermark"
              style={{
                position: "absolute",
                top: "74%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "72%",
                height: "auto",
                opacity: 0.07,
                zIndex: 0,
                pointerEvents: "none",
                filter: "grayscale(100%)",
              }}
            />

            <div style={{ position: "relative", zIndex: 2, paddingTop: 68 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 2 }}>Timesheet</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.75 }}>WindPro Timesheet MCE</div>
                </div>

                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>Employee</div>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>{trim1(activeUser.name) || "-"}</div>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{activeEmail || "-"}</div>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>
                    Page {pageIndex + 1}/{periodEntryPages.length}
                  </div>
                </div>
              </div>

              {pageIndex === 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 14 }}>
                  <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, padding: 12, fontSize: 10 }}>
                    <div style={{ marginBottom: 6 }}>
                      <b>Period:</b> {selectedPeriod.label}
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <b>Invoice date:</b> {selectedPeriod.invoiceDateISO}
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <b>Submitted by:</b> {activeEmail || "-"}
                    </div>
                    <div>
                      <b>Name:</b> {trim1(activeUser.name) || "-"}
                    </div>
                  </div>

                  <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Total hours: {(Number(totals.hours) || 0).toFixed(2)}</div>
                    <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Total expenses: € {(Number(totals.expenses) || 0).toFixed(2)}</div>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>Total pay: € {(Number(totals.pay) || 0).toFixed(2)}</div>
                    <div style={{ marginTop: 8, fontSize: 9, opacity: 0.7 }}>Generated: {generatedStr}</div>
                  </div>
                </div>
              ) : null}

              <div style={{ fontSize: 14, fontWeight: 900, margin: "10px 0 8px" }}>Entries (Selected Period)</div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={pdfTh}>Date</th>
                    <th style={pdfTh}>Work type</th>
                    <th style={pdfTh}>Vessel</th>
                    <th style={pdfTh}>Location</th>
                    <th style={pdfTh}>Hours</th>
                    <th style={pdfTh}>Rate</th>
                    <th style={pdfTh}>Pay</th>
                    <th style={pdfTh}>SW</th>
                    <th style={pdfTh}>Expenses</th>
                    <th style={pdfTh}>Work note</th>
                  </tr>
                </thead>

                <tbody>
                  {pageEntries.map((e) => {
                    const rate = Number(e.ratePerHour) || 0;
                    const hours = Number(e.hours) || 0;
                    const pay = hours * rate;
                    const expSum = (e.expenses || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
                    const vessel = (e.vesselManual || e.vesselPreset || "").trim();

                    return (
                      <tr key={e.dateISO}>
                        <td style={pdfTd}>{e.dateISO}</td>
                        <td style={pdfTd}>{e.workType}</td>
                        <td style={pdfTd}>{vessel}</td>
                        <td style={pdfTd}>{e.location}</td>
                        <td style={pdfTd}>{hours.toFixed(2)}</td>
                        <td style={pdfTd}>€ {rate.toFixed(2)}</td>
                        <td style={pdfTd}>€ {pay.toFixed(2)}</td>
                        <td style={pdfTd}>{e.serviceWorker}</td>
                        <td style={pdfTd}>€ {expSum.toFixed(2)}</td>
                        <td style={pdfTd}>{e.workNote}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {pageIndex === periodEntryPages.length - 1 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12, alignItems: "start" }}>
                  <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Totals</div>
                    <div style={{ fontSize: 10.5, lineHeight: 1.7 }}>
                      <div>Hours: {(Number(totals.hours) || 0).toFixed(2)}</div>
                      <div>Expenses: € {(Number(totals.expenses) || 0).toFixed(2)}</div>
                      <div>Pay: € {(Number(totals.pay) || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div style={{ border: "1px solid #e3e3e3", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 8 }}>Signature</div>
                    <div style={{ border: "1px solid #eee", borderRadius: 10, height: 140, overflow: "hidden", background: "white" }}>
                      {activePeriodSig ? <img src={activePeriodSig} alt="signature" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** ===================== ROOT APP ===================== */
export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => saveState(state), [state]);

  // UI state for admin login view
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [adminErr, setAdminErr] = useState("");

 const doUserLogin = () => {
  const email = normalizeEmail(state.loginEmail);
  const pass = (state.loginPass || "").trim();

  if (!email || !email.includes("@")) return alert("Bagă un email valid.");
  if (!pass) return alert("Bagă parola.");

  const expectedPassword = USERS[email];
  if (!expectedPassword) return alert("unregistered email. contact your admin.");
  if (pass !== expectedPassword) return alert("wrong password.");

  setState((p) => ({ ...p, loginEmail: email, loginPass: "", isUserLoggedIn: true }));
};

  const doAdminLogin = () => {
    setAdminErr("");

    if (!ADMIN_PASS) {
      setAdminErr("Admin password is not configured (VITE_ADMIN_PASS).");
      return;
    }

    const u = trim1(adminUser);
    const p = trim1(adminPass);

    if (!u || !p) {
      setAdminErr("Completează user + parolă.");
      return;
    }

    if (u !== ADMIN_USER || p !== ADMIN_PASS) {
      setAdminErr("Credențiale greșite.");
      return;
    }

    setState((s) => ({ ...s, isAdminLoggedIn: true }));
    setAdminUser("");
    setAdminPass("");
  };

  // ADMIN PORTAL takes priority
  if (state.isAdminLoggedIn) {
    return (
      <ErrorBoundary>
        <AdminDashboard state={state} setState={setState} />
      </ErrorBoundary>
    );
  }

  // ADMIN LOGIN SCREEN
  if (showAdminLogin) {
    return (
      <ErrorBoundary>
        <AdminLoginView
          adminUser={adminUser}
          adminPass={adminPass}
          setAdminUser={setAdminUser}
          setAdminPass={setAdminPass}
          onAdminLogin={doAdminLogin}
          onBack={() => {
            setShowAdminLogin(false);
            setAdminErr("");
            setAdminUser("");
            setAdminPass("");
          }}
          error={adminErr}
        />
      </ErrorBoundary>
    );
  }

  // USER LOGIN SCREEN
  if (!state.isUserLoggedIn) {
    return (
      <ErrorBoundary>
        <LoginView
          email={state.loginEmail}
          password={state.loginPass}
          setEmail={(v) => setState((p) => ({ ...p, loginEmail: v }))}
          setPassword={(v) => setState((p) => ({ ...p, loginPass: v }))}
          onUserLogin={doUserLogin}
          onOpenAdminLogin={() => setShowAdminLogin(true)}
        />
      </ErrorBoundary>
    );
  }

  // USER APP
  return (
    <ErrorBoundary>
      <TimesheetApp state={state} setState={setState} />
    </ErrorBoundary>
  );
}
