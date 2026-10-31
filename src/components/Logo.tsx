import React from 'react';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" fill="#14213d" />
        <circle cx="16" cy="16" r="11" stroke="#2457d6" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx="16" cy="16" r="6.5" stroke="#d97706" strokeWidth="1.75" />
        <circle cx="16" cy="16" r="2.5" fill="#ffffff" />
        {/* Rabbit ears */}
        <path d="M12 9 C11.5 5.5, 13 4.5, 14 7" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M20 9 C20.5 5.5, 19 4.5, 18 7" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-bold tracking-tight text-[#14213d] text-lg">
        Rabbit<span className="text-[#2457d6]">Hole</span>
      </span>
    </div>
  );
}

