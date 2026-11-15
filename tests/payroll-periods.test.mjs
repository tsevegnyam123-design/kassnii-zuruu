import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixture = [
  // month, from, fund days, advance fund days, final fund days
  ["2026-01","2025-12-26",21,11,10],
  ["2026-02","2026-01-26",23,12,11],
  ["2026-03","2026-02-26",20,9,11],
  ["2026-04","2026-03-26",22,12,10],
  ["2026-05","2026-04-26",21,10,11],
  ["2026-06","2026-05-26",23,12,11],
  ["2026-07","2026-06-26",21,8,13],
  ["2026-08","2026-07-26",22,11,11],
  ["2026-09","2026-08-26",23,12,11],
  ["2026-10","2026-09-26",20,10,10],
  ["2026-11","2026-10-26",23,12,11],
  ["2026-12","2026-11-26",22,11,11]
];

function loadBackend(path) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("const payroll2026");
  const end = text.indexOf("function isDate(value)",start);
  assert.ok(start >= 0 && end > start, `Missing monthRange module in ${path}`);
  const module = new Function(
    'const ensure = (ok) => { if (!ok) throw Error("Bad month"); };\n' +
    text.slice(start,end) +
    "\nreturn {monthRange,defaultPeriodMonth};"
  );
  return module();
}

const backends = [
  "supabase/functions/portal/index.ts",
  "api/portal.js"
];

test("both APIs use all 12 specified 2026 payroll cycles, reference fund days, and 7 July exception", () => {
  for (const path of backends) {
    const { monthRange } = loadBackend(path);
    for (const [month,from,fund,advance,final] of fixture) {
      const p=monthRange(month);
      const advanceCutoff=month==="2026-07" ? "07":"10";
      const finalStart=month==="2026-07" ? "08":"11";
      assert.deepEqual({
        from:p.from,to:p.to,next:p.next,
        advanceFrom:p.advanceFrom,advanceTo:p.advanceTo,
        finalFrom:p.finalFrom,finalTo:p.finalTo,
        fundDays:p.fundDays,
        advanceFundDays:p.advanceFundDays,
        finalFundDays:p.finalFundDays
      },{
        from,to:month+"-25",next:month+"-26",
        advanceFrom:from,advanceTo:month+"-"+advanceCutoff,
        finalFrom:month+"-"+finalStart,finalTo:month+"-25",
        fundDays:fund,advanceFundDays:advance,finalFundDays:final
      },`${path}: ${month}`);
      assert.equal(p.advanceFundDays+p.finalFundDays,p.fundDays);
    }
    const future=monthRange("2027-01");
    assert.equal(future.from,"2026-12-26");
    assert.equal(future.advanceTo,"2027-01-10");
    assert.equal(future.fundDays,null);
    assert.throws(()=>monthRange("2026-13"));
    assert.match(readFileSync(path,"utf8"),/Staff: \[1, 2, 3, 4\]/);
  }
});

function loadFrontend() {
  const html=readFileSync("index.html","utf8");
  const match=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  const code=match[1];
  // First validate the actual inline JS syntax without executing DOM handlers.
  assert.doesNotThrow(()=>new Function(code));
  const start=code.indexOf("const $=id=>");
  const end=code.indexOf("function resultTable(",start);
  assert.ok(start>=0&&end>start);
  return new Function(code.slice(start,end) +
    "\nreturn {salaryCalc,payrollDates,roles,setData: d => { state.data=d; }};")();
}

test("employee roster covers every date from previous 26th to current 25th", () => {
  const {payrollDates}=loadFrontend();
  for(const [month,from] of fixture){
    const p={from,to:month+"-25"};
    const days=payrollDates(p);
    assert.equal(days[0],from,month);
    assert.equal(days.at(-1),p.to,month);
    assert.equal(days.length,new Set(days).size,month);
    assert.ok(days.length>=28&&days.length<=32,month);
  }
});

test("Staff Level 1–4 have 1,000,000 MNT base and zero level bonuses", () => {
  const {salaryCalc,roles,setData}=loadFrontend();
  const period={
    from:"2026-10-26",to:"2026-11-25",
    advanceTo:"2026-11-10",fundDays:23
  };
  setData({period,shifts:[
    {employee_code:"555551",work_date:"2026-10-26",approved:true,shift_kind:"morning"},
    {employee_code:"555551",work_date:"2026-11-10",approved:true,shift_kind:"day"},
    {employee_code:"555551",work_date:"2026-11-11",approved:true,shift_kind:"night"},
    {employee_code:"555551",work_date:"2026-11-25",approved:false,shift_kind:"morning"}
  ]});
  for(let level=1;level<=4;level++){
    const employee={employee_code:"555551",salary_role:"Staff",level,
      monthly_norm:176,tax_relief_mnt:12000,advance_mnt:0};
    const p=salaryCalc(employee);
    assert.equal(p.base,1000000);
    assert.equal(p.levelPay,0);
    assert.equal(p.normHours,184);
    assert.equal(p.workedDays,3);
    assert.equal(p.advanceWorkedDays,2);
    assert.equal(p.finalWorkedDays,1);
    assert.equal(roles.Staff.levels[level],0);
  }
});

test("unknown future fund months retain configured norm hours", () => {
  const {salaryCalc,setData}=loadFrontend();
  setData({period:{advanceTo:"2027-01-10",fundDays:null},
    shifts:[{employee_code:"555551",work_date:"2027-01-01",approved:true,shift_kind:"morning"}]});
  const c=salaryCalc({employee_code:"555551",salary_role:"Staff",level:3,
    monthly_norm:176,tax_relief_mnt:12000,advance_mnt:0});
  assert.equal(c.normHours,176);
  assert.equal(c.levelPay,0);
});
