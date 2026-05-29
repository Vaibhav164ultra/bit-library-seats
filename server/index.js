import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { ALLOWED_STUDENT_IDS, LIBRARIES, isStudentIdAllowed, isAdmin, addStudentIdToAllowlist } from './config.js';
import {
  bumpActivity,
  checkInSeat,
  checkoutSeat,
  cloneSeats,
  createToken,
  getSessionForUser,
  getStatePayload,
  reserveSeat,
  revokeToken,
  validateToken,
  getSeatsWithTokens,
  toggleSeatMaintenance,
  releaseAllSeats,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32kb' }));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1].trim() : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token.' });
    return;
  }
  const row = validateToken(token);
  if (!row) {
    res.status(401).json({ error: 'Invalid or expired session. Sign in again.' });
    return;
  }
  // Admin tokens bypass student-ID allowlist
  if (row.role !== 'admin' && !isStudentIdAllowed(row.userId)) {
    revokeToken(token);
    res.status(403).json({ error: 'Incorrect student ID. Access is restricted.', code: 'NOT_ALLOWED' });
    return;
  }
  req.auth = row;
  next();
}

function adminOnly(req, res, next) {
  if (!req.auth || req.auth.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_ONLY' });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'bit-library-seats', libraries: LIBRARIES.length });
});

app.get('/api/meta/libraries', (_req, res) => {
  res.json({ libraries: LIBRARIES });
});

app.post('/api/auth/login', (req, res) => {
  try {
    const raw = String(req.body?.studentId ?? '').trim();
    if (!raw) {
      res.status(400).json({ error: 'Please enter your student ID.', code: 'MISSING_ID' });
      return;
    }
    if (!isStudentIdAllowed(raw)) {
      res.status(403).json({ error: 'Incorrect student ID. Access is restricted to authorized students only.', code: 'NOT_ALLOWED' });
      return;
    }
    const studentId = raw;
    const token = createToken(studentId, studentId, 'student');
    const seatsOut = cloneSeats();
    const session = getSessionForUser(studentId);
    res.json({
      token,
      user: { id: studentId, name: studentId, role: 'student' },
      seats: seatsOut,
      session,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Login failed.' });
  }
});

app.post('/api/auth/admin-login', (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.', code: 'MISSING_CREDS' });
      return;
    }
    if (!isAdmin(username, password)) {
      res.status(403).json({ error: 'Invalid admin credentials.', code: 'INVALID_ADMIN' });
      return;
    }
    const token = createToken('admin', 'Administrator', 'admin');
    const seatsOut = cloneSeats();
    res.json({
      token,
      user: { id: 'admin', name: 'Administrator', role: 'admin' },
      seats: seatsOut,
      session: null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Admin login failed.' });
  }
});

app.post('/api/auth/logout', auth, (req, res) => {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) revokeToken(m[1].trim());
  res.status(204).end();
});

app.get('/api/state', auth, (req, res) => {
  const { userId, name, role } = req.auth;
  res.json({
    user: { id: userId, name, role },
    ...getStatePayload(userId),
  });
});

app.post('/api/me/activity', auth, (req, res) => {
  try {
    const { userId, name } = req.auth;
    const payload = bumpActivity(userId);
    res.json({ user: { id: userId, name }, ...payload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/actions/reserve', auth, (req, res) => {
  try {
    const { userId, name } = req.auth;
    const { libraryId, seatId } = req.body || {};
    if (!libraryId || !seatId) {
      res.status(400).json({ error: 'libraryId and seatId are required.' });
      return;
    }
    const payload = reserveSeat(userId, name, libraryId, seatId);
    res.json({ user: { id: userId, name }, ...payload });
  } catch (e) {
    const code = e.code === 'NOT_AVAILABLE' || e.code === 'SESSION_EXISTS' ? 409 : 400;
    res.status(code).json({ error: e.message, code: e.code });
  }
});

app.post('/api/actions/checkin', auth, (req, res) => {
  try {
    const { userId, name } = req.auth;
    const { libraryId, seatId, minutes, qrToken } = req.body || {};
    const mins = Number(minutes);
    if (!libraryId || !seatId || !Number.isFinite(mins) || mins < 1 || mins > 480) {
      res.status(400).json({ error: 'libraryId, seatId, and minutes (1–480) are required.' });
      return;
    }
    const payload = checkInSeat(userId, name, libraryId, seatId, mins, qrToken);
    res.json({ user: { id: userId, name }, ...payload });
  } catch (e) {
    const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : e.code === 'INVALID_QR' ? 400 : 400;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

app.post('/api/actions/checkout', auth, (req, res) => {
  try {
    const { userId, name, role } = req.auth;
    const { libraryId, seatId } = req.body || {};
    if (!libraryId || !seatId) {
      res.status(400).json({ error: 'libraryId and seatId are required.' });
      return;
    }
    const payload = checkoutSeat(userId, libraryId, seatId, role === 'admin');
    res.json({ user: { id: userId, name, role }, ...payload });
  } catch (e) {
    const status = e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: e.message, code: e.code });
  }
});

app.get('/api/admin/qr-codes', auth, adminOnly, (_req, res) => {
  try {
    res.json({ seats: getSeatsWithTokens() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/seats/maintenance', auth, adminOnly, (req, res) => {
  try {
    const { libraryId, seatId } = req.body || {};
    if (!libraryId || !seatId) {
      res.status(400).json({ error: 'libraryId and seatId are required.' });
      return;
    }
    const seats = toggleSeatMaintenance(libraryId, seatId);
    res.json({ ok: true, seats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/allowlist', auth, adminOnly, (req, res) => {
  try {
    const { studentId } = req.body || {};
    if (!studentId) {
      res.status(400).json({ error: 'studentId is required.' });
      return;
    }
    const added = addStudentIdToAllowlist(studentId);
    res.json({ ok: true, added, allowlist: ALLOWED_STUDENT_IDS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/actions/release-all', auth, adminOnly, (_req, res) => {
  try {
    const seats = releaseAllSeats();
    res.json({ ok: true, seats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/me/reservation-qr-token', auth, (req, res) => {
  try {
    const { userId } = req.auth;
    const sess = getSessionForUser(userId);
    if (!sess || !sess.reservationUntil) {
      res.status(400).json({ error: 'You do not have a pending reservation.', code: 'NO_RESERVATION' });
      return;
    }
    
    // Find the seat and get its token
    const allSeats = getSeatsWithTokens();
    const libSeats = allSeats[sess.libId] || [];
    const seat = libSeats.find((s) => s.id === sess.seatId);
    
    if (!seat) {
      res.status(404).json({ error: 'Seat not found.', code: 'NOT_FOUND' });
      return;
    }
    
    res.json({ qrToken: seat.qrToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(ROOT, { index: 'index.html', extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  res.sendFile(path.join(ROOT, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BIT Library Seats → http://localhost:${PORT}`);
  console.log(
    `[AUTH] Allowlist (${ALLOWED_STUDENT_IDS.length} IDs, from server/config.js only):`,
    ALLOWED_STUDENT_IDS.join(', ')
  );
  if (ALLOWED_STUDENT_IDS.length === 0) {
    console.error('[AUTH] WARNING: allowlist is empty — no one can sign in until you add IDs in server/config.js');
  }
});
