import assert from "node:assert/strict";
import test from "node:test";
import { nextCalendarRun } from "../src/lib/calendar-schedule";

test("daily runs roll to the next day once the time has passed", () => {
  const morning = new Date(2026, 8, 29, 8, 0);
  const late = new Date(2026, 8, 29, 10, 0);
  assert.equal(nextCalendarRun("daily", "09:30", 0, morning).getDate(), 29);
  assert.equal(nextCalendarRun("daily", "09:30", 0, late).getDate(), 30);
});

test("weekly runs land on the next matching weekday", () => {
  const monday = new Date(2026, 8, 28, 12);
  assert.equal(nextCalendarRun("weekly", "09:00", 1, monday).getDate(), 5);
});

test("invalid times and weekdays are rejected", () => {
  assert.throws(() => nextCalendarRun("daily", "25:00", 0));
  assert.throws(() => nextCalendarRun("weekly", "09:00", 8));
  console.log("CALENDAR_SCHEDULE_REGRESSION_OK");
});
