/*
 * ELSA — BANC DE PROVES (prototip.html). Fa veure que és Google, però tot queda dins del mòbil
 * i s'esborra en tornar a començar. No envia res a cap lloc. Noms i centres inventats.
 *
 * L'app és la mateixa (app.js): qualsevol canvi a l'app dels conductors també surt aquí.
 * Tres tocs seguits a «Associació Elsa» (a dalt) tornen a la pantalla d'inici.
 */
(function () {
  'use strict';

  // Usuaris inventats (nom + primer cognom, com a la ruta). N'hi ha de llargs per veure com hi caben.
  var NOMS = ['MARIA PUIG', 'JOAN FERRER', 'MONTSERRAT VILA', 'JOSEP SOLER', 'CARME ROCA', 'PERE CASAS',
    'ROSA FONT', 'ANTONI SERRA', 'TERESA PRAT', 'FRANCESC BOSCH', 'NÚRIA COSTA', 'JAUME RIBAS',
    'DOLORS MAS', 'LLUÍS PONS', 'ENGRÀCIA COMAS', 'RAMON VIDAL'];
  var NOMS_LLARGS = ['MARIA DEL CARME FONTANILLES', 'JOSEP MARIA CASTELLVÍ-PUIGDEMASA', 'MARIA DELS ÀNGELS BARCELONETA',
    'FRANCESC XAVIER VILADECAVALLS'];
  var CENTRES = ['LES ROSES', 'EL ROURE', 'SANT NARCÍS'];
  var MOTIUS = ['Visita mèdica', 'S\'ha dormit', 'Assumptes personals', 'No ha volgut', 'No ho sabem', 'Altres'];
  var DIES = ['diumenge', 'dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte'];

  var S = null;   // l'estat inventat
  var seguent = 1;

  function dosX(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + dosX(d.getMonth() + 1) + '-' + dosX(d.getDate()); }
  function avui() { return iso(new Date()); }
  function araHora() { var d = new Date(); return dosX(d.getHours()) + ':' + dosX(d.getMinutes()); }
  function diaAnterior(isoD) {
    var p = isoD.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], 12);
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return iso(d);
  }
  function remena(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function atzar(p) { return Math.random() < p; }
  function curta(i) { return i.slice(8, 10) + '/' + i.slice(5, 7); }
  function nouId() { return 'p' + (seguent++); }

  // Una ruta nova a l'atzar: MATÍ (anades), MIGDIA (tornades i anades), TARDA (tornades).
  function rutaNova() {
    var persones = remena(NOMS).slice(0, 12).map(function (n, k) {
      return { soci: String(2001 + k), nom: n, centre: CENTRES[k % CENTRES.length], nou: atzar(0.1), cadira: atzar(0.2), aniversari: false };
    });
    // Sempre hi ha d'haver almenys un NOU i una CADIRA.
    if (!persones.some(function (p) { return p.nou; })) persones[3].nou = true;
    if (!persones.some(function (p) { return p.cadira; })) persones[6].cadira = true;
    // Un o dos aniversaris.
    remena(persones).slice(0, atzar(0.5) ? 1 : 2).forEach(function (p) { p.aniversari = true; });
    // De tant en tant (1 de cada 3), el cas difícil: nom llarg + NOU + CADIRA + 🎂.
    if (atzar(1 / 3)) {
      var q = persones.filter(function (p) { return p.aniversari; })[0];   // un dels que ja fan anys (així n'hi ha 1 o 2)
      q.nom = NOMS_LLARGS[Math.floor(Math.random() * NOMS_LLARGS.length)];
      q.nou = q.cadira = q.aniversari = true;
    }
    var ruta = [];
    function parada(bloc, hora, p, trajecte) {
      ruta.push({ bloc: bloc, hora: hora, tipus: 'Usuari', soci: p.soci, nom: p.nom, centre: p.centre, trajecte: trajecte,
        faltes: [], futures: [], nou: p.nou, cadira: p.cadira, aniversari: p.aniversari });
    }
    function centre(bloc, hora, nom) { ruta.push({ bloc: bloc, hora: hora, tipus: 'Centre', nom: nom, faltes: [] }); }
    var mati = persones.slice(0, 8), tarda = persones.slice(4, 12);
    var h = 8 * 60;
    mati.forEach(function (p, k) { parada('MATÍ', dosX(Math.floor(h / 60)) + ':' + dosX(h % 60), p, 'Anada'); h += 10; if (k === 3) { centre('MATÍ', dosX(Math.floor(h / 60)) + ':' + dosX(h % 60), CENTRES[0]); h += 10; } });
    centre('MATÍ', dosX(Math.floor(h / 60)) + ':' + dosX(h % 60), CENTRES[1]);
    parada('MIGDIA', '13:00', persones[0], 'Tornada');
    parada('MIGDIA', '13:15', persones[1], 'Tornada');
    centre('MIGDIA', '13:40', CENTRES[2]);
    parada('MIGDIA', '14:00', persones[10], 'Anada');
    parada('MIGDIA', '14:20', persones[11], 'Anada');
    h = 17 * 60;
    tarda.forEach(function (p, k) { if (k === 0) { centre('TARDA', '16:50', CENTRES[1]); } parada('TARDA', dosX(Math.floor(h / 60)) + ':' + dosX(h % 60), p, 'Tornada'); h += 10; });
    return ruta;
  }

  // Torna a començar: conductor nou, ruta nova, cap fitxatge. A vegades, "ahir no va fitxar la sortida".
  function reinicia() {
    var a = avui(), ant = diaAnterior(a);
    var oblit = atzar(1 / 3);
    var fetsAnt = [
      { id: nouId(), tipus: 'Entrada', hora: '07:32', potDesfer: false, origen: 'App' },
      { id: nouId(), tipus: 'Inici pausa', hora: '11:05', potDesfer: false, origen: 'App' },
      { id: nouId(), tipus: 'Fi pausa', hora: '11:35', potDesfer: false, origen: 'App' },
    ];
    if (!oblit) fetsAnt.push({ id: nouId(), tipus: 'Sortida', hora: '15:41', potDesfer: false, origen: 'App' });
    S = { nom: 'PROTOTIP', avui: a, anterior: ant, fets: [], fetsAnt: fetsAnt, ajustables: oblit ? [{ data: ant, sortida: '15:41' }] : [], ruta: rutaNova() };
  }

  function jornadaAmbDesfer(fets) {
    // Es pot desfer l'últim fitxatge durant 10 minuts.
    return fets.map(function (f, k) {
      var c = JSON.parse(JSON.stringify(f));
      c.potDesfer = k === fets.length - 1 && f.origen === 'App' && Date.now() - (f.quan || 0) < 10 * 60000;
      return c;
    });
  }

  function estat() {
    if (!S || S.avui !== avui()) reinicia();
    var r = { qui: { nom: S.nom, rol: 'Conductor' }, avui: S.avui, data: S.avui, conductor: S.nom,
      motius: MOTIUS, motiuAmbText: 'Altres', maxText: 80, trajectes: ['Tot el dia', 'Anada', 'Tornada'],
      tipusFalta: ['Només aquest dia', 'Fins a una data', 'Fins a nou avís'], minutsJornada: 459, minutsAvis: 510,
      jornada: { fets: jornadaAmbDesfer(S.fets) },
      recents: S.fetsAnt.length ? [{ data: S.anterior, fets: S.fetsAnt }] : [],
      ajustables: S.ajustables.slice() };
    // Com a l'app de veritat: la ruta no es veu fins que s'ha començat la jornada.
    r.ruta = S.fets.length ? JSON.parse(JSON.stringify(S.ruta)) : [];
    return r;
  }

  function minuts(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function ordena(fets) { fets.sort(function (x, y) { return minuts(x.hora) - minuts(y.hora); }); }

  var ACCIONS = {
    fitxa: function (tipus, opcions) {
      opcions = opcions || {};
      if (tipus === 'Entrada' && opcions.ajusta && opcions.ajusta.length && !S.fets.length) {
        S.fetsAnt.push({ id: nouId(), tipus: 'Sortida', hora: S.ajustables[0].sortida, potDesfer: false, origen: 'Completat pel conductor' });
        S.ajustables = [];
      } else if (tipus === 'Entrada') S.ajustables = [];
      var hora = tipus === 'Sortida' && opcions.ajust8h && opcions.hora ? opcions.hora : araHora();
      S.fets.push({ id: nouId(), tipus: tipus, hora: hora, origen: opcions.ajust8h ? 'Completat pel conductor' : 'App', quan: Date.now() });
      return { ok: true };
    },
    desfesFitxatge: function () { S.fets.pop(); return { ok: true }; },
    corregeixFitxatge: function (_c, data, id, hora, comentari) {
      var llista = data === S.avui ? S.fets : S.fetsAnt;
      llista.forEach(function (f) {
        if (f.id === id) { f.hora = hora; f.modificat = true; f.comentari = comentari || ''; f.origen = 'Corregit pel conductor'; f.quan = 0; }
      });
      ordena(llista);
      return { ok: true };
    },
    marcaFalta: function (f) {
      var falta = { id: nouId(), soci: f.soci, nom: f.nom, trajecte: f.trajecte, tipus: f.tipus, motiu: f.motiu === 'Altres' ? 'Altres: ' + f.altres : f.motiu,
        finsAl: f.tipus === 'Fins a una data' ? f.finsAl : '', marcatPer: S.nom };
      S.ruta.forEach(function (p) {
        if (p.soci !== f.soci) return;
        if (f.dia) p.futures.push({ id: falta.id, soci: f.soci, nom: f.nom, dia: f.dia, trajecte: f.trajecte, tipus: 'Només aquest dia', motiu: falta.motiu, marcatPer: S.nom });
        else p.faltes.push(JSON.parse(JSON.stringify(falta)));
      });
      return { ok: true, whatsapp: missatge(f) };
    },
    anullaFalta: function (id) {
      S.ruta.forEach(function (p) {
        p.faltes = p.faltes.filter(function (x) { return x.id !== id; });
        if (p.futures) p.futures = p.futures.filter(function (x) { return x.id !== id; });
      });
      return { ok: true };
    },
    tornaAVenir: function (id, des) {
      if (des <= S.avui) ACCIONS.anullaFalta(id);
      return { ok: true };
    },
  };

  // El mateix text que fa Google per al WhatsApp (sense motiu).
  function missatge(f) {
    var p = S.ruta.filter(function (x) { return x.soci === f.soci; })[0] || {};
    var dia = f.dia || S.avui;
    var pp = dia.split('-'), nomDia = DIES[new Date(+pp[0], +pp[1] - 1, +pp[2], 12).getDay()];
    var quan = dia === S.avui ? 'avui' : 'el ' + nomDia + ' ' + curta(dia);
    var desDe = dia === S.avui ? 'des d\'avui' : 'des del ' + nomDia + ' ' + curta(dia);
    var que = f.trajecte === 'Anada' ? 'no farà l\'anada al centre ' + p.centre
      : f.trajecte === 'Tornada' ? 'no farà la tornada des del centre ' + p.centre : 'no anirà al centre ' + p.centre;
    if (f.tipus === 'Fins a nou avís') return f.nom + ' ' + que + ' fins a nou avís (' + desDe + ').';
    if (f.tipus === 'Fins a una data') return f.nom + ' ' + que + ' ' + desDe + ' fins al ' + curta(f.finsAl) + ' (inclòs).';
    return f.nom + ' ' + quan + ' ' + que + '.';
  }

  // Respon com Google, amb una petita espera perquè es vegi igual que de veritat.
  function respon(valor) { return new Promise(function (r) { setTimeout(function () { r(valor); }, 250 + Math.random() * 350); }); }

  window.ELSA_PROTOTIP = {
    api: function (op, args) {
      if (op === 'estat') return respon({ ok: true, estat: estat() });
      if (!ACCIONS[op]) return respon({ ok: false, error: 'Al prototip no es fa' }).then(function (r) { throw new Error(r.error); });
      var res = ACCIONS[op].apply(null, args || []);
      return respon({ ok: true, resultat: { res: res, estat: estat() } });
    },
    reinicia: reinicia,
  };
})();
