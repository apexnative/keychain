import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
import registry from './sections.json';

// The reference by the `api` part of sections.json, written by hand: groups with their sections, a status dot on
// each, and a page per export with the types of the section last. A section of one page is a link.
type Section = (typeof registry.api)[number]['sections'][number] & { status?: string };

const statusClass = (section: Section) =>
  section.status ? `sidebar-status sidebar-status--${section.status}` : undefined;

const sidebars: SidebarsConfig = {
  api: registry.api.map((group) => ({
    type: 'category' as const,
    label: group.title,
    collapsible: true,
    collapsed: false,
    items: group.sections.map((section: Section) =>
      section.docs.length === 1
        ? {
            type: 'doc' as const,
            id: section.docs[0],
            label: section.labels[0],
            className: statusClass(section),
          }
        : {
            type: 'category' as const,
            label: section.title,
            className: statusClass(section),
            collapsible: true,
            collapsed: true,
            link: { type: 'doc' as const, id: section.docs[0] },
            items: section.docs.map((id, i) => ({
              type: 'doc' as const,
              id,
              label: section.labels[i],
            })),
          }
    ),
  })),
};

export default sidebars;
