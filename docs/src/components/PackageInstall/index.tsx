import { CopyButton } from '@site/src/theme/CodeBlock/Layout';
import React, { useState } from 'react';

const MANAGERS = [
  { id: 'npm', command: (name: string) => `npm install ${name}` },
  { id: 'yarn', command: (name: string) => `yarn add ${name}` },
  { id: 'pnpm', command: (name: string) => `pnpm add ${name}` },
];

// The install block of the DocsPage board: the package managers as tabs in the header of the code block.
export default function PackageInstall({ name = '@apexnative/keychain' }: { name?: string }) {
  const [manager, setManager] = useState('npm');
  const command = MANAGERS.find((m) => m.id === manager)!.command(name);
  return (
    <div className="cb cb--plain">
      <div className="cb__head">
        <div role="tablist" aria-label="Package manager" className="cb__tabs">
          {MANAGERS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={manager === m.id}
              className={manager === m.id ? 'cb__tab cb__tab--on' : 'cb__tab'}
              onClick={() => setManager(m.id)}
            >
              {m.id}
            </button>
          ))}
        </div>
        <CopyButton text={command} />
      </div>
      <pre className="cb__plain">
        <span className="cb__prompt">$</span> {command}
      </pre>
    </div>
  );
}
