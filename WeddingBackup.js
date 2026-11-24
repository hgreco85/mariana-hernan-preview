/**
 * HG STACK - Wedding backup, detailed digest, XLSX report, integrity (USD 0).
 */
var HG_BACKUP_FOLDER_NAME = 'HG Wedding Backups (private)';
var HG_GIFTS_SS_ID = '1JFJSvf3sEA8KdjytkQMu9IBf1yZmI3x9tend635HZvA';
var HG_RSVP_SS_ID = '1xLxcXd9-O3xKAsCHrteupDffkg6iIB2-P8vrMIIixIA';
var HG_BACKUP_RETENTION_DAYS = 90;

function hgGetOrCreateBackupFolder() {
  var it = DriveApp.getFoldersByName(HG_BACKUP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(HG_BACKUP_FOLDER_NAME);
}

function hgSha256(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function hgBackupGifts() {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  return {
    catalog: ss.getSheetByName('Catálogo circuito v0.9').getDataRange().getValues(),
    operations: ss.getSheetByName('Operaciones').getDataRange().getValues(),
    photos: ss.getSheetByName('Fuentes fotos').getDataRange().getValues()
  };
}

function hgBackupRsvp() {
  var ss = SpreadsheetApp.openById(HG_RSVP_SS_ID);
  var sh = ss.getSheetByName('RSVP');
  return sh ? sh.getDataRange().getValues() : [];
}

function hgAppendEventLog(eventType, payload) {
  try {
    var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
    var sh = ss.getSheetByName('EventLog');
    if (!sh) {
      sh = ss.insertSheet('EventLog');
      sh.appendRow(['Timestamp', 'EventType', 'Payload']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), eventType, payload]);
  } catch (e) {}
}

function hgEnforceRetention(folder, days) {
  var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  var it = folder.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var m = f.getName().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) {
      var d = new Date(m[1]);
      if (d < cutoff) f.setTrashed(true);
    }
  }
}

function hgRunDailyBackup() {
  var folder = hgGetOrCreateBackupFolder();
  var now = new Date();
  var tz = 'America/Argentina/Buenos_Aires';
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var dayFolder = folder.createFolder(dateStr + ' backup');
  var gifts = hgBackupGifts();
  var rsvp = hgBackupRsvp();
  var files = {};
  function writeFile(name, obj) {
    var json = JSON.stringify(obj);
    dayFolder.createFile(name, json, MimeType.PLAIN_TEXT);
    return { count: Array.isArray(obj) ? obj.length - 1 : 0, sha256: hgSha256(json) };
  }
  files.gifts_catalog = writeFile('gifts_catalog.json', gifts.catalog);
  files.gifts_operations = writeFile('gifts_operations.json', gifts.operations);
  files.gifts_photos = writeFile('gifts_photos.json', gifts.photos);
  files.rsvp = writeFile('rsvp.json', rsvp);
  var manifest = {
    createdAt: now.toISOString(),
    giftsSpreadsheet: HG_GIFTS_SS_ID,
    rsvpSpreadsheet: HG_RSVP_SS_ID,
    files: files
  };
  dayFolder.createFile('manifest.json', JSON.stringify(manifest, null, 2), MimeType.PLAIN_TEXT);
  hgAppendEventLog('BACKUP_CREATED', JSON.stringify({ date: dateStr, counts: { catalog: files.gifts_catalog.count, ops: files.gifts_operations.count, rsvp: files.rsvp.count } }));
  hgEnforceRetention(folder, HG_BACKUP_RETENTION_DAYS);
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_AT', now.toISOString());
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_SUMMARY', JSON.stringify(files));
  return manifest;
}

// ---------- helpers for digest & report ----------
function hgGetCatalogMap() {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var data = ss.getSheetByName('Catálogo circuito v0.9').getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    map[String(data[i][0])] = { title: String(data[i][4] || ''), city: String(data[i][1] || '') };
  }
  return map;
}

function hgGetApprovedGifts() {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var ops = ss.getSheetByName('Operaciones').getDataRange().getValues();
  var catalog = hgGetCatalogMap();
  var list = [];
  for (var i = 1; i < ops.length; i++) {
    var status = String(ops[i][2] || '');
    if (status.toLowerCase().indexOf('aprob') < 0) continue;
    var origin = String(ops[i][13] || '');
    if (origin && origin.toUpperCase() !== 'LIVE') continue;
    var expId = String(ops[i][1] || '');
    var info = catalog[expId] || { title: expId, city: '' };
    var amount = Number(ops[i][5]) || 0;
    list.push({
      orderId: String(ops[i][0]),
      experienceId: expId,
      title: info.title,
      city: info.city,
      createdAt: ops[i][3],
      confirmedAt: ops[i][10],
      currency: String(ops[i][4] || ''),
      amount: amount,
      guest: String(ops[i][8] || ''),
      dedication: String(ops[i][9] || ''),
      mpPaymentId: String(ops[i][7] || ''),
      pilot: amount === 15000
    });
  }
  return list;
}

function hgGetRsvpRows() {
  var ss = SpreadsheetApp.openById(HG_RSVP_SS_ID);
  var sh = ss.getSheetByName('RSVP');
  var data = sh.getDataRange().getValues();
  var rows = [];
  var byPerson = {};
  for (var i = 1; i < data.length; i++) {
    var r = {
      token: String(data[i][0] || ''),
      contacto: String(data[i][1] || ''),
      persona: String(data[i][2] || ''),
      asiste: String(data[i][3] || ''),
      alimentacion: String(data[i][4] || ''),
      otraDetalle: String(data[i][5] || ''),
      notaGrupo: String(data[i][6] || ''),
      ultima: data[i][7] ? new Date(data[i][7]) : null,
      grupo: String(data[i][8] || ''),
      estado: String(data[i][9] || '')
    };
    var key = (r.persona + '|' + r.grupo).toLowerCase().trim();
    if (!byPerson[key]) byPerson[key] = r;
    else {
      var prev = byPerson[key];
      var prevT = prev.ultima ? prev.ultima.getTime() : 0;
      var curT = r.ultima ? r.ultima.getTime() : 0;
      if (curT >= prevT) byPerson[key] = r;
    }
  }
  for (var k in byPerson) rows.push(byPerson[k]);
  return rows;
}

function hgEscapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var HG_DIGEST_TEST_MODE = false;

// ---------- automatic reconciliation before every report ----------
var HG_LAST_RECON = null;

function hgParseDate(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime()) ? null : value;
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function hgMpToken() {
  try {
    var t = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN');
    return t ? String(t).trim() : null;
  } catch (e) { return null; }
}

function hgFetchMpApprovedPayments() {
  var token = hgMpToken();
  if (!token) return { ok: false, reason: 'missing_token', payments: [] };
  var payments = [];
  var offset = 0;
  var limit = 100;
  try {
    while (offset < 300) {
      var url = 'https://api.mercadopago.com/v1/payments/search?status=approved&sort=date_created&criteria=desc&limit=' + limit + '&offset=' + offset;
      var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      var code = resp.getResponseCode();
      if (code !== 200) {
        // retry with access_token query param
        var url2 = url + '&access_token=' + encodeURIComponent(token);
        var resp2 = UrlFetchApp.fetch(url2, { muteHttpExceptions: true });
        var code2 = resp2.getResponseCode();
        var body = resp2.getContentText().slice(0, 300);
        if (code2 !== 200) {
          return { ok: false, reason: 'http_' + code + '/' + code2 + ' body=' + body, payments: payments };
        }
        var json2 = JSON.parse(resp2.getContentText());
        var results2 = json2.results || [];
        if (!results2.length) break;
        results2.forEach(function (p) { payments.push(p); });
        offset += results2.length;
        if (results2.length < limit) break;
        continue;
      }
      var json = JSON.parse(resp.getContentText());
      var results = json.results || [];
      if (!results.length) break;
      results.forEach(function (p) { payments.push(p); });
      offset += results.length;
      if (results.length < limit) break;
    }
    return { ok: true, payments: payments };
  } catch (e) {
    return { ok: false, reason: String(e), payments: payments };
  }
}

function hgSearchPreviousBackupsForDedication(orderId) {
  try {
    var folder = hgGetOrCreateBackupFolder();
    var it = folder.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getName().indexOf('gifts_operations.json') < 0) continue;
      try {
        var data = JSON.parse(f.getBlob().getDataAsString());
        if (!Array.isArray(data)) continue;
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][0]) === String(orderId)) {
            var ded = String(data[i][9] || '').trim();
            if (ded) return ded;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return '';
}

function hgReconcileGiftIntegrity() {
  var alerts = [];
  var recoveredNames = [];
  var recoveredDedications = [];
  var optionalEmpty = [];
  var inconsistencies = [];
  var mpPayments = [];
  var recon = {
    alerts: alerts,
    inconsistencies: inconsistencies,
    recoveredNames: recoveredNames,
    recoveredDedications: recoveredDedications,
    optionalEmpty: optionalEmpty,
    mpPaymentCount: 0,
    omittedPayments: [],
    amountMismatches: [],
    missingNames: [],
    duplicateOrders: [],
    lostRsvpConfirmations: false,
    previousRsvpConfirmed: 0,
    currentRsvpConfirmed: 0
  };

  try {
    var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
    var opsSh = ss.getSheetByName('Operaciones');
    var catSh = ss.getSheetByName('Cat\u00e1logo circuito v0.9');
    var opsData = opsSh.getDataRange().getValues();
    var catData = catSh.getDataRange().getValues();
    var catMap = {};
    for (var i = 1; i < catData.length; i++) catMap[String(catData[i][0])] = String(catData[i][12] || '');

    // duplicate order ids
    var seenOrders = {};
    for (var i = 1; i < opsData.length; i++) {
      var oid = String(opsData[i][0] || '').trim();
      if (!oid) continue;
      if (seenOrders[oid]) { recon.duplicateOrders.push(oid); alerts.push('Orden duplicada en Operaciones: ' + oid); }
      seenOrders[oid] = true;
    }

    // classify origin if missing using MP live_mode later; default unknown
    // build operation map
    var opByOrder = {};
    for (var i = 1; i < opsData.length; i++) {
      var oid = String(opsData[i][0] || '').trim();
      if (oid) opByOrder[oid] = i;
    }

    // MP reconciliation
    var mpResult = hgFetchMpApprovedPayments();
    if (!mpResult.ok) {
      alerts.push('No se pudo consultar Mercado Pago para conciliacion: ' + mpResult.reason);
    } else {
      recon.mpPaymentCount = mpResult.payments.length;
      var paymentsByOrder = {};
      mpResult.payments.forEach(function (p) {
        var ref = String(p.external_reference || '').trim();
        if (!ref) return;
        if (!paymentsByOrder[ref]) paymentsByOrder[ref] = [];
        paymentsByOrder[ref].push(p);
      });

      function isWeddingRef(ref) { return /^ORD-/i.test(ref) || /V09/i.test(ref) || /wedding/i.test(ref); }

      // omitted or duplicate payments
      Object.keys(paymentsByOrder).forEach(function (ref) {
        if (!isWeddingRef(ref)) return;
        var ps = paymentsByOrder[ref];
        if (ps.length > 1) alerts.push('Multiples pagos aprobados para la misma orden en MP: ' + ref + ' (' + ps.length + ')');
        var opIndex = opByOrder[ref];
        if (opIndex === undefined) {
          ps.forEach(function (p) {
            recon.omittedPayments.push({ orderId: ref, paymentId: String(p.id), amount: Number(p.transaction_amount) });
            alerts.push('Pago aprobado en MP no registrado en Operaciones: orden ' + ref + ', pago ' + p.id + ', monto ' + p.transaction_amount);
          });
          return;
        }
        ps.forEach(function (p) {
          var opAmount = Number(opsData[opIndex][5]) || 0;
          var mpAmount = Number(p.transaction_amount) || 0;
          if (Math.abs(opAmount - mpAmount) > 0.01) {
            recon.amountMismatches.push({ orderId: ref, opAmount: opAmount, mpAmount: mpAmount });
            alerts.push('Diferencia de importe: ' + ref + ' Operaciones=' + opAmount + ' MP=' + mpAmount);
          }
          var opStatus = String(opsData[opIndex][2] || '').toLowerCase();
          if (opStatus.indexOf('aprob') < 0) alerts.push('Orden no aprobada en Operaciones pese a pago aprobado en MP: ' + ref);

          // origin from MP live_mode
          var mpOrigin = p.live_mode === true ? 'LIVE' : (p.live_mode === false ? 'SANDBOX' : '');
          var existingOrigin = String(opsSh.getRange(opIndex + 1, 14).getValue() || '').trim();
          if (!existingOrigin && mpOrigin) opsSh.getRange(opIndex + 1, 14).setValue(mpOrigin);
          if (existingOrigin && mpOrigin && existingOrigin.toUpperCase() !== mpOrigin) {
            alerts.push('Conflicto de origen LIVE/SANDBOX: ' + ref + ' hoja=' + existingOrigin + ' MP=' + mpOrigin);
          }

          // payer name recovery
          var payerName = '';
          try {
            if (p.payer) {
              payerName = String(p.payer.first_name || '').trim() + ' ' + String(p.payer.last_name || '').trim();
              payerName = payerName.trim();
              if (!payerName) payerName = String(p.payer.email || '').trim();
            }
          } catch (e) {}
          var existingGuest = String(opsData[opIndex][8] || '').trim();
          if (!existingGuest && payerName) {
            opsSh.getRange(opIndex + 1, 9).setValue(payerName);
            opsSh.getRange(opIndex + 1, 9).setNote('Nombre recuperado automaticamente desde Mercado Pago durante conciliacion; puede ser reemplazado por el nombre elegido por el invitado.');
            recoveredNames.push({ orderId: ref, name: payerName });
          }
          var existingPaymentId = String(opsData[opIndex][7] || '').trim();
          if (!existingPaymentId && p.id) opsSh.getRange(opIndex + 1, 8).setValue(String(p.id));
        });
      });

      // verify approved operations against MP
      for (var i = 1; i < opsData.length; i++) {
        var status = String(opsData[i][2] || '').toLowerCase();
        if (status.indexOf('aprob') < 0) continue;
        var oid = String(opsData[i][0] || '').trim();
        var mpPaymentId = String(opsData[i][7] || '').trim();
        var mpOrderId = String(opsData[i][6] || '').trim();
        var guest = String(opsData[i][8] || '').trim();
        var dedication = String(opsData[i][9] || '').trim();
        var origin = String(opsSh.getRange(i + 1, 14).getValue() || '').trim();
        if (origin.toUpperCase() === 'SANDBOX') continue;
        // find in MP search
        var found = paymentsByOrder[oid] || [];
        if (!found.length && mpPaymentId) {
          // try fetch payment directly
          try {
            var token = hgMpToken();
            if (token) {
              var r = UrlFetchApp.fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(mpPaymentId), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
              if (r.getResponseCode() === 200) found = [JSON.parse(r.getContentText())];
            }
          } catch (e) {}
        }
        if (!found.length) {
          alerts.push('Operacion aprobada sin pago aprobado verificable en MP: ' + oid);
        } else {
          var p0 = found[0];
          if (String(p0.status || '').toLowerCase() !== 'approved') alerts.push('Pago en MP no aprobado para operacion aprobada: ' + oid + ' (' + p0.status + ')');
          var mpAmt = Number(p0.transaction_amount) || 0;
          var opAmt = Number(opsData[i][5]) || 0;
          if (mpAmt && Math.abs(mpAmt - opAmt) > 0.01) {
            recon.amountMismatches.push({ orderId: oid, opAmount: opAmt, mpAmount: mpAmt });
            alerts.push('Diferencia de importe: ' + oid + ' Operaciones=' + opAmt + ' MP=' + mpAmt);
          }
        }
        if (!guest) {
          recon.missingNames.push(oid);
          alerts.push('Nombre faltante (no recuperado de MP): ' + oid);
        }
        if (!dedication) {
          // try historical recovery
          var hist = hgSearchPreviousBackupsForDedication(oid);
          if (hist) {
            opsSh.getRange(i + 1, 10).setValue(hist);
            recoveredDedications.push({ orderId: oid, dedication: hist });
          } else {
            optionalEmpty.push({ type: 'dedicacion', orderId: oid, note: 'campo opcional vacio, no es perdida de datos' });
          }
        }
        if (!origin) alerts.push('Origen vacio para operacion aprobada: ' + oid);
        var expId = String(opsData[i][1] || '').trim();
        var catStatus = catMap[expId] || '';
        if (catStatus.toLowerCase().indexOf('disponible') >= 0) {
          alerts.push('Cat\u00e1logo inconsistente: experiencia aparece disponible pese a pago aprobado: ' + expId + ' (' + oid + ')');
          inconsistencies.push({ type: 'catalog', experienceId: expId, orderId: oid });
        }
      }
    }

    // RSVP reconciliation
    var rsvpRows = hgGetRsvpRows();
    var confirmed = 0;
    rsvpRows.forEach(function (r) { if (String(r.asiste || '').toLowerCase().indexOf('s') === 0) confirmed++; });
    recon.currentRsvpConfirmed = confirmed;
    // previous backup
    try {
      var folder = hgGetOrCreateBackupFolder();
      var lastConfirmed = 0;
      var it = folder.getFiles();
      var latestTime = 0;
      while (it.hasNext()) {
        var f = it.next();
        if (f.getName().indexOf('rsvp.json') < 0) continue;
        if (f.getLastUpdated().getTime() > latestTime) {
          latestTime = f.getLastUpdated().getTime();
          try {
            var arr = JSON.parse(f.getBlob().getDataAsString());
            if (Array.isArray(arr)) {
              // count confirmed in backup by asiste column index 3
              var c = 0;
              for (var i = 1; i < arr.length; i++) {
                var a = String(arr[i][3] || '').toLowerCase();
                if (a.indexOf('s') === 0) c++;
              }
              lastConfirmed = c;
            }
          } catch (e) {}
        }
      }
      recon.previousRsvpConfirmed = lastConfirmed;
      if (lastConfirmed > 0 && confirmed < lastConfirmed) {
        recon.lostRsvpConfirmations = true;
        alerts.push('Posible perdida de confirmaciones RSVP: anterior=' + lastConfirmed + ' actual=' + confirmed);
      }
    } catch (e) {}

    // time zone / invalid dates
    for (var i = 1; i < opsData.length; i++) {
      var cAt = hgParseDate(opsData[i][3]);
      var confAt = hgParseDate(opsData[i][10]);
      if (opsData[i][3] && !cAt) alerts.push('Fecha de creacion invalida (posible zona horaria): orden ' + String(opsData[i][0]));
      if (opsData[i][10] && !confAt) alerts.push('Fecha de confirmacion invalida (posible zona horaria): orden ' + String(opsData[i][0]));
    }

    // backup check
    var lastBackup = PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_AT') || '';
    if (!lastBackup) alerts.push('No hay backup registrado.');

  } catch (e) {
    alerts.push('Error durante conciliacion: ' + String(e));
  }

  HG_LAST_RECON = recon;
  return recon;
}

function hgDailyDigest() {
  var testMode = HG_DIGEST_TEST_MODE;
  var props = PropertiesService.getScriptProperties();
  var tz = 'America/Argentina/Buenos_Aires';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (!testMode && props.getProperty('LAST_DIGEST_DATE') === today) return { skipped: true, reason: 'already_sent' };

  var gifts = hgGetApprovedGifts();
  var rsvp = hgGetRsvpRows();
  var confirmed = [], pending = [], rejected = [];
  rsvp.forEach(function (r) {
    var a = r.asiste.toLowerCase();
    if (a.indexOf('s') === 0) confirmed.push(r);
    else if (a.indexOf('n') === 0) rejected.push(r);
    else pending.push(r);
  });

  var totalApproved = gifts.length;
  var totalAmount = gifts.reduce(function (s, g) { return s + (g.amount || 0); }, 0);

  // changes since last digest: compare approved order ids
  var lastApproved = props.getProperty('LAST_APPROVED_IDS') || '';
  var lastIds = lastApproved ? lastApproved.split(',') : [];
  var isFirstRun = (lastIds.length === 0);
  var newGifts = isFirstRun ? [] : gifts.filter(function (g) { return lastIds.indexOf(g.orderId) < 0; });

  // RSVP changes
  var lastRsvp = props.getProperty('LAST_RSVP_STATES') || '';
  var lastRsvpMap = {};
  var isFirstRsvp = !lastRsvp;
  if (lastRsvp) { try { lastRsvpMap = JSON.parse(lastRsvp); } catch (e) {} }
  var newConfirmed = [], newRejected = [], changed = [];
  if (!isFirstRsvp) {
    rsvp.forEach(function (r) {
      var key = r.token + '|' + r.persona;
      var prev = lastRsvpMap[key];
      var cur = r.asiste + '|' + r.estado;
      if (!prev) { if (r.asiste.toLowerCase().indexOf('s') === 0) newConfirmed.push(r); if (r.asiste.toLowerCase().indexOf('n') === 0) newRejected.push(r); }
      else if (prev !== cur) { changed.push({ r: r, prev: prev, cur: cur }); }
    });
  }

  // automatic reconciliation before report
  var recon = hgReconcileGiftIntegrity();
  var alerts = recon.alerts.slice();
  // check approved count didn't decrease
  var prevApprovedCount = Number(props.getProperty('LAST_APPROVED_COUNT') || 0);
  if (prevApprovedCount > 0 && totalApproved < prevApprovedCount) alerts.push('Disminucion anomala de pagos aprobados: ' + prevApprovedCount + ' -> ' + totalApproved);
  // check catalog status consistency: approved gifts should not be available
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var cat = ss.getSheetByName('Catálogo circuito v0.9').getDataRange().getValues();
  var catMap = {};
  for (var i = 1; i < cat.length; i++) catMap[String(cat[i][0])] = String(cat[i][12] || '');
  gifts.forEach(function (g) {
    var st = catMap[g.experienceId] || '';
    if (st.toLowerCase().indexOf('disponible') >= 0) alerts.push('Regalo cobrado aparece disponible: ' + g.experienceId);
  });
  // backup check
  var lastBackup = props.getProperty('LAST_BACKUP_AT') || '';
  if (!lastBackup) alerts.push('No hay backup registrado.');

  // build HTML
  var html = '<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;">';
  html += '<h2>Mariana &amp; Hern&aacute;n &mdash; Resumen diario</h2>';
  html += '<p>Fecha: ' + today + '</p>';

  html += '<h3>A. Resumen de regalos</h3>';
  html += '<ul>';
  html += '<li>Pagos aprobados: ' + totalApproved + '</li>';
  html += '<li>Importe total cobrado (ARS): ' + totalAmount.toFixed(2) + '</li>';
  html += '<li>Experiencias regaladas: ' + totalApproved + '</li>';
  html += '<li>Nuevos regalos hoy: ' + newGifts.length + '</li>';
  html += '<li>Operaciones pendientes: ' + (opsPendingCount()) + '</li>';
  html += '</ul>';

  html += '<h3>B. Detalle nominal de regalos aprobados</h3>';
  if (gifts.length === 0) html += '<p>Sin regalos aprobados.</p>';
  else {
    html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:12px;">';
    html += '<tr><th>Regalante</th><th>Experiencia</th><th>Destino</th><th>Fecha</th><th>Importe ARS</th><th>Dedicatoria</th><th>Estado</th><th>ID</th></tr>';
    gifts.forEach(function (g) {
      html += '<tr>';
      html += '<td>' + hgEscapeHtml(g.guest || '(sin nombre)') + '</td>';
      html += '<td>' + hgEscapeHtml(g.title) + '</td>';
      html += '<td>' + hgEscapeHtml(g.city) + '</td>';
      html += '<td>' + (g.confirmedAt ? Utilities.formatDate(new Date(g.confirmedAt), tz, 'dd/MM/yyyy') : '') + '</td>';
      html += '<td>' + g.amount.toFixed(2) + '</td>';
      html += '<td>' + hgEscapeHtml(g.dedication) + '</td>';
      html += '<td>Aprobado</td>';
      html += '<td>' + hgEscapeHtml(g.orderId) + '</td>';
      html += '</tr>';
    });
    html += '</table>';
  }

  html += '<h3>C. RSVP</h3>';
  html += '<p>Confirmados: ' + confirmed.length + ' | Pendientes: ' + pending.length + ' | Rechazados: ' + rejected.length + ' | Total registros: ' + rsvp.length + '</p>';

  html += '<h4>CONFIRMADOS</h4>';
  if (confirmed.length === 0) html += '<p>Ninguno.</p>';
  else {
    html += '<ul>';
    confirmed.forEach(function (r) {
      html += '<li>' + hgEscapeHtml(r.persona) + (r.grupo ? ' (grupo: ' + hgEscapeHtml(r.grupo) + ')' : '') + (r.ultima ? ' — ' + Utilities.formatDate(r.ultima, tz, 'dd/MM/yyyy') : '') + (r.notaGrupo ? ' — obs: ' + hgEscapeHtml(r.notaGrupo) : '') + '</li>';
    });
    html += '</ul>';
  }

  html += '<h4>PENDIENTES</h4>';
  if (pending.length === 0) html += '<p>Ninguno.</p>';
  else {
    html += '<ul>';
    pending.forEach(function (r) {
      html += '<li>' + hgEscapeHtml(r.persona) + (r.grupo ? ' (grupo: ' + hgEscapeHtml(r.grupo) + ')' : '') + '</li>';
    });
    html += '</ul>';
  }

  html += '<h4>RECHAZADOS</h4>';
  if (rejected.length === 0) html += '<p>Ninguno.</p>';
  else {
    html += '<ul>';
    rejected.forEach(function (r) {
      html += '<li>' + hgEscapeHtml(r.persona) + (r.grupo ? ' (grupo: ' + hgEscapeHtml(r.grupo) + ')' : '') + (r.ultima ? ' — ' + Utilities.formatDate(r.ultima, tz, 'dd/MM/yyyy') : '') + '</li>';
    });
    html += '</ul>';
  }

  html += '<h3>D. Cambios del dia</h3>';
  html += '<ul>';
  html += '<li>Nuevos regalos aprobados: ' + newGifts.length + '</li>';
  html += '<li>Nuevas confirmaciones RSVP: ' + newConfirmed.length + '</li>';
  html += '<li>Nuevos rechazos RSVP: ' + newRejected.length + '</li>';
  html += '<li>Cambios de respuesta RSVP: ' + changed.length + '</li>';
  html += '</ul>';

  html += '<h3>E. Estado del sistema</h3>';
  html += '<ul>';
  html += '<li>Ultimo backup: ' + lastBackup + '</li>';
  html += '<li>Alertas: ' + (alerts.length ? alerts.join('; ') : 'ninguna') + '</li>';
  if (recon) {
    html += '<li>Reconciliacion: pagos omitidos=' + (recon.omittedPayments || []).length + ', nombres recuperados=' + (recon.recoveredNames || []).length + ', dedicatorias recuperadas=' + (recon.recoveredDedications || []).length + ', campos opcionales vacios=' + (recon.optionalEmpty || []).length + '.</li>';
  }
  html += '</ul>';

  html += '<p style="font-size:11px;color:#888;">Adjunto: reporte XLSX con detalle completo.</p>';
  html += '</body></html>';

  var plain = 'Resumen diario - Mariana & Hernan\n\n' +
    'Regalos aprobados: ' + totalApproved + '\n' +
    'Importe total ARS: ' + totalAmount.toFixed(2) + '\n' +
    'RSVP confirmados: ' + confirmed.length + ' | pendientes: ' + pending.length + ' | rechazados: ' + rejected.length + '\n' +
    'Ultimo backup: ' + lastBackup + '\n' +
    'Alertas: ' + (alerts.length ? alerts.join('; ') : 'ninguna') + '\n';

  // build XLSX
  var xlsxFile = hgBuildXlsxReport(gifts, rsvp, newGifts, newConfirmed, newRejected, changed, alerts, today, lastBackup, totalAmount, recon);

  var owner = Session.getEffectiveUser().getEmail();
  var subject = testMode ? '[PRUEBA CORREGIDA] Mariana & Hernán — Informe completo' : 'Mariana & Hernán | Regalos y confirmaciones — ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  var attachments = [];
  if (xlsxFile) attachments.push(xlsxFile);
  MailApp.sendEmail({
    to: owner,
    cc: 'marianatavaresmello@gmail.com',
    subject: subject,
    body: plain,
    htmlBody: html,
    attachments: attachments
  });

  // persist state
  if (!testMode) {
    props.setProperty('LAST_DIGEST_DATE', today);
    props.setProperty('LAST_APPROVED_IDS', gifts.map(function (g) { return g.orderId; }).join(','));
    props.setProperty('LAST_APPROVED_COUNT', String(totalApproved));
    var rsvpState = {};
    rsvp.forEach(function (r) { rsvpState[r.token + '|' + r.persona] = r.asiste + '|' + r.estado; });
    props.setProperty('LAST_RSVP_STATES', JSON.stringify(rsvpState));
    hgAppendEventLog('DIGEST_SENT', JSON.stringify({ date: today, approved: totalApproved, rsvpConfirmed: confirmed.length, alerts: alerts }));
  } else {
    hgAppendEventLog('TEST_DIGEST_SENT', JSON.stringify({ date: today, approved: totalApproved, rsvpConfirmed: confirmed.length }));
  }
  return { sent: true, to: owner, alerts: alerts };
}

function opsPendingCount() {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var ops = ss.getSheetByName('Operaciones').getDataRange().getValues();
  var n = 0;
  for (var i = 1; i < ops.length; i++) {
    var st = String(ops[i][2] || '').toLowerCase();
    if (st.indexOf('pendiente') >= 0 || st.indexOf('pending') >= 0 || st.indexOf('in_process') >= 0 || st.indexOf('authorized') >= 0) n++;
  }
  return n;
}

function hgBuildXlsxReport(gifts, rsvp, newGifts, newConfirmed, newRejected, changed, alerts, today, lastBackup, totalAmount, recon) {
  var ss = SpreadsheetApp.create('Mariana_Hernan_Estado_' + today);
  // RESUMEN
  var sh = ss.getActiveSheet();
  sh.setName('RESUMEN');
  sh.appendRow(['Campo', 'Valor']);
  sh.appendRow(['Fecha de generacion', today]);
  sh.appendRow(['Total regalos cobrados', gifts.length]);
  sh.appendRow(['Importe total ARS', totalAmount]);
  sh.appendRow(['Regalos nuevos desde ultimo reporte', newGifts.length]);
  sh.appendRow(['RSVP confirmados', rsvp.filter(function (r) { return r.asiste.toLowerCase().indexOf('s') === 0; }).length]);
  sh.appendRow(['RSVP pendientes', rsvp.filter(function (r) { return r.asiste.toLowerCase().indexOf('s') !== 0 && r.asiste.toLowerCase().indexOf('n') !== 0; }).length]);
  sh.appendRow(['RSVP rechazados', rsvp.filter(function (r) { return r.asiste.toLowerCase().indexOf('n') === 0; }).length]);
  sh.appendRow(['Total registros RSVP', rsvp.length]);
  sh.appendRow(['Ultimo backup', lastBackup]);
  sh.appendRow(['Alertas', alerts.length ? alerts.join('; ') : 'ninguna']);

  // REGALOS
  var sh2 = ss.insertSheet('REGALOS');
  sh2.appendRow(['ID de operacion', 'Fecha', 'Regalante', 'Comprador', 'Experiencia', 'Destino', 'Importe ARS', 'Estado de pago', 'Dedicatoria', 'ID experiencia', 'Clasificacion']);
  gifts.forEach(function (g) {
    sh2.appendRow([g.orderId, g.confirmedAt ? new Date(g.confirmedAt) : g.createdAt, g.guest, g.guest, g.title, g.city, g.amount, 'Aprobado', g.dedication, g.experienceId, g.pilot ? 'Piloto real' : 'Regalo real']);
  });

  // RSVP
  var sh3 = ss.insertSheet('RSVP');
  sh3.appendRow(['ID', 'Nombre', 'Grupo familiar', 'Estado', 'Cantidad de asistentes', 'Adultos', 'Menores', 'Fecha de respuesta', 'Observaciones']);
  rsvp.forEach(function (r) {
    sh3.appendRow([r.token, r.persona, r.grupo, r.asiste || r.estado, '', '', '', r.ultima, r.notaGrupo]);
  });

  // CAMBIOS RECIENTES
  var sh4 = ss.insertSheet('CAMBIOS RECIENTES');
  sh4.appendRow(['Fecha', 'Tipo', 'Persona relacionada', 'Registro', 'Estado anterior', 'Estado nuevo', 'Descripcion']);
  newGifts.forEach(function (g) {
    sh4.appendRow([new Date(), 'Nuevo regalo', g.guest, g.orderId, '', 'Aprobado', g.title + ' - ' + g.city]);
  });
  newConfirmed.forEach(function (r) {
    sh4.appendRow([new Date(), 'RSVP confirmado', r.persona, r.token, '', 'Confirmado', r.grupo]);
  });
  newRejected.forEach(function (r) {
    sh4.appendRow([new Date(), 'RSVP rechazado', r.persona, r.token, '', 'Rechazado', r.grupo]);
  });
  changed.forEach(function (c) {
    sh4.appendRow([new Date(), 'Cambio RSVP', c.r.persona, c.r.token, c.prev, c.cur, c.r.grupo]);
  });

  // RECONCILIACION
  var sh5 = ss.insertSheet('RECONCILIACION');
  sh5.appendRow(['Tipo', 'Detalle', 'Severidad']);
  if (recon) {
    (recon.omittedPayments || []).forEach(function (o) { sh5.appendRow(['Pago omitido', o.orderId + ' / ' + o.paymentId + ' / ' + o.amount, 'CRITICA']); });
    (recon.amountMismatches || []).forEach(function (m) { sh5.appendRow(['Diferencia de importe', m.orderId + ': ops=' + m.opAmount + ' MP=' + m.mpAmount, 'CRITICA']); });
    (recon.missingNames || []).forEach(function (id) { sh5.appendRow(['Nombre faltante', id, 'ALTA']); });
    (recon.duplicateOrders || []).forEach(function (id) { sh5.appendRow(['Orden duplicada', id, 'ALTA']); });
    (recon.recoveredNames || []).forEach(function (r) { sh5.appendRow(['Nombre recuperado', r.orderId + ' -> ' + r.name, 'INFO']); });
    (recon.recoveredDedications || []).forEach(function (r) { sh5.appendRow(['Dedicatoria recuperada', r.orderId, 'INFO']); });
    (recon.optionalEmpty || []).forEach(function (o) { sh5.appendRow(['Campo opcional vacio', o.orderId + ' - ' + o.type, 'INFO']); });
    (recon.alerts || []).forEach(function (a) { sh5.appendRow(['Alerta', a, 'MEDIA']); });
    if (recon.lostRsvpConfirmations) sh5.appendRow(['RSVP', 'Posible perdida de confirmaciones: ' + recon.previousRsvpConfirmed + ' -> ' + recon.currentRsvpConfirmed, 'CRITICA']);
  }

  // format
  [sh, sh2, sh3, sh4, sh5].forEach(function (s) {
    s.getRange(1, 1, 1, s.getLastColumn()).setFontWeight('bold');
    s.setFrozenRows(1);
  });

  // export as XLSX via Drive
  var fileId = ss.getId();
  var url = 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    hgAppendEventLog('XLSX_EXPORT_FAILED', 'HTTP ' + resp.getResponseCode());
    return null;
  }
  var blob = resp.getBlob().setName('Mariana_Hernan_Estado_' + today + '.xlsx');
  // save in backup folder
  var folder = hgGetOrCreateBackupFolder();
  var dayFolder = null;
  var it = folder.getFolders();
  var dateStr = today;
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(dateStr) === 0) { dayFolder = f; break; }
  }
  if (!dayFolder) dayFolder = folder.createFolder(dateStr + ' backup');
  dayFolder.createFile(blob);
  hgAppendEventLog('XLSX_CREATED', JSON.stringify({ file: blob.getName(), size: blob.getBytes().length }));
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  return blob;
}

function hgSendTestDigest() {
  HG_DIGEST_TEST_MODE = true;
  var r = hgDailyDigest();
  HG_DIGEST_TEST_MODE = false;
  return r;
}

function hgClassifyOperations() {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var sh = ss.getSheetByName('Operaciones');
  var data = sh.getDataRange().getValues();
  if (String(sh.getRange(1,14).getValue() || '') !== 'Origen') {
    sh.getRange(1,14).setValue('Origen');
  }
  var sandboxIds = { 'ORD-V09-001-1794330515524': true };
  for (var i = 1; i < data.length; i++) {
    var orderId = String(data[i][0] || '');
    var origin = String(sh.getRange(i+1,14).getValue() || '');
    if (!origin) {
      if (sandboxIds[orderId]) origin = 'SANDBOX';
      else if (String(data[i][2]||'').toLowerCase().indexOf('aprob') >= 0) origin = 'LIVE';
      else origin = 'PENDING';
      sh.getRange(i+1,14).setValue(origin);
    }
  }
  return { ok: true, rows: data.length - 1 };
}

function hgGetOrigin(orderId) {
  var ss = SpreadsheetApp.openById(HG_GIFTS_SS_ID);
  var sh = ss.getSheetByName('Operaciones');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) {
      return String(data[i][13] || 'LIVE');
    }
  }
  return 'LIVE';
}

function hgRunDailyMaintenance() {
  var backup = hgRunDailyBackup();
  var digest = hgDailyDigest();
  return { backup: backup, digest: digest };
}

function installDailyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'hgRunDailyMaintenance'; });
  if (triggers.length > 1) throw new Error('Multiple daily maintenance triggers detected');
  if (triggers.length === 1) return { ok: true, installed: false, alreadyExists: true };
  ScriptApp.newTrigger('hgRunDailyMaintenance').timeBased().everyDays(1).atHour(3).create();
  return { ok: true, installed: true, alreadyExists: false };
}

function removeDailyBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'hgRunDailyMaintenance'; });
  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  return { ok: true, removed: triggers.length };
}

function hgVerifyRestore() {
  var folder = hgGetOrCreateBackupFolder();
  var it = folder.getFolders();
  var count = 0;
  while (it.hasNext()) { it.next(); count++; }
  return { backupFolders: count, folderName: folder.getName(), folderId: folder.getId() };
}


