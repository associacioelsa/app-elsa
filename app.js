/*
 * ELSA — app dels conductors (pantalla). Les dades les guarda i les llegeix Google (full "Elsa · Assistència").
 * Aquí només hi ha el dibuix i el funcionament de la pantalla: cap dada de ningú.
 *
 * - La clau de cada conductor arriba un sol cop a l'enllaç (?k=…) i es guarda al mòbil.
 * - Resposta instantània: en tocar un botó la pantalla canvia de seguida; si Google no ho pot desar,
 *   torna com estava, vibra i avisa "NO S'HA GUARDAT".
 */
(function () {
  'use strict';

  var API = window.ELSA_API;
  var BLOCS = ['MATÍ', 'MIGDIA', 'TARDA'];
  var NOMS_BLOC = { 'MATÍ': 'Matí', 'MIGDIA': 'Migdia', 'TARDA': 'Tarda' };
  var DIES = ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'];
  var LINIA_INICI = 7 * 60 + 30, LINIA_FI = 19 * 60 + 30;   // línia del dia: de 7:30 a 19:30

  var E = null;              // estat confirmat per Google
  var vista = { data: '', conductor: '', bloc: '' };
  var enviant = false;       // hi ha un fitxatge viatjant cap a Google
  var rellotge = null, darreraCarrega = 0;
  var app = document.getElementById('app');

  // ───────── La clau ─────────
  // L'enllaç és https://app.elsa.cat/#k=CLAU: el que va després de # no s'envia mai a cap servidor.
  function clauDe(text) { var m = String(text || '').match(/[#?&]k=([0-9a-f]{32})/); return m ? m[1] : ''; }
  function desaClau(k) { try { localStorage.setItem('elsa_clau', k); } catch (e) { /* sense memòria */ } }
  var clau = clauDe(location.hash) || clauDe(location.search);
  if (clau) { desaClau(clau); history.replaceState(null, '', location.pathname); }
  else { try { clau = localStorage.getItem('elsa_clau') || ''; } catch (e) { clau = ''; } }

  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch (e) { /* res */ } }

  // ───────── Eines ─────────
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function boto(cls, fn, text) { var b = el('button', cls, text); b.addEventListener('click', fn); return b; }
  function vibra(p) { try { if (navigator.vibrate) navigator.vibrate(p || 40); } catch (e) { /* iPhone: no vibra */ } }
  function dosX(n) { return (n < 10 ? '0' : '') + n; }
  function minuts(h) { var p = String(h).split(':'); return +p[0] * 60 + +p[1]; }
  function hhmm(m) { return dosX(Math.floor(m / 60)) + ':' + dosX(m % 60); }
  function araMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function avuiMobil() { var d = new Date(); return d.getFullYear() + '-' + dosX(d.getMonth() + 1) + '-' + dosX(d.getDate()); }
  function curta(iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : ''; }
  function diaSetmana(iso) { var p = iso.split('-'); return DIES[new Date(+p[0], +p[1] - 1, +p[2], 12).getDay()] + ' ' + curta(iso); }
  function nomBonic(n) { n = String(n || '').toLowerCase(); return n.charAt(0).toUpperCase() + n.slice(1); }
  function durada(m) { return Math.floor(m / 60) + 'h ' + dosX(m % 60) + 'm'; }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function mostraAvis(text) {
    var a = document.getElementById('avis');
    a.textContent = text; a.classList.add('vist');
    clearTimeout(mostraAvis.t); mostraAvis.t = setTimeout(function () { a.classList.remove('vist'); }, 6000);
  }

  // Pregunta amb dos botons (substitueix el confirm() del navegador). Torna una promesa amb true/false.
  function pregunta(text, si, no) {
    return new Promise(function (resol) {
      var d = document.getElementById('dialeg'), c = document.getElementById('caixa');
      c.innerHTML = '';
      c.appendChild(el('p', null, text));
      var bs = el('div', 'botons2');
      bs.appendChild(boto('no', function () { d.classList.remove('obert'); resol(false); }, no || 'No'));
      bs.appendChild(boto('si', function () { d.classList.remove('obert'); resol(true); }, si || 'Sí'));
      c.appendChild(bs);
      d.classList.add('obert');
    });
  }

  // ───────── Parlar amb Google ─────────
  function api(op, args) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 40000);
    return fetch(API, {
      method: 'POST', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ k: clau, op: op, args: args || [], data: vista.data, conductor: vista.conductor }),
    }).then(function (r) { return r.json(); }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error(r.error || 'Error');
      return r;
    }, function (e) {
      clearTimeout(t);
      var err = new Error(e && e.name === 'AbortError' ? 'Sense resposta' : 'Sense connexió');
      err.xarxa = true;   // no sabem si Google ho ha arribat a desar
      throw err;
    });
  }

  function carrega(primer) {
    if (primer) pintaCarregant();
    return api('estat').then(function (r) { var y = window.scrollY; E = r.estat; darreraCarrega = Date.now(); pinta(); if (!primer) window.scrollTo(0, y); }, function (e) {
      if (/Enllaç no vàlid/.test(e.message)) return pintaSenseClau(true);
      if (primer || !E) { pintaError(e.message); } else mostraAvis('No s\'ha pogut actualitzar. ' + e.message + '.');
    });
  }

  // Fa una acció a Google. Abans, la pantalla ja s'ha canviat (resposta instantània).
  // Si falla: torna a l'estat confirmat, vibra i avisa.
  var ocupat = false;   // una acció cada vegada (si no, una resposta vella podria trepitjar-ne una de nova)
  function fes(nom, args, abans) {
    if (ocupat) { mostraAvis('Espera un moment: s\'està desant l\'anterior.'); return Promise.reject(new Error('ocupat')); }
    ocupat = true;
    var confirmat = copia(E);
    if (abans) { abans(); pinta(); }
    return api(nom, args).then(function (r) {
      ocupat = false;
      var res = r.resultat;
      if (res.estat) { E = res.estat; darreraCarrega = Date.now(); pinta(); } else carrega();
      return res.res;
    }, function (e) {
      ocupat = false;
      E = confirmat; pinta();
      vibra([90, 60, 90]);
      if (e.xarxa) {
        // Pot ser que Google sí que ho hagi desat: es torna a demanar com està tot.
        mostraAvis('Connexió dolenta. Comprovant si s\'ha desat… Si no surt a la pantalla, torna-ho a provar.');
        carrega();
      } else {
        mostraAvis('NO S\'HA GUARDAT. ' + e.message.replace(/\.?$/, '.'));
      }
      throw e;
    });
  }

  // ───────── Càlculs de la jornada (els mateixos que fa Google, per poder respondre a l'instant) ─────────
  function calculaJornada(fets) {
    var tancat = 0, obert = null, iniciPausa = null, ultim = fets.length ? fets[fets.length - 1].tipus : '';
    var noTreballa = fets.some(function (f) { return f.tipus === 'No treballa'; });
    var trams = [];   // per a la línia del dia
    fets.forEach(function (f) {
      if (!/^\d\d:\d\d$/.test(f.hora)) return;
      var m = minuts(f.hora);
      if (f.tipus === 'Entrada' || (f.tipus === 'Fi pausa' && obert === null)) {
        if (iniciPausa !== null) { trams.push({ de: iniciPausa, a: m, pausa: true }); iniciPausa = null; }
        obert = m;
      } else if ((f.tipus === 'Inici pausa' || f.tipus === 'Sortida') && obert !== null) {
        tancat += m - obert; trams.push({ de: obert, a: m }); obert = null;
        if (f.tipus === 'Inici pausa') iniciPausa = m;
      }
    });
    var ara = araMin();
    var mins = tancat + (obert !== null ? Math.max(0, ara - obert) : 0);
    if (obert !== null) trams.push({ de: obert, a: ara });
    if (iniciPausa !== null && ultim === 'Inici pausa') trams.push({ de: iniciPausa, a: ara, pausa: true });
    var possibles = noTreballa ? [] : !ultim ? ['Entrada'] : (ultim === 'Entrada' || ultim === 'Fi pausa') ? ['Inici pausa', 'Sortida'] : ultim === 'Inici pausa' ? ['Fi pausa'] : [];
    var hora8h = '';
    if (obert !== null && !noTreballa && tancat < E.horesJornada * 60) {
      var m8 = obert + E.horesJornada * 60 - tancat;
      if (m8 <= 23 * 60 + 59) hora8h = hhmm(m8);
    }
    return { minuts: mins, treballant: obert !== null && !noTreballa, enPausa: ultim === 'Inici pausa', pausaDes: iniciPausa,
      acabada: noTreballa || ultim === 'Sortida', possibles: possibles, trams: trams, hora8h: hora8h };
  }

  // ───────── Pantalles ─────────
  function pinta() {
    if (rellotge) { clearInterval(rellotge); rellotge = null; }
    app.innerHTML = '';
    if (!E) return;
    if (E.qui.rol === 'Oficina') return pintaOficina();
    if (!E.jornada.fets.length) return pintaInici();
    pintaJornada();
  }

  function capcalera(nom, data) {
    var c = el('div', 'cap');
    var t = el('div', 'titol-app');
    var bm = boto('boto-menu', obreMenu); bm.setAttribute('aria-label', 'Menú');
    bm.appendChild(el('span')); bm.appendChild(el('span')); bm.appendChild(el('span'));
    t.appendChild(bm);
    t.appendChild(el('span', null, 'Associació Elsa'));
    c.appendChild(t);
    var f = el('div', 'fila');
    f.appendChild(el('div', 'nom-cond', nom));
    f.appendChild(el('div', 'data', data));
    c.appendChild(f);
    return c;
  }

  function escena() {
    // Un sol dibuix (escena.svg): Girona amb la llum radial i la furgoneta que bota, amb les proporcions de l'Albert.
    var s = el('div', 'escena');
    var im = el('img'); im.src = 'escena.svg?v=3'; im.alt = '';
    s.appendChild(im);
    return s;
  }

  // Pantalla de càrrega: la mateixa que la d'inici, amb formes grises que brillen.
  function pintaCarregant() {
    app.innerHTML = '';
    var w = el('div', 'inici');
    var c = el('div', 'cap');
    c.appendChild(el('div', 'titol-app', 'Associació Elsa'));
    var f = el('div', 'fila');
    var a = el('div', 'sk'); a.style.cssText = 'width:90px;height:24px';
    var b = el('div', 'sk'); b.style.cssText = 'width:110px;height:18px';
    f.appendChild(a); f.appendChild(b); c.appendChild(f);
    var t = el('div', 'sk'); t.style.cssText = 'width:150px;height:40px;margin-top:14px'; c.appendChild(t);
    var bt = el('div', 'sk'); bt.style.cssText = 'height:48px;margin-top:30px;border-radius:8px'; c.appendChild(bt);
    w.appendChild(c); w.appendChild(escena());
    app.appendChild(w);
  }

  function pintaSenseClau(invalida) {
    app.innerHTML = '';
    var w = el('div', 'inici');
    var c = el('div', 'sense-clau');
    c.appendChild(el('div', null, invalida
      ? 'Aquest enllaç ja no és vàlid. Demana\'n un de nou a l\'oficina d\'Elsa i enganxa\'l aquí:'
      : 'Enganxa aquí l\'enllaç que t\'ha enviat l\'oficina d\'Elsa:'));
    var i = el('input', 'camp'); i.placeholder = 'https://app.elsa.cat/#k=…'; i.autocomplete = 'off';
    c.appendChild(i);
    c.appendChild(boto('boto-comenca', function () {
      var k = clauDe(i.value);
      if (!k) return mostraAvis('Aquest enllaç no és correcte. Copia\'l sencer del WhatsApp.');
      clau = k; desaClau(k); carrega(true);
    }, 'Entra'));
    w.appendChild(c); w.appendChild(escena());
    app.appendChild(w);
  }

  function pintaError(msg) {
    app.innerHTML = '';
    var w = el('div', 'inici');
    var c = el('div', 'sense-clau');
    c.appendChild(el('div', null, 'No s\'ha pogut connectar (' + msg + ').'));
    c.appendChild(boto('boto-comenca', function () { carrega(true); }, 'Torna-ho a provar'));
    w.appendChild(c); w.appendChild(escena());
    app.appendChild(w);
  }

  function pintaInici() {
    var w = el('div', 'inici');
    var c = capcalera(nomBonic(E.qui.nom), diaSetmana(E.data));
    c.appendChild(el('div', 'temps', '0h 00m'));
    var b = boto('boto-comenca', comenca);
    b.appendChild(el('span', 'ic-tri')); b.appendChild(el('span', null, 'Comença la jornada'));
    c.appendChild(b);
    w.appendChild(c); w.appendChild(escena());
    app.appendChild(w);
  }

  function pintaJornada() {
    var j = calculaJornada(E.jornada.fets);
    var c = capcalera(nomBonic(E.qui.nom), diaSetmana(E.data));
    var tf = el('div', 'temps-fila');
    var temps = el('div', 'temps', durada(j.minuts));
    tf.appendChild(temps);
    tf.appendChild(el('div', 'punt' + (j.enPausa ? ' pausa' : j.acabada ? ' parat' : '')));
    if (j.possibles.indexOf('Inici pausa') >= 0) {
      var bp = boto('bq', function () { fitxa('Inici pausa'); }); bp.setAttribute('aria-label', 'Pausa');
      bp.disabled = enviant; bp.appendChild(el('span', 'ic-pausa')); tf.appendChild(bp);
    }
    if (j.possibles.indexOf('Fi pausa') >= 0) {
      var bt = boto('bq clar', function () { fitxa('Fi pausa'); }); bt.setAttribute('aria-label', 'Torna de la pausa');
      bt.disabled = enviant; bt.appendChild(el('span', 'ic-play')); tf.appendChild(bt);
    }
    if (j.possibles.indexOf('Sortida') >= 0 || j.possibles.indexOf('Fi pausa') >= 0) {
      var bs = boto('bq', function () { acaba(calculaJornada(E.jornada.fets)); }); bs.setAttribute('aria-label', 'Acaba la jornada');
      bs.disabled = enviant || j.possibles.indexOf('Sortida') < 0; bs.appendChild(el('span', 'ic-stop')); tf.appendChild(bs);
    }
    c.appendChild(tf);
    if (j.enPausa) {
      var ep = el('div', 'en-pausa', 'En pausa ');
      ep.appendChild(el('span', null, durada(Math.max(0, araMin() - j.pausaDes))));
      c.appendChild(ep);
    }
    var ultim = E.jornada.fets[E.jornada.fets.length - 1];
    if (j.acabada) {
      c.appendChild(el('div', 'acabada', 'Jornada acabada. Gràcies!'));
      if (ultim && ultim.tipus === 'Sortida' && ultim.potDesfer && !enviant) {
        // Botó gran per si ha tocat "acabar" per error (durant els primers 10 minuts).
        c.appendChild(boto('boto-repren', function () {
          pregunta('Vols desfer el final de la jornada i continuar treballant?', 'Sí, continuo', 'No').then(function (si) {
            if (si) fes('desfesFitxatge', []).catch(function () { /* ja avisat */ });
          });
        }, '↶ M\'he equivocat: continuo treballant'));
      } else if (ultim && ultim.tipus === 'Sortida') {
        c.appendChild(el('div', 'acabada', 'Si t\'has equivocat, avisa l\'oficina perquè ho corregeixi.'));
      }
    } else if (ultim && ultim.potDesfer && !enviant) {
      c.appendChild(boto('desfes', function () {
        pregunta('Vols desfer «' + ultim.tipus + ' ' + ultim.hora + '»?', 'Desfés', 'No').then(function (si) {
          if (si) fes('desfesFitxatge', []).catch(function () { /* ja avisat */ });
        });
      }, '↶ M\'he equivocat: desfés «' + ultim.tipus + '»'));
    }
    c.appendChild(liniaDia(j.trams));
    c.appendChild(boto('meus', obreMeusFitxatges, 'Els meus fitxatges ›'));
    app.appendChild(c);
    app.appendChild(fullRuta());
    if (j.treballant || j.enPausa) rellotge = setInterval(function () {
      var obert = document.getElementById('capa').classList.contains('oberta') || document.getElementById('dialeg').classList.contains('obert');
      if (!obert && !ocupat) { var y = window.scrollY; pinta(); window.scrollTo(0, y); }
      else temps.textContent = durada(calculaJornada(E.jornada.fets).minuts);
    }, 30000);
  }

  function liniaDia(trams) {
    var w = el('div');
    var l = el('div', 'linia-dia');
    var tot = LINIA_FI - LINIA_INICI;
    var peces = trams.map(function (t) { return { de: Math.max(LINIA_INICI, t.de), a: Math.min(LINIA_FI, t.a), pausa: t.pausa }; })
      .filter(function (t) { return t.a > t.de; })
      .sort(function (x, y) { return x.de - y.de; });
    peces.forEach(function (t, k) {
      var i = el('i', t.pausa ? 'tram-pausa' : '');
      i.style.left = ((t.de - LINIA_INICI) / tot * 100) + '%';
      i.style.width = ((t.a - t.de) / tot * 100) + '%';
      // Puntes arrodonides; on un tram toca el següent (feina → pausa → feina), la unió és recta.
      var ambAnterior = k > 0 && peces[k - 1].a >= t.de;
      var ambSeguent = k < peces.length - 1 && peces[k + 1].de <= t.a;
      i.style.borderRadius = (ambAnterior ? '0' : '4px') + ' ' + (ambSeguent ? '0' : '4px') + ' ' +
        (ambSeguent ? '0' : '4px') + ' ' + (ambAnterior ? '0' : '4px');
      l.appendChild(i);
    });
    w.appendChild(l);
    var h = el('div', 'hores-dia');
    ['07:30', '10:30', '13:30', '16:30', '19:30'].forEach(function (x) { h.appendChild(el('span', null, x)); });
    w.appendChild(h);
    return w;
  }

  // Menú lateral (s'obre amb el botó ☰). De moment només avisa que hi haurà la Zona del treballador.
  function obreMenu() {
    var m = document.getElementById('menu');
    if (!m) {
      m = el('div', 'menu'); m.id = 'menu';
      var cortina = el('div', 'menu-fons'); cortina.addEventListener('click', tancaMenu);
      var caixa = el('div', 'menu-caixa');
      caixa.appendChild(el('div', 'menu-titol', 'Associació Elsa'));
      if (E && E.qui.rol === 'Conductor') caixa.appendChild(boto('menu-opcio', function () { tancaMenu(); obreMeusFitxatges(); }, 'Els meus fitxatges'));
      caixa.appendChild(el('div', 'menu-buit', 'Aviat hi trobaràs la Zona del treballador.'));
      m.appendChild(cortina); m.appendChild(caixa);
      document.body.appendChild(m);
    }
    requestAnimationFrame(function () { m.classList.add('obert'); });
  }
  // Els fitxatges d'avui i dels últims dies, amb "Canvia l'hora" (queda constància del canvi i del comentari).
  function obreMeusFitxatges() {
    var pa = document.getElementById('panell'); pa.innerHTML = '';
    pa.appendChild(el('h3', null, 'Els meus fitxatges'));
    pa.appendChild(el('div', 'sub', 'Si t\'has equivocat, toca «Canvia l\'hora». Pots corregir avui i l\'últim dia de feina; per a dies anteriors, truca a l\'oficina.'));
    var dies = [{ data: E.avui, fets: E.jornada.fets.filter(function (f) { return f.id !== 'provisional'; }) }].concat(E.recents || []);
    dies.forEach(function (d) {
      if (!d.fets.length) return;
      pa.appendChild(el('h4', null, d.data === E.avui ? 'Avui' : diaSetmana(d.data)));
      d.fets.forEach(function (f) {
        if (f.tipus === 'No treballa') return;
        var fila = el('div', 'fitx');
        var t = el('div', 'fitx-text');
        t.appendChild(el('b', null, f.hora + '  '));
        t.appendChild(el('span', null, f.tipus));
        if (f.modificat) t.appendChild(el('small', null, ' · modificat'));
        if (f.comentari) t.appendChild(el('div', 'fitx-com', f.comentari));
        fila.appendChild(t);
        if (/oficina/i.test(f.origen || '')) fila.appendChild(el('small', null, 'Corregit per l\'oficina'));
        else fila.appendChild(boto('petit', function () { canviaHora(d.data, f); }, 'Canvia l\'hora'));
        pa.appendChild(fila);
      });
    });
    pa.appendChild(boto('gran gris', tanca, 'Tanca'));
    document.getElementById('capa').classList.add('oberta');
  }

  function canviaHora(data, f) {
    var d = document.getElementById('dialeg'), c = document.getElementById('caixa');
    c.innerHTML = '';
    c.appendChild(el('p', null, '«' + f.tipus + '» del ' + diaSetmana(data).toLowerCase() + '.\nQuina és l\'hora correcta?'));
    var i = el('input', 'camp'); i.type = 'time'; i.value = f.hora; c.appendChild(i);
    var com = el('input', 'camp'); com.placeholder = 'Comentari (opcional, res de salut)'; com.maxLength = 160; c.appendChild(com);
    var bs = el('div', 'botons2');
    bs.appendChild(boto('no', function () { d.classList.remove('obert'); }, 'Cancel·la'));
    bs.appendChild(boto('si', function () {
      if (!i.value) return mostraAvis('Posa l\'hora.');
      d.classList.remove('obert'); tanca();
      fes('corregeixFitxatge', ['', data, f.id, i.value, com.value]).then(function () { mostraAvis('Fet. Hora canviada.'); }, function () {});
    }, 'Desa'));
    c.appendChild(bs);
    d.classList.add('obert');
  }

  function tancaMenu() { var m = document.getElementById('menu'); if (m) m.classList.remove('obert'); }

  // ───────── Ruta (pestanyes MATÍ / MIGDIA / TARDA) ─────────
  function blocPerDefecte(compte) {
    var m = araMin(), b = m < 12 * 60 ? 'MATÍ' : m < 15 * 60 + 30 ? 'MIGDIA' : 'TARDA';
    if (E.data !== E.avui) b = 'MATÍ';
    if (compte[b]) return b;
    return BLOCS.filter(function (x) { return compte[x]; })[0] || b;
  }

  function fullRuta() {
    var f = el('div', 'full');
    if (!E.ruta.length && enviant) {   // just després de començar: la ruta arriba amb la resposta de Google
      for (var i = 0; i < 6; i++) { var s = el('div', 'sk'); s.style.cssText = 'height:52px;margin:12px 20px;background-color:#e2e2ea'; f.appendChild(s); }
      return f;
    }
    if (!E.ruta.length) { f.appendChild(el('div', 'buit', 'No hi ha cap ruta publicada per a aquest dia. Avisa l\'oficina.')); return f; }
    var compte = {};
    BLOCS.forEach(function (b) { compte[b] = 0; });
    E.ruta.forEach(function (p) { if (p.tipus !== 'Centre' && compte[p.bloc] != null) compte[p.bloc]++; });
    if (!vista.bloc || vista.dataBloc !== E.data) { vista.bloc = blocPerDefecte(compte); vista.dataBloc = E.data; }
    var pt = el('div', 'pestanyes');
    BLOCS.forEach(function (b) {
      var t = boto('pt' + (b === vista.bloc ? ' act' : ''), function () { vista.bloc = b; pinta(); });
      t.appendChild(el('span', null, b));
      t.appendChild(el('small', null, compte[b] ? compte[b] + ' u' : '-'));
      pt.appendChild(t);
    });
    f.appendChild(pt);
    var llista = el('div');
    E.ruta.filter(function (p) { return p.bloc === vista.bloc; }).forEach(function (p) { llista.appendChild(filaParada(p)); });
    if (!llista.children.length) llista.appendChild(el('div', 'buit', 'Cap parada en aquest tram.'));
    f.appendChild(llista);
    setTimeout(ajustaNoms, 0);
    return f;
  }

  // Les faltes que afecten aquesta fila (a l'anada, les de l'anada; a la tornada, les de la tornada).
  function faltesFila(p) {
    return p.faltes.filter(function (x) { return !p.trajecte || x.trajecte === 'Tot el dia' || x.trajecte === p.trajecte; });
  }

  function filaParada(p) {
    if (p.tipus === 'Centre') {
      var c = el('div', 'p centre');
      c.appendChild(el('div', 'h', p.hora));
      var fl = el('div', 'fletxa'); fl.appendChild(el('i')); fl.appendChild(el('span', null, p.nom));
      c.appendChild(fl);
      return c;
    }
    var meves = faltesFila(p);
    var cls = 'p' + (meves.length ? ' no' : p.nou ? ' nou' : p.cadira ? ' cadira' : '') + (meves.some(function (x) { return x.provisional; }) ? ' guardant' : '');
    var d = el('div', cls);
    d.appendChild(el('div', 'h', p.hora));
    var info = el('div', 'info');
    info.appendChild(el('div', 'n', p.nom));
    info.appendChild(el('div', 'd', [p.centre, p.trajecte].filter(Boolean).join(' • ')));
    d.appendChild(info);
    var et = el('div', 'etiquetes');
    if (meves.length) et.appendChild(el('span', 'etiq no', textFaltaCurt(meves[0])));
    if (p.nou) et.appendChild(el('span', 'etiq nou', 'NOU'));
    if (p.cadira) et.appendChild(el('span', 'etiq cadira', 'CADIRA'));
    if (p.aniversari) et.appendChild(el('span', 'etiq pastis', '🎂'));
    if (et.children.length) d.appendChild(et);
    d.addEventListener('click', function () { obrePanell(p); });
    return d;
  }

  function textFaltaCurt(f) {
    if (f.tipus === 'Fins a una data') return 'BAIXA ' + curta(f.finsAl);
    if (f.tipus === 'Fins a nou avís') return 'BAIXA';
    return f.trajecte === 'Tot el dia' ? 'NO' : 'NO ' + f.trajecte.toUpperCase();
  }

  // Noms en una sola línia: si algun no hi cap, se li fa la lletra una mica més petita.
  function ajustaNoms() {
    document.querySelectorAll('.p .n').forEach(function (n) {
      var mida = 19;
      n.style.fontSize = mida + 'px';
      while (n.scrollWidth > n.clientWidth && mida > 13) { mida -= 0.5; n.style.fontSize = mida + 'px'; }
    });
  }

  // ───────── Fitxar ─────────
  function afegeixFetLocal(tipus, hora) {
    E.jornada.fets.push({ id: 'provisional', tipus: tipus, hora: hora || hhmm(araMin()), potDesfer: false });
  }

  function fitxa(tipus, opcions) {
    if (enviant) return;
    enviant = true;
    vibra(40);
    fes('fitxa', [tipus, opcions || {}], function () { afegeixFetLocal(tipus, opcions && opcions.ajust8h ? opcions.hora : null); })
      .then(function () { enviant = false; pinta(); }, function () { enviant = false; pinta(); });
  }

  // Començar: si algun dia anterior es va oblidar de fitxar la sortida, es proposa tancar-lo a 8 hores.
  function comenca() {
    var ajusta = [];
    var llista = (E.ajustables || []).slice();
    (function seguent() {
      if (!llista.length) return fitxa('Entrada', { ajusta: ajusta });
      var a = llista.shift();
      var ahir = a.data === isoMes(E.avui, -1);
      pregunta('Sembla que ' + (ahir ? 'ahir' : 'el ' + diaSetmana(a.data).toLowerCase()) + ' et vas oblidar de fitxar la sortida.\n\nVols que ajustem la jornada a ' +
        E.horesJornada + ' hores (sortida a les ' + a.sortida + ')?', 'Sí, ajusta-la', 'No').then(function (si) {
        if (si) ajusta.push(a.data);
        seguent();
      });
    })();
  }

  function isoMes(iso, n) {
    var p = iso.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n, 12);
    return d.getFullYear() + '-' + dosX(d.getMonth() + 1) + '-' + dosX(d.getDate());
  }

  function acaba(j) {
    if (j.minuts >= E.minutsAvis && j.hora8h) {
      return pregunta('Sembla que t\'has oblidat de fitxar la pausa. Vols que ho ajustem automàticament?\n\n(La jornada quedarà en ' +
        E.horesJornada + ' hores, amb sortida a les ' + j.hora8h + '.)', 'Sí, ajusta-la', 'No').then(function (si) {
        if (si) return fitxa('Sortida', { ajust8h: true, hora: j.hora8h });
        preguntaAcabar();
      });
    }
    preguntaAcabar();
  }
  function preguntaAcabar() {
    pregunta('Vols acabar la jornada ara?', 'Acaba', 'No').then(function (si) { if (si) fitxa('Sortida'); });
  }

  // ───────── Panell d'una persona: marcar o anul·lar una falta ─────────
  function obrePanell(p) {
    var pa = document.getElementById('panell'); pa.innerHTML = '';
    pa.appendChild(el('h3', null, p.nom));
    pa.appendChild(el('div', 'sub', [p.centre, NOMS_BLOC[p.bloc], p.trajecte].filter(Boolean).join(' • ')));
    p.faltes.forEach(function (f) {
      var c = el('div', 'falta-ja', textFaltaLlarg(f));
      c.appendChild(el('small', null, 'Motiu: ' + f.motiu + (f.marcatPer ? ' · Marcat per ' + nomBonic(f.marcatPer) : '')));
      pa.appendChild(c);
      if (f.provisional) return;
      pa.appendChild(boto('gran vora', function () {
        var avis = f.tipus === 'Només aquest dia' ? 'Vols anul·lar aquesta falta?'
          : 'Anul·lar vol dir que aquesta baixa NO ha existit mai (tampoc els dies passats).\n\nSi la persona ja torna a venir, fes servir «Torna a venir».';
        pregunta(avis, 'Anul·la', 'No').then(function (si) {
          if (!si) return;
          tanca();
          fes('anullaFalta', [f.id], function () { p.faltes = p.faltes.filter(function (x) { return x !== f; }); }).catch(function () {});
        });
      }, 'Anul·la (m\'he equivocat)'));
      if (f.tipus === 'Fins a nou avís') {
        var d = el('input', 'camp'); d.type = 'date'; d.value = E.data;
        pa.appendChild(el('h4', null, 'Torna a venir des del dia'));
        pa.appendChild(d);
        pa.appendChild(boto('gran blau', function () {
          tanca();
          fes('tornaAVenir', [f.id, d.value]).catch(function () {});
        }, 'Torna a venir'));
      }
    });
    // Faltes ja marcades per als pròxims dies (es poden anul·lar).
    (p.futures || []).forEach(function (f) {
      var c = el('div', 'falta-ja', 'El ' + diaSetmana(f.dia).toLowerCase() + ': ' + (f.trajecte === 'Tot el dia' ? 'no ve' : 'no fa la ' + f.trajecte.toLowerCase()));
      c.appendChild(el('small', null, 'Motiu: ' + f.motiu + (f.marcatPer ? ' · Marcat per ' + nomBonic(f.marcatPer) : '')));
      pa.appendChild(c);
      pa.appendChild(boto('gran vora', function () {
        pregunta('Vols anul·lar aquesta falta del ' + diaSetmana(f.dia).toLowerCase() + '?', 'Anul·la', 'No').then(function (si) {
          if (!si) return;
          tanca();
          fes('anullaFalta', [f.id]).catch(function () {});
        });
      }, 'Anul·la la del ' + curta(f.dia)));
    });
    formulari(pa, p);
    pa.appendChild(boto('gran gris', tanca, 'Tanca'));
    document.getElementById('capa').classList.add('oberta');
  }

  function textFaltaLlarg(f) {
    if (f.tipus === 'Fins a una data') return 'De baixa fins al ' + curta(f.finsAl);
    if (f.tipus === 'Fins a nou avís') return 'De baixa fins a nou avís';
    return f.trajecte === 'Tot el dia' ? 'No ve' : 'No fa la ' + f.trajecte.toLowerCase();
  }

  // Com es mostren a la pantalla els valors que es guarden al full.
  var TEXT_TRAJECTE = { 'Tot el dia': 'Cap', 'Anada': 'Anada', 'Tornada': 'Tornada' };

  // El pròxim dia feiner (de dilluns a divendres) després d'una data. Es pot canviar a mà.
  function proximFeiner(iso) {
    var d = isoMes(iso, 1);
    while ([0, 6].indexOf(new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).getDay()) >= 0) d = isoMes(d, 1);
    return d;
  }

  function formulari(pa, p) {
    var trajectes = E.trajectes;
    var esAvui = E.data === E.avui;
    // "Quin dia?": aquest dia, el pròxim dia (un sol dia més endavant), fins a una data o fins a nou avís.
    var DIES_OPC = [
      { valor: 'avui', text: esAvui ? 'Avui' : 'Aquest dia' },
      { valor: 'proxim', text: 'El pròxim dia' },
      { valor: 'Fins a una data', text: 'Fins a una data' },
      { valor: 'Fins a nou avís', text: 'Fins a nou avís' },
    ];
    var tria = { trajecte: trajectes[0], motiu: '', quan: 'avui' };
    function xips(titol, opcions, camp, despres) {
      pa.appendChild(el('h4', null, titol));
      var g = el('div', 'xips');
      opcions.forEach(function (o) {
        var valor = typeof o === 'string' ? o : o.valor, text = typeof o === 'string' ? o : o.text;
        var b = boto('xip' + (tria[camp] === valor ? ' si' : ''), function () {
          tria[camp] = valor;
          g.querySelectorAll('.xip').forEach(function (x) { x.className = 'xip' + (x === b ? ' si' : ''); });
          if (despres) despres();
        }, text);
        g.appendChild(b);
      });
      pa.appendChild(g);
    }
    xips('Quin trajecte no fa?', trajectes.map(function (t) { return { valor: t, text: TEXT_TRAJECTE[t] || t }; }), 'trajecte');
    var altresCaixa = el('div'); altresCaixa.style.display = 'none';
    xips('Motiu', E.motius, 'motiu', function () { altresCaixa.style.display = tria.motiu === E.motiuAmbText ? 'block' : 'none'; });
    altresCaixa.appendChild(el('div', 'avis-salut', 'Escriu-ho molt breu. NO hi escriguis res de salut.'));
    var altres = el('input', 'camp'); altres.maxLength = E.maxText; altres.placeholder = 'Motiu (curt)';
    altresCaixa.appendChild(altres);
    pa.appendChild(altresCaixa);

    var proximCaixa = el('div'); proximCaixa.style.display = 'none';
    proximCaixa.appendChild(el('h4', null, 'Quin dia no vindrà'));
    var proxim = el('input', 'camp'); proxim.type = 'date'; proxim.value = proximFeiner(E.data); proxim.min = isoMes(E.data, 1); proxim.max = isoMes(E.data, 60);
    proximCaixa.appendChild(proxim);
    var dataCaixa = el('div'); dataCaixa.style.display = 'none';
    dataCaixa.appendChild(el('h4', null, 'Últim dia que no vindrà'));
    var fins = el('input', 'camp'); fins.type = 'date'; fins.value = E.data;
    dataCaixa.appendChild(fins);
    xips('Quin dia?', DIES_OPC, 'quan', function () {
      proximCaixa.style.display = tria.quan === 'proxim' ? 'block' : 'none';
      dataCaixa.style.display = tria.quan === 'Fins a una data' ? 'block' : 'none';
    });
    pa.appendChild(proximCaixa);
    pa.appendChild(dataCaixa);

    pa.appendChild(boto('gran blau', function () {
      if (!tria.motiu) return mostraAvis('Tria un motiu.');
      if (tria.motiu === E.motiuAmbText && !altres.value.trim()) return mostraAvis('Escriu breument el motiu.');
      if (tria.quan === 'proxim' && !(proxim.value > E.data)) return mostraAvis('Tria un dia posterior.');
      var unDia = tria.quan === 'avui' || tria.quan === 'proxim';
      var f = { data: E.data, dia: tria.quan === 'proxim' ? proxim.value : '', soci: p.soci, nom: p.nom,
        trajecte: tria.trajecte, tipus: unDia ? 'Només aquest dia' : tria.quan,
        finsAl: fins.value, motiu: tria.motiu, altres: altres.value };
      vibra(40);
      pintaGuardant(p);
      fes('marcaFalta', [f, E.conductor], function () {
        // Si és per a un altre dia, avui no canvia res a la ruta: no es pinta cap "NO" provisional.
        if (!f.dia) p.faltes.push({ id: 'provisional', provisional: true, trajecte: f.trajecte, tipus: f.tipus, finsAl: f.finsAl, motiu: f.motiu });
      }).then(function (res) { pintaDesat(p, res.whatsapp); }, function () { tanca(); });
    }, 'Desa la falta'));
  }

  function pintaGuardant(p) {
    var pa = document.getElementById('panell'); pa.innerHTML = '';
    pa.appendChild(el('h3', null, p.nom));
    pa.appendChild(el('div', 'sub', 'Guardant…'));
    var s = el('div', 'sk'); s.style.cssText = 'height:46px;margin-top:14px;background-color:#e7e7ef'; pa.appendChild(s);
  }

  function pintaDesat(p, text) {
    var pa = document.getElementById('panell'); pa.innerHTML = '';
    pa.appendChild(el('div', 'ok-gran', '✔ Falta desada'));
    pa.appendChild(el('h4', null, 'Missatge per al grup d\'Elsa'));
    pa.appendChild(el('div', 'missatge', text));
    var a = el('a', 'gran verd', 'Envia-ho al WhatsApp');
    a.href = 'https://wa.me/?text=' + encodeURIComponent(text); a.target = '_blank'; a.rel = 'noopener noreferrer';
    pa.appendChild(a);
    pa.appendChild(boto('gran gris', tanca, 'Tanca'));
  }

  function tanca() { document.getElementById('capa').classList.remove('oberta'); }
  document.getElementById('capa').addEventListener('click', function (e) { if (e.target.id === 'capa') tanca(); });

  // ───────── Oficina ─────────
  function pintaOficina() {
    var c = capcalera('Oficina', diaSetmana(E.avui));
    var t = el('div', 'tria');
    var sd = el('select');
    var dates = E.dates.slice(); if (dates.indexOf(E.data) < 0) dates.push(E.data);
    dates.sort().forEach(function (d) { var o = el('option', null, diaSetmana(d)); o.value = d; sd.appendChild(o); });
    sd.value = E.data;
    var sc = el('select');
    E.conductors.forEach(function (x) { var o = el('option', null, nomBonic(x)); o.value = x; sc.appendChild(o); });
    sc.value = E.conductor;
    sd.onchange = sc.onchange = function () { vista.data = sd.value; vista.conductor = sc.value; vista.bloc = ''; carrega(); };
    t.appendChild(sd); t.appendChild(sc);
    c.appendChild(t);
    app.appendChild(c);

    var fa = el('div', 'bloc-of');
    fa.appendChild(el('h4', null, 'Fitxatges d\'avui'));
    E.fitxatgesAvui.forEach(function (x) {
      fa.appendChild(el('div', 'lin' + (x.fets.length ? '' : ' mal'), nomBonic(x.conductor) + ': ' +
        (x.fets.length ? x.fets.map(function (y) { return y.tipus + ' ' + y.hora; }).join(' · ') : 'encara no ha fitxat')));
    });
    app.appendChild(fa);

    if (E.jornadaVista.length) {
      var jv = el('div', 'bloc-of');
      jv.appendChild(el('h4', null, 'Fitxatges de ' + nomBonic(E.conductor) + ' · ' + curta(E.data)));
      E.jornadaVista.forEach(function (f) {
        var l = el('div', 'lin', f.tipus + ' ' + f.hora + ' ');
        l.appendChild(boto('petit', function () { corregeix(f); }, 'Corregeix'));
        jv.appendChild(l);
      });
      app.appendChild(jv);
    }

    E.incompletes.forEach(function (p) {
      var b = el('div', 'bloc-of');
      b.appendChild(el('h4', null, 'Jornada oberta · ' + nomBonic(p.conductor) + ' · ' + diaSetmana(p.data)));
      b.appendChild(el('div', 'lin', p.fets.length ? p.fets.map(function (f) { return f.tipus + ' ' + f.hora; }).join(' · ') : 'Cap fitxatge aquest dia.'));
      var camps = {};
      p.falten.forEach(function (tipus) {
        var lb = el('div', 'lin', tipus + ' ');
        var i = el('input'); i.type = 'time'; i.value = p.proposta[tipus] || ''; camps[tipus] = i;
        lb.appendChild(i); b.appendChild(lb);
      });
      b.appendChild(boto('petit blau', function () {
        var hores = {}; Object.keys(camps).forEach(function (k) { hores[k] = camps[k].value; });
        fes('completaJornada', [p.conductor, p.data, hores]).catch(function () {});
      }, 'Valida'));
      if (!p.fets.length) b.appendChild(boto('petit', function () { fes('marcaSenseJornada', [p.conductor, p.data]).catch(function () {}); }, 'No va treballar'));
      app.appendChild(b);
    });

    app.appendChild(fullRuta());
  }

  function corregeix(f) {
    var d = document.getElementById('dialeg'), c = document.getElementById('caixa');
    c.innerHTML = '';
    c.appendChild(el('p', null, 'Hora correcta de «' + f.tipus + '».\nDeixa-ho en blanc per anul·lar-lo' +
      (/pausa/.test(f.tipus) ? ' (s\'anul·larà tota la pausa).' : '.')));
    var i = el('input', 'camp'); i.type = 'time'; i.value = f.hora; c.appendChild(i);
    var bs = el('div', 'botons2');
    bs.appendChild(boto('no', function () { d.classList.remove('obert'); }, 'Cancel·la'));
    bs.appendChild(boto('si', function () {
      d.classList.remove('obert');
      fes('corregeixFitxatge', [E.conductor, E.data, f.id, i.value]).catch(function () {});
    }, 'Desa'));
    c.appendChild(bs);
    d.classList.add('obert');
  }

  // ───────── Inici ─────────
  // Si l'app es queda oberta d'un dia per l'altre, en tornar-hi es recarrega.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !E || enviant || document.getElementById('capa').classList.contains('oberta')) return;
    if (avuiMobil() !== E.avui || Date.now() - darreraCarrega > 5 * 60000) carrega();
  });
  window.addEventListener('resize', function () { setTimeout(ajustaNoms, 50); });
  // Cada 2 minuts, si l'app és a la vista i no s'està fent res, es demanen les dades noves a Google
  // (així es veuen les faltes que marquen l'oficina o l'altre conductor).
  setInterval(function () {
    if (document.hidden || !E || ocupat || enviant) return;
    if (document.getElementById('capa').classList.contains('oberta') || document.getElementById('dialeg').classList.contains('obert')) return;
    carrega();
  }, 2 * 60000);
  // Si s'obre un enllaç amb clau mentre l'app ja és oberta.
  window.addEventListener('hashchange', function () {
    var k = clauDe(location.hash);
    if (!k) return;
    clau = k; desaClau(k); history.replaceState(null, '', location.pathname); carrega(true);
  });

  if (!clau) pintaSenseClau(false);
  else carrega(true);
})();
