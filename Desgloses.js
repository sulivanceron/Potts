/**********************************************************************
 * Desgloses.gs — DASHBOARD de CEDIS SAN PABLO.
 *
 * ACOMODO FIJO:
 *   filas 1-22   KPIs y composición (fórmulas de la hoja, no se tocan)
 *   A25:C37  OPERATIVOS      |  F25:I37  POR ÁREA
 *   A39:C51  POR SUCURSAL    |  F39:H51  POR FAMILIA
 *   A53:C57  EGRESOS FIJOS   |  F53:H57  EGRESOS COMPROBADOS
 *   fila 59  nota: no atribuible a sucursal
 *   fila 62+ las seis gráficas 3D
 *
 * LA DIFERENCIA CLAVE CONTRA LAS VERSIONES ANTERIORES:
 * Antes solo escribía en las celdas de cada cuadro, así que cualquier
 * resto de una versión vieja se quedaba ahí conviviendo con lo nuevo
 * (por eso salían dos cuadros de área y dos de familia).
 *
 * Ahora arma TODO el bloque A24:I90 en memoria — con blancos donde no
 * va nada — y lo escribe de UN SOLO golpe. Lo que no corresponde se
 * borra en la misma operación. Es una sola escritura: instantánea, sin
 * parpadeo, y matemáticamente imposible que queden fósiles.
 *
 * El formato pesado (colores, bordes, alturas) se aplica UNA vez y se
 * recuerda con una marca interna. Para forzarlo: formatearDashboardCSP()
 *
 * IMPORTANTE: dgRomperMerges_() SOLO se llama dentro de
 * dgFormatearDashboard_() (que corre una sola vez). Ya NO se llama en
 * cada sincronización — eso era lo que desarmaba los títulos
 * combinados de los 6 cuadros una y otra vez.
 *
 * CAMBIO 09-sept-2026 — el DASHBOARD ya no se pinta desde aquí.
 * actualizarDesglosesDashboardCSP() dejó de escribir el bloque A24:I90.
 * Los seis cuadros ahora viven en la hoja con fórmulas propias (leen
 * DESGLOSES y se recalculan al abrir), así que la escritura del script
 * los borraba en cada corrida junto con su formato y sus títulos
 * combinados. Lo que la función SÍ sigue haciendo: sincronizar las
 * columnas ÁREA y SUCURSAL DEL GASTO en EGRESOS —de ahí leen dos de
 * esos cuadros— y alimentar la hoja oculta DATOS GRAFICAS.
 *
 * NO CORRER: formatearDashboardCSP() ni dgFormatearDashboard_(), porque
 * rompen las combinaciones de los títulos y repintan las filas 24-90.
 **********************************************************************/

var DG_CAJA   = 'CEDIS SAN PABLO';
var DG_ROJO   = '#c00000';
var DG_AZUL   = '#1f4e79';
var DG_TOTAL  = '#dce6f1';
var DG_LINEA  = '#b7b7b7';
var DG_FUENTE = 'Arial';
var DG_HOJA_DATOS = 'DATOS GRAFICAS';

var DG_F1 = 25, DG_F2 = 39, DG_F3 = 53;
var DG_NOTA = 59, DG_GRAF = 62;
var DG_INI = 24, DG_FIN = 90;          // bloque que se reescribe completo
var DG_MARCA = 'DG_FORMATO_V4';        // marca de "ya formateado"


/* ==================================================================
 * LECTURA ÚNICA
 * ================================================================== */
function dgLeerDatosCSP_() {
  var id = fileIdDeCaja_(DG_CAJA);
  if (!id) throw new Error(DG_CAJA + ': sin archivo registrado');

  var ext = SpreadsheetApp.openById(id);
  var eg = ext.getSheetByName('EGRESOS');
  var ing = ext.getSheetByName('INGRESOS');
  if (!eg) throw new Error('No hay pestaña EGRESOS.');

  var tz = ext.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);

  var cFecha = me[SYNC.EG_FECHA], cCuenta = me[SYNC.EG_CUENTA];
  var cConcep = me[SYNC.EG_CONCEPTO], cMonto = me[SYNC.EG_MONTO];
  var cTipo = me[SYNC.EG_TIPO], cComp = me[SYNC.EG_MONTO_COMPROBADO];
  var cArea = me[SYNC.EG_AREA] || me['AREA'];
  var cSuc = me[SYNC.EG_SUC_GASTO];

  var D = {
    ext: ext, tz: tz,
    operativos: 0, familia: 0, anticipos: 0,
    fijo: 0, variable: 0, comprobado: 0, sinComprobar: 0,
    noAtribuible: 0, totalIngresos: 0,
    porConcepto: {}, porFamilia: {}, porArea: {}, porSuc: {},
    porDiaEg: {}, porMesEg: {}, porDiaIn: {}, porMesIn: {}
  };

  var lastEg = eg.getLastRow();
  if (lastEg > SYNC.EG_HEADER_ROW) {
    var datos = eg.getRange(SYNC.EG_HEADER_ROW + 1, 1, lastEg - SYNC.EG_HEADER_ROW, eg.getLastColumn()).getValues();
    datos.forEach(function (f) {
      var monto = Number(f[cMonto - 1]) || 0;
      if (!monto) return;
      var fecha = f[cFecha - 1];
      if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return;
      if (antesDeOperacion_(fecha)) return;

      var kd = Utilities.formatDate(fecha, tz, 'yyyy-MM-dd');
      var km = Utilities.formatDate(fecha, tz, 'yyyy-MM');
      D.porDiaEg[kd] = (D.porDiaEg[kd] || 0) + monto;
      D.porMesEg[km] = (D.porMesEg[km] || 0) + monto;

      var cuenta = String(f[cCuenta - 1] || '').replace(/\.0$/, '').trim();
      var etiqueta = String(f[cConcep - 1] || '').trim() || cuenta || '(sin concepto)';
      var esFam = (cuenta.length === 3 && cuenta.charAt(0) === '9') ||
                  (cuenta.length === 4 && (cuenta.substring(0, 2) === '10' || cuenta.substring(0, 2) === '11'));
      var esAnt = (cuenta.substring(0, 3) === '100');

      if (esAnt)      { D.anticipos += monto; }
      else if (esFam) { D.familia += monto;    D.porFamilia[etiqueta]  = (D.porFamilia[etiqueta]  || 0) + monto; }
      else            { D.operativos += monto; D.porConcepto[etiqueta] = (D.porConcepto[etiqueta] || 0) + monto; }

      var tipo = normalizarTexto(cTipo ? f[cTipo - 1] : '');
      if (tipo.indexOf('FIJ') === 0) D.fijo += monto; else D.variable += monto;

      var vComp = cComp ? String(f[cComp - 1] || '').trim() : '';
      if (vComp !== '') D.comprobado += monto; else D.sinComprobar += monto;

      if (cArea) {
        var a = String(f[cArea - 1] || '').trim() || '(sin área)';
        D.porArea[a] = (D.porArea[a] || 0) + monto;
      }
      if (cSuc) {
        var s = String(f[cSuc - 1] || '').trim();
        var partes = s.split(',').map(function (x) { return x.trim(); })
                      .filter(function (x) { return x !== '' && normalizarTexto(x) !== normalizarTexto('Ninguna'); });
        if (!partes.length) { D.noAtribuible += monto; }
        else {
          var parte = monto / partes.length;
          partes.forEach(function (p) { D.porSuc[p] = (D.porSuc[p] || 0) + parte; });
        }
      }
    });
  }

  if (ing) {
    var mi = mapaFila_(ing, SYNC.EG_HEADER_ROW);
    var ciF = mi['FECHA'], ciM = mi['MONTO'];
    var lastIn = ing.getLastRow();
    if (lastIn > SYNC.EG_HEADER_ROW && ciF && ciM) {
      var dIn = ing.getRange(SYNC.EG_HEADER_ROW + 1, 1, lastIn - SYNC.EG_HEADER_ROW, ing.getLastColumn()).getValues();
      dIn.forEach(function (f) {
        var m = Number(f[ciM - 1]) || 0;
        var fe = f[ciF - 1];
        if (!m || !(fe instanceof Date) || isNaN(fe.getTime())) return;
        if (antesDeOperacion_(fe)) return;
        D.totalIngresos += m;
        var kd = Utilities.formatDate(fe, tz, 'yyyy-MM-dd');
        var km = Utilities.formatDate(fe, tz, 'yyyy-MM');
        D.porDiaIn[kd] = (D.porDiaIn[kd] || 0) + m;
        D.porMesIn[km] = (D.porMesIn[km] || 0) + m;
      });
    }
  }

  D.totalEgresos = D.operativos + D.familia + D.anticipos;
  return D;
}

function dgTop_(obj, n) {
  return Object.keys(obj).map(function (k) { return [k, obj[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
}

function dgN_(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v || '');
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


/* ==================================================================
 * YA NO PINTA EL DASHBOARD (ver nota del encabezado, 09-sept-2026).
 * Ahora solo hace dos cosas: sincroniza las columnas ÁREA y SUCURSAL
 * DEL GASTO en EGRESOS, y alimenta la hoja oculta DATOS GRAFICAS.
 * ================================================================== */
function actualizarDesglosesDashboardCSP() {
  // ESTAS DOS SE CONSERVAN: llenan las columnas ÁREA y SUCURSAL DEL GASTO
  // en EGRESOS. Los desgloses del archivo (que ahora son fórmulas) leen
  // justo esas dos columnas; sin esto se irían vaciando en silencio.
  try { sincronizarAreaEgresosCSP_(); }   catch (e) { console.error('ÁREA: ' + e.message); }
  try { sincronizarSucursalGastoCSP_(); } catch (e) { console.error('SUC. GASTO: ' + e.message); }

  var D = dgLeerDatosCSP_();
  var dash = D.ext.getSheetByName('DASHBOARD');
  if (!dash) return 'No hay pestaña DASHBOARD.';

  /* -------------------------------------------------------------------
     DESACTIVADO 09-sept-2026 — ya NO se pinta el bloque A24:I90.

     Antes, aquí se armaba la matriz M de los seis cuadros y se escribía
     de un golpe con dash.getRange(DG_INI, 1, ALTO, ANCHO).setValues(M).
     Ese bloque (filas 24 a 90) es exactamente donde viven los seis
     cuadros del archivo, así que cada corrida los borraba junto con sus
     títulos combinados y su formato.

     Ahora esos seis cuadros se calculan con fórmulas propias en la hoja,
     que leen DESGLOSES y se actualizan solas al abrir el archivo. Por eso
     el script ya no tiene nada que escribir ahí.

     Tampoco se llama dgFormatearDashboard_(), porque esa función corre
     dgRomperMerges_() y repinta colores, bordes y alturas de esas mismas
     filas.

     Si algún día se quisiera regresar al dashboard pintado por script,
     dgFormatearDashboard_() y dgTop_() siguen intactos más abajo; lo que
     habría que volver a escribir aquí es la matriz M y su función poner(),
     que vivían dentro de esta misma función.
     ------------------------------------------------------------------- */

  /* --- Esto SÍ se conserva: alimenta la hoja oculta DATOS GRAFICAS,
         que es de donde leen las seis gráficas 3D del DASHBOARD. --- */
  var g = '';
  try { g = dgEscribirDatosGraficas_(D) + ' · ' + dgAsegurarGraficas_(D.ext); }
  catch (e) { g = 'gráficas: ' + e.message; }

  var msg = 'DASHBOARD (solo datos y gráficas) · operativos $' + dgN_(D.operativos) +
            ' · familia $' + dgN_(D.familia) + ' · anticipos $' + dgN_(D.anticipos) +
            ' · TOTAL $' + dgN_(D.totalEgresos) +
            ' · no atribuible $' + dgN_(D.noAtribuible) + ' · ' + g;
  Logger.log(msg);
  return msg;
}


/* ==================================================================
 * FORMATO de los seis cuadros. Se aplica una vez.
 * Para forzarlo a mano:  formatearDashboardCSP()
 * ================================================================== */
function dgFormatearDashboard_(dash) {
  var bloques = [
    { f: DG_F1, c: 1, w: 3, n: 10, pi: false },
    { f: DG_F1, c: 6, w: 4, n: 10, pi: true  },
    { f: DG_F2, c: 1, w: 3, n: 10, pi: false },
    { f: DG_F2, c: 6, w: 3, n: 10, pi: false },
    { f: DG_F3, c: 1, w: 3, n: 2,  pi: false },
    { f: DG_F3, c: 6, w: 3, n: 2,  pi: false }
  ];

  dgRomperMerges_(dash);
  dash.getRange(DG_INI, 1, DG_FIN - DG_INI + 1, 9)
      .setBackground(null)
      .setFontFamily(DG_FUENTE).setFontSize(9).setFontWeight('normal').setFontColor('#000000')
      .setBorder(false, false, false, false, false, false);

  bloques.forEach(function (b) {
    var t = dash.getRange(b.f, b.c, 1, b.w);
    try { t.merge(); } catch (e) {}
    t.setFontSize(11).setFontWeight('bold').setFontColor('#ffffff')
     .setBackground(DG_ROJO).setHorizontalAlignment('center')
     .setVerticalAlignment('middle');
    dash.setRowHeight(b.f, 26);

    dash.getRange(b.f + 1, b.c, 1, b.w)
        .setFontWeight('bold').setFontColor('#ffffff').setBackground(DG_AZUL)
        .setHorizontalAlignment('center').setWrap(true);
    dash.setRowHeight(b.f + 1, 22);

    dash.getRange(b.f + 2, b.c, b.n, 1).setHorizontalAlignment('left');
    dash.getRange(b.f + 2, b.c + 1, b.n + 1, 1).setNumberFormat('$#,##0.00');
    dash.getRange(b.f + 2, b.c + 2, b.n + 1, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    if (b.pi) dash.getRange(b.f + 2, b.c + 3, b.n + 1, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    for (var r = b.f + 2; r < b.f + 2 + b.n; r++) dash.setRowHeight(r, 21);

    dash.getRange(b.f + 2 + b.n, b.c, 1, b.w)
        .setFontWeight('bold').setBackground(DG_TOTAL);
    dash.setRowHeight(b.f + 2 + b.n, 22);

    dash.getRange(b.f, b.c, b.n + 3, b.w)
        .setBorder(true, true, true, true, true, true, DG_LINEA, SpreadsheetApp.BorderStyle.SOLID);
  });

  var nota = dash.getRange(DG_NOTA, 1, 1, 4);
  try { nota.merge(); } catch (e) {}
  nota.setFontSize(10).setFontStyle('italic').setFontColor('#6b7785')
      .setHorizontalAlignment('left');
}

/* Fuerza reaplicar el formato de los cuadros */
function formatearDashboardCSP() {
  var id = fileIdDeCaja_(DG_CAJA);
  var dash = SpreadsheetApp.openById(id).getSheetByName('DASHBOARD');
  dgFormatearDashboard_(dash);
  PropertiesService.getScriptProperties().setProperty(DG_MARCA, 'ok');
  return 'Formato reaplicado.';
}


/* ==================================================================
 * DATOS DE LAS GRÁFICAS en posiciones FIJAS de la hoja oculta.
 * ================================================================== */
function dgEscribirDatosGraficas_(D) {
  var ext = D.ext;
  var d = ext.getSheetByName(DG_HOJA_DATOS);
  if (!d) d = ext.insertSheet(DG_HOJA_DATOS, ext.getNumSheets());

  d.getRange(1, 1, 100, 20).clearContent();

  function pon(col, encabezados, filas, alto) {
    d.getRange(1, col, 1, encabezados.length).setValues([encabezados]);
    var cuerpo = [];
    for (var i = 0; i < alto; i++) {
      var f = filas[i] || [];
      var r = [];
      for (var j = 0; j < encabezados.length; j++) r.push(f[j] == null ? '' : f[j]);
      cuerpo.push(r);
    }
    d.getRange(2, col, alto, encabezados.length).setValues(cuerpo);
  }

  pon(1, ['Concepto', 'Monto'], [
    ['Gastos operativos', D.operativos],
    ['Gastos de familia', D.familia],
    ['Anticipos a proveedores', D.anticipos]
  ], 3);

  var meses = Object.keys(D.porMesEg).concat(Object.keys(D.porMesIn))
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  pon(4, ['Mes', 'Ingresos', 'Egresos'], meses.map(function (k) {
    var p = k.split('-');
    return [MESES_ES[Number(p[1]) - 1] + ' ' + p[0], D.porMesIn[k] || 0, D.porMesEg[k] || 0];
  }), 13);

  var dias = Object.keys(D.porDiaEg).concat(Object.keys(D.porDiaIn))
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  var acum = 0;
  pon(8, ['Día', 'Neto acumulado'], dias.map(function (k) {
    acum += (D.porDiaIn[k] || 0) - (D.porDiaEg[k] || 0);
    var p = k.split('-');
    return [p[2] + '/' + p[1], acum];
  }), 94);

  pon(11, ['Concepto', 'Monto'], dgTop_(D.porConcepto, 8), 8);
  pon(14, ['Área', 'Monto'],     dgTop_(D.porArea, 8), 8);
  pon(17, ['Sucursal', 'Monto'], dgTop_(D.porSuc, 8), 8);

  try { d.hideSheet(); } catch (e) {}
  return 'datos de gráficas ok';
}


/* ==================================================================
 * Las seis gráficas 3D. Solo se crean si faltan.
 * ================================================================== */
function dgAsegurarGraficas_(ext) {
  var dash = ext.getSheetByName('DASHBOARD');
  var d = ext.getSheetByName(DG_HOJA_DATOS);
  if (!dash || !d) return 'sin DASHBOARD o sin datos';
  if (dash.getCharts().length >= 6) return 'gráficas ya estaban';

  dash.getCharts().forEach(function (c) { dash.removeChart(c); });

  var A = 600, H = 330;

  function pastel(rango, titulo, f, c, colores) {
    dash.insertChart(dash.newChart().asPieChart().set3D()
      .addRange(rango).setOption('title', titulo)
      .setOption('titleTextStyle', { fontSize: 14, bold: true, color: '#0b3d66' })
      .setOption('pieSliceText', 'percentage')
      .setOption('legend', { position: 'right', textStyle: { fontSize: 10 } })
      .setOption('colors', colores)
      .setOption('width', A).setOption('height', H)
      .setPosition(f, c, 0, 0).build());
  }
  function columnas(rango, titulo, f, c, colores) {
    dash.insertChart(dash.newChart().asColumnChart()
      .addRange(rango).setOption('is3D', true).setOption('title', titulo)
      .setOption('titleTextStyle', { fontSize: 14, bold: true, color: '#0b3d66' })
      .setOption('legend', { position: 'top', textStyle: { fontSize: 10 } })
      .setOption('colors', colores)
      .setOption('hAxis', { textStyle: { fontSize: 9 } })
      .setOption('vAxis', { format: 'short', textStyle: { fontSize: 9 } })
      .setOption('width', A).setOption('height', H)
      .setPosition(f, c, 0, 0).build());
  }
  function barras(rango, titulo, f, c, color) {
    dash.insertChart(dash.newChart().asBarChart()
      .addRange(rango).setOption('is3D', true).setOption('title', titulo)
      .setOption('titleTextStyle', { fontSize: 14, bold: true, color: '#0b3d66' })
      .setOption('legend', { position: 'none' })
      .setOption('colors', [color])
      .setOption('hAxis', { format: 'short', textStyle: { fontSize: 9 } })
      .setOption('vAxis', { textStyle: { fontSize: 10 } })
      .setOption('width', A).setOption('height', H)
      .setPosition(f, c, 0, 0).build());
  }

  pastel(d.getRange('A1:B4'),    'COMPOSICIÓN DEL EGRESO TOTAL',             DG_GRAF,      1, ['#c00000', '#f4a300', '#12558c']);
  columnas(d.getRange('D1:F14'), 'INGRESOS vs EGRESOS POR MES',              DG_GRAF,      7, ['#1f7a3e', '#c00000']);
  columnas(d.getRange('H1:I95'), 'NETO ACUMULADO DE CAJA (día por día)',     DG_GRAF + 20, 1, ['#12558c']);
  barras(d.getRange('K1:L9'),    'TOP 8 GASTOS OPERATIVOS',                  DG_GRAF + 20, 7, '#c00000');
  barras(d.getRange('N1:O9'),    'GASTOS POR ÁREA (top 8)',                  DG_GRAF + 40, 1, '#0b3d66');
  barras(d.getRange('Q1:R9'),    'GASTOS POR SUCURSAL (top 8, prorrateado)', DG_GRAF + 40, 7, '#1f7a3e');

  return 'gráficas creadas: 6';
}


function recrearGraficasCSP() {
  var D = dgLeerDatosCSP_();
  dgEscribirDatosGraficas_(D);
  var dash = D.ext.getSheetByName('DASHBOARD');
  dash.getCharts().forEach(function (c) { dash.removeChart(c); });
  var r = dgAsegurarGraficas_(D.ext);
  Logger.log(r);
  return r;
}

function generarGraficasCSP() { return recrearGraficasCSP(); }


/* Recrea el RESUMEN DIARIO (solo si le vuelve a aparecer una Tabla) */
function resetearResumenDiarioCSP() {
  var id = fileIdDeCaja_(DG_CAJA);
  if (!id) return DG_CAJA + ': sin archivo registrado';
  var ext = SpreadsheetApp.openById(id);
  var s = ext.getSheetByName('RESUMEN DIARIO');
  if (s) { ext.deleteSheet(s); Logger.log('RESUMEN DIARIO recreada'); }
  return 'Listo. Ahora corre sincronizarTodo.';
}
/* Rompe TODAS las combinaciones que se crucen con el bloque del
   dashboard. Se usan los rangos completos, no pedazos, que es lo que
   Google exige y por eso truena si se hace de otro modo. */
function dgRomperMerges_(dash) {
  var zona = dash.getRange(DG_INI, 1, DG_FIN - DG_INI + 1, dash.getMaxColumns());
  zona.getMergedRanges().forEach(function (r) {
    try { r.breakApart(); } catch (e) {}
  });
}
/* ===== Limpieza única: borra cualquier resto de versiones viejas del
   DASHBOARD que haya quedado MÁS ABAJO de donde trabaja el código
   actual (filas 24-90). Correr UNA sola vez. ===== */
function limpiarFilasViejasDashboardCSP() {
  var id = fileIdDeCaja_(DG_CAJA);
  if (!id) return DG_CAJA + ': sin archivo registrado';
  var dash = SpreadsheetApp.openById(id).getSheetByName('DASHBOARD');
  if (!dash) return 'No hay pestaña DASHBOARD.';
  var maxF = dash.getMaxRows();
  var desde = DG_FIN + 1;   // 91 — de aquí para abajo debe estar vacío siempre
  if (maxF >= desde) {
    dash.getRange(desde, 1, maxF - desde + 1, dash.getMaxColumns()).clear();
  }
  return 'DASHBOARD limpio de la fila ' + desde + ' hacia abajo (' + maxF + ' filas totales).';
}