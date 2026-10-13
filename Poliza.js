/* ==========================================================================
   POLIZA.GS — Póliza diaria de gastos (CEDIS SAN PABLO) para ERP contable
   --------------------------------------------------------------------------
   Columnas: FECHA | PÓLIZA | CUENTA | CONCEPTO | DETALLADO | CARGO | ABONO
   - DETALLADO sale de la pestaña "Concentrado" (columna A=Folio,
     columna H="Descripción Subconcepto"), cruzando por el FOLIO del
     egreso. Si el folio no se encuentra ahí, usa el concepto general
     como respaldo (nunca queda vacío).
   - POLIZA_FOLIOS (pestaña oculta, NO tocar a mano): amarra cada día con
     los folios originales que lo integran. La usa PolizaPDF.gs para
     encontrar los comprobantes digitales de cada gasto.
   ========================================================================== */

var PZ_CAJA = 'CEDIS SAN PABLO';
var PZ_CUENTA_EFECTIVO = '570.01';     // <-- REEMPLAZA por tu cuenta contable real de efectivo/caja (ContaSOL)
var PZ_FOLIO_PREFIJO = 'PE-CSP-';
var PZ_FILAS = 3000;
var PZ_MARCA = 'PZ_FORMATO_V2';
var PZ_CUENTA_ANTICIPO_PROVEEDOR = '100-3';
var PZ_HOJA_CATALOGO = 'Catalogos';
var PZ_COL_SUCURSAL_GASTO = 'SUCURSAL DEL GASTO';
var PZ_HOJA_CONCENTRADO = 'Concentrado';

function _pzLeerDescripcionesConcentrado_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(PZ_HOJA_CONCENTRADO);
  if (!hoja) return {};
  var last = hoja.getLastRow();
  if (last < 2) return {};
  var datos = hoja.getRange(2, 1, last - 1, 8).getValues(); // A:H
  var mapa = {};
  datos.forEach(function (f) {
    var folio = String(f[0] || '').trim();
    var desc = String(f[7] || '').trim(); // columna H = "Descripción Subconcepto"
    if (folio && desc) mapa[folio] = desc;
  });
  return mapa;
}

function generarPolizaDiariaCSP() {
  var cc = SpreadsheetApp.getActiveSpreadsheet();

  var id = fileIdDeCaja_(PZ_CAJA);
  if (!id) return PZ_CAJA + ': sin archivo registrado';

  var ext = SpreadsheetApp.openById(id);
  var eg = ext.getSheetByName('EGRESOS');
  if (!eg) return 'No hay pestaña EGRESOS en el archivo de ' + PZ_CAJA + '.';

  var tz = ext.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var colFolio = me[SYNC.EG_FOLIO];
  var colFecha = me[SYNC.EG_FECHA];
  var colCuenta = me[SYNC.EG_CUENTA];
  var colConcepto = me[SYNC.EG_CONCEPTO];
  var colMonto = me[SYNC.EG_MONTO];
  var colSucGasto = me[PZ_COL_SUCURSAL_GASTO];

  if (!colFecha || !colCuenta || !colConcepto || !colMonto) {
    return 'Faltan columnas FECHA/CUENTA/CONCEPTO/MONTO en EGRESOS.';
  }

  var mapaCatalogo = {};
  var catSheet = cc.getSheetByName(PZ_HOJA_CATALOGO);
  if (catSheet) {
    var lastCat = catSheet.getLastRow();
    if (lastCat >= 1) {
      var datosCat = catSheet.getRange(1, 1, lastCat, 3).getValues();
      var inicioCat = (datosCat.length && String(datosCat[0][0]).trim().toUpperCase() === 'SUCURSAL') ? 1 : 0;
      for (var ci = inicioCat; ci < datosCat.length; ci++) {
        var sucCat = String(datosCat[ci][0] || '').trim().toUpperCase();
        var conCat = String(datosCat[ci][1] || '').trim().toUpperCase();
        var cueCat = datosCat[ci][2];
        if (!sucCat || !conCat) continue;
        mapaCatalogo[sucCat + '|' + conCat] = cueCat;
      }
    }
  }

  var bloquesProrrateo = _pzLeerBloquesProrrateo_();
  var mapaDescripciones = _pzLeerDescripcionesConcentrado_();

  var mapaManual = {};
  var filasManualPreservadas = [];
  var logPro = cc.getSheetByName('PRORRATEOS');
  if (logPro) {
    var lastPro = logPro.getLastRow();
    if (lastPro >= 2) {
      var datosPro = logPro.getRange(2, 1, lastPro - 1, 7).getValues();
      datosPro.forEach(function (f) {
        var folio = String(f[0] || '').trim();
        var origen = String(f[6] || '').trim().toUpperCase();
        if (!folio) return;
        if (origen === 'MANUAL') {
          filasManualPreservadas.push(f);
          if (!mapaManual[folio]) mapaManual[folio] = [];
          mapaManual[folio].push({
            sucursal: String(f[3] || '').trim(),
            cuenta: f[4],
            concepto: String(f[2] || '').trim(),
            importe: Number(f[5]) || 0
          });
        }
      });
    }
  }

  var porDia = {};
  var folioPorDia = {};
  var excluidosAnticipo = 0;
  var sinCatalogo = 0;
  var autoProrrateados = 0;
  var filasAutoTotal = [];
  var last = eg.getLastRow();
  if (last > SYNC.EG_HEADER_ROW) {
    var datos = eg.getRange(SYNC.EG_HEADER_ROW + 1, 1, last - SYNC.EG_HEADER_ROW, eg.getLastColumn()).getValues();
    datos.forEach(function (fila) {
      var monto = Number(fila[colMonto - 1]) || 0;
      if (!monto) return;

      var fecha = fila[colFecha - 1];
      if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return;
      if (antesDeOperacion_(fecha)) return;

      var conceptoTxt = String(fila[colConcepto - 1] || '').trim();
      var cuentaRaw = String(fila[colCuenta - 1] || '').replace(/\.0$/, '').trim();

      if (conceptoTxt.toUpperCase() === 'ANTICIPO A PROVEEDOR' || cuentaRaw === PZ_CUENTA_ANTICIPO_PROVEEDOR) {
        excluidosAnticipo++;
        return;
      }

      var k = Utilities.formatDate(fecha, tz, 'yyyy-MM-dd');
      if (!porDia[k]) porDia[k] = { fecha: fecha, lineas: [] };

      var folio = colFolio ? String(fila[colFolio - 1] || '').trim() : '';

      if (folio) {
        if (!folioPorDia[k]) folioPorDia[k] = {};
        folioPorDia[k][folio] = true;
      }

      var detalladoTxt = (folio && mapaDescripciones[folio]) ? mapaDescripciones[folio] : conceptoTxt;
      var manual = folio ? mapaManual[folio] : null;

      // 1) Reparto manual forzado
      if (manual && manual.length) {
        manual.forEach(function (p) {
          porDia[k].lineas.push({
            cuenta: p.cuenta,
            concepto: p.concepto + ' - ' + p.sucursal,
            detallado: detalladoTxt,
            monto: p.importe
          });
        });
        return;
      }

      var sucGasto = colSucGasto ? String(fila[colSucGasto - 1] || '').trim() : '';
      var bloque = bloquesProrrateo[conceptoTxt.toUpperCase()];

      if (bloque && bloque.length) {
        if (!sucGasto) {
          // 2) Sin sucursal -> se reparte automático entre las del bloque
          var restante = monto;
          var lineasAuto = [];
          for (var pi = 0; pi < bloque.length; pi++) {
            var esUltima = (pi === bloque.length - 1);
            var imp = esUltima ? restante : Math.floor(monto * bloque[pi].pct);
            restante -= imp;
            lineasAuto.push({ sucursal: bloque[pi].sucursal, cuenta: bloque[pi].cuenta, importe: imp });
          }
          lineasAuto.forEach(function (l) {
            porDia[k].lineas.push({ cuenta: l.cuenta, concepto: conceptoTxt + ' - ' + l.sucursal, detallado: detalladoTxt, monto: l.importe });
          });
          autoProrrateados++;

          if (folio) {
            lineasAuto.forEach(function (l) {
              filasAutoTotal.push([folio, fecha, conceptoTxt, l.sucursal, l.cuenta, l.importe, 'AUTO']);
            });
          }
          return;
        } else {
          // 3) Trae sucursal real -> una sola línea, cuenta de ESA sucursal dentro del mismo bloque
          var entrada = null;
          for (var bi = 0; bi < bloque.length; bi++) {
            if (bloque[bi].sucursal.toUpperCase() === sucGasto.toUpperCase()) { entrada = bloque[bi]; break; }
          }
          var cuentaDirecta;
          if (entrada) {
            cuentaDirecta = entrada.cuenta;
          } else {
            var claveDir = sucGasto.toUpperCase() + '|' + conceptoTxt.toUpperCase();
            var cuentaCatDir = mapaCatalogo[claveDir];
            if (cuentaCatDir !== undefined && cuentaCatDir !== '') {
              cuentaDirecta = String(cuentaCatDir).replace(/\.0$/, '').trim();
            } else {
              sinCatalogo++;
              cuentaDirecta = cuentaRaw;
            }
          }
          porDia[k].lineas.push({ cuenta: cuentaDirecta, concepto: conceptoTxt, detallado: detalladoTxt, monto: monto });
          return;
        }
      }

      // 4) Concepto SIN bloque (ej. NOMINA): vía Catalogos, o cruda
      var cuentaFinal = cuentaRaw;
      if (sucGasto) {
        var clave = sucGasto.toUpperCase() + '|' + conceptoTxt.toUpperCase();
        var cuentaCat = mapaCatalogo[clave];
        if (cuentaCat !== undefined && cuentaCat !== '') {
          cuentaFinal = String(cuentaCat).replace(/\.0$/, '').trim();
        } else {
          sinCatalogo++;
        }
      }

      porDia[k].lineas.push({
        cuenta: cuentaFinal,
        concepto: conceptoTxt,
        detallado: detalladoTxt,
        monto: monto
      });
    });
  }

  // --- Bitácora interna (oculta): folios originales que integran cada día.
  // La usa PolizaPDF.gs para encontrar el comprobante de cada gasto. No es
  // una pestaña para uso manual — no la edites a mano.
  var hojaFoliosDia = cc.getSheetByName('POLIZA_FOLIOS') || cc.insertSheet('POLIZA_FOLIOS');
  hojaFoliosDia.clear();
  hojaFoliosDia.getRange(1, 1, 1, 2).setValues([['FECHA', 'FOLIO']]).setFontWeight('bold');
  var filasFoliosDia = [];
  Object.keys(folioPorDia).sort().forEach(function (k) {
    var fechaDia = porDia[k].fecha;
    Object.keys(folioPorDia[k]).forEach(function (folioTxt) {
      filasFoliosDia.push([fechaDia, folioTxt]);
    });
  });
  if (filasFoliosDia.length) {
    hojaFoliosDia.getRange(2, 1, filasFoliosDia.length, 2).setValues(filasFoliosDia);
    hojaFoliosDia.getRange(2, 1, filasFoliosDia.length, 1).setNumberFormat('dd/mm/yyyy');
  }
  try { hojaFoliosDia.hideSheet(); } catch (e) { /* ya estaba oculta */ }

  var logFinal = _prLogProrrateos_(cc);
  var lastLogFinal = logFinal.getLastRow();
  if (lastLogFinal > 1) {
    logFinal.getRange(2, 1, lastLogFinal - 1, 7).clearContent();
  }
  var filasLog = filasManualPreservadas.concat(filasAutoTotal);
  if (filasLog.length) {
    logFinal.getRange(2, 1, filasLog.length, 7).setValues(filasLog);
    _prFormatearLog_(logFinal);
  }

  var dias = Object.keys(porDia).sort();

  var poliza = cc.getSheetByName('POLIZA');
  var esNueva = false;
  if (!poliza) { poliza = cc.insertSheet('POLIZA'); esNueva = true; }

  var props = PropertiesService.getScriptProperties();
  if (esNueva || props.getProperty(PZ_MARCA) !== 'ok') {
    pzFormatear_(poliza);
    props.setProperty(PZ_MARCA, 'ok');
  }

  var M = [];
  for (var i = 0; i < PZ_FILAS; i++) M.push(['', '', '', '', '', '', '']);

  var r = 0, truncado = false;
  dias.forEach(function (k) {
    var d = porDia[k];
    var folio = PZ_FOLIO_PREFIJO + Utilities.formatDate(d.fecha, tz, 'yyyyMMdd');
    var total = 0;

    d.lineas.forEach(function (linea) {
      if (r >= PZ_FILAS) { truncado = true; return; }
      M[r] = [d.fecha, folio, linea.cuenta, linea.concepto, linea.detallado, linea.monto, ''];
      total += linea.monto;
      r++;
    });

    if (r < PZ_FILAS) {
      M[r] = [d.fecha, folio, PZ_CUENTA_EFECTIVO, 'Salida de efectivo del día', '', '', total];
      r++;
    } else {
      truncado = true;
    }
  });

  poliza.getRange(2, 1, PZ_FILAS, 7).setValues(M);
  if (r > 0) {
    poliza.getRange(2, 1, r, 1).setNumberFormat('dd/mm/yyyy');
    poliza.getRange(2, 6, r, 2).setNumberFormat('$#,##0.00');
  }

  var msg = 'POLIZA actualizada para ' + PZ_CAJA + ': ' + dias.length + ' días, ' + r + ' renglones.' +
            (autoProrrateados ? ' · ' + autoProrrateados + ' gasto(s) centralizado(s) prorrateado(s) automáticamente' : '') +
            (excluidosAnticipo ? ' · ' + excluidosAnticipo + ' anticipo(s) a proveedor excluido(s)' : '') +
            (sinCatalogo ? ' · *** ' + sinCatalogo + ' renglón(es) sin cuenta en Catalogos — revísalos ***' : '') +
            (truncado ? ' *** SE LLENÓ LA CAPACIDAD (' + PZ_FILAS + ' renglones) — avísame para ampliarla ***' : '');
  Logger.log(msg);
  return msg;
}

function pzFormatear_(poliza) {
  poliza.clear();
  poliza.getRange(1, 1, 1, 7)
    .setValues([['FECHA', 'PÓLIZA', 'CUENTA', 'CONCEPTO', 'DETALLADO', 'CARGO', 'ABONO']])
    .setFontWeight('bold')
    .setBackground('#0b3d66')
    .setFontColor('#ffffff');
  poliza.setFrozenRows(1);
  poliza.setColumnWidth(1, 100);
  poliza.setColumnWidth(2, 130);
  poliza.setColumnWidth(3, 100);
  poliza.setColumnWidth(4, 220);
  poliza.setColumnWidth(5, 260);
  poliza.setColumnWidth(6, 110);
  poliza.setColumnWidth(7, 110);
}

function formatearPolizaCSP() {
  PropertiesService.getScriptProperties().deleteProperty(PZ_MARCA);
  return generarPolizaDiariaCSP();
}