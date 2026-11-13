/* Chat TV 1.3 - Diagnostica webcam e test di qualità per le videochiamate */
(function () {
  'use strict';

  var C = window.CTV;
  var V = C.video;
  var $ = C.$;
  var esc = C.esc;

  var dg = { stream: null, cams: [], misura: null, occupato: false, attiva: false };
  var sez = { webcam: '', risoluzioni: '', test: '', codec: '', hardware: '', turn: '' };

  // ---------- utilità ----------
  function attesa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tabella(righe) {
    return '<table>' + righe.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return (i === 0 ? '<th>' : '<td>') + c + (i === 0 ? '</th>' : '</td>'); }).join('') + '</tr>';
    }).join('') + '</table>';
  }
  function render() {
    $('dg-report').innerHTML =
      '<h3>Webcam</h3>' + (sez.webcam || '<p>Accensione…</p>') +
      '<h3>Test qualità chiamata</h3>' + (sez.test || '<p>Premi ⚡ Test qualità chiamata: misura cosa riesce a inviare la TV in una chiamata a 2 e a 4 (circa 30 secondi).</p>') +
      '<h3>Risoluzioni della webcam</h3>' + (sez.risoluzioni || '<p>Premi 📐 Prova risoluzioni per verificare 4K, 1440p, 1080p e 720p a 30 e 60 fps.</p>') +
      '<h3>Server di appoggio (TURN)</h3>' + (sez.turn || '<p>' + (V.turnConfigurato() ? 'Configurato. Premi 🌐 Test server di appoggio per verificarlo.' : 'Non configurato: le chiamate usano solo il collegamento diretto.') + '</p>') +
      '<h3>Codec video</h3>' + sez.codec +
      '<h3>Hardware della TV</h3>' + sez.hardware;
  }
  function occupa(si) {
    dg.occupato = si;
    ['dg-test', 'dg-risoluzioni', 'dg-camera'].forEach(function (id) { $(id).disabled = si; });
    if (!si) C.metti($('dg-test'));
  }

  function fermaStream() {
    if (dg.stream) { dg.stream.getTracks().forEach(function (t) { t.stop(); }); dg.stream = null; }
    $('dg-video').srcObject = null;
  }

  // Conta i fotogrammi realmente mostrati in un intervallo
  function misuraFps(video, ms) {
    return new Promise(function (ris) {
      var n = 0, inizio = performance.now(), fine = inizio + ms;
      if (video.requestVideoFrameCallback) {
        var conta = function () { n++; if (performance.now() < fine) video.requestVideoFrameCallback(conta); };
        video.requestVideoFrameCallback(conta);
        setTimeout(function () { ris(n * 1000 / ms); }, ms);
      } else if (video.getVideoPlaybackQuality) {
        var q0 = video.getVideoPlaybackQuality().totalVideoFrames;
        setTimeout(function () { ris((video.getVideoPlaybackQuality().totalVideoFrames - q0) * 1000 / ms); }, ms);
      } else {
        setTimeout(function () { ris(0); }, ms);
      }
    });
  }

  function avviaMisuraContinua() {
    clearInterval(dg.misura);
    var v = $('dg-video');
    var giro = function () {
      if (!dg.attiva || !dg.stream) return;
      misuraFps(v, 1000).then(function (f) {
        if (!dg.attiva) return;
        $('dg-sovra').textContent = (v.videoWidth || '?') + '×' + (v.videoHeight || '?') + '   ' + f.toFixed(0) + ' fps';
      });
    };
    giro();
    dg.misura = setInterval(giro, 1100);
  }

  // ---------- anteprima e informazioni webcam ----------
  function avviaAnteprima() {
    fermaStream();
    $('dg-sovra').textContent = '';
    return V.apriWebcam(false).then(function (st) {
      if (!dg.attiva) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      dg.stream = st;
      $('dg-video').srcObject = st;
      var t = st.getVideoTracks()[0];
      var set = t.getSettings ? t.getSettings() : {};
      var cap = t.getCapabilities ? t.getCapabilities() : {};
      sez.webcam = tabella([
        ['Webcam', esc(t.label || 'Sconosciuta')],
        ['Profilo qualità', esc(V.profiloQualita().nome)],
        ['Risoluzione ottenuta', (set.width || '?') + '×' + (set.height || '?')],
        ['Fps impostati', set.frameRate ? Math.round(set.frameRate) : '?'],
        ['Risoluzione massima', cap.width && cap.height ? cap.width.max + '×' + cap.height.max : 'non indicata'],
        ['Fps massimi', cap.frameRate ? Math.round(cap.frameRate.max) : 'non indicati']
      ]);
      render();
      avviaMisuraContinua();
      return elencaCamere();
    }).catch(function (e) {
      sez.webcam = '<p class="dg-errore">' + esc(V.erroreWebcam(e)) + '</p>';
      render();
    });
  }

  function elencaCamere() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (d) {
      dg.cams = d.filter(function (x) { return x.kind === 'videoinput'; });
      var att = dg.stream ? dg.stream.getVideoTracks()[0].getSettings().deviceId : '';
      var i = 0;
      dg.cams.forEach(function (c, k) { if (c.deviceId === att) i = k; });
      $('dg-camera').textContent = dg.cams.length > 1 ? '🎥 Cambia webcam (' + (i + 1) + '/' + dg.cams.length + ')' : '🎥 Una sola webcam';
      $('dg-camera').disabled = dg.cams.length < 2 || dg.occupato;
    });
  }

  function cambiaCamera() {
    if (dg.cams.length < 2 || dg.occupato) return;
    var att = dg.stream ? dg.stream.getVideoTracks()[0].getSettings().deviceId : '';
    var i = 0;
    dg.cams.forEach(function (c, k) { if (c.deviceId === att) i = k; });
    var prossima = dg.cams[(i + 1) % dg.cams.length];
    V.salvaImp('camera', prossima.deviceId);
    C.toast('Webcam scelta: ' + (prossima.label || 'webcam ' + ((i + 1) % dg.cams.length + 1)));
    avviaAnteprima();
  }

  // ---------- prova delle risoluzioni ----------
  var PROVE = [[3840, 2160, 30], [2560, 1440, 30], [1920, 1080, 60], [1920, 1080, 30], [1280, 720, 60], [1280, 720, 30], [640, 480, 30]];

  function provaRisoluzioni() {
    if (dg.occupato) return;
    occupa(true);
    clearInterval(dg.misura);
    var righe = [['Richiesta', 'Esito', 'Fps misurati']];
    var cam = V.imp('camera', '');
    var i = 0;
    var prossima = function () {
      if (!dg.attiva) return Promise.resolve();
      if (i >= PROVE.length) return Promise.resolve();
      var p = PROVE[i++];
      sez.risoluzioni = '<p>Prova ' + i + ' di ' + PROVE.length + ': ' + p[0] + '×' + p[1] + ' a ' + p[2] + ' fps…</p>' + tabella(righe);
      render();
      fermaStream();
      var vid = { width: { exact: p[0] }, height: { exact: p[1] }, frameRate: { ideal: p[2] } };
      if (cam) vid.deviceId = { exact: cam };
      return navigator.mediaDevices.getUserMedia({ video: vid, audio: false }).then(function (st) {
        dg.stream = st;
        var v = $('dg-video');
        v.srcObject = st;
        return attesa(700).then(function () { return misuraFps(v, 1600); }).then(function (f) {
          var s = st.getVideoTracks()[0].getSettings();
          var ok = f >= p[2] * 0.85;
          righe.push([p[0] + '×' + p[1] + ' @' + p[2],
            (ok ? '✅ ' : '⚠️ ') + (s.width || v.videoWidth) + '×' + (s.height || v.videoHeight),
            f.toFixed(1)]);
        });
      }).catch(function () {
        righe.push([p[0] + '×' + p[1] + ' @' + p[2], '❌ non supportata', '']);
      }).then(prossima);
    };
    prossima().then(function () {
      sez.risoluzioni = tabella(righe) + '<p class="dg-nota">✅ = risoluzione e fps pieni.  ⚠️ = funziona ma con meno fps (spesso per poca luce o limite USB).</p>';
      render();
      occupa(false);
      return avviaAnteprima();
    });
  }

  // ---------- test di qualità (codifica reale dentro la TV) ----------
  // Simula una chiamata: la TV codifica il video della webcam verso 1 o 3 destinatari
  function testCodifica(n, secondi) {
    var track = dg.stream.getVideoTracks()[0];
    var par = V.parametriPer(n);
    var coppie = [];
    var avvii = [];
    for (var i = 0; i < n; i++) {
      (function () {
        var a = new RTCPeerConnection(), b = new RTCPeerConnection();
        a.onicecandidate = function (e) { if (e.candidate) b.addIceCandidate(e.candidate).catch(function () {}); };
        b.onicecandidate = function (e) { if (e.candidate) a.addIceCandidate(e.candidate).catch(function () {}); };
        a.addTrack(track, dg.stream);
        V.preferisciCodec(a);
        coppie.push({ a: a, b: b });
        avvii.push(a.createOffer().then(function (o) { return a.setLocalDescription(o); })
          .then(function () { return b.setRemoteDescription({ type: 'offer', sdp: V.sdpConBitrate(a.localDescription.sdp, V.bitrateIniziale(n)) }); })
          .then(function () { return b.createAnswer(); })
          .then(function (x) { return b.setLocalDescription(x); })
          .then(function () { return a.setRemoteDescription({ type: 'answer', sdp: V.sdpConBitrate(b.localDescription.sdp, V.bitrateIniziale(n)) }); })
          .then(function () { V.impostaParametri(a, par); }));
      })();
    }
    var leggi = function () {
      return Promise.all(coppie.map(function (c) {
        return c.a.getStats().then(function (rep) {
          var out = null, codecs = {};
          rep.forEach(function (r) {
            if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
            if (r.type === 'codec') codecs[r.id] = r;
          });
          return out ? { w: out.frameWidth, h: out.frameHeight, fps: out.framesPerSecond || 0, byte: out.bytesSent,
            enc: out.encoderImplementation || '?', lim: out.qualityLimitationReason || 'none',
            hw: out.powerEfficientEncoder, codec: codecs[out.codecId] ? codecs[out.codecId].mimeType.split('/')[1] : '?' } : null;
        });
      }));
    };
    var prima;
    return Promise.all(avvii)
      .then(function () { return attesa((secondi - 2) * 1000); })
      .then(leggi).then(function (r) { prima = r; return attesa(2000); })
      .then(leggi).then(function (dopo) {
        coppie.forEach(function (c) { c.a.close(); c.b.close(); });
        return dopo.map(function (d, k) {
          if (!d) return null;
          d.kbps = prima[k] ? (d.byte - prima[k].byte) * 8 / 2 / 1000 : 0;
          return d;
        });
      })
      .catch(function (e) { coppie.forEach(function (c) { c.a.close(); c.b.close(); }); throw e; });
  }

  function descriviEncoder(r) {
    var sw = /libvpx|openh264|libaom|dav1d|software/i.test(r.enc);
    var tipo = r.hw === true ? 'hardware' : r.hw === false ? 'software' : sw ? 'software' : 'probabilmente hardware';
    return esc(r.enc) + ' (' + tipo + ')';
  }
  var LIMITI = { none: 'nessuno', bandwidth: 'banda', cpu: 'processore', other: 'altro' };

  function rigaRisultato(titolo, ris) {
    var validi = ris.filter(Boolean);
    if (!validi.length) return [titolo, 'nessun dato'];
    var fps = validi.reduce(function (s, r) { return s + r.fps; }, 0) / validi.length;
    var kb = validi.reduce(function (s, r) { return s + r.kbps; }, 0) / validi.length;
    var r0 = validi[0];
    return [titolo,
      (r0.w || '?') + '×' + (r0.h || '?') + '   ' + fps.toFixed(0) + ' fps   ' + (kb / 1000).toFixed(1) + ' Mb/s per TV<br>' +
      'Codec ' + esc(r0.codec) + '   encoder ' + descriviEncoder(r0) + '   limite: ' + (LIMITI[r0.lim] || esc(r0.lim))];
  }

  function giudizio(r1, r3, fpsSorgente) {
    var a = r1.filter(Boolean)[0], b = r3.filter(Boolean);
    var out = [];
    var buono = Math.min(25, fpsSorgente * 0.85), medio = Math.min(18, fpsSorgente * 0.65);
    if (a) {
      if (a.h >= 1000 && a.fps >= buono) out.push('✅ Chiamata a 2: Full HD fluido.');
      else if (a.h >= 700 && a.fps >= buono) out.push('🟡 Chiamata a 2: buona (720p). Con più luce o il profilo Risparmio migliora.');
      else out.push('🔴 Chiamata a 2: limitata. Prova il profilo Risparmio o un altro codec.');
    }
    if (b.length) {
      var f = b.reduce(function (s, r) { return s + r.fps; }, 0) / b.length;
      if (f >= buono) out.push('✅ Chiamata a 4: la TV regge 3 invii contemporanei.');
      else if (f >= medio) out.push('🟡 Chiamata a 4: possibile ma meno fluida.');
      else out.push('🔴 Chiamata a 4: troppo pesante per questa TV con questo codec.');
    }
    return out.join('<br>');
  }

  function testQualita() {
    if (dg.occupato || !dg.stream) { if (!dg.stream) C.toast('Prima serve la webcam accesa'); return; }
    if (!window.RTCPeerConnection) { C.toast('Videochiamate non supportate su questo dispositivo'); return; }
    occupa(true);
    var righe = [];
    var imp = dg.stream.getVideoTracks()[0].getSettings();
    var fpsSorgente = imp.frameRate || 30;
    sez.test = '<p>Test chiamata a 2 in corso (12 secondi)…</p>';
    render();
    var r1;
    testCodifica(1, 12).then(function (r) {
      r1 = r;
      righe.push(rigaRisultato('Chiamata a 2', r));
      sez.test = tabella(righe) + '<p>Test chiamata a 4 in corso (12 secondi)…</p>';
      render();
      return testCodifica(3, 12);
    }).then(function (r3) {
      righe.push(rigaRisultato('Chiamata a 4', r3));
      sez.test = tabella(righe) + '<p class="dg-giudizio">' + giudizio(r1, r3, fpsSorgente) + '</p>' +
        (fpsSorgente < 25 ? '<p class="dg-nota">La webcam fornisce solo ' + Math.round(fpsSorgente) + ' fps: con più luce di solito arriva a 30.</p>' : '') +
        '<p class="dg-nota">Profilo: ' + esc(V.profiloQualita().nome) + ', codec: ' + esc(V.CODEC[V.imp('codec', 'auto')] || 'Automatico') +
        '. Il test misura la codifica della TV; in chiamata conta anche la velocità della connessione.</p>';
      render();
    }).catch(function (e) {
      sez.test = '<p class="dg-errore">Test non riuscito: ' + esc(e && e.message ? e.message : String(e)) + '</p>';
      render();
    }).then(function () { occupa(false); });
  }

  // ---------- codec e hardware ----------
  function infoCodec() {
    var ver = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1];
    var righe = [['Motore web', ver ? 'Chromium ' + ver : esc(navigator.userAgent.slice(0, 60))]];
    if (window.RTCRtpSender && RTCRtpSender.getCapabilities) {
      var cap = RTCRtpSender.getCapabilities('video');
      var nomi = [];
      (cap ? cap.codecs : []).forEach(function (c) {
        var n = c.mimeType.split('/')[1];
        if (/rtx|red|ulpfec|flexfec/i.test(n)) return;
        if (nomi.indexOf(n) < 0) nomi.push(n);
      });
      righe.push(['Codec disponibili', esc(nomi.join(', '))]);
    }
    righe.push(['Codec scelto', esc(V.CODEC[V.imp('codec', 'auto')] || 'Automatico')]);
    sez.codec = tabella(righe);
  }

  function infoHardware() {
    if (!(window.Android && Android.infoHardware)) {
      sez.hardware = '<p>Disponibile solo nell\'app installata sulla TV.</p>';
      return;
    }
    try {
      var h = JSON.parse(Android.infoHardware());
      var html = tabella([['TV', esc(h.modello || '?')], ['Android', esc(h.android || '?')]]);
      var cam = [['Camera', 'Risoluzioni', 'Fps']];
      (h.camere || []).forEach(function (c) {
        cam.push([esc(c.tipo) + ' #' + esc(c.id), esc((c.risoluzioni || []).join(', ')), esc((c.fps || []).join(', '))]);
      });
      html += cam.length > 1 ? tabella(cam) : '<p>Nessuna camera vista dal sistema.</p>';
      var enc = [['Encoder', 'Tipo', 'Max', 'Fps 1080p', 'Fps 4K']];
      (h.encoder || []).forEach(function (e) {
        enc.push([esc(e.codec) + '<br><small>' + esc(e.nome) + '</small>', e.hardware ? '✅ hardware' : 'software', esc(e.max), esc(e.fps1080), esc(e.fps2160)]);
      });
      html += tabella(enc);
      sez.hardware = html;
    } catch (e) {
      sez.hardware = '<p class="dg-errore">Lettura hardware non riuscita.</p>';
    }
  }

  // ---------- apertura / chiusura ----------
  function apriDiagnostica() {
    dg.attiva = true;
    sez.webcam = sez.risoluzioni = sez.test = sez.turn = '';
    infoCodec();
    infoHardware();
    render();
    occupa(false);
    C.mostra('s-diagnostica', 'dg-test');
    avviaAnteprima();
  }

  function chiudiDiagnostica() {
    dg.attiva = false;
    clearInterval(dg.misura);
    fermaStream();
    C.mostra('s-impostazioni', 'btn-diagnostica');
  }

  // ---------- impostazioni qualità e codec ----------
  var ORDINE_Q = ['massima', '4k', 'risparmio'];
  var ORDINE_C = ['auto', 'h264', 'vp8', 'vp9', 'av1'];
  function etichetteImpostazioni() {
    $('btn-qualita').textContent = '🎥 Qualità video: ' + V.profiloQualita().nome;
    $('btn-codec').textContent = '🧩 Codec video: ' + (V.CODEC[V.imp('codec', 'auto')] || 'Automatico');
  }
  function ciclo(chiave, ordine, def) {
    var att = V.imp(chiave, def);
    var i = ordine.indexOf(att);
    V.salvaImp(chiave, ordine[(i + 1) % ordine.length]);
    etichetteImpostazioni();
  }

  $('btn-diagnostica').onclick = apriDiagnostica;
  $('btn-qualita').onclick = function () { ciclo('qualita', ORDINE_Q, 'massima'); };
  $('btn-codec').onclick = function () { ciclo('codec', ORDINE_C, 'auto'); };
  $('dg-indietro').onclick = chiudiDiagnostica;
  $('dg-test').onclick = testQualita;
  $('dg-risoluzioni').onclick = provaRisoluzioni;
  $('dg-camera').onclick = cambiaCamera;
  $('dg-turn').onclick = function () {
    sez.turn = '<p>Verifica in corso…</p>';
    render();
    V.testTurn().then(function (r) {
      sez.turn = r.ok
        ? '<p class="dg-giudizio">✅ Funziona: ponte raggiunto in ' + r.ms + ' ms' + (r.protocollo ? ' (' + r.protocollo + ')' : '') + '.</p><p class="dg-nota">Le chiamate tra reti diverse (4G, hotel) passeranno da qui quando il collegamento diretto non riesce.</p>'
        : '<p class="dg-errore">❌ Non funziona: ' + esc(r.motivo) + '</p>';
      render();
    });
  };

  C.estensioni.impostazioni.push(etichetteImpostazioni);
  C.estensioni.indietro.push(function () {
    if (C.schermata() !== 's-diagnostica') return false;
    if (dg.occupato) { C.toast('Attendi la fine della prova…'); return true; }
    chiudiDiagnostica();
    return true;
  });
  C.estensioni.scollega.push(function () { if (dg.attiva) { dg.attiva = false; clearInterval(dg.misura); fermaStream(); } });
})();
