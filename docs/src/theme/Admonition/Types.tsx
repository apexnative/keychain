import clsx from 'clsx';
import React, { type ReactNode } from 'react';

// The admonitions of the boards: a card with a colored title strip ("INFO · EARLY DEVELOPMENT") and a shadow of the
// same color. The icons of info, tip and warning are the boards'; note and danger follow them.

type Kind = 'note' | 'tip' | 'info' | 'warning' | 'danger';

const ICONS: Record<Kind, ReactNode> = {
  note: (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect
        x="4"
        y="3"
        width="12"
        height="14"
        rx="2"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}
      />
      <path
        d="M7 8 H13 M7 11.5 H11"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}
      />
    </svg>
  ),
  tip: (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="currentColor" />
    </svg>
  ),
  info: (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle
        cx="10"
        cy="10"
        r="8"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}
      />
      <path
        d="M10 9 V14 M10 6 V6.2"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }}
      />
    </svg>
  ),
  warning: (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M10 2.5 L18 17 H2 Z"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' }}
      />
      <path
        d="M10 8 V12 M10 14.5 V14.7"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }}
      />
    </svg>
  ),
  danger: (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M7 2.5 H13 L17.5 7 V13 L13 17.5 H7 L2.5 13 V7 Z"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' }}
      />
      <path
        d="M10 6.5 V11 M10 13.5 V13.7"
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }}
      />
    </svg>
  ),
};

function make(kind: Kind) {
  return function Admonition({
    title,
    children,
    className,
  }: {
    title?: ReactNode;
    children: ReactNode;
    className?: string;
  }) {
    return (
      <div className={clsx('adm', `adm--${kind}`, className)}>
        <div className="adm__head">
          {ICONS[kind]}
          <span className="adm__title">
            {kind}
            {title ? <> · {title}</> : null}
          </span>
        </div>
        <div className="adm__body">{children}</div>
      </div>
    );
  };
}

const note = make('note');
const tip = make('tip');
const info = make('info');
const warning = make('warning');
const danger = make('danger');

export default {
  note,
  tip,
  info,
  warning,
  danger,
  caution: warning,
  secondary: note,
  important: info,
  success: tip,
};
