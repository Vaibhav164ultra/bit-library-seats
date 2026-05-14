import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { LIBRARIES, TIMING } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'library-state.json');

/** In-memory seat rows keyed by library id */
let seats = {};

/** @type {Map<string, { userId: string, name: string, exp: number }>} */
const tokens = new Map();

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function initSeatsWithMockOccupancy() {
  seats = {};
  const now = Date.now();
  LIBRARIES.forEach((lib) => {
    seats[lib.id] = Array.from({ length: lib.total }, (_, i) => {
      const occupied = Math.random() > 0.78;
      return {
        id: `${lib.id}-${i + 1}`,
        num: i + 1,
        holderId: occupied ? `MOCK-${1000 + i}` : null,
        holderName: occupied ? ['Asha', 'Rahul', 'Neha', 'Kiran', 'Sara'][i % 5] : null,
        reservationUntil: null,
        sessionUntil: occupied ? now + (15 + Math.random() * 90) * 60 * 1000 : null,
        lastActivityAt: null,
      };
    });
  });
}

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.seats && typeof data.seats === 'object' && Object.keys(data.seats).length > 0) {
      seats = data.seats;
      return;
    }
  } catch {
    /* missing or corrupt */
  }
  initSeatsWithMockOccupancy();
  persist();
}

export function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ seats, savedAt: Date.now() }, null, 0), 'utf8');
  } catch (e) {
    console.error('persist failed', e.message);
  }
}

export function cloneSeats() {
  return JSON.parse(JSON.stringify(seats));
}

function seatDerivedStatus(seat, now, myUserId) {
  if (seat.sessionUntil && seat.sessionUntil > now) {
    return seat.holderId === myUserId ? 'mine_occupied' : 'occupied';
  }
  if (seat.reservationUntil && seat.reservationUntil > now) {
    if (seat.holderId === myUserId) return 'mine_reserved';
    if (seat.holderId) return 'reserved_other';
  }
  return 'available';
}

export function getSessionForUser(userId) {
  for (const lib of LIBRARIES) {
    const list = seats[lib.id] || [];
    for (const s of list) {
      if (s.holderId !== userId) continue;
      if (s.sessionUntil && s.sessionUntil > Date.now()) {
        return { seatId: s.id, libId: lib.id, sessionUntil: s.sessionUntil, reservationUntil: null };
      }
      if (s.reservationUntil && s.reservationUntil > Date.now() && !s.sessionUntil) {
        return { seatId: s.id, libId: lib.id, sessionUntil: null, reservationUntil: s.reservationUntil };
      }
    }
  }
  return null;
}

export function createToken(userId, name) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { userId, name, exp: Date.now() + TOKEN_TTL_MS });
  return token;
}

export function revokeToken(token) {
  tokens.delete(token);
}

export function validateToken(token) {
  const r = tokens.get(token);
  if (!r || r.exp < Date.now()) {
    if (r) tokens.delete(token);
    return null;
  }
  return r;
}

export function getStatePayload(userId) {
  return {
    seats: cloneSeats(),
    session: getSessionForUser(userId),
  };
}

function findSeat(libId, seatId) {
  const row = seats[libId];
  if (!Array.isArray(row)) return null;
  return row.find((s) => s.id === seatId) || null;
}

export function reserveSeat(userId, userName, libraryId, seatId) {
  if (getSessionForUser(userId)) {
    const err = new Error('You already have an active reservation or session.');
    err.code = 'SESSION_EXISTS';
    throw err;
  }
  const seat = findSeat(libraryId, seatId);
  if (!seat) {
    const err = new Error('Seat not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const now = Date.now();
  const st = seatDerivedStatus(seat, now, userId);
  if (st !== 'available') {
    const err = new Error('That seat is not available.');
    err.code = 'NOT_AVAILABLE';
    throw err;
  }
  seat.holderId = userId;
  seat.holderName = userName;
  seat.reservationUntil = now + TIMING.RESERVATION_MS;
  seat.sessionUntil = null;
  seat.lastActivityAt = null;
  persist();
  return getStatePayload(userId);
}

export function checkInSeat(userId, userName, libraryId, seatId, minutes) {
  const seat = findSeat(libraryId, seatId);
  if (!seat) {
    const err = new Error('Seat not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (seat.holderId !== userId) {
    const err = new Error('You do not hold this seat.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const now = Date.now();
  if (seat.sessionUntil && seat.sessionUntil > now) {
    const err = new Error('Already checked in.');
    err.code = 'ALREADY_IN';
    throw err;
  }
  const hasActiveReservation = seat.reservationUntil && seat.reservationUntil > now;
  if (!hasActiveReservation) {
    const err = new Error('Reservation expired. Reserve the seat again.');
    err.code = 'RES_EXPIRED';
    throw err;
  }
  const until = now + minutes * 60 * 1000;
  seat.sessionUntil = until;
  seat.reservationUntil = null;
  seat.holderId = userId;
  seat.holderName = userName;
  seat.lastActivityAt = now;
  persist();
  return getStatePayload(userId);
}

export function checkoutSeat(userId, libraryId, seatId) {
  const seat = findSeat(libraryId, seatId);
  if (!seat) {
    const err = new Error('Seat not found.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (seat.holderId !== userId) {
    const err = new Error('You do not occupy this seat.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  seat.holderId = null;
  seat.holderName = null;
  seat.reservationUntil = null;
  seat.sessionUntil = null;
  seat.lastActivityAt = null;
  persist();
  return getStatePayload(userId);
}

let lastBumpPersist = 0;

export function bumpActivity(userId) {
  const sess = getSessionForUser(userId);
  if (!sess || !sess.sessionUntil) return getStatePayload(userId);
  const seat = findSeat(sess.libId, sess.seatId);
  const now = Date.now();
  if (seat && seat.holderId === userId && seat.sessionUntil > now) {
    seat.lastActivityAt = now;
    if (now - lastBumpPersist > 3000) {
      lastBumpPersist = now;
      persist();
    }
  }
  return getStatePayload(userId);
}

/** Expire timers; light mock churn on MOCK seats */
export function tick() {
  const now = Date.now();
  let changed = false;
  for (const lib of LIBRARIES) {
    const row = seats[lib.id];
    if (!row) continue;
    for (const s of row) {
      if (s.reservationUntil && now > s.reservationUntil && !s.sessionUntil) {
        s.reservationUntil = null;
        s.holderId = null;
        s.holderName = null;
        s.lastActivityAt = null;
        changed = true;
      }
      if (s.sessionUntil && now > s.sessionUntil) {
        s.sessionUntil = null;
        s.holderId = null;
        s.holderName = null;
        s.reservationUntil = null;
        s.lastActivityAt = null;
        changed = true;
      }
    }
  }
  if (changed) persist();

  /* Occasional mock occupancy drift */
  if (Math.random() > 0.7) {
    const lib = LIBRARIES[Math.floor(Math.random() * LIBRARIES.length)];
    const row = seats[lib.id];
    if (!row || !row.length) return;
    const idx = Math.floor(Math.random() * row.length);
    const s = row[idx];
    if (!s || (s.holderId && !String(s.holderId).startsWith('MOCK'))) return;
    const roll = Math.random();
    if (roll > 0.65 && !s.sessionUntil && !s.reservationUntil) {
      s.holderId = `MOCK-${Math.floor(Math.random() * 9000)}`;
      s.holderName = ['Divya', 'Arjun', 'Ishaan', 'Meera'][Math.floor(Math.random() * 4)];
      s.sessionUntil = Date.now() + (20 + Math.random() * 70) * 60 * 1000;
      persist();
    } else if (roll < 0.2 && s.sessionUntil && s.holderId?.startsWith('MOCK')) {
      s.holderId = null;
      s.holderName = null;
      s.sessionUntil = null;
      s.reservationUntil = null;
      persist();
    }
  }
}

loadFromDisk();
setInterval(tick, 1000);
