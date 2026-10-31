/** True when a watched investigation has never been checked or its interval has elapsed. */
export const isDue = (lastIso: string | null | undefined, hours: number, now: number) =>
  hours > 0 && (!lastIso || now - Date.parse(lastIso) >= hours * 3_600_000);
