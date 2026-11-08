import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE: These are Unit / Contract Simulation tests for concurrency logic using MockSheetBackend.
// For Authentic Live Integration tests running against the real Google Sheet LockService,
// see tests/live_backend_integration.test.mjs.
class MockSheetBackend {
  constructor() {
    this.locked = false;
    this.catalog = new Map();
    this.operations = [];
    this.reservationMinutes = 15;

    // Seed experiences
    for (let i = 1; i <= 80; i++) {
      const id = `V09-${String(i).padStart(3, '0')}`;
      this.catalog.set(id, {
        id,
        status: 'Disponible',
        reservedUntil: null,
        usd: 50,
        ars: 78000
      });
    }
  }

  async acquireLock(timeoutMs = 5000) {
    const start = Date.now();
    while (this.locked) {
      if (Date.now() - start > timeoutMs) throw new Error('Lock timeout');
      await new Promise(r => setTimeout(r, 2));
    }
    this.locked = true;
  }

  releaseLock() {
    this.locked = false;
  }

  releaseExpiredReservationsLocked() {
    const now = new Date();
    for (const [id, exp] of this.catalog.entries()) {
      if (exp.status === 'Reservada temporalmente') {
        if (exp.reservedUntil && new Date(exp.reservedUntil) < now) {
          // Check if there is an active pending payment
          const hasPending = this.operations.some(
            op => op.experienceId === id && op.status === 'Pendiente'
          );
          if (!hasPending) {
            exp.status = 'Disponible';
            exp.reservedUntil = null;
          }
        }
      }
    }
  }

  async reserveExperience(experienceId) {
    await this.acquireLock();
    try {
      this.releaseExpiredReservationsLocked();
      const exp = this.catalog.get(experienceId);
      if (!exp) throw new Error('Experiencia no encontrada');
      if (exp.status !== 'Disponible') {
        throw new Error('Esta experiencia no está disponible.');
      }

      const orderId = `ORD-${experienceId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const expiry = new Date(Date.now() + this.reservationMinutes * 60 * 1000);

      exp.status = 'Reservada temporalmente';
      exp.reservedUntil = expiry.toISOString();

      this.operations.push({
        orderId,
        experienceId,
        status: 'Reservada',
        amount: exp.ars,
        currency: 'ARS',
        createdAt: new Date().toISOString()
      });

      return { ok: true, orderId, experienceId, amount: exp.ars };
    } finally {
      this.releaseLock();
    }
  }

  async confirmPayment(orderId, mpStatus, mpPaymentId) {
    await this.acquireLock();
    try {
      const op = this.operations.find(o => o.orderId === orderId);
      if (!op) return { error: 'Order not found' };

      const exp = this.catalog.get(op.experienceId);
      const low = String(mpStatus).toLowerCase();

      // Idempotency: if already approved, ignore
      if (op.status === 'Aprobado' && low === 'approved') {
        return { ok: true, idempotent: true };
      }

      if (low === 'approved') {
        op.status = 'Aprobado';
        op.mpPaymentId = mpPaymentId;
        op.confirmedAt = new Date().toISOString();
        if (exp) {
          exp.status = 'Regalada y cobrada';
          exp.reservedUntil = null;
        }
      } else if (['pending', 'in_process', 'authorized'].includes(low)) {
        op.status = 'Pendiente';
        op.mpPaymentId = mpPaymentId;
        if (exp) {
          exp.status = 'Pago pendiente';
          exp.reservedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }
      } else if (['rejected', 'cancelled'].includes(low)) {
        op.status = low === 'rejected' ? 'Rechazado' : 'Cancelado';
        if (exp) {
          exp.status = 'Disponible';
          exp.reservedUntil = null;
        }
      } else if (['refunded', 'charged_back'].includes(low)) {
        op.status = low === 'refunded' ? 'Reembolsado' : 'Contracargo';
        op.refund = low;
        if (exp) {
          exp.status = 'Reembolsada o en revisión';
          exp.reservedUntil = null;
        }
      }
      return { ok: true };
    } finally {
      this.releaseLock();
    }
  }
}

test('Concurrency: 2 concurrent reservations on same gift -> exactly 1 succeeds', async () => {
  const backend = new MockSheetBackend();
  const results = await Promise.allSettled([
    backend.reserveExperience('V09-001'),
    backend.reserveExperience('V09-001')
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one reservation must succeed');
  assert.equal(rejected.length, 1, 'Exactly one reservation must be rejected');
  assert.equal(rejected[0].reason.message, 'Esta experiencia no está disponible.');
});

test('Concurrency: 10 concurrent reservations on same gift -> exactly 1 succeeds', async () => {
  const backend = new MockSheetBackend();
  const promises = Array.from({ length: 10 }, () => backend.reserveExperience('V09-015'));
  const results = await Promise.allSettled(promises);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one reservation must succeed in race of 10');
  assert.equal(rejected.length, 9, 'Other 9 reservations must fail');
  rejected.forEach(r => assert.equal(r.reason.message, 'Esta experiencia no está disponible.'));
});

test('Concurrency: 100 concurrent reservations on same gift -> exactly 1 succeeds', async () => {
  const backend = new MockSheetBackend();
  const promises = Array.from({ length: 100 }, () => backend.reserveExperience('V09-030'));
  const results = await Promise.allSettled(promises);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one reservation must succeed in race of 100');
  assert.equal(rejected.length, 99, 'Other 99 reservations must fail');
});

test('Exclusivity: once an experience is marked Regalada y cobrada, it can never be reserved', async () => {
  const backend = new MockSheetBackend();
  const res = await backend.reserveExperience('V09-044');
  await backend.confirmPayment(res.orderId, 'approved', 'PAY-TEST-999');

  const exp = backend.catalog.get('V09-044');
  assert.equal(exp.status, 'Regalada y cobrada');

  await assert.rejects(
    async () => backend.reserveExperience('V09-044'),
    { message: 'Esta experiencia no está disponible.' }
  );
});

test('Exclusivity: expired reservation releases to Disponible iff no pending payment', async () => {
  const backend = new MockSheetBackend();
  const res = await backend.reserveExperience('V09-050');

  // Fast forward expiry to past
  backend.catalog.get('V09-050').reservedUntil = new Date(Date.now() - 1000).toISOString();

  // New reservation should trigger release and succeed
  const res2 = await backend.reserveExperience('V09-050');
  assert.ok(res2.ok, 'Expired reservation must release and allow new reservation');
  assert.notEqual(res.orderId, res2.orderId);
});
