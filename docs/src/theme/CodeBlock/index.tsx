import CodeBlock from '@theme-original/CodeBlock';
import type { Props } from '@theme/CodeBlock';
import React, { createContext, useContext } from 'react';

// A block whose meta has `preview` (```ts title="auth.ts" preview) shows the API before the package has it: its
// header carries a Preview tag. The metadata of the code block context has no metastring, so it travels in a context.
const PreviewContext = createContext(false);

export function usePreview(): boolean {
  return useContext(PreviewContext);
}

export default function CodeBlockWrapper(props: Props & { metastring?: string }) {
  const preview = /(^|\s)preview(\s|$)/.test(props.metastring ?? '');
  return (
    <PreviewContext.Provider value={preview}>
      <CodeBlock {...props} />
    </PreviewContext.Provider>
  );
}
