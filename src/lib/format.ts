const LOCALE = "ar-u-nu-latn";

export function formatDateTime(d: Date | string | null | undefined, timeZone = "UTC") {
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}

export function formatDate(d: Date | string, timeZone = "UTC") {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date(d));
}

/** YYYY-MM-DD of an instant in a time zone. */
export function dayKey(d: Date, timeZone = "UTC") {
  const p = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

function tzOffsetMs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - instant;
}

/** Convert a `datetime-local` value (wall clock in `timeZone`) to a UTC Date. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = wall - tzOffsetMs(wall, timeZone);
  guess = wall - tzOffsetMs(guess, timeZone);
  return new Date(guess);
}

/** Inverse of zonedLocalToUtc, for pre-filling inputs. */
export function utcToZonedLocal(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + tzOffsetMs(d.getTime(), timeZone));
  return shifted.toISOString().slice(0, 16);
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")} دقيقة` : `${s} ثانية`;
}

export function formatUsd(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return n === 0 ? "$0" : `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
}
