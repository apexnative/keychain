import clsx from 'clsx';
import React, { Children, type ReactNode } from 'react';
import styles from './styles.module.css';

// Blocks of the explaining pages (Introduction first), in the look of the boards: 2px ink borders, rounded cards,
// shadows of the accent color, mono eyebrows, Righteous titles.

/** A key phrase, marked as with a highlighter. */
export function Mark({ children }: { children: ReactNode }) {
  return <mark className={styles.mark}>{children}</mark>;
}

/** A platform named in text: its color chip. */
export function Os({ name }: { name: 'iOS' | 'iPadOS' | 'Android' }) {
  const tone =
    name === 'Android' ? styles.osAndroid : name === 'iPadOS' ? styles.osIpad : styles.osIos;
  return <span className={clsx(styles.os, tone)}>{name}</span>;
}

/** The idea of the page in one line. */
export function Thesis({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <div className={styles.thesis}>
      {eyebrow && <span className={clsx('eyebrow', styles.thesisEyebrow)}>{eyebrow}</span>}
      <p className={styles.thesisText}>{children}</p>
    </div>
  );
}

/** Approaches side by side, row by row; the last column is this library. */
export function Models({
  columns,
  rows,
}: {
  columns: { eyebrow: string; title: string }[];
  rows: { label: string; cells: ReactNode[] }[];
}) {
  const last = columns.length - 1;
  const template = { gridTemplateColumns: `120px repeat(${columns.length}, minmax(0, 1fr))` };
  return (
    <div className={styles.models} role="table" aria-label="Approaches side by side">
      <div className={styles.modelsHead} role="row" style={template}>
        <span className={styles.modelsCorner} role="columnheader" aria-label="Aspect" />
        {columns.map((column, i) => (
          <div
            key={column.title}
            className={i === last ? styles.modelRightHead : styles.modelLeftHead}
            role="columnheader"
          >
            <span className={clsx('eyebrow', i === last && styles.modelRightEyebrow)}>
              {column.eyebrow}
            </span>
            <span className={styles.modelTitle}>{column.title}</span>
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.label} className={styles.modelsRow} role="row" style={template}>
          <span className={clsx('eyebrow', styles.modelsLabel)} role="rowheader">
            {row.label}
          </span>
          {row.cells.map((cell, i) => (
            <div key={i} className={i === last ? styles.modelRight : styles.modelLeft} role="cell">
              <span className={styles.modelMobileTag}>{columns[i].title}</span>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Two code blocks side by side: the same task in two ways; the right one is this library. */
export function Pair({
  left,
  right,
  children,
}: {
  left: string;
  right: string;
  children: ReactNode;
}) {
  const [first, second] = Children.toArray(children);
  return (
    <div className={styles.pair}>
      <div className={styles.pairSide}>
        <span className={clsx('eyebrow', styles.pairLabel)}>{left}</span>
        {first}
      </div>
      <div className={clsx(styles.pairSide, styles.pairOurs)}>
        <span className={clsx('eyebrow', styles.pairLabel)}>{right}</span>
        {second}
      </div>
    </div>
  );
}

const COLORS = [
  '#457B9D',
  '#E9B949',
  '#2A9D8F',
  '#D1495B',
  '#5FA8D3',
  '#9C89B8',
  '#F4A261',
  '#8A9A5B',
];

/** Numbered cards, as "How it is built" on the home page. */
export function Principles({ items }: { items: { title: string; text: ReactNode }[] }) {
  return (
    <div className={styles.principles}>
      {items.map((item, i) => (
        <article
          key={item.title}
          className={styles.principle}
          style={{ boxShadow: `0 5px 0 ${COLORS[i % COLORS.length]}` }}
        >
          <span
            className={styles.principleNumber}
            style={{ background: COLORS[i % COLORS.length] }}
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <h3 className={styles.principleTitle}>{item.title}</h3>
          <div className={styles.principleText}>{item.text}</div>
        </article>
      ))}
    </div>
  );
}

/** Numbered steps on a rail, with the code of each step. */
export function Steps({ items }: { items: { text: ReactNode; code?: string }[] }) {
  return (
    <ol className={styles.steps}>
      {items.map((item, i) => (
        <li key={i} className={styles.step}>
          <span className={clsx(styles.stepNumber, i === items.length - 1 && styles.stepLast)}>
            {i + 1}
          </span>
          <span className={styles.stepBody}>
            <span className={styles.stepText}>{item.text}</span>
            {item.code && <code className={styles.stepCode}>{item.code}</code>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Where the library fits and where it does not. */
export function Fit({
  yes,
  no,
  yesLabel = 'Fits',
  noLabel = 'Not a fit',
}: {
  yes: ReactNode[];
  no: ReactNode[];
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <div className={styles.fit}>
      <div className={clsx(styles.fitCard, styles.fitYes)}>
        <div className={styles.fitHead}>
          <span aria-hidden="true">✓</span> {yesLabel}
        </div>
        <ul className={styles.fitList}>
          {yes.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
      <div className={clsx(styles.fitCard, styles.fitNo)}>
        <div className={styles.fitHead}>
          <span aria-hidden="true">✕</span> {noLabel}
        </div>
        <ul className={styles.fitList}>
          {no.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Where the library comes from: one quiet card at the end of the page. */
export function Credits({ children }: { children: ReactNode }) {
  return (
    <aside className={styles.credits} aria-label="Credits">
      <span className={clsx('eyebrow', styles.creditsTitle)}>Credits</span>
      <div className={styles.creditsText}>{children}</div>
    </aside>
  );
}

/** What a setup needs, a card per platform or tool, in the color of each. */
export function Requirements({
  items,
}: {
  items: { title: string; tone: string; lines: ReactNode[] }[];
}) {
  return (
    <div className={styles.reqs}>
      {items.map((item) => (
        <div
          key={item.title}
          className={styles.req}
          style={{ boxShadow: `inset 0 6px 0 ${item.tone}` }}
        >
          <span className={styles.reqTitle}>{item.title}</span>
          <ul className={styles.reqList}>
            {item.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Ways to start, side by side: each with its command and where it is explained. */
export function Paths({
  items,
}: {
  items: { eyebrow: string; title: string; text: ReactNode; command: string; to: string }[];
}) {
  return (
    <div className={styles.paths}>
      {items.map((item, i) => (
        <a
          key={item.title}
          href={item.to}
          className={clsx(styles.path, i === 0 && styles.pathFirst)}
        >
          <span className={clsx('eyebrow', styles.pathEyebrow)}>{item.eyebrow}</span>
          <span className={styles.pathTitle}>{item.title}</span>
          <span className={styles.pathText}>{item.text}</span>
          <code className={styles.pathCommand}>{item.command}</code>
        </a>
      ))}
    </div>
  );
}
