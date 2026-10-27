import type { PropSidebar } from '@docusaurus/plugin-content-docs';
import { useLocation } from '@docusaurus/router';
import { useNavbarMobileSidebar } from '@docusaurus/theme-common/internal';
import React, { useMemo, useState, type ReactNode } from 'react';
import registry from '@site/sections.json';
import { SidebarNav } from '@site/src/theme/DocSidebar/Desktop';

// The menu on a phone (DocsPhone, "menu open"): Docs and API switch at the top, the sections keep their status dots.
function useSidebars(): { docs: PropSidebar; api: PropSidebar } {
  return useMemo(() => {
    const docs = registry.groups.map((group) => ({
      type: 'category' as const,
      label: group.title,
      collapsible: true,
      collapsed: false,
      items: group.sections.map((section) => ({
        type: 'link' as const,
        label: section.title,
        href: `/docs/${group.id}/${section.id}`,
      })),
    }));
    // The API part of the registry, as sidebars-api.ts builds it.
    const api = registry.api.map((group) => ({
      type: 'category' as const,
      label: group.title,
      collapsible: true,
      collapsed: false,
      items: group.sections.map(
        (section: { status?: string } & (typeof group.sections)[number]) => {
          const className = section.status ? `sidebar-status--${section.status}` : undefined;
          return section.docs.length === 1
            ? {
                type: 'link' as const,
                label: section.labels[0],
                href: `/api/${section.docs[0]}`,
                className,
              }
            : {
                type: 'category' as const,
                label: section.title,
                href: `/api/${section.docs[0]}`,
                className,
                collapsible: true,
                collapsed: true,
                items: section.docs.map((doc, i) => ({
                  type: 'link' as const,
                  label: section.labels[i],
                  href: `/api/${doc}`,
                })),
              };
        }
      ),
    }));
    return { docs: docs as PropSidebar, api: api as PropSidebar };
  }, []);
}

export default function NavbarMobileSidebarLayout({
  header,
}: {
  header: ReactNode;
  primaryMenu: ReactNode;
  secondaryMenu: ReactNode;
}) {
  const { pathname } = useLocation();
  const mobileSidebar = useNavbarMobileSidebar();
  const sidebars = useSidebars();
  const [part, setPart] = useState<'docs' | 'api'>(pathname.startsWith('/api') ? 'api' : 'docs');
  return (
    <div className="navbar-sidebar drawer">
      {header}
      <div className="drawer__switch" role="tablist" aria-label="Part of the docs">
        {(['docs', 'api'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={part === id}
            className={part === id ? 'drawer__tab drawer__tab--on' : 'drawer__tab'}
            onClick={() => setPart(id)}
          >
            {id === 'docs' ? 'Docs' : 'API'}
          </button>
        ))}
      </div>
      <div
        className="drawer__list"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) mobileSidebar.toggle();
        }}
      >
        <SidebarNav sidebar={sidebars[part]} path={pathname} />
      </div>
    </div>
  );
}
