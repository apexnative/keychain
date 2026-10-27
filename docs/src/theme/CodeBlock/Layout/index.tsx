import { useCodeBlockContext } from '@docusaurus/theme-common/internal';
import Container from '@theme/CodeBlock/Container';
import Content from '@theme/CodeBlock/Content';
import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { usePreview } from '@site/src/theme/CodeBlock';

// The code block of the boards: navy, a header with the file name and a Copy button, a shadow of its own color.
// A block without a title has no header (the signature on the DocsApi board), unless it is a preview.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="cb__copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function CodeBlockLayout({ className }: { className?: string }) {
  const { metadata } = useCodeBlockContext();
  const preview = usePreview();
  return (
    <Container as="div" className={clsx('cb', className, metadata.className)}>
      {(metadata.title || preview) && (
        <div className="cb__head">
          <span className="cb__title">{metadata.title}</span>
          <span className="cb__actions">
            {preview && (
              <span className="cb__preview" title="The API before the package has it">
                Preview
              </span>
            )}
            <CopyButton text={metadata.code} />
          </span>
        </div>
      )}
      <div className="cb__body">
        <Content />
      </div>
    </Container>
  );
}
