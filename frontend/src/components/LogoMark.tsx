// Original mark: a flame of knowledge (saffron) resting on an open-book wave (green).
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="35" height="35" rx="9" fill="#FFFEFA" stroke="#CDC3AB" />
      <path
        d="M18 6c1.3 3.6 5.8 6.3 5.8 11.4A5.8 5.8 0 0 1 18 23.2a5.8 5.8 0 0 1-5.8-5.8c0-2.2 1.1-3.6 2.2-4.7.2 1.8 1.1 2.7 2 3.1C16.2 12 16.3 9 18 6Z"
        fill="#FF9933"
      />
      <path d="M8.5 28c3.4-2.3 6.8-2.3 9.5 0 2.7-2.3 6.1-2.3 9.5 0" stroke="#0F4A09" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
