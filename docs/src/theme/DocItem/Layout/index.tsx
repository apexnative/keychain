import { useDoc } from '@docusaurus/plugin-content-docs/client';
import ContentVisibility from '@theme/ContentVisibility';
import DocBreadcrumbs from '@theme/DocBreadcrumbs';
import DocItemContent from '@theme/DocItem/Content';
import DocItemFooter from '@theme/DocItem/Footer';
import DocItemPaginator from '@theme/DocItem/Paginator';
import DocVersionBanner from '@theme/DocVersionBanner';
import TOC from '@theme/TOC';
import useBaseUrl from '@docusaurus/useBaseUrl';
import React, { useEffect, useRef, type ReactNode } from 'react';

// The page of the DocsPage board: the main column, and "On this page" with the example app's card at the right (from
// 1200 px; under it "On this page" folds into one row at the top of the page).
export default function DocItemLayout({ children }: { children: ReactNode }) {
  const { metadata, frontMatter, toc } = useDoc();
  const showToc = !frontMatter.hide_table_of_contents && toc.length > 0;
  const sticky = useFollowActive();
  return (
    <div className="doc-layout">
      <div className="doc-column">
        <ContentVisibility metadata={metadata} />
        <DocVersionBanner />
        <article>
          <DocBreadcrumbs />
          <DocItemContent>{children}</DocItemContent>
          <DocItemFooter />
        </article>
        <DocItemPaginator />
      </div>
      <aside className="toc" aria-label="On this page">
        <div className="toc__sticky" ref={sticky}>
          {showToc && (
            <TOC
              toc={toc}
              minHeadingLevel={frontMatter.toc_min_heading_level}
              maxHeadingLevel={frontMatter.toc_max_heading_level}
            />
          )}
          <ShowcaseCard note={(frontMatter as { showcase_note?: string }).showcase_note} />
        </div>
      </aside>
    </div>
  );
}

// The example app has a scenario per feature: a page can name its scenario (`showcase_note` in the front matter).
function ShowcaseCard({ note }: { note?: string }) {
  return (
    <div className="showcase-card">
      <img src={useBaseUrl('/img/keychain.svg')} alt="" width={44} height={44} />
      <div className="showcase-card__title">
        {note ? 'Try it in the example app' : 'Try the example app'}
      </div>
      <div className="showcase-card__text">
        {note ?? 'A scenario per feature, for iOS and Android.'}
      </div>
      <a
        className="showcase-card__link"
        href="https://github.com/apexnative/keychain/tree/main/example"
      >
        Open on GitHub ↗
      </a>
    </div>
  );
}

// "On this page" scrolls on its own when it is taller than the window; as the reader moves through the page, the
// heading they are at stays in view in it, so the list never points at a part of itself the reader can't see.
function useFollowActive() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const follow = () => {
      const active = box.querySelector<HTMLElement>('.tl-on');
      if (!active || box.scrollHeight <= box.clientHeight) return;
      const top =
        active.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const margin = 48;
      if (top < box.scrollTop + margin) box.scrollTop = Math.max(0, top - margin);
      else if (top + active.offsetHeight > box.scrollTop + box.clientHeight - margin)
        box.scrollTop = top + active.offsetHeight - box.clientHeight + margin;
    };
    const observer = new MutationObserver(follow);
    observer.observe(box, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return ref;
}
