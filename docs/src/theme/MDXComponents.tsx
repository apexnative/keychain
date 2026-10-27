import MDXComponents from '@theme-original/MDXComponents';
import React, { type ComponentProps } from 'react';

// A Markdown table sits in a rounded card that scrolls sideways on a phone (DocsPage, "What a root can be").
export default {
  ...MDXComponents,
  table: (props: ComponentProps<'table'>) => (
    <div className="table-box">
      <table {...props} />
    </div>
  ),
};
