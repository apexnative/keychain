import React, { type ReactNode } from 'react';

// The content column of the boards: the page and its "On this page", without Infima's container.
export default function DocRootLayoutMain({
  children,
}: {
  hiddenSidebarContainer: boolean;
  children: ReactNode;
}) {
  return <main className="doc-main">{children}</main>;
}
