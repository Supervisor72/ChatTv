/* Chat TV 1.3 - Videochiamate fino a 4 TV
 * WebRTC diretto tra le TV (nessun server video), segnalazione tramite Firebase.
 * Ogni coppia di TV ha una connessione: la TV con l'id "maggiore" fa la proposta (niente conflitti).
 */
(function () {
  'use strict';

  var C = window.CTV;
  var $ = C.$;
  var MAX_PERSONE = 4;
  var ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }];

  // ================= QUALITÀ (condivisa con la diagnostica) =================
  // br = bitrate massimo in kbps verso ciascuna TV, con 1, 2 o 3 TV collegate
  // scala = riduzione della risoluzione inviata (1 = piena, 1.5 = 1080p→720p, 2 = metà)
  var PROFILI = {
    massima: { nome: 'Massima (1080p)', w: 1920, h: 1080, br: [6000, 3500, 2500], scala: [1, 1, 1.5] },
    '4k': { nome: '4K sperimentale', w: 3840, h: 2160, br: [16000, 6000, 3500], scala: [1, 2, 3] },
    risparmio: { nome: 'Risparmio (720p)', w: 1280, h: 720, br: [2500, 1800, 1200], scala: [1, 1, 1.5] }
  };
  var ORDINE_QUALITA = ['massima', '4k', 'risparmio'];
  var CODEC = { auto: 'Automatico (H.264)', h264: 'H.264', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };
  var ORDINE_CODEC = ['auto', 'h264', 'vp8', 'vp9', 'av1'];
  var MIME = { h264: 'video/H264', vp8: 'video/VP8', vp9: 'video/VP9', av1: 'video/AV1' };

  function imp(k, def) { try { return localStorage.getItem('chattv_' + k) || def; } catch (e) { return def; } }
  function salvaImp(k, v) { try { localStorage.setItem('chattv_' + k, v); } catch (e) { /* niente */ } }
  function chiaveQualita() { var q = imp('qualita', 'massima'); return PROFILI[q] ? q : 'massima'; }
  function eTablet() { return document.documentElement.classList.contains('tablet'); }
  function profiloQualita() {
    var q = PROFILI[chiaveQualita()];
    // sui tablet la fotocamera frontale e l'encoder rendono meglio a 720p
    if (eTablet() && q.h > 720) {
      return { nome: q.nome + ' → tablet 720p', w: 1280, h: 720, br: [3500, 2500, 1800], scala: [1, 1, 1] };
    }
    return q;
  }

  function vincoliVideo() {
    var p = profiloQualita();
    var v = { width: { ideal: p.w }, height: { ideal: p.h }, frameRate: { ideal: 30 } };
    var cam = imp('camera', '');
    if (cam) v.deviceId = { exact: cam };
    else v.facingMode = { ideal: 'user' }; // sui tablet: fotocamera frontale
    return v;
  }

  function apriWebcam(conAudio) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: 'NoMedia' });
    var audio = conAudio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false;
    return navigator.mediaDevices.getUserMedia({ video: vincoliVideo(), audio: audio }).catch(function (e) {
      if (imp('camera', '') && e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        salvaImp('camera', ''); // la webcam scelta non c'è più: uso quella predefinita
        return navigator.mediaDevices.getUserMedia({ video: vincoliVideo(), audio: audio });
      }
      throw e;
    });
  }

  function erroreWebcam(e) {
    var n = e && e.name;
    if (n === 'NoMedia') return 'Webcam non disponibile in questa pagina.';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permesso negato: consenti a Chat TV di usare fotocamera e microfono.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nessuna webcam trovata: collega la webcam USB alla TV.';
    if (n === 'NotReadableError') return 'La webcam è già usata da un\'altra app.';
    return 'Errore webcam: ' + (e && e.message ? e.message : n);
  }

  function ordinaCodec(codecs) {
    var scelta = imp('codec', 'auto');
    var pref = (scelta === 'auto' || !MIME[scelta]) ? ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1'] : [MIME[scelta]];
    var primi = [], resto = [];
    codecs.forEach(function (c) { (pref.indexOf(c.mimeType) >= 0 ? primi : resto).push(c); });
    primi.sort(function (a, b) { return pref.indexOf(a.mimeType) - pref.indexOf(b.mimeType); });
    return primi.concat(resto);
  }

  function preferisciCodec(pc) {
    if (!window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
    var cap = RTCRtpReceiver.getCapabilities('video');
    if (!cap || !cap.codecs) return;
    var ordinati = ordinaCodec(cap.codecs);
    pc.getTransceivers().forEach(function (t) {
      var tipo = (t.sender && t.sender.track && t.sender.track.kind) || (t.receiver && t.receiver.track && t.receiver.track.kind);
      if (tipo === 'video' && t.setCodecPreferences) {
        try { t.setCodecPreferences(ordinati); } catch (e) { /* codec non accettato: resta l'ordine standard */ }
      }
    });
  }

  function parametriPer(nRemoti) {
    var q = profiloQualita();
    var i = Math.min(Math.max(nRemoti, 1), 3) - 1;
    return {
      br: q.br[i] * 1000,
      scala: q.scala[i],
      // bilanciata: con poca banda meglio 720p nitido che 1080p a blocchi
      degrado: 'balanced'
    };
  }

  function impostaParametri(pc, par) {
    pc.getSenders().forEach(function (s) {
      if (!s.track) return;
      var prm = s.getParameters();
      if (!prm.encodings || !prm.encodings.length) return;
      if (s.track.kind === 'audio') {
        prm.encodings[0].maxBitrate = 64000;
        s.setParameters(prm).catch(function () { /* non supportato */ });
        return;
      }
      prm.encodings[0].maxBitrate = par.br;
      prm.encodings[0].maxFramerate = 30;
      prm.encodings[0].scaleResolutionDownBy = par.scala;
      prm.encodings[0].priority = 'high';
      prm.encodings[0].networkPriority = 'high';
      prm.degradationPreference = par.degrado;
      s.setParameters(prm).catch(function () {
        // alcuni browser non accettano degradationPreference: riprovo senza
        var p2 = s.getParameters();
        if (!p2.encodings || !p2.encodings.length) return;
        p2.encodings[0].maxBitrate = par.br;
        p2.encodings[0].maxFramerate = 30;
        p2.encodings[0].scaleResolutionDownBy = par.scala;
        s.setParameters(p2).catch(function () { /* niente */ });
      });
    });
  }

  // Fa partire subito la banda alta (WebRTC altrimenti parte da ~0,3 Mb/s e sale lentamente)
  function sdpConBitrate(sdp, startKbps, minKbps) {
    if (!minKbps) minKbps = Math.round(Math.min(startKbps * 0.4, 1500));
    var extra = 'x-google-start-bitrate=' + startKbps + ';x-google-min-bitrate=' + minKbps;
    var righe = sdp.split('\r\n'), pt = {}, conFmtp = {}, out = [];
    righe.forEach(function (l) {
      var m = l.match(/^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\//i);
      if (m) pt[m[1]] = true;
    });
    righe = righe.map(function (l) {
      var m = l.match(/^a=fmtp:(\d+) /);
      if (m && pt[m[1]]) {
        conFmtp[m[1]] = true;
        if (l.indexOf('x-google-start-bitrate') < 0) return l + ';' + extra;
      }
      return l;
    });
    righe.forEach(function (l) {
      out.push(l);
      var m = l.match(/^a=rtpmap:(\d+) /);
      if (m && pt[m[1]] && !conFmtp[m[1]]) out.push('a=fmtp:' + m[1] + ' ' + extra);
    });
    return out.join('\r\n');
  }

  function bitrateIniziale(nRemoti) {
    return Math.round(Math.min(parametriPer(nRemoti).br / 1000 * 0.7, 4000));
  }

  // Esposto alla diagnostica
  C.video = {
    PROFILI: PROFILI, CODEC: CODEC, imp: imp, salvaImp: salvaImp,
    chiaveQualita: chiaveQualita, profiloQualita: profiloQualita,
    apriWebcam: apriWebcam, erroreWebcam: erroreWebcam,
    preferisciCodec: preferisciCodec, parametriPer: parametriPer, impostaParametri: impostaParametri,
    sdpConBitrate: sdpConBitrate, bitrateIniziale: bitrateIniziale, eTablet: eTablet
  };

  // ================= STATO DELLA CHIAMATA =================
  var peers = {};
  var stato = nuovoStato();
  function nuovoStato() {
    return { cid: null, ref: null, mioRef: null, locale: null, ascolti: [], timeout: null, timerDati: null,
      invitati: [], rifiuti: {}, chiamante: false, connesso: false, chiudendo: false, dati: false,
      soloAudio: false, video: {} };
  }
  function inChiamata() { return !!stato.cid; }
  function io() { return C.profilo().id; }
  function nomeDi(id) { var u = C.utenti()[id]; return (u && u.nome) || 'TV'; }
  function avatarDi(id) { var u = C.utenti()[id]; return (u && u.avatar) || '📺'; }
  function elencoNomi(ids) {
    var n = ids.map(nomeDi);
    return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  }
  function log(e) { if (window.console) console.warn('Chiamata:', e); }
  function pulito(o) { return JSON.parse(JSON.stringify(o)); } // Firebase non accetta valori undefined
  function haVideo() { return !!(stato.locale && stato.locale.getVideoTracks().length); }
  function schermoAcceso(si) { if (window.Android && Android.schermoAcceso) Android.schermoAcceso(si); }

  function impostaStato(t) {
    var el = $('ch-stato');
    el.textContent = t || '';
    el.style.display = t ? 'block' : 'none';
  }

  // ----- riquadri video -----
  function creaTile(id, nome, locale) {
    var t = document.createElement('div');
    t.className = 'tile' + (locale ? ' locale' : '');
    t.setAttribute('data-id', id);
    t.innerHTML = '<video class="principale" autoplay playsinline' + (locale ? ' muted' : '') + '></video>' +
      (locale ? '' : '<video class="sfondo" autoplay playsinline muted></video>') +
      '<div class="tile-avatar"><span></span></div>' +
      '<div class="tile-nome"></div><div class="tile-stato"></div><pre class="tile-dati"></pre>';
    t.querySelector('.tile-avatar span').textContent = locale ? (C.profilo().avatar || '📺') : avatarDi(id);
    if (!locale) {
      var v = t.querySelector('video.principale');
      v.addEventListener('resize', function () { adatta(t); });
      v.addEventListener('loadedmetadata', function () { adatta(t); });
    }
    t.querySelector('.tile-nome').textContent = nome;
    $('griglia-video').appendChild(t);
    disponi();
    return t;
  }

  // Mostra video o avatar nel riquadro
  function aggiornaVista(t, conVideo) {
    if (t) t.classList.toggle('con-video', !!conVideo);
  }
  function aggiornaVistaRemota(id) {
    var p = peers[id];
    if (p && p.tile) aggiornaVista(p.tile, stato.video[id]);
  }

  // ----- indicatore "sta parlando" -----
  var voce = { ctx: null, misure: [], timer: null };
  function ascoltaVoce(tile, stream) {
    if (!stream || !stream.getAudioTracks().length) return;
    try {
      voce.ctx = voce.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (voce.ctx.state === 'suspended') voce.ctx.resume();
      var src = voce.ctx.createMediaStreamSource(stream);
      var an = voce.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      voce.misure = voce.misure.filter(function (m) { return m.tile !== tile; });
      voce.misure.push({ tile: tile, an: an, src: src, buf: new Uint8Array(an.fftSize) });
    } catch (e) { return; }
    if (!voce.timer) voce.timer = setInterval(function () {
      voce.misure = voce.misure.filter(function (m) { return document.body.contains(m.tile); });
      voce.misure.forEach(function (m) {
        m.an.getByteTimeDomainData(m.buf);
        var somma = 0;
        for (var i = 0; i < m.buf.length; i++) { var d = (m.buf[i] - 128) / 128; somma += d * d; }
        m.tile.classList.toggle('parla', Math.sqrt(somma / m.buf.length) > 0.04);
      });
    }, 160);
  }
  function fermaVoce() {
    clearInterval(voce.timer);
    voce.timer = null;
    voce.misure.forEach(function (m) { try { m.src.disconnect(); } catch (e) { /* niente */ } });
    voce.misure = [];
  }

  // Se il video ha un formato diverso dal riquadro (es. tablet in verticale), lo mostro intero con sfondo sfumato
  function adatta(t) {
    var v = t.querySelector('video.principale');
    if (!v || !v.videoWidth || !t.clientWidth || !t.clientHeight) return;
    var fv = v.videoWidth / v.videoHeight, ft = t.clientWidth / t.clientHeight;
    t.classList.toggle('adatta', Math.abs(fv - ft) / ft > 0.12);
  }
  window.addEventListener('resize', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tile:not(.locale)'), adatta);
  });

  function disponi() {
    var g = $('griglia-video');
    g.className = 'griglia-video n' + g.children.length + (stato.dati ? ' con-dati' : '');
    setTimeout(function () { Array.prototype.forEach.call(g.querySelectorAll('.tile:not(.locale)'), adatta); }, 50);
  }

  // ================= AVVIO / INGRESSO =================
  function avviaChiamata(ids, soloAudio) {
    var g = C.gruppoRef();
    if (!g || inChiamata()) return;
    ids = ids.slice(0, MAX_PERSONE - 1);
    if (!ids.length) return;
    var ref = g.child('chiamate').push();
    var invitati = {};
    ids.forEach(function (id) { invitati[id] = true; });
    var tipo = soloAudio ? 'audio' : 'video';
    ref.set({ da: io(), ts: C.TS(), invitati: invitati, tipo: tipo });
    ids.forEach(function (id) { g.child('squilli/' + id).set({ chiamata: ref.key, da: io(), ts: C.TS(), tipo: tipo }); });
    stato.invitati = ids;
    stato.chiamante = true;
    entraInChiamata(ref.key, 'Sto chiamando ' + elencoNomi(ids) + '…', soloAudio);
  }

  function apriSoloMicrofono() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: 'NoMedia' });
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  }

  function entraInChiamata(cid, messaggio, soloAudio) {
    if (inChiamata() || !C.gruppoRef()) return;
    if (C.pannelloAperto()) C.chiudiPannello();
    stato.cid = cid;
    stato.soloAudio = !!soloAudio;
    stato.ref = C.gruppoRef().child('chiamate/' + cid);
    $('griglia-video').innerHTML = '';
    aggiornaPulsanti();
    C.mostra('s-chiamata', 'ch-chiudi');
    impostaStato(messaggio || 'Collegamento…');
    schermoAcceso(true);

    var apri = soloAudio ? apriSoloMicrofono() : apriWebcam(true).catch(function (e) {
      // niente webcam: si partecipa comunque con la sola voce
      return apriSoloMicrofono().then(function (st) {
        C.toast('Webcam non disponibile: partecipi solo con la voce');
        return st;
      }, function () { throw e; });
    });
    apri.then(function (st) {
      if (stato.cid !== cid) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      stato.locale = st;
      var vt = st.getVideoTracks()[0];
      if (vt && 'contentHint' in vt) vt.contentHint = 'motion';
      var t = creaTile(io(), 'Tu', true);
      t.querySelector('video.principale').srcObject = st;
      aggiornaVista(t, !!vt);
      ascoltaVoce(t, st);
      aggiornaPulsanti();
      collegaSegnali(cid);
    }).catch(function (e) {
      C.toast(soloAudio ? 'Microfono non disponibile: collega la webcam con microfono' : erroreWebcam(e));
      riaggancia();
    });
  }

  function collegaSegnali(cid) {
    var ref = stato.ref, me = io();
    ref.child('partecipanti').once('value').then(function (s) {
      if (stato.cid !== cid) return;
      if (s.numChildren() >= MAX_PERSONE && !s.hasChild(me)) {
        C.toast('La chiamata è già al completo (massimo ' + MAX_PERSONE + ' TV)');
        riaggancia();
        return;
      }
      stato.mioRef = ref.child('partecipanti/' + me);
      stato.mioRef.onDisconnect().remove();
      stato.mioRef.set({ ts: C.TS(), video: haVideo() });

      var refSeg = ref.child('segnali/' + me);
      var cbSeg = refSeg.on('child_added', gestisciSegnale);
      var refPart = ref.child('partecipanti');
      var cbAdd = refPart.on('child_added', function (c) {
        var id = c.key, v = c.val() || {};
        if (id === me) return;
        stato.video[id] = !!v.video;
        if (!peers[id] && me > id) creaPeer(id, true);
        aggiornaVistaRemota(id);
      });
      var cbCam = refPart.on('child_changed', function (c) {
        if (c.key === me) return;
        stato.video[c.key] = !!(c.val() || {}).video;
        aggiornaVistaRemota(c.key);
      });
      var cbRem = refPart.on('child_removed', function (c) { if (c.key !== me) chiudiPeer(c.key, true); });
      var refRif = ref.child('rifiuti');
      var cbRif = refRif.on('child_added', function (c) { rifiutato(c.key); });
      stato.ascolti.push(function () {
        refSeg.off('child_added', cbSeg);
        refPart.off('child_added', cbAdd);
        refPart.off('child_removed', cbRem);
        refPart.off('child_changed', cbCam);
        refRif.off('child_added', cbRif);
      });

      if (stato.chiamante) {
        stato.timeout = setTimeout(function () {
          if (inChiamata() && !Object.keys(peers).length) { C.toast('Nessuna risposta'); riaggancia(); }
        }, 45000);
      }
    }).catch(function (e) { C.toast('Chiamata non riuscita: ' + (e && e.message)); riaggancia(); });
  }

  function rifiutato(id) {
    if (id === io() || stato.rifiuti[id]) return;
    stato.rifiuti[id] = true;
    C.toast(nomeDi(id) + ' non può rispondere');
    if (stato.chiamante && !Object.keys(peers).length &&
        stato.invitati.every(function (x) { return stato.rifiuti[x]; })) {
      setTimeout(riaggancia, 1500);
    }
  }

  // ================= CONNESSIONI TRA TV =================
  function invia(dest, msg) {
    if (!stato.ref) return;
    msg.da = io();
    stato.ref.child('segnali/' + dest).push(pulito(msg));
  }

  function creaPeer(id, offerente) {
    var pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
    var p = { id: id, pc: pc, coda: [], prec: null, tile: creaTile(id, nomeDi(id), false) };
    peers[id] = p;
    p.tile.querySelector('.tile-stato').textContent = 'Collegamento…';

    if (stato.locale) stato.locale.getTracks().forEach(function (t) { pc.addTrack(t, stato.locale); });
    if (offerente && !haVideo()) {
      try { pc.addTransceiver('video', { direction: 'sendrecv', streams: stato.locale ? [stato.locale] : [] }); } catch (e) { log(e); }
    }
    preferisciCodec(pc);
    aggiornaVistaRemota(id);

    pc.onicecandidate = function (e) { if (e.candidate) invia(id, { tipo: 'ice', c: e.candidate.toJSON() }); };
    pc.ontrack = function (e) {
      var v = p.tile.querySelector('video.principale'), sf = p.tile.querySelector('video.sfondo');
      var flusso = e.streams[0];
      if (!flusso) {
        flusso = v.srcObject || new MediaStream();
        if (flusso.getTracks().indexOf(e.track) < 0) flusso.addTrack(e.track);
      }
      if (v.srcObject !== flusso) {
        v.srcObject = flusso;
        if (sf) sf.srcObject = flusso;
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () { /* ripartirà da solo */ });
      }
      if (e.track.kind === 'audio') ascoltaVoce(p.tile, new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState, el = p.tile.querySelector('.tile-stato');
      if (st === 'connected') {
        el.textContent = '';
        stato.connesso = true;
        clearTimeout(stato.timeout);
        impostaStato('');
        applicaQualita();
      } else if (st === 'disconnected') {
        el.textContent = 'Connessione instabile…';
      } else if (st === 'failed') {
        el.textContent = 'Riconnessione…';
        if (offerente) faiOfferta(p, true);
      }
    };
    if (offerente) faiOfferta(p, false);
    applicaQualita();
    return p;
  }

  function faiOfferta(p, riavvio) {
    p.pc.createOffer(riavvio ? { iceRestart: true } : undefined).then(function (o) {
      return p.pc.setLocalDescription(o);
    }).then(function () {
      invia(p.id, { tipo: 'offer', sdp: p.pc.localDescription.sdp });
    }).catch(log);
  }

  function svuotaCoda(p) {
    p.coda.forEach(function (c) { p.pc.addIceCandidate(c).catch(log); });
    p.coda = [];
  }

  function gestisciSegnale(snap) {
    var s = snap.val();
    snap.ref.remove();
    if (!s || !s.da || !inChiamata()) return;
    var p = peers[s.da];
    if (s.tipo === 'offer') {
      if (!p) p = creaPeer(s.da, false);
      p.pc.setRemoteDescription({ type: 'offer', sdp: sdpConBitrate(s.sdp, bitrateIniziale(Object.keys(peers).length)) }).then(function () {
        // canale video pronto in entrambe le direzioni, anche se ora non ho la webcam accesa
        p.pc.getTransceivers().forEach(function (t) {
          if (t.receiver && t.receiver.track && t.receiver.track.kind === 'video' && !t.stopped) {
            try { t.direction = 'sendrecv'; } catch (e) { /* niente */ }
          }
        });
        preferisciCodec(p.pc);
        svuotaCoda(p);
        return p.pc.createAnswer();
      }).then(function (a) {
        return p.pc.setLocalDescription(a);
      }).then(function () {
        invia(s.da, { tipo: 'answer', sdp: p.pc.localDescription.sdp });
        applicaQualita();
      }).catch(log);
    } else if (s.tipo === 'answer' && p) {
      p.pc.setRemoteDescription({ type: 'answer', sdp: sdpConBitrate(s.sdp, bitrateIniziale(Object.keys(peers).length)) }).then(function () {
        svuotaCoda(p);
        applicaQualita();
      }).catch(log);
    } else if (s.tipo === 'ice' && p && s.c) {
      if (p.pc.remoteDescription && p.pc.remoteDescription.type) p.pc.addIceCandidate(s.c).catch(log);
      else p.coda.push(s.c);
    }
  }

  function applicaQualita() {
    var ids = Object.keys(peers);
    var par = parametriPer(ids.length);
    ids.forEach(function (id) { impostaParametri(peers[id].pc, par); });
  }

  function chiudiPeer(id, avviso) {
    var p = peers[id];
    if (!p) return;
    delete peers[id];
    try { p.pc.close(); } catch (e) { /* già chiusa */ }
    if (p.tile) p.tile.remove();
    disponi();
    if (stato.chiudendo) return;
    if (avviso) C.toast(nomeDi(id) + ' ha lasciato la chiamata');
    applicaQualita();
    if (!Object.keys(peers).length && stato.connesso) {
      impostaStato('Chiamata terminata');
      setTimeout(function () { if (inChiamata() && !Object.keys(peers).length) riaggancia(); }, 2500);
    }
  }

  // ================= FINE CHIAMATA =================
  function riaggancia() {
    if (!stato.cid) return;
    var cid = stato.cid, ref = stato.ref, g = C.gruppoRef(), vecchio = stato;
    stato.chiudendo = true;
    clearTimeout(stato.timeout);
    clearInterval(stato.timerDati);
    stato.ascolti.forEach(function (f) { f(); });
    Object.keys(peers).forEach(function (id) { chiudiPeer(id, false); });
    if (stato.locale) stato.locale.getTracks().forEach(function (t) { t.stop(); });
    if (stato.mioRef) { stato.mioRef.onDisconnect().cancel(); stato.mioRef.remove(); }
    if (vecchio.chiamante && g) {
      vecchio.invitati.forEach(function (id) {
        g.child('squilli/' + id).once('value').then(function (s) {
          var v = s.val();
          if (v && v.chiamata === cid) s.ref.remove();
        });
      });
    }
    // se non è rimasto nessuno, la chiamata si cancella dal database
    if (ref) {
      setTimeout(function () {
        ref.child('partecipanti').once('value').then(function (s) { if (!s.exists()) ref.remove(); }).catch(log);
      }, 800);
    }
    fermaVoce();
    stato = nuovoStato();
    $('griglia-video').innerHTML = '';
    $('griglia-video').className = 'griglia-video';
    schermoAcceso(false);
    if (C.schermata() === 's-chiamata') C.mostra('s-home');
  }

  // ================= COMANDI IN CHIAMATA =================
  function aggiornaPulsanti() {
    var a = stato.locale ? stato.locale.getAudioTracks()[0] : null;
    var v = stato.locale ? stato.locale.getVideoTracks()[0] : null;
    $('ch-mic').textContent = (a && !a.enabled) ? '🔇 Microfono off' : '🎙️ Microfono on';
    $('ch-cam').textContent = !v ? '📷 Attiva video' : (!v.enabled ? '🚫 Video off' : '📷 Video on');
    $('ch-dati').textContent = stato.dati ? '📊 Nascondi dati' : '📊 Dati tecnici';
  }

  // Da chiamata audio a videochiamata, senza riattaccare
  var accensione = false;
  function attivaVideo() {
    if (!stato.locale || haVideo() || accensione) return;
    accensione = true;
    $('ch-cam').textContent = '⏳ Accensione…';
    apriWebcam(false).then(function (st) {
      accensione = false;
      if (!inChiamata() || !stato.locale) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      var vt = st.getVideoTracks()[0];
      if ('contentHint' in vt) vt.contentHint = 'motion';
      stato.locale.addTrack(vt);
      var mio = $('griglia-video').querySelector('.tile.locale');
      if (mio) {
        mio.querySelector('video.principale').srcObject = stato.locale;
        aggiornaVista(mio, true);
      }
      Object.keys(peers).forEach(function (id) {
        var pc = peers[id].pc, fatto = false;
        pc.getTransceivers().forEach(function (t) {
          if (fatto || t.stopped || !t.receiver || !t.receiver.track || t.receiver.track.kind !== 'video') return;
          if (t.sender.track) return;
          fatto = true;
          try { t.direction = 'sendrecv'; } catch (e) { /* niente */ }
          t.sender.replaceTrack(vt).catch(log);
        });
      });
      applicaQualita();
      if (stato.mioRef) stato.mioRef.update({ video: true });
      aggiornaPulsanti();
    }).catch(function (e) {
      accensione = false;
      C.toast(erroreWebcam(e));
      aggiornaPulsanti();
    });
  }

  function alterna(tipo) {
    if (!stato.locale) return;
    if (tipo === 'video' && !haVideo()) { attivaVideo(); return; }
    var tr = tipo === 'audio' ? stato.locale.getAudioTracks()[0] : stato.locale.getVideoTracks()[0];
    if (tr) tr.enabled = !tr.enabled;
    if (tipo === 'video' && tr) {
      var mio = $('griglia-video').querySelector('.tile.locale');
      aggiornaVista(mio, tr.enabled);
      if (stato.mioRef) stato.mioRef.update({ video: tr.enabled });
    }
    aggiornaPulsanti();
  }

  function alternaDati() {
    stato.dati = !stato.dati;
    clearInterval(stato.timerDati);
    if (stato.dati) { aggiornaDati(); stato.timerDati = setInterval(aggiornaDati, 1000); }
    disponi();
    aggiornaPulsanti();
  }

  // ================= DATI TECNICI =================
  var LIMITI = { bandwidth: 'banda', cpu: 'processore', other: 'altro' };
  function mbps(kbps) { return (kbps / 1000).toFixed(1) + ' Mb/s'; }
  function nomeCodec(c) { return c && c.mimeType ? c.mimeType.split('/')[1] : '?'; }
  function tipoRete(c) {
    if (!c) return '';
    if (c.candidateType === 'host') return 'stessa rete';
    if (c.candidateType === 'srflx' || c.candidateType === 'prflx') return 'internet diretto';
    if (c.candidateType === 'relay') return 'tramite server';
    return c.candidateType || '';
  }

  function aggiornaDati() {
    Object.keys(peers).forEach(function (id) {
      var p = peers[id];
      p.pc.getStats().then(function (rep) {
        var out = null, inn = null, coppia = null, codecs = {}, cand = {}, sorgente = null, innA = null;
        rep.forEach(function (r) {
          if (r.type === 'media-source' && r.kind === 'video') sorgente = r;
          else if (r.type === 'inbound-rtp' && r.kind === 'audio') innA = r;
          else if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
          else if (r.type === 'inbound-rtp' && r.kind === 'video') inn = r;
          else if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) coppia = r;
          else if (r.type === 'codec') codecs[r.id] = r;
          else if (r.type === 'local-candidate') cand[r.id] = r;
        });
        var adesso = Date.now(), prec = p.prec, dt = prec ? (adesso - prec.t) / 1000 : 0;
        var righe = [];
        if (innA) {
          var kA = dt && prec.rxa != null ? (innA.bytesReceived - prec.rxa) * 8 / dt / 1000 : 0;
          righe.push('Voce    ' + Math.round(kA) + ' kb/s  ' + nomeCodec(codecs[innA.codecId]) + '  persi ' + (innA.packetsLost || 0));
        }
        if (inn && inn.frameWidth) {
          var kIn = dt ? (inn.bytesReceived - prec.rx) * 8 / dt / 1000 : 0;
          righe.push('Ricevo  ' + (inn.frameWidth || '?') + '×' + (inn.frameHeight || '?') + '  ' +
            Math.round(inn.framesPerSecond || 0) + ' fps  ' + mbps(kIn) + '  ' + nomeCodec(codecs[inn.codecId]));
          var persi = inn.packetsLost || 0, ric = inn.packetsReceived || 0;
          righe.push('Persi   ' + (ric ? (persi * 100 / (persi + ric)).toFixed(1) : '0.0') + '%   jitter ' + Math.round((inn.jitter || 0) * 1000) + ' ms');
        }
        if (out && out.frameWidth) {
          var kOut = dt ? (out.bytesSent - prec.tx) * 8 / dt / 1000 : 0;
          righe.push('Invio   ' + (out.frameWidth || '?') + '×' + (out.frameHeight || '?') + '  ' +
            Math.round(out.framesPerSecond || 0) + ' fps  ' + mbps(kOut) + '  ' + nomeCodec(codecs[out.codecId]));
          var lim = out.qualityLimitationReason && out.qualityLimitationReason !== 'none' ? '  limite: ' + (LIMITI[out.qualityLimitationReason] || out.qualityLimitationReason) : '';
          righe.push('Encoder ' + (out.encoderImplementation || '?') + lim);
        }
        var tv = stato.locale ? stato.locale.getVideoTracks()[0] : null;
        var imp = tv && tv.getSettings ? tv.getSettings() : {};
        var wS = (sorgente && sorgente.width) || imp.width, hS = (sorgente && sorgente.height) || imp.height;
        var fS = (sorgente && sorgente.framesPerSecond) || imp.frameRate;
        if (wS) righe.push('Webcam  ' + wS + '×' + hS + '  ' + Math.round(fS || 0) + ' fps');
        if (coppia) {
          righe.push('Rete    ' + Math.round((coppia.currentRoundTripTime || 0) * 1000) + ' ms  ' + tipoRete(cand[coppia.localCandidateId]));
        }
        p.prec = { t: adesso, rx: inn ? inn.bytesReceived : 0, tx: out ? out.bytesSent : 0, rxa: innA ? innA.bytesReceived : null };
        if (p.tile) p.tile.querySelector('.tile-dati').textContent = righe.join('\n');
      }).catch(log);
    });
  }

  // ================= CHIAMATA IN ARRIVO =================
  var squillo = { ref: null, cb: null, attuale: null, suono: null, scadenza: null, ritorno: null };

  function squilloAperto() { return $('squillo').classList.contains('aperto'); }

  function ascoltaSquilli() {
    fermaSquilli();
    var g = C.gruppoRef(), me = io();
    squillo.ref = g.child('squilli/' + me);
    squillo.cb = squillo.ref.on('value', function (s) {
      var v = s.val();
      if (!v) {
        if (squillo.attuale) { chiudiSquillo(); C.toast('Chiamata persa'); }
        return;
      }
      if (squillo.attuale && squillo.attuale.chiamata === v.chiamata) return;
      if (typeof v.ts === 'number' && Date.now() - v.ts > 90000) { s.ref.remove(); return; } // squillo vecchio
      if (inChiamata()) { // occupato
        g.child('chiamate/' + v.chiamata + '/rifiuti/' + me).set(true);
        s.ref.remove();
        return;
      }
      mostraSquillo(v);
    });
  }

  function fermaSquilli() {
    if (squillo.ref && squillo.cb) squillo.ref.off('value', squillo.cb);
    squillo.ref = squillo.cb = null;
    chiudiSquillo();
  }

  function mostraSquillo(v) {
    squillo.attuale = v;
    if (!squilloAperto()) squillo.ritorno = document.activeElement;
    $('sq-avatar').textContent = avatarDi(v.da);
    var audio = v.tipo === 'audio';
    $('sq-titolo').textContent = nomeDi(v.da) + (audio ? ' ti sta chiamando' : ' ti sta videochiamando');
    $('sq-rispondi').textContent = audio ? '📞 Rispondi' : '📹 Rispondi';
    $('sq-sotto').textContent = '';
    C.gruppoRef().child('chiamate/' + v.chiamata + '/invitati').once('value').then(function (s) {
      var altri = Object.keys(s.val() || {}).filter(function (id) { return id !== io(); });
      if (altri.length && squillo.attuale === v) $('sq-sotto').textContent = (audio ? 'Chiamata' : 'Videochiamata') + ' di gruppo con ' + elencoNomi(altri);
    }).catch(log);
    $('squillo').classList.add('aperto');
    setTimeout(function () { C.metti($('sq-rispondi')); }, 40);
    C.suona();
    C.notificaComputer((audio ? '📞 ' : '📹 ') + nomeDi(v.da), audio ? 'ti sta chiamando' : 'ti sta videochiamando', null);
    clearInterval(squillo.suono);
    squillo.suono = setInterval(C.suona, 1800);
    clearTimeout(squillo.scadenza);
    squillo.scadenza = setTimeout(function () {
      if (squillo.attuale === v) { rifiuta(); C.toast('Chiamata persa da ' + nomeDi(v.da)); }
    }, 45000);
  }

  function chiudiSquillo() {
    clearInterval(squillo.suono);
    clearTimeout(squillo.scadenza);
    squillo.attuale = null;
    if (!squilloAperto()) return;
    $('squillo').classList.remove('aperto');
    var r = squillo.ritorno;
    if (r && document.body.contains(r) && r.offsetParent !== null) C.metti(r); else C.metti(C.focusabili()[0]);
  }

  function rispondi() {
    var v = squillo.attuale;
    if (!v) return;
    chiudiSquillo();
    if (squillo.ref) squillo.ref.remove();
    stato.chiamante = false;
    entraInChiamata(v.chiamata, 'Collegamento con ' + nomeDi(v.da) + '…', v.tipo === 'audio');
  }

  function rifiuta() {
    var v = squillo.attuale;
    chiudiSquillo();
    if (!v) return;
    var g = C.gruppoRef();
    if (g) g.child('chiamate/' + v.chiamata + '/rifiuti/' + io()).set(true);
    if (squillo.ref) squillo.ref.remove();
  }

  // ================= SCELTA TV PER CHIAMATA DI GRUPPO =================
  var scelti = {};

  function apriGruppo() {
    scelti = {};
    disegnaGruppo();
    C.mostra('s-gruppo', $('gr-contatti').querySelector('button:not([disabled])') || 'gr-indietro');
  }

  function disegnaGruppo() {
    var u = C.utenti(), me = io();
    var att = document.activeElement;
    var idFocus = att && att.getAttribute ? att.getAttribute('data-id') : null;
    var ids = Object.keys(u).filter(function (id) { return id !== me; });
    ids.sort(function (a, b) { return (u[b].online ? 1 : 0) - (u[a].online ? 1 : 0) || String(u[a].nome).localeCompare(String(u[b].nome)); });
    $('gr-contatti').innerHTML = ids.map(function (id) {
      var x = u[id] || {};
      if (!x.online) delete scelti[id];
      return '<button class="nav contatto selezionabile' + (x.online ? ' online' : '') + (scelti[id] ? ' scelto' : '') + '" data-id="' + C.esc(id) + '"' + (x.online ? '' : ' disabled') + '>' +
        '<span class="spunta">' + (scelti[id] ? '✓' : '') + '</span>' +
        '<span class="avatar grande">' + C.esc(x.avatar || '📺') + '</span>' +
        '<span class="c-nome">' + C.esc(x.nome || 'TV') + '</span>' +
        '<span class="c-stato">' + C.esc(C.testoStato(x)) + '</span></button>';
    }).join('');
    var n = Object.keys(scelti).length;
    $('gr-chiama').textContent = n ? '📹 Video (' + n + ')' : '📹 Video';
    $('gr-chiama').disabled = !n;
    $('gr-chiama-audio').textContent = n ? '📞 Solo voce (' + n + ')' : '📞 Solo voce';
    $('gr-chiama-audio').disabled = !n;
    if (idFocus && C.schermata() === 's-gruppo') {
      var el = $('gr-contatti').querySelector('[data-id="' + idFocus + '"]');
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  // ================= COLLEGAMENTI =================
  function inizializza() {
    function chiamaDallaChat(soloAudio) {
      var ch = C.chatAperta();
      if (!ch) return;
      var u = C.utenti()[ch.id];
      if (!u || !u.online) { C.toast(nomeDi(ch.id) + ' non è online: Chat TV deve essere aperta su quella TV'); return; }
      avviaChiamata([ch.id], soloAudio);
    }
    $('btn-videochiama').onclick = function () { chiamaDallaChat(false); };
    $('btn-chiama-audio').onclick = function () { chiamaDallaChat(true); };
    $('btn-gruppo').onclick = apriGruppo;
    $('gr-indietro').onclick = function () { C.mostra('s-home', 'btn-gruppo'); };
    $('gr-contatti').addEventListener('click', function (e) {
      var b = e.target.closest('[data-id]');
      if (!b || b.disabled) return;
      var id = b.getAttribute('data-id');
      if (scelti[id]) delete scelti[id];
      else if (Object.keys(scelti).length >= MAX_PERSONE - 1) { C.toast('Massimo ' + (MAX_PERSONE - 1) + ' TV oltre a te'); return; }
      else scelti[id] = true;
      disegnaGruppo();
    });
    $('gr-chiama').onclick = function () {
      var ids = Object.keys(scelti);
      if (ids.length) avviaChiamata(ids, false);
    };
    $('gr-chiama-audio').onclick = function () {
      var ids = Object.keys(scelti);
      if (ids.length) avviaChiamata(ids, true);
    };
    $('ch-chiudi').onclick = riaggancia;
    $('ch-mic').onclick = function () { alterna('audio'); };
    $('ch-cam').onclick = function () { alterna('video'); };
    $('ch-dati').onclick = alternaDati;
    $('sq-rispondi').onclick = rispondi;
    $('sq-rifiuta').onclick = rifiuta;

    var E = C.estensioni;
    E.overlay.push(function () { return squilloAperto() ? $('squillo') : null; });
    E.indietro.push(function () {
      if (squilloAperto()) { C.metti($('sq-rifiuta')); return true; }
      if (C.schermata() === 's-chiamata') {
        if (document.activeElement === $('ch-chiudi')) riaggancia();
        else { C.metti($('ch-chiudi')); C.toast('Premi OK su Chiudi per terminare la chiamata'); }
        return true;
      }
      if (C.schermata() === 's-gruppo') { C.mostra('s-home', 'btn-gruppo'); return true; }
      return false;
    });
    E.entra.push(ascoltaSquilli);
    E.scollega.push(function () { riaggancia(); fermaSquilli(); });
    E.utenti.push(function () {
      if (C.schermata() === 's-gruppo') disegnaGruppo();
      Object.keys(peers).forEach(function (id) { if (peers[id].tile) peers[id].tile.querySelector('.tile-nome').textContent = nomeDi(id); });
    });
  }

  inizializza();
})();
