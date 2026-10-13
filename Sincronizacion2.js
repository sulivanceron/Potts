/**********************************************************************
 * SISTEMA DE CONTROL DE CAJA CHICA — GRUPO VIZCARRA
 * Sincronizacion2.gs  ·  PARTE 2 de 2
 * (la PARTE 1 vive en el archivo Sincronizacion.gs)
 *
 * Aquí viven: correos de rescate, reparaciones, RESUMEN DIARIO,
 * catálogos de INGRESOS y los desgloses del DASHBOARD.
 **********************************************************************/


/* ===== Reenvía el correo de autorización (con botones) de un folio ===== */
function reenviarAutorizacion() {
  var FOLIO = 'CC-PUE-2026-000001';   // <-- PON AQUÍ EL FOLIO EXACTO
  var APP = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  var map = mapaColumnas_(sh);
  var v = sh.getDataRange().getValues();
  var fi = -1;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][map['Folio']] || '').trim() === FOLIO) { fi = i; break; }
  }
  if (fi === -1) throw new Error('No se encontró el folio ' + FOLIO);
  var f = v[fi];

  var sucursal = String(f[map['Sucursal']] || '');
  var colaborador = String(f[map['Colaborador']] || '');
  var area = String(f[map['Comando gasto']] || '');
  var tipo = String(f[map['Tipo de Gasto']] || '');
  var concepto = String(f[map['Descripcion Subconcepto']] || '');
  var importe = Number(f[map['Importe']] || 0);
  var importeFmt = importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  var cat = ss.getSheetByName('Catálogos') || ss.getSheetByName('Catalogos');
  var reg = buscarEnCatalogo_(cat, sucursal, tipo);
  if (!reg || !reg.correo) throw new Error('No hay correo de autorizador para ' + sucursal);

  var urlAut = APP + '?accion=autorizar&folio=' + encodeURIComponent(FOLIO);
  var urlRec = APP + '?accion=rechazar&folio=' + encodeURIComponent(FOLIO);

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
      '<div style="background:#0b3d66;color:#fff;padding:18px 22px;">' +
        '<h2 style="margin:0;">Solicitud de Caja Chica</h2>' +
        '<p style="margin:6px 0 0;">Pendiente de autorización</p></div>' +
      '<div style="padding:22px;border:1px solid #d9d9d9;">' +
        '<p>Hola <strong>' + escaparHtml(reg.autorizador) + '</strong>,</p>' +
        '<p>Se recibió una solicitud de pago de Caja Chica.</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
          crearFilaCorreo('Folio', FOLIO) + crearFilaCorreo('Sucursal', sucursal) +
          crearFilaCorreo('Área solicitante', area) + crearFilaCorreo('Colaborador', colaborador) +
          crearFilaCorreo('Tipo de gasto', tipo) + crearFilaCorreo('Concepto', concepto) +
          crearFilaCorreo('Importe solicitado', importeFmt) +
        '</table>' +
        '<p style="margin-top:26px;font-weight:bold;color:#0b3d66;">¿Autorizas esta solicitud?</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="padding-right:12px;"><a href="' + urlAut + '" style="background:#1f7a3e;color:#fff;text-decoration:none;padding:14px 26px;border-radius:6px;display:inline-block;font-weight:bold;">Autorizar</a></td>' +
          '<td><a href="' + urlRec + '" style="background:#b3261e;color:#fff;text-decoration:none;padding:14px 26px;border-radius:6px;display:inline-block;font-weight:bold;">Rechazar</a></td>' +
        '</tr></table>' +
      '</div></div>';

  var op = { to: reg.correo, subject: 'Solicitud de Caja Chica pendiente de autorización | ' + FOLIO,
             htmlBody: html, body: 'Solicitud ' + FOLIO + ' pendiente de autorización.', name: 'Sistema de Caja Chica Vizcarra' };
  if (reg.copias) op.cc = reg.copias;
  MailApp.sendEmail(op);
  return 'Correo con botones reenviado a ' + reg.correo;
}


/* ===== Avisa a Omar (Tesorería) las autorizadas desde la fila 18 =====
   MANUAL: solo manda correo si tú la corres a mano. ===== */
function avisarOmarPendientes() {
  var FILA_INICIO = 18;
  var OMAR = 'tesomargv@gmail.com';
  var APP = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  var map = mapaColumnas_(sh);
  var v = sh.getDataRange().getValues();
  var colEst = map[CFG.COL_ESTATUS_AUTORIZACION];
  var enviados = [];

  for (var i = FILA_INICIO - 1; i < v.length; i++) {
    var f = v[i];
    var folio = String(f[map['Folio']] || '').trim();
    if (!folio) continue;
    if (normaliza_(String(f[colEst] || '')) !== normaliza_('Autorizado')) continue;

    var sucursal = String(f[map['Sucursal']] || '');
    var colaborador = String(f[map['Colaborador']] || '');
    var tipo = String(f[map['Tipo de Gasto']] || '');
    var concepto = String(f[map['Descripcion Subconcepto']] || '');
    var importe = Number(f[map['Importe']] || 0);
    var importeFmt = importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    var urlEnt = APP + '?accion=entregar&folio=' + encodeURIComponent(folio);

    var html =
      '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
        '<div style="background:#1f7a3e;color:#fff;padding:18px 22px;"><h2 style="margin:0;">Efectivo autorizado</h2>' +
          '<p style="margin:6px 0 0;">Listo para entregar · ' + escaparHtml(folio) + '</p></div>' +
        '<div style="padding:22px;border:1px solid #d9d9d9;">' +
          '<p>Hola <strong>Omar Monroy</strong>,</p>' +
          '<p>Esta solicitud ya fue <strong>AUTORIZADA</strong> y está lista para que entregues el efectivo.</p>' +
          '<table style="width:100%;border-collapse:collapse;">' +
            crearFilaCorreo('Folio', folio) + crearFilaCorreo('Sucursal', sucursal) +
            crearFilaCorreo('Colaborador', colaborador) + crearFilaCorreo('Tipo de gasto', tipo) +
            crearFilaCorreo('Concepto', concepto) + crearFilaCorreo('Importe a entregar', importeFmt) +
          '</table>' +
          '<p style="margin-top:26px;">' +
            '<a href="' + urlEnt + '" style="background:#1f7a3e;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;display:inline-block;font-weight:bold;font-size:15px;">Entregar efectivo</a>' +
          '</p>' +
        '</div></div>';

    MailApp.sendEmail({ to: OMAR, subject: 'Efectivo autorizado — listo para entregar | ' + folio,
      htmlBody: html, body: 'Solicitud ' + folio + ' autorizada, lista para entregar el efectivo.', name: 'Sistema de Caja Chica Vizcarra' });
    enviados.push(folio);
  }
  Logger.log('Avisos a Omar: ' + enviados.length + ' [' + enviados.join(', ') + ']');
  return 'Avisos a Omar: ' + enviados.length;
}


/* ===== Avisa a Omar las AUTORIZADAS desde la fila 18 en adelante ===== */
function avisarOmarRH() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  var map = mapaColumnas_(sh);
  var v = sh.getDataRange().getValues();
  var colEst = map[CFG.COL_ESTATUS_AUTORIZACION];
  var enviados = [];
  for (var i = 17; i < v.length; i++) {
    var f = v[i];
    var folio = String(f[map['Folio']] || '').trim();
    if (!folio) continue;
    if (normaliza_(String(f[colEst] || '')) !== normaliza_('Autorizado')) continue;
    enviarCorreoEntregaOmar_(
      folio, String(f[map['Sucursal']] || ''), String(f[map['Comando gasto']] || ''),
      String(f[map['Colaborador']] || ''), String(f[map['Tipo de Gasto']] || ''),
      String(f[map['Descripcion Subconcepto']] || ''), Number(f[map['Importe']] || 0));
    enviados.push(folio);
  }
  Logger.log('Avisos a Omar: ' + enviados.length + ' [' + enviados.join(', ') + ']');
  return 'Avisos a Omar: ' + enviados.length;
}


/* ===== Repara títulos, quita TERMINAL y agrega MONTO AUTORIZADO/COMPROBADO
   (esto último SOLO en las cajas de PILOTO_ESQUEMA_NUEVO) ===== */
function repararTodo_CedisPiloto() {
  var mapa = mapaCajas_();
  var resultados = [];

  var conc = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  var mc = mapaFila_(conc, 1);
  var datosConc = conc.getDataRange().getValues();
  var porFolio = {};
  for (var r = 1; r < datosConc.length; r++) {
    var folio = String(datosConc[r][mc[SYNC.C_FOLIO] - 1] || '').trim();
    if (!folio) continue;
    var impComp = datosConc[r][mc[SYNC.C_IMPORTE_COMP] - 1];
    var tieneComp = !(impComp === '' || impComp == null);
    porFolio[folio] = {
      autorizado: Number(datosConc[r][mc[SYNC.C_IMPORTE] - 1] || 0),
      comprobado: tieneComp ? Number(impComp) : '',
      tieneComp: tieneComp
    };
  }

  CAJAS.forEach(function (caja) {
    if (normalizarTexto(caja) === normalizarTexto('GUADALAJARA')) {
      resultados.push(caja + ': es la plantilla, sin cambios');
      return;
    }
    var id = mapa[normalizarTexto(caja)];
    if (!id) { resultados.push(caja + ': sin archivo registrado'); return; }

    try {
      var ext = SpreadsheetApp.openById(id);
      var pasos = [];

      var eg = ext.getSheetByName('EGRESOS');
      if (eg) eg.getRange(1, 1).setValue('REGISTRO DE EGRESOS EN EFECTIVO — ' + caja);
      var ing = ext.getSheetByName('INGRESOS');
      if (ing) ing.getRange(1, 1).setValue('REGISTRO DE INGRESOS EN EFECTIVO — ' + caja);
      var cat = ext.getSheetByName('CATALOGO');
      if (cat) cat.getRange(1, 1).setValue('CATÁLOGO DE GASTOS — SUCURSAL ' + caja.toUpperCase());
      var dash = ext.getSheetByName('DASHBOARD');
      if (dash) dash.getRange(1, 1).setValue('DASHBOARD — ' + caja);
      pasos.push('títulos actualizados');

      if (eg) {
        var meEg = mapaFila_(eg, SYNC.EG_HEADER_ROW);
        if (meEg['TERMINAL']) { eg.deleteColumn(meEg['TERMINAL']); pasos.push('EGRESOS sin Terminal'); }
      }
      if (ing) {
        var meIng = mapaFila_(ing, SYNC.EG_HEADER_ROW);
        if (meIng['TERMINAL']) { ing.deleteColumn(meIng['TERMINAL']); pasos.push('INGRESOS sin Terminal'); }
      }

      if (usaEsquemaNuevo_(caja) && eg) {
        var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
        var colMonto = me[SYNC.EG_MONTO];

        if (colMonto && !me[SYNC.EG_MONTO_AUTORIZADO]) {
          eg.insertColumnAfter(colMonto);
          var colAut = colMonto + 1;
          eg.getRange(SYNC.EG_HEADER_ROW, colAut).setValue(SYNC.EG_MONTO_AUTORIZADO);
          eg.getRange(SYNC.EG_HEADER_ROW, colMonto).copyTo(eg.getRange(SYNC.EG_HEADER_ROW, colAut), { formatOnly: true });

          eg.insertColumnAfter(colAut);
          var colComp2 = colAut + 1;
          eg.getRange(SYNC.EG_HEADER_ROW, colComp2).setValue(SYNC.EG_MONTO_COMPROBADO);
          eg.getRange(SYNC.EG_HEADER_ROW, colMonto).copyTo(eg.getRange(SYNC.EG_HEADER_ROW, colComp2), { formatOnly: true });

          var lastR = eg.getLastRow();
          if (lastR > SYNC.EG_HEADER_ROW) {
            eg.getRange(SYNC.EG_HEADER_ROW + 1, colMonto, lastR - SYNC.EG_HEADER_ROW, 1)
              .copyTo(eg.getRange(SYNC.EG_HEADER_ROW + 1, colAut, lastR - SYNC.EG_HEADER_ROW, 1), { formatOnly: true });
            eg.getRange(SYNC.EG_HEADER_ROW + 1, colMonto, lastR - SYNC.EG_HEADER_ROW, 1)
              .copyTo(eg.getRange(SYNC.EG_HEADER_ROW + 1, colComp2, lastR - SYNC.EG_HEADER_ROW, 1), { formatOnly: true });
          }
          pasos.push('columnas MONTO AUTORIZADO y MONTO COMPROBADO agregadas');
        }

        me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
        var folioCol = me[SYNC.EG_FOLIO];
        var mCol = me[SYNC.EG_MONTO];
        var autCol = me[SYNC.EG_MONTO_AUTORIZADO];
        var compCol = me[SYNC.EG_MONTO_COMPROBADO];
        var last = eg.getLastRow();
        var primera = SYNC.EG_HEADER_ROW + 1;
        var corregidos = 0;

        if (last >= primera && folioCol && mCol && autCol && compCol) {
          var folios = eg.getRange(primera, folioCol, last - primera + 1, 1).getValues();
          for (var i = 0; i < folios.length; i++) {
            var fv = String(folios[i][0] || '').trim();
            if (!fv || !porFolio[fv]) continue;
            var filaHoja = primera + i;
            var info = porFolio[fv];
            eg.getRange(filaHoja, autCol).setValue(info.autorizado);
            eg.getRange(filaHoja, compCol).setValue(info.tieneComp ? info.comprobado : '');
            eg.getRange(filaHoja, mCol).setValue(info.tieneComp ? info.comprobado : info.autorizado);
            corregidos++;
          }
        }
        if (corregidos) pasos.push(corregidos + ' filas existentes corregidas');
      }

      resultados.push(caja + ': ' + pasos.join(' · '));
    } catch (e) {
      resultados.push(caja + ': *** ERROR: ' + e.message + ' ***');
    }
  });

  var msg = resultados.join('\n');
  Logger.log(msg);
  return msg;
}


function diagnosticoEncabezadosConcentrado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  var enc = conc.getRange(1, 1, 1, conc.getLastColumn()).getValues()[0];
  var out = [];
  var letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  enc.forEach(function (v, i) {
    var texto = String(v);
    out.push((letras[i] || ('col' + (i + 1))) + ': "' + texto + '" (largo: ' + texto.length + ')');
  });
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

function quitarValidacionSeleccionaEgresos() {
  var caja = 'CEDIS SAN PABLO';
  var id = fileIdDeCaja_(caja);
  if (!id) { Logger.log(caja + ': sin archivo registrado'); return caja + ': sin archivo registrado'; }

  try {
    var ext = SpreadsheetApp.openById(id);
    var eg = ext.getSheetByName('EGRESOS');
    if (!eg) { Logger.log(caja + ': sin pestaña EGRESOS'); return caja + ': sin pestaña EGRESOS'; }
    var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
    var colSelecc = me[SYNC.EG_SELECC];
    if (!colSelecc) { return caja + ': no tiene columna "SELECCIONA EL GASTO"'; }
    var filas = Math.max(eg.getMaxRows() - SYNC.EG_HEADER_ROW, 500);
    eg.getRange(SYNC.EG_HEADER_ROW + 1, colSelecc, filas, 1).clearDataValidations();
    var msg = caja + ': validación quitada en SELECCIONA EL GASTO';
    Logger.log(msg);
    return msg;
  } catch (e) {
    var err = caja + ': *** ERROR: ' + e.message + ' ***';
    Logger.log(err);
    return err;
  }
}


/* ===== RESUMEN DIARIO (CEDIS SAN PABLO) =====
   Tabla diaria  (A-E): FECHA | INGRESOS | EGRESOS | NETO DEL DÍA | NETO ACUMULADO
   Tabla mensual (G-I): MES   | NETO DEL MES       | NETO ACUMULADO

   El TOTAL siempre queda PEGADO justo abajo del último día/mes real,
   igual que antes. Lo que YA NO pasa: ya no se borra la hoja completa
   ni se repintan colores/anchos en cada corrida — eso se hace UNA sola
   vez (encabezados, vía rdFormatear_). En cada corrida normal solo se
   escriben los números y, si se agregó un día/mes nuevo, se mueve el
   resaltado del TOTAL un renglón hacia abajo (un solo renglón, no toda
   la hoja).                                                          ===== */
function generarResumenDiarioCedisSanPablo() {
  var caja = 'CEDIS SAN PABLO';
  var id = fileIdDeCaja_(caja);
  if (!id) return caja + ': sin archivo registrado';

  var ext = SpreadsheetApp.openById(id);
  var eg = ext.getSheetByName('EGRESOS');
  var ing = ext.getSheetByName('INGRESOS');
  if (!eg || !ing) return 'Falta la pestaña EGRESOS o INGRESOS en el archivo de ' + caja + '.';

  var porDia = {};
  var tz = ext.getSpreadsheetTimeZone() || 'America/Mexico_City';

  function claveFecha(v) {
    var d = (v instanceof Date) ? v : (v ? new Date(v) : null);
    if (!d || isNaN(d.getTime())) return null;
    if (antesDeOperacion_(d)) return null;
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  }

  var meEg = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var colFechaEg = meEg[SYNC.EG_FECHA];
  var colMontoEg = meEg[SYNC.EG_MONTO];
  var lastEg = eg.getLastRow();
  if (lastEg > SYNC.EG_HEADER_ROW && colFechaEg && colMontoEg) {
    var datosEg = eg.getRange(SYNC.EG_HEADER_ROW + 1, 1, lastEg - SYNC.EG_HEADER_ROW, eg.getLastColumn()).getValues();
    datosEg.forEach(function (fila) {
      var monto = fila[colMontoEg - 1];
      if (monto === '' || monto == null) return;
      var k = claveFecha(fila[colFechaEg - 1]);
      if (!k) return;
      if (!porDia[k]) porDia[k] = { ingresos: 0, egresos: 0 };
      porDia[k].egresos += Number(monto) || 0;
    });
  }

  var meIng = mapaFila_(ing, SYNC.EG_HEADER_ROW);
  var colFechaIng = meIng['FECHA'];
  var colMontoIng = meIng['MONTO'];
  var lastIng = ing.getLastRow();
  if (lastIng > SYNC.EG_HEADER_ROW && colFechaIng && colMontoIng) {
    var datosIng = ing.getRange(SYNC.EG_HEADER_ROW + 1, 1, lastIng - SYNC.EG_HEADER_ROW, ing.getLastColumn()).getValues();
    datosIng.forEach(function (fila) {
      var monto = fila[colMontoIng - 1];
      if (monto === '' || monto == null) return;
      var k = claveFecha(fila[colFechaIng - 1]);
      if (!k) return;
      if (!porDia[k]) porDia[k] = { ingresos: 0, egresos: 0 };
      porDia[k].ingresos += Number(monto) || 0;
    });
  }

  var claves = Object.keys(porDia).sort();

  var resumen = ext.getSheetByName('RESUMEN DIARIO');
  var esNueva = false;
  if (!resumen) { resumen = ext.insertSheet('RESUMEN DIARIO', ext.getNumSheets()); esNueva = true; }

  var props = PropertiesService.getScriptProperties();
  if (esNueva || props.getProperty('RD_FORMATO_V1') !== 'ok') {
    rdFormatear_(resumen);
    props.setProperty('RD_FORMATO_V1', 'ok');
  }

  /* ---------- TABLA DIARIA ---------- */
  var acum = 0;
  var filasDias = claves.map(function (k) {
    var d = porDia[k];
    var neto = d.ingresos - d.egresos;
    acum += neto;
    var p = k.split('-');
    var fecha = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
    return [fecha, d.ingresos, d.egresos, neto, acum];
  });

  if (filasDias.length) {
    resumen.getRange(2, 1, filasDias.length, 5).setValues(filasDias);
    resumen.getRange(2, 1, filasDias.length, 1).setNumberFormat('dd/mm/yyyy');
    resumen.getRange(2, 2, filasDias.length, 2).setNumberFormat('$#,##0.00');
    resumen.getRange(2, 4, filasDias.length, 2).setNumberFormat('$#,##0.00;[RED]-$#,##0.00');
  }

  var filaTotalDiaAnterior = Number(props.getProperty('RD_FILA_TOTAL_DIA') || 0);
  var filaTotalDia = filasDias.length + 2;

  if (filaTotalDiaAnterior && filaTotalDiaAnterior !== filaTotalDia) {
    resumen.getRange(filaTotalDiaAnterior, 1, 1, 5).setFontWeight('normal').setBackground(null);
    resumen.getRange(filaTotalDiaAnterior, 1).setValue('');
    resumen.getRange(filaTotalDiaAnterior, 2, 1, 4).setFormula('');
  }

  if (filasDias.length) {
    resumen.getRange(filaTotalDia, 1).setValue('TOTAL');
    resumen.getRange(filaTotalDia, 2).setFormula('=SUM(B2:B' + (filaTotalDia - 1) + ')');
    resumen.getRange(filaTotalDia, 3).setFormula('=SUM(C2:C' + (filaTotalDia - 1) + ')');
    resumen.getRange(filaTotalDia, 4).setFormula('=B' + filaTotalDia + '-C' + filaTotalDia);
    resumen.getRange(filaTotalDia, 5).setFormula('=E' + (filaTotalDia - 1));
    resumen.getRange(filaTotalDia, 1, 1, 5).setFontWeight('bold').setBackground('#dce6f1');
    resumen.getRange(filaTotalDia, 2, 1, 4).setNumberFormat('$#,##0.00;[RED]-$#,##0.00');
  }
  props.setProperty('RD_FILA_TOTAL_DIA', String(filaTotalDia));

  /* ---------- TABLA MENSUAL ---------- */
  var porMes = {}, ordenMes = [];
  claves.forEach(function (k) {
    var mk = k.substring(0, 7);
    if (porMes[mk] == null) { porMes[mk] = 0; ordenMes.push(mk); }
    porMes[mk] += porDia[k].ingresos - porDia[k].egresos;
  });

  var acumM = 0;
  var filasMes = ordenMes.map(function (mk) {
    var p = mk.split('-');
    var etiqueta = MESES_ES[Number(p[1]) - 1] + ' ' + p[0];
    acumM += porMes[mk];
    return [etiqueta, porMes[mk], acumM];
  });

  if (filasMes.length) {
    resumen.getRange(2, 7, filasMes.length, 3).setValues(filasMes);
    resumen.getRange(2, 8, filasMes.length, 2).setNumberFormat('$#,##0.00;[RED]-$#,##0.00');
  }

  var filaTotalMesAnterior = Number(props.getProperty('RD_FILA_TOTAL_MES') || 0);
  var filaTotalMes = filasMes.length + 2;

  if (filaTotalMesAnterior && filaTotalMesAnterior !== filaTotalMes) {
    resumen.getRange(filaTotalMesAnterior, 7, 1, 3).setFontWeight('normal').setBackground(null);
    resumen.getRange(filaTotalMesAnterior, 7).setValue('');
    resumen.getRange(filaTotalMesAnterior, 8, 1, 2).setFormula('');
  }

  if (filasMes.length) {
    resumen.getRange(filaTotalMes, 7).setValue('TOTAL');
    resumen.getRange(filaTotalMes, 8).setFormula('=SUM(H2:H' + (filaTotalMes - 1) + ')');
    resumen.getRange(filaTotalMes, 9).setFormula('=I' + (filaTotalMes - 1));
    resumen.getRange(filaTotalMes, 7, 1, 3).setFontWeight('bold').setBackground('#dce6f1');
    resumen.getRange(filaTotalMes, 8, 1, 2).setNumberFormat('$#,##0.00;[RED]-$#,##0.00');
  }
  props.setProperty('RD_FILA_TOTAL_MES', String(filaTotalMes));

  var msg = 'RESUMEN DIARIO actualizado para ' + caja + ': ' +
            filasDias.length + ' días · ' + filasMes.length + ' meses.';
  Logger.log(msg);
  return msg;
}

/* ===== Encabezados y anchos: SOLO LA PRIMERA VEZ. Ya no toca los
   datos ni el TOTAL — de eso se encarga generarResumenDiarioCedisSanPablo()
   renglón por renglón, según van creciendo los días. ===== */
function rdFormatear_(resumen) {
  var AZUL = '#0b3d66';
  resumen.getRange(1, 1, 1, 5)
    .setValues([['FECHA', 'TOTAL INGRESOS', 'TOTAL EGRESOS', 'NETO DEL DÍA', 'NETO ACUMULADO']])
    .setFontWeight('bold').setBackground(AZUL).setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  resumen.getRange(1, 7, 1, 3)
    .setValues([['MES', 'NETO DEL MES', 'NETO ACUMULADO']])
    .setFontWeight('bold').setBackground(AZUL).setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  resumen.setFrozenRows(1);
  resumen.setColumnWidths(1, 5, 130);
  resumen.setColumnWidth(6, 24);
  resumen.setColumnWidths(7, 3, 130);
}

/* ===== Botón manual: fuerza que se repinten los encabezados. Ya no
   borra tus días — en el mismo paso los vuelve a escribir. ===== */
function formatearResumenDiarioCSP() {
  PropertiesService.getScriptProperties().deleteProperty('RD_FORMATO_V1');
  return generarResumenDiarioCedisSanPablo();
}

/* ===== Limpieza única: quita el TOTAL viejo que se quedó pegado en
   las filas fijas 402 y 26 de una versión anterior. Correr UNA sola vez. ===== */
function limpiarFilaTotalViejaCSP() {
  var caja = 'CEDIS SAN PABLO';
  var id = fileIdDeCaja_(caja);
  if (!id) return caja + ': sin archivo registrado';
  var ext = SpreadsheetApp.openById(id);
  var resumen = ext.getSheetByName('RESUMEN DIARIO');
  if (!resumen) return 'No existe RESUMEN DIARIO.';
  resumen.getRange(16, 1, 400, 9).clear();
  PropertiesService.getScriptProperties().deleteProperty('RD_FILA_TOTAL_DIA');
  PropertiesService.getScriptProperties().deleteProperty('RD_FILA_TOTAL_MES');
  return 'Limpio. Ahora corre generarResumenDiarioCedisSanPablo().';
}


/* ===== "Saldo Inicial" como opción del desplegable de CATEGORÍA en INGRESOS ===== */
function agregarSaldoInicialACategorias() {
  var mapa = mapaCajas_();
  var resultados = [];
  var NUEVA_CATEGORIA = 'Saldo Inicial';

  CAJAS.forEach(function (caja) {
    var id = mapa[normalizarTexto(caja)];
    if (!id) { resultados.push(caja + ': sin archivo registrado'); return; }

    try {
      var ext = SpreadsheetApp.openById(id);
      var ing = ext.getSheetByName('INGRESOS');
      if (!ing) { resultados.push(caja + ': sin pestaña INGRESOS'); return; }

      var enc = ing.getRange(SYNC.EG_HEADER_ROW, 1, 1, ing.getLastColumn()).getValues()[0];
      var colCat = null;
      for (var c = 0; c < enc.length; c++) {
        if (normalizarTexto(String(enc[c])) === normalizarTexto('CATEGORIA')) { colCat = c + 1; break; }
      }
      if (!colCat) { resultados.push(caja + ': no se encontró columna CATEGORÍA en INGRESOS'); return; }

      var filas = Math.max(ing.getMaxRows() - SYNC.EG_HEADER_ROW, 500);
      var rango = ing.getRange(SYNC.EG_HEADER_ROW + 1, colCat, filas, 1);

      var dvActual = rango.getDataValidation();
      var criterios = [];
      if (dvActual) {
        try { criterios = dvActual.getCriteriaValues()[0] || []; } catch (e) {}
      }
      var yaEsta = criterios.some(function (x) { return normalizarTexto(x) === normalizarTexto(NUEVA_CATEGORIA); });
      if (!yaEsta) criterios.push(NUEVA_CATEGORIA);

      var reglaNueva = SpreadsheetApp.newDataValidation()
        .requireValueInList(criterios, true).setAllowInvalid(false).build();
      rango.setDataValidation(reglaNueva);

      resultados.push(caja + (yaEsta ? ': ya tenía "Saldo Inicial"' : ': "Saldo Inicial" agregado'));
    } catch (e) {
      resultados.push(caja + ': *** ERROR: ' + e.message + ' ***');
    }
  });

  var msg = resultados.join('\n');
  Logger.log(msg);
  return msg;
}


/* ===== Fórmulas de AÑO y MES en INGRESOS (las 15 cajas) ===== */
function agregarFormulasAnioMesIngresos() {
  var mapa = mapaCajas_();
  var resultados = [];
  var FILAS_TOTAL = 500;

  CAJAS.forEach(function (caja) {
    var id = mapa[normalizarTexto(caja)];
    if (!id) { resultados.push(caja + ': sin archivo registrado'); return; }

    try {
      var ext = SpreadsheetApp.openById(id);
      var ing = ext.getSheetByName('INGRESOS');
      if (!ing) { resultados.push(caja + ': sin pestaña INGRESOS'); return; }

      var enc = ing.getRange(SYNC.EG_HEADER_ROW, 1, 1, ing.getLastColumn()).getValues()[0];
      var colFecha = null, colAnio = null, colMes = null;
      for (var c = 0; c < enc.length; c++) {
        var t = normalizarTexto(String(enc[c]));
        if (t === normalizarTexto('FECHA')) colFecha = c + 1;
        if (t === normalizarTexto('AÑO') || t === normalizarTexto('ANIO')) colAnio = c + 1;
        if (t === normalizarTexto('MES')) colMes = c + 1;
      }
      if (!colFecha || !colAnio || !colMes) {
        resultados.push(caja + ': no se encontraron columnas FECHA/AÑO/MES en INGRESOS');
        return;
      }

      var primera = SYNC.EG_HEADER_ROW + 1;
      var letraFecha = letraColumna_(colFecha);

      var formulasAnio = [], formulasMes = [];
      for (var f = primera; f < primera + FILAS_TOTAL; f++) {
        formulasAnio.push(['=IF(' + letraFecha + f + '="","",YEAR(' + letraFecha + f + '))']);
        formulasMes.push(['=IF(' + letraFecha + f + '="","",LOWER(TEXT(' + letraFecha + f + ',"mmmm")))']);
      }
      ing.getRange(primera, colAnio, FILAS_TOTAL, 1).setFormulas(formulasAnio);
      ing.getRange(primera, colMes, FILAS_TOTAL, 1).setFormulas(formulasMes);

      resultados.push(caja + ': fórmulas de AÑO y MES agregadas en INGRESOS');
    } catch (e) {
      resultados.push(caja + ': *** ERROR: ' + e.message + ' ***');
    }
  });

  var msg = resultados.join('\n');
  Logger.log(msg);
  return msg;
}


/* ===== Lleva el ÁREA ("Comando gasto") a EGRESOS de CEDIS SAN PABLO ===== */
function sincronizarAreaEgresosCSP_() {
  return sincronizarColumnaEgresosCSP_(SYNC.C_AREA, SYNC.EG_AREA, false);
}

/* ===== Lleva la SUCURSAL DEL GASTO a EGRESOS. El egreso NO se mueve de
   caja: sigue viviendo en la caja que pagó; esta columna solo dice a
   quién se le carga el gasto. ===== */
function sincronizarSucursalGastoCSP_() {
  return sincronizarColumnaEgresosCSP_(SYNC.C_APLICA, SYNC.EG_SUC_GASTO, true);
}

/* Copia una columna del Concentrado a EGRESOS de CEDIS SAN PABLO, buscando
   por folio. La columna se crea AL FINAL para no mover ninguna otra. */
function sincronizarColumnaEgresosCSP_(nombreEnConcentrado, encabezadoEnEgresos, usarSucursalSiVacio) {
  var caja = 'CEDIS SAN PABLO';
  var id = fileIdDeCaja_(caja);
  if (!id) return 0;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!conc) return 0;
  var mc = mapaFila_(conc, 1);
  var colOrigen = mc[nombreEnConcentrado];
  if (!colOrigen || !mc[SYNC.C_FOLIO]) return 0;

  var v = conc.getDataRange().getValues();
  var porFolio = {};
  for (var i = 1; i < v.length; i++) {
    var fo = String(v[i][mc[SYNC.C_FOLIO] - 1] || '').trim();
    if (!fo) continue;
    var val = String(v[i][colOrigen - 1] || '').trim();
    if (!val && usarSucursalSiVacio) val = String(v[i][mc[SYNC.C_SUCURSAL] - 1] || '').trim();
    porFolio[fo] = val;
  }

  var eg = SpreadsheetApp.openById(id).getSheetByName('EGRESOS');
  if (!eg) return 0;

  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  var col = me[encabezadoEnEgresos];
  if (!col) {
    col = eg.getLastColumn() + 1;
    eg.getRange(SYNC.EG_HEADER_ROW, col).setValue(encabezadoEnEgresos);
    var ref = me[SYNC.EG_DETALLE] || me[SYNC.EG_CONCEPTO];
    if (ref) eg.getRange(SYNC.EG_HEADER_ROW, ref).copyTo(eg.getRange(SYNC.EG_HEADER_ROW, col), { formatOnly: true });
    me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  }

  var primera = SYNC.EG_HEADER_ROW + 1;
  var last = eg.getLastRow();
  if (last < primera) return 0;

  var folios = eg.getRange(primera, me[SYNC.EG_FOLIO], last - primera + 1, 1).getValues();
  var out = folios.map(function (f) {
    var k = String(f[0] || '').trim();
    return [(k && porFolio[k]) ? porFolio[k] : ''];
  });
  eg.getRange(primera, col, out.length, 1).setValues(out);
  return out.length;
}


/* ===== NOTA: el código que dibuja el DASHBOARD (los cuadros de
   OPERATIVOS, POR ÁREA, FAMILIA, POR SUCURSAL, etc.) NO vive en este
   archivo — vive en Desgloses.gs. ===== */