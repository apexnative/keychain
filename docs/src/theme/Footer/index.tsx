import Link from '@docusaurus/Link';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import React from 'react';

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: 'Docs',
    links: [
      ['Quick start', '/docs/start/quick-start'],
      ['Storage model', '/docs/fundamentals/storage-model'],
      ['Protection', '/docs/fundamentals/protection'],
      ['Guides', '/docs/guides/overview'],
      ['From react-native-keychain', '/docs/migration/from-react-native-keychain'],
      ['Threat model', '/docs/security/threat-model'],
    ],
  },
  {
    title: 'API',
    links: [
      ['Overview', '/api/overview'],
      ['Storage', '/api/overview#storage'],
      ['Device capabilities', '/api/overview#device'],
      ['Errors', '/api/overview#errors'],
    ],
  },
  {
    title: 'Project',
    links: [
      ['GitHub', 'https://github.com/apexnative/keychain'],
      ['Issues', 'https://github.com/apexnative/keychain/issues'],
      ['apexnative.dev', 'https://apexnative.dev'],
    ],
  },
];

function Fleet() {
  return (
    <div className="footer__fleet-row">
      <span className="footer__fleet">
        <img src={useBaseUrl('/img/apexnative.svg')} alt="" width={26} height={26} />
        <span>Part of the apexnative fleet</span>
      </span>
      <span className="footer__license">MIT License · © 2026 ApexNative</span>
    </div>
  );
}

// The home page has the big footer of the DocsHome board; the other pages have the one row of DocsPage.
export default function Footer(): React.JSX.Element {
  const home = useLocation().pathname === useBaseUrl('/');
  const logo = useBaseUrl('/img/keychain.svg');
  if (!home) {
    return (
      <footer className="footer footer--row">
        <div className="footer__inner">
          <Fleet />
        </div>
      </footer>
    );
  }
  return (
    <footer className="footer footer--home">
      <div className="footer__inner footer__top">
        <div className="footer__brand">
          <div className="footer__brand-name">
            <img src={logo} alt="" width={40} height={40} />
            <span>keychain</span>
          </div>
          <p>
            Secure storage for React Native: the iOS Keychain and the Android Keystore behind one
            API.
          </p>
        </div>
        <nav aria-label="Footer" className="footer__columns">
          {COLUMNS.map((column) => (
            <div key={column.title} className="footer__column">
              <span className="footer__eyebrow">{column.title}</span>
              {column.links.map(([label, to]) => (
                <Link key={label} className="footer__link-an" to={to}>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="footer__inner footer__bottom">
        <Fleet />
      </div>
    </footer>
  );
}
