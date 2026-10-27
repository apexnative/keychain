# Writing a page

How a page is written so that a developer learns from it, finds what they need, and trusts it. The model is the
documentation of React Native (reactnative.dev) and Expo (docs.expo.dev): a reader of this library knows them, and
expects the same depth and order. Read this before writing or changing a page, and before an audit
(`audit.md`).

A page is not filled from a template. The headings below are the usual order, not a form: a page has the parts its
subject needs. What every page must do is in "Think first" and "Before the page is done".

## The reader

A React Native developer. They know React and React Native, often react-native-keychain or expo-secure-store; they
may not know the iOS Keychain's accessibility classes, `SecAccessControl`, the Android Keystore or BiometricPrompt.
They come to:

- **learn** — the first time, reading from the top: the top of the page teaches them;
- **do a task** — "how do I keep a refresh token behind Face ID", "how do I move from react-native-keychain": a guide
  answers it end to end;
- **look something up** — from search or a link, landing on a heading: the reference and the anchors serve them.

**You** is the reader, the developer. **The user** is the person who uses the app. Never mix them.

## Think first

Before the first line, answer these for the subject of the page. The answers become sections, examples and warnings.
A page that skipped this is the "template" kind of page this project doesn't want.

1. **The situation.** What is the reader building when they need this? Name it in app terms: "the app signs the user in
   again with Face ID after a restart", not "`getItem` with `accessControl`".
2. **What they already know.** The react-native-keychain or expo-secure-store way of doing it. Where this library
   differs, say so and show both (`<Pair>`). Where it is the same, say that in one sentence: it saves them reading.
3. **The mental model.** One sentence of where the secret lives and what a call means: "the item lives in the
   Keychain, encrypted by the system; `accessControl` is fixed when it is written, and every read asks for it".
4. **What breaks.** What does a reader try first, and what happens? A read in the background of a `whenUnlocked` item,
   a write of a biometric item on a device without biometry, a new fingerprint and an item that is gone, a read that
   waits for a prompt the user never sees. Each becomes a section named after the situation, with the naive code, why
   it fails, and the fix.
5. **The security model.** What the option protects against and what it doesn't (`docs/content/security/`): a stolen
   unlocked phone, a backup, another app, a rooted device. Never promise more than the platform gives.
6. **The platforms.** What iOS and Android each do, what one of them can't do and what happens there instead (an
   error, never a weaker item), from which OS version. Check it in the code (`ios/`, `android/`) and the tests, not by
   guessing.
7. **Time.** When does it run, and what changed meanwhile: the first unlock after a restart, the app in the
   background, a prompt open when the app leaves, `authValidity` running out, the biometry changed, the app reinstalled
   (the iOS Keychain outlives the app), a backup restored on another device.
8. **The what-ifs.** The questions a reader will ask next ("what if the user cancels?", "what if the item is
   missing?", "what if I call it twice at once?"). Answer them in the same section, or link to where they are.
9. **Other libraries.** Which libraries touch the subject (MMKV and SQLCipher for a database key, Expo and its config
   plugins, react-native-keychain and expo-secure-store for migration, Jest), and what they need here. Verify it in
   their own source or docs.
10. **What to leave out.** What belongs on another page: link to it instead of repeating.

## The kinds of pages

Each group has a kind; a page keeps to it, and links to the other kinds.

| Group                       | Kind            | The reader asks                                |
| --------------------------- | --------------- | ---------------------------------------------- |
| `start/introduction`        | Explanation     | What is this, and is it for me?                |
| `start/installation`        | How-to          | How do I add it to my app?                     |
| `start/quick-start`         | Tutorial        | Show me it working.                            |
| `fundamentals`              | Concept + usage | How does this part work, and how do I use it?  |
| `guides`                    | Guide           | How do I build this in my app?                 |
| `migration`                 | How-to          | I use another library; how do I move?          |
| `security`                  | Explanation     | What does this protect against, and how?       |
| `help`                      | Lookup          | What does this code mean? Why does this break? |
| `docs/reference/` (the API) | Reference       | What exactly does this take, return and do?    |

### Tutorial (Quick start)

One path, no alternatives. Motivation in the first paragraph; each `##` adds one idea to the same running example,
the changed lines marked with `// highlight-next-line` or `{3-5}` in the code fence. Ends with a **Summary** — every
term linked to its reference — and **What's next**.

### Concept + usage page (fundamentals)

1. The situation in one to three sentences, then the API that handles it, then the smallest example that works, and
   what the user sees (a prompt or none).
2. The mental model in one sentence, before the second example.
3. From the common to the rare: the usual use → the variations → the platforms → over time.
   One idea per `##`, each adding to what came before.
4. The pitfalls, each a `##`/`###` named after the situation ("Reading in the background").
5. A short list of what to read next, and the reference pages it uses, linked.

It shows the use; every option, method and default is in the reference, linked, not repeated.

### Guide (guides, migration)

A guide answers one real task, start to finish, in the reader's app.

1. **The goal** in one or two sentences, and what the result looks like for the user.
2. **What you need**: the versions, the pages to know first (linked), what the reader's app already has.
3. **How it will work**: the plan in a short list, before any code, so the reader knows where each step leads.
4. **Steps**, `##` each, numbered when the order matters. Each step: why, the code (a complete file the first time,
   then the changed part), what the user sees now.
5. **The nuances**, each a `##` named after the situation: what breaks, the platform differences, the what-ifs.
6. **The whole code** at the end when the guide built it in pieces, and **What's next**.

### Explanation (security, introduction)

What the threat or the choice is, what the platform does about it, what this library adds or leaves to the platform,
and what an app still has to do. Claims cite the platform (Apple's Platform Security guide, the Android Keystore
docs) or the code.

### Reference page (`docs/reference/<section>/<Page>.mdx`)

Written by hand, as reactnative.dev and docs.expo.dev do it:

1. `<ApiHeader>`, then what it is for, in one or two sentences, and where it is used.
2. **Usage** (`## Usage {#usage}`): a complete, runnable example and what it does. A second example when there are two
   common ways.
3. `## Signature {#signature}`: the signature in a code block, `<Facts>` (what it returns, whether it shows a prompt,
   what it throws), `<Params>`, the return value.
4. One `##` per group of members, in the order a reader needs them ("Values", "Without a prompt", "Synchronous"), and
   under it a `###` per member with its anchor, ``### `getItem` {#getItem}``: what it does and why one uses it; the
   values, as a list when there are several; the default and the platform in a sentence when they matter; a short
   example when the value isn't obvious from its type; how it works with the other members; what breaks.
5. The behavior over time and the caveats of the whole export, then `## See also {#see-also}` with `<SeeAlso>`: the
   concept page and the guides.

The JSDoc in `src/` stays short — one or two sentences, the facts — because it shows in the editor. The reference
page explains.

## Making it easy to learn

- **The situation before the API, an example before the rule.** A reader understands a rule faster from one concrete
  case than from its general statement.
- **One new thing at a time.** Each example adds one thing to what the reader has seen. A first example that sets
  five options teaches none of them.
- **Say why.** A rule comes with its reason: "an item that needs the device unlocked can't be read by a background
  task, so a token a headless task refreshes is `afterFirstUnlock`". A reader who knows why applies it to cases the
  page doesn't list.
- **Show the result.** After the code, what the user sees and does: "Face ID asks once; the second read, within
  `authValidity`, doesn't".
- **Show the wrong way next to the right one,** when readers will try it: the naive code with a `// Don't` comment,
  why it fails, then the fix.
- **Nothing used before it is explained or linked.** Link to the exact anchor.
- **The common case first.** Rare options go to the end or to the reference.

## Words

- One word for one thing, everywhere: item, key, value, store (a `createKeychain` instance), service, prompt,
  biometry, passcode, access control.
- Plain, short sentences; present tense; active voice. "You" in tutorials and guides; elsewhere the API, the app or the
  user acts.
- Headings say what is under them, in the reader's words: a task, a situation, a thing. Never "Notes", "Details",
  "Advanced". Sentence case. Every `##`/`###` has an explicit anchor `{#id}`.
- No "simply", "just", "easily", "obviously". No "secure" without saying against what.
- Admonitions with fixed meanings, few per page: `info` where something lives elsewhere, `tip` a recommendation,
  `note` an edge case or a platform detail, `warning` what loses data or weakens a secret. The main rule of a section
  is never only in an admonition.
- Site components, no new styles: `Mark`, `Os`, `Pair`, `Steps` (`docs/src/components/Intro`), `Tabs`/`TabItem` of
  Docusaurus for variants (npm/Yarn, iOS/Android, Expo/bare).

## Code

- **The real API.** Every name and signature checked against `src/`. An example that doesn't compile is the worst
  error a page can have. Every name an example uses is imported in it or in an earlier example on the page.
- **Complete files** for the first example of a page and of a guide step: imports and `title="src/…"`. Later ones may
  be the changed part, with `// …` for the rest. Complete examples 20–50 lines; one longer example per page at most,
  last.
- At most 72 characters per line. Neutral names: `accessToken`, `refreshToken`, `pin`, a store `vault`.
- What the reader writes themselves is marked: `// your own API call`. A secret in an example is never a literal that
  looks real. Third-party libraries are used with their real, current API, checked in their docs.

## Platforms

Where behavior differs, `<Os name="…" />` next to the behavior, or a table when several differ. Where a platform can't
do something, the page says what happens there instead, and from which version.

## Before the page is done

- The first screen: a new reader knows what this is for and sees working code.
- Every point of "Think first" is answered on the page or knowingly left to another page, with a link.
- Every example checked against `src/` and the third-party library's API; every name imported.
- Every member of a reference page has its `###`, an explanation, and an example where the value isn't obvious.
- Headings say what is under them; anchors set; links resolve: `scripts/docs.sh build`.
