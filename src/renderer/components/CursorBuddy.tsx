export function CursorBuddy({ reducedMotion = false }: { reducedMotion?: boolean }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      className={reducedMotion ? 'cursor-buddy cursor-buddy-reduced' : 'cursor-buddy'}
      width="54"
      height="54"
      focusable="false"
    >
      <path d="M10 5.5 54 34.4 34.4 37.7 43 54.5l-9.1 4.1-8.1-17.1-11.8 14.4Z" fill="#111927" stroke="#e8f7ff" strokeWidth="2.3" strokeLinejoin="round" />
      <path d="m29.8 38.2 4.1-1.4 7.6 15.3-3.8 1.8Z" fill="#02F3FE" />
      <circle cx="25.2" cy="26.1" r="2.2" fill="#b8f6ff" />
      <circle cx="31.4" cy="29.4" r="1.6" fill="#b8f6ff" />
      <path d="m18 18 2-4 2 4 4 2-4 2-2 4-2-4-4-2Z" fill="#73F9FD" />
    </svg>
  );
}
