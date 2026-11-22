/**
 * HG STACK — wedding reservation reconciliation, Google Apps Script time trigger.
 *
 * This is the only proposed NEW clock trigger in the wedding Apps Script
 * project. It calls the existing authenticated, payment-safe Cloudflare Worker;
 * it never edits Orders, Sheets, or payments directly.
 *
 * Installation is a ONE-TIME privileged Apps Script action after publishing
 * this file to the *existing* project (see docs/wedding-scheduler-cutover.md).
 * GitHub Actions must remain scheduled until three actual timer invocations
 * have been observed in Apps Script's execution logs.
 *
 * Never log credentials or the HTTP request payload.
 */

var WEDDING_RECONCILE_ENDPOINT =
  'https://mp-webhook-production.hgreco85.workers.dev/api/reconcile-expired';
var WEDDING_RECONCILE_HANDLER = 'weddingReconciliationTick';
var WEDDING_RECONCILE_HEARTBEAT = 'WEDDING_RECONCILE_LAST_OK_AT';
var WEDDING_RECONCILE_SUMMARY = 'WEDDING_RECONCILE_LAST_SUMMARY';

/** Single trigger invocation. No ScriptLock is held across HTTP (prevents
 * deadlock: the Worker may call this same Apps Script under LockService).
 */
function weddingReconciliationTick() {
  var props = PropertiesService.getScriptProperties();
  // Reuse the server-to-server shared secret already used by this Apps Script.
  // No new credential is generated or stored in source control.
  var secret = props.getProperty('BACKEND_SHARED_SECRET');
  if (!secret) throw new Error('Wedding reconciliation is not configured');

  var response;
  try {
    response = UrlFetchApp.fetch(WEDDING_RECONCILE_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ secret: secret }),
      muteHttpExceptions: true,
      followRedirects: false
    });
  } catch (error) {
    // Intentionally omit exception details: some transport errors contain URLs
    // or request diagnostics, which must never leak credentials.
    throw new Error('Wedding reconciliation transport failed');
  }

  var status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Wedding reconciliation HTTP ' + status);
  }

  var data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('Wedding reconciliation returned invalid JSON');
  }
  if (!data || data.ok !== true) {
    throw new Error('Wedding reconciliation was not accepted by Worker');
  }

  var results = Array.isArray(data.results) ? data.results : [];
  var preserved = results.filter(function(item) { return item && item.preserved === true; }).length;
  var unresolved = results.filter(function(item) {
    return item && item.reason && item.reason !== 'mp_payment_pending_or_approved' &&
      item.reason !== 'mp_order_in_progress' && item.reason !== 'mp_authorized_or_retrying';
  }).length;
  var summary = {
    checked: Math.max(0, Number(data.checked) || 0),
    reconciled: Math.max(0, Number(data.reconciled) || 0),
    preserved: preserved,
    unresolved: unresolved,
    at: new Date().toISOString()
  };
  props.setProperty(WEDDING_RECONCILE_HEARTBEAT, summary.at);
  props.setProperty(WEDDING_RECONCILE_SUMMARY, JSON.stringify(summary));
  console.log('wedding-reconciliation ' + JSON.stringify(summary));
  return summary;
}

/** Returns only non-secret operational status for verification and cutover. */
function weddingReconciliationStatus() {
  var props = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === WEDDING_RECONCILE_HANDLER;
  });
  return {
    ownedTriggers: triggers.length,
    lastOkAt: props.getProperty(WEDDING_RECONCILE_HEARTBEAT) || '',
    lastSummary: props.getProperty(WEDDING_RECONCILE_SUMMARY) || ''
  };
}

/** Create at most ONE timer for the current installing user. Idempotent. */
function installWeddingReconciliationTrigger() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === WEDDING_RECONCILE_HANDLER;
  });
  if (triggers.length > 1) {
    throw new Error('Multiple reconciliation triggers detected: refusing automatic changes');
  }
  if (triggers.length === 1) {
    return { ok: true, installed: false, alreadyExists: true, ownedTriggers: 1 };
  }
  if (!PropertiesService.getScriptProperties().getProperty('BACKEND_SHARED_SECRET')) {
    throw new Error('Server-to-server authentication not configured');
  }
  ScriptApp.newTrigger(WEDDING_RECONCILE_HANDLER).timeBased().everyMinutes(5).create();
  return { ok: true, installed: true, alreadyExists: false, ownedTriggers: 1 };
}

/** Rollback only this user's wedding timer; leaves all other timers intact. */
function removeWeddingReconciliationTrigger() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === WEDDING_RECONCILE_HANDLER;
  });
  triggers.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  return { ok: true, removed: triggers.length };
}
