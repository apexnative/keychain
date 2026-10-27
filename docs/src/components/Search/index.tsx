import Link from '@docusaurus/Link';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import registry from '@site/sections.json';
import styles from './styles.module.css';

interface Page {
  section: string;
  title: string;
  to: string;
}

// Every page of the site by its title: the sections of the Docs and the reference pages of the API.
function usePages(): Page[] {
  return useMemo(() => {
    const docs = registry.groups.flatMap((group) =>
      group.sections.map((section) => ({
        section: group.title,
        title: section.title,
        to: `/docs/${group.id}/${section.id}`,
      }))
    );
    const api = registry.api.flatMap((group) =>
      group.sections.flatMap((section) =>
        section.docs.map((doc, i) => ({
          section: `API · ${section.title}`,
          title: section.labels[i] === 'Types' ? `${section.title} types` : section.labels[i],
          to: `/api/${doc}`,
        }))
      )
    );
    return [...docs, ...api];
  }, []);
}

export default function SearchButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pages = usePages();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const needle = query.trim().toLowerCase();
  const hits = pages.filter(
    (p) => !needle || `${p.title} ${p.section}`.toLowerCase().includes(needle)
  );

  return (
    <>
      <button type="button" className={styles.button} onClick={() => setOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
          <circle
            cx="11"
            cy="11"
            r="7"
            style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}
          />
          <path
            d="M16.5 16.5 L21 21"
            style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}
          />
        </svg>
        <span className={styles.label}>Search docs</span>
        <span className={styles.kbd}>⌘K</span>
      </button>
      {open && (
        <div className={styles.backdrop}>
          <button
            type="button"
            aria-label="Close search"
            className={styles.dismiss}
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search the docs"
            className={styles.dialog}
          >
            <div className={styles.field}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.radar}>
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  style={{ fill: 'none', stroke: '#2A9D8F', strokeWidth: 1.6 }}
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4.5"
                  style={{ fill: 'none', stroke: '#2A9D8F', strokeWidth: 1.2, strokeOpacity: 0.6 }}
                />
                <path
                  d="M12 12 L18.4 5.6"
                  style={{
                    fill: 'none',
                    stroke: '#2A9D8F',
                    strokeWidth: 1.8,
                    strokeLinecap: 'round',
                  }}
                />
              </svg>
              <label htmlFor="docs-search" className="sr-only">
                Search the docs
              </label>
              <input
                ref={input}
                id="docs-search"
                type="search"
                className={styles.input}
                placeholder="Search the docs"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className={styles.esc} onClick={() => setOpen(false)}>
                Esc
              </button>
            </div>
            <div className={styles.hits}>
              {hits.map((hit) => (
                <Link
                  key={hit.to}
                  className={styles.hit}
                  to={hit.to}
                  onClick={() => setOpen(false)}
                >
                  <span className={styles.hitSection}>{hit.section}</span>
                  <span className={styles.hitTitle}>{hit.title}</span>
                </Link>
              ))}
              {hits.length === 0 && <p className={styles.none}>No signal for “{query}”.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
