import { ThemeClassNames } from '@docusaurus/theme-common';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import DocItemTOCMobile from '@theme/DocItem/TOC/Mobile';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import clsx from 'clsx';
import React, { type ReactNode } from 'react';

// The title of the page and, under it, its description as the lead (DocsPage: "Quick start" and its first line).
export default function DocItemContent({ children }: { children: ReactNode }) {
  const { metadata, frontMatter, contentTitle, toc } = useDoc();
  const title =
    !frontMatter.hide_title && typeof contentTitle === 'undefined' ? metadata.title : null;
  const lead = title ? frontMatter.description : null;
  return (
    <div className={clsx(ThemeClassNames.docs.docMarkdown, 'markdown')}>
      {title && (
        <header>
          <Heading as="h1" className="page-title">
            {title}
          </Heading>
          {lead && <p className="page-lead">{lead}</p>}
          {toc.length > 0 && !frontMatter.hide_table_of_contents && (
            <div className="toc-mobile">
              <DocItemTOCMobile />
            </div>
          )}
        </header>
      )}
      <MDXContent>{children}</MDXContent>
    </div>
  );
}
