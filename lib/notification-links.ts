// Where a notification's action takes the person inside the app. The app is one page that switches areas, so a link carries the area as ?module=Name
// (for example /?module=Recruitment); the old calendar reminders use /calendar?eventId=... Pure function, unit tested.
export function notificationModule(actionPath: string | null | undefined, known: string[]): string | null {
  if (!actionPath) return null;
  try {
    const url = new URL(actionPath, "https://app.invalid");
    const wanted = url.searchParams.get("module");
    if (wanted && known.includes(wanted)) return wanted;
    if (url.pathname.startsWith("/calendar")) return "HR Calendar";
  } catch { /* not a usable link */ }
  return null;
}
