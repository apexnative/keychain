# Auditing a page

Finds what makes a page wrong or hard to learn from, against `writing.md`, and reports it. An audit changes nothing:
the user answers the findings, and the fixes follow in a separate step.

## Read first

- The page, and its place in `docs/sections.json` (for a reference page: its section's `status`, `guide`, `docs`).
- The API it shows: the exports in `src/` with their JSDoc, and the native code where the page states behavior.
- The pages it links to, and the pages that explain the same things.
- A reference section with `status: "stable"` was approved by the user: findings only; a change to it needs the
  user's yes.

## Check, in this order

0. **Thought through.** Go through "Think first" of `writing.md` for the page's subject yourself, and list what the
   page doesn't answer: the pitfall nobody named, the platform it is silent about, the moment in time it forgets (a
   restart, the background, a new fingerprint, a reinstall), the library readers will combine it with, the what-if.
   These are usually the most valuable findings.

1. **Correct.** Every name, signature and example matches `src/`; what the page says about behavior and errors matches
   the code and the tests, or the finding says it is not verified; what it says about security doesn't promise more
   than the platform gives; links and anchors resolve (the build fails on broken ones). Every name an example uses is
   imported in it or in an example before it on the page.
2. **The kind.** The page does the job of its group (`writing.md`, "The kinds of pages"); no tutorial inside a
   concept page, no long why inside a how-to.
3. **The opening.** A new reader knows from the first screen what this is for and sees a working example.
4. **The order.** From the common to the rare; nothing used before it is explained.
5. **Learning.** An example before the rule; one new thing per example; the why of each rule; the result after the
   code.
6. **Terms.** One word per thing, the same as on the other pages; defined or linked at the first use.
7. **Scanning.** Headings say what is under them; paragraphs of one idea; lists and tables where items are parallel;
   admonitions only for what can be skipped.
8. **Sentences.** Plain and short; who acts ("you" and "the user"); filler words.
9. **Code.** 72 characters; imports and file titles; neutral names; complete enough to paste.
10. **Platforms.** Every difference named next to the behavior, with the OS version.
11. **The reference of the section.** Its pages in `docs/reference/` against "Reference page" in `writing.md`: every
    member explained with its why and an example where the value isn't obvious; an export without a page is a finding.

## Severity

- **Error:** the page is wrong. An example that doesn't compile, a claim the code contradicts, a security promise the
  platform doesn't keep, a broken link.
- **Blocks:** a reader gets stuck. A term used before it is explained, the common case buried under the rare, no
  example for the main use, two kinds mixed.
- **Slows:** readable, but harder than it needs to be. A long paragraph, a vague heading, a caveat before the rule.
- **Wording:** small fixes of words. Given as one list per page, not one finding each.

## A finding

- An id: the page's id and a number, `protection.3`.
- Where: the heading and its anchor, or the line.
- What is wrong, with the fragment quoted (short), and which rule of `writing.md` it breaks.
- The fix: the new text or the new order, concrete. Where there is a real choice, options а/б with a recommendation.

A remark that no rule of `writing.md` backs, or without a concrete fix, is not a finding. A rule that turns out wrong
or missing is reported as a finding on `writing.md` itself.

## The report

To the user, in the language of the conversation; quotes from the page stay in English.

```
### <Page title> — <kind> — <draft | review | stable>

Works: <what to keep, in one line>.

1. protection.1 — Error — #accessible
   <what is wrong, the quote, the rule>
   Fix: <the new text> | а) … б) … — recommended: а
2. …

Wording: <short list>.
```

After the pages: the findings across pages (terms that differ, the same thing explained twice in different words, a
concept with no page), then the answer format: «protection.1 — а; protection.4 — б; the rest as recommended».

## Many pages

One group at a time, the groups in the order of `sections.json`. The findings across pages come once, at the end.
