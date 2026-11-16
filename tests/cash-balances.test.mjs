import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync("index.html", "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(js, "Inline frontend JavaScript must exist");
assert.doesNotThrow(() => new Function(js));

const start = js.indexOf("function cashCents(");
const end = js.indexOf("function renderManager()", start);
assert.ok(start > 0 && end > start, "Cash summary renderer must exist");

function makeRenderer(data) {
  const elements = {
    cashBalancePeriod: { innerHTML:"", textContent:"" },
    cashBalanceMetrics: { innerHTML:"", textContent:"" },
    cashBalances: { innerHTML:"", textContent:"" }
  };
  const safe = value => String(value??"").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fn = new Function("state", "$", "metric", "longDate", "escapeHtml",
    js.slice(start, end)+"\nreturn {cashCents,cashMoney,renderCashBalances};");
  const renderer = fn(
    { data }, id => elements[id],
    (label,value)=>"<p>"+safe(label)+": "+safe(value)+"</p>",
    iso=>iso.replaceAll("-","."),safe);
  return { ...renderer, elements };
}

const period = {from:"2026-10-26",to:"2026-11-25"};
const sample = [
  {
    employee_code:"123204", display_name:"Тест 1",
    opening_mnt:"16261.00", period_mnt:"-21500.00",
    closing_mnt:"-5239.00", latest_entry_date:"2026-11-16", entry_count:2
  },
  {
    employee_code:"123205", display_name:'Тест <script>alert("x")</script>',
    opening_mnt:"0.00", period_mnt:"5721.50",
    closing_mnt:"5721.50", latest_entry_date:"2026-11-16", entry_count:1
  },
  {
    employee_code:"125826", display_name:"Тест 3",
    opening_mnt:"0.00", period_mnt:"0.00",
    closing_mnt:"0.00", latest_entry_date:null, entry_count:0
  }
];

test("signed cash discrepancies and reversals use exact cents", () => {
  const {cashCents,cashMoney} = makeRenderer({period,cashSummary:sample});
  assert.equal(cashCents("5721.50"),572150n);
  assert.equal(cashCents("-21500.00"),-2150000n);
  assert.equal(cashCents("0.00"),0n);
  assert.equal(cashCents("0.01")+cashCents("0.02"),3n);
  assert.equal(cashMoney(-523900n),"−5,239 ₮");
  assert.ok(cashMoney(572150n).includes("5,721.50"));
});

test("manager summary separates selected-period delta from closing total", () => {
  const {renderCashBalances,elements} = makeRenderer({period,cashSummary:sample});
  renderCashBalances();
  assert.ok(elements.cashBalancePeriod.textContent.includes("2026.11.25"));
  assert.ok(elements.cashBalanceMetrics.innerHTML.includes("Эерэг зөрүүтэй ажилтан: 1 хүн"));
  assert.ok(elements.cashBalanceMetrics.innerHTML.includes("Эерэг зөрүүний нийлбэр"));
  assert.ok(elements.cashBalances.innerHTML.includes("Өмнөх хугацаа"));
  assert.ok(elements.cashBalances.innerHTML.includes("Энэ хугацааны зөрүү"));
  assert.ok(elements.cashBalances.innerHTML.includes("Эцсийн цэвэр дүн"));
  assert.ok(elements.cashBalances.innerHTML.includes("cash-negative"));
  assert.ok(elements.cashBalances.innerHTML.includes("cash-positive"));
  assert.ok(elements.cashBalances.innerHTML.includes("482.50")); // -5239 + 5721.5
  assert.ok(!elements.cashBalances.innerHTML.includes("<script>"));
  assert.ok(elements.cashBalances.innerHTML.includes("&lt;script&gt;"));
});

test("empty branch shows a safe blank state", () => {
  const {renderCashBalances,elements} = makeRenderer({period,cashSummary:[]});
  renderCashBalances();
  assert.match(elements.cashBalances.innerHTML,/бүртгэлтэй ажилтан алга/);
});

test("summary stays manager-only; employees get no cashSummary in API", () => {
  for(const file of ["api/portal.js","supabase/functions/portal/index.ts"]) {
    const api=readFileSync(file,"utf8");
    const from=api.indexOf("async function dashboard(user, month) {");
    const to=api.indexOf("async function handler(",from);
    assert.ok(from>=0&&to>from,file);
    const dashboard=api.slice(from,to);
    assert.ok(dashboard.includes('if (user.access_role === "manager")'),file);
    assert.match(dashboard,/portal_v2_cash_summary/,file);
    const employeePart=dashboard.slice(dashboard.indexOf("  const [shifts, cash] = await Promise.all(["));
    assert.ok(!employeePart.includes("cashSummary"),file);
  }
});
