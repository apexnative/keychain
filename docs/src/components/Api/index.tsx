import Link from '@docusaurus/Link';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import CodeBlock from '@theme/CodeBlock';
import DocItemTOCMobile from '@theme/DocItem/TOC/Mobile';
import clsx from 'clsx';
import React, { type ReactNode } from 'react';
import registry from '@site/sections.json';
import styles from './styles.module.css';

// The parts of a reference page, in the look of navigation's DocsApi board: the header with the kind, the status and
// the import; the facts of a signature; the tables of parameters and fields; the cards of "See also". The reference is
// written by hand, so every part takes its content from the page; texts in props may use `code`, **bold** and
// [links](/docs/…).

type Status = 'draft' | 'review' | 'stable' | 'planned';
type Platform = 'ios' | 'android';

interface ApiSection {
  id: string;
  title: string;
  status?: string;
  guide?: string;
  docs: string[];
  labels: string[];
}

const groups = registry.api as { id: string; title: string; sections: ApiSection[] }[];

function sectionOf(docId: string) {
  for (const group of groups) {
    const section = group.sections.find((s) => s.docs.includes(docId));
    if (section) return { group, section };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- inline text

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** A text of a prop as React: `code`, **bold** and [links](…); internal links go through Link, so the build checks them. */
export function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const [, code, bold, label, href] = match;
    if (code !== undefined) parts.push(<code key={index}>{code}</code>);
    else if (bold !== undefined) parts.push(<strong key={index}>{bold}</strong>);
    else if (href.startsWith('/') || href.startsWith('.') || href.startsWith('#'))
      parts.push(
        <Link key={index} to={href}>
          {label}
        </Link>
      );
    else
      parts.push(
        <a key={index} href={href}>
          {label}
        </a>
      );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const show = (value: ReactNode) => (typeof value === 'string' ? inline(value) : value);

// --------------------------------------------------------------------------------------------- the platforms

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'ios', label: 'iOS' },
  { id: 'android', label: 'Android' },
];

export function Platforms({ platforms = ['ios', 'android'] }: { platforms?: Platform[] }) {
  return (
    <span className={styles.pfs}>
      {PLATFORMS.map(({ id, label }) => {
        const on = platforms.includes(id);
        return (
          <span key={id} className={clsx(styles.pf, on ? styles[`pf_${id}`] : styles.pfOff)}>
            {label}
            {!on && <span className="sr-only"> (not supported)</span>}
          </span>
        );
      })}
    </span>
  );
}

// ------------------------------------------------------------------------------------------ the section status

const STATUS_LABEL: Record<Status, string> = {
  stable: 'Stable',
  review: 'In review',
  draft: 'Draft',
  planned: 'Planned',
};
const STATUS_NOTE: Record<Status, string> = {
  stable: 'Works as documented on every platform.',
  review: 'The API is being reviewed and can still change.',
  draft: 'In the package, not released yet: the API can still change.',
  planned: 'Agreed for 1.0, not in the package yet.',
};

// A section that is done shows no card: the card marks what can still change. A page outside the sections, such as
// the overview, has no status and no card.
function StatusCard({ section }: { section: ApiSection }) {
  const status = section.status as Status | undefined;
  if (!status || status === 'stable') return null;
  return (
    <section className={styles.stc} aria-label="Section status">
      <div className={styles.stcHead}>
        <span className="eyebrow" style={{ color: 'var(--an-muted)' }}>
          Section
        </span>
        {section.guide ? (
          <Link to={section.guide} className={styles.stcTitle}>
            {section.title}
          </Link>
        ) : (
          <span className={styles.stcTitle}>{section.title}</span>
        )}
        <span className={clsx(styles.pill, styles[`pill_${status}`])}>{STATUS_LABEL[status]}</span>
        <span className={styles.stcNote}>{STATUS_NOTE[status]}</span>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------------------------------- the page header

const CALLABLE = ['Function', 'Method'];

/**
 * The header of a reference page: the breadcrumbs, the kind, the name, the page's description as the lead, the
 * status of the section and the import. The page sets `hide_title: true`; the name is its title.
 */
export function ApiHeader({
  kind,
  importName,
  from = '@apexnative/keychain',
}: {
  kind: string;
  /** What the import line names, as written between the braces: `createKeychain`, `type SetOptions`. */
  importName?: string;
  from?: string;
}) {
  const { metadata, frontMatter } = useDoc();
  const found = sectionOf(metadata.id);
  const title = CALLABLE.includes(kind) ? `${metadata.title}()` : metadata.title;
  return (
    <header>
      {found?.section.guide && (
        <Link className="crumbs-back" to={found.section.guide}>
          ‹ {found.section.title}
        </Link>
      )}
      <nav aria-label="Breadcrumbs" className="crumbs crumbs--api">
        <Link className="crumb" to="/api/overview">
          API
        </Link>
        {found && (
          <>
            <span className="crumbs__sep" aria-hidden="true">
              ›
            </span>
            <span className="crumb">{found.group.title}</span>
            {found.section.docs.length > 1 && (
              <>
                <span className="crumbs__sep" aria-hidden="true">
                  ›
                </span>
                <Link className="crumb" to={`/api/${found.section.docs[0]}`}>
                  {found.section.title}
                </Link>
              </>
            )}
          </>
        )}
        <span className="crumbs__sep" aria-hidden="true">
          ›
        </span>
        <span className="crumbs__here" aria-current="page">
          {metadata.title}
        </span>
      </nav>
      <div className={styles.kindRow}>
        <span className={styles.kind}>{kind}</span>
      </div>
      <h1 className={styles.h1c}>{title}</h1>
      {frontMatter.description && <p className={styles.lead}>{inline(frontMatter.description)}</p>}
      {found && <StatusCard section={found.section} />}
      <div className="toc-mobile">
        <DocItemTOCMobile />
      </div>
      {importName && (
        <CodeBlock language="ts" title="Import">
          {`import { ${importName} } from '${from}';`}
        </CodeBlock>
      )}
    </header>
  );
}

// ------------------------------------------------------------------------------------------------- the facts

/** The facts under a signature: what it returns or its type, the default, whether it prompts, the platforms. */
export function Facts({
  returns,
  type,
  defaultValue,
  prompt,
  throws,
  platforms,
}: {
  returns?: string;
  type?: string;
  defaultValue?: string;
  /** Whether the call can show the system prompt, in words. */
  prompt?: string;
  /** The codes it throws, in words. */
  throws?: string;
  platforms?: Platform[];
}) {
  return (
    <div className={styles.facts}>
      {returns && (
        <>
          <span className={clsx('eyebrow', styles.factLabel)}>Returns</span>
          <code>{returns}</code>
        </>
      )}
      {type && (
        <>
          <span className={clsx('eyebrow', styles.factLabel)}>Type</span>
          <code>{type}</code>
        </>
      )}
      {defaultValue && (
        <>
          <span className={clsx('eyebrow', styles.factLabel)}>Default</span>
          <code>{defaultValue}</code>
        </>
      )}
      {prompt && (
        <>
          <span className={clsx('eyebrow', styles.factLabel)}>Prompt</span>
          <span className={styles.factText}>{inline(prompt)}</span>
        </>
      )}
      {throws && (
        <>
          <span className={clsx('eyebrow', styles.factLabel)}>Throws</span>
          <span className={styles.factText}>{inline(throws)}</span>
        </>
      )}
      <span className={clsx('eyebrow', styles.factLabel)}>Platforms</span>
      <Platforms platforms={platforms} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- the tables

interface Row {
  name: string;
  type: string;
  required?: boolean;
  default?: string;
  text: ReactNode;
}

/** The parameters of a function, or the fields of a type: the name, the type and what it does. */
export function Params({ items, label = 'Parameter' }: { items: Row[]; label?: string }) {
  return (
    <div className={styles.ptabBox}>
      <table className={styles.ptab}>
        <thead>
          <tr>
            <th scope="col" className={clsx('eyebrow', styles.th)}>
              {label}
            </th>
            <th scope="col" className={clsx('eyebrow', styles.th)}>
              Type
            </th>
            <th scope="col" className={clsx('eyebrow', styles.th)}>
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.name}>
              <td className={clsx(styles.td, styles.tdName)}>
                <span className={styles.fieldName}>{item.name}</span>
                {item.required && <span className={styles.req}>Required</span>}
              </td>
              <td className={clsx(styles.td, styles.tdType)}>{item.type}</td>
              <td className={styles.td}>
                {show(item.text)}
                {item.default && (
                  <span className={styles.muted}>
                    {' '}
                    Default <code>{item.default}</code>.
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- see also

/** The cards at the end of a reference page. */
export function SeeAlso({ items }: { items: { name: string; text: string; to: string }[] }) {
  return (
    <div className={styles.alsoGrid}>
      {items.map((item) => (
        <Link key={item.name} to={item.to} className={styles.also}>
          <span className={styles.alsoName}>{item.name}</span>
          <span className={styles.alsoText}>{inline(item.text)}</span>
        </Link>
      ))}
    </div>
  );
}

/** The reference pages of a section, as cards, for its page in the Docs. */
export function SectionApi({ id }: { id: string }) {
  const section = groups.flatMap((g) => g.sections).find((s) => s.id === id);
  if (!section) throw new Error(`SectionApi: no API section '${id}' in sections.json`);
  return (
    <div className={styles.alsoGrid}>
      {section.docs.map((doc, i) => (
        <Link key={doc} to={`/api/${doc}`} className={styles.also}>
          <span className={styles.alsoName}>{section.labels[i]}</span>
        </Link>
      ))}
    </div>
  );
}
