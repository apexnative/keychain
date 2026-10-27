#!/usr/bin/env node
// Tells ahead of time that a new React Native version is out, so its work starts before apps ask for it. It takes the
// newest of npm's `latest` and `next` whose minor is newer than the one the repository builds with (devDependencies of
// package.json), or the version given as an argument. Each minor gets one issue, `React Native <minor>`, labeled
// `react-native`; every later version of that minor (a new RC, the release, a patch) adds a comment to it. Each version
// leaves a marker in the issue, so it is reported once. The issues of a minor the repository has moved to are closed.
// An issue closed before that (the minor is supported while the repository still builds with the older one) stays
// closed and still takes the later versions as comments: the minor gets no second issue.
// `--dry-run` prints what it would do. Needs `gh` with access to the repository.
//
// Usage: node scripts/rn-watch.mjs [--dry-run] [version]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LABEL = 'react-native';
const marker = (version) => `<!-- rn-watch: ${version} -->`;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const requested = args.find((arg) => arg !== '--dry-run');

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: 'utf8' });
const gh = (...ghArgs) => {
  if (dryRun) {
    console.log(`would run: gh ${ghArgs.join(' ')}`);
    return '';
  }
  return run('gh', ghArgs);
};

// "<major>.<minor>.<patch>[-<prerelease>]" → its minor, its three numbers and the parts of the prerelease.
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  if (!match) throw new Error(`Not a React Native version: ${version}`);
  const pre = match[4]
    ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  return { minor: `${match[1]}.${match[2]}`, parts: match.slice(1, 4).map(Number), pre };
}

// A release is newer than its prereleases; prereleases compare part by part.
function compare(a, b) {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] - pb.parts[i];
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const [x, y] = [pa.pre[i], pb.pre[i]];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    return typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y));
  }
  return 0;
}

const newerMinor = (a, b) => compare(`${parse(a).minor}.0`, `${parse(b).minor}.0`) > 0;
const minorOf = (title) => /^React Native (\d+\.\d+)$/.exec(title)?.[1];

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const current = pkg.devDependencies['react-native'];

const issues = JSON.parse(
  run('gh', [
    'issue',
    'list',
    '--label',
    LABEL,
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    'number,title,state,body,comments',
  ])
);

for (const issue of issues) {
  const minor = minorOf(issue.title);
  if (issue.state === 'OPEN' && minor && !newerMinor(`${minor}.0`, current)) {
    console.log(`#${issue.number} React Native ${minor}: the repository builds with ${current}`);
    gh(
      'issue',
      'close',
      String(issue.number),
      '--comment',
      `The repository builds with ${current} now.`
    );
  }
}

let version = requested;
if (!version) {
  const tags = JSON.parse(run('npm', ['view', 'react-native', 'dist-tags', '--json']));
  version = [tags.latest, tags.next]
    .filter((tag) => tag && newerMinor(tag, current))
    .sort(compare)
    .at(-1);
}
if (!version) {
  console.log(`No React Native newer than ${current}`);
  process.exit(0);
}

const minor = parse(version).minor;
const sameMinor = issues.filter((item) => minorOf(item.title) === minor);
const issue = sameMinor.find((item) => item.state === 'OPEN') ?? sameMinor[0];
const texts = issue ? [issue.body, ...issue.comments.map((comment) => comment.body)] : [];
if (texts.some((text) => text.includes(marker(version)))) {
  console.log(`React Native ${version}: already in #${issue.number}`);
  process.exit(0);
}

const tag = version.includes('-') ? 'a prerelease' : 'a release';
const links = [
  `- npm: https://www.npmjs.com/package/react-native/v/${version}`,
  `- Release notes: https://github.com/react/react-native/releases/tag/v${version}`,
  `- Upgrade Helper: https://react-native-community.github.io/upgrade-helper/?from=${current}&to=${version}`,
].join('\n');

if (issue) {
  console.log(`React Native ${version}: a comment in #${issue.number}`);
  gh(
    'issue',
    'comment',
    String(issue.number),
    '--body',
    `${marker(version)}\nReact Native ${version} is on npm, ${tag}.\n\n${links}`
  );
} else {
  console.log(`React Native ${version}: a new issue`);
  gh(
    'label',
    'create',
    LABEL,
    '--force',
    '--color',
    '61DAFB',
    '--description',
    'A React Native version the repository does not build with yet'
  );
  gh(
    'issue',
    'create',
    '--label',
    LABEL,
    '--title',
    `React Native ${minor}`,
    '--body',
    [
      marker(version),
      `React Native ${version} is on npm, ${tag}; the repository builds with ${current}.`,
      '',
      links,
      '',
      `Check the library on ${minor} on iOS and Android, and prepare what it needs before apps ` +
        `move to it. Later versions of ${minor} are added here as comments; the issue closes when the repository ` +
        `builds with ${minor}.`,
    ].join('\n')
  );
}
