import type { Row, Run } from './harness/types';

export const LIGHT = {
  background: '#F3F5F8',
  card: '#FFFFFF',
  text: '#1E2A44',
  secondary: '#5B6B82',
  line: '#E1E6EE',
  failTint: '#FBEAE7',
};
export const DARK = {
  background: '#10172A',
  card: '#1E2A44',
  text: '#F3E9D2',
  secondary: '#9AA8BD',
  line: '#2B3A5C',
  failTint: '#47262B',
};
export type Theme = typeof LIGHT;

export const STATE_COLORS: Record<Run['state'], string> = {
  running: '#457B9D',
  passed: '#2E8B57',
  failed: '#C0392B',
  skipped: '#8A8F98',
  review: '#C77D0A',
};

export const STATE_LABELS: Record<Run['state'], string> = {
  running: 'running…',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  review: 'needs a look',
};

export const ROW_MARKS: Record<Row['status'], { mark: string; color: string }> = {
  pass: { mark: '✓', color: STATE_COLORS.passed },
  fail: { mark: '✗', color: STATE_COLORS.failed },
  info: { mark: '•', color: STATE_COLORS.review },
  skip: { mark: '–', color: STATE_COLORS.skipped },
};
