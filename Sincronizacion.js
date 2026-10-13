/**********************************************************************
 * SISTEMA DE CONTROL DE CAJA CHICA — GRUPO VIZCARRA
 * Sincronizacion.gs  ·  PARTE 1 de 2
 * (la PARTE 2 vive en el archivo Sincronizacion2.gs)
 *
 * MODELO DE DOS DIMENSIONES:
 *   1) CAJA QUE PAGA (columna "Sucursal") -> tesorería. Define en qué
 *      archivo de flujo baja el egreso. Es un hecho de efectivo.
 *   2) SUCURSAL DEL GASTO ("Sucursales del Gasto") -> contabilidad.
 *      Define a quién se le carga el costo. NO mueve el egreso de caja.
 *
 * REGLA DEL EGRESO: en las cajas del esquema nuevo, el gasto baja a EGRESOS
 * SOLO cuando Tesorería ya entregó el efectivo, y SOLO si su fecha es
 * igual o posterior al INICIO DE OPERACIÓN.
 * Reutiliza normalizarTexto() de Código.gs.
 **********************************************************************/

/**********************************************************************
 * CAMBIO 30-sept-2026 — SE DEJÓ DE CORTAR A MEDIAS POR FALTA DE TIEMPO
 *
 * SÍNTOMA: el flujo de CEDIS SAN PABLO se quedó parado en la fila 1055
 * y los movimientos nuevos ya no bajaban. No marcaba error en la hoja.
 *
 * CAUSA: esta función actualizaba EGRESOS **celda por celda**:
 *
 *     actualizaciones.forEach(function (u) {
 *       Object.keys(u.reg).forEach(function (nombre) {
 *         eg.getRange(u.fila, c).setValue(u.reg[nombre]);   // <- una por celda
 *       });
 *     });
 *
 * En el esquema nuevo TODOS los folios que ya están en EGRESOS entran a
 * "actualizaciones" en cada corrida. Con ~1,050 filas x ~15 columnas eso
 * son más de 15,000 escrituras sueltas, cada una un viaje al archivo.
 * Apps Script corta a los 6 minutos, así que la corrida moría a la mitad
 * y las filas nuevas nunca se escribían. Antes no se notaba porque había
 * 300 filas; a las 1,050 ya no daba.
 *
 * QUÉ SE HIZO:
 *   1) Las actualizaciones ahora se agrupan POR COLUMNA: una sola
 *      escritura por columna en vez de una por celda. De 15,000 llamadas
 *      se baja a ~15. No toca la columna COMPROBANTE, así que las fotos
 *      incrustadas se quedan donde están.
 *   2) El borrado de filas que ya no califican se hace por BLOQUES
 *      contiguos (deleteRows) en vez de una por una (deleteRow).
 *   3) La pestaña Catálogos se lee UNA sola vez por ejecución y se guarda
 *      en memoria. Antes se releía 2 veces por caja: con 15 cajas y 3,119
 *      cuentas eran ~930,000 celdas leídas de más en cada corrida.
 *   4) cajaDe_() recuerda lo que ya resolvió, en vez de recorrer la tabla
 *      de ruteo por cada fila del catálogo.
 *   5) Si a la hoja se le acaban las filas, ahora se le agregan antes de
 *      escribir (asegurarFilas_). Antes eso tronaba con "out of bounds".
 *   6) CONCEPTO y TIPO tienen plan B: si la cuenta ya no existe en la
 *      pestaña Catálogos (las viejas 870, 874, 100-3, 895...), se busca
 *      en la pestaña MAPA_CUENTAS del Concentrado. Así las filas
 *      históricas dejan de quedarse en blanco al resincronizar.
 *      Si no existe esa pestaña, todo sigue funcionando igual que antes.
 *
 * NO se cambió NINGUNA regla de negocio: mismos filtros, mismas fechas,
 * mismas columnas, mismo INICIO DE OPERACIÓN.
 **********************************************************************/

/**********************************************************************
 * CAMBIO 09-sept-2026 — el DASHBOARD ya no se pinta por script
 *
 * El apagado se hizo DENTRO de Desgloses.gs, que es donde vive
 * actualizarDesglosesDashboardCSP(): ahí se quitó la escritura del
 * bloque A24:I90 del DASHBOARD, que borraba los seis cuadros junto con
 * su formato y sus títulos combinados cada vez que corría. Esos seis
 * cuadros ahora se calculan con fórmulas propias en la hoja.
 *
 * CORRECCIÓN (segunda pasada): las dos llamadas a esa función VUELVEN
 * a estar activas aquí. En la primera pasada se habían quitado, y eso
 * era un error: esa misma función es la que llena las columnas ÁREA y
 * SUCURSAL DEL GASTO en EGRESOS, y de esas dos columnas leen dos de los
 * seis cuadros. Sin llamarla, esas columnas dejaban de llenarse en los
 * movimientos nuevos y los cuadros se habrían ido vaciando sin avisar.
 * Ahora que ya no pinta nada, llamarla es inofensivo y necesario.
 **********************************************************************/

/**********************************************************************
 * CAMBIO 11-sept-2026 — SE REGRESA A LA IMAGEN INCRUSTADA
 *
 * El 10 de septiembre se había cambiado la miniatura del comprobante a
 * una fórmula =IMAGE("https://drive.google.com/thumbnail?id=...", 1).
 * Fue un error y estas son las dos razones:
 *
 *   1) El Concentrado tiene la configuración regional en ESPAÑA, donde el
 *      separador de argumentos de las funciones es punto y coma, no coma.
 *      Esa coma del ", 1" convertía la fórmula en #ERROR! en todas las
 *      celdas nuevas. Las miniaturas viejas seguían viéndose porque no
 *      eran fórmulas, sino imágenes incrustadas.
 *   2) La imagen incrustada (newCellImage) llevaba años funcionando bien
 *      y no depende de la configuración regional del archivo.
 *
 * Entonces los DOS lugares que escriben la foto vuelven a newCellImage:
 *   - el bloque de COMPROBANTE en sincronizarEgresosCaja_ (flujo de caja)
 *   - rellenarMiniaturasFaltantes() (Concentrado)
 *
 * DIFERENCIA IMPORTANTE ENTRE LOS DOS:
 *   - En el FLUJO (EGRESOS) ya NO se toca el alto de la fila. No hay
 *     ningún setRowHeight: la foto se acomoda dentro de la celda con la
 *     altura que la fila ya tenga.
 *   - En el CONCENTRADO sí se conserva el setRowHeight(fila, 45) de
 *     siempre, porque así ha venido funcionando esa hoja.
 *
 * NO se tocó nada más: RESUMEN DIARIO (generarResumenDiarioCedisSanPablo)
 * y la PÓLIZA (generarPolizaDiariaCSP) siguen corriendo igual que antes.
 **********************************************************************/

var SYNC = {
  CENTRAL_CONCENTRADO: 'Concentrado',
  HOJA_CAJAS: 'CAJAS',
  HOJA_MAPA: 'MAPA_CUENTAS',
  PLANTILLA_ID: '1rp75ENojGKFXnJK4lvD2CFhnoI8eOIgwVc-2n4ixEcc',

  C_FOLIO:'Folio', C_SUCURSAL:'Sucursal', C_CUENTA:'Cuenta Contable',
  C_SUBCONCEPTO:'Descripcion Subconcepto', C_FECHA_SOL:'Fecha solicitud',
  C_FECHA_COMP:'Fecha de Comprobacion',
  C_IMPORTE:'Importe', C_IMPORTE_COMP:'Importe Comprobado', C_RUTA:'Ruta Evidencia',
  C_ESTATUS_AUT: 'Estatus  Autorizacion',
  C_AREA: 'Comando gasto',
  C_ENTREGA: 'Entrega Efectivo',
  C_APLICA: 'Sucursales del Gasto',

  EG_HEADER_ROW: 4,
  EG_FOLIO:'Folio', EG_FECHA:'FECHA', EG_ANIO:'AÑO', EG_MES:'MES',
  EG_SELECC:'SELECCIONA EL GASTO', EG_CUENTA:'CUENTA', EG_CONCEPTO:'CONCEPTO',
  EG_TIPO:'TIPO', EG_DETALLE:'DETALLE',
  EG_MONTO:'MONTO',
  EG_MONTO_AUTORIZADO:'MONTO AUTORIZADO',
  EG_MONTO_COMPROBADO:'MONTO COMPROBADO',
  EG_RUTA:'RUTA DEL COMPROBANTE', EG_COMPROBANTE:'COMPROBANTE',
  EG_AREA:'ÁREA',
  EG_SUC_GASTO:'SUCURSAL DEL GASTO',

  CAT_HEADER_ROW: 3
};

var PILOTO_ESQUEMA_NUEVO = ['CEDIS SAN PABLO'];

function usaEsquemaNuevo_(caja) {
  return PILOTO_ESQUEMA_NUEVO.some(function (c) { return normalizarTexto(c) === normalizarTexto(caja); });
}

var MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/* ===== INICIO DE OPERACIÓN REAL =====
   Todo lo anterior a esta fecha fueron pruebas y NO se contabiliza:
   no baja a EGRESOS, así que tampoco aparece en el RESUMEN DIARIO
   ni en el DASHBOARD. Para mover el arranque, cambia solo esta fecha.
   OJO: el mes va de 0 a 11 aquí (7 = agosto).                         */
var INICIO_OPERACION = new Date(2026, 7, 14, 12, 0, 0);   // 14 de agosto de 2026

/* true si la fecha es ANTERIOR al inicio de operación (compara solo el día) */
function antesDeOperacion_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var b = new Date(INICIO_OPERACION.getFullYear(),
                   INICIO_OPERACION.getMonth(),
                   INICIO_OPERACION.getDate()).getTime();
  return a < b;
}

var CAJAS = [
  'GUADALAJARA','PUEBLA','SAN PABLO UNO','SAN PABLO DOS','SOTANO',
  'CORREO UNO','CORREO DOS','RAMON CORONA UNO','RAMON CORONA DOS','BOLIVIA',
  'BRASIL UNO','CORREGIDORA','APARTADO UNO','APARTADO DOS','CEDIS SAN PABLO'
];

var RUTA_CAJA = {
  'HAMBURGO':'CEDIS SAN PABLO',
  'PUEBLO ALFREDO':'CEDIS SAN PABLO',
  'PLATA 14':'CEDIS SAN PABLO',
  'PLATA':'CEDIS SAN PABLO',
  'CASTILLO':'CEDIS SAN PABLO',
  'CEDIS TEXCOCO':'CEDIS SAN PABLO',
  'OUTLET':'CEDIS SAN PABLO',
  'ECOMMERCE':'CEDIS SAN PABLO',
  'ALFREDO VIZCARRA':'CEDIS SAN PABLO',
  'ALFREDO':'CEDIS SAN PABLO',
  'EDITH HUERTA VARGAS':'CEDIS SAN PABLO',
  'NATASHA VIZCARRA':'CEDIS SAN PABLO',
  'ALFREDO JR. VIZCARRA':'CEDIS SAN PABLO',
  'SURI AILEEN VIZCARRA':'CEDIS SAN PABLO',
  'FERNANDA VIZCARRA':'CEDIS SAN PABLO',
  'APOYOS A FAMILIA':'CEDIS SAN PABLO',
  'CASA FAMILIAR':'CEDIS SAN PABLO'
};


/* ============================================================
 *  MEMORIA DE UNA SOLA EJECUCIÓN
 *  Estas tres variables viven mientras dura la corrida y se
 *  vacían al empezar la siguiente. Sirven para no releer la
 *  pestaña Catálogos una y otra vez.
 * ============================================================ */
var _CACHE_CATALOGO = null;
var _CACHE_MAPA     = null;
var _CACHE_CAJA     = {};

function limpiarCacheSync_() {
  _CACHE_CATALOGO = null;
  _CACHE_MAPA     = null;
  _CACHE_CAJA     = {};
}


/* ===== Ruteo: dado el nombre de la sucursal, devuelve la caja que paga =====
   Recuerda lo que ya resolvió: el catálogo trae miles de filas y antes se
   recorría la tabla de ruteo completa por cada una. */
function cajaDe_(sucursal) {
  var s = normalizarTexto(sucursal);
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(_CACHE_CAJA, s)) return _CACHE_CAJA[s];

  var res = null;
  var keys = Object.keys(RUTA_CAJA);
  for (var i = 0; i < keys.length && res === null; i++) {
    if (normalizarTexto(keys[i]) === s) res = RUTA_CAJA[keys[i]];
  }
  for (var j = 0; j < CAJAS.length && res === null; j++) {
    if (normalizarTexto(CAJAS[j]) === s) res = CAJAS[j];
  }

  _CACHE_CAJA[s] = res;
  return res;
}

/* ===== Lee la hoja CAJAS del master ===== */
function mapaCajas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC.HOJA_CAJAS);
  var m = {};
  if (!sh) return m;
  var last = sh.getLastRow();
  if (last < 2) return m;
  var datos = sh.getRange(2, 1, last - 1, 2).getValues();
  datos.forEach(function (r) {
    var n = String(r[0] || '').trim();
    var id = String(r[1] || '').trim();
    if (n && id) m[normalizarTexto(n)] = id;
  });
  return m;
}

function fileIdDeCaja_(caja) {
  return mapaCajas_()[normalizarTexto(caja)] || null;
}

/* ===== Le agrega filas a una hoja si se le van a acabar =====
   Sin esto, escribir más abajo de la última fila de la hoja truena con
   "The coordinates or dimensions of the range are invalid". */
function asegurarFilas_(hoja, filaFinal) {
  var max = hoja.getMaxRows();
  if (filaFinal <= max) return;
  hoja.insertRowsAfter(max, (filaFinal - max) + 100);
}


/* ===== 1) GENERADOR: crea el archivo de cada caja que falte ===== */
function crearCajasFaltantes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SYNC.HOJA_CAJAS);
  if (!sh) {
    sh = ss.insertSheet(SYNC.HOJA_CAJAS);
    sh.getRange(1, 1, 1, 3).setValues([['Caja', 'FileID', 'URL']]).setFontWeight('bold');
  }
  var mapa = mapaCajas_();
  var creadas = [], saltadas = [];

  CAJAS.forEach(function (caja) {
    var cajaN = normalizarTexto(caja);
    if (mapa[cajaN]) { saltadas.push(caja); return; }

    if (cajaN === normalizarTexto('GUADALAJARA')) {
      registrarCaja_(sh, caja, SYNC.PLANTILLA_ID);
      saltadas.push(caja + ' (ya existía)');
      return;
    }

    var copia = DriveApp.getFileById(SYNC.PLANTILLA_ID).makeCopy('FLUJO_EFECTIVO_' + caja);
    var id = copia.getId();
    var ext = SpreadsheetApp.openById(id);

    var eg = ext.getSheetByName('EGRESOS');
    if (eg) {
      var lastE = eg.getLastRow();
      if (lastE >= SYNC.EG_HEADER_ROW + 1) {
        eg.getRange(SYNC.EG_HEADER_ROW + 1, 1, lastE - SYNC.EG_HEADER_ROW, eg.getLastColumn()).clearContent();
      }
      try { eg.getRange(1, 1).setValue('REGISTRO DE EGRESOS EN EFECTIVO — ' + caja); } catch (e) {}
    }
    var cat = ext.getSheetByName('CATALOGO');
    if (cat) {
      var lastC = cat.getLastRow();
      if (lastC >= SYNC.CAT_HEADER_ROW + 1) {
        cat.getRange(SYNC.CAT_HEADER_ROW + 1, 1, lastC - SYNC.CAT_HEADER_ROW, 6).clearContent();
      }
    }

    registrarCaja_(sh, caja, id);
    creadas.push(caja);
  });

  var msg = 'Cajas creadas: ' + creadas.length + ' [' + creadas.join(', ') + ']\n' +
            'Ya existían: ' + saltadas.length + ' [' + saltadas.join(', ') + ']';
  Logger.log(msg);
  return msg;
}

function registrarCaja_(sh, caja, id) {
  sh.appendRow([caja, id, 'https://docs.google.com/spreadsheets/d/' + id + '/edit']);
}


/* ===== 2) SINCRONIZAR TODO ===== */
function sincronizarTodo() {
  limpiarCacheSync_();                 // catálogo fresco al arrancar
  var arranque = new Date().getTime();

  var mapa = mapaCajas_();
  var res = [];
  CAJAS.forEach(function (caja) {
    var id = mapa[normalizarTexto(caja)];
    if (!id) { res.push(caja + ': (sin archivo, corre crearCajasFaltantes)'); return; }
    var nCat = 0, nEgr = 0;
    try { nCat = sincronizarCatalogoCaja_(caja, id); } catch (e) { console.error(caja + ' catálogo: ' + e.message); }
    try { nEgr = sincronizarEgresosCaja_(caja, id); } catch (e) { console.error(caja + ' egresos: ' + e.message); }
    res.push(caja + ': catálogo ' + nCat + ' | egresos ' + nEgr);
  });

  try {
    res.push('RESUMEN DIARIO: ' + generarResumenDiarioCedisSanPablo());
  } catch (e) {
    console.error('RESUMEN DIARIO: ' + e.message);
    res.push('RESUMEN DIARIO: *** ERROR: ' + e.message + ' ***');
  }

  // Se vuelve a llamar, pero ya NO pinta el dashboard: esa parte se
  // apagó dentro de Desgloses.gs. Lo que sigue haciendo, y por eso hay
  // que llamarla, es llenar las columnas ÁREA y SUCURSAL DEL GASTO en
  // EGRESOS —de ahí leen dos de los seis cuadros— y alimentar la hoja
  // oculta DATOS GRAFICAS.
  try {
    res.push('COLUMNAS Y GRÁFICAS: ' + actualizarDesglosesDashboardCSP());
  } catch (e) {
    console.error('COLUMNAS Y GRÁFICAS: ' + e.message);
    res.push('COLUMNAS Y GRÁFICAS: *** ERROR: ' + e.message + ' ***');
  }

  var seg = Math.round((new Date().getTime() - arranque) / 1000);
  res.push('');
  res.push('Tardó ' + seg + ' segundos. (El límite de Apps Script son 360.)');
  if (seg > 240) res.push('*** OJO: se está acercando al límite. Avísame. ***');

  var msg = res.join('\n');
  Logger.log(msg);
  return msg;
}



/* ===== ACTIVADOR AUTOMÁTICO: correr UNA SOLA VEZ =====
   Ahora es solo RED DE SEGURIDAD (cada hora). Lo rápido — que se
   actualice al instante cuando entregan efectivo o suben una
   comprobación — lo hace sincronizarEgresoEnVivo_() de abajo. ===== */
function instalarSincronizacionAutomatica() {
  var triggers = ScriptApp.getProjectTriggers();
  var quitados = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarTodo') { ScriptApp.deleteTrigger(t); quitados++; }
  });

  ScriptApp.newTrigger('sincronizarTodo').timeBased().everyHours(1).create();

  var msg = 'Listo: sincronizarTodo() corre como red de seguridad cada 1 hora (lo inmediato ya lo hace el enganche en vivo). ' +
            (quitados ? ('Se reemplazó ' + quitados + ' activador anterior.') : 'Activador nuevo, no había ninguno antes.');
  Logger.log(msg);
  return msg;
}

function quitarSincronizacionAutomatica() {
  var triggers = ScriptApp.getProjectTriggers();
  var quitados = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarTodo') { ScriptApp.deleteTrigger(t); quitados++; }
  });
  var msg = quitados
    ? ('Se quitaron ' + quitados + ' activador(es) de sincronizarTodo(). Ya NO corre automático.')
    : 'No había ningún activador de sincronizarTodo() instalado.';
  Logger.log(msg);
  return msg;
}


/* ===== CATÁLOGO por caja ===== */
function sincronizarCatalogoCaja_(caja, fileId) {
  var lista = leerCatalogoDeCaja_(caja);
  var ext = SpreadsheetApp.openById(fileId);
  var cat = ext.getSheetByName('CATALOGO');
  if (!cat) throw new Error('El archivo de ' + caja + ' no tiene la pestaña "CATALOGO".');

  var start = SYNC.CAT_HEADER_ROW + 1;
  var last = cat.getLastRow();
  if (last >= start) cat.getRange(start, 1, last - start + 1, 6).clearContent();

  var filas = lista.map(function (x) {
    return [x.cuenta, x.concepto, x.tipo, x.cuenta + ' - ' + x.concepto, x.subconcepto, x.cuenta + ' · ' + x.concepto];
  });
  if (filas.length) {
    // El catálogo pasó de ~1,000 a 3,119 cuentas: hay que asegurarse de
    // que la hoja tenga filas suficientes antes de escribir.
    asegurarFilas_(cat, start + filas.length - 1);
    cat.getRange(start, 1, filas.length, 6).setValues(filas);
  }
  return filas.length;
}


/* ===== EGRESOS por caja =====
   El egreso vive en la CAJA QUE PAGÓ. La sucursal a la que se le carga el
   gasto viaja en la columna SUCURSAL DEL GASTO, sin mover el egreso.
   En el esquema nuevo baja SOLO cuando ya se entregó el efectivo, y solo
   si la fecha es igual o posterior al INICIO DE OPERACIÓN. ===== */
function sincronizarEgresosCaja_(caja, fileId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conc = ss.getSheetByName(SYNC.CENTRAL_CONCENTRADO);
  if (!conc) throw new Error('No se encontró la hoja "' + SYNC.CENTRAL_CONCENTRADO + '".');
  var mc = mapaFila_(conc, 1);
  var datos = conc.getDataRange().getValues();

  /* Índice de cuentas. Primero se carga MAPA_CUENTAS (que trae también las
     cuentas VIEJAS: 870, 874, 100-3, 895...) y encima se pone la pestaña
     Catálogos, que es la que manda para las cuentas actuales. Así una fila
     histórica ya no se queda con CONCEPTO y TIPO en blanco. */
  var idx = {};
  var mapaViejas = leerMapaCuentas_();
  Object.keys(mapaViejas).forEach(function (c) { idx[c] = mapaViejas[c]; });
  leerTodoElCatalogo_().forEach(function (x) { idx[String(x.cuenta).trim()] = x; });

  var ext = SpreadsheetApp.openById(fileId);
  var eg = ext.getSheetByName('EGRESOS');
  if (!eg) throw new Error('El archivo de ' + caja + ' no tiene la pestaña "EGRESOS".');
  var me = mapaFila_(eg, SYNC.EG_HEADER_ROW);
  if (me[SYNC.EG_FOLIO] == null) throw new Error('Falta la columna "Folio" en EGRESOS de ' + caja + '.');

  var nuevoEsquema = usaEsquemaNuevo_(caja);
  var cajaN = normalizarTexto(caja);
  var colEntrega = mc[SYNC.C_ENTREGA];
  var colAplica  = mc[SYNC.C_APLICA];

  /* ---- 1) Qué folios DEBEN estar en EGRESOS de esta caja ---- */
  var orden = [];
  var regPorFolio = {};

  for (var r = 1; r < datos.length; r++) {
    var fila = datos[r];
    var folio = String(fila[mc[SYNC.C_FOLIO] - 1] || '').trim();
    if (!folio) continue;
    var sucPaga = String(fila[mc[SYNC.C_SUCURSAL] - 1] || '');
    var cajaFila = cajaDe_(sucPaga);
    if (!cajaFila || normalizarTexto(cajaFila) !== cajaN) continue;

    var impComp = fila[mc[SYNC.C_IMPORTE_COMP] - 1];
    var tieneComp = !(impComp === '' || impComp == null);
    var autorizado = normalizarTexto(fila[mc[SYNC.C_ESTATUS_AUT] - 1]) === 'AUTORIZADO';
    var entregado = colEntrega
      ? (String(fila[colEntrega - 1] || '').trim() !== '')
      : autorizado;

    if (nuevoEsquema) {
      if (!entregado) continue;
    } else {
      if (!tieneComp) continue;
    }

    var cuenta = String(fila[mc[SYNC.C_CUENTA] - 1] || '').replace(/\.0$/, '').trim();
    var cat = idx[cuenta] || { concepto: '', tipo: '' };

    var fechaVal = nuevoEsquema
      ? fila[mc[SYNC.C_FECHA_SOL] - 1]
      : fila[mc[SYNC.C_FECHA_COMP] - 1];
    var d = (fechaVal instanceof Date) ? fechaVal : (fechaVal ? new Date(fechaVal) : new Date());
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);

    // Antes del inicio de operación fueron pruebas: no se contabiliza.
    if (antesDeOperacion_(d)) continue;

    var importeAutorizado = Number(fila[mc[SYNC.C_IMPORTE] - 1] || 0);
    var importeComprobado = tieneComp ? Number(impComp) : '';
    var montoFinal = tieneComp ? Number(impComp) : importeAutorizado;

    // A quién se le carga el gasto. Si no lo capturaron, se asume la caja que pagó.
    var sucGasto = colAplica ? String(fila[colAplica - 1] || '').trim() : '';
    if (!sucGasto) sucGasto = sucPaga.trim();

    var reg = {};
    reg[SYNC.EG_FOLIO]    = folio;
    reg[SYNC.EG_FECHA]    = d;
    reg[SYNC.EG_ANIO]     = d.getFullYear();
    reg[SYNC.EG_MES]      = MESES_ES[d.getMonth()];
    reg[SYNC.EG_SELECC]   = cuenta + ' · ' + cat.concepto;
    reg[SYNC.EG_CUENTA]   = cuenta;
    reg[SYNC.EG_CONCEPTO] = cat.concepto;
    reg[SYNC.EG_TIPO]     = cat.tipo;
    reg[SYNC.EG_DETALLE]  = String(fila[mc[SYNC.C_SUBCONCEPTO] - 1] || '');
    reg[SYNC.EG_RUTA]     = String(fila[mc[SYNC.C_RUTA] - 1] || '');
    reg[SYNC.EG_SUC_GASTO] = sucGasto;
    if (mc[SYNC.C_AREA]) reg[SYNC.EG_AREA] = String(fila[mc[SYNC.C_AREA] - 1] || '');

    if (nuevoEsquema) {
      reg[SYNC.EG_MONTO_AUTORIZADO] = importeAutorizado;
      reg[SYNC.EG_MONTO_COMPROBADO] = importeComprobado;
      reg[SYNC.EG_MONTO] = montoFinal;
    } else {
      reg[SYNC.EG_MONTO] = tieneComp ? Number(impComp) : 0;
    }

    if (!regPorFolio[folio]) orden.push(folio);
    regPorFolio[folio] = reg;
  }

  var primera = SYNC.EG_HEADER_ROW + 1;
  var folioCol = me[SYNC.EG_FOLIO];
  var montoCol = me[SYNC.EG_MONTO];

  /* ---- 2) Esquema nuevo: quitar folios que ya NO califican ----
     Se borra por BLOQUES contiguos (deleteRows) y de abajo hacia arriba.
     Antes era una llamada deleteRow por fila: con muchas bajas eso solo
     gastaba minutos. */
  var eliminados = 0;
  if (nuevoEsquema) {
    var ultimaR = eg.getLastRow();
    if (ultimaR >= primera) {
      var folEx = eg.getRange(primera, folioCol, ultimaR - primera + 1, 1).getValues();
      var bFin = -1, bIni = -1;
      for (var i = folEx.length - 1; i >= 0; i--) {
        var fx = String(folEx[i][0] || '').trim();
        var sobra = !!(fx && !regPorFolio[fx]);
        if (sobra) {
          if (bFin < 0) bFin = i;
          bIni = i;
        }
        if ((!sobra || i === 0) && bFin >= 0) {
          var cuantas = bFin - bIni + 1;
          eg.deleteRows(primera + bIni, cuantas);
          eliminados += cuantas;
          bFin = -1; bIni = -1;
        }
      }
    }
  }

  /* ---- 3) Ver qué queda y dónde termina la información ---- */
  var ultima = eg.getLastRow();
  var existentes = {};
  var filaPorFolio = {};
  var ultimaData = SYNC.EG_HEADER_ROW;

  if (ultima >= primera) {
    var folios = eg.getRange(primera, folioCol, ultima - primera + 1, 1).getValues();
    var montos = eg.getRange(primera, montoCol, ultima - primera + 1, 1).getValues();
    for (var j = 0; j < folios.length; j++) {
      var fv = String(folios[j][0] || '').trim();
      if (fv) { existentes[fv] = true; filaPorFolio[fv] = primera + j; }
      var tieneMonto = (montos[j][0] !== '' && montos[j][0] != null);
      if (fv || tieneMonto) ultimaData = primera + j;
    }
  }

  /* ---- 4) Insertar los nuevos y corregir los que ya estaban ---- */
  var nuevos = [];
  var actualizaciones = [];

  orden.forEach(function (folio) {
    var reg = regPorFolio[folio];
    if (existentes[folio]) {
      if (nuevoEsquema) actualizaciones.push({ fila: filaPorFolio[folio], reg: reg });
      return;
    }
    nuevos.push(reg);
  });

  /* ---- 4.a) LAS ACTUALIZACIONES VAN POR COLUMNA, NO POR CELDA ----
     Este era el cuello de botella: ~1,050 filas x ~15 columnas = más de
     15,000 setValue() sueltos por corrida, y la ejecución se moría a los
     6 minutos dejando las filas nuevas sin escribir.
     Ahora se junta todo por columna y se hace UNA escritura por columna.
     Se lee el valor que ya tiene cada celda y solo se cambia lo que toca,
     así las filas que no están en la lista no se tocan. La columna
     COMPROBANTE no entra aquí, así que las fotos incrustadas se quedan. */
  if (actualizaciones.length) {
    var rMin = Infinity, rMax = -Infinity;
    actualizaciones.forEach(function (u) {
      if (u.fila < rMin) rMin = u.fila;
      if (u.fila > rMax) rMax = u.fila;
    });
    var alto = rMax - rMin + 1;

    var porColumna = {};
    actualizaciones.forEach(function (u) {
      Object.keys(u.reg).forEach(function (nombre) {
        var c = me[nombre];
        if (c == null) return;
        if (!porColumna[c]) porColumna[c] = {};
        porColumna[c][u.fila] = u.reg[nombre];
      });
    });

    Object.keys(porColumna).forEach(function (cTxt) {
      var col = Number(cTxt);
      var rango = eg.getRange(rMin, col, alto, 1);
      var vals = rango.getValues();
      var cambios = porColumna[cTxt];
      Object.keys(cambios).forEach(function (fTxt) {
        vals[Number(fTxt) - rMin][0] = cambios[fTxt];
      });
      rango.setValues(vals);
    });
  }

  if (!nuevos.length) return actualizaciones.length + eliminados;

  var ancho = eg.getLastColumn();
  var matriz = nuevos.map(function (reg) {
    var row = [];
    for (var k = 0; k < ancho; k++) row.push('');
    Object.keys(reg).forEach(function (nombre) {
      var c = me[nombre];
      if (c != null) row[c - 1] = reg[nombre];
    });
    return row;
  });
  // Si a la hoja se le acabaron las filas, se le agregan antes de escribir.
  asegurarFilas_(eg, ultimaData + matriz.length);
  eg.getRange(ultimaData + 1, 1, matriz.length, ancho).setValues(matriz);

  /* ---- 5) Foto del comprobante en la columna COMPROBANTE ----
     IMAGEN INCRUSTADA (newCellImage), no fórmula: la fórmula =IMAGE
     dependía del separador de argumentos del archivo y se rompía.
     La imagen incrustada se ajusta sola al tamaño de la celda.
     NO se toca el alto de la fila: aquí NO hay ningún setRowHeight. */
  var colComp = me[SYNC.EG_COMPROBANTE];
  if (colComp != null) {
    for (var n = 0; n < nuevos.length; n++) {
      var imgId = primeraFotoDeCarpeta_(nuevos[n][SYNC.EG_RUTA]);
      if (!imgId) continue;
      try {
        DriveApp.getFileById(imgId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var filaEg = ultimaData + 1 + n;
        var imgComp = SpreadsheetApp.newCellImage()
          .setSourceUrl('https://lh3.googleusercontent.com/d/' + imgId + '=w200')
          .setAltTextTitle('Comprobante ' + String(nuevos[n][SYNC.EG_FOLIO] || ''))
          .build();
        eg.getRange(filaEg, colComp).setValue(imgComp);
      } catch (e) { console.error('Comprobante EGRESOS: ' + e.message); }
    }
  }

  return nuevos.length;
}


/* ===== Enganche EN TIEMPO REAL (lo llaman la entrega y la comprobación).
   Además de bajar el egreso al instante, si la caja es CEDIS SAN PABLO
   también refresca AL INSTANTE el RESUMEN DIARIO y el DASHBOARD — así
   la actualización es inmediata cuando pasa algo de verdad, en vez de
   esperar al reloj de una hora que ahora es solo un respaldo. ===== */
function sincronizarEgresoEnVivo_(sucursal) {
  try {
    limpiarCacheSync_();               // catálogo fresco en cada llamada en vivo
    var caja = cajaDe_(sucursal);
    if (!caja) return 0;
    var fileId = fileIdDeCaja_(caja);
    if (!fileId) return 0;

    var n = sincronizarEgresosCaja_(caja, fileId);

    if (normalizarTexto(caja) === normalizarTexto('CEDIS SAN PABLO')) {
      try { generarResumenDiarioCedisSanPablo(); } catch (e) { console.error('resumen en vivo: ' + e.message); }
      // Ya no pinta el dashboard (eso se apagó en Desgloses.gs); llena las
      // columnas ÁREA y SUCURSAL DEL GASTO y los datos de las gráficas.
      try { actualizarDesglosesDashboardCSP(); }   catch (e) { console.error('columnas en vivo: ' + e.message); }
      try { generarPolizaDiariaCSP(); } catch (e) { console.error('poliza: ' + e.message); }
    }

    return n;
  } catch (e) {
    console.error('Sync en vivo falló para "' + sucursal + '": ' + e.message);
    return 0;
  }
}


/* ===== Helpers de catálogo y de hoja ===== */

/** Lee la pestaña Catálogos UNA sola vez por ejecución y la deja en memoria.
 *  Antes se releía dos veces por cada caja: con 15 cajas y 3,119 cuentas
 *  eran cerca de un millón de celdas leídas de más en cada corrida. */
function leerTodoElCatalogo_() {
  if (_CACHE_CATALOGO) return _CACHE_CATALOGO;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cat = ss.getSheetByName('Catálogos') || ss.getSheetByName('Catalogos');
  if (!cat) throw new Error('No se encontró la hoja de Catálogos.');
  var last = cat.getLastRow();
  if (last < 2) { _CACHE_CATALOGO = []; return _CACHE_CATALOGO; }
  var datos = cat.getRange(2, 1, last - 1, 10).getDisplayValues();
  var out = [];
  datos.forEach(function (f) {
    var cuenta = String(f[0] || '').trim();
    var suc = String(f[1] || f[6] || '').trim();
    var concepto = String(f[2] || '').trim();
    if (!cuenta || !suc || !concepto) return;
    if (cuenta.toUpperCase() === 'CUENTA' || concepto.toUpperCase() === 'CONCEPTO') return;
    out.push({ cuenta: cuenta, sucursal: suc, concepto: concepto, tipo: String(f[4] || ''), subconcepto: String(f[3] || '') });
  });

  _CACHE_CATALOGO = out;
  return out;
}

/** Plan B para CONCEPTO y TIPO: la pestaña MAPA_CUENTAS del Concentrado,
 *  con las columnas CUENTA | CONCEPTO | TIPO. Ahí viven las cuentas VIEJAS
 *  (870, 874, 100-3, 895, 1113...) que ya no están en Catálogos y que por
 *  eso dejaban las filas históricas en blanco al resincronizar.
 *  Si la pestaña no existe, devuelve vacío y todo sigue igual que antes. */
function leerMapaCuentas_() {
  if (_CACHE_MAPA) return _CACHE_MAPA;

  var m = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SYNC.HOJA_MAPA);
    if (sh) {
      var last = sh.getLastRow();
      if (last >= 2) {
        var datos = sh.getRange(2, 1, last - 1, 3).getDisplayValues();
        datos.forEach(function (f) {
          var cuenta = String(f[0] || '').trim();
          if (!cuenta || cuenta.toUpperCase() === 'CUENTA') return;
          m[cuenta] = {
            cuenta: cuenta,
            concepto: String(f[1] || ''),
            tipo: String(f[2] || ''),
            sucursal: '',
            subconcepto: ''
          };
        });
      }
    }
  } catch (e) {
    console.error('MAPA_CUENTAS: ' + e.message);
  }

  _CACHE_MAPA = m;
  return m;
}

function leerCatalogoDeCaja_(caja) {
  var cajaN = normalizarTexto(caja);

  // CEDIS SAN PABLO es la caja general: puede acabar pagando el gasto de
  // CUALQUIER sucursal, así que se le baja el catálogo COMPLETO. Las demás
  // cajas siguen recibiendo solo lo que a ellas les corresponde.
  if (cajaN === normalizarTexto('CEDIS SAN PABLO')) return leerTodoElCatalogo_();

  return leerTodoElCatalogo_().filter(function (x) {
    var c = cajaDe_(x.sucursal);
    return c && normalizarTexto(c) === cajaN;
  });
}

function mapaFila_(hoja, filaEnc) {
  var enc = hoja.getRange(filaEnc, 1, 1, hoja.getLastColumn()).getValues()[0];
  var m = {};
  for (var c = 0; c < enc.length; c++) {
    var k = String(enc[c]).trim();
    if (k !== '') m[k] = c + 1;
  }
  return m;
}

function letraColumna_(col) {
  var letra = '';
  while (col > 0) {
    var mod = (col - 1) % 26;
    letra = String.fromCharCode(65 + mod) + letra;
    col = Math.floor((col - mod) / 26);
  }
  return letra;
}

function filaPorTexto_(hoja, columna, texto) {
  var vals = hoja.getRange(1, columna, hoja.getMaxRows(), 1).getDisplayValues();
  var buscado = String(texto).toUpperCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').toUpperCase().indexOf(buscado) !== -1) return i + 1;
  }
  return 0;
}

function primeraFotoDeCarpeta_(rutaUrl) {
  var m = String(rutaUrl || '').match(/[-\w]{25,}/);
  if (!m) return '';
  try {
    var it = DriveApp.getFolderById(m[0]).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (String(f.getMimeType() || '').indexOf('image/') === 0) return f.getId();
    }
  } catch (e) { console.error('primeraFotoDeCarpeta_: ' + e.message); }
  return '';
}


/* ===== Rellenar miniaturas del CONCENTRADO (correr UNA vez) ===== */
function rellenarMiniaturasFaltantes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Concentrado');
  if (!sh) throw new Error('No se encontró la hoja "Concentrado".');

  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = {};
  for (var c = 0; c < enc.length; c++) col[String(enc[c]).trim()] = c + 1;

  var cImp = col['Importe Comprobado'];
  var cRuta = col['Ruta Evidencia'];
  var cMin = col['Miniatura'];
  var cFol = col['Folio'];
  if (!cImp || !cRuta) throw new Error('Faltan columnas "Importe Comprobado" o "Ruta Evidencia".');
  if (!cMin) throw new Error('Falta la columna "Miniatura" (encabezado exacto "Miniatura").');

  var last = sh.getLastRow();
  if (last < 2) return 'Sin datos.';
  var datos = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var puestas = 0, sinFoto = 0;

  for (var i = 0; i < datos.length; i++) {
    var fila = i + 2;
    var imp = datos[i][cImp - 1];
    var yaMin = datos[i][cMin - 1];
    var ruta = String(datos[i][cRuta - 1] || '').trim();
    if (imp === '' || imp == null) continue;
    if (yaMin !== '' && yaMin != null) continue;
    if (!ruta) continue;

    var imgId = primeraFotoDeCarpeta_(ruta);
    if (!imgId) { sinFoto++; continue; }
    try {
      DriveApp.getFileById(imgId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      // IMAGEN INCRUSTADA, como siempre. Aquí SÍ se conserva el alto de 45
      // porque así ha venido funcionando el Concentrado.
      var imgMin = SpreadsheetApp.newCellImage()
        .setSourceUrl('https://lh3.googleusercontent.com/d/' + imgId + '=w200')
        .setAltTextTitle('Evidencia ' + (cFol ? String(datos[i][cFol - 1] || '') : ''))
        .build();
      sh.getRange(fila, cMin).setValue(imgMin);
      sh.setRowHeight(fila, 45);
      puestas++;
    } catch (e) { console.error('Fila ' + fila + ': ' + e.message); }
  }
  var msg = 'Miniaturas agregadas: ' + puestas + ' | Filas sin foto (PDF u otro): ' + sinFoto;
  Logger.log(msg);
  return msg;
}


/* ============================================================================
   DIAGNÓSTICO DE LA SINCRONIZACIÓN
   Corre SOLO CEDIS SAN PABLO y te dice cuánto tardó y qué hizo, sin tocar
   el resumen ni las gráficas. Sirve para saber si ya cabe en el tiempo.
   ============================================================================ */
function diagnosticoSync() {
  limpiarCacheSync_();
  var t0 = new Date().getTime();

  var caja = 'CEDIS SAN PABLO';
  var fileId = fileIdDeCaja_(caja);
  if (!fileId) {
    var sinArchivo = 'No hay archivo registrado para ' + caja + ' en la pestaña CAJAS.';
    Logger.log(sinArchivo);
    return sinArchivo;
  }

  var cuentasCat = leerTodoElCatalogo_().length;
  var t1 = new Date().getTime();
  var cuentasMapa = Object.keys(leerMapaCuentas_()).length;
  var t2 = new Date().getTime();

  var n = sincronizarEgresosCaja_(caja, fileId);
  var t3 = new Date().getTime();

  var eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');

  var out = [
    'DIAGNÓSTICO DE SINCRONIZACIÓN — ' + caja,
    '============================================',
    'Cuentas en la pestaña Catálogos: ' + cuentasCat,
    'Cuentas en MAPA_CUENTAS:         ' + cuentasMapa +
      (cuentasMapa ? '' : '   <-- no existe la pestaña; las cuentas viejas quedarán en blanco'),
    '',
    'Leer el catálogo:      ' + Math.round((t1 - t0) / 1000) + ' seg',
    'Leer MAPA_CUENTAS:     ' + Math.round((t2 - t1) / 1000) + ' seg',
    'Sincronizar EGRESOS:   ' + Math.round((t3 - t2) / 1000) + ' seg',
    'TOTAL:                 ' + Math.round((t3 - t0) / 1000) + ' seg   (el límite son 360)',
    '',
    'Movimientos que tocó:  ' + n,
    'Última fila de EGRESOS: ' + eg.getLastRow() + '   (filas disponibles en la hoja: ' + eg.getMaxRows() + ')'
  ];

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
/** Enseña cómo están los encabezados de EGRESOS y cuáles le faltan al código. */
function verEncabezadosEgresos() {
  var fileId = fileIdDeCaja_('CEDIS SAN PABLO');
  var eg = SpreadsheetApp.openById(fileId).getSheetByName('EGRESOS');
  var fila = SYNC.EG_HEADER_ROW;                 // 4
  var enc = eg.getRange(fila, 1, 1, eg.getLastColumn()).getValues()[0];

  var out = ['ENCABEZADOS DE EGRESOS — CEDIS SAN PABLO (fila ' + fila + ')',
             '============================================================'];
  for (var c = 0; c < enc.length; c++) {
    var txt = String(enc[c]);
    out.push('  ' + letraColumna_(c + 1) + fila + '  = "' + txt + '"' +
             (txt !== txt.trim() ? '   <-- TIENE ESPACIOS DE SOBRA' : ''));
  }

  out.push('');
  out.push('LAS QUE EL CÓDIGO NECESITA:');
  var map = mapaFila_(eg, fila);
  [SYNC.EG_FOLIO, SYNC.EG_FECHA, SYNC.EG_ANIO, SYNC.EG_MES, SYNC.EG_SELECC,
   SYNC.EG_CUENTA, SYNC.EG_CONCEPTO, SYNC.EG_TIPO, SYNC.EG_DETALLE,
   SYNC.EG_MONTO, SYNC.EG_MONTO_AUTORIZADO, SYNC.EG_MONTO_COMPROBADO,
   SYNC.EG_RUTA, SYNC.EG_COMPROBANTE, SYNC.EG_AREA, SYNC.EG_SUC_GASTO
  ].forEach(function (n) {
    out.push('  ' + (map[n] != null ? 'OK  columna ' + letraColumna_(map[n])
                                    : '*** FALTA ***') + '   "' + n + '"');
  });

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}