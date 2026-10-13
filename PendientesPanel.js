/**********************************************************************
 * PANEL DE PENDIENTES — GRUPO VIZCARRA
 * --------------------------------------------------------------------
 * Resuelve el problema de raíz: autorizar SIN depender del correo.
 * Abre un panel dentro de la hoja de cálculo con todas las solicitudes
 * que esperan firma, cada una con sus botones Autorizar / Rechazar.
 *
 * Si el correo no llega (cuota agotada, spam, retraso de Gmail), la
 * operación NO se detiene: se autoriza desde aquí.
 *
 * NO requiere publicar nueva versión: el panel vive en la hoja.
 **********************************************************************/


/** Abre el panel lateral. Se llama desde el menú ⚙️ Caja Chica. */
function abrirPanelPendientes() {
  var html = HtmlService.createHtmlOutputFromFile('pendientes')
    .setTitle('Pendientes de autorizar')
    .setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}


/** Devuelve las solicitudes que esperan firma, con el dato de a quién le
 *  toca firmar ahora mismo. Ordenadas de la más nueva a la más vieja. */
function getPendientesParaFirma() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var last = sh.getLastRow();
  if (last < 2) return [];

  // Una sola lectura de toda la hoja (rápido).
  var map = mapaColumnas_(sh);
  var ancho = sh.getLastColumn();
  var datos = sh.getRange(2, 1, last - 1, ancho).getDisplayValues();
  var brutos = sh.getRange(2, 1, last - 1, ancho).getValues();

  var col = function (nombre) { return map[nombre]; };
  var out = [];

  for (var i = 0; i < datos.length; i++) {
    var g = function (nombre) {
      var c = col(nombre);
      return (c == null || c >= ancho) ? '' : String(datos[i][c] || '').trim();
    };

    var folio = g(SOL.COL_FOLIO);
    if (!folio) continue;

    var est = g(SOL.COL_ESTATUS_AUT);
    var e0 = normalizarTexto(est);
    // Solo lo que sigue esperando una firma.
    if (e0.indexOf('PENDIENTE') !== 0 && e0.indexOf('AUTORIZADO POR') !== 0) continue;

    var cImp = col(SOL.COL_IMPORTE);
    var importe = (cImp == null || cImp >= ancho) ? 0 : (Number(brutos[i][cImp]) || 0);
    var area = g(SOL.COL_AREA);
    var val1 = primerAutorizador_(area, importe);

    // ¿A quién le toca firmar AHORA?
    var turno, etapa;
    if (val1 && e0.indexOf('AUTORIZADO POR') === 0) {
      turno = AUTORIZACION.FINAL_NOMBRE; etapa = '2 de 2 · liberación final';
    } else if (val1) {
      turno = val1.nombre; etapa = '1 de 2 · validación de ' + area;
    } else {
      turno = g(SOL.COL_AUTORIZO) || 'Autorizador del catálogo'; etapa = 'firma única';
    }

    out.push({
      folio:       folio,
      fila:        i + 2,
      sucursal:    g(SOL.COL_SUCURSAL),
      aplica:      g(SOL.COL_SUC_APLICA),
      area:        area,
      colaborador: g(SOL.COL_COLABORADOR),
      tipo:        g(SOL.COL_TIPO_GASTO),
      concepto:    g(SOL.COL_SUBCONCEPTO),
      importe:     importe,
      estatus:     est,
      turno:       turno,
      etapa:       etapa,
      adjuntos:    g(SOL.COL_ADJUNTOS),
      fecha:       g(SOL.COL_FECHA_SOL)
    });
  }

  return out.reverse();   // lo más nuevo primero
}


/** Autoriza desde el panel. Hace exactamente lo mismo que el botón del
 *  correo: avanza la etapa, avisa al siguiente firmante, notifica al
 *  solicitante y, si Angel liberó, avisa a Omar y Eri.
 *  procesarAutorizacionWeb_ devuelve una página HTML que aquí no se usa;
 *  lo que importa son sus efectos. */
function autorizarDesdePanel(folio) {
  try {
    procesarAutorizacionWeb_('autorizar', folio);
    return { ok: true, mensaje: folio + ' autorizado.' };
  } catch (e) {
    return { ok: false, mensaje: e.message };
  }
}

function rechazarDesdePanel(folio) {
  try {
    procesarAutorizacionWeb_('rechazar', folio);
    return { ok: true, mensaje: folio + ' rechazado.' };
  } catch (e) {
    return { ok: false, mensaje: e.message };
  }
}


/** Marca la entrega de efectivo desde el panel (lo que hace Omar con su
 *  botón del correo). Útil si a Omar tampoco le llega el aviso. */
function entregarDesdePanel(folio) {
  try {
    procesarEntregaWeb_(folio);
    return { ok: true, mensaje: folio + ' marcado como entregado.' };
  } catch (e) {
    return { ok: false, mensaje: e.message };
  }
}


/** Autorizadas que siguen sin entrega de efectivo (la lista de Omar). */
function getPendientesEntrega() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  var last = sh.getLastRow();
  if (last < 2) return [];

  var map = mapaColumnas_(sh);
  var colEnt = ensureCol_(sh, AUTORIZACION.COL_ENTREGA);
  var ancho = sh.getLastColumn();
  var datos = sh.getRange(2, 1, last - 1, ancho).getDisplayValues();
  var brutos = sh.getRange(2, 1, last - 1, ancho).getValues();
  var out = [];

  for (var i = 0; i < datos.length; i++) {
    var g = function (nombre) {
      var c = map[nombre];
      return (c == null || c >= ancho) ? '' : String(datos[i][c] || '').trim();
    };
    var folio = g(SOL.COL_FOLIO);
    if (!folio) continue;
    if (normalizarTexto(g(SOL.COL_ESTATUS_AUT)) !== 'AUTORIZADO') continue;

    var entregado = (colEnt < ancho) ? String(datos[i][colEnt] || '').trim() : '';
    if (entregado) continue;

    var cImp = map[SOL.COL_IMPORTE];
    out.push({
      folio:       folio,
      sucursal:    g(SOL.COL_SUCURSAL),
      colaborador: g(SOL.COL_COLABORADOR),
      tipo:        g(SOL.COL_TIPO_GASTO),
      importe:     (cImp == null || cImp >= ancho) ? 0 : (Number(brutos[i][cImp]) || 0)
    });
  }
  return out.reverse();
}