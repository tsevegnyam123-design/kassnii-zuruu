import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync("index.html","utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "The portal must have an inline JavaScript script");
assert.doesNotThrow(()=>new Function(script));

const start = script.indexOf("function schedule(){");
const end = script.indexOf("function staffSummary(){",start);
assert.ok(start >= 0 && end > start, "Calendar schedule code must be found");
const scheduleSource = script.slice(start,end);

function setup({existingKind="",saveError=false} = {}) {
  const date="2026-11-15",code="125826";
  const data={
    staff:[{employee_code:code,display_name:"Тест ажилтан",salary_role:"Staff",level:1,branch_code:"Салбар"}],
    period:{
      from:date,to:date,advanceFrom:date,advanceTo:date,
      finalFrom:date,finalTo:date
    },
    shifts:existingKind?[{employee_code:code,work_date:date,shift_kind:existingKind,approved:true}]:[]
  };
  const state={data};
  const element={dataset:{emp:code,date},value:existingKind,disabled:false,className:existingKind,
    onChange:null,addEventListener(name,callback){if(name==="change")this.onChange=callback;}};
  const grid={scrollLeft:0,scrollTop:0,renderCount:0,html:"",
    set innerHTML(value){this.html=value;this.renderCount++;this.scrollLeft=0;this.scrollTop=0;},
    get innerHTML(){return this.html;},
    querySelectorAll(){return [element];}};
  const schedulePeriod={textContent:""};
  const els={schedule:grid,schedulePeriod};
  const calls=[],messages=[],summaries=[];
  const api=async(action,payload)=>{
    calls.push({action,payload});
    if(saveError)throw Error("Сервер хадгалсангүй.");
  };
  const escapeHtml=x=>String(x).replace(/[&<>"']/g,"");
  const schedule=new Function("state", "$", "payrollDates", "longDate",
    "shortDate","escapeHtml","shiftNames","api","status","staffSummary",
    scheduleSource+"\nreturn schedule;")(
      state,id=>els[id],()=>[date],
      d=>d,d=>d.slice(5),
      escapeHtml,{morning:"Өглөө",day:"Өдөр",night:"Шөнө"},
      api,(message,type)=>messages.push({message,type}),
      ()=>summaries.push(structuredClone(state.data.shifts))
    );
  schedule();
  assert.equal(grid.renderCount,1);
  grid.scrollLeft=975;grid.scrollTop=63;
  assert.equal(typeof element.onChange,"function");
  return {state,element,grid,calls,messages,summaries};
}

test("successful schedule save keeps horizontal scroll and updates local state",async()=>{
  const ctx=setup();
  ctx.element.value="morning";
  await ctx.element.onChange();
  assert.equal(ctx.grid.scrollLeft,975);
  assert.equal(ctx.grid.scrollTop,63);
  assert.equal(ctx.grid.renderCount,1,"saving must not replace the DOM grid");
  assert.equal(ctx.calls.length,1);
  assert.equal(ctx.calls[0].action,"saveShift");
  assert.equal(ctx.state.data.shifts.length,1);
  assert.deepEqual({
    kind:ctx.state.data.shifts[0].shift_kind,
    approved:ctx.state.data.shifts[0].approved
  },{kind:"morning",approved:true});
  assert.equal(ctx.element.className,"morning");
  assert.equal(ctx.element.disabled,false);
  assert.equal(ctx.summaries.length,1,"salary summary must update");
});

test("editing an existing day shift to a night shift keeps the same scroll position",async()=>{
  const ctx=setup({existingKind:"day"});
  ctx.element.value="night";
  await ctx.element.onChange();
  assert.equal(ctx.grid.scrollLeft,975);
  assert.equal(ctx.grid.renderCount,1);
  assert.equal(ctx.state.data.shifts.length,1);
  assert.equal(ctx.state.data.shifts[0].shift_kind,"night");
  assert.equal(ctx.element.className,"night");
});

test("removing a shift stays in the same column and updates totals",async()=>{
  const ctx=setup({existingKind:"morning"});
  ctx.element.value="";
  await ctx.element.onChange();
  assert.equal(ctx.calls[0].action,"removeShift");
  assert.deepEqual(ctx.state.data.shifts,[]);
  assert.equal(ctx.element.className,"");
  assert.equal(ctx.grid.scrollLeft,975);
  assert.equal(ctx.grid.renderCount,1);
  assert.equal(ctx.summaries.length,1);
});

test("failed save rolls selection back without resetting scroll",async()=>{
  const ctx=setup({existingKind:"day",saveError:true});
  ctx.element.value="night";
  await ctx.element.onChange();
  assert.equal(ctx.grid.scrollLeft,975);
  assert.equal(ctx.grid.renderCount,1);
  assert.equal(ctx.element.value,"day");
  assert.equal(ctx.element.className,"day");
  assert.equal(ctx.element.disabled,false);
  assert.equal(ctx.state.data.shifts[0].shift_kind,"day");
  assert.equal(ctx.summaries.length,0);
  assert.equal(ctx.messages.at(-1).type,"error");
});
