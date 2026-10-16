interface IdealGLogoProps {
  size?: number;
  className?: string;
}

export default function IdealGLogo({ size = 36, className = "" }: IdealGLogoProps) {
  return (
    <svg
      aria-label="Genie"
      className={className}
      height={size}
      role="img"
      viewBox="0 0 48 48"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="ideal-g-gradient" x1="8" x2="40" y1="7" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00F2FE" />
          <stop offset="1" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <rect fill="#111A20" height="48" rx="14" width="48" />
      <path
        d="M34.3 11.2 24 6.5 12.8 12 7.2 23.4 12 35.2l11.4 6.3 10.9-5.2 6.2-11.7-10.9-5.5M23.5 24.1h16.8"
        fill="none"
        stroke="url(#ideal-g-gradient)"
        strokeLinecap="square"
        strokeLinejoin="round"
        strokeWidth="4.3"
      />
      <path d="m15 15 8.4 4.2v9.6l8.1 4" fill="none" stroke="#111A20" strokeLinecap="square" strokeLinejoin="round" strokeWidth="7" />
      <path d="m15 15 8.4 4.2v9.6l8.1 4" fill="none" stroke="url(#ideal-g-gradient)" strokeLinecap="square" strokeLinejoin="round" strokeWidth="3.4" />
      <path d="M28 23.8h12.1" fill="none" stroke="#111A20" strokeWidth="7" />
      <path d="M28 23.8h11.5" fill="none" stroke="url(#ideal-g-gradient)" strokeLinecap="square" strokeWidth="3.5" />
    </svg>
  );
}
