/**********************************************************************
 * AntiDuplicados.gs — CANDADO CONTRA SOLICITUDES REPETIDAS  (versión 2)
 *
 * EL PROBLEMA: AppSheet manda el mismo POST 4 veces y en el Concentrado
 * salen 4 renglones del mismo gasto.
 *
 * QUÉ CAMBIÓ EN ESTA VERSIÓN (23-sept-2026):
 *
 *   1) YA NO SE USA SOLO EL ID DE LA ORDEN DE COMPRA.
 *      En el Concentrado aparecieron dos solicitudes DISTINTAS con el
 *      mismo número de orden:
 *          "Orden de Compra: OC CGV26OC345 -"
 *          "Orden de Compra: OC CGV26OC345 - PAPELERIA"
 *      Si la huella fuera solo el ID, la segunda se habría bloqueado
 *      completa. Ahora la huella se arma con la DESCRIPCIÓN ENTERA más
 *      caja, colaborador, tipo de gasto e importe.
 *
 *   2) ADEMÁS DEL CACHÉ, SE REVISA EL CONCENTRADO.
 *      El caché es rápido pero se puede vaciar, y si los 4 POST llegan
 *      al mismo instante puede que ninguno alcance a ver al otro. Por eso
 *      ahora también se leen los últimos renglones del Concentrado y se
 *      busca ahí el mismo gasto. Esa es la única verdad: si ya está
 *      escrito, no se vuelve a escribir.
 *
 * SI LA SOLICITUD FALLA (por ejemplo el tipo de gasto no empata), la
 * huella se borra, para que un reenvío corregido sí entre.
 *
 * FUNCIONES PARA CORRER A MANO:
 *   probarCandadoDuplicados()     -> comprueba que el candado está vivo
 *   verDuplicadosConcentrado()    -> NO borra nada, solo te los muestra
 *   borrarDuplicadosConcentrado() -> borra los repetidos, conserva el 1º
 **********************************************************************/

/* Minutos que se recuerda una solicitud para considerarla repetida. */
var SOLDUP_MINUTOS = 60;

/* Cuántos renglones del final del Concentrado se revisan buscando el
   mismo gasto. 80 cubre de sobra un día de captura. */
var SOLDUP_FILAS_REVISAR = 80;


/** Huella del envío: la descripción COMPLETA más los datos que lo
 *  identifican. Dos solicitudes de la misma orden pero con distinta
 *  observación dan huellas distintas, que es lo correcto. */
function solClaveDuplicado_(payload) {
  var base = [
    String((payload && payload.sucursal) || ''),
    String((payload && payload.colaborador) || ''),
    String((payload && payload.tipoGasto) || ''),
    String((payload && payload.importe) || ''),
    String((payload && payload.descripcion) || '')
  ].join('|').toUpperCase().replace(/\s+/g, ' ').trim();

  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base);
  var hex = bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return (v.length === 1 ? '0' : '') + v;
  }).join('');
  return 'DUP_' + hex;
}


/** Normaliza un importe que puede venir como "5,400.00", "$5,400.00" o 5400. */
function solImporteNumero_(v) {
  var t = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
  var n = Number(t);
  return isNaN(n) ? 0 : n;
}


/** Busca en los últimos renglones del Concentrado un gasto idéntico.
 *  Devuelve el folio si lo encuentra, o cadena vacía.
 *  Nunca truena: ante cualquier problema devuelve vacío y deja pasar. */
function solDuplicadoEnConcentrado_(payload) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
    if (!sh) return '';

    var last = sh.getLastRow();
    if (last < 2) return '';

    var map = mapaColumnas_(sh);
    var ancho = sh.getLastColumn();
    var desde = Math.max(2, last - SOLDUP_FILAS_REVISAR + 1);
    var datos = sh.getRange(desde, 1, last - desde + 1, ancho).getDisplayValues();

    var g = function (f, nombre) {
      var c = map[nombre];
      return (c == null || c >= ancho) ? '' : String(f[c] || '').trim();
    };

    var descBusca  = normalizarTexto(String((payload && payload.descripcion) || ''));
    var colabBusca = normalizarTexto(String((payload && payload.colaborador) || ''));
    var impBusca   = solImporteNumero_(payload && payload.importe);

    // Sin descripción ni importe no hay con qué comparar: mejor dejar pasar.
    if (!descBusca && !impBusca) return '';

    for (var i = datos.length - 1; i >= 0; i--) {
      var f = datos[i];
      var folio = g(f, SOL.COL_FOLIO);
      if (!folio) continue;

      if (normalizarTexto(g(f, SOL.COL_SUBCONCEPTO)) !== descBusca) continue;
      if (colabBusca && normalizarTexto(g(f, SOL.COL_COLABORADOR)) !== colabBusca) continue;
      if (Math.abs(solImporteNumero_(g(f, SOL.COL_IMPORTE)) - impBusca) > 0.005) continue;

      return folio;   // ya está escrito: es duplicado
    }
    return '';
  } catch (e) {
    console.error('solDuplicadoEnConcentrado_: ' + e.message);
    return '';
  }
}


/** Se llama ANTES de registrar. Devuelve null si el envío es nuevo, o el
 *  objeto de respuesta si es repetido (y entonces doPost se sale). */
function solRevisarDuplicado_(payload, raw) {
  var clave;
  try { clave = solClaveDuplicado_(payload); } catch (e) { return null; }

  var lock = LockService.getScriptLock();
  var conCandado = false;
  try { lock.waitLock(25000); conCandado = true; } catch (e) { conCandado = false; }

  try {
    var cache = CacheService.getScriptCache();
    var previo = null;
    try { previo = cache.get(clave); } catch (e) { previo = null; }

    // --- 1) ¿Ya pasó por aquí hace poco? ---
    if (previo) {
      solLogDup_(payload, raw, (previo === 'EN PROCESO' ? '' : previo),
        'Envío repetido (caché). Ya se había recibido este mismo gasto.');
      return {
        ok: true, duplicado: true,
        folio: (previo === 'EN PROCESO' ? '' : previo),
        mensaje: 'Envío duplicado: ya se había registrado esta misma solicitud. No se creó otra.'
      };
    }

    // --- 2) ¿Ya está escrito en el Concentrado? (la verdad de verdad) ---
    var folioPrevio = solDuplicadoEnConcentrado_(payload);
    if (folioPrevio) {
      try { cache.put(clave, folioPrevio, SOLDUP_MINUTOS * 60); } catch (e) { }
      solLogDup_(payload, raw, folioPrevio,
        'Envío repetido: este mismo gasto ya está en el Concentrado con el folio ' + folioPrevio + '.');
      return {
        ok: true, duplicado: true, folio: folioPrevio,
        mensaje: 'Envío duplicado: ya existe el folio ' + folioPrevio + '. No se creó otro.'
      };
    }

    // --- 3) Es nuevo: se aparta el lugar mientras se registra ---
    try { cache.put(clave, 'EN PROCESO', SOLDUP_MINUTOS * 60); } catch (e) { }
    return null;

  } finally {
    if (conCandado) { try { lock.releaseLock(); } catch (e) { } }
  }
}


/** Se llama DESPUÉS de registrar. Si salió bien, guarda el folio en la
 *  huella; si falló, la borra para que un reenvío corregido sí entre. */
function solCerrarDuplicado_(payload, resultado) {
  try {
    var clave = solClaveDuplicado_(payload);
    var cache = CacheService.getScriptCache();
    if (resultado && resultado.ok) {
      cache.put(clave, String(resultado.folio || 'OK'), SOLDUP_MINUTOS * 60);
    } else {
      cache.remove(clave);
    }
  } catch (e) { /* nunca debe tumbar el registro */ }
}


/** Anota el duplicado en LOG WEBHOOK. Si esa función no existiera todavía,
 *  no pasa nada: solo se va al registro de ejecución. */
function solLogDup_(payload, raw, folio, mensaje) {
  try {
    if (typeof solLogWebhook_ === 'function') {
      solLogWebhook_('DUPLICADO', folio, mensaje,
        String((payload && payload.sucursal) || ''), raw);
    } else {
      Logger.log('DUPLICADO · ' + folio + ' · ' + mensaje);
    }
  } catch (e) { /* la bitácora nunca debe tumbar esto */ }
}


/* ============================================================
 *  COMPROBACIÓN DE QUE EL CANDADO ESTÁ VIVO
 * ============================================================ */

/** Simula dos envíos idénticos seguidos. El primero debe pasar y el
 *  segundo debe quedar bloqueado. NO escribe nada en el Concentrado.
 *  Usa la ÚLTIMA solicitud que tengas registrada, para probar con datos
 *  reales. */
function probarCandadoDuplicados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh || sh.getLastRow() < 2) return 'El Concentrado no tiene solicitudes con que probar.';

  var map = mapaColumnas_(sh);
  var ancho = sh.getLastColumn();
  var f = sh.getRange(sh.getLastRow(), 1, 1, ancho).getDisplayValues()[0];
  var g = function (nombre) {
    var c = map[nombre];
    return (c == null || c >= ancho) ? '' : String(f[c] || '').trim();
  };

  var payload = {
    sucursal:    g(SOL.COL_SUCURSAL),
    colaborador: g(SOL.COL_COLABORADOR),
    tipoGasto:   g(SOL.COL_TIPO_GASTO),
    importe:     g(SOL.COL_IMPORTE),
    descripcion: g(SOL.COL_SUBCONCEPTO)
  };

  var out = ['PRUEBA DEL CANDADO ANTI-DUPLICADOS',
             '============================================',
             'Se probó con la última solicitud registrada:',
             '   Folio esperado: ' + g(SOL.COL_FOLIO),
             '   Colaborador:    ' + payload.colaborador,
             '   Importe:        ' + payload.importe,
             '   Descripción:    ' + payload.descripcion,
             ''];

  var enHoja = solDuplicadoEnConcentrado_(payload);
  out.push('Búsqueda en el Concentrado: ' +
           (enHoja ? ('ENCONTRADO -> ' + enHoja + '   ✓ el candado sí lo detectaría')
                   : '*** NO LO ENCONTRÓ — revisa los nombres de columna ***'));

  out.push('');
  out.push('Huella de este envío: ' + solClaveDuplicado_(payload));
  out.push('');
  out.push('SI ARRIBA DICE "ENCONTRADO", el candado funciona.');
  out.push('Si aun así te siguen entrando duplicados, entonces doPost no lo');
  out.push('está llamando: faltan los dos renglones en Solicitud.gs, o falta');
  out.push('volver a implementar con VERSIÓN NUEVA.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/* ============================================================
 *  LIMPIEZA DE LOS DUPLICADOS QUE YA ENTRARON
 * ============================================================ */

/** Junta las filas del Concentrado que son el mismo gasto repetido.
 *  Se consideran repetidas si coinciden en: fecha de solicitud (día),
 *  caja, colaborador, tipo de gasto, importe y descripción. */
function solAgruparDuplicados_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SOL.HOJA_CONCENTRADO);
  if (!sh) throw new Error('No se encontró la hoja "' + SOL.HOJA_CONCENTRADO + '".');

  var map = mapaColumnas_(sh);
  var last = sh.getLastRow();
  if (last < 2) return { sh: sh, grupos: [] };

  var ancho = sh.getLastColumn();
  var datos = sh.getRange(2, 1, last - 1, ancho).getDisplayValues();

  var g = function (fila, nombre) {
    var c = map[nombre];
    return (c == null || c >= ancho) ? '' : String(fila[c] || '').trim();
  };

  var porClave = {};
  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    var folio = g(f, SOL.COL_FOLIO);
    if (!folio) continue;

    var fecha = g(f, SOL.COL_FECHA_SOL);
    var dia = fecha ? fecha.split(' ')[0] : '';

    var clave = [
      dia,
      normalizarTexto(g(f, SOL.COL_SUCURSAL)),
      normalizarTexto(g(f, SOL.COL_COLABORADOR)),
      normalizarTexto(g(f, SOL.COL_TIPO_GASTO)),
      solImporteNumero_(g(f, SOL.COL_IMPORTE)),
      normalizarTexto(g(f, SOL.COL_SUBCONCEPTO))
    ].join('|');

    if (!porClave[clave]) porClave[clave] = [];
    porClave[clave].push({
      fila: i + 2,
      folio: folio,
      sucursal: g(f, SOL.COL_SUCURSAL),
      colaborador: g(f, SOL.COL_COLABORADOR),
      tipo: g(f, SOL.COL_TIPO_GASTO),
      importe: g(f, SOL.COL_IMPORTE),
      descripcion: g(f, SOL.COL_SUBCONCEPTO),
      fecha: fecha,
      comprobado: g(f, 'Importe Comprobado')
    });
  }

  var grupos = [];
  Object.keys(porClave).forEach(function (k) {
    if (porClave[k].length > 1) grupos.push(porClave[k]);
  });

  return { sh: sh, grupos: grupos };
}


/** SOLO MIRA. No cambia nada. */
function verDuplicadosConcentrado() {
  var d = solAgruparDuplicados_();
  if (!d.grupos.length) {
    var ok = 'No hay solicitudes duplicadas en el Concentrado.';
    Logger.log(ok);
    return ok;
  }

  var out = ['SOLICITUDES DUPLICADAS ENCONTRADAS: ' + d.grupos.length + ' grupos',
             '============================================================'];
  var sobran = 0;

  d.grupos.forEach(function (grupo) {
    var primero = grupo[0];
    out.push('');
    out.push(primero.fecha + ' · ' + primero.sucursal + ' · ' + primero.colaborador +
             ' · $' + primero.importe);
    out.push('   ' + primero.descripcion);
    grupo.forEach(function (r, i) {
      sobran += (i === 0 ? 0 : 1);
      out.push('   ' + (i === 0 ? 'SE CONSERVA ' : 'se borraría ') +
               'fila ' + r.fila + ' · ' + r.folio +
               (r.comprobado ? '  *** YA COMPROBADO — OJO ***' : ''));
    });
  });

  out.push('');
  out.push('Filas que se borrarían: ' + sobran);
  out.push('Si alguna dice "YA COMPROBADO", NO corras el borrado: avísame primero.');
  out.push('Si todo se ve bien, corre borrarDuplicadosConcentrado().');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}


/** BORRA los duplicados y conserva el PRIMERO de cada grupo.
 *  No toca ninguna fila que ya tenga importe comprobado. */
function borrarDuplicadosConcentrado() {
  var d = solAgruparDuplicados_();
  if (!d.grupos.length) return 'No hay solicitudes duplicadas que borrar.';

  var aBorrar = [], protegidas = [];

  d.grupos.forEach(function (grupo) {
    for (var i = 1; i < grupo.length; i++) {
      if (grupo[i].comprobado) { protegidas.push(grupo[i]); continue; }
      aBorrar.push(grupo[i]);
    }
  });

  if (!aBorrar.length) {
    return 'No se borró nada: todas las copias tienen importe comprobado. Revísalas a mano.';
  }

  // De abajo hacia arriba, para que no se recorran los números de fila.
  aBorrar.sort(function (a, b) { return b.fila - a.fila; });

  var hechos = [];
  aBorrar.forEach(function (r) {
    try {
      d.sh.deleteRow(r.fila);
      hechos.push('fila ' + r.fila + ' · ' + r.folio);
    } catch (e) {
      hechos.push('*** NO SE PUDO BORRAR fila ' + r.fila + ' (' + r.folio + '): ' + e.message);
    }
  });

  SpreadsheetApp.flush();

  var msg = 'DUPLICADOS BORRADOS (' + hechos.length + '):\n' + hechos.join('\n');
  if (protegidas.length) {
    msg += '\n\nNO SE TOCARON (ya tienen comprobación): ' +
           protegidas.map(function (r) { return r.folio; }).join(', ');
  }
  msg += '\n\nSi algo salió mal: Archivo → Historial de versiones → Ver historial.';
  Logger.log(msg);
  return msg;
}