import Link from '@docusaurus/Link';
import type { PropSidebar, PropSidebarItem } from '@docusaurus/plugin-content-docs';
import { isActiveSidebarItem } from '@docusaurus/plugin-content-docs/client';
import useBaseUrl from '@docusaurus/useBaseUrl';
import clsx from 'clsx';
import React, { useState } from 'react';

// The sidebar of the DocsPage and DocsApi boards. Docs: groups with their pages. API: groups with their sections,
// a status dot on each, and the pages of the section the reader is in under it; a section of one page is a link.

type Status = 'stable' | 'review' | 'draft' | 'planned';
const STATUS_TEXT: Record<Status, string> = {
  stable: 'Stable',
  review: 'In review',
  draft: 'Draft',
  planned: 'Planned',
};
const statusOf = (className?: string) =>
  (className?.match(/sidebar-status--(\w+)/)?.[1] as Status | undefined) ?? null;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="cat__chevron"
      style={{ transform: `rotate(${open ? 90 : 0}deg)` }}
    >
      <path d="M4 2.5 L7.5 6 L4 9.5" />
    </svg>
  );
}

function Dot({ status }: { status: Status }) {
  return (
    <>
      <span className={`dot st-${status}`} aria-hidden="true" />
      <span className="sr-only">, {STATUS_TEXT[status]}</span>
    </>
  );
}

function href(item: PropSidebarItem) {
  return item.type === 'html' ? undefined : item.href;
}

function DocsItem({ item, path }: { item: PropSidebarItem; path: string }) {
  if (item.type === 'html') return null;
  const active = isActiveSidebarItem(item, path);
  const status = statusOf(item.className);
  return (
    <Link
      className={clsx('sl', active && 'sl-on')}
      to={href(item)}
      aria-current={active ? 'page' : undefined}
    >
      {status && <span className={`dot st-${status}`} aria-hidden="true" />}
      <span>{item.label}</span>
      {status && <span className="sr-only">, {STATUS_TEXT[status]}</span>}
    </Link>
  );
}

function ApiSection({ item, path }: { item: PropSidebarItem; path: string }) {
  if (item.type !== 'category') return <DocsItem item={item} path={path} />;
  const current = isActiveSidebarItem(item, path);
  const status = statusOf(item.className) ?? 'draft';
  return (
    <div>
      <Link
        className={clsx('ss', current && 'ss-on')}
        to={item.href}
        aria-current={current ? 'true' : undefined}
      >
        <Dot status={status} />
        <span>{item.label}</span>
      </Link>
      {current && (
        <div className="subs">
          {item.items.map((doc) => {
            if (doc.type === 'html') return null;
            const active = isActiveSidebarItem(doc, path);
            return (
              <Link
                key={doc.label}
                className={clsx('si', active && 'si-on')}
                to={href(doc)}
                aria-current={active ? 'page' : undefined}
              >
                {doc.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StationCard() {
  return (
    <a className="station" href="https://apexnative.dev">
      <img src={useBaseUrl('/img/apexnative.svg')} alt="" width={34} height={34} />
      <span className="station__text">
        <span className="station__name">apexnative.dev</span>
        <span className="station__note">The station: all modules</span>
      </span>
    </a>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span className="eyebrow legend__title">Section status</span>
      <span className="legend__row">
        <span className="dot st-stable" aria-hidden="true" />
        Stable: checked on every platform
      </span>
      <span className="legend__row">
        <span className="dot st-review" aria-hidden="true" />
        In review: can still change
      </span>
      <span className="legend__row">
        <span className="dot st-draft" aria-hidden="true" />
        Draft: in the package, can still change
      </span>
      <span className="legend__row">
        <span className="dot st-planned" aria-hidden="true" />
        Planned: not in the package yet
      </span>
    </div>
  );
}

export function SidebarNav({ sidebar, path }: { sidebar: PropSidebar; path: string }) {
  const groups = sidebar.filter((item) => item.type === 'category');
  const api = groups.some(
    (group) =>
      group.type === 'category' &&
      group.items.some(
        (item) => item.type === 'category' || (item.type !== 'html' && statusOf(item.className))
      )
  );
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <>
      <nav aria-label={api ? 'API sections' : 'Docs pages'} className="side__nav">
        {groups.map((group) => {
          if (group.type !== 'category') return null;
          const open = !closed[group.label];
          return (
            <div key={group.label}>
              <button
                type="button"
                className="cat"
                aria-expanded={open}
                onClick={() => setClosed({ ...closed, [group.label]: open })}
              >
                <span>{group.label}</span>
                <Chevron open={open} />
              </button>
              {open && (
                <div className="cat__items">
                  {group.items.map((item) =>
                    api ? (
                      <ApiSection
                        key={item.type === 'html' ? item.value : item.label}
                        item={item}
                        path={path}
                      />
                    ) : (
                      <DocsItem
                        key={item.type === 'html' ? item.value : item.label}
                        item={item}
                        path={path}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {api ? <Legend /> : <StationCard />}
    </>
  );
}

export default function DocSidebarDesktop({
  path,
  sidebar,
}: {
  path: string;
  sidebar: PropSidebar;
}) {
  return (
    <div className="side">
      <SidebarNav sidebar={sidebar} path={path} />
    </div>
  );
}
