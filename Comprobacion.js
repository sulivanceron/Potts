
// @ts-nocheck
/**********************************************************************
 * SISTEMA DE CONTROL DE CAJA CHICA — GRUPO VIZCARRA
 * Módulo: COMPROBACIÓN DEL GASTO + AUTORIZACIONES + TESORERÍA
 *
 * REGLA DE ORO DEL FLUJO DE EFECTIVO:
 *   Se autoriza  ->  Omar ENTREGA  ->  hasta entonces es EGRESO y hasta
 *   entonces se puede comprobar. Autorizado sin entregar no mueve dinero.
 *
 * CAMBIOS (10-sept-2026) — todos dentro de registrarComprobacion():
 *   1) VERIFICACIÓN DE ESCRITURA. Después de escribir en el Concentrado se
 *      vuelve a LEER la celda. Si quedó vacía, el formulario lo dice, con
 *      el nombre del archivo y la celda exacta, en vez de reportar
 *      "Comprobación registrada" en falso.
 *   2) PÓLIZA DIGITAL EN PDF. Al cerrar la comprobación se llama a
 *      generarPolizaPDFTrasComprobacion() (PolizaPDF.gs). Solo CEDIS SAN
 *      PABLO, nunca truena, y el PDF sale cuando ya está comprobado todo
 *      el día.
 *   3) MINIATURA. La URL lh3.googleusercontent.com dejó de funcionar y por
 *      eso las miniaturas salían en blanco. Se cambió por una fórmula
 *      =IMAGE(...drive.google.com/thumbnail..., 1), que ajusta la foto al
 *      tamaño de la celda. También se quitó el setRowHeight(45): la fila
 *      ya no crece.
 **********************************************************************/


/* ===== 1) CONFIGURACIÓN ===== */
var CFG = {
 APP_URL: 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec',
  HOJA_CONCENTRADO: 'Concentrado',
  CARPETA_RAIZ_ID: '12nrpNcIkE9Ptrph__nqQvIc4tvuEYW5a',
  TITULO_APP: 'Comprobación del Gasto · Caja Chica Grupo Vizcarra',

  ESTATUS_LISTOS_PARA_COMPROBAR: ['Autorizado'],

  COL_FOLIO:                'Folio',
  COL_SUCURSAL:             'Sucursal',
  COL_COLABORADOR:          'Colaborador',
  COL_TIPO_GASTO:           'Tipo de Gasto',
  COL_CUENTA:               'Cuenta Contable',
  COL_IMPORTE:              'Importe',
  COL_ESTATUS_AUTORIZACION: 'Estatus  Autorizacion',  // ¡OJO! doble espacio, sin acento
  COL_OBSERVACIONES:        'Observaciones',

  COL_FECHA_COMPROBACION: 'Fecha de Comprobacion',
  COL_TIPO_COMPROBANTE:   'Tipo de comprobante',
  COL_NUM_FACTURA:        'Factura No. ',   // ¡OJO! lleva un espacio al final

  COL_IMPORTE_COMPROBADO: 'Importe Comprobado',
  COL_ESTATUS_COMPROB:    'Estatus Comprobación',
  COL_RUTA_EVIDENCIA:     'Ruta Evidencia',
  COL_DIFERENCIA:         'Diferencia',
  COL_MINIATURA:          'Miniatura'
};

var COLUMNAS_NUEVAS = [
  'COL_IMPORTE_COMPROBADO',
  'COL_ESTATUS_COMPROB',
  'COL_RUTA_EVIDENCIA',
  'COL_DIFERENCIA',
  'COL_MINIATURA'
];

/* ===== DOBLE AUTORIZACIÓN POR ÁREA =====
 * Algunas áreas necesitan DOS firmas: primero un validador interno del área
 * y solo después Angel libera. El líder del área es quien SOLICITA; no se
 * autoriza a sí mismo.
 *
 *   Compras      → 1ª Natasha Vizcarra   → 2ª Angel (final)
 *   Diseño       → 1ª Gonzalo Macin      → 2ª Angel (final)
 *   Operaciones  → 1ª Sergio Cordova     → 2ª Angel (final)
 *
 * Las demás áreas siguen con una sola firma (el autorizador del catálogo).
 *
 * MINIMO: importe a partir del cual aplica la doble firma. En 0 aplica
 * SIEMPRE. Si algún día quieres que Operaciones solo pase por Sergio arriba
 * de $1,500, pon MINIMO: 1500 en ese renglón y listo.
 *
 * Las llaves van SIN acentos y en MAYÚSCULAS. OJO: normaliza_() devuelve
 * MINÚSCULAS, por eso al buscar se hace normaliza_(area).toUpperCase()
 * (Diseño → diseno → DISENO). */
var AUTORIZACION = {
  DOBLE: {
    'COMPRAS':     { nombre: 'Natasha Vizcarra', correo: 'natasha.compras@grupovizcarra.mx',      MINIMO: 0 },
    'DISENO':      { nombre: 'Gonzalo Macin',    correo: 'gonzalo@grupovizcarra.mx',              MINIMO: 0 },
    'OPERACIONES': { nombre: 'Sergio Cordova',   correo: 'sergio.operaciones@grupovizcarra.net',  MINIMO: 0 }
  },

  FINAL_NOMBRE:    'Angel',
  FINAL_CORREO:    'angel@grupovizcarra.mx',

  ST_PEND:         'Pendiente de autorizar',
  ST_AUT:          'Autorizado',
  ST_RECH:         'Rechazado',
  COL_AREA:        'Comando gasto',

  // Tesorería y cuentas por pagar: SOLO reciben aviso cuando ANGEL libera.
  OMAR_NOMBRE:     'Omar Monroy',
  OMAR_CORREO:     'tesomargv@gmail.com',
  ERI_NOMBRE:      'Eri',
  ERI_CORREO:      'eri.grupovizcarra@gmail.com',
  COL_ENTREGA:     'Entrega Efectivo',
  COL_CORREO_SOL:  'Correo del Solicitane'   // así está escrito en la hoja
};

/* Devuelve el validador de la 1ª firma para un área e importe, o null si el
 * área solo lleva una firma. */
function primerAutorizador_(area, importe) {
  // normaliza_ regresa minúsculas sin acentos -> se sube a mayúsculas para
  // que coincida con las llaves de la tabla DOBLE.
  var cfg = AUTORIZACION.DOBLE[normaliza_(area).toUpperCase()];
  if (!cfg) return null;
  if (Number(importe || 0) < Number(cfg.MINIMO || 0)) return null;
  return cfg;
}

/* Estatus de la etapa 1. Se construyen con el nombre del área para que los
 * folios de Compras que ya venían en la hoja ('Pendiente autorización Compras'
 * y 'Autorizado por Compras') sigan reconociéndose igual que antes. */
function stPendiente1_(area) { return 'Pendiente autorización ' + area; }
function stAutorizado1_(area) { return 'Autorizado por ' + area; }

/* true si la 1ª firma ya se dio. Se compara en minúsculas porque así
 * devuelve normaliza_. */
function tieneFirma1_(estatus) {
  return normaliza_(estatus).indexOf('autorizado por') === 0;
}


/* ===== 2) PUNTO DE ENTRADA WEB (Web App) ===== */
function doGet(e) {
  var pr = (e && e.parameter) ? e.parameter : {};

  // Acciones desde el correo (?accion=autorizar|rechazar|entregar&folio=CC-...)
  if (pr.accion && pr.folio) {
    if (String(pr.accion).toLowerCase() === 'entregar') return procesarEntregaWeb_(pr.folio);
    return procesarAutorizacionWeb_(pr.accion, pr.folio);
  }

  var page = pr.form ? String(pr.form).toLowerCase() : 'menu';

  if (page === 'solicitud') {
    return HtmlService.createHtmlOutputFromFile('solicitud')
      .setTitle('Solicitud de Caja Chica · Grupo Vizcarra')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  if (page === 'comprobacion') {
    return HtmlService.createHtmlOutputFromFile('comprobacion')
      .setTitle(CFG.TITULO_APP)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  var t = HtmlService.createTemplateFromFile('menu');
  t.appUrl = CFG.APP_URL;
  return t.evaluate()
    .setTitle('Sistema de Caja Chica · Grupo Vizcarra')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}


/* ===== 3) API que consume el formulario de comprobación =====
   Un folio aparece para comprobar SOLO si:
     1) está AUTORIZADO,
     2) Tesorería YA ENTREGÓ el efectivo (columna "Entrega Efectivo"), y
     3) todavía no tiene importe comprobado.
   Si el dinero no ha salido, no hay nada que comprobar. ===== */
function getFoliosParaComprobar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + CFG.HOJA_CONCENTRADO + '".');

  asegurarColumnasComprobacion_(sh);
  var map = mapaColumnas_(sh);
  var datos = sh.getDataRange().getValues();
  var colEnt = map[AUTORIZACION.COL_ENTREGA];
  var out = [];

  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var folio = String(fila[map[CFG.COL_FOLIO]] || '').trim();
    if (!folio) continue;

    var estatus = normaliza_(fila[map[CFG.COL_ESTATUS_AUTORIZACION]]);
    var yaComprobado = String(fila[map[CFG.COL_IMPORTE_COMPROBADO]] || '').trim() !== '';
    var listo = CFG.ESTATUS_LISTOS_PARA_COMPROBAR.map(normaliza_).indexOf(estatus) !== -1;
    var pasa = (CFG.ESTATUS_LISTOS_PARA_COMPROBAR.length === 0) ? true : listo;

    // Si la columna de entrega no existiera, no se bloquea nada (respaldo).
    var entregado = (colEnt == null) ? true : (String(fila[colEnt] || '').trim() !== '');

    if (pasa && entregado && !yaComprobado) {
      out.push({
        folio:       folio,
        sucursal:    String(fila[map[CFG.COL_SUCURSAL]] || ''),
        colaborador: String(fila[map[CFG.COL_COLABORADOR]] || ''),
        concepto:    (map[CFG.COL_TIPO_GASTO] != null) ? String(fila[map[CFG.COL_TIPO_GASTO]] || '') : '',
        importe:     Number(fila[map[CFG.COL_IMPORTE]] || 0)
      });
    }
  }
  return out.reverse();
}


function registrarComprobacion(datos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!datos || !datos.folio) throw new Error('Falta el folio.');
    var importe = Number(datos.importeComprobado);
    if (isNaN(importe) || importe <= 0) throw new Error('El importe comprobado no es válido.');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
    asegurarColumnasComprobacion_(sh);
    var map = mapaColumnas_(sh);

    var valores = sh.getDataRange().getValues();
    var filaIdx = -1;
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][map[CFG.COL_FOLIO]] || '').trim() === String(datos.folio).trim()) {
        filaIdx = i; break;
      }
    }
    if (filaIdx === -1) throw new Error('No se encontró el folio "' + datos.folio + '" en el Concentrado.');

    var fila = valores[filaIdx];
    if (String(fila[map[CFG.COL_IMPORTE_COMPROBADO]] || '').trim() !== '') {
      throw new Error('El folio ' + datos.folio + ' ya fue comprobado anteriormente.');
    }

    var sucursal = String(fila[map[CFG.COL_SUCURSAL]] || 'Sin Sucursal');
    var importeSolicitado = Number(fila[map[CFG.COL_IMPORTE]] || 0);

    // ---- carpeta del folio + evidencia en Drive ----
    var carpeta = obtenerCarpetaFolio_(sucursal, datos.folio);
    var enlaces = [];
    var primeraImagenId = '';   // id de la 1a foto, para la miniatura
    var fechaTxt = formatearFecha_(datos.fecha);
    var lista = (datos.archivos || []);
    lista.forEach(function (a, idx) {
      if (!a || !a.b64) return;
      var ext = extensionDe_(a.nombre);
      var base = limpiaNombre_(datos.folio) + ' - ' + limpiaNombre_(sucursal) + ' - ' + fechaTxt;
      var nombreArch = base + (lista.length > 1 ? ' - ' + (idx + 1) : '') + (ext ? '.' + ext : '');
      var blob = Utilities.newBlob(Utilities.base64Decode(a.b64), a.mime, nombreArch);
      var f = carpeta.createFile(blob);
      enlaces.push(f.getUrl());
      if (!primeraImagenId && String(a.mime || '').indexOf('image/') === 0) {
        primeraImagenId = f.getId();
      }
    });
    var rutaEvidencia = carpeta.getUrl();

    // ---- actualizar el Concentrado ----
    var filaHoja = filaIdx + 1;
    setCelda_(sh, filaHoja, map[CFG.COL_IMPORTE_COMPROBADO], importe);
    setCelda_(sh, filaHoja, map[CFG.COL_FECHA_COMPROBACION], parseFecha_(datos.fecha));
    setCelda_(sh, filaHoja, map[CFG.COL_RUTA_EVIDENCIA], rutaEvidencia);

    // Diferencia = solicitado - comprobado  (positivo = saldo a devolver)
    var diferencia = importeSolicitado - importe;
    setCelda_(sh, filaHoja, map[CFG.COL_DIFERENCIA], diferencia);

    var estatusComp;
    if (Math.abs(diferencia) < 0.005) estatusComp = 'Comprobado total';
    else if (diferencia > 0)          estatusComp = 'Comprobado con devolución';
    else                              estatusComp = 'Comprobado con excedente';
    setCelda_(sh, filaHoja, map[CFG.COL_ESTATUS_COMPROB], estatusComp);

    // Observaciones: se ANEXAN, sin borrar lo del alta.
    if (datos.observaciones && map[CFG.COL_OBSERVACIONES] != null) {
      var prev = String(fila[map[CFG.COL_OBSERVACIONES]] || '').trim();
      var nuevo = prev ? (prev + ' | Comprobación: ' + datos.observaciones) : ('Comprobación: ' + datos.observaciones);
      setCelda_(sh, filaHoja, map[CFG.COL_OBSERVACIONES], nuevo);
    }

    /* ---- VERIFICACIÓN DE ESCRITURA (10-sept-2026) ----
       Se vuelve a LEER la celda que se acabó de escribir. Antes, si la
       escritura no quedaba (hoja protegida, columna corrida, o el script
       apuntando a OTRA copia del archivo), el formulario decía
       "Comprobación registrada" de todos modos y no había forma de saber
       qué pasó. Ahora, si la celda salió vacía, se avisa con el nombre del
       archivo y la celda exacta. */
    SpreadsheetApp.flush();
    var celdaComp = (map[CFG.COL_IMPORTE_COMPROBADO] == null)
      ? null
      : sh.getRange(filaHoja, map[CFG.COL_IMPORTE_COMPROBADO] + 1);
    var leido = celdaComp ? String(celdaComp.getDisplayValue() || '').trim() : '';

    console.log('Comprobación ' + datos.folio + ' -> archivo "' + ss.getName() + '", hoja "' +
                CFG.HOJA_CONCENTRADO + '", celda ' +
                (celdaComp ? celdaComp.getA1Notation() : '(sin columna)') +
                ', leído: "' + leido + '"');

    if (leido === '') {
      return {
        ok: false,
        mensaje: 'La evidencia SÍ se guardó en Drive, pero el importe no quedó escrito en el Concentrado. ' +
                 'Archivo: "' + ss.getName() + '" · hoja: "' + CFG.HOJA_CONCENTRADO + '" · celda: ' +
                 (celdaComp ? celdaComp.getA1Notation() : '(no existe la columna Importe Comprobado)') +
                 '. Manda este mensaje completo a Angel.',
        carpetaUrl: rutaEvidencia,
        archivos: enlaces
      };
    }

    // ---- MINIATURA: la primera foto se ve dentro de la celda ----
    if (primeraImagenId && map[CFG.COL_MINIATURA] != null) {
      try {
        DriveApp.getFileById(primeraImagenId)
          .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var urlImg = 'https://lh3.googleusercontent.com/d/' + primeraImagenId + '=w200';
        var imagen = SpreadsheetApp.newCellImage()
          .setSourceUrl(urlImg)
          .setAltTextTitle('Evidencia ' + datos.folio)
          .build();
        sh.getRange(filaHoja, map[CFG.COL_MINIATURA] + 1).setValue(imagen);
        sh.setRowHeight(filaHoja, 45);
      } catch (e) { console.error('Miniatura falló: ' + e.message); }
    }

    // ---- SINCRONIZACIÓN EN VIVO al archivo de flujo de la caja ----
    try { sincronizarEgresoEnVivo_(sucursal); } catch (e) { console.error(e); }

    /* ---- PÓLIZA DIGITAL EN PDF (10-sept-2026) ----
       Vive en PolizaPDF.gs. Solo CEDIS SAN PABLO, nunca truena, y por su
       candado interno el PDF solo se crea cuando TODOS los folios de ese
       día ya están comprobados: aparece al cerrar la ÚLTIMA comprobación
       del día. Si falta alguno, no pasa nada y no se avisa. */
    var msgPoliza = '';
    try {
      msgPoliza = generarPolizaPDFTrasComprobacion(sucursal, datos.folio) || '';
    } catch (e) {
      console.error('Póliza PDF: ' + e.message);
    }
    var avisoPoliza = (String(msgPoliza).indexOf('PDF generado') === 0)
      ? ' · Póliza del día generada en Drive.'
      : '';

    return {
      ok: true,
      mensaje: 'Comprobación registrada. Estatus: ' + estatusComp +
               (diferencia > 0 ? ' · Devuelto el mismo día: $' + diferencia.toFixed(2)
                 : (diferencia < 0 ? ' · Excedente gastado: $' + Math.abs(diferencia).toFixed(2) : '')) +
               avisoPoliza,
      carpetaUrl: rutaEvidencia,
      archivos: enlaces
    };
  } catch (err) {
    return { ok: false, mensaje: err.message };
  } finally {
    lock.releaseLock();
  }
}


/* ===== 4) HELPERS ===== */
function mapaColumnas_(sh) {
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  for (var c = 0; c < enc.length; c++) { map[String(enc[c]).trim() === '' ? '__vacia_' + c : String(enc[c])] = c; }
  return map;
}

function ultimaColumnaConEncabezado_(sh) {
  var enc = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0];
  var last = 0;
  for (var c = 0; c < enc.length; c++) {
    if (String(enc[c]).trim() !== '') last = c + 1;
  }
  return last;
}

function asegurarColumnasComprobacion_(sh) {
  var map = mapaColumnas_(sh);
  COLUMNAS_NUEVAS.forEach(function (clave) {
    var nombre = CFG[clave];
    if (map[nombre] == null) {
      var col = ultimaColumnaConEncabezado_(sh) + 1;
      sh.getRange(1, col).setValue(nombre).setFontWeight('bold');
      map[nombre] = col - 1;
    }
  });
}

function setCelda_(sh, fila, col0, valor) {
  if (col0 == null) return;
  sh.getRange(fila, col0 + 1).setValue(valor);
}

function obtenerCarpetaFolio_(sucursal, folio) {
  var raiz;
  if (CFG.CARPETA_RAIZ_ID) {
    raiz = DriveApp.getFolderById(CFG.CARPETA_RAIZ_ID);
  } else {
    raiz = obtenerOCrearSubcarpeta_(DriveApp.getRootFolder(), 'COMPROBACIONES');
  }
  var carpSuc = obtenerOCrearSubcarpeta_(raiz, limpiaNombre_(sucursal));
  return obtenerOCrearSubcarpeta_(carpSuc, limpiaNombre_(folio));
}

function obtenerOCrearSubcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function limpiaNombre_(s) {
  return String(s || 'Sin dato').replace(/[\\/:*?"<>|]/g, '-').trim();
}

function normaliza_(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseFecha_(str) {
  if (!str) return new Date();
  var p = String(str).split('-');
  if (p.length === 3) return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return new Date(str);
}

function formatearFecha_(str) {
  var d = parseFecha_(str);
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + dd;
}

function extensionDe_(nombre) {
  var s = String(nombre || '');
  var i = s.lastIndexOf('.');
  return (i > -1) ? s.substring(i + 1).toLowerCase() : '';
}


/* ===== 6) AUTORIZAR / RECHAZAR DESDE EL CORREO (con doble firma) ===== */
function procesarAutorizacionWeb_(accion, folio) {
  var a = String(accion || '').toLowerCase();
  if (a !== 'autorizar' && a !== 'rechazar') return paginaResultado_('Enlace no válido', 'La acción del enlace no es correcta.', '#b3261e');

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
    var map = mapaColumnas_(sh);
    var valores = sh.getDataRange().getValues();

    var fIdx = -1;
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][map[CFG.COL_FOLIO]] || '').trim() === String(folio).trim()) { fIdx = i; break; }
    }
    if (fIdx === -1) return paginaResultado_('Folio no encontrado', 'No se encontró la solicitud ' + folio + '.', '#b3261e');

    var fila = valores[fIdx], filaHoja = fIdx + 1;
    var colEst = map[CFG.COL_ESTATUS_AUTORIZACION];
    var est = String(fila[colEst] || '').trim();
    if (est === AUTORIZACION.ST_AUT || est === AUTORIZACION.ST_RECH) {
      return paginaResultado_('Ya estaba procesada', 'La solicitud ' + folio + ' ya estaba marcada como ' + est + '.', '#0b3d66');
    }

    var fecha = function () { if (map['Fecha de Autorizacion'] != null) setCelda_(sh, filaHoja, map['Fecha de Autorizacion'], new Date()); };
    var area        = (map[AUTORIZACION.COL_AREA] != null) ? String(fila[map[AUTORIZACION.COL_AREA]] || '') : '';
    var sucursal    = String(fila[map[CFG.COL_SUCURSAL]] || '');
    var colaborador = String(fila[map[CFG.COL_COLABORADOR]] || '');
    var tipo        = String(fila[map[CFG.COL_TIPO_GASTO]] || '');
    var concepto    = (map['Descripcion Subconcepto'] != null) ? String(fila[map['Descripcion Subconcepto']] || '') : '';
    var importe     = (map[CFG.COL_IMPORTE] != null) ? Number(fila[map[CFG.COL_IMPORTE]] || 0) : 0;

    var val1 = primerAutorizador_(area, importe);   // validador de 1ª firma (o null)

    // --- RECHAZAR (en cualquier etapa) ---
    if (a === 'rechazar') {
      setCelda_(sh, filaHoja, colEst, AUTORIZACION.ST_RECH); fecha();
      try { enviarResultadoSolicitante_(sh, filaHoja, map, 'Rechazado'); } catch (e) { console.error(e); }
      return paginaResultado_('Solicitud Rechazada', folio + ' fue RECHAZADA. Se notificó al solicitante.', '#b3261e');
    }

    // --- AUTORIZAR: 1ª firma del área (Natasha / Gonzalo / Sergio) → pasa a Angel ---
    if (val1 && !tieneFirma1_(est)) {
      setCelda_(sh, filaHoja, colEst, stAutorizado1_(area)); fecha();
      // Se arrastran los adjuntos y las sucursales del gasto para que Angel
      // vea lo mismo que vio el validador.
      var adj    = (map['Adjuntos Solicitud'] != null) ? String(fila[map['Adjuntos Solicitud']] || '') : '';
      var aplica = (map['Sucursales del Gasto'] != null) ? String(fila[map['Sucursales del Gasto']] || '') : '';
      try {
        enviarCorreoAutorizacion2_(AUTORIZACION.FINAL_CORREO, AUTORIZACION.FINAL_NOMBRE, folio, sucursal, area,
          colaborador, tipo, concepto, importe,
          'Autorización 2 de 2 · Ya la validó ' + val1.nombre + ' (' + area + ').', '', adj, aplica);
      } catch (e) { console.error(e); }
      return paginaResultado_('Validado por ' + area,
        folio + ' fue validada por ' + val1.nombre + '. Se envió a Angel para la liberación final.', '#1f7a3e');
    }

    // --- AUTORIZAR: firma final (Angel) o autorización única ---
    setCelda_(sh, filaHoja, colEst, AUTORIZACION.ST_AUT); fecha();
    try { enviarResultadoSolicitante_(sh, filaHoja, map, 'Autorizado'); } catch (e) { console.error(e); }

    // Tesorería (Omar) y CxP (Eri) SOLO si la liberación final fue de Angel.
    var libero = liberoAngel_(sh, filaHoja, map, area, importe);
    if (libero) {
      try { avisarEntregaOmar_(sh, filaHoja, map, folio); } catch (e) { console.error(e); }
    }
    return paginaResultado_('Solicitud Autorizada',
      folio + ' fue AUTORIZADA. Se notificó al solicitante' +
      (libero ? ' y a Tesorería (Omar y Eri).' : '. Tesorería no fue notificada porque la liberación final no es de Angel.'),
      '#1f7a3e');
  } catch (err) {
    return paginaResultado_('Ocurrió un error', err.message, '#b3261e');
  }
}


/* Correo "pendiente de autorización" con botones, adjuntos y sucursales. */
function enviarCorreoAutorizacion2_(correo, nombre, folio, sucursal, area, colaborador, tipo, concepto, importe, nota, copias, urlAdjuntos, sucursalesAplica) {
  var APP = CFG.APP_URL;
  var urlAut = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec' + '?accion=autorizar&folio=' + encodeURIComponent(folio);
  var urlRec = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec' + '?accion=rechazar&folio=' + encodeURIComponent(folio);
  var importeFmt = Number(importe || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  var notaHtml = nota ? '<p style="background:#fff3e0;border:1px solid #f3d9a6;border-radius:6px;padding:10px 12px;color:#a15c00;font-size:13px;"><strong>' + escaparHtml(nota) + '</strong></p>' : '';

  // La carpeta ya viene compartida con este autorizador, así que el botón
  // abre directo sin pedir permisos.
  var adjHtml = urlAdjuntos
    ? '<p style="margin-top:22px;">' +
        '<a href="' + urlAdjuntos + '" style="background:#12558c;color:#fff;text-decoration:none;' +
        'padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">' +
        '🖼️ Ver cotizaciones y documentos</a>' +
        '<span style="display:block;font-size:12px;color:#666;margin-top:6px;">' +
        'Cotizaciones, órdenes de compra e imágenes que adjuntó el solicitante.</span></p>'
    : '';

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
      '<div style="background:#0b3d66;color:#fff;padding:18px 22px;"><h2 style="margin:0;">Solicitud de Caja Chica</h2>' +
        '<p style="margin:6px 0 0;">Pendiente de autorización</p></div>' +
      '<div style="padding:22px;border:1px solid #d9d9d9;">' + notaHtml +
        '<p>Hola <strong>' + escaparHtml(nombre) + '</strong>,</p>' +
        '<p>Se recibió una solicitud de pago de Caja Chica.</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
          crearFilaCorreo('Folio', folio) +
          crearFilaCorreo('Caja que paga', sucursal) +
          (sucursalesAplica ? crearFilaCorreo('Se aplica a', sucursalesAplica) : '') +
          crearFilaCorreo('Área solicitante', area) + crearFilaCorreo('Colaborador', colaborador) +
          crearFilaCorreo('Tipo de gasto', tipo) + crearFilaCorreo('Concepto', concepto) +
          crearFilaCorreo('Importe solicitado', importeFmt) +
        '</table>' + adjHtml +
        '<p style="margin-top:26px;font-weight:bold;color:#0b3d66;">¿Autorizas esta solicitud?</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="padding-right:12px;"><a href="' + urlAut + '" style="background:#1f7a3e;color:#fff;text-decoration:none;padding:14px 26px;border-radius:6px;display:inline-block;font-weight:bold;">✓ Autorizar</a></td>' +
          '<td><a href="' + urlRec + '" style="background:#b3261e;color:#fff;text-decoration:none;padding:14px 26px;border-radius:6px;display:inline-block;font-weight:bold;">✗ Rechazar</a></td>' +
        '</tr></table>' +
      '</div></div>';

  var op = { to: correo, subject: 'Solicitud de Caja Chica pendiente de autorización | ' + folio,
             htmlBody: html, body: 'Solicitud ' + folio + ' pendiente de autorización.', name: 'Sistema de Caja Chica Vizcarra' };
  if (copias) op.cc = copias;
  MailApp.sendEmail(op);
}


function enviarResultadoSolicitante_(sh, fila, map, estatus) {
  var val = function (nombre) { var c = map[nombre]; return (c == null) ? '' : String(sh.getRange(fila, c + 1).getDisplayValue() || '').trim(); };
  if (val('Correo Enviado') === 'Sí') return;
  var correo = val('Correo del Solicitane');
  if (!correo) return;

  var folio = val('Folio'), sucursal = val('Sucursal'), colaborador = val('Colaborador'),
      tipo = val('Tipo de Gasto'), concepto = val('Descripcion Subconcepto'), obs = val('Observaciones');
  var importe = (map['Importe'] != null) ? (Number(sh.getRange(fila, map['Importe'] + 1).getValue()) || 0) : 0;
  var importeFmt = importe.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
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
          crearFilaCorreo('Folio', folio) + crearFilaCorreo('Sucursal', sucursal) +
          crearFilaCorreo('Tipo de gasto', tipo) + crearFilaCorreo('Concepto', concepto) +
          crearFilaCorreo('Importe', importeFmt) + crearFilaCorreo('Observaciones', obs || 'Sin observaciones') +
        '</table><p style="margin-top:22px;">' + cierre + '</p></div></div>';

  MailApp.sendEmail({ to: correo, subject: 'Solicitud de Caja Chica ' + estatus + ' | ' + folio,
    body: 'Tu solicitud ' + folio + ' fue ' + estatus + '. ' + cierre, htmlBody: html, name: 'Sistema de Caja Chica Vizcarra' });
  if (map['Correo Enviado'] != null) sh.getRange(fila, map['Correo Enviado'] + 1).setValue('Sí');
}


function paginaResultado_(titulo, texto, color) {
  var html =
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f9;">' +
      '<div style="max-width:520px;margin:60px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">' +
        '<div style="background:' + color + ';color:#fff;padding:26px;text-align:center;"><h1 style="margin:0;font-size:22px;">' + escaparHtml(titulo) + '</h1></div>' +
        '<div style="padding:28px;text-align:center;color:#1c2733;font-size:16px;line-height:1.4;">' + escaparHtml(texto) +
          '<p style="margin-top:22px;color:#6b7785;font-size:13px;">Ya puedes cerrar esta ventana.</p></div>' +
      '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Caja Chica · Grupo Vizcarra')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/* ===== AVISO A TESORERÍA (OMAR + ERI) + ENTREGA DE EFECTIVO ===== */

/* ¿La liberación final la dio ANGEL?
 * - Si el área lleva doble firma, la 2ª firma SIEMPRE es de Angel → sí.
 * - Si lleva firma única, se revisa la columna "Autorizo" del renglón.
 * IMPORTANTE: ante la duda, SÍ se avisa. Un aviso de más solo es un correo;
 * un aviso de menos detiene un pago. Solo se bloquea cuando la columna
 * "Autorizo" nombra explícitamente a alguien que NO es Angel. */
function liberoAngel_(sh, fila, map, area, importe) {
  if (primerAutorizador_(area, importe)) return true;
  var c = map['Autorizo'];
  if (c == null) return true;
  var quien = String(sh.getRange(fila, c + 1).getDisplayValue() || '').trim();
  if (!quien) return true;
  return normaliza_(quien).indexOf('angel') >= 0;   // normaliza_ da minúsculas
}

function avisarEntregaOmar_(sh, fila, map, folio) {
  var val = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(fila, c + 1).getDisplayValue() || '').trim(); };
  var importe = (map['Importe'] != null) ? (Number(sh.getRange(fila, map['Importe'] + 1).getValue()) || 0) : 0;
  enviarCorreoEntregaOmar_(folio, val('Sucursal'), val('Comando gasto'), val('Colaborador'), val('Tipo de Gasto'), val('Descripcion Subconcepto'), importe);
}

function enviarCorreoEntregaOmar_(folio, sucursal, area, colaborador, tipo, concepto, importe) {
  var APP = CFG.APP_URL;
  var urlEnt = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec' + '?accion=entregar&folio=' + encodeURIComponent(folio);
  var importeFmt = Number(importe || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
      '<div style="background:#1f7a3e;color:#fff;padding:18px 22px;"><h2 style="margin:0;">Efectivo autorizado</h2>' +
        '<p style="margin:6px 0 0;">Listo para entregar · ' + escaparHtml(folio) + '</p></div>' +
      '<div style="padding:22px;border:1px solid #d9d9d9;">' +
        '<p>Hola <strong>' + escaparHtml(AUTORIZACION.OMAR_NOMBRE) + '</strong>,</p>' +
        '<p>Esta solicitud ya fue <strong>AUTORIZADA</strong> y está lista para que entregues el efectivo.</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
          crearFilaCorreo('Folio', folio) + crearFilaCorreo('Sucursal', sucursal) +
          crearFilaCorreo('Área', area) + crearFilaCorreo('Colaborador', colaborador) +
          crearFilaCorreo('Tipo de gasto', tipo) + crearFilaCorreo('Concepto', concepto) +
          crearFilaCorreo('Importe a entregar', importeFmt) +
        '</table>' +
        '<p style="margin-top:26px;">' +
          '<a href="' + urlEnt + '" style="background:#1f7a3e;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;display:inline-block;font-weight:bold;font-size:15px;">💵 Entregar efectivo</a>' +
        '</p>' +
        '<p style="font-size:12px;color:#666;margin-top:16px;">Al dar clic, el sistema registra la entrega, la baja como egreso en la caja y le recuerda al líder que compruebe hoy.</p>' +
      '</div></div>';
    /* ===== INTERRUPTORES DE CORREO A TESORERIA =====
     true  = sí recibe el aviso
     false = no recibe nada

     Si apagas a Omar, él registra la entrega desde el menú
     "🍩 Caja Chica -> Pendientes de entrega". El flujo es idéntico.
     Para volver a prenderlos, cambia false por true.              */
  var AVISAR_OMAR = false;
  var AVISAR_ERI  = false;

  if (!AVISAR_OMAR && !AVISAR_ERI) return;   // nadie recibe: no se manda nada

  var opciones = {
    to: AVISAR_OMAR ? AUTORIZACION.OMAR_CORREO : AUTORIZACION.ERI_CORREO,
    subject: 'Efectivo autorizado — listo para entregar | ' + folio,
    htmlBody: html,
    body: 'Solicitud ' + folio + ' autorizada, lista para entregar el efectivo.',
    name: 'Sistema de Caja Chica Vizcarra'
  };
  if (AVISAR_OMAR && AVISAR_ERI) opciones.cc = AUTORIZACION.ERI_CORREO;

  MailApp.sendEmail(opciones);
}


/* ===== RECORDATORIO DE COMPROBACIÓN =====
 * Se dispara en el momento en que Omar da clic en "Entregar efectivo".
 * Le pide al líder solicitante que suba la comprobación EL MISMO DÍA. */
function recordarComprobacionLider_(sh, fila, map, folio) {
  var val = function (n) { var c = map[n]; return (c == null) ? '' : String(sh.getRange(fila, c + 1).getDisplayValue() || '').trim(); };
  var correo = val(AUTORIZACION.COL_CORREO_SOL);
  if (!correo) return 'sin correo del solicitante';

  var importe = (map[CFG.COL_IMPORTE] != null) ? (Number(sh.getRange(fila, map[CFG.COL_IMPORTE] + 1).getValue()) || 0) : 0;
  var importeFmt = Number(importe).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  var urlComp = 'https://script.google.com/macros/s/AKfycbwz6U99B1fsJw-Kw7zMjlqzfXMQZ5tveq6GEj1gZk_eJc-bihYB4EJx3sHReUD9zPPF/exec' + '?form=comprobacion';

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;color:#222;">' +
      '<div style="background:#f4a300;color:#3a2a00;padding:18px 22px;">' +
        '<h2 style="margin:0;">Efectivo entregado — comprueba hoy</h2>' +
        '<p style="margin:6px 0 0;">' + escaparHtml(folio) + '</p></div>' +
      '<div style="padding:22px;border:1px solid #d9d9d9;">' +
        '<p>Hola,</p>' +
        '<p>Tesorería ya entregó el efectivo de esta solicitud. Para cerrarla, ' +
        '<strong>sube la comprobación hoy mismo</strong> con la foto del comprobante.</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
          crearFilaCorreo('Folio', folio) +
          crearFilaCorreo('Sucursal', val(CFG.COL_SUCURSAL)) +
          crearFilaCorreo('Colaborador', val(CFG.COL_COLABORADOR)) +
          crearFilaCorreo('Tipo de gasto', val(CFG.COL_TIPO_GASTO)) +
          crearFilaCorreo('Importe entregado', importeFmt) +
        '</table>' +
        '<p style="margin-top:26px;">' +
          '<a href="' + urlComp + '" style="background:#0b3d66;color:#fff;text-decoration:none;' +
          'padding:14px 28px;border-radius:6px;display:inline-block;font-weight:bold;font-size:15px;">' +
          '📎 Subir comprobación</a>' +
        '</p>' +
        '<p style="font-size:12px;color:#666;margin-top:16px;">' +
          'Necesitas el folio ' + escaparHtml(folio) + ', el importe real gastado y la foto del ticket o factura.' +
        '</p>' +
      '</div></div>';

  MailApp.sendEmail({
    to: correo,
    subject: 'Comprueba hoy el gasto | ' + folio,
    htmlBody: html,
    body: 'Ya se entregó el efectivo de ' + folio + '. Sube la comprobación hoy mismo: ' + urlComp,
    name: 'Sistema de Caja Chica Vizcarra'
  });
  return correo;
}


/* ===== ENTREGA DEL EFECTIVO =====
 * Este es el momento en que el dinero SALE de la caja. Aquí se registra la
 * entrega, se baja el egreso al archivo de flujo de la caja (en vivo) y se
 * le recuerda al líder que compruebe hoy mismo. ===== */
function procesarEntregaWeb_(folio) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
    var map = mapaColumnas_(sh);
    var v = sh.getDataRange().getValues();
    var fi = -1;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][map[CFG.COL_FOLIO]] || '').trim() === String(folio).trim()) { fi = i; break; }
    }
    if (fi === -1) return paginaResultado_('Folio no encontrado', 'No se encontró la solicitud ' + folio + '.', '#b3261e');

    var filaHoja = fi + 1;
    var sucursal = String(v[fi][map[CFG.COL_SUCURSAL]] || '');
    var colEnt = ensureCol_(sh, AUTORIZACION.COL_ENTREGA);
    var actual = String(sh.getRange(filaHoja, colEnt + 1).getDisplayValue() || '').trim();
    if (actual) return paginaResultado_('Ya estaba entregado', folio + ' ya estaba registrado: ' + actual + '.', '#0b3d66');

    var tz = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';
    var fechaTxt = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
    setCelda_(sh, filaHoja, colEnt, 'Entregado ' + fechaTxt);

    // El dinero ya salió: se baja el egreso a la caja en este momento.
    var msgEgreso = '';
    try {
      sincronizarEgresoEnVivo_(sucursal);
      msgEgreso = ' El egreso ya quedó registrado en el flujo de ' + sucursal + '.';
    } catch (e) {
      console.error('Egreso en vivo: ' + e.message);
      msgEgreso = ' (El egreso se registrará en la siguiente sincronización automática.)';
    }

    // Recordatorio inmediato al líder: que compruebe HOY MISMO.
    var aviso = '';
    try {
      var dest = recordarComprobacionLider_(sh, filaHoja, map, folio);
      aviso = (dest && dest.indexOf('@') > 0)
        ? ' Se envió recordatorio de comprobación a ' + dest + '.'
        : ' No se pudo enviar el recordatorio: la solicitud no trae correo del solicitante.';
    } catch (e) {
      console.error(e);
      aviso = ' El recordatorio de comprobación no salió: ' + e.message;
    }

    return paginaResultado_('Efectivo entregado',
      folio + ' quedó registrado como ENTREGADO (' + fechaTxt + ').' + msgEgreso + aviso, '#1f7a3e');
  } catch (err) {
    return paginaResultado_('Ocurrió un error', err.message, '#b3261e');
  }
}


// Devuelve la columna (0-based) de un encabezado; la crea al final si no existe.
function ensureCol_(sh, nombre) {
  var map = mapaColumnas_(sh);
  if (map[nombre] != null) return map[nombre];
  var col = ultimaColumnaConEncabezado_(sh) + 1;
  sh.getRange(1, col).setValue(nombre).setFontWeight('bold');
  return col - 1;
}


/* ===== 7) UTILIDAD OPCIONAL ===== */
function _test_listarFolios() {
  Logger.log(JSON.stringify(getFoliosParaComprobar(), null, 2));
}
/* ===== DIAGNÓSTICO: folios sin "Entrega Efectivo" (solo lee) =====
   Separa los que YA están comprobados (esos sí se entregaron, seguro) de
   los que no, que son los dudosos. ===== */
function diagnosticoEntregasFaltantes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var colEnt = map[AUTORIZACION.COL_ENTREGA];
  if (colEnt == null) return 'No existe la columna "' + AUTORIZACION.COL_ENTREGA + '".';

  var datos = sh.getDataRange().getValues();
  var comprobadosSinEntrega = [], pendientesSinEntrega = [];

  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    var folio = String(f[map[CFG.COL_FOLIO]] || '').trim();
    if (!folio) continue;

    var est = normaliza_(f[map[CFG.COL_ESTATUS_AUTORIZACION]]);
    if (est !== normaliza_('Autorizado')) continue;              // solo autorizados
    if (String(f[colEnt] || '').trim() !== '') continue;          // ya tiene entrega

    var imp = Number(f[map[CFG.COL_IMPORTE]] || 0);
    var comp = String(f[map[CFG.COL_IMPORTE_COMPROBADO]] || '').trim();
    var linea = folio + ' · ' + String(f[map[CFG.COL_SUCURSAL]] || '') +
                ' · ' + String(f[map[CFG.COL_COLABORADOR]] || '') +
                ' · $' + imp.toFixed(2);

    if (comp !== '') comprobadosSinEntrega.push(linea);
    else pendientesSinEntrega.push(linea);
  }

  var msg =
    '=== YA COMPROBADOS PERO SIN FECHA DE ENTREGA (' + comprobadosSinEntrega.length + ') ===\n' +
    'Estos SÍ se entregaron (por eso se comprobaron). Se pueden marcar en automático.\n' +
    (comprobadosSinEntrega.join('\n') || '(ninguno)') +
    '\n\n=== SIN COMPROBAR Y SIN ENTREGA (' + pendientesSinEntrega.length + ') ===\n' +
    'Estos hay que revisarlos con Omar: no se sabe si ya pagó o sigue pendiente.\n' +
    (pendientesSinEntrega.join('\n') || '(ninguno)');

  Logger.log(msg);
  return msg;
}


/* ===== ARREGLO RETROACTIVO: marca como entregados los folios que ya
   están comprobados pero no tienen fecha de entrega. Correr una vez. ===== */
function marcarEntregadosLosYaComprobados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CFG.HOJA_CONCENTRADO);
  var map = mapaColumnas_(sh);
  var colEnt = ensureCol_(sh, AUTORIZACION.COL_ENTREGA);
  var tz = ss.getSpreadsheetTimeZone() || 'America/Mexico_City';

  var datos = sh.getDataRange().getValues();
  var hechos = [];

  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    var folio = String(f[map[CFG.COL_FOLIO]] || '').trim();
    if (!folio) continue;

    var est = normaliza_(f[map[CFG.COL_ESTATUS_AUTORIZACION]]);
    if (est !== normaliza_('Autorizado')) continue;
    if (String(f[colEnt] || '').trim() !== '') continue;
    if (String(f[map[CFG.COL_IMPORTE_COMPROBADO]] || '').trim() === '') continue;  // solo comprobados

    // Se usa la fecha de comprobación como fecha de entrega (es lo más cercano
    // a la realidad: el dinero salió a más tardar ese día).
    var fc = f[map[CFG.COL_FECHA_COMPROBACION]];
    var txt = (fc instanceof Date)
      ? Utilities.formatDate(fc, tz, 'dd/MM/yyyy')
      : String(fc || '').trim();

    setCelda_(sh, i + 1, colEnt, 'Entregado ' + (txt || 's/f') + ' (registro retroactivo)');
    hechos.push(folio + ' → ' + (txt || 'sin fecha'));
  }

  var msg = hechos.length
    ? 'MARCADOS COMO ENTREGADOS (' + hechos.length + '):\n' + hechos.join('\n')
    : 'No había folios comprobados sin fecha de entrega.';
  Logger.log(msg);
  return msg;
}