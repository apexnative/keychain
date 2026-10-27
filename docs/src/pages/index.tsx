import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import styles from './index.module.css';

// The docs home, in the layout of navigation's (the DocsHome board of the brand canvas): the hero, the rules, what the
// package keeps, and the way from a token to a vault. keychain's own are the vault of the hero and the steel blue.

const RULES: [string, string, string][] = [
  [
    'One meaning on both platforms',
    'An option means the same on iOS and Android. A platform that can’t do it throws, so shared code never needs a Platform.select to stay safe.',
    '#457B9D',
  ],
  [
    'Never weaker, never silent',
    'If the device can’t give the protection you asked for, the write fails. A value is never stored with less than you asked.',
    '#D1495B',
  ],
  [
    'Biometrics locks the value',
    'Face ID or a fingerprint unlocks the key that decrypts the item, inside the Secure Enclave or the TEE. There is no boolean to fake.',
    '#E9B949',
  ],
  [
    'Writes never prompt',
    'Storing a value never shows a prompt on either platform. Only reading a protected item does, and the OS draws it.',
    '#2A9D8F',
  ],
  [
    'Errors you can act on',
    'A missing value is null. A changed fingerprint set is KEY_INVALIDATED, not null. Every failure has a code.',
    '#5FA8D3',
  ],
  [
    'Nothing at startup',
    'The module does no work when it loads: a service is read the first time you use it, and reads without a prompt never wait for one.',
    '#9C89B8',
  ],
  [
    'New Architecture, bare and Expo',
    'A TurboModule with a typed codegen spec, for React Native 0.80 and newer: bare apps and Expo dev builds alike.',
    '#F4A261',
  ],
];

// The same field of stars on every load: a seeded generator, as on the navigation site.
function makeStars() {
  let seed = 23;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 60 }, () => ({
    x: (rnd() * 100).toFixed(2),
    y: (rnd() * 92).toFixed(2),
    r: (1 + rnd() * 2).toFixed(1),
    d: (rnd() * 5).toFixed(2),
  }));
}

type VaultState = 'locked' | 'scan' | 'open';

// A read every 12 seconds: the item is locked, Face ID scans, the key turns and the value comes out, then it locks
// again. A reader who asked for less motion sees the vault locked.
function useRead(): VaultState {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const phase = tick % 12;
  return phase >= 7 && phase < 11 ? 'open' : phase >= 5 && phase < 7 ? 'scan' : 'locked';
}

const STATUS: Record<VaultState, string> = { locked: 'LOCKED', scan: 'FACE ID', open: 'UNLOCKED' };

// The rivets of the icon's ring: eight at 22.5° + 45°·k.
const RIVETS = Array.from({ length: 8 }, (_, k) => {
  const a = ((22.5 + 45 * k) * Math.PI) / 180;
  return { cx: (32 + 26.5 * Math.cos(a)).toFixed(2), cy: (32 + 26.5 * Math.sin(a)).toFixed(2) };
});

function Vault() {
  const state = useRead();
  return (
    <div className={styles.vault} aria-hidden="true">
      <div className={styles.status}>
        <span className={styles.statusLabel}>vault · accessToken</span>
        <span className={clsx(styles.statusValue, state === 'open' && styles.statusOpen)}>
          {STATUS[state]}
        </span>
      </div>

      <div className={styles.porthole}>
        <svg viewBox="0 0 64 64" className={styles.ring}>
          <circle cx="32" cy="32" r="30" fill="#457B9D" />
          {RIVETS.map((r) => (
            <circle key={r.cx + r.cy} cx={r.cx} cy={r.cy} r="1.3" fill="#F3E9D2" opacity="0.85" />
          ))}
          <circle cx="32" cy="32" r="23" fill="#1E2A44" />
          <circle
            cx="32"
            cy="32"
            r="23"
            style={{ fill: 'none', stroke: '#F3E9D2', strokeWidth: 0.6, strokeOpacity: 0.45 }}
          />
          <circle cx="19" cy="23" r="0.5" fill="#F3E9D2" />
          <circle cx="46" cy="20" r="0.55" fill="#F3E9D2" />
          <circle cx="44" cy="45" r="0.45" fill="#F3E9D2" />
          <circle cx="21" cy="44" r="0.5" fill="#F3E9D2" />
          <path
            d="M14 28 A18 18 0 0 1 28 14"
            style={{
              fill: 'none',
              stroke: '#F3E9D2',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
              strokeOpacity: 0.22,
            }}
          />
          <g className={clsx(styles.scan, state === 'scan' && styles.scanOn)}>
            <circle
              cx="32"
              cy="32"
              r="20.5"
              className={styles.scanRing}
              style={{ fill: 'none', stroke: '#E9B949', strokeWidth: 0.9 }}
            />
            <path
              d="M17 22 V17 H22 M42 17 H47 V22 M47 42 V47 H42 M22 47 H17 V42"
              style={{
                fill: 'none',
                stroke: '#E9B949',
                strokeWidth: 1.2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              }}
            />
          </g>
        </svg>
        <svg viewBox="0 0 64 64" className={clsx(styles.key, state === 'open' && styles.keyTurned)}>
          <rect x="29.9" y="29" width="4.2" height="20" rx="2.1" fill="#F3E9D2" />
          <path d="M33.8 40.4 H39.6 V43.1 H37.2 V44.9 H40 V48 H33.8 Z" fill="#E9B949" />
          <circle cx="32" cy="21" r="8.4" fill="#F3E9D2" />
          <circle
            cx="32"
            cy="21"
            r="3.4"
            fill="#1E2A44"
            style={{ stroke: '#457B9D', strokeWidth: 1.5 }}
          />
          <rect x="28" y="28.4" width="8" height="3.2" rx="1.6" fill="#457B9D" />
        </svg>
      </div>

      <div className={clsx(styles.chip, state === 'open' && styles.chipOut)}>
        <span className={styles.chipKey}>getItem</span> → 'eyJhbGciOiJFUzI1NiJ9…'
      </div>
    </div>
  );
}

const DRAW = { fill: 'none', strokeWidth: 2.5 };
const LINE = { fill: 'none', strokeWidth: 2.5, strokeLinecap: 'round' as const };
const CARD = { fill: 'var(--an-surface2)', strokeWidth: 2.5 };

const TILES: { title: string; text: string; to: string; art: React.ReactNode }[] = [
  {
    title: 'Tokens',
    text: 'Strings by key: setItem, getItem, removeItem.',
    to: '/docs/fundamentals/storage-model',
    art: (
      <>
        <rect x="28" y="20" width="64" height="60" rx="10" stroke="currentColor" style={CARD} />
        <path d="M40 38 H66 M40 48 H58" stroke="currentColor" opacity="0.4" style={LINE} />
        <circle cx="76" cy="62" r="8" fill="#457B9D" />
        <path d="M76 58 V63" style={{ ...LINE, stroke: '#F3E9D2', strokeWidth: 2.2 }} />
      </>
    ),
  },
  {
    title: 'Bytes',
    text: 'Uint8Array values, such as the key of an encrypted database.',
    to: '/docs/guides/encryption-key',
    art: (
      <>
        {[0, 1, 2].flatMap((row) =>
          [0, 1, 2, 3].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={30 + col * 16}
              y={22 + row * 20}
              width="12"
              height="14"
              rx="3"
              stroke="currentColor"
              style={(row + col) % 3 === 0 ? { fill: '#457B9D', strokeWidth: 2 } : DRAW}
              opacity={(row + col) % 3 === 0 ? 1 : 0.55}
            />
          ))
        )}
      </>
    ),
  },
  {
    title: 'Credentials',
    text: 'A username in the clear, the password behind Face ID.',
    to: '/docs/fundamentals/storage-model#credentials',
    art: (
      <>
        <rect x="24" y="18" width="72" height="64" rx="10" stroke="currentColor" style={CARD} />
        <circle cx="46" cy="40" r="8" stroke="currentColor" style={DRAW} />
        <path d="M33 62 C35 52 57 52 59 62" stroke="currentColor" style={LINE} />
        <path d="M66 38 H84" stroke="currentColor" opacity="0.4" style={LINE} />
        <circle cx="68" cy="56" r="2.6" fill="#457B9D" />
        <circle cx="76" cy="56" r="2.6" fill="#457B9D" />
        <circle cx="84" cy="56" r="2.6" fill="#457B9D" />
      </>
    ),
  },
  {
    title: 'Biometrics',
    text: 'Face ID, Touch ID and fingerprints, bound to the item.',
    to: '/docs/fundamentals/biometrics',
    art: (
      <>
        <path d="M44 72 C40 62 40 40 60 36 C78 34 82 50 80 62" stroke="currentColor" style={LINE} />
        <path d="M52 76 C48 66 48 48 60 46 C70 46 72 56 70 68" stroke="#457B9D" style={LINE} />
        <path d="M60 56 C60 64 62 72 66 78" stroke="currentColor" opacity="0.55" style={LINE} />
        <path
          d="M36 52 C38 34 50 26 64 26 C74 26 82 32 86 40"
          stroke="currentColor"
          opacity="0.35"
          style={LINE}
        />
      </>
    ),
  },
  {
    title: 'Sync reads',
    text: 'getItemSync for items without a prompt, on the JS thread.',
    to: '/docs/fundamentals/sync-api',
    art: (
      <>
        <circle cx="60" cy="50" r="30" stroke="currentColor" style={CARD} />
        <path
          d="M64 28 L48 54 H60 L56 72 L72 46 H60 Z"
          fill="#E9B949"
          stroke="currentColor"
          style={{ strokeWidth: 2, strokeLinejoin: 'round' }}
        />
      </>
    ),
  },
  {
    title: 'Migration',
    text: 'Move items from react-native-keychain and expo-secure-store.',
    to: '/docs/migration/from-react-native-keychain',
    art: (
      <>
        <rect
          x="14"
          y="30"
          width="34"
          height="40"
          rx="8"
          stroke="currentColor"
          opacity="0.55"
          style={DRAW}
        />
        <rect x="72" y="30" width="34" height="40" rx="8" stroke="currentColor" style={CARD} />
        <path
          d="M52 50 H66 M60 43 L67 50 L60 57"
          stroke="#457B9D"
          style={{ ...LINE, strokeLinejoin: 'round' }}
        />
        <circle cx="89" cy="50" r="5" fill="#457B9D" />
      </>
    ),
  },
];

function Mono({ children }: { children: React.ReactNode }) {
  return <span className={styles.inlineMono}>{children}</span>;
}

// The stage by the version: before the first release the docs are a preview; a pre-release has its tag (1.0.0-alpha.2).
const STAGES: Record<string, string> = { alpha: 'Alpha', beta: 'Beta', rc: 'Release candidate' };

export default function Home(): React.JSX.Element {
  const stars = useMemo(makeStars, []);
  const version = String(useDocusaurusContext().siteConfig.customFields?.version ?? '0.0.0');
  const preview = version.startsWith('0.');
  const stage = /-(alpha|beta|rc)\b/.exec(version)?.[1];
  return (
    <Layout
      title="Secure storage for React Native"
      description="The iOS Keychain and the Android Keystore behind one API, with the same protection on both platforms."
    >
      <div className={clsx('home-page', styles.page)}>
        <section className={styles.hero}>
          <div className={styles.stars} aria-hidden="true">
            {stars.map((s, i) => (
              <span
                key={i}
                className={styles.star}
                style={{
                  left: `${s.x}%`,
                  top: `${s.y}%`,
                  width: `${s.r}px`,
                  height: `${s.r}px`,
                  animationDelay: `${s.d}s`,
                }}
              />
            ))}
          </div>
          <div className={styles.heroInner}>
            <div className={styles.heroText}>
              <div className={styles.eyebrow} style={{ color: '#E9B949' }}>
                @apexnative/keychain
              </div>
              <h1 className={styles.heroTitle}>Secure storage for React Native</h1>
              <p className={styles.heroLead}>
                The iOS Keychain and the Android Keystore behind one API. Every option means the
                same on both platforms, and protection is never lowered in silence.
              </p>
              <div className={styles.buttons}>
                <Link className={clsx(styles.btn, styles.btnPrimary)} to="/docs/start/quick-start">
                  Get started
                </Link>
                <Link className={clsx(styles.btn, styles.btnGhost)} to="/api/overview">
                  API reference
                </Link>
              </div>
              <div className={styles.pills}>
                <span className={styles.pill} style={{ background: '#E9B949', color: '#101828' }}>
                  {preview ? 'In development' : stage ? STAGES[stage] : 'Stable'}
                </span>
                <span className={clsx(styles.pill, styles.pillDim)}>
                  {preview ? 'npm · not published yet' : `npm · ${version}`}
                </span>
                <span className={clsx(styles.pill, styles.pillDim)}>iOS · Android · Expo</span>
              </div>
            </div>
            <Vault />
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 1440 60"
            preserveAspectRatio="none"
            className={styles.horizon}
          >
            <path d="M0 60 V34 Q720 0 1440 34 V60 Z" />
          </svg>
        </section>

        <section className={styles.rulesSection}>
          <div className={styles.eyebrow} style={{ color: 'var(--an-link)' }}>
            Vault rules
          </div>
          <h2 className={styles.h2}>How it is built</h2>
          <div className={styles.rules}>
            {RULES.map(([title, text, color], i) => (
              <article
                key={title}
                className={styles.rule}
                style={{ boxShadow: `0 5px 0 ${color}` }}
              >
                <span className={styles.ruleNumber} style={{ background: color }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.ruleTitle}>{title}</h3>
                <p className={styles.ruleText}>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.boardSection}>
          <div className={styles.eyebrow} style={{ color: 'var(--an-link)' }}>
            In the vault
          </div>
          <h2 className={styles.h2}>What it keeps</h2>
          <p className={styles.boardLead}>
            Keychain items on iOS, Keystore-encrypted files on Android. Your code sees one key/value
            store per service.
          </p>
          <div className={styles.tiles}>
            {TILES.map((tile) => (
              <Link key={tile.title} className={styles.tile} to={tile.to}>
                <svg aria-hidden="true" viewBox="0 0 120 100" className={styles.tileArt}>
                  {tile.art}
                </svg>
                <span className={styles.tileTitle}>{tile.title}</span>
                <span className={styles.tileText}>{tile.text}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.band}>
          <div className={styles.bandInner}>
            <div className={styles.bandText}>
              <div className={styles.eyebrow} style={{ color: 'var(--an-link)' }}>
                Turn the key
              </div>
              <h2 className={styles.h2}>From a token to a vault behind Face ID</h2>
              <ol className={styles.steps}>
                <li>
                  <span className={styles.stepNumber}>1</span>
                  <span className={styles.stepText}>
                    Keep a token with <Mono>keychain.setItem</Mono>.
                  </span>
                </li>
                <li>
                  <span className={styles.stepNumber}>2</span>
                  <span className={styles.stepText}>
                    Make a vault with <Mono>createKeychain</Mono> and an <Mono>accessControl</Mono>.
                  </span>
                </li>
                <li>
                  <span className={clsx(styles.stepNumber, styles.stepGo)}>3</span>
                  <span className={styles.stepText}>
                    Read from it: the OS shows the prompt, your code gets the value or an error.
                  </span>
                </li>
              </ol>
              <div className={styles.bandButton}>
                <Link className={clsx(styles.btn, styles.btnInk)} to="/docs/start/quick-start">
                  Read the quick start
                </Link>
              </div>
            </div>
            <div className={styles.bandCode}>
              <div className={styles.window}>
                <div className={styles.windowBar}>
                  <span className={styles.windowDot} style={{ background: '#457B9D' }} />
                  <span className={styles.windowDot} style={{ background: '#E9B949' }} />
                  <span className={styles.windowDot} style={{ background: '#2A9D8F' }} />
                  <span className={styles.windowFile}>src/session.ts</span>
                  {preview && <span className={styles.windowTag}>Preview</span>}
                </div>
                <pre className={styles.code}>
                  <span className={styles.tk}>import</span>{' '}
                  {'{ AccessControl, createKeychain, keychain } '}
                  <span className={styles.tk}>from</span>{' '}
                  <span className={styles.ts}>'@apexnative/keychain'</span>;{'\n\n'}
                  <span className={styles.tk}>await</span> keychain.
                  <span className={styles.tf}>setItem</span>(
                  <span className={styles.ts}>'accessToken'</span>, token);{'\n\n'}
                  <span className={styles.tk}>const</span> vault ={' '}
                  <span className={styles.tf}>createKeychain</span>
                  {'({\n'}
                  {'  service: '}
                  <span className={styles.ts}>'vault'</span>,{'\n'}
                  {'  accessControl: AccessControl.BiometryCurrentSet,\n'}
                  {'  prompt: { title: '}
                  <span className={styles.ts}>'Unlock your account'</span>
                  {' },\n'}
                  {'});\n\n'}
                  <span className={styles.tk}>await</span> vault.
                  <span className={styles.tf}>setItem</span>(
                  <span className={styles.ts}>'refreshToken'</span>, refresh);{' '}
                  <span className={styles.tc}>// no prompt</span>
                  {'\n'}
                  <span className={styles.tk}>const</span> value ={' '}
                  <span className={styles.tk}>await</span> vault.
                  <span className={styles.tf}>getItem</span>(
                  <span className={styles.ts}>'refreshToken'</span>);{' '}
                  <span className={styles.tc}>// Face ID</span>
                </pre>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
