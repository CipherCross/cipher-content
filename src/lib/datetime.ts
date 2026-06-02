// scheduled_at is stored UTC; <input type="datetime-local"> works in local
// wall time, so convert both ways at the edges.

export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
