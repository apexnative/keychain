import { useActivePlugin, useDoc } from '@docusaurus/plugin-content-docs/client';
import type { TOCItem } from '@docusaurus/mdx-loader';
import TOCItems from '@theme/TOCItems';
import React from 'react';

// "On this page" of the boards. A reference page can add its members under a heading (`toc_members` after
// `toc_members_after` in its front matter): they link to the member cards, or to `toc_members_ids` when it gives them
// (the rows of an options tree).
interface Props {
  toc: readonly TOCItem[];
  minHeadingLevel?: number;
  maxHeadingLevel?: number;
  className?: string;
}

// A blog post has no doc around it, so its list is the headings alone.
export default function TOC(props: Props): React.JSX.Element {
  return useActivePlugin() ? <DocTOC {...props} /> : <TOCBox {...props} toc={[...props.toc]} />;
}

function DocTOC({ toc, minHeadingLevel, maxHeadingLevel }: Props): React.JSX.Element {
  const { frontMatter } = useDoc();
  const extra = frontMatter as {
    toc_members?: string[];
    toc_members_ids?: string[];
    toc_members_after?: string;
  };
  const items: TOCItem[] = [];
  for (const item of toc) {
    // "Returns ScreenNavigation" is "Returns" in the list, as on the board; the members follow it.
    items.push(item.id === 'returns' ? { ...item, value: item.value.split(' ')[0] } : item);
    if (extra.toc_members && item.id === extra.toc_members_after) {
      extra.toc_members.forEach((name, i) =>
        items.push({ value: name, id: extra.toc_members_ids?.[i] ?? `member-${name}`, level: 3 })
      );
    }
  }
  return <TOCBox toc={items} minHeadingLevel={minHeadingLevel} maxHeadingLevel={maxHeadingLevel} />;
}

function TOCBox({
  toc,
  minHeadingLevel,
  maxHeadingLevel,
}: Props & { toc: TOCItem[] }): React.JSX.Element {
  return (
    <div className="toc__box">
      <div className="eyebrow toc__title">On this page</div>
      <TOCItems
        toc={toc}
        minHeadingLevel={minHeadingLevel}
        maxHeadingLevel={maxHeadingLevel}
        className="toc__list"
        linkClassName="tl toc-highlight"
        linkActiveClassName="tl-on"
      />
    </div>
  );
}
