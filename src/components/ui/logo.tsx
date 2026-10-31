/** Rabbit hole: concentric rings falling into a single point. Same artwork as app/icon.svg. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2457d6" />
      <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2.4" />
      <circle cx="17.2" cy="17.2" r="5.6" fill="none" stroke="#fff" strokeWidth="2.4" />
      <circle cx="18.4" cy="18.4" r="1.9" fill="#d97706" />
    </svg>
  );
}
