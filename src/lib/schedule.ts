// Bulk date-assignment rule engine (spec §6 "Bulk Date Assignment").
// Walks posts in position order and assigns the next valid slot to each.

export type Cadence =
  | { kind: "daily" }
  | { kind: "weekdays" } // Mon–Fri
  | { kind: "everyNDays"; n: number }
  | { kind: "weekly"; weekdays: number[] }; // 0=Sun … 6=Sat

const DEFAULT_TIME = "09:00"; // 09:00 in the user's local tz when none given

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function applyTime(d: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Returns an array of Dates, one per post, in order.
 * `start` is the first slot; subsequent slots follow the cadence.
 */
export function computeSchedule(
  count: number,
  startDate: string, // yyyy-mm-dd
  cadence: Cadence,
  time: string = DEFAULT_TIME,
): Date[] {
  const slots: Date[] = [];
  let cursor = applyTime(new Date(startDate + "T00:00:00"), time);

  const advance = (from: Date): Date => {
    switch (cadence.kind) {
      case "daily":
        return addDays(from, 1);
      case "everyNDays":
        return addDays(from, Math.max(1, cadence.n));
      case "weekdays": {
        let next = addDays(from, 1);
        while (!isWeekday(next)) next = addDays(next, 1);
        return next;
      }
      case "weekly": {
        const days = cadence.weekdays.length ? cadence.weekdays : [from.getDay()];
        let next = addDays(from, 1);
        while (!days.includes(next.getDay())) next = addDays(next, 1);
        return next;
      }
    }
  };

  // Ensure the very first slot is valid for weekday/weekly cadences.
  if (cadence.kind === "weekdays") {
    while (!isWeekday(cursor)) cursor = addDays(cursor, 1);
  } else if (cadence.kind === "weekly" && cadence.weekdays.length) {
    while (!cadence.weekdays.includes(cursor.getDay())) cursor = addDays(cursor, 1);
  }

  for (let i = 0; i < count; i++) {
    slots.push(new Date(cursor));
    cursor = advance(cursor);
  }
  return slots;
}
