/**
 * An N sewn from one thread: solid for the work done, stitches for the work left, and the
 * needle in rani pink where they meet. The same idea as every progress line in the app.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 27V6L24.5 25" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 19.5V5" stroke="#f0b429" strokeWidth="3.2" strokeLinecap="round" strokeDasharray="3.4 4.4" />
      <circle cx="26" cy="26" r="3.2" fill="#e0348c" />
    </svg>
  );
}

/** Nool is the Tamil word for thread, so the Tamil spelling stays beside the name. */
export function Brand() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <span className="brand-name">Nool</span>
      <span className="brand-tamil" lang="ta">
        நூல்
      </span>
    </span>
  );
}
