/**
 * ONLY student IDs listed here may sign in (comma-separated, trim, case-insensitive match).
 *
 * Important: We intentionally do NOT read BIT_ALLOWED_STUDENT_IDS from the OS environment,
 * because a leftover Windows user/system variable can override this file and look like
 * "every ID works". Edit this string, save, then restart the server (`npm start`).
 */
const ALLOWED_IDS_FROM_FILE = '1BI25AI163,1BI25AI164,1BI25AI165';

export const ALLOWED_STUDENT_IDS = ALLOWED_IDS_FROM_FILE.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isStudentIdAllowed(studentId) {
  const id = String(studentId ?? '').trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  return ALLOWED_STUDENT_IDS.some((allowed) => allowed.toLowerCase() === lower);
}

/**
 * Admin credentials — only this account can access QR code generation / printing.
 * Change these values and restart the server to update.
 */
export const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'admin123',
};

export function isAdmin(username, password) {
  return (
    String(username ?? '').trim().toLowerCase() === ADMIN_CREDENTIALS.username.toLowerCase() &&
    String(password ?? '') === ADMIN_CREDENTIALS.password
  );
}

/** Keep in sync with seat layout in public/index.html (LIBRARIES). */
export const LIBRARIES = [
  {
    id: 'lib1',
    name: 'Lib-1',
    subtitle: 'Main Study Hall',
    total: 24,
    accent: 'from-violet-500 to-indigo-500',
    perks: 'Open layout · Power strips',
  },
  {
    id: 'lib2',
    name: 'Lib-2',
    subtitle: 'Engineering Library',
    total: 20,
    accent: 'from-sky-500 to-cyan-500',
    perks: 'Stacks · Reference zone',
  },
  {
    id: 'lib3',
    name: 'Lib-3',
    subtitle: 'Quiet Zone',
    total: 16,
    accent: 'from-emerald-500 to-teal-500',
    perks: 'Silent · Individual focus',
  },
];

export const DEMO_FAST_TIMERS = process.env.BIT_DEMO_FAST !== '0';

export const TIMING = {
  RESERVATION_MS: 10 * 60 * 1000,
  MOCK_TICKLE_MS: 5000,
};
