interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ className = "", size = "md", showText = true }: LogoProps) {
  const iconSizes = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  const textSizes = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
  };

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <div
        className={`relative flex items-center justify-center shrink-0 ${iconSizes[size]} drop-shadow-[0_0_12px_rgba(56,189,248,0.4)] transition-transform duration-200 hover:scale-105`}
      >
        <svg viewBox="0 0 128 128" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="navLogoBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="50%" stopColor="#1e1b4b" />
              <stop offset="100%" stopColor="#090d16" />
            </linearGradient>
            <linearGradient id="navLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
          </defs>
          <rect
            x="6"
            y="6"
            width="116"
            height="116"
            rx="28"
            fill="url(#navLogoBg)"
            stroke="url(#navLogoGrad)"
            strokeWidth="3.5"
          />
          <polygon
            points="64,22 98,42 98,86 64,106 30,86 30,42"
            fill="none"
            stroke="url(#navLogoGrad)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            opacity="0.6"
          />
          <path d="M68 26 L40 66 L62 66 L56 102 L88 60 L64 60 Z" fill="url(#navLogoGrad)" />
          <path
            d="M38 48 L38 80 M38 64 L50 64"
            stroke="#ffffff"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
          <path
            d="M78 48 L92 80 M92 48 L78 80"
            stroke="#ffffff"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
          />
          <circle cx="64" cy="64" r="3.5" fill="#38bdf8" />
        </svg>
      </div>
      {showText && (
        <span
          className={`font-bold tracking-tight text-foreground flex items-center font-sans ${textSizes[size]}`}
        >
          Hostera
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 font-extrabold ml-[1px]">
            X
          </span>
        </span>
      )}
    </div>
  );
}
