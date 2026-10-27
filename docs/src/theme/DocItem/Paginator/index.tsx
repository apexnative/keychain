import Link from '@docusaurus/Link';
import { useActivePlugin, useDoc } from '@docusaurus/plugin-content-docs/client';
import React from 'react';

// The previous and next cards of the boards.
export default function DocItemPaginator(): React.JSX.Element | null {
  const { metadata } = useDoc();
  const { previous, next } = metadata;
  // The reference pages name code, so their labels are mono (DocsApi).
  const label =
    useActivePlugin()?.pluginId === 'api' ? 'pager__label pager__label--code' : 'pager__label';
  if (!previous && !next) return null;
  return (
    <nav aria-label="Previous and next page" className="pager-row">
      {previous ? (
        <Link className="pager" to={previous.permalink}>
          <span className="pager__sub">Previous</span>
          <span className={label}>« {previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link className="pager pager--next" to={next.permalink}>
          <span className="pager__sub">Next</span>
          <span className={label}>{next.title} »</span>
        </Link>
      )}
    </nav>
  );
}
