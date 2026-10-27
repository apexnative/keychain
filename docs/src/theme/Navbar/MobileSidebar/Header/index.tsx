import { useNavbarMobileSidebar } from '@docusaurus/theme-common/internal';
import useBaseUrl from '@docusaurus/useBaseUrl';
import React from 'react';

// The head of the menu on a phone (DocsPhone, "menu open"): the mark, the name and a close button.
export default function NavbarMobileSidebarHeader(): React.JSX.Element {
  const mobileSidebar = useNavbarMobileSidebar();
  return (
    <div className="drawer__head">
      <img src={useBaseUrl('/img/keychain.svg')} alt="" width={30} height={30} />
      <span className="drawer__name">keychain</span>
      <button
        type="button"
        className="iconbtn drawer__close"
        aria-label="Close the menu"
        onClick={() => mobileSidebar.toggle()}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path
            d="M6 6 L18 18 M18 6 L6 18"
            style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}
          />
        </svg>
      </button>
    </div>
  );
}
