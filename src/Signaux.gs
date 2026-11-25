/**
 * Signaux.gs — Onglet `Signaux`, rattrapage borné (`15/j`, frein `25 $`), radar d'expirations (#9) et pièces manquantes (#10).
 * Métadonnées structurées uniquement : zéro texte brut, zéro corps de document, zéro PII (ADR-0007).
 */
var COLONNES_SIGNAUX = ['FileId', 'Categorie', 'Fournisseur', 'Domaine', 'Chemin', 'DateDoc', 'DateExpiration', 'Montant', 'Devise', 'FinGarantie', 'DelaiRetour', 'StatutReclamation'];
var SIGNAUX_STATUTS_RECLAM = { '': 1, 'a-reclamer': 1, 'reclame': 1, 'non-applicable': 1 };

function normaliserSignaux_(s) {
  if (typeof normaliserCle_ === 'function') return normaliserCle_(s);
  var t = String(s == null ? '' : s).toLowerCase();
  return (t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t).replace(/\s+/g, ' ').trim();
}

/** Valide une date `AAAA-MM-JJ` calendaire réelle. PURE. */
function validerDateIsoSignal_(val) {
  var brut = String(val == null ? '' : val).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(brut);
  if (!m) return '';
  var a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]), d = new Date(Date.UTC(a, mo - 1, j));
  return (d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j) ? brut : '';
}

/** Calcule la fin de garantie `AAAA-MM-JJ` à partir de `dateDoc` + `garantieMois`. PURE. */
function calculerFinGarantie_(dateDoc, garantieMois) {
  var base = validerDateIsoSignal_(dateDoc), mois = typeof garantieMois === 'boolean' ? NaN : Number(garantieMois);
  if (!base || !isFinite(mois) || Math.floor(mois) !== mois || mois <= 0 || mois > 240) return '';
  var a = Number(base.slice(0, 4)), m0 = Number(base.slice(5, 7)) - 1 + mois, j = Number(base.slice(8, 10));
  var anC = a + Math.floor(m0 / 12), mC = ((m0 % 12) + 12) % 12, maxJ = new Date(Date.UTC(anC, mC + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anC, mC, Math.min(j, maxJ))).toISOString().slice(0, 10);
}

function diffJoursIso_(dateIso, dateRef) {
  var v = validerDateIsoSignal_(dateIso);
  if (!v) return NaN;
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date();
  return Math.round((Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10))) -
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())) / 86400000);
}

/** Construit un objet signal structuré sans jamais persister de texte brut ni PII. PURE. */
function construireSignalDepuisClassif_(meta, classif, decision) {
  var m = meta || {}, c = classif || {}, d = decision || {}, nom = String(d.nom || m.nom || m.nomFichier || '').trim();
  var dateNom = /^(\d{4}-\d{2}-\d{2})_/.exec(nom);
  var dateDoc = validerDateIsoSignal_(c.date_doc) || (dateNom ? validerDateIsoSignal_(dateNom[1]) : '') ||
    (m.date instanceof Date && !isNaN(m.date.getTime()) ? m.date.toISOString().slice(0, 10) : '');
  var mtRaw = typeof c.montant === 'number' ? c.montant : (typeof c.montant === 'string' && c.montant.trim() ? Number(c.montant.trim().replace(',', '.')) : NaN);
  var dev = String(c.devise || '').trim().toUpperCase(), stRec = String(c.statut_reclamation || '').trim();
  return {
    fileId: String(d.fileId || m.fileId || '').trim(), categorie: String(c.type_doc || c.categorie || '').trim().slice(0, 80),
    fournisseur: String(c.fournisseur || c.emetteur || '').trim().slice(0, 80), domaine: String(d.domaine || m.domaine || c.domaine || '').trim(),
    chemin: String(d.chemin || m.chemin || '').trim(), dateDoc: dateDoc, dateExpiration: validerDateIsoSignal_(c.date_expiration),
    montant: isFinite(mtRaw) && mtRaw > 0 ? Math.round(mtRaw * 100) / 100 : '', devise: /^[A-Z]{3}$/.test(dev) ? dev : '',
    finGarantie: validerDateIsoSignal_(c.fin_garantie) || calculerFinGarantie_(dateDoc, c.garantie_mois),
    delaiRetour: validerDateIsoSignal_(c.delai_retour), statutReclamation: SIGNAUX_STATUTS_RECLAM[stRec] ? stRec : ''
  };
}

function lireSignaux_() {
  var f = feuille_('Signaux'), dern = f ? f.getLastRow() : 0;
  if (dern < 2) return [];
  return f.getRange(2, 1, dern - 1, COLONNES_SIGNAUX.length).getValues().reduce(function (out, r, idx) {
    var fid = String(r[0] || '').trim();
    if (fid) out.push({ row: idx + 2, fileId: fid, categorie: String(r[1] || ''), fournisseur: String(r[2] || ''),
      domaine: String(r[3] || ''), chemin: String(r[4] || ''), dateDoc: String(r[5] || ''), dateExpiration: String(r[6] || ''),
      montant: (r[7] !== '' && r[7] !== null && isFinite(Number(r[7]))) ? Number(r[7]) : '', devise: String(r[8] || ''),
      finGarantie: String(r[9] || ''), delaiRetour: String(r[10] || ''), statutReclamation: String(r[11] || '') });
    return out;
  }, []);
}

/** Upsert propre par `FileId` dans l'onglet `Signaux`. */
function enregistrerSignal_(signal) {
  if (!signal || !signal.fileId) return false;
  var f = feuille_('Signaux'), dern = f.getLastRow(), ligneCible = 0;
  if (dern >= 2) {
    var ids = f.getRange(2, 1, dern - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0] || '').trim() === signal.fileId) { ligneCible = i + 2; break; }
  }
  var row = [signal.fileId, signal.categorie || '', signal.fournisseur || '', signal.domaine || '', signal.chemin || '',
    signal.dateDoc || '', signal.dateExpiration || '', (typeof signal.montant === 'number' && isFinite(signal.montant)) ? signal.montant : '',
    signal.devise || '', signal.finGarantie || '', signal.delaiRetour || '', signal.statutReclamation || ''];
  if (ligneCible) f.getRange(ligneCible, 1, 1, COLONNES_SIGNAUX.length).setValues([row]); else f.appendRow(row);
  return true;
}

/** Alimente `Signaux` sans surcoût LLM depuis `Pipeline.gs` si des métadonnées utiles existent. */
function enregistrerSignalDepuisPipeline_(src, classif, decision) {
  if (typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_ACTIF === false) return false;
  var sig = construireSignalDepuisClassif_(src, classif, decision);
  if (!sig.fileId) return false;
  var catPert = !!(sig.categorie && sig.categorie !== 'aucun' && sig.categorie !== 'Document' && sig.domaine !== '_Technique' && sig.domaine !== '_Médias');
  return (!sig.dateExpiration && sig.montant === '' && !sig.finGarantie && !sig.delaiRetour && !sig.fournisseur && !catPert) ? false : enregistrerSignal_(sig);
}

/** Frein strict `25 $/mois` fail-closed pour le rattrapage LLM des signaux. */
function budgetSignauxDepasse_(coutRun) {
  try {
    if (typeof syntheseCoutMois_ !== 'function') return true;
    if (typeof cleCoutMois_ === 'function' && typeof PropertiesService !== 'undefined') {
      var brut = PropertiesService.getScriptProperties().getProperty(cleCoutMois_()), pCout = brut ? JSON.parse(brut) : null;
      if (brut && (!pCout || typeof pCout !== 'object' || Array.isArray(pCout))) return true;
    }
    var s = syntheseCoutMois_(), base = s && typeof s.dollars === 'number' && isFinite(s.dollars) ? s.dollars : NaN;
    if (!isFinite(base)) return true;
    var run = typeof coutRun === 'number' && isFinite(coutRun) ? coutRun
      : ((typeof coutDollars_ === 'function' && typeof usageRunSnapshot_ === 'function') ? (coutDollars_(usageRunSnapshot_()) || 0) : 0);
    var cible = (typeof CONFIG !== 'undefined' && CONFIG.LLM_BUDGET_CIBLE != null) ? CONFIG.LLM_BUDGET_CIBLE : 25;
    return (typeof cible !== 'number' || !isFinite(cible)) || (base + run) >= cible;
  } catch (e) { return true; }
}

function lireCompteurSignauxJour_(props, aujourdhui) {
  if (!props || !aujourdhui) return 0;
  try {
    var brut = String(props.getProperty('DriveAI_SIGNAUX_JOUR') || ''), sep = brut.indexOf('|');
    if (sep === -1 || brut.slice(0, sep) !== aujourdhui) return 0;
    var n = Number(brut.slice(sep + 1));
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (e) { return 0; }
}

function incrementerCompteurSignauxJour_(props, aujourdhui, delta) {
  var d = Number(delta);
  if (!props || !aujourdhui || !isFinite(d) || d <= 0) return lireCompteurSignauxJour_(props, aujourdhui);
  var total = lireCompteurSignauxJour_(props, aujourdhui) + Math.floor(d);
  try { props.setProperty('DriveAI_SIGNAUX_JOUR', aujourdhui + '|' + total); } catch (e) { }
  return total;
}

function estZoneSystemeSignaux_(chemin, domaine) {
  var sys = { '00 · a trier': 1, '00 · a verifier': 1, '_technique': 1, '_doublons': 1, '_medias': 1, 'donnees & exports': 1 };
  return [domaine].concat(String(chemin || '').split('/')).some(function (seg) {
    var s = normaliserSignaux_(seg);
    return !!(s && (sys[s] || s.charAt(0) === '_' || /^00\s*·/.test(s)));
  });
}

/** Rattrapage quotidien borné (`15 docs/j`, `3/run`, coupé à `25 $/mois`, lecture seule `04`/`Anna`). */
function rattraperSignauxCopilote_(indexLignes, depasse) {
  if ((typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_ACTIF === false) || (depasse && depasse())) return 0;
  if ((typeof estPannePlateforme_ === 'function' && estPannePlateforme_()) || budgetSignauxDepasse_() || typeof extraireSignalLlm_ !== 'function') return 0;
  var auj = typeof budgetJourDate_ === 'function' ? budgetJourDate_() : (typeof dateGmail_ === 'function' ? dateGmail_(new Date()) : new Date().toISOString().slice(0, 10).replace(/-/g, '/'));
  var props = PropertiesService.getScriptProperties(), maxJour = (typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_RATTRAPAGE_MAX_JOUR) || 15;
  var restant = Math.min((typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_RATTRAPAGE_MAX_PAR_RUN) || 3, maxJour - lireCompteurSignauxJour_(props, auj));
  if (restant <= 0) return 0;
  var vus = {}, statOk = { 'classé': 1, 'déplacé': 1, 'manuel': 1 }, traites = 0, lignes = indexLignes || [];
  lireSignaux_().forEach(function (s) { vus[s.fileId] = true; });
  for (var i = lignes.length - 1; i >= 0 && traites < restant; i--) {
    if ((depasse && depasse()) || budgetSignauxDepasse_() || (typeof estPannePlateforme_ === 'function' && estPannePlateforme_())) break;
    var l = lignes[i], cle = String(l[0] || '').trim();
    if (cle.indexOf('epingle|') === 0 || cle.indexOf('agenda') === 0) continue;
    var fid = typeof fileIdDeLigneIndex_ === 'function' ? fileIdDeLigneIndex_(l) : String(l[8] || '').trim();
    var nom = String(l[2] || ''), dom = String(l[3] || ''), chem = String(l[4] || ''), stat = String(l[5] || '');
    if (!fid || vus[fid]) continue;
    vus[fid] = true;
    if (!statOk[stat] || estZoneSystemeSignaux_(chem, dom)) continue;
    try {
      var f = DriveApp.getFileById(fid);
      if (!f || f.isTrashed()) continue;
      var maxT = (typeof CONFIG !== 'undefined' && CONFIG.OCR_TAILLE_MAX) || 20 * 1024 * 1024;
      if (typeof f.getSize === 'function' && f.getSize() > maxT) { enregistrerSignal_({ fileId: fid, categorie: 'aucun', domaine: dom, chemin: chem }); continue; }
      var mime = typeof f.getMimeType === 'function' ? String(f.getMimeType() || '') : '', extrait = '';
      if (mime.indexOf('application/vnd.google-apps.') === 0 && typeof exporterTexteNatif_ === 'function') extrait = exporterTexteNatif_(fid, mime) || '';
      else if (typeof f.getBlob === 'function' && typeof extraireTexte_ === 'function') extrait = extraireTexte_(f.getBlob()) || '';
      var res = extraireSignalLlm_({ nomFichier: nom, chemin: chem, extrait: extrait });
      if (!res && typeof estPannePlateforme_ === 'function' && estPannePlateforme_()) break;
      var sig = res ? construireSignalDepuisClassif_({ fileId: fid, nom: nom, domaine: dom, chemin: chem }, res, { fileId: fid, domaine: dom, chemin: chem, nom: nom })
        : { fileId: fid, categorie: 'aucun', domaine: dom, chemin: chem };
      if (!sig.dateExpiration && sig.montant === '' && !sig.finGarantie && !sig.delaiRetour && !sig.fournisseur && !sig.categorie) sig.categorie = 'aucun';
      enregistrerSignal_(sig);
      incrementerCompteurSignauxJour_(props, auj, 1);
      traites++;
    } catch (e) { }
  }
  return traites;
}

/** Filtre et calcule les jalons J-90 / J-30 des expirations dans `[0, horizon]`. PURE. */
function analyserExpirationsSignaux_(signaux, dateRef, horizonJours) {
  var horizon = horizonJours > 0 ? horizonJours : 90, out = [];
  (signaux || []).forEach(function (s) {
    if (!s || !s.fileId || !s.dateExpiration) return;
    var j = diffJoursIso_(s.dateExpiration, dateRef);
    if (!isNaN(j) && j >= 0 && j <= horizon) out.push({ signal: s, joursRestants: j, jalons: j <= 30 ? [90, 30] : [90] });
  });
  return out.sort(function (a, b) { return a.joursRestants - b.joursRestants || (a.signal.fileId < b.signal.fileId ? -1 : 1); });
}

/** Radar d'expirations (#9) : rappels Google Agenda J-90/J-30 et cartes `expiration` dans `Copilote`. */
function detecterExpirationsCopilote_(depasse, maxRestant) {
  if (typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_ACTIF === false) return 0;
  var exps = analyserExpirationsSignaux_(lireSignaux_(), new Date(), (typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_EXPIRATION_HORIZON_JOURS) || 90), creees = 0;
  for (var i = 0; i < exps.length && !(depasse && depasse()); i++) {
    var it = exps[i], s = it.signal;
    var zoneProt = (typeof estZoneProtegeeCopilote_ === 'function' && estZoneProtegeeCopilote_(s.chemin, s.domaine)) ||
      (typeof toucheZoneProtegee_ === 'function' && toucheZoneProtegee_([s.domaine, s.chemin, s.categorie, s.fournisseur].join(' ')));
    if (typeof creerRappelExpirationAgenda_ === 'function') for (var k = 0; k < it.jalons.length; k++) creerRappelExpirationAgenda_(s, it.jalons[k], { zoneProtegee: zoneProt, freinBudget: false });
    if (creees < maxRestant && typeof enregistrerCarteCopilote_ === 'function') {
      var titre = zoneProt ? 'Échéance à vérifier (' + s.dateExpiration + ', J-' + it.joursRestants + ')'
        : 'Expiration : ' + (s.categorie || 'Document') + (s.fournisseur ? ' (' + s.fournisseur + ')' : '') + ' le ' + s.dateExpiration + ' (J-' + it.joursRestants + ')';
      if (enregistrerCarteCopilote_({ categorie: 'carte', type: 'expiration', domaine: s.domaine || '', chemin: s.chemin || '', titre: titre,
        action: { fileId: s.fileId, dateExpiration: s.dateExpiration, joursRestants: it.joursRestants } }).cree) creees++;
    }
  }
  return creees;
}

/** Détecteur 100 % gratuit de pièces manquantes (#10) : impôts, paies (`moisManquantsPaies_`) et relevés > 40 j. PURE. */
function detecterPiecesManquantesPure_(indexLignes, signauxLignes, dateRef, retardReleveJours) {
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date(), refIso = ref.toISOString().slice(0, 10);
  var retard = retardReleveJours > 0 ? retardReleveJours : 40, sigParId = {}, docsParId = {}, ordre = [], statOk = { 'classé': 1, 'déplacé': 1, 'manuel': 1 };
  (signauxLignes || []).forEach(function (s) { if (s && s.fileId) sigParId[s.fileId] = s; });
  (indexLignes || []).forEach(function (r) {
    var cle = String(r[0] || '').trim(), fid = (cle.indexOf('epingle|') === 0 || cle.indexOf('agenda') === 0) ? '' : (typeof fileIdDeLigneIndex_ === 'function' ? fileIdDeLigneIndex_(r) : String(r[8] || '').trim());
    if (fid) { if (!docsParId[fid]) ordre.push(fid); docsParId[fid] = r; }
  });
  var anFisc = ref.getUTCMonth() >= 2 ? ref.getUTCFullYear() - 1 : ref.getUTCFullYear() - 2;
  var fiscDefs = [{ id: 't4', lib: 'T4' }, { id: 'rl1', lib: 'RL-1' }, { id: 'rl31', lib: 'RL-31' }, { id: 'avis', lib: 'Avis de cotisation' }];
  var fiscAnt = {}, fiscPres = {}, parEmp = {}, releves = {}, items = [];
  ordre.forEach(function (fid) {
    var l = docsParId[fid], nom = String(l[2] || ''), dom = String(l[3] || ''), chem = String(l[4] || ''), st = String(l[5] || '');
    if (!statOk[st] || estZoneSystemeSignaux_(chem, dom)) return;
    var sig = sigParId[fid], seg = normaliserSignaux_(nom.replace(/\.[^.]+$/, '') + ' ' + ((sig && sig.categorie) || '')).replace(/[_-]+/g, ' ');
    var mAn = /^(\d{4})/.exec(nom) || (sig && /^(\d{4})/.exec(sig.dateDoc || '')) || /(\d{4})(?:\/|$)/.exec(chem), anDoc = mAn ? Number(mAn[1]) : 0;
    if (anDoc) {
      var rl31 = (typeof estRl31Reset_ === 'function' && estRl31Reset_(seg)) || /(^| )rl ?31( |$)/.test(seg);
      var t4 = (typeof estFeuilletT4Reset_ === 'function' && estFeuilletT4Reset_(seg)) || /(^| )t4( |$)/.test(seg);
      var rl1 = !rl31 && ((typeof estFeuilletFiscalReset_ === 'function' && estFeuilletFiscalReset_(seg)) || /(^| )rl ?1( |$)/.test(seg));
      [['t4', t4], ['rl1', rl1], ['rl31', rl31], ['avis', /(^| )avis de cotisation( |$)/.test(seg)]].forEach(function (p) {
        if (p[1]) { if (anDoc === anFisc) fiscPres[p[0]] = true; else if (anDoc < anFisc) fiscAnt[p[0]] = true; }
      });
    }
    var disqPaie = typeof estDisqualifieCommeRevenuReset_ === 'function' && estDisqualifieCommeRevenuReset_(seg);
    var estPaie = !disqPaie && ((typeof estTypePaieReset_ === 'function' && estTypePaieReset_(seg)) || /bulletin de paie/.test(seg));
    if (estPaie) {
      var ptsP = nom.replace(/\.[^.]+$/, '').split('_'), emp = (typeof employeurDuNom_ === 'function' && employeurDuNom_(nom)) || (sig && sig.fournisseur) || (ptsP.length >= 3 && !/^(inconnu|document)$/i.test(ptsP[2].trim()) ? ptsP[2].trim() : '');
      var ym = (/^(\d{4}-\d{2})/.exec(nom) || [])[1] || (sig && sig.dateDoc ? sig.dateDoc.slice(0, 7) : '');
      if (emp && ym) (parEmp[emp] = parEmp[emp] || []).push(ym);
    }
    var estRib = (typeof estRibReset_ === 'function' && estRibReset_(seg)) || /identite bancaire/.test(seg);
    if (!estPaie && !estRib && /(^| )releve( |$)/.test(seg) && !/(^| )releve (1|31|de notes)( |$)/.test(seg) && !/(^| )rl ?(1|31)( |$)/.test(seg)) {
      var ptsR = nom.replace(/\.[^.]+$/, '').split('_'), fourn = (sig && sig.fournisseur) || (ptsR.length >= 3 ? ptsR[2].trim() : ''), cf = normaliserSignaux_(fourn);
      if (cf && cf !== 'inconnu' && cf !== 'document' && cf !== 'banque') {
        var mDate = /^(\d{4}-\d{2}-\d{2})(?:[^0-9]|$)/.exec(nom), mym = !mDate ? /^(\d{4})-(\d{2})(?:[^0-9]|$)/.exec(nom) : null;
        var mm = mym ? Number(mym[2]) : 0;
        var dStr = (sig && validerDateIsoSignal_(sig.dateDoc)) || (mDate ? validerDateIsoSignal_(mDate[1]) : '') ||
          ((mym && mm >= 1 && mm <= 12) ? new Date(Date.UTC(Number(mym[1]), mm, 0)).toISOString().slice(0, 10) : '');
        if (dStr) { if (!releves[cf]) releves[cf] = { nom: fourn, dates: [] }; releves[cf].dates.push(dStr); }
      }
    }
  });
  fiscDefs.forEach(function (fd) {
    if ((fd.id !== 'avis' || ref.getUTCMonth() >= 4 || ref.getUTCFullYear() > anFisc + 1) && fiscAnt[fd.id] && !fiscPres[fd.id]) {
      items.push({ cle: 'impots-' + anFisc + '-' + fd.id, typePiece: 'impots', domaine: '02 · Finances', chemin: '02 · Finances', titre: 'Pièce fiscale ' + anFisc + ' manquante : ' + fd.lib, detail: fd.lib + ' ' + anFisc });
    }
  });
  if (typeof moisManquantsPaies_ === 'function') moisManquantsPaies_(parEmp).forEach(function (r) {
    r.manquants.forEach(function (ym) {
      items.push({ cle: 'paies-' + normaliserSignaux_(r.employeur).replace(/\s+/g, '-') + '-' + ym, typePiece: 'paies', domaine: '02 · Finances', chemin: '02 · Finances', titre: 'Talon de paie manquant : ' + r.employeur + ' (' + ym + ')', detail: r.employeur + ' ' + ym });
    });
  });
  Object.keys(releves).sort().forEach(function (cf) {
    var grp = releves[cf], dern = grp.dates.length >= 2 ? grp.dates.slice().sort().pop() : '', j = dern ? -diffJoursIso_(dern, ref) : NaN;
    if (!isNaN(j) && j > retard) items.push({ cle: 'releve-' + cf, typePiece: 'releve', domaine: '02 · Finances', chemin: '02 · Finances', titre: 'Relevé mensuel absent (> ' + retard + ' j) : ' + grp.nom, detail: grp.nom + ' (' + dern + ')' });
  });
  return items;
}

/** Émet les cartes `piece-manquante` gratuites dans `Copilote`. */
function detecterPiecesManquantesCopilote_(indexLignes, depasse, maxRestant) {
  if ((typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_ACTIF === false) || maxRestant <= 0) return 0;
  var items = detecterPiecesManquantesPure_(indexLignes, lireSignaux_(), new Date(), (typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_RELEVE_RETARD_JOURS) || 40), creees = 0;
  for (var i = 0; i < items.length && creees < maxRestant && !(depasse && depasse()); i++) {
    var it = items[i];
    if (typeof enregistrerCarteCopilote_ === 'function' && enregistrerCarteCopilote_({ categorie: 'carte', type: 'piece-manquante', domaine: it.domaine, chemin: it.chemin, titre: it.titre, action: { cle: it.cle, typePiece: it.typePiece, detail: it.detail } }).cree) creees++;
  }
  return creees;
}

function montantSignal_(v) {
  if (typeof v === 'boolean' || v == null || (typeof v === 'string' && !v.trim())) return NaN;
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}
function deviseSignal_(d) { var s = String(d || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(s) ? s : 'CAD'; }
function estFournisseurValideSignal_(f) { var n = normaliserSignaux_(f); return !!(n && n !== 'inconnu' && n !== 'document'); }
function estZoneProtegeeSignal_(s) { return (typeof estZoneProtegeeCopilote_ === 'function' && estZoneProtegeeCopilote_(s.chemin, s.domaine)) || (typeof toucheZoneProtegee_ === 'function' && toucheZoneProtegee_([s.domaine, s.chemin, s.categorie, s.fournisseur].join(' '))); }
function estFactureSignal_(s, inclureRecus) {
  var txt = normaliserSignaux_(((s && s.categorie) || '') + ' ' + ((s && s.chemin) || '')).replace(/[_-]+/g, ' ');
  return !!txt && !/(paie|bulletin|salaire|releve|impot|t4|rl ?1|rl ?31|avis de cotisation|aucun)/.test(txt) && (/(facture|abonnement|forfait|assurance|telecom|telephone|internet|electricite|energie|loyer|police)/.test(txt) || (!!inclureRecus && /(recu|achat|paiement|pharmacie|clinique|dentiste|frais)/.test(txt)));
}
function estRenouvellementSignal_(s, datesParFourn) {
  if (!s || !s.fileId || estZoneSystemeSignaux_(s.chemin, s.domaine) || normaliserSignaux_(s.categorie) === 'aucun' || validerDateIsoSignal_(s.dateExpiration) || !validerDateIsoSignal_(s.dateDoc) || !estFournisseurValideSignal_(s.fournisseur)) return false;
  var txt = normaliserSignaux_((s.categorie || '') + ' ' + (s.chemin || '')).replace(/[_-]+/g, ' '), dates = (datesParFourn && datesParFourn[normaliserSignaux_(s.fournisseur)]) || [], base = new Date(Date.UTC(Number(s.dateDoc.slice(0, 4)), Number(s.dateDoc.slice(5, 7)) - 1, Number(s.dateDoc.slice(8, 10))));
  if (/\bmensuel/.test(txt) || /(paie|bulletin|salaire|releve|impot|t4|rl ?1|rl ?31|avis de cotisation|aucun)/.test(txt) || dates.some(function (d) { return d > s.dateDoc && diffJoursIso_(d, base) > 30; })) return false;
  return /(abonnement|annuel|renouvellement|assurance|cotisation|adhesion|licence|forfait|bail|immatriculation|hebergement|domaine)/.test(txt) || (estFactureSignal_(s, false) && dates.some(function (d) { var ec = Math.abs(diffJoursIso_(d, base)); return ec >= 330 && ec <= 395; }));
}
function estReclamableSignal_(s) {
  if (!s || !s.fileId || estZoneSystemeSignaux_(s.chemin, s.domaine) || normaliserSignaux_(s.categorie) === 'aucun' || s.statutReclamation === 'reclame' || s.statutReclamation === 'non-applicable') return false;
  if (s.statutReclamation === 'a-reclamer') return true;
  if (s.statutReclamation !== '' || isNaN(montantSignal_(s.montant))) return false;
  var txt = normaliserSignaux_((s.categorie || '') + ' ' + (s.chemin || '')).replace(/[_-]+/g, ' '), domN = normaliserSignaux_(s.domaine);
  return !/(police|contrat|assurance habitation|assurance auto|assurance vie)/.test(txt) && (domN.indexOf('sante') !== -1 || (domN === 'anna' && /\bsante\b/.test(txt)) ||
    /(pharmacie|dentiste|optometrie|lunettes|clinique|medical|sante|physio|osteo|medecin|chiro|psycho|note de frais|frais professionnel|depense pro|remboursement)/.test(txt) || (domN.indexOf('carriere') !== -1 && /(facture|recu)/.test(txt)));
}
/** Sentinelle factures (#11, 100 % pure sur `Signaux`) : hausse, doublon <= 5 j, renouvellement annuel J-30. PURE. */
function analyserSentinelleFacturesPure_(signaux, dateRef) {
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date(), parId = {}, cartes = [], grH = {}, grD = {}, datesF = {}, vusD = {};
  (signaux || []).forEach(function (s) { if (s && s.fileId) parId[s.fileId] = s; });
  Object.keys(parId).sort().forEach(function (fid) {
    var s = parId[fid], fn = normaliserSignaux_(s.fournisseur), dev = deviseSignal_(s.devise), mt = montantSignal_(s.montant), dDoc = validerDateIsoSignal_(s.dateDoc);
    if (estZoneSystemeSignaux_(s.chemin, s.domaine) || normaliserSignaux_(s.categorie) === 'aucun' || !dDoc || !estFournisseurValideSignal_(s.fournisseur)) return;
    (datesF[fn] = datesF[fn] || []).push(dDoc);
    if (!isNaN(mt) && estFactureSignal_(s, false)) (grH[fn + '|' + dev] = grH[fn + '|' + dev] || []).push({ s: s, dDoc: dDoc, mt: mt, dev: dev });
    if (!isNaN(mt) && estFactureSignal_(s, true)) (grD[fn + '|' + dev + '|' + Math.round(mt * 100)] = grD[fn + '|' + dev + '|' + Math.round(mt * 100)] || []).push({ s: s, dDoc: dDoc, mt: mt, dev: dev });
  });
  Object.keys(grH).sort().forEach(function (k) {
    var ser = grH[k].sort(function (a, b) { return a.dDoc < b.dDoc ? -1 : a.dDoc > b.dDoc ? 1 : (a.s.fileId < b.s.fileId ? -1 : 1); });
    if (ser.length < 3) return;
    var vals = ser.slice(0, -1).map(function (x) { return x.mt; }).sort(function (a, b) { return a - b; }), m = Math.floor(vals.length / 2);
    var med = vals.length % 2 ? vals[m] : Math.round(((vals[m - 1] + vals[m]) / 2) * 100) / 100, dern = ser[ser.length - 1], ec = dern.mt - med;
    if (!(med > 0) || ec < 5 || ec < med * 0.1 - 1e-9) return;
    var pct = Math.round((ec / med) * 100), zp = estZoneProtegeeSignal_(dern.s);
    cartes.push({ categorie: 'carte', type: 'facture-hausse', domaine: dern.s.domaine || '', chemin: dern.s.chemin || '', titre: zp ? 'Hausse de facture à vérifier (+' + pct + ' %)' : 'Hausse facture ' + dern.s.fournisseur + ' : ' + dern.mt + ' ' + dern.dev + ' (médiane ' + med + ' ' + dern.dev + ', +' + pct + ' %)', action: { cle: 'hausse|' + dern.s.fileId, fileId: dern.s.fileId, fournisseur: dern.s.fournisseur, montant: dern.mt, mediane: med, devise: dern.dev, ecartPct: pct } });
  });
  Object.keys(grD).sort().forEach(function (k) {
    var lst = grD[k];
    for (var i = 0; i < lst.length; i++) for (var j = i + 1; j < lst.length; j++) {
      var a = lst[i], b = lst[j], ec = Math.abs(diffJoursIso_(a.dDoc, new Date(Date.UTC(Number(b.dDoc.slice(0, 4)), Number(b.dDoc.slice(5, 7)) - 1, Number(b.dDoc.slice(8, 10)))))), ids = [a.s.fileId, b.s.fileId].sort(), cle = 'doublon-fac|' + ids[0] + '|' + ids[1];
      if (isNaN(ec) || ec > 5 || vusD[cle]) continue;
      vusD[cle] = true;
      var dts = [a.dDoc, b.dDoc].sort(), zp = estZoneProtegeeSignal_(a.s) || estZoneProtegeeSignal_(b.s);
      cartes.push({ categorie: 'carte', type: 'facture-doublon', domaine: a.s.domaine || '', chemin: a.s.chemin || '', titre: zp ? 'Facture en double possible (' + a.mt + ' ' + a.dev + ')' : 'Doublon facture ' + a.s.fournisseur + ' : ' + a.mt + ' ' + a.dev + ' (' + dts[0] + ' / ' + dts[1] + ')', action: { cle: cle, ids: ids, fournisseur: a.s.fournisseur, montant: a.mt, devise: a.dev, dates: dts } });
    }
  });
  Object.keys(parId).sort().forEach(function (fid) {
    var s = parId[fid], ech = estRenouvellementSignal_(s, datesF) ? calculerFinGarantie_(s.dateDoc, 12) : '', jr = ech ? diffJoursIso_(ech, ref) : NaN;
    if (isNaN(jr) || jr < 0 || jr > 30) return;
    var mt = montantSignal_(s.montant), dev = deviseSignal_(s.devise), zp = estZoneProtegeeSignal_(s);
    cartes.push({ categorie: 'carte', type: 'renouvellement', domaine: s.domaine || '', chemin: s.chemin || '', titre: zp ? 'Renouvellement annuel à vérifier (' + ech + ', J-' + jr + ')' : 'Renouvellement annuel : ' + s.fournisseur + ' le ' + ech + ' (J-' + jr + ')', action: { cle: 'renouv|' + s.fileId + '|' + ech, fileId: s.fileId, fournisseur: s.fournisseur, montant: isNaN(mt) ? '' : mt, devise: dev, echeance: ech, dateRenouvellement: ech, joursRestants: jr } });
  });
  return cartes;
}
/** Chasseur d'argent oublié (#12, 100 % pur sur `Signaux`) : remboursements, retours <= 7 j, garanties <= 30 j. PURE. */
function analyserArgentOubliePure_(signaux, dateRef) {
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date(), parId = {}, parDev = {}, cartes = [];
  (signaux || []).forEach(function (s) { if (s && s.fileId) parId[s.fileId] = s; });
  Object.keys(parId).sort().forEach(function (fid) {
    var s = parId[fid], dev = deviseSignal_(s.devise), mt = montantSignal_(s.montant), zp = estZoneProtegeeSignal_(s);
    if (estReclamableSignal_(s)) (parDev[dev] = parDev[dev] || []).push({ s: s, mt: isNaN(mt) ? 0 : mt });
    if (estZoneSystemeSignaux_(s.chemin, s.domaine) || normaliserSignaux_(s.categorie) === 'aucun') return;
    [['retour', s.delaiRetour, 7, 'Délai de retour', 'delaiRetour'], ['garantie', s.finGarantie, 30, 'Fin de garantie', 'finGarantie']].forEach(function (rg) {
      var jr = rg[1] ? diffJoursIso_(rg[1], ref) : NaN;
      if (isNaN(jr) || jr < 0 || jr > rg[2]) return;
      var act = { cle: rg[0] + '|' + fid, fileId: fid, sousType: rg[0], fournisseur: s.fournisseur || '', montant: isNaN(mt) ? '' : mt, devise: dev, echeance: rg[1], joursRestants: jr }; act[rg[4]] = rg[1];
      cartes.push({ categorie: 'carte', type: 'retour-garantie', domaine: s.domaine || '', chemin: s.chemin || '', titre: zp ? rg[3] + ' à vérifier (' + rg[1] + ', J-' + jr + ')' : rg[3] + ' : ' + (s.fournisseur || s.categorie || 'Achat') + ' (' + rg[1] + ', J-' + jr + ')', action: act });
    });
  });
  Object.keys(parDev).sort().forEach(function (dev) {
    var lst = parDev[dev], ids = [], tot = 0, cle = 'remboursement|' + dev;
    for (var i = 0; i < lst.length; i++) {
      var cIds = ids.concat([lst[i].s.fileId]), cTot = Math.round((tot + lst[i].mt) * 100) / 100;
      if (JSON.stringify({ cle: cle, ids: cIds, montantTotal: cTot, devise: dev, nbRecus: cIds.length }).length > 480) break;
      ids = cIds; tot = cTot;
    }
    if (ids.length) cartes.push({ categorie: 'carte', type: 'remboursement', domaine: lst[0].s.domaine || '02 · Finances', chemin: lst[0].s.chemin || '', titre: 'Remboursement à réclamer : ' + ids.length + ' reçu(s) (' + tot + ' ' + dev + ')', action: { cle: cle, ids: ids, montantTotal: tot, devise: dev, nbRecus: ids.length } });
  });
  return cartes;
}
function detecterSentinelleFacturesCopilote_(depasse, maxRestant) { return emettreCartesSignaux_(analyserSentinelleFacturesPure_(lireSignaux_(), new Date()), depasse, maxRestant); }
function detecterArgentOublieCopilote_(depasse, maxRestant) { return emettreCartesSignaux_(analyserArgentOubliePure_(lireSignaux_(), new Date()), depasse, maxRestant); }
function emettreCartesSignaux_(lst, depasse, maxRestant) {
  if ((typeof CONFIG !== 'undefined' && CONFIG.SIGNAUX_ACTIF === false) || maxRestant <= 0 || typeof enregistrerCarteCopilote_ !== 'function') return 0;
  var creees = 0;
  for (var i = 0; i < lst.length && creees < maxRestant && !(depasse && depasse()); i++) if (enregistrerCarteCopilote_(lst[i]).cree) creees++;
  return creees;
}
/** Met à jour `StatutReclamation = 'reclame'` dans `Signaux` pour les `FileId` donnés. */
function marquerSignauxReclames_(fileIds) {
  var cibles = {}; (Array.isArray(fileIds) ? fileIds : (fileIds ? [fileIds] : [])).forEach(function (x) { var fid = String(x || '').trim(); if (fid) cibles[fid] = true; });
  var f = Object.keys(cibles).length ? feuille_('Signaux') : null, dern = f ? f.getLastRow() : 0, maj = 0;
  if (dern < 2) return 0;
  f.getRange(2, 1, dern - 1, COLONNES_SIGNAUX.length).getValues().forEach(function (r, i) { if (cibles[String(r[0] || '').trim()]) { f.getRange(i + 2, 12).setValue('reclame'); maj++; } });
  return maj;
}
