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
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="idealGGrad" x1="15" y1="15" x2="85" y2="85" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00F2FE" />
          <stop offset="50%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill="#0B1320" />
      <path
        d="M50 12L83 31V69L50 88L17 69V31L50 12Z"
        stroke="url(#idealGGrad)"
        strokeWidth="4.5"
        strokeLinejoin="round"
        opacity="0.35"
      />
      <path
        d="M67 34L50 24L31 35V65L50 76L69 65V51H50"
        stroke="url(#idealGGrad)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="51" r="4.5" fill="#00F2FE" />
    </svg>
  );
}
