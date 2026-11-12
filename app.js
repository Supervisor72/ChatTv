/* Chat TV - Versione 1.3 (videochiamate in chiamata.js, diagnostica in diagnostica.js) - chat testo, messaggi rapidi, dettatura, vocali e foto da webcam (Firebase Realtime Database) */
(function () {
  'use strict';

  var AVATAR = ['😀', '😎', '🦁', '🐼', '🦊', '🐸', '🐱', '🐶', '🦄', '🐧', '⚽', '🎸', '🌻', '🚀', '🍕', '⭐'];
  var RAPIDI = ['Ciao! 👋', 'Come va?', 'Tutto bene 👍', 'A tavola, è pronto! 🍝', 'Chiamami 📞',
    'Sto arrivando', 'Ci vediamo dopo', 'Buonanotte 🌙', 'Ti voglio bene ❤️'];
  var STANZE = ['Salotto', 'Soggiorno', 'Cucina', 'Camera da letto', 'Cameretta',
    'Studio', 'Taverna', 'Mansarda', 'Camera ospiti', 'Ufficio'];
  var EMOJI = ['👍', '❤️', '😂', '😍', '😮', '😢', '🎉', '👋', '🙏', '⚽', '🍕', '😴'];

  // Per provare due "TV" nello stesso browser: index.html?profilo=2
  var parametro = new URLSearchParams(location.search).get('profilo') || '';
  var CHIAVE = 'chattv_profilo' + parametro;

  var profilo = leggiProfilo();
  var db = null, gruppoRef = null, mioRef = null, refMessaggi = null;
  var utenti = {}, ultimi = {}, letti = {};
  var primoCaricamento = true;
  var chatAperta = null;
  var schermata = 's-avvio';
  var avatarScelto = AVATAR[0];
  var stanzaScelta = '';
  var staccaAscolto = [];
  var ultimoGiorno = null;
  var TS = null;

  // TV o tablet? Sulla TV si usa sempre il telecomando (anche se il browser interno dichiara il touch).
  // "tablet" = misure per schermi da tenere in mano; "tocco" = niente bagliore del cursore finché si usa il dito.
  var radice = document.documentElement;
  var eTV = false;
  try { eTV = !!(window.Android && Android.isTV && Android.isTV()); } catch (e) { eTV = false; }
  var schermoTouch = !eTV && (navigator.maxTouchPoints || 0) > 0 &&
    !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (schermoTouch) { radice.classList.add('tablet'); radice.classList.add('tocco'); }
  // Computer (Mac/PC nel browser): misure da scrivania, uso con mouse e tastiera
  var eDesktop = !eTV && !schermoTouch && !window.Android;
  if (eDesktop) { radice.classList.add('desktop'); radice.classList.add('tocco'); }
  if (!eTV) document.addEventListener('touchstart', function () { radice.classList.add('tocco'); }, { passive: true });
  if (eDesktop) document.addEventListener('mousedown', function () { radice.classList.add('tocco'); }, true);
  if (eDesktop || schermoTouch) {
    document.addEventListener('DOMContentLoaded', function () {
      var c = document.getElementById('in-testo');
      if (c) c.placeholder = 'Scrivi un messaggio…';
    });
  }
  // Qualsiasi tasto del telecomando/tastiera fa ricomparire subito il cursore
  document.addEventListener('keydown', function (e) {
    if (/^Arrow|^Enter$|^Escape$|^Tab$/.test(e.key)) radice.classList.remove('tocco');
  }, true);

  // Agganci per i moduli aggiuntivi (chiamata.js, diagnostica.js)
  var estensioni = { overlay: [], indietro: [], entra: [], scollega: [], utenti: [], impostazioni: [] };

  function $(id) { return document.getElementById(id); }
  function leggiProfilo() { try { return JSON.parse(localStorage.getItem(CHIAVE)); } catch (e) { return null; } }
  function salvaProfilo(p) { localStorage.setItem(CHIAVE, JSON.stringify(p)); }
  function idCasuale() { return 'tv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pulisciCodice(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function chatIdDi(a, b) { return [a, b].sort().join('_'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function due(n) { return (n < 10 ? '0' : '') + n; }
  function ora(ts) { var d = new Date(ts); return due(d.getHours()) + ':' + due(d.getMinutes()); }
  function etichettaGiorno(ts) {
    var d = new Date(ts), oggi = new Date(), ieri = new Date();
    ieri.setDate(oggi.getDate() - 1);
    if (d.toDateString() === oggi.toDateString()) return 'Oggi';
    if (d.toDateString() === ieri.toDateString()) return 'Ieri';
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function testoStato(u) {
    if (!u) return '';
    if (u.online) return 'Online';
    if (!u.visto) return 'Offline';
    var g = etichettaGiorno(u.visto);
    return 'Visto ' + (g === 'Oggi' ? 'oggi' : g === 'Ieri' ? 'ieri' : g) + ' alle ' + ora(u.visto);
  }

  // =============== NAVIGAZIONE COL TELECOMANDO ===============

  function visibileNelContenitore(el, sc) {
    var a = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    return a.bottom > b.top + 4 && a.top < b.bottom - 4;
  }

  // contenitore: se indicato, restituisce solo gli elementi visibili dentro l'area messaggi
  function focusabili(contenitore) {
    var att;
    if (contenitore) att = contenitore;
    else if (tendinaAperta()) att = $('elenco-stanze');
    else if (overlayEstensioni()) att = overlayEstensioni();
    else if (pannelloAperto()) att = $('pannello');
    else att = document.querySelector('.schermata.attiva');
    if (!att) return [];
    return Array.prototype.filter.call(att.querySelectorAll('.nav'), function (el) {
      if (el.offsetParent === null || el.disabled) return false;
      var sc = el.parentElement ? el.parentElement.closest('.scorrevole') : null;
      if (sc && !contenitore) return false; // nei messaggi si entra con OK
      if (sc && contenitore) return visibileNelContenitore(el, sc);
      return true;
    });
  }

  function metti(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function muovi(dir, lista) {
    var els = lista || focusabili();
    if (!els.length) return false;
    var cur = document.activeElement;
    if (els.indexOf(cur) < 0 && (!cur || cur === document.body || cur.offsetParent === null)) { metti(els[0]); return true; }
    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var migliore = null, punteggio = Infinity;
    els.forEach(function (el) {
      if (el === cur) return;
      var q = el.getBoundingClientRect();
      var x = q.left + q.width / 2, y = q.top + q.height / 2;
      var principale, laterale;
      if (dir === 'su' || dir === 'giu') {
        if (dir === 'su' && !(y < cy - 4)) return;
        if (dir === 'giu' && !(y > cy + 4)) return;
        principale = Math.max(0, dir === 'giu' ? q.top - r.bottom : r.top - q.bottom) + Math.abs(y - cy) * 0.1;
        laterale = (q.left < r.right && q.right > r.left) ? 0 : Math.min(Math.abs(q.left - r.right), Math.abs(r.left - q.right));
      } else {
        if (dir === 'sx' && !(x < cx - 4)) return;
        if (dir === 'dx' && !(x > cx + 4)) return;
        principale = Math.max(0, dir === 'dx' ? q.left - r.right : r.left - q.right) + Math.abs(x - cx) * 0.1;
        laterale = (q.top < r.bottom && q.bottom > r.top) ? 0 : Math.min(Math.abs(q.top - r.bottom), Math.abs(r.top - q.bottom));
      }
      var p = principale + laterale * 3;
      if (p < punteggio) { punteggio = p; migliore = el; }
    });
    if (migliore) { metti(migliore); return true; }
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (e.key === 'Escape') { window.tvIndietro(); e.preventDefault(); return; }

    var cur = document.activeElement;
    var box = $('messaggi');

    // OK sull'area messaggi: entra tra foto e vocali (parte dal più recente visibile)
    if (e.key === 'Enter' && cur === box && !pannelloAperto()) {
      var dentro = focusabili(box);
      if (dentro.length) metti(dentro[dentro.length - 1]);
      e.preventDefault();
      return;
    }

    var dir = { ArrowUp: 'su', ArrowDown: 'giu', ArrowLeft: 'sx', ArrowRight: 'dx' }[e.key];
    if (!dir) return;

    // Dentro un campo di testo, sinistra/destra muovono il cursore finché non si arriva al bordo
    if (cur && cur.tagName === 'INPUT' && (dir === 'sx' || dir === 'dx')) {
      var pos = cur.selectionStart, len = cur.value.length;
      if ((dir === 'sx' && pos > 0) || (dir === 'dx' && pos < len)) return;
    }

    if (pannelloAperto() || tendinaAperta() || overlayEstensioni()) { e.preventDefault(); muovi(dir); return; }

    // Su una foto o un vocale dentro i messaggi: ci si muove tra di essi, scorrendo se serve
    if (cur && cur !== box && box.contains(cur)) {
      e.preventDefault();
      if (muovi(dir, focusabili(box))) return;
      if (dir === 'su' || dir === 'giu') {
        var p0 = box.scrollTop;
        box.scrollTop += (dir === 'giu' ? 1 : -1) * box.clientHeight * 0.6;
        if (box.scrollTop !== p0) { if (!muovi(dir, focusabili(box))) metti(box); return; }
        metti(box);
        muovi(dir);
      }
      return;
    }

    // Nell'area messaggi, su/giù fanno scorrere la conversazione
    if (cur && cur.classList && cur.classList.contains('scorrevole') && (dir === 'su' || dir === 'giu')) {
      var prima = cur.scrollTop;
      cur.scrollTop += (dir === 'giu' ? 1 : -1) * cur.clientHeight * 0.6;
      if (cur.scrollTop !== prima) { e.preventDefault(); return; }
    }

    e.preventDefault();
    muovi(dir);
  });

  function mostra(id, focus) {
    Array.prototype.forEach.call(document.querySelectorAll('.schermata'), function (s) {
      s.classList.toggle('attiva', s.id === id);
    });
    schermata = id;
    setTimeout(function () {
      var el = typeof focus === 'string' ? $(focus) : focus;
      metti(el || focusabili()[0]);
    }, 40);
  }

  // Chiamata dal tasto Indietro del telecomando (true = gestito, false = chiudi app)
  function overlayEstensioni() {
    for (var i = 0; i < estensioni.overlay.length; i++) { var el = estensioni.overlay[i](); if (el) return el; }
    return null;
  }

  window.tvIndietro = function () {
    for (var i = 0; i < estensioni.indietro.length; i++) { if (estensioni.indietro[i]()) return true; }
    if (tendinaAperta()) { chiudiTendina(); return true; }
    if (pannelloAperto()) { chiudiPannello(); return true; }
    var a = document.activeElement, box = $('messaggi');
    if (schermata === 's-chat' && a && a !== box && box.contains(a)) { metti(box); return true; }
    if (schermata === 's-chat') { chiudiChat(); return true; }
    if (schermata === 's-impostazioni') { mostra('s-home', 'btn-impostazioni'); return true; }
    if (schermata === 's-setup' && gruppoRef) { mostra('s-impostazioni', 'btn-modifica'); return true; }
    return false;
  };

  // =============== NOTIFICHE ===============

  var audioCtx = null;
  function suona() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime;
      [880, 1320].forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain(), s = t + i * 0.15;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(s); o.stop(s + 0.32);
      });
    } catch (e) { /* audio non disponibile */ }
  }

  var timerToast = null;
  function toast(testo) {
    var t = $('toast');
    t.textContent = testo;
    t.classList.add('visibile');
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { t.classList.remove('visibile'); }, 4500);
  }

  // =============== AVVIO ===============

  function errore(titolo, testo) {
    $('err-titolo').textContent = titolo;
    $('err-testo').textContent = testo;
    mostra('s-errore', 'btn-riprova');
  }

  function costruisciStatici() {
    $('avatar-griglia').innerHTML = AVATAR.map(function (a) {
      return '<button class="nav" data-avatar="' + a + '">' + a + '</button>';
    }).join('');
    // Una sola riga compatta: prima le emoji, poi le frasi rapide
    $('rapidi').innerHTML = EMOJI.map(function (r) {
      return '<button class="nav emoji" data-testo="' + r + '">' + r + '</button>';
    }).join('') + RAPIDI.map(function (r) {
      return '<button class="nav" data-testo="' + esc(r) + '">' + esc(r) + '</button>';
    }).join('');

    $('elenco-stanze').innerHTML = STANZE.map(function (st) {
      return '<button class="nav" type="button" data-stanza="' + esc(st) + '">' + esc(st) + '</button>';
    }).join('');
    $('btn-stanza').onclick = function () { if (tendinaAperta()) chiudiTendina(); else apriTendina(); };
    $('elenco-stanze').addEventListener('click', function (e) {
      var b = e.target.closest('[data-stanza]');
      if (!b) return;
      stanzaScelta = b.getAttribute('data-stanza');
      disegnaStanza();
      $('setup-msg').textContent = '';
      chiudiTendina();
    });
    document.addEventListener('click', function (e) {
      if (tendinaAperta() && !e.target.closest('.tendina')) $('elenco-stanze').classList.remove('aperta');
    });

    $('btn-riprova').onclick = function () { location.reload(); };

    $('avatar-griglia').addEventListener('click', function (e) {
      var b = e.target.closest('[data-avatar]');
      if (!b) return;
      avatarScelto = b.getAttribute('data-avatar');
      evidenziaAvatar();
    });
    $('btn-salva').onclick = salvaSetup;

    $('btn-impostazioni').onclick = apriImpostazioni;
    $('contatti').addEventListener('click', function (e) {
      var b = e.target.closest('[data-id]');
      if (b) apriChat(b.getAttribute('data-id'));
    });

    $('btn-indietro').onclick = chiudiChat;
    $('rapidi').addEventListener('click', clicInvio);
    $('btn-invia').onclick = inviaCampo;
    $('btn-foto').onclick = apriFoto;
    $('btn-vocale').onclick = apriVocale;
    $('btn-detta').onclick = detta;
    $('in-testo').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        if ($('in-testo').value.trim()) { e.preventDefault(); inviaCampo(); }
      }
    });

    $('btn-imp-indietro').onclick = function () { mostra('s-home', 'btn-impostazioni'); };
    $('btn-modifica').onclick = apriSetup;
    $('btn-aggiorna').onclick = function () {
      if (window.Android && Android.controllaAggiornamenti) Android.controllaAggiornamenti();
      else toast('Gli aggiornamenti funzionano solo nell\'app sulla TV');
    };
    $('btn-esci-gruppo').onclick = esciDalGruppo;
    $('btn-avvisi').onclick = function () {
      if (window.Android && Android.apriPermessoAvvisi) { Android.apriPermessoAvvisi(); return; }
      if (window.Notification) {
        var r = Notification.requestPermission(function () { aggiornaPulsanteAvvisi(); });
        if (r && r.then) r.then(function () { aggiornaPulsanteAvvisi(); });
      }
    };
  }

  function avvia() {
    costruisciStatici();
    if (typeof firebase === 'undefined') {
      errore('Nessuna connessione a Internet', 'Controlla che la TV sia collegata alla rete, poi premi Riprova.');
      return;
    }
    var cfg = window.FIREBASE_CONFIG || {};
    if (!cfg.apiKey || cfg.apiKey.indexOf('INCOLLA') === 0 || !cfg.databaseURL || cfg.databaseURL.indexOf('INCOLLA') >= 0) {
      errore('Firebase non configurato', 'Apri il file config.js e incolla i dati del tuo progetto Firebase.');
      return;
    }
    try {
      firebase.initializeApp(cfg);
      db = firebase.database();
      TS = firebase.database.ServerValue.TIMESTAMP;
    } catch (e) {
      errore('Firebase non risponde', String(e.message || e));
      return;
    }
    if (profilo && profilo.gruppo && profilo.nome && profilo.stanza) entra();
    else apriSetup();
  }

  // =============== PROFILO / SETUP ===============

  function evidenziaAvatar() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-avatar]'), function (b) {
      b.classList.toggle('scelto', b.getAttribute('data-avatar') === avatarScelto);
    });
  }

  function tendinaAperta() { return $('elenco-stanze').classList.contains('aperta'); }

  function disegnaStanza() {
    $('stanza-testo').textContent = stanzaScelta || 'Scegli la stanza';
    $('btn-stanza').classList.toggle('vuota', !stanzaScelta);
    Array.prototype.forEach.call(document.querySelectorAll('[data-stanza]'), function (b) {
      b.classList.toggle('scelta', b.getAttribute('data-stanza') === stanzaScelta);
    });
  }

  function apriTendina() {
    $('elenco-stanze').classList.add('aperta');
    metti($('elenco-stanze').querySelector('.scelta') || $('elenco-stanze').querySelector('button'));
  }

  function chiudiTendina() {
    $('elenco-stanze').classList.remove('aperta');
    metti($('btn-stanza'));
  }

  function apriSetup() {
    stanzaScelta = (profilo && profilo.stanza) || '';
    $('in-dettaglio').value = (profilo && profilo.dettaglio) || '';
    $('elenco-stanze').classList.remove('aperta');
    disegnaStanza();
    $('in-codice').value = profilo ? profilo.gruppo : '';
    avatarScelto = profilo ? profilo.avatar : AVATAR[0];
    evidenziaAvatar();
    $('setup-msg').textContent = '';
    $('btn-salva').textContent = profilo ? 'Salva modifiche' : 'Inizia a chattare';
    mostra('s-setup', 'btn-stanza');
  }

  function salvaSetup() {
    var dettaglio = $('in-dettaglio').value.trim();
    var codice = pulisciCodice($('in-codice').value);
    if (!stanzaScelta) { $('setup-msg').textContent = 'Scegli la stanza di questa TV.'; metti($('btn-stanza')); return; }
    var nome = stanzaScelta + (dettaglio ? ' ' + dettaglio : '');
    if (codice.length < 4) { $('setup-msg').textContent = 'Il codice famiglia deve avere almeno 4 lettere o numeri.'; metti($('in-codice')); return; }

    var vecchio = profilo;
    var nuovo = { id: vecchio ? vecchio.id : idCasuale(), nome: nome, stanza: stanzaScelta, dettaglio: dettaglio, avatar: avatarScelto, gruppo: codice };
    scollega();
    if (vecchio && vecchio.gruppo !== codice) {
      db.ref('gruppi/' + vecchio.gruppo + '/utenti/' + vecchio.id).remove();
    }
    profilo = nuovo;
    salvaProfilo(profilo);
    entra();
  }

  function apriImpostazioni() {
    $('imp-avatar').textContent = profilo.avatar;
    $('imp-nome').textContent = profilo.nome;
    $('imp-codice').textContent = 'Codice famiglia: ' + profilo.gruppo;
    var v = (window.Android && Android.versione) ? Android.versione() : 'browser';
    $('imp-versione').textContent = 'Versione app: ' + v;
    $('btn-esci-gruppo').textContent = 'Esci dal gruppo famiglia';
    confermaUscita = false;
    aggiornaPulsanteAvvisi();
    estensioni.impostazioni.forEach(function (f) { f(); });
    mostra('s-impostazioni', 'btn-modifica');
  }

  var confermaUscita = false, timerUscita = null;
  function esciDalGruppo() {
    if (!confermaUscita) {
      confermaUscita = true;
      $('btn-esci-gruppo').textContent = 'Premi di nuovo OK per confermare';
      clearTimeout(timerUscita);
      timerUscita = setTimeout(function () {
        confermaUscita = false;
        $('btn-esci-gruppo').textContent = 'Esci dal gruppo famiglia';
      }, 4000);
      return;
    }
    var percorso = 'gruppi/' + profilo.gruppo + '/utenti/' + profilo.id;
    if (window.Android && Android.fermaAscolto) Android.fermaAscolto();
    scollega();
    db.ref(percorso).remove();
    localStorage.removeItem(CHIAVE);
    profilo = null;
    apriSetup();
  }

  // =============== COLLEGAMENTO AL GRUPPO ===============

  function scollega() {
    estensioni.scollega.forEach(function (f) { f(); });
    staccaAscolto.forEach(function (f) { f(); });
    staccaAscolto = [];
    if (refMessaggi) { refMessaggi.off(); refMessaggi = null; }
    if (mioRef) {
      mioRef.onDisconnect().cancel();
      mioRef.update({ online: false, visto: TS });
      mioRef = null;
    }
    gruppoRef = null;
    utenti = {}; ultimi = {}; letti = {};
    primoCaricamento = true;
    chatAperta = null;
    pulizieFatte = {};
  }

  function entra() {
    gruppoRef = db.ref('gruppi/' + profilo.gruppo);
    mioRef = gruppoRef.child('utenti/' + profilo.id);
    var g = gruppoRef, io = mioRef;

    var connRef = db.ref('.info/connected');
    var suConn = connRef.on('value', function (s) {
      var collegato = s.val() === true;
      $('home-stato').textContent = collegato ? 'Collegato al gruppo ' + profilo.gruppo : 'Connessione in corso…';
      if (!collegato || io !== mioRef) return;
      io.onDisconnect().update({ online: false, visto: TS });
      io.update({ nome: profilo.nome, avatar: profilo.avatar, online: true, visto: TS });
    });

    var refUtenti = g.child('utenti');
    var suUtenti = refUtenti.on('value', function (s) {
      utenti = s.val() || {};
      disegnaContatti();
      aggiornaTestataChat();
      if (chatInSospeso && utenti[chatInSospeso]) { var cs = chatInSospeso; chatInSospeso = null; window.tvApriChat(cs); }
      estensioni.utenti.forEach(function (f) { f(); });
    });

    var refUltimi = g.child('ultimi');
    var suUltimi = refUltimi.on('value', function (s) {
      var nuovi = s.val() || {};
      Object.keys(nuovi).forEach(function (cid) {
        if (cid.split('_').indexOf(profilo.id) >= 0) pulisciMediaVecchi(cid);
      });
      controllaNuovi(nuovi);
      ultimi = nuovi;
      disegnaContatti();
    });

    var refLetti = g.child('letti/' + profilo.id);
    var suLetti = refLetti.on('value', function (s) {
      letti = s.val() || {};
      disegnaContatti();
    });

    staccaAscolto.push(function () {
      connRef.off('value', suConn);
      refUtenti.off('value', suUtenti);
      refUltimi.off('value', suUltimi);
      refLetti.off('value', suLetti);
    });

    estensioni.entra.forEach(function (f) { f(); });
    avviaAscoltoBackground();

    $('home-avatar').textContent = profilo.avatar;
    $('home-nome').textContent = profilo.nome;
    mostra('s-home', $('contatti').querySelector('.contatto'));
  }

  function controllaNuovi(nuovi) {
    if (primoCaricamento) { primoCaricamento = false; return; }
    Object.keys(nuovi).forEach(function (cid) {
      var m = nuovi[cid];
      if (!m || m.da === profilo.id) return;
      if (cid.split('_').indexOf(profilo.id) < 0) return;
      var prima = ultimi[cid];
      if (prima && prima.ts === m.ts) return;
      if (chatAperta && chatAperta.chatId === cid && schermata === 's-chat') return;
      var u = utenti[m.da] || {};
      toast((u.avatar || '💬') + ' ' + (u.nome || 'Nuovo messaggio') + ': ' + m.testo);
      suona();
      notificaComputer((u.avatar || '💬') + ' ' + (u.nome || 'Chat TV'), m.testo, m.da);
    });
  }

  // =============== CONTATTI ===============

  function disegnaContatti() {
    if (!profilo) return;
    var box = $('contatti');
    var att = document.activeElement;
    var idFocus = (att && att.getAttribute && schermata === 's-home') ? att.getAttribute('data-id') : null;

    var ids = Object.keys(utenti).filter(function (id) { return id !== profilo.id; });
    ids.sort(function (a, b) {
      var ua = ultimi[chatIdDi(profilo.id, a)], ub = ultimi[chatIdDi(profilo.id, b)];
      var ta = ua ? ua.ts : 0, tb = ub ? ub.ts : 0;
      if (tb !== ta) return tb - ta;
      return String(utenti[a].nome || '').localeCompare(String(utenti[b].nome || ''));
    });

    box.innerHTML = ids.map(function (id) {
      var u = utenti[id] || {};
      var cid = chatIdDi(profilo.id, id);
      var ul = ultimi[cid];
      var nuovo = ul && ul.da !== profilo.id && (!letti[cid] || letti[cid] < ul.ts);
      var anteprima = ul ? (ul.da === profilo.id ? 'Tu: ' : '') + ul.testo : 'Nessun messaggio';
      return '<button class="nav contatto' + (u.online ? ' online' : '') + '" data-id="' + esc(id) + '">' +
        '<span class="avatar grande">' + esc(u.avatar || '📺') + '</span>' +
        '<span class="c-nome">' + esc(u.nome || 'TV') + '</span>' +
        '<span class="c-stato">' + esc(testoStato(u)) + '</span>' +
        '<span class="c-anteprima">' + esc(anteprima) + '</span>' +
        (nuovo ? '<span class="badge">Nuovo</span>' : '') +
        '</button>';
    }).join('');

    $('contatti-vuoto').style.display = ids.length ? 'none' : 'block';

    if (idFocus) {
      var el = box.querySelector('[data-id="' + idFocus + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  }

  // =============== CHAT ===============

  function apriChat(id) {
    var cid = chatIdDi(profilo.id, id);
    chatAperta = { id: id, chatId: cid };
    ultimoGiorno = null;
    $('messaggi').innerHTML = '<p class="vuoto" id="chat-vuota">Nessun messaggio. Scegli un messaggio rapido qui sotto per iniziare.</p>';
    $('in-testo').value = '';
    aggiornaTestataChat();

    refMessaggi = gruppoRef.child('chat/' + cid).limitToLast(150);
    refMessaggi.on('child_added', function (s) {
      aggiungiMessaggio(s.val(), s.key);
      segnaLetto();
    });
    pulisciMediaVecchi(cid);
    segnaLetto();
    mostra('s-chat', $('rapidi').querySelector('button'));
  }

  function chiudiChat() {
    var id = chatAperta ? chatAperta.id : null;
    fermaVocale();
    if (refMessaggi) { refMessaggi.off(); refMessaggi = null; }
    chatAperta = null;
    mostra('s-home', id ? $('contatti').querySelector('[data-id="' + id + '"]') : null);
  }

  function aggiornaTestataChat() {
    if (!chatAperta) return;
    var u = utenti[chatAperta.id] || {};
    $('chat-avatar').textContent = u.avatar || '📺';
    $('chat-nome').textContent = u.nome || 'TV';
    $('chat-stato').textContent = testoStato(u);
  }

  function soloEmoji(t) {
    return t.length <= 8 && !/[A-Za-z0-9À-ÿ]/.test(t);
  }

  function seguiFondo() {
    var box = $('messaggi'), a = document.activeElement;
    if (!(a && a !== box && box.contains(a))) box.scrollTop = box.scrollHeight;
  }

  function aggiungiMessaggio(m, key) {
    if (!m || !m.testo || !chatAperta) return;
    var cid = chatAperta.chatId;
    var tipo = m.tipo || 'testo';
    var box = $('messaggi');
    var vuota = $('chat-vuota');
    if (vuota) vuota.remove();

    var ts = typeof m.ts === 'number' ? m.ts : Date.now();
    var giorno = etichettaGiorno(ts);
    if (giorno !== ultimoGiorno) {
      ultimoGiorno = giorno;
      var sep = document.createElement('div');
      sep.className = 'giorno';
      sep.textContent = giorno;
      box.appendChild(sep);
    }
    var div = document.createElement('div');
    div.className = 'msg ' + (m.da === profilo.id ? 'mio' : 'altro');

    if (tipo === 'foto') {
      div.className += ' media';
      var bf = document.createElement('button');
      bf.className = 'nav btn-foto';
      bf.innerHTML = '<span class="caricamento">📷 Caricamento foto…</span>';
      div.appendChild(bf);
      caricaMedia(cid, key, function (d) {
        if (!d) { bf.innerHTML = '<span class="caricamento">📷 Foto non più disponibile</span>'; return; }
        var img = new Image();
        img.alt = 'Foto';
        img.onload = seguiFondo;
        img.src = d;
        bf.innerHTML = '';
        bf.appendChild(img);
        bf.onclick = function () { apriVisore(d); };
      });
    } else if (tipo === 'vocale') {
      div.className += ' media';
      var bv = document.createElement('button');
      bv.className = 'nav btn-vocale';
      var etichetta = '🎙️ Vocale ' + durataTesto(m.durata);
      bv.textContent = '▶ ' + etichetta;
      bv.onclick = function () { suonaVocale(cid, key, bv, etichetta); };
      div.appendChild(bv);
    } else {
      if (soloEmoji(m.testo)) div.className += ' solo-emoji';
      div.appendChild(document.createTextNode(m.testo));
    }

    var o = document.createElement('span');
    o.className = 'ora';
    o.textContent = ora(ts);
    div.appendChild(o);
    box.appendChild(div);
    seguiFondo();
  }

  function segnaLetto() {
    if (!chatAperta || !gruppoRef) return;
    gruppoRef.child('letti/' + profilo.id + '/' + chatAperta.chatId).set(TS);
  }

  var ultimoTesto = { t: '', c: '', alle: 0 };
  function invia(testo) {
    testo = String(testo || '').trim().slice(0, 300);
    if (!testo || !chatAperta || !gruppoRef) return;
    if (ultimoTesto.t === testo && ultimoTesto.c === chatAperta.chatId && Date.now() - ultimoTesto.alle < 1000) return;
    ultimoTesto = { t: testo, c: chatAperta.chatId, alle: Date.now() };
    var m = { da: profilo.id, testo: testo, ts: TS };
    gruppoRef.child('chat/' + chatAperta.chatId).push(m);
    gruppoRef.child('ultimi/' + chatAperta.chatId).set(m);
  }

  function clicInvio(e) {
    var b = e.target.closest('[data-testo]');
    if (b) invia(b.getAttribute('data-testo'));
  }

  function inviaCampo() {
    var t = $('in-testo').value;
    if (!t.trim()) { metti($('in-testo')); return; }
    invia(t);
    $('in-testo').value = '';
  }

  // =============== FOTO E VOCALI (salvati nel database, cancellati dopo 30 giorni) ===============

  var GIORNI_MEDIA = 30;
  var MAX_VOCALE = 60;
  var cacheMedia = {};
  var pulizieFatte = {};

  function durataTesto(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ':' + due(sec % 60);
  }

  function nomeInterlocutore() {
    return chatAperta ? ((utenti[chatAperta.id] || {}).nome || 'TV') : '';
  }

  function caricaMedia(cid, key, cb) {
    if (cacheMedia.hasOwnProperty(key)) { cb(cacheMedia[key]); return; }
    if (!gruppoRef) return;
    gruppoRef.child('media/' + cid + '/' + key + '/dati').once('value').then(function (s) {
      cacheMedia[key] = s.val();
      cb(s.val());
    }).catch(function () { cb(null); });
  }

  var ultimoInvio = { firma: '', alle: 0 };
  function giaInviato(firma) {
    var adesso = Date.now();
    if (firma === ultimoInvio.firma && adesso - ultimoInvio.alle < 4000) return true;
    ultimoInvio = { firma: firma, alle: adesso };
    return false;
  }

  function inviaMedia(tipo, dati, durata) {
    if (!chatAperta || !gruppoRef || !dati) return;
    if (giaInviato(tipo + ':' + chatAperta.chatId + ':' + dati.length + ':' + dati.slice(-64))) return;
    var cid = chatAperta.chatId;
    var ref = gruppoRef.child('chat/' + cid).push();
    var key = ref.key;
    cacheMedia[key] = dati;
    var m = { da: profilo.id, tipo: tipo, ts: TS };
    if (tipo === 'vocale') {
      m.durata = Math.round(durata || 0);
      m.testo = '🎙️ Vocale ' + durataTesto(durata);
    } else {
      m.testo = '📷 Foto';
    }
    toast('Invio in corso…');
    gruppoRef.child('media/' + cid + '/' + key).set({ dati: dati, ts: TS }).then(function () {
      return ref.set(m);
    }).then(function () {
      gruppoRef.child('ultimi/' + cid).set(m);
      toast(tipo === 'foto' ? 'Foto inviata' : 'Vocale inviato');
    }).catch(function (e) {
      toast('Invio non riuscito: ' + (e && e.message ? e.message : e));
    });
  }

  // Le chiavi dei messaggi contengono la data: si cancellano i media più vecchi di 30 giorni
  function chiavePerTempo(t) {
    var C = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', s = '';
    for (var i = 0; i < 8; i++) { s = C.charAt(t % 64) + s; t = Math.floor(t / 64); }
    return s;
  }

  function pulisciMediaVecchi(cid) {
    if (pulizieFatte[cid] || !gruppoRef) return;
    pulizieFatte[cid] = true;
    var limite = chiavePerTempo(Date.now() - GIORNI_MEDIA * 86400000);
    gruppoRef.child('media/' + cid).orderByKey().endAt(limite).limitToFirst(100).once('value').then(function (s) {
      s.forEach(function (c) { c.ref.remove(); });
    }).catch(function () { /* nessun problema: riproverà al prossimo avvio */ });
  }

  // ----- ascolto dei vocali ricevuti -----
  var audioVocale = null, bottoneVocale = null, etichettaVocale = '';

  function fermaVocale() {
    if (audioVocale) { audioVocale.pause(); audioVocale = null; }
    if (bottoneVocale) { bottoneVocale.textContent = '▶ ' + etichettaVocale; bottoneVocale = null; }
  }

  function suonaVocale(cid, key, btn, etichetta) {
    if (bottoneVocale === btn) { fermaVocale(); return; }
    fermaVocale();
    btn.textContent = '⏳ ' + etichetta;
    caricaMedia(cid, key, function (d) {
      if (!d) { btn.textContent = '🎙️ Vocale non più disponibile'; return; }
      audioVocale = new Audio(d);
      bottoneVocale = btn;
      etichettaVocale = etichetta;
      btn.textContent = '⏸ ' + etichetta;
      audioVocale.onended = fermaVocale;
      audioVocale.play().catch(function () { fermaVocale(); toast('Impossibile riprodurre il vocale'); });
    });
  }

  // ----- pannello webcam -----
  var pan = { modo: null, stream: null, recorder: null, pezzi: [], dati: null, durata: 0, timer: null, conto: null, inizio: 0, audio: null, ritorno: null };

  function pannelloAperto() { return $('pannello').classList.contains('aperto'); }

  function impostaSchermo(vista, registra) {
    var sc = document.querySelector('.pan-schermo');
    sc.classList.toggle('mostra-video', vista === 'video');
    sc.classList.toggle('mostra-foto', vista === 'foto');
    sc.classList.toggle('mostra-mic', vista === 'mic');
    sc.classList.toggle('registra', !!registra);
  }

  function azioni(lista) {
    var box = $('pan-azioni');
    box.innerHTML = '';
    lista.forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'nav' + (a.primario ? ' primario' : '');
      b.textContent = a.testo;
      // un solo clic per pulsante: il tasto OK del telecomando a volte arriva doppio
      var usato = false;
      b.onclick = function (e) {
        if (usato) return;
        usato = true;
        b.disabled = true;
        a.fai(e);
      };
      box.appendChild(b);
    });
    setTimeout(function () { metti(box.querySelector('button')); }, 30);
  }

  function statoPan(t) { $('pan-stato').textContent = t || ''; }

  function apriPannello(modo, titolo) {
    if (!pannelloAperto()) pan.ritorno = document.activeElement;
    pan.modo = modo;
    $('pannello').classList.toggle('visore', modo === 'visore');
    $('pan-titolo').textContent = titolo;
    $('pan-conto').textContent = '';
    statoPan('');
    $('pannello').classList.add('aperto');
  }

  function fermaStream() {
    if (pan.stream) { pan.stream.getTracks().forEach(function (t) { t.stop(); }); pan.stream = null; }
    $('pan-video').srcObject = null;
  }

  function chiudiPannello() {
    pan.chiusoAlle = Date.now();
    clearInterval(pan.timer); clearInterval(pan.conto);
    pan.timer = pan.conto = null;
    if (pan.recorder && pan.recorder.state !== 'inactive') {
      pan.recorder.onstop = null;
      try { pan.recorder.stop(); } catch (e) { /* già fermo */ }
    }
    pan.recorder = null;
    if (pan.audio) { pan.audio.pause(); pan.audio = null; }
    fermaStream();
    pan.modo = null;
    pan.dati = null;
    $('pannello').classList.remove('aperto');
    $('pan-foto').removeAttribute('src');
    if (pan.ritorno && document.body.contains(pan.ritorno) && pan.ritorno.offsetParent !== null) metti(pan.ritorno);
    else metti(focusabili()[0]);
  }

  function chiediMedia(vincoli) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: 'NoMedia' });
    return navigator.mediaDevices.getUserMedia(vincoli);
  }

  function erroreMedia(e, cosa) {
    var n = e && e.name;
    if (n === 'NoMedia') return 'Webcam e microfono non sono disponibili in questa pagina.';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permesso negato: consenti a Chat TV di usare ' + cosa + ' nelle impostazioni della TV.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nessuna webcam trovata. Collega la webcam USB alla TV e riprova.';
    if (n === 'NotReadableError') return 'La webcam è già usata da un\'altra app. Chiudila e riprova.';
    return 'Errore webcam: ' + (e && e.message ? e.message : n);
  }

  function fermaSeChiuso(modo, st) {
    if (pan.modo === modo) return false;
    st.getTracks().forEach(function (t) { t.stop(); });
    return true;
  }

  // ----- FOTO -----
  function rimbalzo() { return pan.chiusoAlle && Date.now() - pan.chiusoAlle < 600; }

  function apriFoto() {
    if (!chatAperta || rimbalzo()) return;
    apriPannello('foto', '📷 Foto per ' + nomeInterlocutore());
    impostaSchermo('video');
    statoPan('Accensione webcam…');
    azioni([{ testo: 'Annulla', fai: chiudiPannello }]);
    chiediMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: 'user' } }, audio: false }).then(function (st) {
      if (fermaSeChiuso('foto', st)) return;
      pan.stream = st;
      $('pan-video').srcObject = st;
      prontaFoto();
    }).catch(function (e) {
      impostaSchermo(null);
      statoPan(erroreMedia(e, 'la fotocamera'));
      azioni([{ testo: 'Chiudi', fai: chiudiPannello }]);
    });
  }

  function prontaFoto() {
    impostaSchermo('video');
    statoPan('Mettiti in posa: dopo OK hai 3 secondi');
    azioni([{ testo: '📸 Scatta', primario: true, fai: contoAllaRovescia }, { testo: 'Annulla', fai: chiudiPannello }]);
  }

  function contoAllaRovescia() {
    var n = 3;
    $('pan-conto').textContent = n;
    statoPan('');
    azioni([{ testo: 'Annulla', fai: chiudiPannello }]);
    pan.conto = setInterval(function () {
      n--;
      if (n > 0) { $('pan-conto').textContent = n; return; }
      clearInterval(pan.conto);
      pan.conto = null;
      $('pan-conto').textContent = '';
      scatta();
    }, 1000);
  }

  function scatta() {
    var v = $('pan-video');
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) { prontaFoto(); statoPan('La webcam non sta inviando immagini, riprova.'); return; }
    var f = Math.min(1, 1600 / Math.max(w, h)); // massimo 1600 px: nitida ma leggera
    var c = document.createElement('canvas');
    c.width = Math.round(w * f);
    c.height = Math.round(h * f);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    pan.dati = c.toDataURL('image/jpeg', 0.82);
    $('pan-foto').src = pan.dati;
    impostaSchermo('foto');
    statoPan('Foto ' + w + '×' + h + ' pronta da inviare');
    azioni([
      { testo: 'Invia', primario: true, fai: function () { var d = pan.dati; chiudiPannello(); inviaMedia('foto', d); } },
      { testo: 'Rifai', fai: prontaFoto },
      { testo: 'Annulla', fai: chiudiPannello }
    ]);
  }

  function apriVisore(d) {
    apriPannello('visore', '');
    $('pan-foto').src = d;
    impostaSchermo('foto');
    azioni([{ testo: 'Chiudi', primario: true, fai: chiudiPannello }]);
  }

  // ----- VOCALE -----
  function tipoAudio() {
    if (!window.MediaRecorder) return null;
    var tipi = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (!MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < tipi.length; i++) if (MediaRecorder.isTypeSupported(tipi[i])) return tipi[i];
    return '';
  }

  function apriVocale() {
    if (!chatAperta || rimbalzo()) return;
    apriPannello('vocale', '🎙️ Vocale per ' + nomeInterlocutore());
    impostaSchermo('mic');
    if (tipoAudio() === null) {
      statoPan('La registrazione audio non è supportata su questo dispositivo.');
      azioni([{ testo: 'Chiudi', fai: chiudiPannello }]);
      return;
    }
    statoPan('Accensione microfono…');
    azioni([{ testo: 'Annulla', fai: chiudiPannello }]);
    chiediMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(function (st) {
      if (fermaSeChiuso('vocale', st)) return;
      pan.stream = st;
      prontoVocale();
    }).catch(function (e) {
      statoPan(erroreMedia(e, 'il microfono'));
      azioni([{ testo: 'Chiudi', fai: chiudiPannello }]);
    });
  }

  function prontoVocale() {
    if (pan.audio) { pan.audio.pause(); pan.audio = null; }
    impostaSchermo('mic');
    $('pan-tempo').textContent = '0:00';
    statoPan('Parla verso la webcam. Massimo ' + MAX_VOCALE + ' secondi.');
    azioni([{ testo: '⏺ Registra', primario: true, fai: iniziaRegistrazione }, { testo: 'Annulla', fai: chiudiPannello }]);
  }

  function iniziaRegistrazione() {
    var tipo = tipoAudio();
    try {
      pan.recorder = tipo ? new MediaRecorder(pan.stream, { mimeType: tipo, audioBitsPerSecond: 32000 }) : new MediaRecorder(pan.stream);
    } catch (e) {
      statoPan('Registrazione non riuscita: ' + e.message);
      return;
    }
    pan.pezzi = [];
    pan.recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) pan.pezzi.push(ev.data); };
    pan.recorder.onstop = finitaRegistrazione;
    pan.recorder.start(250);
    pan.inizio = Date.now();
    impostaSchermo('mic', true);
    statoPan('Sto registrando…');
    azioni([{ testo: '⏹ Ferma', primario: true, fai: fermaRegistrazione }, { testo: 'Annulla', fai: chiudiPannello }]);
    pan.timer = setInterval(function () {
      var sec = (Date.now() - pan.inizio) / 1000;
      $('pan-tempo').textContent = durataTesto(sec);
      if (sec >= MAX_VOCALE) fermaRegistrazione();
    }, 250);
  }

  function fermaRegistrazione() {
    clearInterval(pan.timer);
    pan.timer = null;
    pan.durata = (Date.now() - pan.inizio) / 1000;
    if (pan.recorder && pan.recorder.state !== 'inactive') pan.recorder.stop();
  }

  function finitaRegistrazione() {
    var tipo = ((pan.recorder && pan.recorder.mimeType) || tipoAudio() || 'audio/webm').split(';')[0];
    var blob = new Blob(pan.pezzi, { type: tipo });
    pan.recorder = null;
    if (pan.durata < 1 || !blob.size) { prontoVocale(); statoPan('Troppo breve, riprova.'); return; }
    var r = new FileReader();
    r.onload = function () {
      if (pan.modo !== 'vocale') return;
      pan.dati = r.result;
      impostaSchermo('mic');
      statoPan('Vocale di ' + durataTesto(pan.durata) + ' pronto.');
      azioni([
        { testo: 'Invia', primario: true, fai: function () { var d = pan.dati, du = pan.durata; chiudiPannello(); inviaMedia('vocale', d, du); } },
        { testo: '▶ Riascolta', fai: riascolta },
        { testo: 'Rifai', fai: prontoVocale },
        { testo: 'Annulla', fai: chiudiPannello }
      ]);
    };
    r.readAsDataURL(blob);
  }

  function riascolta() {
    if (pan.audio) pan.audio.pause();
    pan.audio = new Audio(pan.dati);
    pan.audio.play().catch(function () { statoPan('Impossibile riprodurre il vocale.'); });
  }

  // =============== DETTATURA ===============

  function detta() {
    if (window.Android && Android.detta) {
      if (Android.puoDettare && !Android.puoDettare()) {
        toast('Dettatura non disponibile: usa il microfono della tastiera della TV');
        return;
      }
      Android.detta();
      return;
    }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Dettatura non disponibile in questo browser'); return; }
    var r = new SR();
    r.lang = 'it-IT';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = function (e) { window.tvDettato(e.results[0][0].transcript); };
    r.onerror = function (e) { toast('Dettatura non riuscita (' + e.error + ')'); };
    toast('🗣️ Parla ora…');
    r.start();
  }

  // Chiamata dall'app Android con il testo riconosciuto (null = dettatura non disponibile)
  window.tvDettato = function (testo) {
    if (testo === null) { toast('Dettatura non disponibile: usa il microfono della tastiera della TV'); return; }
    if (!testo) return;
    var c = $('in-testo');
    c.value = (c.value.trim() ? c.value.trim() + ' ' : '') + testo;
    metti($('btn-invia'));
  };

  // =============== AVVISI CON L'APP IN BACKGROUND ===============

  var avvisoMostrato = false;

  function avviaAscoltoBackground() {
    if (!(window.Android && Android.avviaAscolto)) return;
    var cfg = window.FIREBASE_CONFIG || {};
    Android.avviaAscolto(String(cfg.databaseURL || ''), profilo.gruppo, profilo.id);
    if (!avvisoMostrato && Android.avvisiAttivi && !Android.avvisiAttivi()) {
      avvisoMostrato = true;
      setTimeout(function () {
        toast('🔔 Per essere avvisato mentre guardi la TV: Impostazioni → Avvisi sopra le altre app');
      }, 2500);
    }
  }

  // ---- Notifiche del computer (Mac/PC): arrivano quando la finestra di Chat TV non è in primo piano ----
  function notificaComputer(titolo, testo, chatId) {
    if (window.Android || !window.Notification || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    try {
      var n = new Notification(titolo, { body: testo, tag: 'chattv-' + (chatId || 'avviso'), icon: 'icone/icona-192.png' });
      n.onclick = function () {
        window.focus();
        if (chatId) window.tvApriChat(chatId);
        n.close();
      };
    } catch (e) { /* notifiche non disponibili */ }
  }

  function aggiornaPulsanteAvvisi() {
    var b = $('btn-avvisi');
    if (!(window.Android && Android.avvisiAttivi)) {
      if (!window.Notification) { b.style.display = 'none'; return; }
      b.style.display = '';
      b.textContent = Notification.permission === 'granted' ? '🔔 Notifiche del computer: attive ✅'
        : Notification.permission === 'denied' ? '🔔 Notifiche bloccate: riattivale nelle impostazioni del browser'
          : '🔔 Notifiche del computer: da attivare (clic qui)';
      return;
    }
    b.style.display = '';
    b.textContent = Android.avvisiAttivi()
      ? '🔔 Avvisi sopra le altre app: attivi ✅'
      : '🔔 Avvisi sopra le altre app: da attivare (premi OK)';
  }

  // Chiamata dall'app Android quando si preme OK sull'avviso di un messaggio: apre la chat con chi ha scritto
  var chatInSospeso = null;
  window.tvApriChat = function (id) {
    if (!id || !profilo || !gruppoRef) { chatInSospeso = id; return; }
    if (schermata === 's-chiamata' || schermata === 's-setup') return; // non interrompe chiamate o configurazione
    if (!utenti[id]) { chatInSospeso = id; return; } // contatti non ancora caricati: si apre appena arrivano
    if (pannelloAperto()) chiudiPannello();
    if (chatAperta && chatAperta.id === id && schermata === 's-chat') return;
    if (chatAperta) {
      fermaVocale();
      if (refMessaggi) { refMessaggi.off(); refMessaggi = null; }
      chatAperta = null;
    }
    apriChat(id);
  };

  // Chiamata dall'app Android quando Chat TV torna in primo piano
  window.tvRitorno = function () {
    if (schermata === 's-impostazioni') aggiornaPulsanteAvvisi();
  };

  // Al primo accesso da computer, suggerisce di attivare le notifiche
  if (eDesktop && window.Notification && Notification.permission === 'default') {
    setTimeout(function () { if (profilo) toast('🔔 Attiva le notifiche: Impostazioni → Notifiche del computer'); }, 4000);
  }

  // Interfaccia per i moduli aggiuntivi
  window.CTV = {
    estensioni: estensioni,
    $: $, esc: esc, metti: metti, mostra: mostra, toast: toast, suona: suona,
    focusabili: focusabili, pannelloAperto: pannelloAperto, chiudiPannello: chiudiPannello,
    db: function () { return db; },
    gruppoRef: function () { return gruppoRef; },
    profilo: function () { return profilo; },
    utenti: function () { return utenti; },
    chatAperta: function () { return chatAperta; },
    TS: function () { return TS; },
    schermata: function () { return schermata; },
    testoStato: testoStato,
    notificaComputer: notificaComputer
  };

  // Si parte quando anche chiamata.js e diagnostica.js sono caricati
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else setTimeout(avvia, 0);
})();
