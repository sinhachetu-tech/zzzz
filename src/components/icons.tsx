// HFMC SVG icon set — ported verbatim from the original smallhfmc.
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function make(node: ReactNode) {
  return function Icon({ size = 18, className = "", strokeWidth = 1.8 }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {node}
      </svg>
    );
  };
}

export const LogoMark = ({ size = 26, className = "" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#F2B04C" fillOpacity="0.12" stroke="#F2B04C" strokeOpacity="0.4" />
    <path d="M7 16h4l3-7 4 14 3-7h4" stroke="#F2B04C" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IGrid = make(<><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></>);
export const IBriefcase = make(<><rect x="3" y="7.5" width="18" height="13" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" /><path d="M3 13h18" /></>);
export const ITasks = make(<><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></>);
export const IChart = make(<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M7 15v-4" /><path d="M11.5 15V7" /><path d="M16 15v-6.5" /></>);
export const IShield = make(<><path d="M12 3 5 5.8v5.4c0 4.3 3 7.9 7 9.3 4-1.4 7-5 7-9.3V5.8L12 3Z" /><path d="m9.3 11.8 1.9 1.9 3.6-3.9" /></>);
export const ILogout = make(<><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>);
export const IPlus = make(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-3.8-3.8" /></>);
export const IX = make(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>);
export const ICheck = make(<path d="m4.5 12.5 5 5 10-11" />);
export const IClock = make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IAlert = make(<><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5" /><path d="M12 17.5v.2" /></>);
export const IUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /><path d="M16 5.2a3.5 3.5 0 0 1 0 5.6" /><path d="M18.5 14.9c1.7.9 2.7 2.7 3 5.1" /></>);
export const IChevronL = make(<path d="m14.5 5.5-6.5 6.5 6.5 6.5" />);
export const IChevronR = make(<path d="m9.5 5.5 6.5 6.5-6.5 6.5" />);
export const IPencil = make(<><path d="M14.5 5 19 9.5 8 20.5l-5 1 1-5L14.5 5Z" /><path d="m12.5 7 4.5 4.5" /></>);
export const ITrash = make(<><path d="M4 6.5h16" /><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" /><path d="M6 6.5 7 20a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13.5" /><path d="M10 10.5v6M14 10.5v6" /></>);
export const IDownload = make(<><path d="M12 3.5V15" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4.5 20.5h15" /></>);
export const ICalendar = make(<><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17" /><path d="M8 3v4M16 3v4" /></>);
export const IBank = make(<><path d="m3 9 9-5.5L21 9H3Z" /><path d="M5 9v8M9.7 9v8M14.3 9v8M19 9v8" /><path d="M3.5 20.5h17" /></>);
export const IArrowR = make(<><path d="M4 12h16" /><path d="m13.5 5.5 6.5 6.5-6.5 6.5" /></>);
export const IHistory = make(<><path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" /><path d="M3.5 12H7M3.5 12V8.5" /><path d="M12 7.5V12l3.2 2.2" /></>);
export const IFlag = make(<><path d="M5 21V4" /><path d="M5 4.5c2.2-1.4 4.3-1.4 6.5 0s4.3 1.4 6.5 0v9c-2.2 1.4-4.3 1.4-6.5 0s-4.3-1.4-6.5 0" /></>);
export const IEye = make(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const IFilter = make(<path d="M4 5h16l-6.2 7.4v5.1L10.2 19v-6.6L4 5Z" />);
export const IInbox = make(<><path d="M21 13.5h-5l-1.5 2.5h-5L8 13.5H3" /><path d="M5.2 5.6 3 13.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4.5l-2.2-7.9A2 2 0 0 0 16.9 4H7.1a2 2 0 0 0-1.9 1.6Z" /></>);
export const IZap = make(<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />);
export const ISun = make(<><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" /></>);
export const IMoon = make(<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />);
export const IWhatsapp = ({ size = 18, className = "" }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2.1A9.9 9.9 0 0 0 3.5 17l-1.4 5.1 5.2-1.4A9.9 9.9 0 1 0 12 2.1Zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-3-.2-.3A8.1 8.1 0 1 1 12 20.1Zm4.4-6c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4 0-.5.1-.7l.5-.6c.1-.2.1-.3 0-.5l-.7-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9.9-1.1 2.1-.6 3.5a11 11 0 0 0 4.5 5.1c1.7.9 2.9 1 3.9.7.7-.2 1.4-.8 1.6-1.5.2-.6.2-1.1.1-1.2l-1.4-.6Z" />
  </svg>
);
export const ICalc = make(<><rect x="5" y="2.5" width="14" height="19" rx="2.5" /><path d="M8.5 6.5h7" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.5h.01M12 18.5h.01M15.5 18.5h.01" /></>);
export const ITrophy = make(<><path d="M8 21h8M12 17v4" /><path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5a1 1 0 0 0-1 1c0 2.2 1.6 3.8 3.5 4M17 6h2.5a1 1 0 0 1 1 1c0 2.2-1.6 3.8-3.5 4" /></>);
export const ITarget = make(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" /></>);
export const IRobot = make(<><rect x="4" y="8" width="16" height="11" rx="3" /><circle cx="9" cy="13" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.3" fill="currentColor" stroke="none" /><path d="M12 3v5" /><circle cx="12" cy="3" r="1.4" /><path d="M9 16.5h6" /></>);
export const ISparkles = make(<><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /><path d="M18.5 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" /></>);
export const IUpload = make(<><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13A1.5 1.5 0 0 0 20 18.5V16" /></>);
export const IMenu = make(<><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>);
export const IHome = make(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />);
