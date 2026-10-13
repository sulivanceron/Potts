/**********************************************************************
 * DiagFlujo.gs — SOLO LEE. Radiografía de la pestaña EGRESOS del
 * archivo de flujo de CEDIS SAN PABLO, para entender por qué el
 * DASHBOARD no cuadra.
 *
 * CORRER:  radiografiaEgresosCSP()
 **********************************************************************/

var DF_CAJA = 'CEDIS SAN PABLO';
var DF_ANIO_ESPERADO = 2026;


function radiografiaEgresosCSP() {
  var fileId = fileIdDeCaja_(DF_CAJA);
  if (!fileId) throw new Error('No está registrado el archivo de ' + DF_CAJA + ' en la hoja CAJAS.');

  var ss = SpreadsheetApp.openById(fileId);
  var eg = ss.getSheetByName('EGRESOS');
  if (!eg) throw new Error('El archivo de ' + DF_CAJA + ' no tiene pestaña EGRESOS.');

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var primera = SYNC.EG_HEADER_ROW + 1;
  var ultima = eg.getLastRow();

  var cFolio = me[SYNC.EG_FOLIO];
  var cFecha = me[SYNC.EG_FECHA];
  var cAnio  = me[SYNC.EG_ANIO];
  var cMes   = me[SYNC.EG_MES];
  var cCta   = me[SYNC.EG_CUENTA];
  var cMonto = me[SYNC.EG_MONTO];

  var txt = 'RADIOGRAFIA — EGRESOS de ' + DF_CAJA + '\n';
  txt += 'Archivo: ' + ss.getName() + '\n';
  txt += 'Encabezados en fila ' + SYNC.EG_HEADER_ROW + ' · datos de ' + primera + ' a ' + ultima + '\n';
  txt += '============================================================\n';
  txt += 'Columnas encontradas:  Folio=' + dfL_(cFolio) + '  FECHA=' + dfL_(cFecha) +
         '  AÑO=' + dfL_(cAnio) + '  MES=' + dfL_(cMes) +
         '  CUENTA=' + dfL_(cCta) + '  MONTO=' + dfL_(cMonto) + '\n\n';

  if (ultima < primera) { Logger.log(txt + 'No hay filas de datos.'); return txt; }

  var n = ultima - primera + 1;
  var vals = eg.getRange(primera, 1, n, eg.getLastColumn()).getValues();

  var totalGeneral = 0;
  var porFolio = {};
  var sinFolio = [], sinFecha = [], sinAnio = [], sinMes = [], anioRaro = [];
  var porAnio = {}, porMes = {};
  var buckets = { operativos: 0, familia: 0, anticipos: 0, otros: 0 };
  var otrosCuentas = {};
  var filasConMonto = 0;

  for (var i = 0; i < n; i++) {
    var fila = vals[i];
    var nf = primera + i;

    var folio = cFolio ? String(fila[cFolio - 1] || '').trim() : '';
    var monto = cMonto ? Number(fila[cMonto - 1]) : 0;
    if (isNaN(monto)) monto = 0;

    var fecha = cFecha ? fila[cFecha - 1] : '';
    var anio  = cAnio  ? fila[cAnio - 1]  : '';
    var mes   = cMes   ? String(fila[cMes - 1] || '').trim() : '';
    var cta   = cCta   ? String(fila[cCta - 1] || '').replace(/\.0$/, '').trim() : '';

    // Fila totalmente vacía: se ignora
    if (!folio && !monto && !cta) continue;

    totalGeneral += monto;
    if (monto) filasConMonto++;

    /* --- Duplicados --- */
    if (folio) {
      var k = folio.toUpperCase();
      if (!porFolio[k]) porFolio[k] = [];
      porFolio[k].push({ fila: nf, monto: monto });
    } else {
      sinFolio.push('fila ' + nf + '  $' + dfN_(monto) + '  cta ' + (cta || '-'));
    }

    /* --- Fechas --- */
    var esFecha = (fecha instanceof Date) && !isNaN(fecha.getTime());
    if (!esFecha) sinFecha.push('fila ' + nf + '  ' + (folio || 'sin folio') + '  "' + String(fecha) + '"');

    var anioNum = Number(anio);
    if (anio === '' || anio == null) {
      sinAnio.push('fila ' + nf + '  ' + (folio || 'sin folio') + '  $' + dfN_(monto));
    } else if (isNaN(anioNum) || anioNum !== DF_ANIO_ESPERADO) {
      anioRaro.push('fila ' + nf + '  ' + (folio || 'sin folio') + '  año="' + String(anio) + '"  $' + dfN_(monto));
    }
    if (!mes) sinMes.push('fila ' + nf + '  ' + (folio || 'sin folio') + '  $' + dfN_(monto));

    var claveAnio = (anio === '' || anio == null) ? '(vacio)' : String(anio);
    porAnio[claveAnio] = (porAnio[claveAnio] || 0) + monto;
    var claveMes = mes || '(vacio)';
    porMes[claveMes] = (porMes[claveMes] || 0) + monto;

    /* --- Cajones contables --- */
    var esOp = (cta.charAt(0) === '8');
    var esFam = (cta.length === 3 && cta.charAt(0) === '9') ||
                (cta.length === 4 && (cta.substring(0, 2) === '10' || cta.substring(0, 2) === '11'));
    var esAnt = (cta.substring(0, 3) === '100');

    if (esOp)       buckets.operativos += monto;
    else if (esAnt) buckets.anticipos  += monto;
    else if (esFam) buckets.familia    += monto;
    else {
      buckets.otros += monto;
      var kk = cta || '(sin cuenta)';
      otrosCuentas[kk] = (otrosCuentas[kk] || 0) + monto;
    }
  }

  /* ---------- Reporte ---------- */
  txt += 'TOTAL DE LA COLUMNA MONTO ......... $' + dfN_(totalGeneral) + '\n';
  txt += 'Filas con monto ................... ' + filasConMonto + '\n\n';

  txt += '--- FOLIOS DUPLICADOS ---\n';
  var dup = 0, montoDup = 0;
  Object.keys(porFolio).forEach(function (k) {
    var arr = porFolio[k];
    if (arr.length < 2) return;
    dup++;
    var extra = 0;
    arr.forEach(function (x, idx) { if (idx > 0) extra += x.monto; });
    montoDup += extra;
    txt += '  ' + k + '  aparece ' + arr.length + ' veces -> filas ' +
           arr.map(function (x) { return x.fila + ' ($' + dfN_(x.monto) + ')'; }).join(', ') + '\n';
  });
  if (!dup) txt += '  Ninguno.\n';
  else txt += '  >>> ' + dup + ' folios duplicados. Monto de sobra: $' + dfN_(montoDup) + '\n';

  txt += '\n--- FILAS SIN FOLIO (capturas manuales) ---  (' + sinFolio.length + ')\n';
  txt += sinFolio.length ? '  ' + sinFolio.slice(0, 30).join('\n  ') + '\n' : '  Ninguna.\n';

  txt += '\n--- FILAS SIN FECHA VALIDA ---  (' + sinFecha.length + ')\n';
  txt += sinFecha.length ? '  ' + sinFecha.slice(0, 30).join('\n  ') + '\n' : '  Ninguna.\n';

  txt += '\n--- FILAS SIN AÑO ---  (' + sinAnio.length + ')\n';
  txt += sinAnio.length ? '  ' + sinAnio.slice(0, 30).join('\n  ') + '\n' : '  Ninguna.\n';

  txt += '\n--- FILAS CON AÑO DISTINTO DE ' + DF_ANIO_ESPERADO + ' ---  (' + anioRaro.length + ')\n';
  txt += anioRaro.length ? '  ' + anioRaro.slice(0, 30).join('\n  ') + '\n' : '  Ninguna.\n';

  txt += '\n--- FILAS SIN MES ---  (' + sinMes.length + ')\n';
  txt += sinMes.length ? '  ' + sinMes.slice(0, 30).join('\n  ') + '\n' : '  Ninguna.\n';

  txt += '\n--- MONTO POR AÑO ---\n';
  Object.keys(porAnio).sort().forEach(function (k) {
    txt += '  ' + k + ' ......... $' + dfN_(porAnio[k]) + '\n';
  });

  txt += '\n--- MONTO POR MES ---\n';
  Object.keys(porMes).sort().forEach(function (k) {
    txt += '  ' + k + ' ......... $' + dfN_(porMes[k]) + '\n';
  });

  txt += '\n--- CAJONES CONTABLES ---\n';
  txt += '  Operativos (8xx) ........ $' + dfN_(buckets.operativos) + '\n';
  txt += '  Anticipos (100x) ........ $' + dfN_(buckets.anticipos) + '\n';
  txt += '  Familia (9xx/10xx/11xx) . $' + dfN_(buckets.familia) + '\n';
  txt += '  OTROS (no clasificados) . $' + dfN_(buckets.otros) + '\n';
  txt += '  SUMA DE CAJONES ......... $' +
         dfN_(buckets.operativos + buckets.anticipos + buckets.familia + buckets.otros) + '\n';

  if (buckets.otros) {
    txt += '\n  Cuentas que cayeron en OTROS:\n';
    Object.keys(otrosCuentas).sort().forEach(function (k) {
      txt += '    "' + k + '" ......... $' + dfN_(otrosCuentas[k]) + '\n';
    });
  }

  Logger.log(txt);
  return txt;
}


function dfN_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dfL_(n) {
  if (!n) return 'NO EXISTE';
  var s = '';
  var x = n;
  while (x > 0) { var m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}