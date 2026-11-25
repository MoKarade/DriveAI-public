/**
 * PacksChecklists.gs — Checklists automatiques (#13), Plan « Changement de vie » (#14)
 * et Packs « Prêt à envoyer en 1 clic » par raccourcis Drive uniquement (#15).
 * `04 · Immigration` et `Anna` : inclus en lecture seule, zéro déplacement/renommage/copie.
 */
var ZONES_SYS_PACKS_ = { '00 · a trier': 1, '00 · a verifier': 1, '00 · packs': 1, '_technique': 1, '_doublons': 1, '_medias': 1, 'donnees & exports': 1 };
var WEBMAIL_PACKS_ = { 'gmail.com': 1, 'hotmail.com': 1, 'outlook.com': 1, 'yahoo.com': 1, 'icloud.com': 1, 'proton.me': 1, 'protonmail.com': 1, 'live.com': 1, 'msn.com': 1 };
var DEMARCHES_PACKS_ = [
  { key: 'logement', nom: 'Logement', domaine: '03 · Logement & véhicule', items: [
    { k: 'bail', l: 'Bail', re: /\b(bail|logement|loyer|location)\b/ }, { k: 'assur', l: 'Assur.', re: /\b(assurance habitation|habitation|locataire)\b/ },
    { k: 'ident', l: 'Identité', re: /\b(passeport|carte d identite|permis de conduire|identite|ramq)\b/ }, { k: 'paie', l: 'Revenu', re: /\b(bulletin de paie|paie|salaire|attestation emploi|revenu|t4|rl ?1)\b/ },
    { k: 'rib', l: 'Spéc.', re: /\b(rib|identite bancaire|specimen|cheque|iban)\b/ }
  ] },
  { key: 'emploi', nom: 'Emploi', domaine: '05 · Carrière', items: [
    { k: 'cv', l: 'CV', re: /\b(cv|curriculum)\b/ }, { k: 'contrat', l: 'Contrat', re: /\b(contrat|offre d emploi|embauche|lettre d offre)\b/ },
    { k: 'diplome', l: 'Diplôme', re: /\b(diplome|attestation|certificat|releve de notes)\b/ }, { k: 'paie', l: 'Paies', re: /\b(bulletin de paie|paie|salaire)\b/ },
    { k: 'rib', l: 'Spécimen', re: /\b(rib|identite bancaire|specimen|cheque)\b/ }
  ] },
  { key: 'voyage', nom: 'Voyage', domaine: '08 · Perso & projets', items: [
    { k: 'pass', l: 'Passeport', re: /\b(passeport)\b/ }, { k: 'assur', l: 'Assurance', re: /\b(assurance voyage|voyage|assistance)\b/ },
    { k: 'billet', l: 'Billet', re: /\b(billet|vol|itineraire|reservation|hotel)\b/ }, { k: 'visa', l: 'Visa / AVE', re: /\b(visa|ave|esta|autorisation voyage)\b/ }
  ] },
  { key: 'impots', nom: 'Impôts', domaine: '02 · Finances', items: [
    { k: 't4', l: 'T4', re: /\b(t4)\b/ }, { k: 'rl1', l: 'RL-1', re: /\b(rl ?1|releve 1)\b/ },
    { k: 'rl31', l: 'RL-31', re: /\b(rl ?31|releve 31)\b/ }, { k: 'avis', l: 'Cotisation', re: /\b(avis de cotisation)\b/ },
    { k: 'recu', l: 'Reçus', re: /\b(recu|don|frais medicaux|frais de garde|sante)\b/ }
  ] },
  { key: 'immigration', nom: 'Immigration', domaine: '04 · Immigration', items: [
    { k: 'pass', l: 'Passeport', re: /\b(passeport)\b/ }, { k: 'permis', l: 'Permis / CSQ', re: /\b(permis|csq|caq|residence|statut|ircc|mifi)\b/ },
    { k: 'emploi', l: 'Emploi / fonds', re: /\b(emploi|contrat|releve bancaire|solde|t4|paie)\b/ }, { k: 'ident', l: 'État civil', re: /\b(naissance|etat civil|photo|identite)\b/ }
  ] }
];

function normaliserPacks_(s) {
  if (typeof normaliserCle_ === 'function') return normaliserCle_(s);
  var t = String(s == null ? '' : s).toLowerCase();
  return (t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t).replace(/[’ʼ´']/g, ' ').replace(/\s+/g, ' ').trim();
}
function validerDatePacks_(v) {
  var s = String(v == null ? '' : v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  var a = Number(m[1]), mo = Number(m[2]), j = Number(m[3]), d = new Date(Date.UTC(a, mo - 1, j));
  return (d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j) ? s : '';
}
function estZoneSystemePacks_(chemin, domaine) {
  return [domaine].concat(String(chemin || '').split('/')).some(function (seg) {
    var s = normaliserPacks_(seg);
    return !!(s && (ZONES_SYS_PACKS_[s] || s.charAt(0) === '_' || /^00\s*·/.test(s)));
  });
}
function dateDocPacks_(nom, traiteLe, sigDateDoc) {
  var sd = validerDatePacks_(sigDateDoc);
  if (sd) return sd;
  var tr = traiteLe instanceof Date && !isNaN(traiteLe.getTime()) ? traiteLe.toISOString().slice(0, 10) : validerDatePacks_(String(traiteLe || '').trim().slice(0, 10));
  var s = String(nom || '').trim(), mFull = /^(\d{4}-\d{2}-\d{2})(?:_|\s|$)/.exec(s), mYm = /^(\d{4})-(\d{2})(?:_|\s|$)/.exec(s), mAn = /^(\d{4})(?:_|\s|$)/.exec(s);
  if (mFull && validerDatePacks_(mFull[1])) return mFull[1];
  if (mYm && Number(mYm[2]) >= 1 && Number(mYm[2]) <= 12) return new Date(Date.UTC(Number(mYm[1]), Number(mYm[2]), 0)).toISOString().slice(0, 10);
  return mAn ? ((tr && tr.slice(0, 4) === mAn[1]) ? tr : (mAn[1] + '-01-01')) : tr;
}

/** Inventaire commun pur : déduplique `Index`, exclut zones système, inclut `04` et `Anna` (lecture seule). PURE. */
function indexerDocumentsVivantsPacks_(indexLignes, signauxLignes) {
  var sigParId = {}, parId = {}, ordre = [], statOk = { 'classé': 1, 'déplacé': 1, 'manuel': 1 }, docs = [];
  (signauxLignes || []).forEach(function (s) { if (s && s.fileId) sigParId[String(s.fileId).trim()] = s; });
  (indexLignes || []).forEach(function (r) {
    if (!Array.isArray(r) || /^(epingle|agenda|agenda-exp|tri|conso|brouillon|important)\|/.test(String(r[0] || '').trim())) return;
    var fid = typeof fileIdDeLigneIndex_ === 'function' ? fileIdDeLigneIndex_(r) : String(r[8] || '').trim();
    if (fid) { if (!parId[fid]) ordre.push(fid); parId[fid] = r; }
  });
  ordre.forEach(function (fid) {
    var l = parId[fid], st = String(l[5] || '').trim(), dom = String(l[3] || '').trim(), chem = String(l[4] || '').trim(), nom = String(l[2] || '').trim();
    if (!statOk[st] || estZoneSystemePacks_(chem, dom)) return;
    var sig = sigParId[fid] || {}, em = typeof extraireEmetteurNomVeille_ === 'function' ? extraireEmetteurNomVeille_(nom) : '', cat = typeof extraireTypeNomVeille_ === 'function' ? extraireTypeNomVeille_(nom) : '';
    docs.push({ fileId: fid, nom: nom, domaine: dom, chemin: chem, dateDoc: dateDocPacks_(nom, l[1], sig.dateDoc),
      dateExpiration: validerDatePacks_(sig.dateExpiration), categorie: String(sig.categorie || cat || '').trim(), fournisseur: String(sig.fournisseur || em || '').trim() });
  });
  return docs.sort(function (a, b) { return a.dateDoc !== b.dateDoc ? (a.dateDoc > b.dateDoc ? -1 : 1) : (a.fileId < b.fileId ? -1 : (a.fileId > b.fileId ? 1 : 0)); });
}

function serialiserPackAction_(obj) {
  var c = JSON.parse(JSON.stringify(obj || {}));
  if (Array.isArray(c.items)) c.items.forEach(function (x) { if (x) { delete x.a; if (!x.f) delete x.f; if (!x.m) delete x.m; } });
  var s = JSON.stringify(c);
  if (s.length <= 500) return s;
  if (Array.isArray(c.items)) {
    for (var i = c.items.length - 1; i >= 0 && s.length > 500; i--) { delete c.items[i].f; s = JSON.stringify(c); }
    for (var j = 0; j < c.items.length && s.length > 500; j++) { c.items[j].l = String(c.items[j].l || '').slice(0, 12); s = JSON.stringify(c); }
  }
  if (Array.isArray(c.orgs)) {
    [16, 12].forEach(function (lim) { if (s.length > 500) { c.orgs.forEach(function (o) { o.n = String(o.n || '').slice(0, lim); }); s = JSON.stringify(c); } });
    while (c.orgs.length > 1 && s.length > 500) { c.orgs.pop(); s = JSON.stringify(c); }
  }
  return s.length <= 500 ? s : '{}';
}

/** PURE (#13) — Calcule les 5 checklists automatiques depuis les documents vivants et `Liens`. */
function analyserChecklistsCopilotePure_(docsVivants, liensLignes, dateRef) {
  var refIso = (dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date()).toISOString().slice(0, 10), liensFid = {};
  (liensLignes || []).forEach(function (lr) { var fid = String(lr[6] || '').trim(); if (fid) liensFid[fid] = true; });
  return DEMARCHES_PACKS_.map(function (dem) {
    var items = dem.items.map(function (it) {
      var trouve = null;
      for (var i = 0; i < (docsVivants || []).length; i++) {
        var d = docsVivants[i];
        if (d.dateExpiration && d.dateExpiration < refIso) continue;
        var txt = normaliserPacks_([d.nom, d.chemin, d.categorie, d.fournisseur].join(' ')).replace(/[_-]+/g, ' ');
        if (it.re.test(txt)) { if (!trouve || (!liensFid[trouve.fileId] && liensFid[d.fileId])) trouve = d; if (liensFid[trouve.fileId]) break; }
      }
      var obj = { k: it.k, l: it.l, ok: trouve ? 1 : 0, a: trouve ? 1 : 0 };
      if (trouve) obj.f = trouve.fileId;
      return obj;
    });
    return { categorie: 'checklist', type: 'checklist', domaine: dem.domaine, chemin: dem.domaine,
      titre: 'Checklist ' + dem.nom + ' (' + items.filter(function (x) { return x.ok; }).length + '/' + items.length + ')',
      action: { cle: 'chk|' + dem.key, dem: dem.nom, items: items } };
  });
}

function segEntiteCheminPacks_(chemin) {
  var segs = String(chemin || '').split('/').map(function (x) { return x.trim(); }).filter(Boolean);
  while (segs.length > 1 && /^\d{4}$/.test(segs[segs.length - 1])) segs.pop();
  return segs.length >= 2 ? segs[segs.length - 1] : '';
}
function nettoyerNomOrganismePacks_(brut, domaine) {
  var s = String(brut || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (typeof retirerSuffixeJuridique_ === 'function') s = retirerSuffixeJuridique_(s);
  if (!s || s.length < 2 || /^\d+\s/.test(s)) return '';
  var n = normaliserPacks_(s);
  if (/^(inconnue?|n\/?a|n a|aucune?|autres?|divers|document|sans|non identifie|non lisible)$/.test(n)) return '';
  if ((typeof estProprietaireMarc_ === 'function' && estProprietaireMarc_(s)) || (typeof estEntiteGenerique_ === 'function' && estEntiteGenerique_(s))) return '';
  if (domaine && typeof CONFIG !== 'undefined' && CONFIG.CATEGORIES) {
    var cats = CONFIG.CATEGORIES[domaine];
    if (!cats) { var dn = normaliserPacks_(domaine); for (var dk in CONFIG.CATEGORIES) if (Object.prototype.hasOwnProperty.call(CONFIG.CATEGORIES, dk) && normaliserPacks_(dk) === dn) { cats = CONFIG.CATEGORIES[dk]; break; } }
    if (cats) for (var ck in cats) if (Object.prototype.hasOwnProperty.call(cats, ck) && normaliserPacks_(ck) === n) return '';
  }
  return s;
}

/** PURE (#14) — Extrait les vrais organismes actifs des 18 derniers mois (zéro nom codé en dur, zéro PII). */
function extraireOrganismesActifs18MoisPure_(docsVivants, liensLignes, entitesLignes, dateRef) {
  var ref = dateRef instanceof Date && !isNaN(dateRef.getTime()) ? dateRef : new Date(), refIso = ref.toISOString().slice(0, 10);
  var derJ = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 17, 0)).getUTCDate();
  var seuilIso = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 18, Math.min(ref.getUTCDate(), derJ))).toISOString().slice(0, 10);
  var canonEnt = {}, idxE = 0, idxS = 4, liensFid = {}, parOrg = {};
  (entitesLignes || []).forEach(function (r, idx) {
    if (!Array.isArray(r)) return;
    if (idx === 0 && r.indexOf('Entité') !== -1) { idxE = r.indexOf('Entité'); idxS = r.indexOf('Statut') !== -1 ? r.indexOf('Statut') : 4; return; }
    var nomE = String(r[idxE] || '').trim(), stE = normaliserPacks_(r[idxS]);
    if (nomE && (!stE || stE === 'validee')) { var c = nettoyerNomOrganismePacks_(nomE); if (c) canonEnt[normaliserPacks_(c)] = c; }
  });
  (liensLignes || []).forEach(function (lr) {
    var fid = String(lr[6] || '').trim(), tid = String(lr[1] || '').trim(), mDom = /@([a-z0-9.-]+\.[a-z]{2,})/.exec(String(lr[3] || '').trim().toLowerCase());
    if (!fid) return;
    var e = liensFid[fid] || (liensFid[fid] = { tids: {}, doms: {} });
    if (tid) e.tids[tid] = true;
    if (mDom && !WEBMAIL_PACKS_[mDom[1]]) e.doms[mDom[1]] = true;
  });
  (docsVivants || []).forEach(function (d) {
    if (!d.dateDoc || d.dateDoc < seuilIso || d.dateDoc > refIso) return;
    var cand = nettoyerNomOrganismePacks_(d.fournisseur, d.domaine) || nettoyerNomOrganismePacks_(segEntiteCheminPacks_(d.chemin), d.domaine);
    if (!cand) return;
    var k = normaliserPacks_(cand), g = parOrg[k] || (parOrg[k] = { cle: k, nom: canonEnt[k] || cand, nbDocs: 0, derniereDate: '', tids: {}, domainesMail: {} });
    g.nbDocs++; if (d.dateDoc > g.derniereDate) g.derniereDate = d.dateDoc;
    var lf = liensFid[d.fileId];
    if (lf) { Object.keys(lf.tids).forEach(function (t) { g.tids[t] = true; }); Object.keys(lf.doms).forEach(function (dm) { g.domainesMail[dm] = true; }); }
  });
  return Object.keys(parOrg).map(function (k) {
    var g = parOrg[k];
    return { cle: g.cle, nom: g.nom, nbDocs: g.nbDocs, derniereDate: g.derniereDate, nbFils: Object.keys(g.tids).length, domainesMail: Object.keys(g.domainesMail).sort() };
  }).sort(function (a, b) { return a.derniereDate !== b.derniereDate ? (a.derniereDate > b.derniereDate ? -1 : 1) : (b.nbDocs !== a.nbDocs ? b.nbDocs - a.nbDocs : (a.nom < b.nom ? -1 : (a.nom > b.nom ? 1 : 0))); });
}

function lireEntitesPacks_() {
  try { var f = feuille_('Entités'), d = f ? f.getLastRow() : 0, c = f ? f.getLastColumn() : 0; return d >= 2 && c >= 1 ? f.getRange(1, 1, d, Math.min(c, 5)).getValues() : []; } catch (e) { return []; }
}
function parserActionPacks_(brut) {
  if (typeof parserActionCopilote_ === 'function') return parserActionCopilote_(brut);
  try { var o = brut && typeof brut === 'string' ? JSON.parse(brut) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}

/** Synchronisation non-destructive (`terminé`/`ignoré` préservés, coches manuelles conservées). */
function synchroniserCarteListeCopilote_(carte, cartesExistantes) {
  var f = feuille_('Copilote'), exist = cartesExistantes || (typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : []);
  var cible = carte.action && carte.action.cle ? String(carte.action.cle) : '', trouvee = null;
  for (var i = 0; i < exist.length; i++) if (exist[i].type === carte.type && String(parserActionPacks_(exist[i].actionJson).cle || '') === cible) { trouvee = exist[i]; break; }
  if (trouvee && trouvee.statut === 'ignoré') return { id: '', cree: false };
  var champ = carte.type === 'changement-vie' ? 'orgs' : 'items', liste = (carte.action[champ] || []).slice(), prevMap = {};
  if (trouvee) {
    (parserActionPacks_(trouvee.actionJson)[champ] || []).forEach(function (p) { if (p && (p.k || p.n || p.l)) prevMap[p.k || normaliserPacks_(p.n || p.l)] = p; });
    liste = liste.map(function (it) {
      var prev = prevMap[it.k || normaliserPacks_(it.n || it.l)];
      if (carte.type === 'changement-vie') return Object.assign({}, it, { ok: prev && prev.ok ? 1 : 0 });
      var man = !!(prev && prev.m === 1);
      return { k: it.k, l: it.l, ok: man ? (prev.ok ? 1 : 0) : (it.a ? 1 : 0), m: man ? 1 : 0, f: it.f || (man && prev && prev.f) || undefined };
    });
  }
  liste.forEach(function (x) { delete x.a; if (!x.f) delete x.f; if (!x.m) delete x.m; });
  var obj = JSON.parse(JSON.stringify(carte.action)); obj[champ] = liste;
  var json = serialiserPackAction_(obj), sauves = parserActionPacks_(json)[champ] || [];
  var faits = sauves.filter(function (x) { return !!x.ok; }).length, statut = sauves.length && faits === sauves.length ? 'terminé' : 'actif';
  var titre = (carte.type === 'changement-vie' ? 'Plan Changement de vie (' : 'Checklist ' + (obj.dem || '') + ' (') + faits + '/' + sauves.length + ')';
  if (trouvee) {
    if (trouvee.actionJson !== json || trouvee.statut !== statut || trouvee.titre !== titre) {
      f.getRange(trouvee.row, 2).setValue(new Date()); f.getRange(trouvee.row, 7).setValue(titre.slice(0, 140));
      f.getRange(trouvee.row, 8).setValue(json); f.getRange(trouvee.row, 9).setValue(statut);
    }
    return { id: trouvee.id, cree: false };
  }
  var id = 'cop-' + Date.now().toString(36) + '-' + (Math.random().toString(36) + '0000').slice(2, 6);
  f.appendRow([id, new Date(), 'checklist', carte.type, carte.domaine || '', carte.chemin || '', titre.slice(0, 140), json, statut, 0]);
  return { id: id, cree: true };
}

function lireSignauxPacks_() { return typeof lireSignaux_ === 'function' ? lireSignaux_() : []; }
function lireLiensPacks_() { return typeof lireLiensCopilote_ === 'function' ? lireLiensCopilote_() : []; }

function detecterChecklistsCopilote_(indexLignes, depasse, maxRestant) {
  if ((typeof CONFIG !== 'undefined' && CONFIG.COPILOTE_ACTIF === false) || maxRestant <= 0) return 0;
  var docs = indexerDocumentsVivantsPacks_(indexLignes, lireSignauxPacks_());
  var cartes = analyserChecklistsCopilotePure_(docs, lireLiensPacks_(), new Date()), exist = typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : [], creees = 0;
  for (var i = 0; i < cartes.length && creees < maxRestant && !(depasse && depasse()); i++) if (synchroniserCarteListeCopilote_(cartes[i], exist).cree) creees++;
  return creees;
}

function cleOrgCompactePacks_(cle, vus) {
  var s = String(cle || ''), h = 2166136261;
  for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  var k = s.length <= 14 ? s : (s.slice(0, 9) + '_' + ('0000' + (h >>> 0).toString(36)).slice(-4));
  if (!vus[k]) { vus[k] = true; return k; }
  for (var n = 2; vus[k.slice(0, 12) + n]; n++);
  var u = k.slice(0, 12) + n; vus[u] = true; return u;
}

function detecterChangementVieCopilote_(indexLignes, depasse, maxRestant) {
  if ((typeof CONFIG !== 'undefined' && CONFIG.COPILOTE_ACTIF === false) || maxRestant <= 0 || (depasse && depasse())) return 0;
  var docs = indexerDocumentsVivantsPacks_(indexLignes, lireSignauxPacks_()), orgs = extraireOrganismesActifs18MoisPure_(docs, lireLiensPacks_(), lireEntitesPacks_(), new Date()), vusK = {};
  if (!orgs.length) return 0;
  return synchroniserCarteListeCopilote_({ categorie: 'checklist', type: 'changement-vie', domaine: '', chemin: '',
    action: { cle: 'chg|18m', orgs: orgs.map(function (o) { return { k: cleOrgCompactePacks_(o.cle, vusK), n: o.nom.slice(0, 22), ok: 0, nb: o.nbDocs }; }) } }).cree ? 1 : 0;
}

/** Exécute une coche/décoche manuelle (`action=copilote-checklist`). */
function executerChecklistCopilote_(corps) {
  var cid = corps && corps.checklistId ? String(corps.checklistId).trim() : '', dem = corps && corps.demarche ? normaliserPacks_(corps.demarche) : '', itemReq = corps && corps.item ? normaliserPacks_(corps.item) : '';
  var cartes = typeof lireCartesCopilote_ === 'function' ? lireCartesCopilote_() : [], carte = null;
  for (var i = 0; i < cartes.length; i++) {
    var c = cartes[i], a = parserActionPacks_(c.actionJson);
    if ((c.type === 'checklist' || c.type === 'changement-vie') && ((cid && c.id === cid) || (dem && (normaliserPacks_(a.dem) === dem || a.cle === 'chk|' + dem)))) { carte = c; break; }
  }
  if (!carte) return { ok: false, erreur: 'checklist introuvable' };
  if (carte.statut === 'ignoré') return { ok: false, erreur: 'checklist ignorée' };
  var act = parserActionPacks_(carte.actionJson), champ = carte.type === 'changement-vie' ? 'orgs' : 'items', liste = Array.isArray(act[champ]) ? act[champ] : [];
  if (itemReq) {
    var cible = null;
    for (var j = 0; j < liste.length; j++) if (normaliserPacks_(liste[j].k) === itemReq || normaliserPacks_(liste[j].l) === itemReq || normaliserPacks_(liste[j].n) === itemReq) { cible = liste[j]; break; }
    if (!cible) return { ok: false, erreur: 'élément introuvable' };
    cible.ok = (corps.coche === undefined ? !cible.ok : !!corps.coche) ? 1 : 0;
    if (carte.type === 'checklist') cible.m = 1;
  }
  var json = serialiserPackAction_(act), sauves = parserActionPacks_(json)[champ] || [];
  var faits = sauves.filter(function (x) { return !!x.ok; }).length, statut = sauves.length && faits === sauves.length ? 'terminé' : 'actif';
  var titre = (carte.type === 'changement-vie' ? 'Plan Changement de vie (' : 'Checklist ' + (act.dem || '') + ' (') + faits + '/' + sauves.length + ')';
  var f = feuille_('Copilote');
  f.getRange(carte.row, 2).setValue(new Date()); f.getRange(carte.row, 7).setValue(titre.slice(0, 140));
  f.getRange(carte.row, 8).setValue(json); f.getRange(carte.row, 9).setValue(statut);
  return { ok: true, checklistId: carte.id, statut: statut, message: 'Checklist mise à jour (' + faits + '/' + sauves.length + ').' };
}

function estFichierZoneSystemeDrive_(fObj) {
  try {
    var pile = [{ n: fObj, p: 0 }], vus = {};
    while (pile.length) {
      var cur = pile.pop();
      if (cur.p > 0 && estZoneSystemePacks_(cur.n.getName(), cur.n.getName())) return true;
      if (cur.p >= 10) continue;
      var it = cur.n.getParents();
      while (it.hasNext()) { var par = it.next(), pid = par.getId(); if (!vus[pid]) { vus[pid] = true; pile.push({ n: par, p: cur.p + 1 }); } }
    }
  } catch (e) { return true; }
  return false;
}

/** Crée/réutilise `Marc/00 · Packs/<AAAA-MM-DD_Pack>` avec raccourcis Drive uniquement (#15). */
function creerPackCopilote_(corps) {
  var c = corps || {}, pack = String(c.pack || '').trim(), packN = normaliserPacks_(pack), sources = [], vus = {};
  var def = DEMARCHES_PACKS_.filter(function (d) { return d.key === packN || normaliserPacks_(d.nom) === packN; })[0];
  var ajouterSource = function (fid) {
    try { var f = DriveApp.getFileById(fid); if (f && !f.isTrashed() && !estFichierZoneSystemeDrive_(f)) { vus[fid] = true; sources.push({ fileId: fid, nom: f.getName() }); return true; } } catch (e) { }
    return false;
  };
  if (Array.isArray(c.fileIds) && c.fileIds.length) {
    c.fileIds.slice(0, 25).forEach(function (fid) { var id = String(fid || '').trim(); if (id && !vus[id]) ajouterSource(id); });
  } else if (packN) {
    var docs = indexerDocumentsVivantsPacks_(typeof lireLignesIndexCopilote_ === 'function' ? lireLignesIndexCopilote_() : [], lireSignauxPacks_()), refIso = new Date().toISOString().slice(0, 10);
    if (def) def.items.forEach(function (it) {
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        if (vus[d.fileId] || (d.dateExpiration && d.dateExpiration < refIso)) continue;
        if (it.re.test(normaliserPacks_([d.nom, d.chemin, d.categorie, d.fournisseur].join(' ')).replace(/[_-]+/g, ' ')) && ajouterSource(d.fileId)) break;
      }
    });
    else docs.forEach(function (d) {
      if (sources.length < 10 && (!d.dateExpiration || d.dateExpiration >= refIso) && !vus[d.fileId] &&
        normaliserPacks_([d.nom, d.chemin, d.categorie, d.fournisseur].join(' ')).replace(/[_-]+/g, ' ').indexOf(packN) !== -1) ajouterSource(d.fileId);
    });
  }
  if (!sources.length) return { ok: false, erreur: 'aucun fichier éligible pour ce pack' };
  var racine = dossierRacineParNom_('00 · Packs', 'DriveAI_PACKS_ID'), titreRaw = String(c.titre || (def && def.nom) || pack || 'Pack').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Pack';
  var nomDossier = /^\d{4}-\d{2}-\d{2}_/.test(titreRaw) ? titreRaw : (new Date().toISOString().slice(0, 10) + '_' + titreRaw);
  var dossierPack = sousDossier_(racine, nomDossier), dossierId = dossierPack.getId(), nb = 0;
  sources.forEach(function (src) {
    try { if (creerRaccourci_(src.fileId, dossierId, src.nom)) nb++; }
    catch (eR) { if (typeof journalErreur_ === 'function') journalErreur_('Packs', 'Raccourci impossible (' + src.fileId + ') : ' + eR); }
  });
  var url = (typeof dossierPack.getUrl === 'function' && dossierPack.getUrl()) || ('https://drive.google.com/drive/folders/' + encodeURIComponent(dossierId));
  if (nb === 0) return { ok: false, dossierId: dossierId, dossierUrl: url, nbRaccourcis: 0, erreur: 'création des raccourcis impossible' };
  if (typeof journalInfo_ === 'function') journalInfo_('Packs', 'Pack « ' + nomDossier + ' » créé (' + nb + ' raccourci(s)).');
  return { ok: true, dossierId: dossierId, dossierUrl: url, nbRaccourcis: nb, message: 'Pack prêt (' + nb + ' raccourci(s)).' };
}
