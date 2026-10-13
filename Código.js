/**********************************************************************
 * SISTEMA DE CONTROL DE CAJA CHICA — GRUPO VIZCARRA
 * Código.gs — Alta de solicitudes (Google Form) + correo de
 * autorización + utilidades compartidas.
 * Versión LIMPIA: escribe por NOMBRE de columna (no por posición),
 * sin las funciones viejas de Tesorería / comprobante.
 **********************************************************************/

var CONFIGURACION = {
  HOJA_RESPUESTAS: "Respuestas de formulario 1",
  HOJA_CONCENTRADO: "Concentrado",
  HOJA_CATALOGOS: "Catálogos",
  NOMBRE_REMITENTE: "Sistema de Caja Chica Vizcarra",
  ESTATUS_INICIAL: "Pendiente de autorizar"
};


/* ====================================================================
 * ALTA desde el Google Form (respaldo). Escribe por NOMBRE de columna.
 * ==================================================================== */
function onFormSubmit(e) {
  try {
    if (!e || !e.range) return;
    var ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
    var hojaRespuestas = e.range.getSheet();
    if (hojaRespuestas.getName() !== CONFIGURACION.HOJA_RESPUESTAS) return;

    var hojaConcentrado = ss.getSheetByName(CONFIGURACION.HOJA_CONCENTRADO);
    var hojaCatalogos = ss.getSheetByName(CONFIGURACION.HOJA_CATALOGOS) || ss.getSheetByName("Catalogos");
    if (!hojaConcentrado) throw new Error('No se encontró la hoja "' + CONFIGURACION.HOJA_CONCENTRADO + '".');
    if (!hojaCatalogos) throw new Error('No se encontró la hoja "Catálogos".');

    var filaR = e.range.getRow();
    var v = hojaRespuestas.getRange(filaR, 1, 1, 10).getDisplayValues()[0];
    var real = hojaRespuestas.getRange(filaR, 1, 1, 10).getValues()[0];

    var marca = (real[0] instanceof Date) ? real[0] : new Date();
    var fechaSolicitud   = v[1];
    var correoSolicitante= v[2];
    var sucursal         = v[3];
    var areaSolicitante  = v[4];
    var colaborador      = v[5];
    var tipoGasto        = v[6];
    var conceptoDetallado= v[7];
    var proveedor        = v[8];
    var importeCapturado = v[9];

    if (!sucursal)  throw new Error("La solicitud no contiene una sucursal.");
    if (!tipoGasto) throw new Error("La solicitud no contiene un tipo de gasto.");

    var reg = buscarEnCatalogo_(hojaCatalogos, sucursal, tipoGasto);
    if (!reg) throw new Error('No se encontró la sucursal "' + sucursal + '" en Catálogos.');
    if (!reg.correo) throw new Error('No existe correo de autorizador para la sucursal "' + sucursal + '".');

    var tz = ss.getSpreadsheetTimeZone() || "America/Mexico_City";
    var anio = Utilities.formatDate(marca, tz, "yyyy");
    var folio = generarFolio(anio, sucursal);

    var importeNum = convertirImporte(importeCapturado);
    var importeFmt = isNaN(importeNum) ? importeCapturado
      : importeNum.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

    // ---- Escribe la fila por NOMBRE de columna (alineado) ----
    var map = mapaColsPorNombre_(hojaConcentrado);
    var row = hojaConcentrado.getLastRow() + 1;
    setCel_(hojaConcentrado, row, map['Folio'], folio);
    setCel_(hojaConcentrado, row, map['Fecha solicitud'], fechaSolicitud);
    setCel_(hojaConcentrado, row, map['Sucursal'], sucursal);
    setCel_(hojaConcentrado, row, map['Colaborador'], colaborador);
    setCel_(hojaConcentrado, row, map['Comando gasto'], areaSolicitante);
    setCel_(hojaConcentrado, row, map['Tipo de Gasto'], tipoGasto);
    setCel_(hojaConcentrado, row, map['Cuenta Contable'], reg.cuenta);
    setCel_(hojaConcentrado, row, map['Descripcion Subconcepto'], conceptoDetallado);
    setCel_(hojaConcentrado, row, map['Importe'], isNaN(importeNum) ? importeCapturado : importeNum);
    setCel_(hojaConcentrado, row, colEstatusAut_(map), CONFIGURACION.ESTATUS_INICIAL);
    setCel_(hojaConcentrado, row, map['Autorizo'], reg.autorizador);
    setCel_(hojaConcentrado, row, map['Correo del Solicitane'], correoSolicitante);
    setCel_(hojaConcentrado, row, map['Observaciones'], 'Proveedor: ' + (proveedor || 'No informado'));

    // ---- Correo al autorizador ----
    var html =
      '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
        '<div style="background:#0b3d66;color:#fff;padding:18px 22px;">' +
          '<h2 style="margin:0;">Solicitud de Caja Chica</h2>' +
          '<p style="margin:6px 0 0;">Pendiente de autorización</p></div>' +
        '<div style="padding:22px;border:1px solid #d9d9d9;">' +
          '<p>Hola <strong>' + escaparHtml(reg.autorizador) + '</strong>,</p>' +
          '<p>Se recibió una nueva solicitud de pago de Caja Chica.</p>' +
          '<table style="width:100%;border-collapse:collapse;">' +
            crearFilaCorreo('Folio', folio) +
            crearFilaCorreo('Fecha de solicitud', fechaSolicitud) +
            crearFilaCorreo('Sucursal', sucursal) +
            crearFilaCorreo('Área solicitante', areaSolicitante) +
            crearFilaCorreo('Colaborador', colaborador) +
            crearFilaCorreo('Correo del solicitante', correoSolicitante) +
            crearFilaCorreo('Tipo de gasto', tipoGasto) +
            crearFilaCorreo('Cuenta contable', reg.cuenta) +
            crearFilaCorreo('Concepto', conceptoDetallado) +
            crearFilaCorreo('Proveedor', proveedor) +
            crearFilaCorreo('Importe solicitado', importeFmt) +
          '</table>' +
          '<p style="margin-top:24px;"><a href="' + ss.getUrl() + '" style="background:#0b3d66;color:#fff;text-decoration:none;padding:12px 18px;border-radius:4px;display:inline-block;">Revisar concentrado</a></p>' +
          '<p style="font-size:12px;color:#666;margin-top:24px;">El envío de la solicitud no representa una autorización automática.</p>' +
        '</div></div>';
    var texto = 'Nueva solicitud de Caja Chica.\nFolio: ' + folio + '\nSucursal: ' + sucursal +
      '\nImporte solicitado: ' + importeFmt + '\n\nRevise el concentrado: ' + ss.getUrl();

    var opciones = { to: reg.correo, subject: 'Solicitud de Caja Chica pendiente de autorización | ' + folio,
                     body: texto, htmlBody: html, name: CONFIGURACION.NOMBRE_REMITENTE };
    if (reg.copias) opciones.cc = reg.copias;
    MailApp.sendEmail(opciones);

  } catch (error) {
    console.error(error);
    throw error;
  }
}


/* ====================================================================
 * CORREO al cambiar el estatus de autorización (columna por NOMBRE)
 * ==================================================================== */
function procesarCambioEstatus(e) {
  try {
    if (!e || !e.range) return;
    var hoja = e.range.getSheet();
    if (hoja.getName() !== CONFIGURACION.HOJA_CONCENTRADO) return;
    var fila = e.range.getRow();
    if (fila < 2) return;

    var map = mapaColsPorNombre_(hoja);
    var colEst = colEstatusAut_(map);
    if (colEst == null) return;
    if (e.range.getColumn() !== colEst + 1) return; // solo si se editó esa columna

    var estatus = String(e.range.getValue() || '').trim();
    if (estatus !== 'Autorizado' && estatus !== 'Rechazado' && estatus !== 'Pendiente de autorizar') return;

    var leer = function (nombre) { var c = map[nombre]; return (c == null) ? '' : String(hoja.getRange(fila, c + 1).getDisplayValue() || '').trim(); };
    var poner = function (nombre, valor) { var c = map[nombre]; if (c != null) hoja.getRange(fila, c + 1).setValue(valor); };

    if (estatus === 'Pendiente de autorizar') {
      poner('Fecha de Autorizacion', '');
      poner('Correo Enviado', '');
      return;
    }
    if (leer('Correo Enviado') === 'Sí') return; // evita reenviar

    var folio = leer('Folio');
    var sucursal = leer('Sucursal');
    var colaborador = leer('Colaborador');
    var tipoGasto = leer('Tipo de Gasto');
    var concepto = leer('Descripcion Subconcepto');
    var observaciones = leer('Observaciones');
    var importe = (map['Importe'] != null) ? hoja.getRange(fila, map['Importe'] + 1).getValue() : 0;

    var nombreAutorizador = leer('Autorizo');
    if (!nombreAutorizador) { nombreAutorizador = Session.getActiveUser().getEmail() || 'Autorizador'; poner('Autorizo', nombreAutorizador); }
    poner('Fecha de Autorizacion', new Date());

    var correoSolicitante = leer('Correo del Solicitane');
    if (!correoSolicitante) {
      var m = observaciones.match(/Correo solicitante:\s*([^\s|]+)/i);
      if (m && m[1]) { correoSolicitante = m[1].trim(); poner('Correo del Solicitane', correoSolicitante); }
    }
    if (!correoSolicitante) throw new Error('No se encontró el correo del solicitante para el folio ' + folio);

    var copias = buscarCopiasCatalogo_(e.source, sucursal);
    var importeFmt = Number(importe).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    var color = (estatus === 'Autorizado') ? '#1f7a3e' : '#b3261e';
    var cierre = (estatus === 'Autorizado') ? 'La solicitud puede continuar con el proceso de pago.' : 'La solicitud no continuará al proceso de pago.';

    var html =
      '<div style="font-family:Arial,sans-serif;max-width:650px;color:#222;">' +
        '<div style="background:' + color + ';color:#fff;padding:18px 22px;">' +
          '<h2 style="margin:0;">Solicitud ' + escaparHtml(estatus) + '</h2>' +
          '<p style="margin:6px 0 0;">' + escaparHtml(folio) + '</p></div>' +
        '<div style="border:1px solid #ddd;padding:22px;">' +
          '<p>Hola <strong>' + escaparHtml(colaborador) + '</strong>,</p>' +
          '<p>Tu solicitud de Caja Chica fue <strong>' + escaparHtml(estatus.toUpperCase()) + '</strong>.</p>' +
          '<table style="width:100%;border-collapse:collapse;">' +
            crearFilaCorreo('Folio', folio) +
            crearFilaCorreo('Sucursal', sucursal) +
            crearFilaCorreo('Tipo de gasto', tipoGasto) +
            crearFilaCorreo('Concepto', concepto) +
            crearFilaCorreo('Importe', importeFmt) +
            crearFilaCorreo('Autorizó', nombreAutorizador) +
            crearFilaCorreo('Observaciones', observaciones || 'Sin observaciones') +
          '</table>' +
          '<p style="margin-top:22px;">' + cierre + '</p>' +
        '</div></div>';
    var texto = 'Hola ' + colaborador + ':\n\nTu solicitud de Caja Chica fue ' + estatus.toUpperCase() +
      '.\nFolio: ' + folio + '\nImporte: ' + importeFmt + '\nAutorizó: ' + nombreAutorizador + '\n\n' + cierre;

    var opciones = { to: correoSolicitante, subject: 'Solicitud de Caja Chica ' + estatus + ' | ' + folio,
                     body: texto, htmlBody: html, name: CONFIGURACION.NOMBRE_REMITENTE };
    if (copias) opciones.cc = copias;
    MailApp.sendEmail(opciones);
    poner('Correo Enviado', 'Sí');

  } catch (error) {
    console.error(error);
    throw error;
  }
}


/* ====================================================================
 * FOLIO
 * ==================================================================== */
function generarFolio(anio, sucursal) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var codigo = obtenerCodigoSucursal(sucursal);
    var clave = "ULTIMO_FOLIO_" + codigo + "_" + anio;
    var ultimo = Number(props.getProperty(clave) || 0);
    var nuevo = ultimo + 1;
    props.setProperty(clave, String(nuevo));
    return "CC-" + codigo + "-" + anio + "-" + String(nuevo).padStart(6, "0");
  } finally {
    lock.releaseLock();
  }
}

function obtenerCodigoSucursal(sucursal) {
  var n = normalizarTexto(sucursal);
  var codigos = {
    'GUADALAJARA':'GDL','SAN PABLO UNO':'SP1','SAN PABLO DOS':'SP2','SOTANO':'SOT',
    'CORREO UNO':'CR1','CORREO DOS':'CR2','RAMON CORONA UNO':'RC1','RAMON CORONA DOS':'RC2',
    'BOLIVIA':'BOL','BRASIL UNO':'BR1','CORREGIDORA':'CRG','APARTADO UNO':'AP1','APARTADO DOS':'AP2',
    'PUEBLA':'PUE','OUTLET':'OUT','ECOMMERCE':'ECO','CEDIS TEXCOCO':'CDT','CEDIS SAN PABLO':'CDS',
    'HAMBURGO':'HAM','PUEBLO ALFREDO':'PAV','PLATA 14':'CDP','PLATA':'CDP','CASTILLO':'CDC','ALFREDO':'AVZ',
    'ALFREDO VIZCARRA':'AVZ','EDITH HUERTA VARGAS':'EHV','NATASHA VIZCARRA':'NVZ',
    'ALFREDO JR. VIZCARRA':'AJV','SURI AILEEN VIZCARRA':'SAV','FERNANDA VIZCARRA':'FVZ',
    'APOYOS A FAMILIA':'APF','CASA FAMILIAR':'CSF'
  };
  if (!codigos[n]) throw new Error("No existe código configurado para la sucursal: " + sucursal);
  return codigos[n];
}


/* ====================================================================
 * HELPERS (compartidos con Solicitud.gs)
 * ==================================================================== */
function mapaColsPorNombre_(hoja) {
  var enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  var map = {};
  for (var c = 0; c < enc.length; c++) { var k = String(enc[c]); if (k.trim() !== '') map[k] = c; }
  return map;
}

// Encuentra la columna de estatus de autorización aunque tenga 1 o 2 espacios
function colEstatusAut_(map) {
  if (map['Estatus  Autorizacion'] != null) return map['Estatus  Autorizacion'];
  if (map['Estatus Autorizacion'] != null) return map['Estatus Autorizacion'];
  return null;
}

function setCel_(hoja, fila, col0, valor) {
  if (col0 == null) return;
  hoja.getRange(fila, col0 + 1).setValue(valor);
}

function buscarEnCatalogo_(cat, sucursal, tipoGasto) {
  var last = cat.getLastRow();
  if (last < 2) return null;
  var filas = cat.getRange(2, 1, last - 1, 10).getDisplayValues();
  var sB = normalizarTexto(sucursal), gB = normalizarTexto(tipoGasto);
  var porSuc = null;
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    var sc = normalizarTexto(f[6] || f[1]);
    if (sc !== sB) continue;
    if (!porSuc) porSuc = f;
    var conceptos = [f[2], f[3], f[5]].map(normalizarTexto).filter(Boolean);
    var ok = conceptos.some(function (cn) { return cn.indexOf(gB) !== -1 || gB.indexOf(cn) !== -1; });
    if (ok) return { cuenta: f[0], autorizador: f[7], correo: f[8], copias: f[9] };
  }
  if (porSuc) return { cuenta: porSuc[0], autorizador: porSuc[7], correo: porSuc[8], copias: porSuc[9] };
  return null;
}

function buscarCopiasCatalogo_(ss, sucursal) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var cat = ss.getSheetByName('Catálogos') || ss.getSheetByName('Catalogos');
  if (!cat || cat.getLastRow() < 2) return '';
  var datos = cat.getRange(2, 7, cat.getLastRow() - 1, 4).getDisplayValues(); // G..J
  var objetivo = normalizarTexto(sucursal);
  for (var i = 0; i < datos.length; i++) {
    if (normalizarTexto(datos[i][0]) === objetivo) return String(datos[i][3] || '').trim();
  }
  return '';
}

function convertirImporte(valor) {
  var t = String(valor || "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim();
  return Number(t);
}

function normalizarTexto(texto) {
  return String(texto || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function crearFilaCorreo(etiqueta, valor) {
  return '<tr><td style="border:1px solid #dddddd;padding:9px;background:#f3f5f7;font-weight:bold;width:35%;">' +
    escaparHtml(etiqueta) + '</td><td style="border:1px solid #dddddd;padding:9px;">' +
    escaparHtml(valor || "No informado") + '</td></tr>';
}

function escaparHtml(valor) {
  return String(valor || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}


/* ====================================================================
 * UTILIDADES
 * ==================================================================== */
function autorizarSistema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets();
  Logger.log("Sistema autorizado. Correos disponibles hoy: " + MailApp.getRemainingDailyQuota());
}

function reiniciarFolios() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log("Todos los folios fueron reiniciados.");
}