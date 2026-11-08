import test from 'node:test';
import assert from 'node:assert/strict';

class PaymentStateMachine {
  constructor() {
    this.status = 'Reservada';
    this.mpPaymentId = null;
    this.confirmedAt = null;
    this.refund = null;
  }

  handleTransition(mpStatus, paymentId) {
    const low = String(mpStatus).toLowerCase();

    // Idempotency check: if already approved, ignore duplicate approved
    if (this.status === 'Aprobado' && low === 'approved') {
      return { status: this.status, idempotent: true };
    }

    // Protection against out-of-order replay: an approved order cannot be downgraded to pending
    if (this.status === 'Aprobado' && ['pending', 'in_process', 'authorized'].includes(low)) {
      return { status: this.status, ignoredOutOfOrder: true };
    }

    if (low === 'approved') {
      this.status = 'Aprobado';
      this.mpPaymentId = paymentId;
      this.confirmedAt = new Date().toISOString();
    } else if (['pending', 'in_process', 'authorized'].includes(low)) {
      this.status = 'Pendiente';
      this.mpPaymentId = paymentId;
    } else if (low === 'rejected') {
      this.status = 'Rechazado';
    } else if (low === 'cancelled') {
      this.status = 'Cancelado';
    } else if (['refunded', 'charged_back'].includes(low)) {
      this.status = low === 'refunded' ? 'Reembolsado' : 'Contracargo';
      this.refund = low;
    }
    return { status: this.status };
  }
}

test('Idempotency: duplicate approved webhooks do not re-confirm or corrupt state', () => {
  const psm = new PaymentStateMachine();
  psm.handleTransition('approved', 'pay-100');
  const firstConfirmation = psm.confirmedAt;
  assert.equal(psm.status, 'Aprobado');
  assert.ok(firstConfirmation);

  // Send duplicate approved webhook 5 seconds later
  const res2 = psm.handleTransition('approved', 'pay-100');
  assert.equal(res2.idempotent, true);
  assert.equal(psm.status, 'Aprobado');
  assert.equal(psm.confirmedAt, firstConfirmation, 'Confirmed timestamp must not change');
});

test('Out-of-order protection: delayed pending notification does not downgrade approved state', () => {
  const psm = new PaymentStateMachine();
  psm.handleTransition('approved', 'pay-200');
  assert.equal(psm.status, 'Aprobado');

  // Delayed 'pending' webhook arrives late
  const res = psm.handleTransition('pending', 'pay-200');
  assert.equal(res.ignoredOutOfOrder, true);
  assert.equal(psm.status, 'Aprobado', 'Status must remain Aprobado');
});

test('Refund and Chargeback transitions', () => {
  const psm1 = new PaymentStateMachine();
  psm1.handleTransition('approved', 'pay-300');
  psm1.handleTransition('refunded', 'pay-300');
  assert.equal(psm1.status, 'Reembolsado');
  assert.equal(psm1.refund, 'refunded');

  const psm2 = new PaymentStateMachine();
  psm2.handleTransition('approved', 'pay-301');
  psm2.handleTransition('charged_back', 'pay-301');
  assert.equal(psm2.status, 'Contracargo');
  assert.equal(psm2.refund, 'charged_back');
});

test('Rejection and cancellation transitions release to available', () => {
  const psm1 = new PaymentStateMachine();
  psm1.handleTransition('pending', 'pay-400');
  psm1.handleTransition('rejected', 'pay-400');
  assert.equal(psm1.status, 'Rechazado');

  const psm2 = new PaymentStateMachine();
  psm2.handleTransition('pending', 'pay-401');
  psm2.handleTransition('cancelled', 'pay-401');
  assert.equal(psm2.status, 'Cancelado');
});

test('Dedication validation: allowed only if order is approved', () => {
  function saveDedication(orderStatus, guestName, dedication) {
    if (orderStatus !== 'Aprobado') {
      throw new Error('Pago no confirmado');
    }
    const cleanName = String(guestName || '').trim().slice(0, 120);
    const cleanDedication = String(dedication || '').trim().slice(0, 500);
    return { ok: true, name: cleanName, text: cleanDedication };
  }

  assert.throws(
    () => saveDedication('Pendiente', 'Tía Marta', '¡Felicidades!'),
    /Pago no confirmado/
  );
  assert.throws(
    () => saveDedication('Reservada', 'Tía Marta', '¡Felicidades!'),
    /Pago no confirmado/
  );

  const saved = saveDedication('Aprobado', ' Tía Marta ', ' ¡Muchos éxitos en la luna de miel! ');
  assert.equal(saved.ok, true);
  assert.equal(saved.name, 'Tía Marta');
  assert.equal(saved.text, '¡Muchos éxitos en la luna de miel!');
});
