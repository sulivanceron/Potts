/**********************************************************************
 * Fechas.gs — Rellena "Fecha solicitud" cuando quedó vacía.
 *
 * De dónde saca la fecha, en este orden:
 *   1) Fecha de Autorizacion
 *   2) Fecha de Comprobacion
 *   3) Si no hay ninguna, te la reporta para ponerla a mano.
 *
 * CORRER:
 *   1) verFechasVacias()        -> NO cambia nada, solo te dice
 *   2) rellenarFechasVacias()   -> las llena
 **********************************************************************/

var FECHA_COL_FOLIO = 'Folio';
var FECHA_COL_SOL   = 'Fecha solicitud';
var FECHA_COL_AUT   = 'Fecha de Autorizacion';
var FECHA_COL_COMP  = 'Fecha de Comprobacion';


function verFechasVacias() {
  var d = fechasLeer_();
  var conAut = [], conComp = [], sinNada = [];

  d.filas.forEach(function (f) {
    if (f.tieneSol) return;
    if (f.aut)       conAut.push(f);
    else if (f.comp) conComp.push(f);
    else             sinNada.push(f);
  });

  var txt = 'FILAS SIN "Fecha solicitud": ' +
            (conAut.length + conComp.length + sinNada.length) + '\n';
  txt += '============================================================\n\n';

  txt += 'SE LLENAN CON LA FECHA DE AUTORIZACION:  (' + conAut.length + ')\n';
  conAut.forEach(function (f) {
    txt += '  fila ' + f.fila + '   ' + f.folio + '   -> ' + fechasTxt_(f.aut) + '\n';
  });

  txt += '\nSE LLENAN CON LA FECHA DE COMPROBACION:  (' + conComp.length + ')\n';
  conComp.forEach(function (f) {
    txt += '  fila ' + f.fila + '   ' + f.folio + '   -> ' + fechasTxt_(f.comp) + '\n';
  });

  txt += '\nHAY QUE PONERLAS A MANO (sin ninguna fecha):  (' + sinNada.length + ')\n';
  sinNada.forEach(function (f) {
    txt += '  fila ' + f.fila + '   ' + f.folio + '\n';
  });

  Logger.log(txt);
  return txt;
}


function rellenarFechasVacias() {
  var d = fechasLeer_();
  var sh = d.hoja;
  var colSol = d.colSol;

  var llenadas = [], pendientes = [];

  d.filas.forEach(function (f) {
    if (f.tieneSol) return;
    var v = f.aut || f.comp;
    if (!v) { pendientes.push('fila ' + f.fila + '   ' + f.folio); return; }
    sh.getRange(f.fila, colSol).setValue(fechasSoloDia_(v));
    llenadas.push('fila ' + f.fila + '   ' + f.folio + '   -> ' + fechasTxt_(v));
  });

  var msg = 'FECHAS LLENADAS: ' + llenadas.length + '\n' + llenadas.join('\n') +
            '\n\nQUEDAN A MANO: ' + pendientes.length + '\n' + pendientes.join('\n');

  if (llenadas.length) {
    msg += '\n\nAHORA CORRE:  sincronizarTodo()  para que bajen a EGRESOS.';
  }

  Logger.log(msg);
  return msg;
}


/* ============ Utilerias ============ */
function fechasLeer_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  if (!sh) throw new Error('No se encontro la hoja "Concentrado".');

  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  for (var c = 0; c < enc.length; c++) {
    var k = String(enc[c]).trim();
    if (k !== '') map[k] = c + 1;
  }

  var colFolio = map[FECHA_COL_FOLIO];
  var colSol   = map[FECHA_COL_SOL];
  var colAut   = map[FECHA_COL_AUT] || null;
  var colComp  = map[FECHA_COL_COMP] || null;

  if (!colFolio) throw new Error('No se encontro la columna "' + FECHA_COL_FOLIO + '".');
  if (!colSol)   throw new Error('No se encontro la columna "' + FECHA_COL_SOL + '".');

  var datos = sh.getDataRange().getValues();
  var filas = [];
  for (var r = 1; r < datos.length; r++) {
    var folio = String(datos[r][colFolio - 1] || '').trim();
    if (!folio) continue;

    var vSol  = datos[r][colSol - 1];
    var vAut  = colAut  ? datos[r][colAut - 1]  : '';
    var vComp = colComp ? datos[r][colComp - 1] : '';

    filas.push({
      fila: r + 1,
      folio: folio,
      tieneSol: fechasEsFecha_(vSol),
      aut:  fechasEsFecha_(vAut)  ? fechasADate_(vAut)  : null,
      comp: fechasEsFecha_(vComp) ? fechasADate_(vComp) : null
    });
  }

  return { hoja: sh, mapa: map, colSol: colSol, filas: filas };
}

function fechasEsFecha_(v) {
  if (v instanceof Date) return !isNaN(v.getTime());
  if (v === '' || v == null) return false;
  var d = new Date(v);
  return !isNaN(d.getTime());
}

function fechasADate_(v) {
  return (v instanceof Date) ? v : new Date(v);
}

function fechasSoloDia_(v) {
  var d = fechasADate_(v);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fechasTxt_(v) {
  var d = fechasADate_(v);
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Mexico_City';
  return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
}