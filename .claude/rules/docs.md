---
paths:
  - 'docs/**'
---

# The docs site

- Docusaurus, its own Yarn project (`docs/yarn.lock`, not a workspace). `scripts/docs.sh [typecheck | build]` checks
  it; `yarn --cwd docs start` runs the site (port 3000).
- Pages: `docs/content/<group>/<section>.mdx`; the folder is the group (`start`, `fundamentals`, `guides`,
  `migration`, `security`, `help`).
- The API reference is written by hand: `docs/reference/<section>/<Page>.mdx`, built with the components of
  `docs/src/components/Api` (`ApiHeader`, `Facts`, `Params`, `SeeAlso`). A change of the public API changes its page
  in the same pull request.
- `docs/sections.json` lists both: `groups` (the docs and the guides: `id`, `title`) and `api` (the reference: a
  section's `docs`, `labels`, `status` and the `guide` it links to). The sidebars read it; a page that isn't in it
  isn't on the site.
- Components of the site: `docs/src/components/` (`Api`, `Intro`, `PackageInstall`, `Search`); theme overrides in
  `docs/src/theme/`.
- Writing a page: `.claude/skills/docs/writing.md` (the `docs` skill). Think the subject through first (what breaks,
  the platforms, the security model, time, other libraries), the situation and an example before the rule, and why.
  Code lines at most 72 characters. Check the page in the dark theme too.
