import { useColorMode } from '@docusaurus/theme-common';
import React from 'react';

// The theme button of the design: a moon in the light theme, a sun in the dark one. Both icons are in the page and
// CSS shows one by `data-theme`, so the right one shows before React runs.
export default function NavbarColorModeToggle({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const { colorMode, setColorMode } = useColorMode();
  const dark = colorMode === 'dark';
  return (
    <button
      type="button"
      className={['iconbtn', 'theme-toggle', className].filter(Boolean).join(' ')}
      aria-label={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      onClick={() => setColorMode(dark ? 'light' : 'dark')}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="theme-toggle__sun">
        <circle
          cx="12"
          cy="12"
          r="4.5"
          style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }}
        />
        <path
          d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7 7 M17 17 L18.7 18.7 M5.3 18.7 L7 17 M17 7 L18.7 5.3"
          style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }}
        />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="theme-toggle__moon">
        <path
          d="M20 14.5 A8.5 8.5 0 1 1 9.5 4 A7 7 0 0 0 20 14.5 Z"
          style={{
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinejoin: 'round',
          }}
        />
      </svg>
    </button>
  );
}
