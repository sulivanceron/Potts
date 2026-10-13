/**********************************************************************
 * Diagnostico.gs — SOLO LEE. No escribe ni cambia nada, nunca.
 *
 * Te dice, columna por columna:
 *   - cuántas celdas tienen fecha buena
 *   - cuántas están vacías
 *   - cuántas todavía tienen FORMULA (y a dónde apunta)
 *   - cuántas tienen texto que no es fecha
 *
 * CORRER:  radiografiaFechas()
 **********************************************************************/

var DIAG_COLS = [
  'Fecha solicitud',
  'Fecha de Autorizacion',
  'Fecha de Comprobacion',
  'Entrega Efectivo'
];


function radiografiaFechas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  if (!sh) throw new Error('No se encontro la hoja "Concentrado".');

  var ultimaF = sh.getLastRow();
  var ultimaC = sh.getLastColumn();

  var enc = sh.getRange(1, 1, 1, ultimaC).getValues()[0];
  var map = {};
  for (var c = 0; c < enc.length; c++) {
    var k = String(enc[c]).trim();
    if (k !== '') map[k] = c + 1;
  }

  var colFolio = map['Folio'];
  if (!colFolio) throw new Error('No se encontro la columna "Folio".');

  var folios = sh.getRange(2, colFolio, ultimaF - 1, 1).getValues();
  var conFolio = [];
  for (var i = 0; i < folios.length; i++) {
    var f = String(folios[i][0] || '').trim();
    if (f) conFolio.push({ fila: i + 2, folio: f });
  }

  var txt = 'RADIOGRAFIA DE FECHAS — hoja Concentrado\n';
  txt += 'Filas con folio: ' + conFolio.length + '   (hasta la fila ' + ultimaF + ')\n';
  txt += '============================================================\n\n';

  DIAG_COLS.forEach(function (nombre) {
    var col = map[nombre];
    if (!col) {
      txt += '### ' + nombre + '\n    NO EXISTE esta columna con ese nombre exacto.\n\n';
      return;
    }

    var letra = diagLetra_(col);
    var vals = sh.getRange(2, col, ultimaF - 1, 1).getValues();
    var forms = sh.getRange(2, col, ultimaF - 1, 1).getFormulas();

    var okFecha = 0, vacias = 0, conFormula = 0, textoRaro = 0;
    var vaciasFilas = [], formulaFilas = [], rarasFilas = [];
    var muestraFormula = '';

    conFolio.forEach(function (r) {
      var idx = r.fila - 2;
      var v = vals[idx][0];
      var fo = String(forms[idx][0] || '');

      if (fo) {
        conFormula++;
        if (!muestraFormula) muestraFormula = fo;
        if (formulaFilas.length < 15) formulaFilas.push(r.fila + ' (' + r.folio + ')');
      }

      if (v instanceof Date && !isNaN(v.getTime())) { okFecha++; return; }
      if (v === '' || v == null) {
        vacias++;
        if (vaciasFilas.length < 25) vaciasFilas.push(r.fila + ' (' + r.folio + ')');
        return;
      }
      // Hay algo, pero no es un objeto Fecha
      textoRaro++;
      if (rarasFilas.length < 10) rarasFilas.push(r.fila + ' (' + r.folio + ') = "' + String(v) + '"');
    });

    txt += '### ' + nombre + '   (columna ' + letra + ')\n';
    txt += '    Fecha buena .......... ' + okFecha + '\n';
    txt += '    VACIAS ............... ' + vacias + '\n';
    txt += '    Texto (no es fecha) .. ' + textoRaro + '\n';
    txt += '    CON FORMULA .......... ' + conFormula + '\n';
    if (muestraFormula) txt += '      ejemplo de formula: ' + muestraFormula + '\n';
    if (formulaFilas.length) txt += '      filas con formula: ' + formulaFilas.join(', ') + '\n';
    if (vaciasFilas.length)  txt += '      filas vacias: ' + vaciasFilas.join(', ') + '\n';
    if (rarasFilas.length)   txt += '      ejemplos de texto: ' + rarasFilas.join(' | ') + '\n';
    txt += '\n';
  });

  /* ---- Barrido general: ¿qué otras columnas siguen jalando del Form viejo? ---- */
  txt += '============================================================\n';
  txt += 'OTRAS COLUMNAS QUE TODAVIA JALAN DEL FORMULARIO VIEJO\n';
  txt += '============================================================\n';

  var hubo = false;
  for (var c2 = 1; c2 <= ultimaC; c2++) {
    var nombreCol = String(enc[c2 - 1] || '').trim() || '(sin encabezado)';
    var fs = sh.getRange(2, c2, ultimaF - 1, 1).getFormulas();
    var n = 0, ej = '';
    for (var k2 = 0; k2 < fs.length; k2++) {
      var s = String(fs[k2][0] || '');
      if (s && s.indexOf('Respuestas de formulario') !== -1) { n++; if (!ej) ej = s; }
    }
    if (n > 0) {
      hubo = true;
      txt += '  ' + diagLetra_(c2) + '  ' + nombreCol + '  ->  ' + n + ' celdas\n';
      txt += '      ejemplo: ' + ej + '\n';
    }
  }
  if (!hubo) txt += '  Ninguna. Ya no queda nada apuntando al formulario viejo.\n';

  Logger.log(txt);
  return txt;
}


function diagLetra_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}