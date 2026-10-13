/* ==========================================================================
   PRORRATEO.GS — Bloques de prorrateo por concepto + herramientas manuales
   ========================================================================== */

function _pzLeerBloquesProrrateo_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pro = ss.getSheetByName('Prorrateo');
  if (!pro) return {};

  var lastRow = pro.getLastRow();
  if (lastRow < 2) return {};
  var datos = pro.getRange(1, 1, lastRow, 4).getValues(); // A:D

  var bloques = {};
  var i = 0;
  while (i < datos.length) {
    var colB = String(datos[i][1] || '').trim().toUpperCase();
    if (colB === 'SUCURSAL') {
      var j = i + 1;
      var lineas = [];
      var conceptoBloque = '';
      while (j < datos.length) {
        var sucursal = String(datos[j][1] || '').trim();
        var etiqueta = sucursal.toUpperCase();
        if (!sucursal || etiqueta === 'TOTAL') break;
        var cuenta = datos[j][0];
        var concepto = String(datos[j][2] || '').trim();
        var pct = Number(datos[j][3]) || 0;
        if (!conceptoBloque && concepto) conceptoBloque = concepto;
        lineas.push({ sucursal: sucursal, cuenta: cuenta, pct: pct });
        j++;
      }
      if (conceptoBloque && lineas.length) {
        bloques[conceptoBloque.toUpperCase()] = lineas;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return bloques;
}

function registrarProrrateosPorLote() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pro = ss.getSheetByName('Prorrateo');
  if (!pro) return 'No encontré la pestaña "Prorrateo".';

  var bloques = _pzLeerBloquesProrrateo_();
  if (!Object.keys(bloques).length) return 'No encontré ningún bloque de prorrateo en la pestaña Prorrateo (busco filas con "Sucursal" en la columna B).';

  var ultimaFila = pro.getLastRow();
  var lista = [];
  if (ultimaFila >= 8) {
    lista = pro.getRange(8, 8, ultimaFila - 7, 3).getValues();
  }
  if (!lista.length) return 'No hay gastos en la lista (columnas H:J, a partir de la fila 8).';

  var log = _prLogProrrateos_(ss);
  var ahora = new Date();
  var procesados = 0;
  var sinBloque = [];

  lista.forEach(function (f) {
    var folio = String(f[0] || '').trim();
    var concepto = String(f[1] || '').trim();
    var monto = Number(f[2]) || 0;
    if (!folio || !concepto || !monto) return;

    var bloque = bloques[concepto.toUpperCase()];
    if (!bloque || !bloque.length) {
      sinBloque.push(folio + ' / ' + concepto);
      return;
    }

    var restante = monto;
    var lineas = [];
    for (var i = 0; i < bloque.length; i++) {
      var esUltima = (i === bloque.length - 1);
      var importe = esUltima ? restante : Math.floor(monto * bloque[i].pct);
      restante -= importe;
      lineas.push({ sucursal: bloque[i].sucursal, cuenta: bloque[i].cuenta, importe: importe });
    }

    _prBorrarFolio_(log, folio);
    var filas = lineas.map(function (l) {
      return [folio, ahora, concepto, l.sucursal, l.cuenta, l.importe, 'MANUAL'];
    });
    log.getRange(log.getLastRow() + 1, 1, filas.length, 7).setValues(filas);
    procesados++;
  });

  _prFormatearLog_(log);

  var msg = procesados + ' gasto(s) de la lista registrado(s) como reparto MANUAL.';
  if (!procesados && !sinBloque.length) msg = 'No procesé ningún renglón — revisa que H:J tengan Folio, Concepto y Monto en cada renglón.';
  if (sinBloque.length) {
    msg += ' *** OJO: ' + sinBloque.length + ' renglón(es) con un Concepto que no tiene bloque en Prorrateo: ' +
           sinBloque.slice(0, 5).join(' · ') + (sinBloque.length > 5 ? '…' : '') + ' ***';
  }
  return msg;
}

function _prLogProrrateos_(ss) {
  var log = ss.getSheetByName('PRORRATEOS');
  if (!log) {
    log = ss.insertSheet('PRORRATEOS');
    log.getRange(1, 1, 1, 7)
      .setValues([['FOLIO', 'FECHA REGISTRO', 'CONCEPTO', 'SUCURSAL', 'CUENTA CONTASOL', 'IMPORTE', 'ORIGEN']])
      .setFontWeight('bold').setBackground('#0b3d66').setFontColor('#ffffff');
    log.setFrozenRows(1);
  }
  return log;
}

function _prBorrarFolio_(log, folio) {
  var last = log.getLastRow();
  if (last < 2) return;
  var folios = log.getRange(2, 1, last - 1, 1).getValues();
  for (var i = folios.length - 1; i >= 0; i--) {
    if (String(folios[i][0]).trim() === folio) log.deleteRow(i + 2);
  }
}

function _prFormatearLog_(log) {
  if (log.getLastRow() < 2) return;
  log.getRange(2, 6, log.getLastRow() - 1, 1).setNumberFormat('$#,##0.00');
  log.getRange(2, 2, log.getLastRow() - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm');
}