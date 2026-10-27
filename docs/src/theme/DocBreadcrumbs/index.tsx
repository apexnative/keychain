import Link from '@docusaurus/Link';
import { useDocsSidebar, useSidebarBreadcrumbs } from '@docusaurus/plugin-content-docs/client';
import React from 'react';

// "Docs › Getting started › Quick start" in mono, as on the DocsPage board; a page of the Guides sidebar starts
// from Guides.
export default function DocBreadcrumbs(): React.JSX.Element | null {
  const all = useSidebarBreadcrumbs();
  const guides = useDocsSidebar()?.name === 'guides';
  if (!all) return null;
  // "Guides › Guides › Testing" would name the root twice.
  const crumbs = guides && all[0]?.label === 'Guides' ? all.slice(1) : all;
  return (
    <nav aria-label="Breadcrumbs" className="crumbs">
      <Link className="crumb" to={guides ? '/docs/guides/overview' : '/'}>
        {guides ? 'Guides' : 'Docs'}
      </Link>
      {crumbs.map((item, i) => {
        const last = i === crumbs.length - 1;
        return (
          <React.Fragment key={item.label}>
            <span className="crumbs__sep" aria-hidden="true">
              ›
            </span>
            {last ? (
              <span className="crumbs__here" aria-current="page">
                {item.label}
              </span>
            ) : item.href ? (
              <Link className="crumb" to={item.href}>
                {item.label}
              </Link>
            ) : (
              <span className="crumb">{item.label}</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
