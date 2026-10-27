import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
import registry from './sections.json';

// The sidebars of the site, in the order of sections.json: Docs, and Guides (the navbar's Guides opens it, as API
// opens the reference). A page per section.
const GUIDES = ['guides'];

const groupsOf = (groups: typeof registry.groups) =>
  groups.map((group) => ({
    type: 'category' as const,
    label: group.title,
    collapsible: true,
    collapsed: false,
    items: group.sections.map((section) => ({
      type: 'doc' as const,
      id: `${group.id}/${section.id}`,
      label: section.title,
    })),
  }));

const sidebars: SidebarsConfig = {
  docs: groupsOf(registry.groups.filter((group) => !GUIDES.includes(group.id))),
  guides: groupsOf(registry.groups.filter((group) => GUIDES.includes(group.id))),
};

export default sidebars;
