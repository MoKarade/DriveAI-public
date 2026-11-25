/**
 * QuestionsRegles.gs — Questions IA (#18) et Règles en 1 phrase + mode auto annulable (#19).
 * `04 · Immigration` et `Anna` : lecture seule sur métadonnées (#18), exclus de toute mutation (#19).
 */
var QUESTIONS_MAX_CARS = 300, REGLES_PHRASE_MAX_CARS = 240, QUESTIONS_MAX_SOURCES = 6;
var QR_STOP_ = { le: 1, la: 1, les: 1, un: 1, une: 1, des: 1, de: 1, du: 1, au: 1, aux: 1, et: 1, ou: 1, est: 1, sont: 1, quel: 1, quelle: 1, quels: 1, quelles: 1, quand: 1, combien: 1, comment: 1, pourquoi: 1, mon: 1, ma: 1, mes: 1, ton: 1, pour: 1, avec: 1, dans: 1, sur: 1, par: 1, qui: 1, que: 1, quoi: 1, dont: 1, ce: 1, cette: 1, ces: 1, ai: 1, as: 1, ont: 1, il: 1, elle: 1, je: 1, tu: 1, nous: 1, vous: 1, ils: 1, elles: 1, tout: 1, tous: 1, toutes: 1, si: 1, alors: 1, mails: 1, mail: 1, courriel: 1, courriels: 1, document: 1, documents: 1, fichier: 1, fichiers: 1, dossier: 1, dossiers: 1, chez: 1, vers: 1, comme: 1, etre: 1 };
function normaliserQR_(s) {
  if (typeof normaliserCle_ === 'function') return normaliserCle_(s);
  var t = String(s == null ? '' : s).toLowerCase();
  return (t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t).replace(/[’ʼ´']/g, ' ').replace(/\s+/g, ' ').trim();
}
function nettoyerBalisesQR_(s) { return String(s == null ? '' : s).replace(/<<<\s*(CORPS|FIN)\s*>>>/gi, ' ').replace(/<<<|>>>/g, ' ').replace(/[\r\n]+/g, ' ').trim(); }
function tokeniserQR_(s, minL) { return normaliserQR_(s).split(/[^a-z0-9]+/).filter(function (w) { return w.length >= (minL || 3) && !QR_STOP_[w]; }); }
function lienDriveQR_(fid) { return fid ? ('https://drive.google.com/file/d/' + encodeURIComponent(String(fid).trim()) + '/view') : ''; }
function budgetQuestionDepasse_() {
  if (typeof budgetSignauxDepasse_ === 'function') return budgetSignauxDepasse_();
  try { var s = typeof syntheseCoutMois_ === 'function' ? syntheseCoutMois_() : null, d = s && typeof s.dollars === 'number' ? s.dollars : NaN, cib = (typeof CONFIG !== 'undefined' && CONFIG.LLM_BUDGET_CIBLE != null) ? CONFIG.LLM_BUDGET_CIBLE : 25; return !isFinite(d) || !isFinite(cib) || d >= cib; } catch (e) { return true; }
}
/** PURE (#18) — Pré-filtrage gratuit multi-onglets (inclut `04 · Immigration` et `Anna` en lecture seule). */
function collecterSourcesQuestionPure_(question, donnees, maxSources) {
  var qN = normaliserQR_(question), qT = tokeniserQR_(question, 2), max = maxSources > 0 ? maxSources : QUESTIONS_MAX_SOURCES;
  if (!qN) return [];
  var d = donnees || {}, sigId = {}, cands = [], vus = {}, sigL = Array.isArray(d.signaux) ? d.signaux : [];
  sigL.forEach(function (s) { var o = Array.isArray(s) ? { fileId: s[0], categorie: s[1], fournisseur: s[2], domaine: s[3], chemin: s[4], dateDoc: s[5], dateExpiration: s[6], montant: s[7], devise: s[8], finGarantie: s[9], delaiRetour: s[10], statutReclamation: s[11] } : s; if (o && o.fileId) sigId[String(o.fileId).trim()] = o; });
  var docs = typeof indexerDocumentsVivantsPacks_ === 'function' ? indexerDocumentsVivantsPacks_(d.index || [], sigL) : [];
  var vE = /\bexpir|\becheance|\brenouvel|\bvalidit/.test(qN), vM = /\bmontant|\bcombien|\bfacture|\bcout|\bprix|\brembours|\breclam/.test(qN), vG = /\bgarantie|\bretour/.test(qN);
  var scorer = function (txt, bon) { var tn = normaliserQR_(txt), sc = bon || 0; qT.forEach(function (tk) { if (tn.indexOf(tk) !== -1) sc += tk.length >= 5 ? 12 : 8; else if (tk.length >= 5 && tn.indexOf(tk.slice(0, 5)) !== -1) sc += 5; }); return sc; };
  var add = function (k, it) { if (!vus[k]) { vus[k] = true; cands.push(it); } };
  docs.forEach(function (doc) {
    var sig = sigId[doc.fileId] || {}, b = (vE && doc.dateExpiration ? 8 : 0) + (vM && sig.montant !== '' && sig.montant != null ? 8 : 0) + (vG && (sig.finGarantie || sig.delaiRetour) ? 8 : 0);
    var sc = scorer([doc.nom, doc.domaine, doc.chemin, doc.categorie, doc.fournisseur, doc.dateDoc, doc.dateExpiration, sig.statutReclamation].join(' '), b);
    if (sc > b && sc >= 8) add(doc.fileId, { fileId: doc.fileId, nom: doc.nom, chemin: doc.chemin, lien: lienDriveQR_(doc.fileId), score: sc, date: doc.dateDoc || '', meta: { domaine: doc.domaine, dateDoc: doc.dateDoc, dateExpiration: doc.dateExpiration || '', montant: sig.montant !== '' && sig.montant != null ? (sig.montant + ' ' + (sig.devise || 'CAD')).trim() : '', finGarantie: sig.finGarantie || '', delaiRetour: sig.delaiRetour || '', fournisseur: doc.fournisseur || '', statut: sig.statutReclamation || '' } });
  });
  (d.copilote || []).forEach(function (c) { var sc = c && c.statut !== 'ignoré' ? scorer([c.titre, c.domaine, c.chemin, c.type, c.statut].join(' '), 0) : 0; if (sc >= 12) add('cop:' + c.id, { fileId: '', nom: String(c.titre || c.type || ''), chemin: String(c.chemin || c.domaine || ''), lien: '', score: sc, date: '', meta: { domaine: c.domaine || '', statut: c.statut || '' } }); });
  (d.liens || []).forEach(function (lr) { var fid = String(lr[6] || '').trim(), nom = String(lr[7] || '').trim(), chem = String(lr[5] || '').trim(), dom = String(lr[4] || '').trim(), adr = String(lr[3] || '').trim(), sc = (!fid || !vus[fid]) ? scorer([nom, chem, dom, adr].join(' '), 0) : 0; if (sc >= 12) add(fid || ('ln:' + adr + nom), { fileId: fid, nom: nom || chem || adr, chemin: chem || dom, lien: lienDriveQR_(fid), score: sc, date: '', meta: { domaine: dom, expediteur: adr } }); });
  (d.entites || []).forEach(function (er) { var nE = String(er[1] || '').trim(), dE = String(er[0] || '').trim(), sc = nE && nE !== 'Entité' ? scorer([nE, dE, er[2], er[5]].join(' '), 0) : 0; if (sc >= 12) add('ent:' + nE, { fileId: '', nom: 'Entité : ' + nE, chemin: dE, lien: '', score: sc - 2, date: '', meta: { domaine: dE, statut: String(er[3] || '') } }); });
  (d.actions || []).forEach(function (ar) { var sc = scorer([ar[2], ar[7]].join(' '), 0); if (sc >= 14) add('act:' + ar[0], { fileId: '', nom: String(ar[7] || ar[2] || ''), chemin: '', lien: '', score: sc - 3, date: '', meta: { type: String(ar[2] || ''), statut: String(ar[6] || '') } }); });
  return cands.sort(function (a, b) { return b.score !== a.score ? b.score - a.score : (b.date > a.date ? 1 : (b.date < a.date ? -1 : 0)); }).slice(0, max);
}
/** PURE (#18) — Synthèse déterministe gratuite citant les sources et liens Drive. */
function synthetiserReponseGratuitePure_(question, sources) {
  if (!sources || !sources.length) return 'Aucune pièce ou métadonnée correspondante trouvée dans ton DriveAI.';
  return 'Voici les éléments trouvés :\n' + sources.slice(0, 4).map(function (s) {
    var m = s.meta || {}, det = [m.dateDoc && ('date ' + m.dateDoc), m.dateExpiration && ('expire le ' + m.dateExpiration), m.montant, m.finGarantie && ('garantie ' + m.finGarantie), m.delaiRetour && ('retour ' + m.delaiRetour), m.statut].filter(Boolean);
    return '- ' + s.nom + (s.chemin ? ' (' + s.chemin + ')' : '') + (det.length ? ' [' + det.join(', ') + ']' : '') + (s.lien ? ' : ' + s.lien : '');
  }).join('\n');
}
function chargerDonneesQuestion_() {
  var lireF = function (nom, cols, maxL) { try { if (typeof feuille_ !== 'function') return []; var f = feuille_(nom), d = f ? f.getLastRow() : 0; if (d < 2) return []; var deb = maxL ? Math.max(2, d - maxL + 1) : 2; return f.getRange(deb, 1, d - deb + 1, cols).getValues(); } catch (e) { return []; } };
  return { index: typeof lireLignesIndexCopilote_ === 'function' ? lireLignesIndexCopilote_() : lireF('Index', 9, 15000), signaux: typeof lireSignaux_ === 'function' ? lireSignaux_() : [], liens: typeof lireLiensCopilote_ === 'function' ? lireLiensCopilote_() : lireF('Liens', 8, 500), actions: lireF('Actions', 8, 200), entites: typeof lireEntitesPacks_ === 'function' ? lireEntitesPacks_() : lireF('Entités', 6, 300), copilote: typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : [] };
}
/** #18 — Répond en français à une question sur les métadonnées structurées (frein 25 $/mois). */
function repondreQuestionCopilote_(payload) {
  var q = nettoyerBalisesQR_(payload && typeof payload.question === 'string' ? payload.question : '');
  if (!q) return { ok: false, erreur: 'question requise' };
  if (q.length > QUESTIONS_MAX_CARS) return { ok: false, erreur: 'question trop longue (max ' + QUESTIONS_MAX_CARS + ' car.)' };
  var sources = collecterSourcesQuestionPure_(q, chargerDonneesQuestion_(), QUESTIONS_MAX_SOURCES), reponse = synthetiserReponseGratuitePure_(q, sources), llmUtilise = false;
  if (typeof chargerPannePlateforme_ === 'function') { try { chargerPannePlateforme_(); } catch (eP) {} }
  var mod = (typeof CONFIG !== 'undefined' && (CONFIG.LLM_MODELE || CONFIG.ANALYSE_MODELE)) || '';
  if (sources.length > 0 && mod && !budgetQuestionDepasse_() && !(typeof estPannePlateforme_ === 'function' && estPannePlateforme_()) && typeof appelAnthropicTexte_ === 'function') {
    if (typeof poserOperationCourante_ === 'function') { try { poserOperationCourante_('app:copilote-question'); } catch (eOp) {} }
    if (typeof reinitialiserUsage_ === 'function') reinitialiserUsage_();
    try {
      var bloc = 'Question : ' + q + '\nSources :\n' + sources.map(function (s) { return '- ' + nettoyerBalisesQR_(s.nom) + ' | ' + nettoyerBalisesQR_(s.chemin) + ' | ' + JSON.stringify(s.meta || {}) + (s.lien ? ' | ' + s.lien : ''); }).join('\n');
      var rep = appelAnthropicTexte_(mod, 'Tu es le copilote DriveAI. Réponds en français simple (<= 6 lignes) depuis ces métadonnées structurées uniquement. Cite le nom exact et le lien Drive. N\'invente rien.', bloc, 350);
      if (rep && String(rep).trim()) { reponse = String(rep).trim().slice(0, 1200); llmUtilise = true; }
    } catch (eLlm) {} finally { if (typeof flushUsage_ === 'function') { try { flushUsage_(); } catch (eF) {} } }
  }
  return { ok: true, reponse: reponse, llmUtilise: llmUtilise, sources: sources.map(function (s) { var o = { nom: s.nom, lien: s.lien || '' }; if (s.fileId) o.fileId = s.fileId; if (s.chemin) o.chemin = s.chemin; return o; }) };
}
function toucheZoneOuActionInterditeRegle_(texte, domaine, cible) {
  var n = normaliserQR_(texte);
  if (/\b(supprimer|supprime|effacer|efface|detruire|detruit|corbeille|vider|sendemail|transferer|repondre\s+automatiquement|spam)\b/.test(n)) return true;
  if (/\b(?:retirer|enlever|oter|supprimer)\s+(?:(?:tous|toutes)\s+)?(?:(?:un|une|le|la|les|des|l|ce|cet|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses)\s+)?(?:libell|etiqu)[a-z]*\b/.test(n) || /\benvoyer\s+(?:(?:un|une|des|les)\s+)?(?:(?:e[- ]?)?mail|courriel)s?\b/.test(n)) return true;
  if (/\b(04\s*·\s*immigration|immigration|ircc|csq|caq|anna|00\s*·\s*packs|00\s*·\s*a\s*trier|00\s*·\s*a\s*verifier|_technique|_doublons|_medias|donnees\s*&\s*exports)\b/.test(n) || /\b_[a-z0-9]+/.test(n)) return true;
  return typeof estZoneProtegeeCopilote_ === 'function' && (estZoneProtegeeCopilote_(cible, domaine) || estZoneProtegeeCopilote_(texte, domaine));
}
function regleEstInterditeQR_(r, a) {
  var al = (a && a.alors) || {}, z = [r && r.chemin, r && r.domaine, a && a.domaine, a && a.cible, a && a.phrase, al.domaine, al.cible, al.libelle];
  if (toucheZoneOuActionInterditeRegle_(z.filter(Boolean).join(' '), (a && a.domaine) || al.domaine || (r && r.domaine) || '', (a && a.cible) || al.cible || (r && r.chemin) || '')) return true;
  return typeof estZoneProtegeeCopilote_ === 'function' && [a && a.domaine, al.domaine, al.libelle, al.cible].some(function (v) { return !!(v && estZoneProtegeeCopilote_(v, v)); });
}
/** PURE (#19) — Parse une règle en 1 phrase en français, rejette destruction ou zone protégée. */
function parserPhraseRegle_(phrase, domainesConnus, libellesConnus) {
  var p = nettoyerBalisesQR_(phrase);
  if (!p || p.length < 5 || p.length > REGLES_PHRASE_MAX_CARS || toucheZoneOuActionInterditeRegle_(p, '', '')) return null;
  var mSep = /\b(?:alors)\b|=>|->|,/i.exec(p), partSi = mSep ? p.slice(0, mSep.index) : p, partAlors = mSep ? p.slice(mSep.index + mSep[0].length) : p;
  var mExp = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(partSi), siMots = tokeniserQR_(normaliserQR_(partSi).replace(/^si\s+|^quand\s+/, ''), 3).slice(0, 6);
  if (!siMots.length && !mExp) return null;
  var doms = Array.isArray(domainesConnus) ? domainesConnus
    : (typeof domainesAutorises_ === 'function' ? domainesAutorises_()
      : ((typeof CONFIG !== 'undefined' && CONFIG.DOMAINES ? Object.keys(CONFIG.DOMAINES) : [])
        .concat((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.DOMAINES_AUTO)) ? CONFIG.DOMAINES_AUTO : [])));
  var libs = Array.isArray(libellesConnus) ? libellesConnus : [], nAl = normaliserQR_(partAlors), domaine = '', libelle = '', cible = '', bestIdx = -1;
  for (var i = 0; i < doms.length; i++) {
    var dn = normaliserQR_(doms[i]), idx = dn ? nAl.indexOf(dn) : -1;
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) { bestIdx = idx; domaine = doms[i]; }
  }
  if (!domaine) {
    for (var i2 = 0; i2 < doms.length; i2++) {
      var ct = normaliserQR_(doms[i2]).replace(/^\d+\s*·\s*/, ''), idx2 = ct.length >= 4 ? nAl.indexOf(ct) : -1;
      if (idx2 !== -1 && (bestIdx === -1 || idx2 < bestIdx)) { bestIdx = idx2; domaine = doms[i2]; }
    }
  }
  for (var j = 0; j < libs.length; j++) if (nAl.indexOf(normaliserQR_(libs[j])) !== -1) { libelle = libs[j]; break; }
  var mCib = /(?:dans|vers|dossier|libell[eé]|étiquette|etiquette|catégorie|categorie)\s+([A-Za-z0-9À-ÿ &_/·.-]{2,220})/i.exec(partAlors);
  if (mCib) {
    var seg = mCib[1].trim().replace(/\s+(?:(?:et|puis)\s+(?:l['’]|la\s+|le\s+)?(?:marquer|archiver|libeller|etiqueter|étiqueter|classer|ranger|deplacer|déplacer|mettre|passer|ajouter|en\s+)|en\s+(?:important|prioritaire|archive))\b.*$/i, '').replace(/[.,;:!?]+$/, '').trim();
    if (!libelle && /libell|etiqu|categori/i.test(mCib[0])) libelle = seg;
    if (seg && !domaine && !libelle) cible = seg;
    else if (seg && domaine && seg.indexOf('/') !== -1) {
      var segsCib = seg.split('/').map(function (x) { return x.trim(); }).filter(Boolean);
      var dN = normaliserQR_(domaine), dCourt = normaliserQR_(domaine.replace(/^\d+\s*·\s*/, ''));
      if (segsCib.length && (normaliserQR_(segsCib[0]) === dN || (dCourt && normaliserQR_(segsCib[0]) === dCourt))) segsCib.shift();
      cible = segsCib.length ? (domaine + '/' + segsCib.join('/')) : domaine;
    }
    else if (seg && domaine && normaliserQR_(seg) !== normaliserQR_(domaine) && normaliserQR_(seg) !== normaliserQR_(domaine.replace(/^\d+\s*·\s*/, ''))) cible = domaine + '/' + seg;
  }
  if (!cible && domaine) cible = domaine;
  if (!libelle && domaine) { var cD = domaine.replace(/^\d+\s*·\s*/, '').split('&')[0].trim(); if (!libs.length || libs.indexOf(cD) !== -1) libelle = cD; }
  if (toucheZoneOuActionInterditeRegle_(cible, domaine, cible)) return null;
  var vImp = /\b(important|a traiter|prioritaire)\b/.test(nAl), vArch = /\b(archiver|archive)\b/.test(nAl), vGm = /\b(mail|courriel|gmail|libell|etiqu|important|a traiter|archiver|archive)\b/.test(nAl) || !!libelle || !!mExp, vDr = /\b(drive|dossier|deplacer|ranger|classer)\b/.test(nAl) || !!domaine || (!!cible && !/libell|etiqu/i.test(nAl));
  var canal = (vGm && vDr) ? 'les-deux' : (vGm ? 'gmail' : 'drive'), act = vDr && (cible || domaine) ? 'deplacer' : (libelle ? 'libeller' : (vImp ? 'important' : (vArch ? 'archiver' : '')));
  return act ? { cle: 'regle|' + normaliserQR_(siMots.join('-') + (mExp ? '-' + mExp[0] : '') + '|' + canal + '|' + (cible || libelle || act)).slice(0, 64), phrase: p, domaine: domaine, cible: cible, si: mExp ? { mots: siMots, exp: mExp[0].toLowerCase() } : { mots: siMots }, alors: { canal: canal, action: act, libelle: libelle || '', domaine: domaine, cible: cible, important: vImp, archiver: vArch }, auto: false, validations: 0 } : null;
}
function parserRegleViaLlm_(phrase) {
  var mod = (typeof CONFIG !== 'undefined' && (CONFIG.LLM_MODELE || CONFIG.ANALYSE_MODELE)) || '';
  if (!mod || budgetQuestionDepasse_() || (typeof estPannePlateforme_ === 'function' && estPannePlateforme_()) || typeof appelAnthropicTexte_ !== 'function') return null;
  if (typeof poserOperationCourante_ === 'function') { try { poserOperationCourante_('app:copilote-regle'); } catch (eO) {} }
  if (typeof reinitialiserUsage_ === 'function') reinitialiserUsage_();
  try {
    var raw = appelAnthropicTexte_(mod, 'Convertis en JSON {"mots":[],"canal":"drive|gmail|les-deux","action":"deplacer|libeller|important|archiver","domaine":"","cible":"","libelle":"","important":false,"archiver":false} ou null.', phrase, 220);
    var a = raw ? raw.indexOf('{') : -1, b = raw ? raw.lastIndexOf('}') : -1, o = (a !== -1 && b > a) ? JSON.parse(raw.slice(a, b + 1)) : null;
    var okAct = { deplacer: 1, libeller: 1, important: 1, archiver: 1 }, okCan = { drive: 1, gmail: 1, 'les-deux': 1 };
    if (!o || !Array.isArray(o.mots) || !o.mots.length || !Object.prototype.hasOwnProperty.call(okAct, o.action) || !Object.prototype.hasOwnProperty.call(okCan, o.canal) || toucheZoneOuActionInterditeRegle_([phrase, o.cible, o.libelle, o.domaine].join(' '), o.domaine || '', o.cible || '') || (typeof estZoneProtegeeCopilote_ === 'function' && o.libelle && estZoneProtegeeCopilote_(o.libelle, o.domaine || ''))) return null;
    var mots = o.mots.map(function (m) { return normaliserQR_(m); }).filter(Boolean).slice(0, 6);
    return mots.length ? { cle: 'regle|' + normaliserQR_(mots.join('-') + '|' + (o.cible || o.libelle || o.action)).slice(0, 64), phrase: phrase, domaine: String(o.domaine || ''), cible: String(o.cible || o.domaine || ''), si: { mots: mots }, alors: { canal: o.canal, action: o.action, libelle: String(o.libelle || ''), domaine: String(o.domaine || ''), cible: String(o.cible || ''), important: !!o.important, archiver: !!o.archiver }, auto: false, validations: 0 } : null;
  } catch (e) { return null; } finally { if (typeof flushUsage_ === 'function') { try { flushUsage_(); } catch (eF) {} } }
}
function lireReglesCopilote_(seulementAuto) {
  return (typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : []).filter(function (c) {
    if (c.type !== 'regle-auto' || c.statut === 'ignoré') return false;
    var a = typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(c.actionJson) : {};
    return seulementAuto ? (c.statut === 'auto' && a.auto !== false) : (c.statut === 'proposé' || c.statut === 'auto' || c.statut === 'actif');
  });
}
function serialiserRegleAction_(obj) {
  var copie = {};
  if (obj && typeof obj === 'object') Object.keys(obj).forEach(function (k) {
    copie[k] = Array.isArray(obj[k]) ? obj[k].slice() : (obj[k] && typeof obj[k] === 'object' ? JSON.parse(JSON.stringify(obj[k])) : obj[k]);
  });
  var len = function () { return JSON.stringify(copie).length; };
  if (len() > 492 && copie.alors && typeof copie.alors === 'object') {
    if (copie.alors.domaine === copie.domaine || !copie.alors.domaine) delete copie.alors.domaine;
    if (copie.alors.cible === copie.cible || !copie.alors.cible) delete copie.alors.cible;
  }
  if (len() > 492 && typeof copie.phrase === 'string') {
    [120, 40].forEach(function (lim) { if (len() > 492 && typeof copie.phrase === 'string') copie.phrase = copie.phrase.slice(0, lim); });
    if (len() > 492) delete copie.phrase;
  }
  if (len() > 492 && copie.alors && typeof copie.alors === 'object') {
    if (copie.alors.libelle === '') delete copie.alors.libelle;
    if (copie.alors.important === false) delete copie.alors.important;
    if (copie.alors.archiver === false) delete copie.alors.archiver;
  }
  var out = typeof serialiserActionCopilote_ === 'function' ? serialiserActionCopilote_(copie) : JSON.stringify(copie);
  if (out === '{}' && len() <= 500) out = JSON.stringify(copie);
  return out.length <= 500 ? out : '{}';
}
/** #19 — Crée, bascule auto/proposé ou désactive une règle en 1 phrase dans `Copilote`. */
function executerRegleCopilote_(payload) {
  var p = payload || {}, mode = String(p.mode || '').trim();
  if (typeof feuille_ !== 'function') return { ok: false, erreur: 'onglet Copilote indisponible' };
  var fSheet = feuille_('Copilote');
  if (mode === 'creer') {
    var phrase = nettoyerBalisesQR_(p.phrase);
    if (!phrase || phrase.length < 5 || phrase.length > REGLES_PHRASE_MAX_CARS) return { ok: false, erreur: 'phrase invalide' };
    if (toucheZoneOuActionInterditeRegle_(phrase, '', '')) return { ok: false, erreur: 'zone protégée ou action interdite' };
    var libs = []; try { if (typeof libellesUtilisateur_ === 'function') libs = Object.keys(libellesUtilisateur_()); } catch (eL) {}
    var regle = parserPhraseRegle_(phrase, null, libs) || parserRegleViaLlm_(phrase);
    if (!regle) return { ok: false, erreur: 'règle incompréhensible (utilise « Si ... alors ... »)' };
    var exist = lireReglesCopilote_(false);
    for (var i = 0; i < exist.length; i++) if ((typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(exist[i].actionJson) : {}).cle === regle.cle) return { ok: true, regleId: exist[i].id, auto: exist[i].statut === 'auto', message: 'Règle déjà enregistrée.' };
    var id = 'cop-' + Date.now().toString(36) + '-' + (Math.random().toString(36) + '0000').slice(2, 6);
    fSheet.appendRow([id, new Date(), 'regle', 'regle-auto', regle.domaine || '', regle.cible || '', phrase.slice(0, 140), serialiserRegleAction_(regle), 'proposé', 0]);
    return { ok: true, regleId: id, auto: false, message: 'Règle créée en mode proposé (annulable).' };
  }
  var regleId = String(p.regleId || '').trim(), cartes = typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : [], carte = null;
  for (var j = 0; j < cartes.length; j++) if (cartes[j].id === regleId && cartes[j].type === 'regle-auto') { carte = cartes[j]; break; }
  if (!carte) return { ok: false, erreur: 'règle introuvable' };
  var act = typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(carte.actionJson) : {};
  if (mode === 'basculer-auto') {
    if (carte.statut === 'ignoré') return { ok: false, erreur: 'règle désactivée' };
    if (regleEstInterditeQR_(carte, act)) return { ok: false, erreur: 'zone protégée — mode auto interdit' };
    var nAuto = carte.statut !== 'auto'; act.auto = nAuto;
    fSheet.getRange(carte.row, 2).setValue(new Date()); fSheet.getRange(carte.row, 8).setValue(serialiserRegleAction_(act)); fSheet.getRange(carte.row, 9).setValue(nAuto ? 'auto' : 'proposé');
    return { ok: true, regleId: regleId, auto: nAuto, message: nAuto ? 'Mode automatique activé.' : 'Mode automatique désactivé.' };
  }
  if (mode === 'supprimer-auto') { act.auto = false; fSheet.getRange(carte.row, 2).setValue(new Date()); fSheet.getRange(carte.row, 8).setValue(serialiserRegleAction_(act)); fSheet.getRange(carte.row, 9).setValue('ignoré'); return { ok: true, regleId: regleId, auto: false, message: 'Règle désactivée.' }; }
  return { ok: false, erreur: 'mode invalide' };
}
/** Incrémente les validations d'une règle et passe automatiquement en `auto` à >= 3 validations. */
function incrementerValidationRegle_(regleId) {
  var cartes = regleId && typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : [], carte = null;
  for (var i = 0; i < cartes.length; i++) if (cartes[i].id === regleId && cartes[i].type === 'regle-auto') { carte = cartes[i]; break; }
  if (!carte || carte.statut === 'ignoré' || typeof feuille_ !== 'function') return null;
  var act = typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(carte.actionJson) : {};
  if (regleEstInterditeQR_(carte, act)) return null;
  var seuil = (typeof CONFIG !== 'undefined' && CONFIG.COPILOTE_SEUIL_AUTO) || 3, nbVal = (Number(carte.validations) || 0) + 1, auto = carte.statut === 'auto' || nbVal >= seuil, fSheet = feuille_('Copilote');
  act.validations = nbVal; if (auto) act.auto = true;
  fSheet.getRange(carte.row, 8).setValue(serialiserRegleAction_(act)); fSheet.getRange(carte.row, 9).setValue(auto ? 'auto' : 'proposé'); fSheet.getRange(carte.row, 10).setValue(nbVal);
  return { validations: nbVal, auto: auto, statut: auto ? 'auto' : 'proposé' };
}
/** PURE (#19) — Évalue les règles Gmail actives (`auto === true`) avant `analyserFil_`. */
function appliquerReglesGmail_(reglesAuto, ctxFil) {
  var c = ctxFil || {}, txt = normaliserQR_([c.expediteur, c.adresse, c.sujet].concat(c.nomsPj || []).join(' ')), adr = String(c.adresse || '').toLowerCase(), cands = Array.isArray(c.candidats) ? c.candidats : [];
  for (var i = 0; i < (reglesAuto || []).length; i++) {
    var r = reglesAuto[i], a = r && r.actionJson ? (typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(r.actionJson) : {}) : (r || {});
    if (!a || !a.si || !a.alors || a.alors.canal === 'drive' || regleEstInterditeQR_(r, a)) continue;
    if (a.si.exp && adr !== String(a.si.exp).toLowerCase()) continue;
    var mots = Array.isArray(a.si.mots) ? a.si.mots : [];
    if ((!mots.length && !a.si.exp) || mots.some(function (m) { return txt.indexOf(normaliserQR_(m)) === -1; })) continue;
    var lib = ''; if (a.alors.libelle) { var lN = normaliserQR_(a.alors.libelle); for (var j = 0; j < cands.length; j++) if (normaliserQR_(cands[j]) === lN) { lib = cands[j]; break; } }
    return { regleId: r.id || '', libelle: lib, important: !!(a.alors.important && !c.zoneProtegee), archiver: !!(a.alors.archiver && !c.zoneProtegee) };
  }
  return null;
}
function idDomaineRegleQR_(dom) {
  if (!dom || typeof CONFIG === 'undefined') return '';
  if (CONFIG.DOMAINES && CONFIG.DOMAINES[dom]) return CONFIG.DOMAINES[dom];
  if (Array.isArray(CONFIG.DOMAINES_AUTO) && CONFIG.DOMAINES_AUTO.indexOf(dom) !== -1) {
    try {
      var props = typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties ? PropertiesService.getScriptProperties() : null;
      return (props && props.getProperty('DriveAI_DOM_' + dom)) || '';
    } catch (e) { return ''; }
  }
  return '';
}
/** #19 — Applique en priorité les règles Drive (`auto` → déplacement réversible, `proposé` → carte `cascade`). */
function appliquerReglesDriveCopilote_(lignesIndex, depasse, maxRestant) {
  var regles = lireReglesCopilote_(false), traitees = 0, creees = 0, proteges = typeof ensembleDomainesProteges_ === 'function' ? ensembleDomainesProteges_() : {}, parId = {}, ordre = [];
  (lignesIndex || []).forEach(function (l) { var fid = typeof fileIdDeLigneIndex_ === 'function' ? fileIdDeLigneIndex_(l) : String(l[8] || '').trim(); if (fid) { if (!parId[fid]) ordre.push(fid); parId[fid] = l; } });
  for (var i = 0; i < regles.length && (traitees + creees) < maxRestant && !(depasse && depasse()); i++) {
    var r = regles[i], a = typeof parserActionCopilote_ === 'function' ? parserActionCopilote_(r.actionJson) : {};
    if (!a.si || !a.alors || a.alors.canal === 'gmail' || regleEstInterditeQR_(r, a)) continue;
    var mots = Array.isArray(a.si.mots) ? a.si.mots : [], dom = String(a.domaine || r.domaine || '').trim(), chemCib = String(a.cible || r.chemin || dom).trim();
    if (!mots.length || !dom) continue;
    var cibId = idDomaineRegleQR_(dom);
    if (!cibId || proteges[cibId]) continue;
    try {
      var domDir = DriveApp.getFolderById(cibId);
      if (!domDir || domDir.isTrashed() || (typeof estProtegeDriveCopilote_ === 'function' && estProtegeDriveCopilote_(domDir, proteges))) cibId = '';
    } catch (eD) { cibId = ''; }
    if (!cibId || proteges[cibId]) continue;
    if (chemCib.indexOf('/') !== -1 || normaliserQR_(chemCib) !== normaliserQR_(dom)) {
      var segs = chemCib.split('/').map(function (s) { return s.trim(); }).filter(Boolean);
      var domN = normaliserQR_(dom), domCourtN = normaliserQR_(dom.replace(/^\d+\s*·\s*/, ''));
      if (segs.length && (normaliserQR_(segs[0]) === domN || (domCourtN && normaliserQR_(segs[0]) === domCourtN))) segs.shift();
      var curId = segs.length ? cibId : '';
      for (var sIdx = 0; curId && sIdx < segs.length; sIdx++) {
        var nomS = segs[sIdx], sous = null;
        try {
          var curDir = DriveApp.getFolderById(curId);
          if (!curDir || curDir.isTrashed()) { curId = ''; break; }
          sous = typeof sousDossierExistant_ === 'function' ? sousDossierExistant_(curDir, nomS) : null;
          if (!sous) {
            var itS = curDir.getFolders(), nS = normaliserQR_(nomS);
            while (itS.hasNext()) {
              var sd = itS.next();
              if (!sd.isTrashed() && normaliserQR_(sd.getName()) === nS) { sous = sd; break; }
            }
          }
        } catch (eS) { sous = null; }
        if (!sous || sous.isTrashed()) { curId = ''; break; }
        curId = sous.getId();
        if (proteges[curId] || (typeof estZoneProtegeeCopilote_ === 'function' && estZoneProtegeeCopilote_(sous.getName(), dom))) { curId = ''; break; }
      }
      cibId = curId;
    }
    if (!cibId || proteges[cibId]) continue;
    var idsCands = [];
    for (var j = 0; j < ordre.length && idsCands.length < 8; j++) {
      var fid = ordre[j], l = parId[fid], nom = String(l[2] || ''), lDom = String(l[3] || ''), lChem = String(l[4] || ''), st = String(l[5] || '');
      if ((st !== 'classé' && st !== 'déplacé' && st !== 'manuel') || normaliserQR_(lChem) === normaliserQR_(chemCib) || (typeof indexContient_ === 'function' && indexContient_('epingle|' + fid)) || toucheZoneOuActionInterditeRegle_(lChem, lDom, lChem)) continue;
      if (mots.some(function (m) { return normaliserQR_(nom + ' ' + lChem).indexOf(normaliserQR_(m)) === -1; })) continue;
      try { var f = DriveApp.getFileById(fid); if (!f || f.isTrashed() || (typeof estProtegeDriveCopilote_ === 'function' && estProtegeDriveCopilote_(f, proteges)) || (typeof parentUniqueVivant_ === 'function' && parentUniqueVivant_(f) && parentUniqueVivant_(f).getId() === cibId)) continue; } catch (eF) { continue; }
      idsCands.push(fid);
    }
    if (!idsCands.length) continue;
    if (r.statut === 'auto' && a.auto === true && typeof executerDeplacementCopilote_ === 'function') {
      for (var k = 0; k < idsCands.length && traitees < maxRestant && !(depasse && depasse()); k++) if (executerDeplacementCopilote_(idsCands[k], cibId, dom, chemCib, r.id, proteges)) traitees++;
    } else if (typeof enregistrerCarteCopilote_ === 'function') {
      var resC = enregistrerCarteCopilote_({ categorie: 'carte', type: 'cascade', domaine: dom, chemin: chemCib, titre: 'Règle : ' + r.titre.slice(0, 120), action: { cle: 'regle-cas|' + r.id + '|' + cibId, cibleId: cibId, ids: idsCands, regleId: r.id } });
      if (resC && resC.cree) creees++;
    }
  }
  return { traitees: traitees, creees: creees };
}
