import React, { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, endOfMonth, format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
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
  entries: Record<string, DayEntry>;
  signatureDataUrl: string | null;
};

type AppState = {
  loginEmail: string;
  loginName: string;

  selectedPeriodId: string;
  selectedDateISO: string;

  entries: Record<string, DayEntry>;
  signatureDataUrl: string | null;
  lockedPeriodIds: string[];

  // local colleague storage
  colleagues: string[];
  users: Record<string, StoredUser>;
};

/** ---------------- CONFIG ---------------- */

const LS_KEY = "windpro_timesheet_final_v3";
const ADMIN_PASSWORD = "1234"; // schimbă tu
const COLLECTOR_EMAIL = "borot@windpro.pl";

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
function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** ---------------- STATE ---------------- */

const DEFAULT_STATE: AppState = {
  loginEmail: "",
  loginName: "",
  selectedPeriodId: format(new Date(), "yyyy-MM"),
  selectedDateISO: todayISO(),
  entries: {},
  signatureDataUrl: null,
  lockedPeriodIds: [],
  colleagues: [COLLECTOR_EMAIL],
  users: {},
};

function loadState(): AppState {
  const s = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);
  const merged: AppState = {
    ...DEFAULT_STATE,
    ...s,
    entries: s.entries || {},
    lockedPeriodIds: s.lockedPeriodIds || [],
    colleagues: s.colleagues?.length ? s.colleagues : DEFAULT_STATE.colleagues,
    users: s.users || {},
  };
  if (!merged.colleagues.includes(COLLECTOR_EMAIL)) merged.colleagues = [...merged.colleagues, COLLECTOR_EMAIL];
  return merged;
}
function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** ---------------- UI HELPERS ---------------- */

const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #ddd",
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
const btnGreen: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #178a3a",
  background: "#178a3a",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: "40px",
  textAlign: "center",
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

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 12px",
        border: "none",
        background: "white",
        cursor: "pointer",
        fontWeight: 700,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f6")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
    >
      {children}
    </button>
  );
}

/** ---------------- APP ---------------- */

export default function App() {
  const periods = useMemo(() => generateMonthlyPeriodsUntil2050(), []);
  const [state, setState] = useState<AppState>(() => loadState());

  // submit dropdown + copy mode
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);
  const submitMenuRef = useRef<HTMLDivElement | null>(null);

  // copy mode persistent
  const [copyDayMode, setCopyDayMode] = useState(false);

  // email status
  const [sending, setSending] = useState(false);

  useEffect(() => saveState(state), [state]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === state.selectedPeriodId) || periods[0],
    [periods, state.selectedPeriodId]
  );

  const isLocked = useMemo(() => state.lockedPeriodIds.includes(selectedPeriod.id), [state.lockedPeriodIds, selectedPeriod.id]);

  const selectedDate = useMemo(() => parseISO(state.selectedDateISO), [state.selectedDateISO]);
  const monthStart = useMemo(() => startOfMonth(selectedDate), [selectedDate]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!submitMenuOpen) return;
      const el = submitMenuRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setSubmitMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [submitMenuOpen]);

  const currentEntry: DayEntry = useMemo(
    () => state.entries[state.selectedDateISO] || makeDefaultEntry(state.selectedDateISO),
    [state.entries, state.selectedDateISO]
  );

  const setEntry = (patch: Partial<DayEntry>) => {
    if (isLocked) return;
    setState((prev) => {
      const existing = prev.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO);
      const nextEntry: DayEntry = { ...existing, ...patch };
      return { ...prev, entries: { ...prev.entries, [prev.selectedDateISO]: nextEntry } };
    });
  };

  const clearDay = () => {
    if (isLocked) return;
    setState((prev) => {
      const copy = { ...prev.entries };
      delete copy[prev.selectedDateISO];
      return { ...prev, entries: copy };
    });
  };

  const savedDatesInMonth = useMemo(() => {
    const all = Object.keys(state.entries);
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(all.filter((d) => d.startsWith(monthStr)));
  }, [state.entries, monthStart]);

  const days = useMemo(() => {
    const count = getDaysInMonth(monthStart);
    const firstDay = monthStart.getDay();
    const cells: { date: Date | null; iso?: string }[] = [];

    for (let i = 0; i < firstDay; i++) cells.push({ date: null });
    for (let d = 1; d <= count; d++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      cells.push({ date, iso: format(date, "yyyy-MM-dd") });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [monthStart]);

  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(state.entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [state.entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce(
      (acc, e) => acc + (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0),
      0
    );
    return { hours: round2(hours), expenses: round2(expenses) };
  }, [periodEntries]);

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

  /** ------- Signature canvas ------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const sigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const sigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const sigPointerUp = () => {
    drawing.current = false;
  };

  const signatureSave = () => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setState((p) => ({ ...p, signatureDataUrl: canvas.toDataURL("image/png") }));
  };
  const signatureClear = () => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState((p) => ({ ...p, signatureDataUrl: null }));
  };

  /** ------- Lock / Unlock ------- */
  const lockPeriod = () => {
    setState((p) =>
      p.lockedPeriodIds.includes(selectedPeriod.id) ? p : { ...p, lockedPeriodIds: [...p.lockedPeriodIds, selectedPeriod.id] }
    );
  };
  const unlockAdmin = () => {
    const pass = window.prompt("Admin password:");
    if (pass !== ADMIN_PASSWORD) return alert("Wrong password.");
    setState((p) => ({ ...p, lockedPeriodIds: p.lockedPeriodIds.filter((id) => id !== selectedPeriod.id) }));
  };

  /** ------- PDF (boxed template, NO rates/pay) ------- */
  const buildPdfArrayBuffer = (): ArrayBuffer => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    const contentW = pageW - margin * 2;

    const safe = (s: string) => trim1(String(s || "")).replace(/[^\x09\x0A\x0D\x20-\x7E€]/g, " ");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Timesheet", margin, 46);

    const headerTop = 60;
    const headerH = 84;
    doc.setDrawColor(200);
    doc.rect(margin, headerTop, contentW, headerH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const leftX = margin + 12;
    const rightX = margin + contentW - 190;

    doc.text(`Period: ${safe(selectedPeriod.label)}`, leftX, headerTop + 22);
    doc.text(`Invoice date: ${safe(selectedPeriod.invoiceDateISO)}`, leftX, headerTop + 38);
    doc.text(`Submitted by: ${safe(state.loginEmail || "-")}`, leftX, headerTop + 54);
    doc.text(`Name: ${safe(state.loginName || "-")}`, leftX, headerTop + 70);

    doc.setFont("helvetica", "bold");
    doc.text(`Total hours: ${totals.hours.toFixed(2)}`, rightX, headerTop + 22);
    doc.text(`Total expenses: € ${totals.expenses.toFixed(2)}`, rightX, headerTop + 38);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${format(new Date(), "Pp")}`, rightX, headerTop + 56);

    let y = headerTop + headerH + 26;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Entries (Selected Period)", margin, y);
    y += 14;

    const tableX = margin;
    const tableW = contentW;

    const cols = [
      { label: "Date", w: 70 },
      { label: "Work type", w: 190 },
      { label: "Vessel", w: 80 },
      { label: "Location", w: 80 },
      { label: "Hours", w: 52 },
      { label: "SW", w: 58 },
      { label: "Expenses", w: 78 },
      { label: "Expense note", w: 90 },
      { label: "Work note", w: 90 },
    ];

    const sumW = cols.reduce((a, c) => a + c.w, 0);
    const scale = tableW / sumW;
    cols.forEach((c) => (c.w = Math.floor(c.w * scale)));

    const headerRowH = 20;
    const baseRowH = 18;
    const pad = 3;

    doc.setDrawColor(210);
    doc.setFillColor(245, 245, 245);
    doc.rect(tableX, y, tableW, headerRowH, "F");
    doc.rect(tableX, y, tableW, headerRowH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);

    let cx = tableX;
    for (const c of cols) {
      doc.rect(cx, y, c.w, headerRowH);
      doc.text(c.label, cx + pad, y + 13);
      cx += c.w;
    }
    y += headerRowH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const rowMaxLines = 3;

    for (const e of periodEntries) {
      const vessel = safe(trim1(e.vesselManual || e.vesselPreset) || "-");
      const loc = safe(trim1(e.location) || "-");
      const work = safe(e.workType);
      const sw = safe(trim1(e.serviceWorker) || "-");
      const hours = safe(String(round2(e.hours)));

      const expSum = round2((e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0));
      const exp = `€ ${expSum.toFixed(2)}`;

      const expNoteRaw = (e.expenses || [])
        .map((x) => {
          const note = trim1(x.note);
          return note ? `${x.type}:${note}` : `${x.type}`;
        })
        .join(" | ");
      const expNote = safe(expNoteRaw || "-");

      const workNote = safe(trim1(e.workDone) || "-");

      const cells = [safe(e.dateISO), work, vessel, loc, hours, sw, exp, expNote, workNote];

      const cellLines: string[][] = [];
      let maxLines = 1;

      for (let i = 0; i < cols.length; i++) {
        const lines = doc.splitTextToSize(cells[i], cols[i].w - pad * 2).slice(0, rowMaxLines);
        cellLines.push(lines);
        maxLines = Math.max(maxLines, lines.length);
      }

      const rowH = Math.max(baseRowH, 10 * maxLines + 6);

      if (y + rowH + 140 > pageH) {
        doc.addPage();
        y = margin + 30;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Entries (Selected Period)", margin, y);
        y += 14;

        doc.setDrawColor(210);
        doc.setFillColor(245, 245, 245);
        doc.rect(tableX, y, tableW, headerRowH, "F");
        doc.rect(tableX, y, tableW, headerRowH);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);

        cx = tableX;
        for (const c of cols) {
          doc.rect(cx, y, c.w, headerRowH);
          doc.text(c.label, cx + pad, y + 13);
          cx += c.w;
        }
        y += headerRowH;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
      }

      cx = tableX;
      doc.setDrawColor(220);
      doc.rect(tableX, y, tableW, rowH);

      for (let i = 0; i < cols.length; i++) {
        doc.rect(cx, y, cols[i].w, rowH);
        const lines = cellLines[i];
        for (let li = 0; li < lines.length; li++) {
          doc.text(lines[li], cx + pad, y + 12 + li * 10);
        }
        cx += cols[i].w;
      }

      y += rowH;
    }

    y += 22;
    if (y + 110 > pageH) {
      doc.addPage();
      y = margin + 30;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Totals", margin, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Hours: ${totals.hours.toFixed(2)}`, margin, y);
    y += 14;
    doc.text(`Expenses: € ${totals.expenses.toFixed(2)}`, margin, y);

    const sigBoxW = 200;
    const sigBoxH = 90;
    const sigX = pageW - margin - sigBoxW;
    const sigY = y - 24;

    doc.setFont("helvetica", "bold");
    doc.text("Signature", sigX, sigY - 8);
    doc.setDrawColor(200);
    doc.rect(sigX, sigY, sigBoxW, sigBoxH);

    if (state.signatureDataUrl) {
      try {
        doc.addImage(state.signatureDataUrl, "PNG", sigX + 10, sigY + 12, sigBoxW - 20, sigBoxH - 24);
      } catch {}
    }

    return doc.output("arraybuffer") as ArrayBuffer;
  };

  /** ------- EMAIL SEND (Vercel API) ------- */
  const sendToCollectorEmail = async (pdfArrayBuffer: ArrayBuffer) => {
    const payload = {
      to: COLLECTOR_EMAIL,
      submittedBy: normalizeEmail(state.loginEmail),
      name: trim1(state.loginName),
      period: selectedPeriod,
      totals,
      entries: periodEntries,
      pdfBase64: arrayBufferToBase64(pdfArrayBuffer),
      pdfFileName: `WindPro_TimeSheet_${selectedPeriod.id}.pdf`,
    };

    const res = await fetch("/api/send-timesheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Email failed: ${res.status} ${t}`);
    }
  };

  /** ------- Copy colleague (local) ------- */
  const copyMyColleague = () => {
    setSubmitMenuOpen(false);

    const email = normalizeEmail(window.prompt("Colleague email:", COLLECTOR_EMAIL) || "");
    if (!email) return;

    // copy selected period entries only
    const periodOnly: Record<string, DayEntry> = {};
    for (const [dateISO, entry] of Object.entries(state.entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) {
        periodOnly[dateISO] = JSON.parse(JSON.stringify(entry));
      }
    }

    setState((prev) => {
      const users = { ...prev.users };
      if (!users[email]) users[email] = { entries: {}, signatureDataUrl: null };
      users[email] = { ...users[email], entries: { ...users[email].entries, ...periodOnly } };

      const colleagues = prev.colleagues.includes(email) ? prev.colleagues : [...prev.colleagues, email];

      return { ...prev, users, colleagues };
    });

    alert(`Copied this period → ${email} (local).`);
  };

  /** ------- SUBMIT MENU ACTIONS ------- */
  const submitExportLockAndEmail = async () => {
    setSubmitMenuOpen(false);

    const em = normalizeEmail(state.loginEmail);
    if (!em) return alert("Bagă Login email.");
    if (!trim1(state.loginName)) return alert("Bagă și Name.");
    if (isLocked) return alert("Perioada e locked.");

    setSending(true);
    try {
      const pdfBuf = buildPdfArrayBuffer();

      // download PDF local
      const blob = new Blob([pdfBuf], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WindPro_TimeSheet_${selectedPeriod.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // send email
      await sendToCollectorEmail(pdfBuf);

      // lock
      lockPeriod();

      alert("Submit OK ✅ PDF generated + sent to collector email.");
    } catch (e: any) {
      alert(`Eroare la trimitere email: ${e?.message || e}`);
    } finally {
      setSending(false);
    }
  };

  const enterCopyDayMode = () => {
    setSubmitMenuOpen(false);
    if (isLocked) return;
    setCopyDayMode(true); // stays ON until Cancel
  };

  /** ------- Calendar day click (Copy mode persistent) ------- */
  const onCalendarPick = (targetISO: string) => {
    if (copyDayMode) {
      if (isLocked) return;

      setState((prev) => {
        const srcISO = prev.selectedDateISO;
        const src = prev.entries[srcISO] || makeDefaultEntry(srcISO);
        const copied: DayEntry = { ...JSON.parse(JSON.stringify(src)), dateISO: targetISO };
        return { ...prev, entries: { ...prev.entries, [targetISO]: copied }, selectedDateISO: targetISO };
      });

      // IMPORTANT: NU iesim din copy mode -> poti selecta mai multe zile
      return;
    }

    setState((p) => ({ ...p, selectedDateISO: targetISO }));
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        Submit = export + lock + send email to <b>{COLLECTOR_EMAIL}</b>. Unlock = admin.
      </div>

      {/* TOP BAR */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "420px 1fr auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
        }}
      >
        {/* Email + Name under */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Login email:</div>
            <input
              value={state.loginEmail}
              onChange={(e) => setState((p) => ({ ...p, loginEmail: e.target.value }))}
              placeholder="ex: borot@windpro.pl"
              style={{ padding: 10, borderRadius: 12, border: "2px solid #111" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Name:</div>
            <input
              value={state.loginName}
              onChange={(e) => setState((p) => ({ ...p, loginName: e.target.value }))}
              placeholder="ex: Bogdan Rotariu"
              style={{ padding: 10, borderRadius: 12, border: "2px solid #111" }}
            />
          </div>
        </div>

        {/* Period */}
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodId}
            onChange={(e) => setState((p) => ({ ...p, selectedPeriodId: e.target.value }))}
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", maxWidth: 360 }}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Submit dropdown */}
        <div ref={submitMenuRef} style={{ position: "relative", justifySelf: "end" }}>
          <button onClick={() => setSubmitMenuOpen((v) => !v)} style={btnGreen} disabled={sending}>
            {sending ? "Sending..." : "Submit ▾"}
          </button>

          {submitMenuOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 8px)",
                width: 300,
                background: "white",
                border: "1px solid #e6e6e6",
                borderRadius: 12,
                boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
                overflow: "hidden",
                zIndex: 50,
              }}
            >
              <MenuItem onClick={submitExportLockAndEmail}>Submit (Export + Lock + Email)</MenuItem>
              <MenuItem onClick={enterCopyDayMode}>Copy my day (multi-select)</MenuItem>
              <MenuItem onClick={copyMyColleague}>Copy my colleague (period)</MenuItem>

              <div style={{ padding: 10, borderTop: "1px solid #eee", fontSize: 12, opacity: 0.75 }}>
                Sends to: <b>{COLLECTOR_EMAIL}</b>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={selectedPeriod.label}>
          <div>
            {selectedPeriod.startISO} → {selectedPeriod.endISO} | Invoice {selectedPeriod.invoiceDateISO}
          </div>
          <div style={{ marginTop: 6, color: isLocked ? "#b55" : "#1f5eff", fontWeight: 700 }}>
            {isLocked ? "Locked" : "Editable"}
          </div>
        </Card>
        <Card title="Hours (period)" big={totals.hours.toFixed(2)} />
        <Card title="Expenses (period)" big={`€ ${totals.expenses.toFixed(2)}`} />
      </div>

      {/* Main */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
        {/* LEFT: Calendar + Signature */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{monthLabel}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setState((p) => ({ ...p, selectedDateISO: format(subMonths(selectedDate, 1), "yyyy-MM-dd") }))} style={iconBtn}>
                ‹
              </button>
              <button onClick={() => setState((p) => ({ ...p, selectedDateISO: format(addMonths(selectedDate, 1), "yyyy-MM-dd") }))} style={iconBtn}>
                ›
              </button>
            </div>
          </div>

          {copyDayMode && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                border: "1px solid #ffe0a3",
                background: "#fff7e6",
                fontWeight: 900,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span>Copy mode ON: click multiple days to paste. (Cancel to stop)</span>
              <button onClick={() => setCopyDayMode(false)} style={{ ...smallBtn, padding: "8px 10px" }}>
                Cancel
              </button>
            </div>
          )}

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
              const isSelected = iso === state.selectedDateISO;
              const saved = savedDatesInMonth.has(iso);

              return (
                <button
                  key={iso}
                  onClick={() => onCalendarPick(iso)}
                  style={{
                    height: 44,
                    borderRadius: 999,
                    border: isSelected ? "3px solid #1f5eff" : "1px solid transparent",
                    background: "white",
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
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={isLocked}>
                Clear
              </button>
              <button onClick={unlockAdmin} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }}>
                Unlock (Admin)
              </button>
            </div>

            <canvas
              width={360}
              height={150}
              ref={canvasRef}
              onPointerDown={sigPointerDown}
              onPointerMove={sigPointerMove}
              onPointerUp={sigPointerUp}
              onPointerLeave={sigPointerUp}
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

        {/* RIGHT: Day editor */}
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

            <button onClick={clearDay} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} disabled={isLocked}>
              Clear day
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Work</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
              <label>
                <div style={lbl}>Work type</div>
                <select value={currentEntry.workType} disabled={isLocked} onChange={(e) => setEntry({ workType: e.target.value as WorkType })} style={input}>
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={lbl}>Hours</div>
                <input value={currentEntry.hours} disabled={isLocked} onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0) })} type="number" min={0} step="0.25" style={input} />
              </label>
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

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Work note</div>
              <input value={currentEntry.workDone} disabled={isLocked} onChange={(e) => setEntry({ workDone: e.target.value })} placeholder="GBX exchange / HV test / torque check..." style={input} />
            </label>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Comment</div>
              <input value={currentEntry.comment} disabled={isLocked} onChange={(e) => setEntry({ comment: e.target.value })} placeholder="notes..." style={input} />
            </label>

            {/* Expenses */}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Expenses</div>
                <button onClick={addExpense} style={smallBtn} disabled={isLocked}>
                  + Add
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {(currentEntry.expenses || []).map((ex) => (
                  <div key={ex.id} style={{ display: "grid", gridTemplateColumns: "220px 140px 1fr 80px", gap: 10, alignItems: "center" }}>
                    <select value={ex.type} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { type: e.target.value as ExpenseType })} style={input}>
                      {EXP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <input type="number" min={0} step="0.01" value={ex.amount} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { amount: clampNum(e.target.value, 0) })} style={input} placeholder="Amount" />

                    <input value={ex.note} disabled={isLocked} onChange={(e) => updateExpense(ex.id, { note: e.target.value })} style={input} placeholder="note..." />

                    <button onClick={() => removeExpense(ex.id)} style={{ ...smallBtn, borderColor: "#eee" }} disabled={isLocked}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Vessel */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Jack-up</div>

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
                  <div />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <label>
                    <div style={lbl}>Vessel (preset)</div>
                    <select
                      value={currentEntry.vesselPreset}
                      disabled={isLocked}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEntry({ vesselPreset: v, vesselManual: trim1(currentEntry.vesselManual) ? currentEntry.vesselManual : v });
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

                  <label>
                    <div style={lbl}>Vessel (manual)</div>
                    <input value={currentEntry.vesselManual} disabled={isLocked} onChange={(e) => setEntry({ vesselManual: e.target.value })} placeholder="ex: Blue Tern" style={input} />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {isLocked && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>
              This month is locked. Use Unlock (Admin) to edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
