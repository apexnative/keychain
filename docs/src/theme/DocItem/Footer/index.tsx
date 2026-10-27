import { useDoc } from '@docusaurus/plugin-content-docs/client';
import React from 'react';

// "Edit this page ↗" and the date of the last change, in one row (DocsPage). Reference pages draw their own row.
export default function DocItemFooter(): React.JSX.Element | null {
  const { metadata } = useDoc();
  const { editUrl, lastUpdatedAt } = metadata;
  if (!editUrl && !lastUpdatedAt) return null;
  return (
    <div className="doc-foot">
      {editUrl ? (
        <a className="doc-foot__edit" href={editUrl}>
          Edit this page ↗
        </a>
      ) : (
        <span />
      )}
      {lastUpdatedAt && (
        <span className="doc-foot__date">
          Last updated {new Date(lastUpdatedAt).toLocaleDateString('en-GB')}
        </span>
      )}
    </div>
  );
}
