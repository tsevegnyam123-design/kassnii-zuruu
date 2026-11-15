// Vercel Node.js endpoint. Private database access; no Google Sheets.
// All authorization is server-side. 4-digit PIN is protected by a 15-min lockout
// after five failures; use HTTPS and never share the service-role key with browsers.
// Supabase Edge Function. Secret key never leaves the server.

const cookieName = "gs25_portal_v2";
const ttlMs = 8 * 60 * 60 * 1000;
const allowedRoles = { BM: [1, 2, 3, 4], SL: [2, 3, 4], Staff: [1, 2, 3, 4] };
const codePattern = /^[0-9]{4,12}$/;
const pinPattern = /^[0-9]{4}$/;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function ensure(value, status, message) {
  if (!value) fail(status, message);
}

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(value = "") {
  return Object.fromEntries(value.split(";").map(s => s.trim().split("=")).filter(x => x.length === 2));
}

function cookie(value, maxAge) {
  return cookieName + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}

// The selected YYYY-MM is the PAYROLL END month, not a calendar-month filter.
// Source: the company's 2026 payroll period table (previous 26th to current 25th).
const payroll2026 = Object.freeze({
  fund: [21,23,20,22,21,23,21,22,23,20,23,22],
  advance: [11,12,9,12,10,12,8,11,12,10,12,11],
  final: [10,11,11,10,11,11,13,11,11,10,11,11]
});
function monthRange(value) {
  ensure(/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value || ""), 400, "Сар буруу байна.");
  const [year, month] = value.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 2, 26)).toISOString().slice(0, 10);
  const to = value + "-25";
  const next = value + "-26"; // exclusive upper bound for PostgREST
  const advanceTo = value + (value === "2026-07" ? "-07" : "-10");
  const finalFrom = value + (value === "2026-07" ? "-08" : "-11");
  const idx = month - 1;
  const isReferenceYear = year === 2026;
  return {
    from, to, next,
    advanceFrom: from, advanceTo,
    finalFrom, finalTo: to,
    fundDays: isReferenceYear ? payroll2026.fund[idx] : null,
    advanceFundDays: isReferenceYear ? payroll2026.advance[idx] : null,
    finalFundDays: isReferenceYear ? payroll2026.final[idx] : null
  };
}
function defaultPeriodMonth() {
  // Default to Ulaanbaatar's local payroll month (26th starts the next cycle).
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = now.getUTCFullYear(), month = now.getUTCMonth(), day = now.getUTCDate();
  const endMonth = new Date(Date.UTC(year, month + (day >= 26 ? 1 : 0), 1));
  return endMonth.toISOString().slice(0, 7);
}

function isDate(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value || "")) return false;
  return !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function inRange(date, range) {
  return date >= range.from && date < range.next;
}

function bodyOf(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { fail(400, "JSON формат буруу байна."); }
  }
  return req.body && typeof req.body === "object" ? req.body : {};
}

function parseResponse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function db(method, path, payload, extras = {}) {
  const host = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  ensure(host && key, 503, "Системийн мэдээллийн сан тохируулаагүй байна.");
  const headers = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(extras.prefer ? { "Prefer": extras.prefer } : {})
  };
  const response = await fetch(host.replace(/\/$/, "") + path, {
    method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: "no-store"
  });
  const raw = await response.text();
  if (!response.ok) {
    console.error("portal database error", response.status, raw.slice(0, 500));
    fail(response.status === 409 ? 409 : 500,
      response.status === 409 ? "Энэ кодтой ажилтан бүртгэлтэй байна." : "Мэдээллийн санд алдаа гарлаа.");
  }
  return parseResponse(raw);
}

function q(value) { return encodeURIComponent(String(value)); }

async function account(code) {
  const rows = await db("GET", "/rest/v1/portal_v2_accounts?select=employee_code,display_name,branch_code,access_role,salary_role,level,monthly_norm,tax_relief_mnt,advance_mnt,is_active&employee_code=eq." + q(code) + "&limit=1");
  return rows?.[0] || null;
}

async function current(req) {
  const raw = String(req.headers["x-portal-session"] || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) fail(401, "Нэвтэрнэ үү.");
  const rows = await db("GET", "/rest/v1/portal_v2_sessions?select=employee_code,expires_at&token_hash=eq." + q(await hash(raw)) + "&limit=1");
  const session = rows?.[0];
  if (!session || Date.parse(session.expires_at) <= Date.now()) fail(401, "Нэвтрэх хугацаа дууссан.");
  const user = await account(session.employee_code);
  if (!user?.is_active) fail(401, "Бүртгэл идэвхгүй байна.");
  return user;
}

function checkManager(user) {
  ensure(user.access_role === "manager", 403, "Менежерийн эрх шаардлагатай.");
}

async function branchEmployee(manager, employeeCode) {
  ensure(codePattern.test(employeeCode || ""), 400, "Ажилтны код буруу байна.");
  const employee = await account(employeeCode);
  ensure(employee && employee.access_role === "employee" &&
    employee.branch_code === manager.branch_code && employee.is_active,
    403, "Энэ салбарын ажилтан биш байна.");
  return employee;
}

async function dashboard(user, month) {
  const range = monthRange(month);
  if (user.access_role === "manager") {
    const staff = await db("GET", "/rest/v1/portal_v2_accounts?select=employee_code,display_name,branch_code,salary_role,level,monthly_norm,tax_relief_mnt,advance_mnt&access_role=eq.employee&is_active=eq.true&branch_code=eq." + q(user.branch_code) + "&order=employee_code.asc");
    const codes = staff.map(x => x.employee_code);
    const ids = codes.length ? "&employee_code=in.(" + codes.map(q).join(",") + ")" : "&employee_code=eq.__none__";
    const [shifts, cash] = await Promise.all([
      db("GET", "/rest/v1/portal_v2_shifts?select=employee_code,work_date,shift_kind,approved&work_date=gte." + range.from + "&work_date=lt." + range.next + ids + "&order=work_date.asc"),
      db("GET", "/rest/v1/portal_v2_cash?select=id,employee_code,business_date,amount_mnt,explanation,entered_by,created_at&business_date=gte." + range.from + "&business_date=lt." + range.next + ids + "&order=created_at.desc")
    ]);
    return { user, staff, shifts, cash, month, period: range };
  }
  const [shifts, cash] = await Promise.all([
    db("GET", "/rest/v1/portal_v2_shifts?select=employee_code,work_date,shift_kind,approved&employee_code=eq." + q(user.employee_code) + "&work_date=gte." + range.from + "&work_date=lt." + range.next + "&order=work_date.asc"),
    db("GET", "/rest/v1/portal_v2_cash?select=id,employee_code,business_date,amount_mnt,explanation,created_at&employee_code=eq." + q(user.employee_code) + "&business_date=gte." + range.from + "&business_date=lt." + range.next + "&order=created_at.desc")
  ]);
  return { user, staff: [], shifts, cash, month, period: range };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const action = String(req.query.action || "");
  try {
    if (req.method !== "GET" && req.method !== "POST") fail(405, "Арга дэмжигдэхгүй.");
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try { host = new URL(origin).host; } catch { fail(403, "Хүсэлт зөвшөөрөгдөөгүй."); }
        ensure(host === req.headers.host, 403, "Хүсэлт зөвшөөрөгдөөгүй.");
      }
      ensure(req.headers["sec-fetch-site"] !== "cross-site", 403, "Хүсэлт зөвшөөрөгдөөгүй.");
      ensure(Number(req.headers["content-length"] || 0) <= 12000, 413, "Хэт их мэдээлэл.");
    }
    const data = bodyOf(req);
    if (action === "login" && req.method === "POST") {
      const code = String(data.code || "").trim();
      const pin = String(data.pin || "");
      ensure(codePattern.test(code) && pinPattern.test(pin), 401, "Код эсвэл PIN буруу байна.");
      const matched = await db("POST", "/rest/v1/rpc/portal_v2_authenticate", { p_code: code, p_pin: pin });
      ensure(matched === code, 401, "Код эсвэл PIN буруу эсвэл түр түгжигдсэн байна.");
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const raw = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      await db("POST", "/rest/v1/portal_v2_sessions", {
        token_hash: await hash(raw),
        employee_code: code,
        expires_at: new Date(Date.now() + ttlMs).toISOString()
      });
      return res.status(200).json({ ok: true, session: raw });
    }

    if (action === "logout" && req.method === "POST") {
      const raw = String(req.headers["x-portal-session"] || "");
      if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
        await db("DELETE", "/rest/v1/portal_v2_sessions?token_hash=eq." + q(await hash(raw)));
      }
      
      return res.status(200).json({ ok: true });
    }

    const user = await current(req);

    if (action === "dashboard" && req.method === "GET") {
      const month = String(req.query.month || defaultPeriodMonth());
      return res.status(200).json(await dashboard(user, month));
    }

    checkManager(user);
    ensure(req.method === "POST", 405, "Арга дэмжигдэхгүй.");

    if (action === "createEmployee") {
      const code = String(data.code || "").trim();
      const pin = String(data.pin || "");
      const name = String(data.name || "").trim();
      const role = String(data.role || "");
      const level = Number(data.level);
      ensure(codePattern.test(code) && pinPattern.test(pin) &&
        name.length >= 1 && name.length <= 120 &&
        allowedRoles[role]?.includes(level), 400, "Ажилтны бүртгэл буруу байна.");
      await db("POST", "/rest/v1/rpc/portal_v2_create_employee", {
        p_code: code, p_pin: pin, p_name: name,
        p_branch: user.branch_code, p_salary_role: role, p_level: level
      });
      return res.status(201).json({ ok: true });
    }

    if (action === "resetPin") {
      const code = String(data.code || "");
      const pin = String(data.pin || "");
      await branchEmployee(user, code);
      ensure(pinPattern.test(pin), 400, "PIN нь яг 4 оронтой тоо байна.");
      await db("POST", "/rest/v1/rpc/portal_v2_reset_pin", { p_code: code, p_pin: pin });
      return res.status(200).json({ ok: true });
    }

    if (action === "saveShift" || action === "removeShift") {
      const code = String(data.code || "");
      const date = String(data.date || "");
      await branchEmployee(user, code);
      ensure(isDate(date), 400, "Огноо буруу байна.");
      if (action === "removeShift") {
        await db("DELETE", "/rest/v1/portal_v2_shifts?employee_code=eq." + q(code) + "&work_date=eq." + q(date));
      } else {
        const kind = String(data.kind || "");
        const approved = data.approved === true;
        ensure(["morning", "day", "night"].includes(kind), 400, "Ээлж буруу байна.");
        await db("POST", "/rest/v1/portal_v2_shifts?on_conflict=employee_code,work_date", {
          employee_code: code, work_date: date, shift_kind: kind, approved,
          approved_by: approved ? user.employee_code : null,
          approved_at: approved ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        }, { prefer: "resolution=merge-duplicates,return=minimal" });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === "addCash") {
      const code = String(data.code || "");
      const date = String(data.date || "");
      const note = String(data.note || "").trim();
      const amount = Number(data.amount);
      await branchEmployee(user, code);
      ensure(isDate(date) && Number.isFinite(amount) && amount !== 0 &&
        Math.abs(amount) <= 100000000 && note.length >= 3 && note.length <= 1000,
        400, "Кассын зөрүүний дүн, огноо, тайлбарыг шалгана уу.");
      await db("POST", "/rest/v1/portal_v2_cash", {
        employee_code: code, business_date: date, amount_mnt: amount,
        explanation: note, entered_by: user.employee_code
      });
      return res.status(201).json({ ok: true });
    }

    fail(404, "Үйлдэл олдсонгүй.");
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("portal API", error);
    return res.status(status).json({ error: status >= 500 ? "Серверийн алдаа. Дахин оролдоно уу." : error.message });
  }
}


const ALLOWED_ORIGINS = new Set([
  "https://tsevegnyam123-design.github.io",
  "https://gs25-employee-portal.vercel.app",
  "https://gs25-employee-portal-gs-portal.vercel.app"
]);

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://tsevegnyam123-design.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-portal-session",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403 });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!["GET","POST"].includes(request.method)) {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
  }
  if (Number(request.headers.get("content-length") || 0) > 12000) {
    return new Response(JSON.stringify({ error: "Request too large." }), { status: 413, headers });
  }
  let body = {};
  if (request.method === "POST") {
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch {
      return new Response(JSON.stringify({ error: "JSON body expected." }), { status: 400, headers });
    }
  }
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const req = {
    method: request.method,
    query: params,
    body,
    headers: {
      "x-portal-session": request.headers.get("x-portal-session") || "",
      "origin": "",
      "host": "",
      "sec-fetch-site": "same-origin",
      "content-length": request.headers.get("content-length") || "0"
    }
  };
  const res = {
    setHeader(name, value) { headers.set(name, value); },
    status(status) {
      return {
        json(value) { return new Response(JSON.stringify(value), { status, headers }); }
      };
    }
  };
  try {
    return await handler(req, res);
  } catch (error) {
    console.error("portal function wrapper", error);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
  }
});
