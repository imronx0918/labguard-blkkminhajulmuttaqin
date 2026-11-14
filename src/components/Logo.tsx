export function Logo({ size = 36 }: { size?: number }) {
  // Perisai + monitor komputer + simpul jaringan
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f78c2" /><stop offset="1" stopColor="#1a376e" /></linearGradient>
      </defs>
      <path d="M32 3 7 12.5v17.8C7 45.6 17.6 56.8 32 61c14.4-4.2 25-15.4 25-30.7V12.5Z" fill="url(#lg-shield)" />
      <path d="M32 8.5 12 16v14.3c0 12.4 8.3 21.6 20 25.4 11.7-3.8 20-13 20-25.4V16Z" fill="none" stroke="#a3c4fb" strokeOpacity=".45" strokeWidth="1.4" />
      <rect x="19" y="20" width="26" height="17" rx="2.5" fill="#fff" />
      <rect x="22" y="23" width="20" height="11" rx="1.2" fill="#c9ddff" />
      <path d="M26 31l4-4 3 3 5-5" stroke="#1a376e" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 37v5M24 46h16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="46" r="2.6" fill="#34d399" /><circle cx="40" cy="46" r="2.6" fill="#34d399" /><circle cx="32" cy="42.5" r="2" fill="#fff" />
    </svg>
  );
}
