// Targeted tests for the task deadline logic in src/lib/format.ts.
// No test framework is installed in this repo — these use node:test.
// Run:  node --experimental-strip-types --test tests/task-due.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTaskDue, isOverdueDue, compareTaskDue, dueInfo, fmtDue, dueTime, taskToday,
} from "../src/lib/format.ts";

const NOW = new Date("2026-09-17T10:00:00Z"); // = 14:00 UAE (UTC+4)

test("timed deadlines are read as UAE wall-clock (UTC+4)", () => {
  assert.equal(parseTaskDue("2026-09-17T09:00")?.getTime(), Date.parse("2026-09-17T05:00:00Z"));
  assert.equal(parseTaskDue("2026-09-17T23:59")?.getTime(), Date.parse("2026-09-17T19:59:00Z"));
});

test("date-only deadlines stay valid through the end of that UAE day", () => {
  assert.equal(parseTaskDue("2026-09-17")?.getTime(), Date.parse("2026-09-17T19:59:59.999Z"));
});

test("overdue respects the exact minute, not the calendar day", () => {
  assert.equal(isOverdueDue("2026-09-17T09:00", NOW), true);
  assert.equal(isOverdueDue("2026-09-17T15:00", NOW), false);
  assert.equal(isOverdueDue("2026-09-17", NOW), false); // date-only → end of day
  assert.equal(isOverdueDue("2026-09-17T13:59", NOW), true); // 13:59 UAE < 14:00 UAE now
  assert.equal(isOverdueDue("2026-09-16", NOW), true);
  assert.equal(isOverdueDue("2026-09-16T23:59", NOW), true);
});

test("invalid deadlines are rejected, not guessed", () => {
  for (const bad of ["", "not-a-date", "2026-13-01", "2026-09-31", "2026-09-17T24:00", "2026-09-17T10:61", "2026-09-17 09:00", null, undefined, 5]) {
    assert.equal(parseTaskDue(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("compareTaskDue orders by instant; unparseable sorts last", () => {
  assert.ok(compareTaskDue("2026-09-17T09:00", "2026-09-17T15:00") < 0);
  assert.ok(compareTaskDue("2026-09-18", "2026-09-17") > 0);
  // 17 Sep (date-only) is due 23:59, so it sorts after any timed task that day
  assert.ok(compareTaskDue("2026-09-18", "2026-09-17T09:00") > 0);
  assert.ok(compareTaskDue("garbage", "2026-09-17") > 0);
  assert.equal(compareTaskDue("garbage", "also-bad"), 0);
});

test("dueInfo: overdue-before-now, today/tomorrow with time, slate beyond 2d", () => {
  assert.deepEqual({ ...dueInfo("2026-09-17T09:00", NOW) }, { label: "overdue · 9:00 AM", tone: "coral", days: 0, overdue: true });
  assert.equal(dueInfo("2026-09-17", NOW).label, "due today");
  assert.equal(dueInfo("2026-09-17", NOW).tone, "amber");
  assert.equal(dueInfo("2026-09-17T15:00", NOW).label, "today · 3:00 PM");
  assert.equal(dueInfo("2026-09-18T09:00", NOW).label, "tomorrow · 9:00 AM");
  assert.equal(dueInfo("2026-09-20T09:00", NOW).label, "due in 3d · 9:00 AM");
  assert.equal(dueInfo("2026-09-20T09:00", NOW).tone, "slate");
});

test("fmtDue / dueTime render 12-hour time; date-only has no time", () => {
  // month rendering differs across ICU versions ("Sep"/"Sept") — check structure
  assert.match(fmtDue("2026-09-17T15:30"), /^17 Se(p|pt) · 3:30 PM$/);
  assert.match(fmtDue("2026-09-17"), /^17 Se(p|pt)$/);
  assert.equal(fmtDue(""), "—");
  assert.equal(dueTime("2026-09-17T00:15"), "12:15 AM");
  assert.equal(dueTime("2026-09-17T12:00"), "12:00 PM");
  assert.equal(dueTime("2026-09-17"), null);
  assert.equal(dueTime("2026-09-17 09:00"), null); // strict format only
});

test("taskToday returns the UAE calendar day", () => {
  assert.equal(taskToday(new Date("2026-09-16T21:00:00Z")), "2026-09-17"); // 01:00 UAE next day
  assert.equal(taskToday(new Date("2026-09-17T19:00:00Z")), "2026-09-17"); // 23:00 UAE
  assert.equal(taskToday(new Date("2026-09-17T19:59:00Z")), "2026-09-17");
  assert.equal(taskToday(new Date("2026-09-17T20:00:00Z")), "2026-09-18"); // 00:00 UAE next day
});
