// The device check: the scenarios that need a person or a real phone, in the order a person goes through them, with
// what to do before each one on iOS and on Android. The "Device check" screen walks through it; the scenarios
// themselves are the ones the list runs.
import { Platform } from 'react-native';

/** What a person does, the same on both platforms or one list each. */
type Instructions = string[] | { ios: string[]; android: string[] };

/** One step of the device check: a scenario, and what to do before it, between its two runs and after it. */
export type Step = {
  id: string;
  /** The id of the scenario the step runs. */
  scenario: string;
  title: string;
  /** Why the step needs a real phone, in a sentence. */
  why: string;
  /** What to do before tapping Start. */
  before: Instructions;
  /** For a scenario that runs twice: what to do between the runs. */
  between?: Instructions;
  /** What to put back afterwards. */
  after?: Instructions;
  /** The question for the person, when the scenario leaves something to judge. */
  question?: string | { ios: string; android: string };
  /** Not needed for a release: the step changes the phone's settings. */
  optional?: boolean;
  /** The only platform the step exists on. */
  only?: 'ios' | 'android';
};

const STEPS: Step[] = [
  {
    id: 'auto',
    scenario: 'run-all',
    title: 'Everything without a prompt',
    why: 'Storage, sync calls, errors and device queries on the real Keychain or Keystore, which enforce what a simulator does not.',
    before: [
      'Nothing to do: about twenty scenarios run one after another, with no prompt. It takes a few seconds.',
    ],
  },
  {
    id: 'prompt',
    scenario: 'm2-prompt',
    title: 'A protected read',
    why: 'The item is written without a prompt and opens only after Face ID or a fingerprint, with the texts the app gave.',
    before: {
      ios: [
        'Tap Start and look at the phone: three reads follow, and each must ask Face ID exactly once.',
        'Face ID that recognizes you at once shows no text: that is how iOS works.',
      ],
      android: [
        'Three fingerprint prompts come one after another: touch the sensor for each.',
        'The first one reads "Example: unlock the item", with a subtitle, a description and a "Not now" button; the second one "Second read".',
      ],
    },
    question: {
      ios: 'Did each of the three reads ask Face ID exactly once?',
      android: 'Were the texts of the prompts as described above?',
    },
  },
  {
    id: 'cancel',
    scenario: 'm2-cancel',
    title: 'A canceled prompt',
    why: 'Canceling is USER_CANCELED, never a quiet null, and the item stays for the next try.',
    before: {
      ios: [
        'Cover the camera with a finger, then tap Start.',
        'When Face ID fails, tap "Cancel".',
        'Then uncover the camera: the next prompt opens with your face.',
      ],
      android: [
        'The first prompt: tap "Cancel" without touching the sensor.',
        'The second prompt: touch the sensor.',
      ],
    },
  },
  {
    id: 'fallback',
    scenario: 'm2-no-fallback',
    title: 'No fallback button',
    why: 'When the Keychain shows the prompt, a tap on a fallback button comes back as a failed scan, so the package hides the button. The Simulator shows no buttons at all.',
    only: 'ios',
    before: [
      'Cover the camera with a finger, then tap Start.',
      'Face ID fails twice: the alert must offer only "Try Face ID Again" and "Cancel", no third button.',
      'Tap "Cancel".',
    ],
    question: 'Did the alert offer only "Try Face ID Again" and "Cancel"?',
  },
  {
    id: 'parallel',
    scenario: 'm2-parallel-reads',
    title: 'Three reads at once',
    why: 'Prompts queue up one at a time, each read gets its own value, and a read without protection doesn’t wait behind them.',
    before: {
      ios: [
        'Tap Start and look at the phone: iOS may open all three reads with one Face ID, or ask more than once.',
      ],
      android: ['Three prompts come one after another: touch the sensor for each.'],
    },
  },
  {
    id: 'window',
    scenario: 'm2-auth-validity',
    title: 'One prompt for 20 seconds',
    why: 'authValidity: one authentication opens the item for 20 seconds, then the prompt is back.',
    before: [
      'The first prompt: authenticate.',
      'The second read must come at once, with no prompt.',
      'The app then waits 22 seconds: stay in it and keep the screen on.',
      'A prompt appears again: authenticate.',
    ],
    question: 'Did the second read come without a prompt, and the prompt come back after the wait?',
  },
  {
    id: 'compat',
    scenario: 'compat-auth',
    title: 'The react-native-keychain layer',
    why: 'The old API over the new storage: a protected password, a prompt with its texts, and a cancel.',
    before: {
      ios: [
        'Tap Start and look at the phone: the first read opens.',
        'As soon as it has, cover the camera with a finger: the second prompt fails. Tap "Cancel".',
      ],
      android: [
        'The first prompt, "Unlock compat" with a "Not now" button: touch the sensor.',
        'The second prompt: tap "Cancel".',
      ],
    },
  },
  {
    id: 'lockout',
    scenario: 'm2-lockout',
    title: 'Locked biometrics',
    why: 'Too many failed attempts end the read with LOCKOUT at once, instead of a prompt that hangs.',
    before: {
      ios: [
        'Before Start, lock Face ID: press and hold the side button and a volume button until the power-off slider appears, then tap Cancel.',
        'Tap Start: no Face ID should appear, and the read ends with LOCKOUT.',
        'If a Face ID prompt appears after all, let another person look at the phone until it says Face ID is locked.',
      ],
      android: [
        'Tap Start, then touch the sensor with a finger that isn’t enrolled, again and again, until the prompt says there were too many attempts.',
        'If the phone then asks for your PIN to unlock the fingerprint, tap Cancel instead.',
      ],
    },
    after: {
      ios: ['Lock the phone and unlock it with your passcode: Face ID works again.'],
      android: ['Lock the phone and unlock it with your PIN: the fingerprint works again.'],
    },
  },
  {
    id: 'invalidation',
    scenario: 'm2-invalidation',
    title: 'A new face or finger',
    why: 'An item tied to the current biometrics dies when another face or finger is enrolled: KEY_INVALIDATED, and the item is removed. The iOS Simulator can’t show it.',
    optional: true,
    before: {
      ios: [
        'Optional: it changes your Face ID, so banking and other apps that tie their data to your current Face ID may ask you to sign in again.',
        'Run 1 writes an item tied to your Face ID as it is now.',
      ],
      android: [
        'Optional: it changes your fingerprints, so banking and other apps that tie their data to your current fingerprints may ask you to sign in again.',
        'Run 1 writes an item tied to your fingerprints as they are now.',
      ],
    },
    between: {
      ios: [
        'Open Settings › Face ID & Passcode › Set Up an Alternate Appearance, and scan your face.',
        'Come back to this app and tap Start for run 2.',
      ],
      android: [
        'Open Settings › Security & privacy › Device unlock › Fingerprint Unlock, and add a finger (the path may differ a little).',
        'Come back to this app and tap Start for run 2.',
      ],
    },
    after: {
      ios: [
        'The alternate appearance goes only with Reset Face ID, which means setting Face ID up again; keeping it is harmless.',
      ],
      android: ['Delete the finger you added, in the same settings.'],
    },
  },
];

/** The steps of this platform, in order. */
export const steps: Step[] = STEPS.filter((step) => !step.only || step.only === Platform.OS);

/** The instructions for this platform. */
export function forPlatform(instructions: Instructions | undefined): string[] {
  if (!instructions) return [];
  if (Array.isArray(instructions)) return instructions;
  return Platform.OS === 'ios' ? instructions.ios : instructions.android;
}

/** The step's question for this platform, if it has one. */
export function questionOf(step: Step): string | undefined {
  const { question } = step;
  if (question === undefined || typeof question === 'string') return question;
  return Platform.OS === 'ios' ? question.ios : question.android;
}
