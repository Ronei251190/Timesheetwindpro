import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subMonths
  // NOTE: subMonths not needed now, keep simple? we'll use month nav by period dropdown only.
} from "date-fns";
import jsPDF from "jspdf";

/** ---------------- TYPES ---------------- */

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

type Expense = { id: string; type: ExpenseType; amount: number; note: string };

type DayEntry = {
  dateISO: string;
  workType: WorkType;
  hours: number;

  location: string;
  serviceWorker: string;
  workDone: string;
  comment: string;

  expenses: Expense[];

  platformType: PlatformType;
  vesselPreset: string;
  vesselManual: string;
};

type Period = {
  id: string; // YYYY-MM
  label: string; // YYYY - Month
  startISO: string;
  endISO: string;
  invoiceDateISO: string;
};

type StoredUser = {
  name: string;
  ratePerHour: number;
  entries: Record<string, DayEntry>;

  // signature saved PER PERIOD (YYYY-MM)
  signatureByPeriod: Record<string, string | null>;
};

type AppState = {
  loginEmail: string;
  selectedPeriodId: string;
  selectedDateISO: string;

  lockedPeriodIds: string[];

  // multi-select calendar
  multiMode: boolean;
  multiSelectedISOs: string[];

  // users storage (key = email)
  users: Record<string, StoredUser>;
};

const LS_KEY = "windpro_timesheet_v7_full";
const ADMIN_PASSWORD = "1234"; // schimbă parola admin aici

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

/** ---------------- HELPERS ---------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function trim1(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function normalizeEmail(e: string) {
  return trim1(e).toLowerCase();
}
function clampNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function inRangeISO(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}
function makeDefaultEntry(dateISO: string): DayEntry {
  return {
    dateISO,
    workType: "Offshore Night Shift (SOV)",
    hours: 0,
    location: "",
    serviceWorker: "",
    workDone: "",
    comment: "",
    expenses: [],
    platformType: "SOV",
    vesselPreset: "Blue Tern",
    vesselManual: "Blue Tern",
  };
}
function makeDefaultUser(): StoredUser {
  return { name: "", ratePerHour: 0, entries: {}, signatureByPeriod: {} };
}
function generateMonthlyPeriodsUntil2050(): Period[] {
  const start = new Date(2025, 0, 1);
  const end = new Date(2050, 11, 1);

  const periods: Period[] = [];
  let cur = startOfMonth(start);

  while (cur <= end) {
    const s = startOfMonth(cur);
    const e = endOfMonth(cur);
    const id = format(cur, "yyyy-MM");
    periods.push({
      id,
      label: `${format(cur, "yyyy")} - ${format(cur, "MMMM")}`,
      startISO: format(s, "yyyy-MM-dd"),
      endISO: format(e, "yyyy-MM-dd"),
      invoiceDateISO: format(e, "yyyy-MM-dd"),
    });
    cur = addMonths(cur, 1);
  }
  return periods;
}

/** ---------------- STORAGE ---------------- */

const DEFAULT_STATE: AppState = {
  loginEmail: "",
  selectedPeriodId: format(new Date(), "yyyy-MM"),
  selectedDateISO: todayISO(),
  lockedPeriodIds: [],
  multiMode: false,
  multiSelectedISOs: [],
  users: {},
};

function loadState(): AppState {
  const s = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...s,
    lockedPeriodIds: s.lockedPeriodIds || [],
    users: s.users || {},
    multiMode: !!s.multiMode,
    multiSelectedISOs: Array.isArray(s.multiSelectedISOs) ? s.multiSelectedISOs : [],
  };
}
function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** ---------------- STYLES ---------------- */

const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #ddd",
  fontFamily: "inherit",
  fontSize: 16,
};
const strongInput: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "2px solid #111",
  fontFamily: "inherit",
  fontSize: 16,
};
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
  whiteSpace: "nowrap",
};
const btnGreen: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #178a3a",
  background: "#178a3a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const btnDark: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#111",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function dotStyle(xOffset: number): React.CSSProperties {
  return {
    position: "absolute",
    bottom: 6,
    left: "50%",
    transform: `translateX(calc(-50% + ${xOffset}px))`,
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#1f5eff",
  };
}

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
          width: "min(880px, 100%)",
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

/** ---------------- APP ---------------- */

export default function App() {
  const periods = useMemo(() => generateMonthlyPeriodsUntil2050(), []);
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => saveState(state), [state]);

  // Submit submenu + modals
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);
  const [copyMyDayOpen, setCopyMyDayOpen] = useState(false);
  const [copyColleagueOpen, setCopyColleagueOpen] = useState(false);
  const [colleagueCode, setColleagueCode] = useState("");

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === state.selectedPeriodId) || periods[0],
    [periods, state.selectedPeriodId]
  );

  const isLocked = useMemo(
    () => state.lockedPeriodIds.includes(selectedPeriod.id),
    [state.lockedPeriodIds, selectedPeriod.id]
  );

  // keep selectedDate inside selectedPeriod
  useEffect(() => {
    if (!inRangeISO(state.selectedDateISO, selectedPeriod.startISO, selectedPeriod.endISO)) {
      setState((p) => ({ ...p, selectedDateISO: selectedPeriod.startISO, multiSelectedISOs: [] }));
    }
  }, [selectedPeriod.id]);

  // active user by email
  const activeEmail = useMemo(() => normalizeEmail(state.loginEmail), [state.loginEmail]);
  const activeUser: StoredUser = useMemo(() => {
    if (!activeEmail) return makeDefaultUser();
    return state.users[activeEmail] || makeDefaultUser();
  }, [state.users, activeEmail]);

  // ensure user exists
  useEffect(() => {
    if (!activeEmail) return;
    setState((prev) => {
      if (prev.users[activeEmail]) return prev;
      return { ...prev, users: { ...prev.users, [activeEmail]: makeDefaultUser() } };
    });
  }, [activeEmail]);

  const entries = activeUser.entries || {};
  const selectedDate = useMemo(() => parseISO(state.selectedDateISO), [state.selectedDateISO]);

  const currentEntry: DayEntry = useMemo(
    () => entries[state.selectedDateISO] || makeDefaultEntry(state.selectedDateISO),
    [entries, state.selectedDateISO]
  );

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
      const existing = u.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO);
      const nextEntry: DayEntry = { ...existing, ...patch };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: { ...u.entries, [prev.selectedDateISO]: nextEntry } } } };
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

  // calendar month = selected period month
  const monthStart = useMemo(() => startOfMonth(parseISO(selectedPeriod.startISO)), [selectedPeriod.startISO]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);

  const days = useMemo(() => {
    const count = getDaysInMonth(monthStart);
    const firstDay = monthStart.getDay();
    const cells: { date: Date | null; iso?: string }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ date: null });
    for (let d = 1; d <= count; d++) {
      const dt = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      cells.push({ date: dt, iso: format(dt, "yyyy-MM-dd") });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [monthStart]);

  const savedDatesInMonth = useMemo(() => {
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(Object.keys(entries).filter((d) => d.startsWith(monthStr)));
  }, [entries, monthStart]);

  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce((acc, e) => acc + (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0), 0);
    const rate = clampNum(activeUser.ratePerHour, 0);
    const pay = hours * rate;
    return { hours: round2(hours), expenses: round2(expenses), pay: round2(pay), rate };
  }, [periodEntries, activeUser.ratePerHour]);

  /** ------- Expenses ------- */
  const addExpense = () => {
    if (isLocked) return;
    setEntry({ expenses: [...(currentEntry.expenses || []), { id: uid("exp"), type: "Taxi", amount: 0, note: "" }] });
  };
  const updateExpense = (id: string, patch: Partial<{ type: ExpenseType; amount: number; note: string }>) => {
    if (isLocked) return;
    setEntry({ expenses: (currentEntry.expenses || []).map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  };
  const removeExpense = (id: string) => {
    if (isLocked) return;
    setEntry({ expenses: (currentEntry.expenses || []).filter((e) => e.id !== id) });
  };

  /** ------- Signature per period ------- */
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
  }, [activePeriodSig, selectedPeriod.id, activeEmail]);

  const sigDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLocked) return;
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
    const nextMap = { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: dataUrl };
    setUserPatch({ signatureByPeriod: nextMap });
  };
  const signatureClear = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nextMap = { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: null };
    setUserPatch({ signatureByPeriod: nextMap });
  };

  /** ------- Lock / Unlock ------- */
  const lockPeriod = () => {
    setState((p) => (p.lockedPeriodIds.includes(selectedPeriod.id) ? p : { ...p, lockedPeriodIds: [...p.lockedPeriodIds, selectedPeriod.id] }));
  };
  const unlockAdmin = () => {
    const pass = window.prompt("Admin password:");
    if (pass !== ADMIN_PASSWORD) return alert("Wrong password.");
    setState((p) => ({ ...p, lockedPeriodIds: p.lockedPeriodIds.filter((id) => id !== selectedPeriod.id) }));
  };

  /** ------- PDF Export (simple) ------- */
  const exportPdfPeriod = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    const safe = (s: string) => trim1(String(s || "")).replace(/[^\x09\x0A\x0D\x20-\x7E€]/g, " ");

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 36;
    let y = 46;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Timesheet", margin, y);

    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Period: ${safe(selectedPeriod.label)} (${selectedPeriod.startISO} → ${selectedPeriod.endISO})`, margin, y);
    y += 14;
    doc.text(`Invoice date: ${safe(selectedPeriod.invoiceDateISO)}`, margin, y);
    y += 14;
    doc.text(`Email: ${safe(activeEmail)} | Name: ${safe(activeUser.name || "-")}`, margin, y);
    y += 14;
    doc.text(`Rate: € ${round2(totals.rate).toFixed(2)} / h`, margin, y);
    y += 14;
    doc.text(`Total hours: ${totals.hours.toFixed(2)} | Expenses: € ${totals.expenses.toFixed(2)} | Pay: € ${totals.pay.toFixed(2)}`, margin, y);

    y += 22;
    doc.setFont("helvetica", "bold");
    doc.text("Entries:", margin, y);

    y += 14;
    doc.setFont("helvetica", "normal");
    for (const e of periodEntries) {
      const expSum = round2((e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0));
      const line = `${e.dateISO} | ${e.workType} | H:${round2(e.hours).toFixed(2)} | Vessel:${trim1(e.vesselManual || e.vesselPreset)} | SW:${trim1(e.serviceWorker)} | Exp:€${expSum.toFixed(2)}`;
      doc.text(safe(line), margin, y);
      y += 12;
      if (y > 760) {
        doc.addPage();
        y = 46;
      }
    }

    y += 18;
    doc.setFont("helvetica", "bold");
    doc.text("Signature:", margin, y);

    const sig = activePeriodSig;
    if (sig) {
      try {
        doc.addImage(sig, "PNG", margin, y + 8, 220, 90);
      } catch {}
    }

    doc.save(`WindPro_TimeSheet_${selectedPeriod.id}_${activeEmail}.pdf`);
  };

  /** ------- Submit (email + lock) ------- */
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  async function submitEmailAndLock() {
    if (!activeEmail) return alert("Bagă Login email.");
    if (!trim1(activeUser.name)) return alert("Bagă Name.");
    if (isLocked) return alert("Perioada este deja locked.");

    setSubmitBusy(true);
    setSubmitMsg("");
    lockPeriod();

    try {
      // TODO: aici vei pune endpoint real de email
      await new Promise((r) => setTimeout(r, 350));
      setSubmitMsg("✅ Submitted & locked.");
    } catch {
      setState((p) => ({ ...p, lockedPeriodIds: p.lockedPeriodIds.filter((id) => id !== selectedPeriod.id) }));
      setSubmitMsg("❌ Submit failed. Unlocked back.");
    } finally {
      setSubmitBusy(false);
      setSubmitMenuOpen(false);
    }
  }

  /** ------- Multi-select ------- */
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

  const onCalendarPick = (iso: string) => {
    if (state.multiMode) toggleMultiISO(iso);
    else setState((p) => ({ ...p, selectedDateISO: iso }));
  };

  /** ------- Copy my day ------- */
  const applyCopyMyDay = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    if (isLocked) return alert("Perioada e locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Selectează zilele target (multi-select).");

    const sourceISO = state.selectedDateISO;
    const sourceEntry = entries[sourceISO];
    if (!sourceEntry) return alert("Ziua sursă nu are date.");

    const targets = state.multiSelectedISOs.filter((d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO) && d !== sourceISO);
    if (targets.length === 0) return alert("Nu ai zile target valide.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...sourceEntry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyMyDayOpen(false);
  };

  /** ------- Copy my colleague ------- */
  const generateMyDayCode = () => {
    const e = entries[state.selectedDateISO];
    if (!e) return alert("Nu ai nimic salvat pe ziua selectată.");
    const payload = { v: 1, type: "dayEntry", entry: e };
    const code = JSON.stringify(payload);
    setColleagueCode(code);
    try {
      void navigator.clipboard?.writeText(code);
    } catch {}
    alert("Cod generat (și copiat dacă browserul permite). Trimite-l colegului.");
  };

  const importColleagueAndApply = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    if (isLocked) return alert("Perioada e locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Selectează zilele target (multi-select).");

    let parsed: any;
    try {
      parsed = JSON.parse(colleagueCode);
    } catch {
      return alert("Cod invalid (nu e JSON).");
    }
    if (!parsed || parsed.v !== 1 || parsed.type !== "dayEntry" || !parsed.entry) {
      return alert("Cod invalid (format necunoscut).");
    }

    const entry: DayEntry = parsed.entry;
    const targets = state.multiSelectedISOs.filter((d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO));
    if (targets.length === 0) return alert("Nu ai zile target valide.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...entry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyColleagueOpen(false);
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        PDF doar pe perioada selectată (luna). Submit = lock. Unlock = admin. Copy = multi-select.
      </div>

      {/* TOP BAR */}
      <div style={{ display: "grid", gridTemplateColumns: "520px 1fr auto", gap: 12, alignItems: "center", padding: 14, borderRadius: 14, border: "1px solid #eee", background: "white" }}>
        {/* Email + Name */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Login email:</div>
            <input value={state.loginEmail} onChange={(e) => setState((p) => ({ ...p, loginEmail: e.target.value }))} placeholder="ex: borot@windpro.pl" style={strongInput} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Name:</div>
            <input value={activeUser.name} onChange={(e) => setUserPatch({ name: e.target.value })} placeholder="ex: Bogdan Rotariu" style={strongInput} disabled={!activeEmail} />
          </div>
        </div>

        {/* Period */}
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodId}
            onChange={(e) => setState((p) => ({ ...p, selectedPeriodId: e.target.value, selectedDateISO: `${e.target.value}-01`, multiSelectedISOs: [] }))}
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
          <button onClick={exportPdfPeriod} style={btnBlue} disabled={!activeEmail}>
            Export PDF (Period)
          </button>

          {/* SUBMIT DROPDOWN */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setSubmitMenuOpen((v) => !v)} style={btnGreen} disabled={!activeEmail || submitBusy}>
              Submit ▾
            </button>

            {submitMenuOpen && (
              <div style={{ position: "absolute", right: 0, top: "110%", width: 280, background: "white", border: "1px solid #eee", borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,0.18)", overflow: "hidden", zIndex: 9999 }}>
                <button style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }} disabled={!activeEmail || isLocked || submitBusy} onClick={submitEmailAndLock}>
                  Submit (email + lock)
                </button>

                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={!activeEmail || isLocked}
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
                  disabled={!activeEmail || isLocked}
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

          <button onClick={unlockAdmin} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }}>
            Unlock (Admin)
          </button>
        </div>
      </div>

      {submitMsg ? <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #eee", background: "white" }}>{submitMsg}</div> : null}

      {/* CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={selectedPeriod.label}>
          <div>
            {selectedPeriod.startISO} → {selectedPeriod.endISO} | Invoice {selectedPeriod.invoiceDateISO}
          </div>
          <div style={{ marginTop: 6, color: isLocked ? "#b55" : "#1f5eff", fontWeight: 700 }}>{isLocked ? "Locked" : "Editable"}</div>
        </Card>
        <Card title="Hours (period)" big={totals.hours.toFixed(2)} />
        <Card title="Expenses (period)" big={`€ ${totals.expenses.toFixed(2)}`} />
        <Card title="Pay (period)" big={`€ ${totals.pay.toFixed(2)}`}>
          <div>Rate: € {round2(totals.rate).toFixed(2)} / h</div>
        </Card>
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
              <input type="checkbox" checked={state.multiMode} onChange={(e) => setState((p) => ({ ...p, multiMode: e.target.checked, multiSelectedISOs: [] }))} />
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
            {days.map((cell, idx) => {
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
                >
                  {format(cell.date, "d")}
                  {saved && (
                    <>
                      <span style={dotStyle(-5)} />
                      <span style={dotStyle(5)} />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature (per period)</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={!activeEmail || isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={!activeEmail || isLocked}>
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
              style={{ width: "100%", height: 150, borderRadius: 12, border: "1px solid #ddd", background: "white", touchAction: "none", opacity: !activeEmail || isLocked ? 0.6 : 1 }}
            />
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{format(selectedDate, "EEEE, MMMM dd, yyyy")}</div>
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

            <button onClick={clearDay} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} disabled={!activeEmail || isLocked}>
              Clear day
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Work</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 170px", gap: 12, alignItems: "end" }}>
              <label>
                <div style={lbl}>Work type</div>
                <select value={currentEntry.workType} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ workType: e.target.value as WorkType })} style={{ ...input, padding: 10 }}>
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={lbl}>Hours</div>
                <input value={currentEntry.hours} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0) })} type="number" min={0} step="0.25" style={{ ...input, padding: 10 }} />
              </label>

              <label>
                <div style={lbl}>Payment rate (€ / hour)</div>
                <input value={activeUser.ratePerHour} disabled={!activeEmail} onChange={(e) => setUserPatch({ ratePerHour: clampNum(e.target.value, 0) })} type="number" min={0} step="0.01" style={{ ...input, padding: 10 }} placeholder="ex: 45" />
              </label>
            </div>

            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Day pay: <b>€ {round2(clampNum(currentEntry.hours, 0) * clampNum(activeUser.ratePerHour, 0)).toFixed(2)}</b>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <label>
                <div style={lbl}>Location</div>
                <input value={currentEntry.location} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ location: e.target.value })} placeholder="ex: Borssele" style={input} />
              </label>

              <label>
                <div style={lbl}>Service Worker (SW)</div>
                <input value={currentEntry.serviceWorker} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ serviceWorker: e.target.value })} placeholder="ex: 67008943" style={input} />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Work note</div>
              <input value={currentEntry.workDone} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ workDone: e.target.value })} placeholder="GBX exchange / HV test / torque check..." style={input} />
            </label>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Comment</div>
              <input value={currentEntry.comment} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ comment: e.target.value })} placeholder="notes..." style={input} />
            </label>

            {/* Expenses */}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Expenses</div>
                <button onClick={addExpense} style={smallBtn} disabled={!activeEmail || isLocked}>
                  + Add
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {(currentEntry.expenses || []).map((ex) => (
                  <div key={ex.id} style={{ display: "grid", gridTemplateColumns: "220px 140px 1fr 80px", gap: 10, alignItems: "center" }}>
                    <select value={ex.type} disabled={!activeEmail || isLocked} onChange={(e) => updateExpense(ex.id, { type: e.target.value as ExpenseType })} style={input}>
                      {EXP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <input type="number" min={0} step="0.01" value={ex.amount} disabled={!activeEmail || isLocked} onChange={(e) => updateExpense(ex.id, { amount: clampNum(e.target.value, 0) })} style={input} placeholder="Amount" />

                    <input value={ex.note} disabled={!activeEmail || isLocked} onChange={(e) => updateExpense(ex.id, { note: e.target.value })} style={input} placeholder="note..." />

                    <button onClick={() => removeExpense(ex.id)} style={{ ...smallBtn, borderColor: "#eee" }} disabled={!activeEmail || isLocked}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Vessel / Platform (uses PLATFORM_TYPES + VESSEL_PRESETS) */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Platform</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <div style={lbl}>Platform</div>
                    <select value={currentEntry.platformType} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ platformType: e.target.value as PlatformType })} style={input}>
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
                      disabled={!activeEmail || isLocked}
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
                  <input value={currentEntry.vesselManual} disabled={!activeEmail || isLocked} onChange={(e) => setEntry({ vesselManual: e.target.value })} placeholder="ex: Blue Tern" style={input} />
                </label>
              </div>
            </div>

            {isLocked && <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>This month is locked. Use Unlock (Admin) to edit.</div>}
          </div>
        </div>
      </div>

      {/* COPY MY DAY MODAL */}
      <Modal open={copyMyDayOpen} title="Copy my day (multi-select)" onClose={() => setCopyMyDayOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Ziua sursă = <b>{state.selectedDateISO}</b>. Target = zilele bifate în calendar (multi-select).
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
          <div style={{ opacity: 0.85 }}>
            1) Generezi cod din ziua ta selectată (sau lipești cod de la coleg). 2) Îl aplici peste zilele bifate.
          </div>

          <button style={btnBlue} onClick={generateMyDayCode} disabled={!activeEmail}>
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
    </div>
  );
}
