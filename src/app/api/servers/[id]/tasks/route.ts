import { NextResponse } from "next/server";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { servers, taskRuns, tasks } from "@/db/schema";
import { nextCalendarRun } from "@/lib/calendar-schedule";
import { scheduledCommand } from "@/lib/scheduled-actions";
import { findMacro, macroConfirmation } from "@/lib/macros";

export const dynamic = "force-dynamic";

const TYPES = ["restart", "backup", "prune", "maintenance", "update", "command", "broadcast", "macro"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(tasks).where(eq(tasks.serverId, s.id)).orderBy(asc(tasks.id));
  const runs=await db.select().from(taskRuns).where(eq(taskRuns.serverId,s.id)).orderBy(desc(taskRuns.createdAt)).limit(100);
  return NextResponse.json({ tasks: rows, runs });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { name?: string; type?: string; payload?: string; intervalMin?: number; confirmedCommand?: string; scheduleKind?: string; scheduledFor?: string; scheduleTime?: string; scheduleWeekday?: number; missedPolicy?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const type = TYPES.includes(body.type ?? "") ? body.type! : "command";
  if ((type === "command" || type === "broadcast") && !body.payload?.trim()) return NextResponse.json({ error: "This task type needs a payload (command / message)" }, { status: 400 });
  if(type === "command" || type === "broadcast"){let expected:string;try{expected=scheduledCommand(s.gameId,type,body.payload??"")}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid scheduled action"},{status:400})}if(body.confirmedCommand!==expected)return NextResponse.json({error:"Exact command confirmation does not match",command:expected},{status:409});}
  if (type === "macro") {
    const macro = await findMacro(s.id, body.payload?.trim() ?? "");
    if (!macro) return NextResponse.json({ error: "Pick an existing macro for this server" }, { status: 400 });
    const expected = macroConfirmation(macro);
    if (body.confirmedCommand !== expected) return NextResponse.json({ error: "Exact command confirmation does not match", command: expected }, { status: 409 });
  }
  const missedPolicy=["run","skip","reschedule"].includes(body.missedPolicy??"")?body.missedPolicy!:"run";
  const scheduleKind=["once","daily","weekly"].includes(body.scheduleKind??"")?body.scheduleKind!:"interval";
  const intervalMin = Math.min(10080, Math.max(5, Math.round(Number(body.intervalMin ?? 360))));
  const scheduledFor=body.scheduledFor?new Date(body.scheduledFor):null;const scheduleTime=body.scheduleTime??"09:00",scheduleWeekday=Math.round(Number(body.scheduleWeekday??1));let calendarNext:Date|null=null;if(scheduleKind==="daily"||scheduleKind==="weekly"){try{calendarNext=nextCalendarRun(scheduleKind,scheduleTime,scheduleWeekday)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid calendar schedule"},{status:400})}}if(scheduleKind==="once"&&(!scheduledFor||!Number.isFinite(scheduledFor.getTime())||scheduledFor.getTime()<Date.now()+30_000))return NextResponse.json({error:"One-time action must be at least 30 seconds in the future"},{status:400});
  const [row] = await db
    .insert(tasks)
    .values({
      serverId: s.id,
      name,
      type,
      payload: body.payload?.trim() ?? "",
      intervalMin,
      scheduleKind,scheduleTime,scheduleWeekday,missedPolicy,
      nextRunAt: scheduleKind==="once"?scheduledFor!:calendarNext??new Date(Date.now() + intervalMin * 60000),
    })
    .returning();
  return NextResponse.json({ task: row }, { status: 201 });
}

export async function DELETE(req:Request,ctx:{params:Promise<{id:string}>}){const {id}=await ctx.params;const serverId=Number(id);const [server]=await db.select().from(servers).where(eq(servers.id,serverId));if(!server)return NextResponse.json({error:"Not found"},{status:404});const days=Math.min(3650,Math.max(1,Math.round(Number(new URL(req.url).searchParams.get("olderThanDays")??30))));const cutoff=new Date(Date.now()-days*86400000);const removed=await db.delete(taskRuns).where(and(eq(taskRuns.serverId,serverId),lt(taskRuns.createdAt,cutoff))).returning({id:taskRuns.id});return NextResponse.json({ok:true,removed:removed.length,cutoff})}
