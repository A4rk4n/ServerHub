import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { servers, tasks } from "@/db/schema";
import { sweepTasks } from "@/lib/runtime";
import { nextCalendarRun } from "@/lib/calendar-schedule";
import { scheduledCommand } from "@/lib/scheduled-actions";
import { findMacro, macroConfirmation } from "@/lib/macros";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tid: string }> };

async function load(ctx: Ctx) {
  const { id, tid } = await ctx.params;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, Number(tid)), eq(tasks.serverId, Number(id))));
  return t ?? null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const t=await load(ctx);if(!t)return NextResponse.json({error:"Not found"},{status:404});const [server]=await db.select().from(servers).where(eq(servers.id,t.serverId));if(!server)return NextResponse.json({error:"Server not found"},{status:404});
  const body=(await req.json().catch(()=>null)) as (Partial<typeof t>&{confirmedCommand?:string;scheduledFor?:string})|null;if(body===null||typeof body!=="object")return NextResponse.json({error:"Invalid JSON body"},{status:400});const patch:Record<string,unknown>={};
  if(typeof body.enabled==="boolean")patch.enabled=body.enabled;if(typeof body.name==="string"&&body.name.trim())patch.name=body.name.trim().slice(0,48);
  const type=typeof body.type==="string"?body.type:t.type,payload=typeof body.payload==="string"?body.payload.trim():t.payload;if(["command","broadcast"].includes(type)){let expected:string;try{expected=scheduledCommand(server.gameId,type,payload)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid action"},{status:400})}if(body.confirmedCommand!==expected)return NextResponse.json({error:"Exact command confirmation does not match",command:expected},{status:409});patch.payload=payload;patch.type=type}
  if (type === "macro") {
    const macro = await findMacro(server.id, payload);
    if (!macro) return NextResponse.json({ error: "Pick an existing macro for this server" }, { status: 400 });
    const expected = macroConfirmation(macro);
    if (body.confirmedCommand !== expected) return NextResponse.json({ error: "Exact command confirmation does not match", command: expected }, { status: 409 });
    patch.payload = payload; patch.type = type;
  }
  const kind=["interval","once","daily","weekly"].includes(String(body.scheduleKind))?String(body.scheduleKind):t.scheduleKind,time=typeof body.scheduleTime==="string"?body.scheduleTime:t.scheduleTime,weekday=Number.isInteger(body.scheduleWeekday)?body.scheduleWeekday!:t.scheduleWeekday,interval=typeof body.intervalMin==="number"?Math.min(10080,Math.max(5,Math.round(body.intervalMin))):t.intervalMin;let next:Date|null;
  try{next=kind==="once"?new Date(body.scheduledFor??t.nextRunAt??""):kind==="daily"||kind==="weekly"?nextCalendarRun(kind,time,weekday):new Date(Date.now()+interval*60000)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid schedule"},{status:400})}if(!next||!Number.isFinite(next.getTime()))return NextResponse.json({error:"Invalid next run"},{status:400});Object.assign(patch,{scheduleKind:kind,scheduleTime:time,scheduleWeekday:weekday,intervalMin:interval,nextRunAt:next});if(["run","skip","reschedule"].includes(String(body.missedPolicy)))patch.missedPolicy=body.missedPolicy;
  const [row]=await db.update(tasks).set(patch).where(eq(tasks.id,t.id)).returning();return NextResponse.json({task:row});
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(tasks).where(eq(tasks.id, t.id));
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: Ctx) {
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action === "run") {
    await db.update(tasks).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(tasks.id, t.id));
    await sweepTasks(t.serverId);
    const [fresh] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    return NextResponse.json({ ok: true, task: fresh });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
