/* ==========================================================================
   POLIZAPDF.GS — PDF diario de la póliza + comprobantes digitales
   --------------------------------------------------------------------------
   Junta, en un solo PDF por día: la tabla de la póliza (pestaña POLIZA),
   con diseño de Grupo Vizcarra, y como páginas siguientes, la foto de cada
   comprobante subido en la Comprobación del Gasto.

   CANDADO: el PDF de un día solo se genera si TODOS los folios de ese día
   ya tienen su comprobación registrada (Importe Comprobado lleno en el
   Concentrado).

   CAMBIOS (10-sept-2026):
   0) BUG QUE IMPEDÍA TODO. Se eliminó etiqueta.setKeepWithNext(true): ese
      método NO EXISTE en Apps Script (es del API REST de Google Docs), así
      que tronaba con "setKeepWithNext is not a function" siempre que el día
      traía comprobantes.
   1) DESTINO EN DRIVE, ORDENADO POR MES. Se guarda en la carpeta de pólizas
      (PPDF_CARPETA_ID), dentro de una subcarpeta por mes que se crea sola —
      "2026-09 SEPTIEMBRE", "2026-10 OCTUBRE". Un solo nivel: adentro van
      directo los PDF de cada día.
   2) SE GENERA AL CERRAR LA COMPROBACIÓN, con
      generarPolizaPDFTrasComprobacion(), que llama registrarComprobacion().
      El activador nocturno de las 23:45 queda como red de seguridad.
   3) FOTOS QUE NO SE PUEDEN PEGAR YA NO TUMBAN EL DÍA. Docs solo acepta
      PNG/JPEG/GIF/BMP; un HEIC de iPhone o un WEBP daban "Invalid image
      data" y se perdía la póliza completa de esa fecha. Ahora hay tres
      intentos: foto original → miniatura de Drive → link. La póliza sale
      siempre, y el log dice qué comprobantes quedaron como link.
   4) EL RANGO SE PUEDE CORRER POR PARTES. generarPolizaPDFRango salta los
      días que ya tienen PDF y se detiene sola antes del corte de 6 minutos
      de Apps Script, diciéndote desde dónde seguir.
   ========================================================================== */

var PPDF_COLOR_MARCA = '#0b3d66';
var PPDF_COLOR_FRANJA = '#f2f6fa';
var PPDF_COLOR_TOTAL = '#dce8f5';
var PPDF_COLOR_GRIS = '#777777';

/* Carpeta de Drive donde viven las pólizas digitales.
   Si algún día se cambia de carpeta, se cambia SOLO este ID. */
var PPDF_CARPETA_ID = '1VFeFxnxY7fMa4DD6JeJLEwdWbW3t8BKA';

/* Devuelve la carpeta destino de las pólizas. Si el ID quedara mal o se
   perdiera el permiso, no se pierde la póliza: se avisa en el log y cae en
   Mi unidad como respaldo. */
function _ppdfCarpetaRaiz_() {
  if (PPDF_CARPETA_ID) {
    try {
      return DriveApp.getFolderById(PPDF_CARPETA_ID);
    } catch (e) {
      console.error('No pude abrir la carpeta de pólizas (' + PPDF_CARPETA_ID + '): ' +
                    e.message + '. Se usa Mi unidad como respaldo.');
    }
  }
  return obtenerOCrearSubcarpeta_(DriveApp.getRootFolder(), 'POLIZAS DIGITALES');
}

/* Nombres de mes para las subcarpetas. Van en español y en mayúsculas. */
var PPDF_MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
                  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/* Subcarpeta del mes dentro de la carpeta de pólizas, por ejemplo
   "2026-09 SEPTIEMBRE". Se crea la primera vez que se ocupa y de ahí en
   adelante se reutiliza. El año va adelante para que Drive las ordene
   solas en orden cronológico. */
function _ppdfCarpetaDelMes_(fechaTxt) {
  var base = _ppdfCarpetaRaiz_();
  var p = String(fechaTxt || '').split('-');
  if (p.length !== 3) return base;   // fecha rara: se guarda en la raíz

  var mesNum = Number(p[1]);
  if (!mesNum || mesNum < 1 || mesNum > 12) return base;

  var nombre = p[0] + '-' + ('0' + mesNum).slice(-2) + ' ' + PPDF_MESES[mesNum - 1];
  return obtenerOCrearSubcarpeta_(base, nombre);
}

/* ¿Google Docs puede pegar esta imagen? Docs solo acepta PNG, JPEG, GIF y
   BMP. Las fotos de iPhone en HEIC, los WEBP y los PDF pasan el filtro de
   "image/..." pero al pegarlos truenan con "Invalid image data" y tumban
   la póliza del día completo. Por eso se filtran antes. */
function _ppdfMimeInsertable_(mime) {
  var m = String(mime || '').toLowerCase();
  return m === 'image/png' || m === 'image/jpeg' || m === 'image/jpg' ||
         m === 'image/gif' || m === 'image/bmp';
}

/* Pega un blob de imagen centrado y escalado para que quepa en una página.
   Devuelve true si se pudo. Nunca agranda la foto, solo la achica. */
function _ppdfPegarImagen_(body, blob, anchoMax, altoMax) {
  var img = body.appendImage(blob);
  var w = img.getWidth(), h = img.getHeight();
  var factor = Math.min(anchoMax / w, altoMax / h, 1);
  if (factor < 1) {
    img.setWidth(Math.round(w * factor));
    img.setHeight(Math.round(h * factor));
  }
  img.getParent().asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  return true;
}

function _ppdfParseFecha_(txt) {
  var p = String(txt).split('-');
  if (p.length === 3) return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return new Date(txt);
}

function _ppdfTruncar_(texto, maxLen) {
  var t = String(texto || '').trim();
  return (t.length > maxLen) ? (t.substring(0, maxLen - 1).trim() + '…') : t;
}

function _ppdfBuscarCarpetaFolioSoloLectura_(sucursal, folio) {
  if (!CFG.CARPETA_RAIZ_ID) return null;
  var raiz = DriveApp.getFolderById(CFG.CARPETA_RAIZ_ID);
  var itS = raiz.getFoldersByName(limpiaNombre_(sucursal));
  if (!itS.hasNext()) return null;
  var carpSuc = itS.next();
  var itF = carpSuc.getFoldersByName(limpiaNombre_(folio));
  if (!itF.hasNext()) return null;
  return itF.next();
}

function _ppdfMapaComprobados_() {
  var mapa = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
  if (!sh) return mapa;

  var map = mapaColumnas_(sh);
  var colFolio = map[CFG.COL_FOLIO];
  var colComp = map[CFG.COL_IMPORTE_COMPROBADO];
  if (colFolio == null) return mapa;

  var last = sh.getLastRow();
  if (last < 2) return mapa;

  var datos = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  datos.forEach(function (fila) {
    var folio = String(fila[colFolio] || '').trim();
    if (!folio) return;
    var comprobado = (colComp != null) && String(fila[colComp] || '').trim() !== '';
    mapa[folio] = comprobado;
  });
  return mapa;
}

function _ppdfConstruirDocumento_(fechaTexto) {
  var cc = SpreadsheetApp.getActiveSpreadsheet();
  var tz = cc.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var fechaObj = fechaTexto ? _ppdfParseFecha_(fechaTexto) : new Date();
  var fechaTxt = Utilities.formatDate(fechaObj, tz, 'yyyy-MM-dd');

  // Comprobantes que no se pudieron pegar como imagen (van como link).
  var fallidos = [];

  var poliza = cc.getSheetByName('POLIZA');
  if (!poliza) return { error: 'No existe la pestaña POLIZA. Corre primero generarPolizaDiariaCSP().' };

  var last = poliza.getLastRow();
  if (last < 2) return { error: 'POLIZA está vacía.' };

  var datos = poliza.getRange(2, 1, last - 1, 7).getValues();
  var renglones = datos.filter(function (f) {
    return (f[0] instanceof Date) && Utilities.formatDate(f[0], tz, 'yyyy-MM-dd') === fechaTxt;
  });

  if (!renglones.length) {
    return { error: 'No hay renglones de POLIZA para ' + fechaTxt + '. No se generó PDF.' };
  }

  var folioPoliza = String(renglones[0][1] || '');

  var folios = [];
  var hojaFolios = cc.getSheetByName('POLIZA_FOLIOS');
  if (hojaFolios) {
    var lastF = hojaFolios.getLastRow();
    if (lastF >= 2) {
      var datosF = hojaFolios.getRange(2, 1, lastF - 1, 2).getValues();
      datosF.forEach(function (f) {
        if ((f[0] instanceof Date) && Utilities.formatDate(f[0], tz, 'yyyy-MM-dd') === fechaTxt) {
          var folioTxt = String(f[1] || '').trim();
          if (folioTxt && folios.indexOf(folioTxt) === -1) folios.push(folioTxt);
        }
      });
    }
  }
  folios.sort();

  if (folios.length) {
    var mapaComprobados = _ppdfMapaComprobados_();
    var pendientes = folios.filter(function (f) { return !mapaComprobados[f]; });
    if (pendientes.length) {
      return {
        error: 'No se generó el PDF de ' + fechaTxt + ': todavía faltan ' + pendientes.length +
               ' folio(s) por comprobar → ' + pendientes.join(', ')
      };
    }
  }

  // ================= DOCUMENTO =================
  var doc = DocumentApp.create('TEMP_POLIZA_' + PZ_CAJA + '_' + fechaTxt);
  var body = doc.getBody();
  body.setMarginTop(30).setMarginBottom(30).setMarginLeft(36).setMarginRight(36);

  var membrete = body.appendTable([['GRUPO VIZCARRA']]);
  membrete.setBorderWidth(0);
  var celdaMembrete = membrete.getRow(0).getCell(0);
  celdaMembrete.setBackgroundColor(PPDF_COLOR_MARCA);
  celdaMembrete.setPaddingTop(8).setPaddingBottom(8);
  celdaMembrete.editAsText().setBold(true).setForegroundColor('#ffffff').setFontSize(15).setFontFamily('Arial');
  celdaMembrete.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph('PÓLIZA DE EGRESOS DIARIA')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true).setFontSize(11)
    .setFontFamily('Arial').setSpacingBefore(8).setSpacingAfter(2);

  body.appendParagraph(PZ_CAJA)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(9)
    .setFontFamily('Arial').setForegroundColor(PPDF_COLOR_GRIS).setSpacingAfter(2);

  body.appendParagraph('Fecha: ' + Utilities.formatDate(fechaObj, tz, 'dd/MM/yyyy') + '   ·   Póliza: ' + folioPoliza)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(9)
    .setFontFamily('Arial').setForegroundColor(PPDF_COLOR_GRIS).setSpacingAfter(12);

  var tabla = [['FECHA', 'PÓLIZA', 'CUENTA', 'CONCEPTO', 'DETALLADO', 'CARGO', 'ABONO']];
  var totalCargo = 0, totalAbono = 0;
  renglones.forEach(function (f) {
    var cargo = Number(f[5]) || 0;
    var abono = Number(f[6]) || 0;
    totalCargo += cargo;
    totalAbono += abono;
    tabla.push([
      Utilities.formatDate(f[0], tz, 'dd/MM/yy'),
      String(f[1] || ''),
      String(f[2] || ''),
      _ppdfTruncar_(f[3], 38),
      _ppdfTruncar_(f[4], 55),
      cargo ? cargo.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '',
      abono ? abono.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : ''
    ]);
  });
  tabla.push(['', '', '', '', 'TOTAL',
    totalCargo.toLocaleString('es-MX', { minimumFractionDigits: 2 }),
    totalAbono.toLocaleString('es-MX', { minimumFractionDigits: 2 })]);

  var t = body.appendTable(tabla);
  t.setBorderColor('#d9d9d9').setBorderWidth(0.5);

  var anchos = [50, 58, 42, 92, 118, 55, 55];
  for (var col = 0; col < anchos.length; col++) t.setColumnWidth(col, anchos[col]);

  var numFilas = t.getNumRows();
  for (var fi = 0; fi < numFilas; fi++) {
    var esHeader = (fi === 0);
    var esTotal = (fi === numFilas - 1);
    var fondo = esHeader ? PPDF_COLOR_MARCA : (esTotal ? PPDF_COLOR_TOTAL : (fi % 2 === 0 ? PPDF_COLOR_FRANJA : '#ffffff'));
    var filaTabla = t.getRow(fi);
    for (var ci = 0; ci < filaTabla.getNumCells(); ci++) {
      var celda = filaTabla.getCell(ci);
      celda.setBackgroundColor(fondo);
      celda.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(4).setPaddingRight(4);
      var txt = celda.editAsText();
      txt.setFontFamily('Arial').setFontSize(esHeader || esTotal ? 8 : 7.5);
      if (esHeader) txt.setForegroundColor('#ffffff').setBold(true);
      if (esTotal) txt.setBold(true);
      if (ci === 5 || ci === 6) {
        celda.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }
  }

  if (Math.abs(totalCargo - totalAbono) > 0.01) {
    body.appendParagraph('⚠ La póliza no cuadra: Cargo $' + totalCargo.toFixed(2) + ' vs Abono $' + totalAbono.toFixed(2))
      .setFontFamily('Arial').setFontSize(9).setForegroundColor('#b3261e').setSpacingBefore(8);
  }

  // ---- Comprobantes digitales: uno por página, centrados y escalados ----
  if (folios.length) {
    body.appendPageBreak();
    var membreteComp = body.appendTable([['COMPROBANTES DIGITALES']]);
    membreteComp.setBorderWidth(0);
    var celdaComp = membreteComp.getRow(0).getCell(0);
    celdaComp.setBackgroundColor(PPDF_COLOR_MARCA);
    celdaComp.setPaddingTop(6).setPaddingBottom(6);
    celdaComp.editAsText().setBold(true).setForegroundColor('#ffffff').setFontSize(11).setFontFamily('Arial');
    celdaComp.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    var esPrimero = true;
    var anchoMax = 400;
    var altoMax = 620; // deja espacio para el folio y los márgenes, cabe en 1 página

    folios.forEach(function (folioTxt) {
      var carpeta = _ppdfBuscarCarpetaFolioSoloLectura_(PZ_CAJA, folioTxt);
      if (!carpeta) return;

      var archivos = carpeta.getFiles();
      while (archivos.hasNext()) {
        var arch = archivos.next();
        var mime = arch.getMimeType();

        if (!esPrimero) body.appendPageBreak();
        esPrimero = false;

        body.appendParagraph('Folio: ' + folioTxt)
          .setFontFamily('Arial').setFontSize(10).setBold(true).setForegroundColor(PPDF_COLOR_MARCA)
          .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
          .setSpacingAfter(6);

        /* Tres intentos, en orden, y NINGUNO puede tumbar la póliza:
           1) pegar la foto tal cual (solo si el formato es de los que Docs
              acepta),
           2) si falla, pegar la miniatura que Drive genera sola — sirve
              para HEIC de iPhone, WEBP y hasta PDF,
           3) si tampoco, dejar el link al comprobante en Drive.
           Antes cualquier "Invalid image data" reventaba el día completo y
           no salía ninguna póliza de esa fecha. */
        var pegada = false;

        if (_ppdfMimeInsertable_(mime)) {
          try {
            pegada = _ppdfPegarImagen_(body, arch.getBlob(), anchoMax, altoMax);
          } catch (e) {
            console.error('Imagen no pegable (' + folioTxt + ' · ' + arch.getName() + '): ' + e.message);
          }
        }

        if (!pegada) {
          try {
            var mini = arch.getThumbnail();
            if (mini) pegada = _ppdfPegarImagen_(body, mini, anchoMax, altoMax);
          } catch (e) {
            console.error('Miniatura tampoco (' + folioTxt + ' · ' + arch.getName() + '): ' + e.message);
          }
        }

        if (!pegada) {
          fallidos.push(folioTxt + ' · ' + arch.getName() + ' (' + mime + ')');
          body.appendParagraph('Comprobante no se pudo insertar (' + mime + '). Ábrelo en Drive: ' + arch.getName())
            .setFontFamily('Arial').setFontSize(9).setLinkUrl(arch.getUrl())
            .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        }
      }
    });
  }

  var footer = doc.addFooter();
  footer.appendParagraph('Grupo Vizcarra · Sistema de Caja Chica · Generado ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontFamily('Arial').setFontSize(7).setForegroundColor('#aaaaaa')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  return {
    doc: doc,
    fechaTxt: fechaTxt,
    cantidadRenglones: renglones.length,
    fallidos: fallidos
  };
}

function generarPolizaPDFDia(fechaTexto) {
  var r = _ppdfConstruirDocumento_(fechaTexto);
  if (r.error) { Logger.log(r.error); return r.error; }

  var pdfBlob = DriveApp.getFileById(r.doc.getId()).getAs(MimeType.PDF);
  var nombreFinal = 'POLIZA_' + PZ_CAJA + '_' + r.fechaTxt + '.pdf';
  pdfBlob.setName(nombreFinal);

  // Se guarda en la SUBCARPETA DEL MES dentro de la carpeta de pólizas.
  // Si ese día ya tenía PDF, el viejo se manda a la papelera y queda uno
  // solo por día: el más reciente. También se limpia una versión suelta en
  // la raíz, por si quedó de antes de que existieran las subcarpetas.
  var carpeta = _ppdfCarpetaDelMes_(r.fechaTxt);

  var previos = carpeta.getFilesByName(nombreFinal);
  while (previos.hasNext()) previos.next().setTrashed(true);

  try {
    var base = _ppdfCarpetaRaiz_();
    if (base.getId() !== carpeta.getId()) {
      var sueltos = base.getFilesByName(nombreFinal);
      while (sueltos.hasNext()) sueltos.next().setTrashed(true);
    }
  } catch (e) { console.error('Limpieza de PDF suelto: ' + e.message); }

  var archivoFinal = carpeta.createFile(pdfBlob);

  DriveApp.getFileById(r.doc.getId()).setTrashed(true);

  var avisoFallidos = (r.fallidos && r.fallidos.length)
    ? ' [' + r.fallidos.length + ' comprobante(s) van como link, no como foto: ' + r.fallidos.join(' | ') + ']'
    : '';

  var msg = 'PDF generado: ' + nombreFinal + ' (' + r.cantidadRenglones + ' renglón(es)).' +
            avisoFallidos + ' ' + archivoFinal.getUrl();
  Logger.log(msg);
  return msg;
}

/* ===== ¿A qué DÍA de póliza pertenece un folio? =====
   OJO: no es la fecha de comprobación. En el esquema nuevo de CEDIS SAN
   PABLO el egreso se fecha con la Fecha de solicitud, así que un gasto del
   día 8 que se comprueba el día 10 pertenece a la póliza del 8. La pestaña
   oculta POLIZA_FOLIOS es la que amarra día ↔ folio. Solo lee. */
function _ppdfDiaDeFolio_(folio) {
  var buscado = String(folio || '').trim().toUpperCase();
  if (!buscado) return '';

  var cc = SpreadsheetApp.getActiveSpreadsheet();
  var tz = cc.getSpreadsheetTimeZone() || 'America/Mexico_City';
  var hoja = cc.getSheetByName('POLIZA_FOLIOS');
  if (!hoja) return '';

  var last = hoja.getLastRow();
  if (last < 2) return '';

  var datos = hoja.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < datos.length; i++) {
    if (String(datos[i][1] || '').trim().toUpperCase() !== buscado) continue;
    var f = datos[i][0];
    if (f instanceof Date && !isNaN(f.getTime())) return Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  }
  return '';
}

/* ===== PÓLIZA AL CERRAR LA COMPROBACIÓN =====
   La llama registrarComprobacion() (Comprobacion.gs) justo después de bajar
   el egreso al flujo. Reglas:
     - Solo CEDIS SAN PABLO. Las demás cajas no llevan póliza digital.
     - NUNCA truena: la comprobación del gasto no se puede caer por un PDF.
     - El candado decide si ya se puede: si al día le falta algún folio por
       comprobar, no se genera nada. El PDF aparece al cerrar la ÚLTIMA
       comprobación de ese día. */
function generarPolizaPDFTrasComprobacion(sucursal, folio) {
  try {
    var caja = '';
    try { caja = cajaDe_(sucursal) || ''; } catch (e) { caja = ''; }
    if (!caja) caja = String(sucursal || '');

    if (normalizarTexto(caja) !== normalizarTexto(PZ_CAJA)) {
      return '';   // otra caja: no lleva póliza digital, no se hace nada
    }

    // ¿De qué día es este folio? Normalmente POLIZA_FOLIOS ya viene fresca,
    // porque sincronizarEgresoEnVivo_ acaba de correr generarPolizaDiariaCSP().
    // Si no aparece, se refresca UNA vez.
    var dia = _ppdfDiaDeFolio_(folio);
    if (!dia) {
      try { generarPolizaDiariaCSP(); } catch (e) { console.error('POLIZA (hoja): ' + e.message); }
      dia = _ppdfDiaDeFolio_(folio);
    }
    if (!dia) {
      var aviso = 'No encontré a qué día pertenece el folio ' + folio + ' (POLIZA_FOLIOS). No se generó PDF.';
      console.error(aviso);
      return aviso;
    }

    var msg = generarPolizaPDFDia(dia);
    Logger.log('Póliza tras comprobación (' + dia + '): ' + msg);
    return msg;

  } catch (e) {
    console.error('Póliza PDF tras comprobación: ' + e.message);
    return 'Error al generar la póliza: ' + e.message;
  }
}

function previsualizarDisenoPolizaPDF(fechaTexto) {
  var r = _ppdfConstruirDocumento_(fechaTexto);
  if (r.error) { Logger.log(r.error); return r.error; }

  var pdfBlob = DriveApp.getFileById(r.doc.getId()).getAs(MimeType.PDF);
  var nombreFinal = 'PREVIEW_POLIZA_' + PZ_CAJA + '_' + r.fechaTxt + '.pdf';
  pdfBlob.setName(nombreFinal);

  // La vista previa a propósito NO va a la carpeta oficial: es para revisar
  // diseño, no para archivar. Queda en tu Mi unidad.
  var archivoFinal = DriveApp.getRootFolder().createFile(pdfBlob);
  DriveApp.getFileById(r.doc.getId()).setTrashed(true);

  var msg = 'Vista previa lista: ' + archivoFinal.getUrl();
  Logger.log(msg);
  return msg;
}

function generarPolizaPDFRango(desdeTexto, hastaTexto) {
  /* Apps Script corta toda ejecución a los 6 minutos, y cada póliza tarda
     ~1 minuto porque pega las fotos de los comprobantes. Por eso esta
     función:
       1) SALTA los días que ya tienen su PDF (no rehace trabajo), y
       2) se detiene sola a los 4.5 minutos y te dice desde dónde seguir.
     O sea: la corres las veces que haga falta, tal cual, sin cambiarle
     nada, hasta que el resumen diga TERMINADO. */
  var INICIO = new Date().getTime();
  var LIMITE_MS = 4.5 * 60 * 1000;

  var desde = _ppdfParseFecha_(desdeTexto);
  var hasta = _ppdfParseFecha_(hastaTexto);
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Mexico_City';

  var resultados = [];
  var hechos = 0, saltados = 0, bloqueados = 0;
  var pendienteDesde = '';
  var cursor = new Date(desde);

  while (cursor <= hasta) {
    var txt = Utilities.formatDate(cursor, tz, 'yyyy-MM-dd');

    if (new Date().getTime() - INICIO > LIMITE_MS) { pendienteDesde = txt; break; }

    // ¿Ese día ya tiene su PDF en la subcarpeta del mes?
    var nombre = 'POLIZA_' + PZ_CAJA + '_' + txt + '.pdf';
    var yaExiste = false;
    try {
      yaExiste = _ppdfCarpetaDelMes_(txt).getFilesByName(nombre).hasNext();
    } catch (e) { yaExiste = false; }

    if (yaExiste) {
      saltados++;
    } else {
      try {
        var r = generarPolizaPDFDia(txt);
        resultados.push(r);
        if (String(r).indexOf('PDF generado') === 0) hechos++; else bloqueados++;
      } catch (e) {
        resultados.push('Error en ' + txt + ': ' + e.message);
        bloqueados++;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  var resumen = '=== RESUMEN ===\n' +
    'PDFs nuevos: ' + hechos + '\n' +
    'Días que ya tenían PDF (saltados): ' + saltados + '\n' +
    'Días que no se pudieron: ' + bloqueados + '\n' +
    (pendienteDesde
      ? '\n*** SE ACABÓ EL TIEMPO. Vuelve a correr la MISMA función, tal cual: se salta lo ya hecho y sigue desde ' + pendienteDesde + '. ***'
      : '\n*** TERMINADO: se recorrió todo el rango. ***');

  var msg = resultados.join('\n') + '\n\n' + resumen;
  Logger.log(msg);
  return msg;
}

function instalarTriggerPolizaPDFNocturno() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === '_ppdfTriggerNocturno_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('_ppdfTriggerNocturno_')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .nearMinute(45)
    .inTimezone(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Mexico_City')
    .create();
  return 'Disparador nocturno instalado: intentará generar el PDF del día cerca de las 23:45, todos los días (solo si ya todo está comprobado).';
}

function _ppdfTriggerNocturno_() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Mexico_City';
  try {
    Logger.log(generarPolizaDiariaCSP());
  } catch (e) {
    Logger.log('Error refrescando POLIZA antes del PDF: ' + e.message);
  }
  var hoyTxt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  try {
    Logger.log(generarPolizaPDFDia(hoyTxt));
  } catch (e) {
    Logger.log('Error generando PDF nocturno: ' + e.message);
  }
}

function _ejecutarPolizaPDFDia() {
  var resultado = generarPolizaPDFDia('2026-09-10');   // <-- cambia esta fecha
  Logger.log(resultado);
}

function _ejecutarPrevisualizacion() {
  Logger.log(previsualizarDisenoPolizaPDF('2026-09-10'));  // <-- pon el día que quieras ver
}

function _pdfTodoElPeriodo() {
  Logger.log(generarPolizaPDFRango('2026-08-14', '2026-09-10'));
}

/* ==========================================================================
   DÍAS DE PÓLIZA A GENERAR — se maneja igual que BORRAR_LISTA en Borrar.gs
   --------------------------------------------------------------------------
   Escribe abajo los días que quieres, uno por renglón, en formato
   AAAA-MM-DD y entre comillas. Luego:

     1) verPolizasAGenerar()      -> NO genera nada, solo te dice qué pasaría
     2) generarPolizasDeLaLista() -> genera esos PDF

   OJO con el límite de Apps Script: cada póliza tarda cerca de un minuto
   porque pega las fotos de los comprobantes, y Google corta la ejecución a
   los 6 minutos. Pon máximo 4 o 5 días por corrida.

   Si un día ya tenía PDF, se reemplaza por el nuevo (el viejo se va a la
   papelera). Así que esta es también la forma de REHACER la póliza de un
   día: lo pones en la lista y lo corres otra vez.
   ========================================================================== */

var POLIZA_DIAS = [
  '2026-09-26',
];


/* ============ PASO 1: solo mirar ============ */
function verPolizasAGenerar() {
  var cc = SpreadsheetApp.getActiveSpreadsheet();
  var tz = cc.getSpreadsheetTimeZone() || 'America/Mexico_City';

  var txt = 'DÍAS EN LA LISTA: ' + POLIZA_DIAS.length + '\n';
  txt += '============================================================\n\n';

  var poliza = cc.getSheetByName('POLIZA');
  var filasPoliza = [];
  if (poliza && poliza.getLastRow() >= 2) {
    filasPoliza = poliza.getRange(2, 1, poliza.getLastRow() - 1, 7).getValues();
  }

  var hojaFolios = cc.getSheetByName('POLIZA_FOLIOS');
  var filasFolios = [];
  if (hojaFolios && hojaFolios.getLastRow() >= 2) {
    filasFolios = hojaFolios.getRange(2, 1, hojaFolios.getLastRow() - 1, 2).getValues();
  }

  var comprobados = _ppdfMapaComprobados_();

  POLIZA_DIAS.forEach(function (dia) {
    var d = String(dia || '').trim();
    txt += '### ' + d + '\n';

    var reng = filasPoliza.filter(function (f) {
      return (f[0] instanceof Date) && Utilities.formatDate(f[0], tz, 'yyyy-MM-dd') === d;
    });

    if (!reng.length) {
      txt += '    *** No hay renglones de POLIZA para ese día.\n';
      txt += '        O la fecha está mal escrita, o ese día no hubo egresos,\n';
      txt += '        o falta correr generarPolizaDiariaCSP().\n\n';
      return;
    }

    var totalCargo = 0;
    reng.forEach(function (f) { totalCargo += (Number(f[5]) || 0); });

    var folios = [];
    filasFolios.forEach(function (f) {
      if ((f[0] instanceof Date) && Utilities.formatDate(f[0], tz, 'yyyy-MM-dd') === d) {
        var fo = String(f[1] || '').trim();
        if (fo && folios.indexOf(fo) === -1) folios.push(fo);
      }
    });

    var pendientes = folios.filter(function (fo) { return !comprobados[fo]; });

    var nombre = 'POLIZA_' + PZ_CAJA + '_' + d + '.pdf';
    var yaExiste = false;
    try { yaExiste = _ppdfCarpetaDelMes_(d).getFilesByName(nombre).hasNext(); } catch (e) { yaExiste = false; }

    txt += '    Renglones de la póliza  ' + reng.length + '\n';
    txt += '    Total de cargos ....... $' + totalCargo.toLocaleString('es-MX', { minimumFractionDigits: 2 }) + '\n';
    txt += '    Folios de ese día ..... ' + folios.length + (folios.length ? ('  -> ' + folios.join(', ')) : '') + '\n';
    txt += '    ¿Ya existe el PDF? .... ' + (yaExiste ? 'SÍ (se reemplazaría)' : 'no') + '\n';

    if (pendientes.length) {
      txt += '    *** BLOQUEADO: faltan ' + pendientes.length + ' folio(s) por comprobar\n';
      txt += '        -> ' + pendientes.join(', ') + '\n';
    } else {
      txt += '    LISTO para generar\n';
    }
    txt += '\n';
  });

  Logger.log(txt);
  return txt;
}


/* ============ PASO 2: generar ============ */
function generarPolizasDeLaLista() {
  if (!POLIZA_DIAS.length) {
    var vacio = 'La lista POLIZA_DIAS está vacía. Escribe ahí los días que quieres generar.';
    Logger.log(vacio);
    return vacio;
  }

  var res = [];
  POLIZA_DIAS.forEach(function (dia) {
    var d = String(dia || '').trim();
    if (!d) return;
    try {
      res.push(d + ' -> ' + generarPolizaPDFDia(d));
    } catch (e) {
      res.push(d + ' -> *** ERROR: ' + e.message);
    }
  });

  var msg = res.join('\n');
  Logger.log(msg);
  return msg;
}