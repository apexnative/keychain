import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import type { PrismTheme } from 'prism-react-renderer';
import pkg from '../package.json';

// The docs describe the version of package.json. Until the package is published (0.x) and until it is a stable
// release (1.0.0-alpha.0, 2.0.0-rc.1) every page of the docs and of the API reference carries the banner of
// src/theme/DocVersionBanner; a stable version has none. When a released version is kept with `docusaurus
// docs:version`, this one stays the current docs and the banner links to the released one.
const VERSION = pkg.version;
const UNRELEASED = VERSION.startsWith('0.') || VERSION.includes('-');
// Nothing is on npm before 1.0: the version pill says what the docs are instead of 0.0.0.
const LABEL = VERSION.startsWith('0.') ? 'preview' : VERSION;
const CURRENT_VERSION = {
  label: LABEL,
  banner: UNRELEASED ? 'unreleased' : 'none',
} as const;

// The code blocks are dark in both themes: navy with the brand colors.
const codeTheme: PrismTheme = {
  plain: { color: '#F3E9D2', backgroundColor: '#101828' },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: '#8C9AB5', fontStyle: 'italic' },
    },
    {
      types: ['keyword', 'operator', 'boolean', 'important', 'atrule'],
      style: { color: '#F4A261' },
    },
    { types: ['function', 'class-name', 'builtin'], style: { color: '#E9B949' } },
    { types: ['string', 'char', 'attr-value', 'regex', 'url'], style: { color: '#7FE0C4' } },
    { types: ['tag', 'selector', 'number', 'constant', 'symbol'], style: { color: '#8CC4E8' } },
    { types: ['attr-name', 'property'], style: { color: '#F3E9D2' } },
    { types: ['punctuation'], style: { color: '#B5A88C' } },
  ],
};

const config: Config = {
  title: 'keychain',
  tagline: 'Secure storage for React Native',
  favicon: 'img/keychain.svg',
  url: 'https://keychain.apexnative.dev',
  baseUrl: '/',
  organizationName: 'apexnative',
  projectName: 'keychain',
  // A broken link or anchor stops the build: the pages link to each other by anchor.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  // The home page shows the version and its stage.
  customFields: { version: VERSION },
  clientModules: [require.resolve('./src/fonts.ts')],
  presets: [
    [
      'classic',
      {
        docs: {
          path: 'content',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/apexnative/keychain/edit/main/docs/',
          showLastUpdateTime: false,
          versions: { current: CURRENT_VERSION },
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'api',
        path: 'reference',
        routeBasePath: 'api',
        sidebarPath: './sidebars-api.ts',
        // The reference is written by hand, page by page, and edited as the docs are.
        editUrl: 'https://github.com/apexnative/keychain/edit/main/docs/',
        // The reference pages draw their own breadcrumbs, with the section in them (src/components/Api).
        breadcrumbs: false,
        versions: { current: CURRENT_VERSION },
      },
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'keychain',
      logo: { alt: 'keychain', src: 'img/keychain.svg' },
      items: [
        {
          type: 'html',
          position: 'left',
          value: `<button type="button" class="ver" aria-label="Version ${LABEL}">${LABEL} ▾</button>`,
        },
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs' },
        {
          type: 'docSidebar',
          sidebarId: 'api',
          docsPluginId: 'api',
          position: 'left',
          label: 'API',
        },
        { type: 'docSidebar', sidebarId: 'guides', position: 'left', label: 'Guides' },
        { href: 'https://apexnative.dev', position: 'left', label: 'apexnative.dev ↗' },
        { type: 'custom-search', position: 'right' },
        {
          type: 'html',
          position: 'right',
          value:
            '<a class="iconbtn" href="https://github.com/apexnative/keychain" aria-label="Repository on GitHub"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="6" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 7.2 V16.8 M18 9.2 C18 14 9 12 6.6 16.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></a>',
        },
      ],
    },
    docs: { sidebar: { hideable: false, autoCollapseCategories: false } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    prism: {
      theme: codeTheme,
      darkTheme: codeTheme,
      additionalLanguages: ['bash', 'json', 'swift', 'kotlin', 'java', 'objectivec'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
