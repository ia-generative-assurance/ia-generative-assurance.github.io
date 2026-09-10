/* Le serveur, en une page. Repond a `/api/demandes/*` depuis l'enregistrement,
 * et garde en memoire ce que l'utilisateur tranche pendant la session : les
 * etiquettes qualifiees, les extractions validees, ce qui est marque injecte,
 * le seuil. Au rechargement, tout revient a l'enregistrement. */
(function () {
  const D = window.__DEMO;
  const vrai = window.fetch.bind(window);
  const copie = (x) => JSON.parse(JSON.stringify(x));
  const session = { etat: {}, seuil: D.reglages.seuil };
  const json = (o) => new Response(JSON.stringify(o), { status: 200,
    headers: { "Content-Type": "application/json" } });
  const plat = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const NOM = D.nomenclatures.etiquettes, EQ = D.nomenclatures.equipes;

  function etatDe(id) { return session.etat[id] || (session.etat[id] = {}); }

  /* Le routage se recalcule du score et du seuil : c'est ce que le reglage change. */
  function router(score, etiquettes, identifie) {
    const vraies = etiquettes.filter((t) => t.etiquette !== "autre");
    const equipes = [...new Set(vraies.map((t) => t.equipe))].sort();
    if (!equipes.length) return { sortie: "a_qualifier", label: "À qualifier par un humain",
      motif: "aucune étiquette n'a été reconnue", equipes: ["qualification"] };
    if (!identifie) return { sortie: "a_qualifier", label: "À qualifier par un humain",
      motif: "aucun client du répertoire ne correspond à l'expéditeur", equipes };
    const humaines = vraies.filter((t) => (NOM[t.etiquette] || {}).toujours_humain).map((t) => t.label);
    if (humaines.length) return { sortie: "a_qualifier", label: "À qualifier par un humain",
      motif: humaines.join(", ") + " passe toujours par un humain", equipes };
    if (score < session.seuil) return { sortie: "a_qualifier", label: "À qualifier par un humain",
      motif: "score " + score + " sous le seuil " + session.seuil, equipes };
    return { sortie: "routee", label: "Routée automatiquement",
      motif: "score " + score + " au-dessus du seuil " + session.seuil, equipes };
  }

  function demande(id) {
    const d = copie(D.demandes[id]);
    if (!d) return { error: "demande inconnue : " + id };
    const e = etatDe(id);
    d.seuil = session.seuil;
    if (e.qualifiee) {
      d.effectives = e.qualifiee.etiquettes.map((cle) =>
        d.etiquettes.find((t) => t.etiquette === cle) || {
          etiquette: cle, label: NOM[cle].label, equipe: NOM[cle].equipe,
          equipe_label: EQ[NOM[cle].equipe], confiance: 1, preuves: [], origine: "humain",
          toujours_humain: NOM[cle].toujours_humain });
      d.qualifiee = e.qualifiee;
      d.lectures = d.effectives.map((t) =>
        D.demandes[id].lectures.find((l) => l.etiquette === t.etiquette) && copie(
          D.demandes[id].lectures.find((l) => l.etiquette === t.etiquette)) || {
          etiquette: t.etiquette, label: t.label, equipe: t.equipe, equipe_label: t.equipe_label,
          extractible: true, etat: "a_extraire", valeurs: {}, charge_utile: {}, controles: [],
          variables: (D.nomenclatures.variables || {})[t.etiquette] || {} });
      Object.assign(d, { sortie: "routee", label: "Qualifiée par un humain",
        motif: "étiquettes validées par " + (e.qualifiee.qui || "—"),
        equipes: [...new Set(d.effectives.map((t) => t.equipe))].sort() });
    } else {
      Object.assign(d, router(d.score, d.effectives, !!d.client));
    }
    for (const l of d.lectures) {
      const v = (e.validees || {})[l.etiquette];
      if (v) { l.etat = "validee"; l.valeurs = v.valeurs; l.validee_par = v.qui; l.validee_le = v.le; }
      if ((e.traitees || {})[l.etiquette]) { l.etat = "traitee"; l.traitee_par = e.traitees[l.etiquette].qui; }
    }
    d.traitee = !!e.traitee; d.traitee_par = e.traitee ? e.traitee.qui : ""; d.traitee_le = e.traitee ? e.traitee.le : "";
    return d;
  }

  function file(c) {
    const lignes = copie(D.file.demandes).map((l) => {
      const e = etatDe(l.id);
      if (e.qualifiee) {
        l.etiquettes = e.qualifiee.etiquettes.map((cle) => ({ etiquette: cle, label: NOM[cle].label,
          confiance: (l.etiquettes.find((t) => t.etiquette === cle) || { confiance: 1 }).confiance,
          equipe: NOM[cle].equipe }));
        l.equipes = [...new Set(l.etiquettes.map((t) => t.equipe))].sort();
        l.equipes_label = l.equipes.map((k) => EQ[k]);
        Object.assign(l, { sortie: "routee", sortie_label: "Qualifiée par un humain",
                           motif: "étiquettes validées" });
      } else {
        const r = router(l.score, l.etiquettes.map((t) => ({ ...t, toujours_humain: (NOM[t.etiquette] || {}).toujours_humain })), !!l.client_numero);
        Object.assign(l, { sortie: r.sortie, sortie_label: r.label, motif: r.motif });
      }
      l.seuil = session.seuil;
      l.traitee = !!e.traitee;
      const validees = Object.keys(e.validees || {}), traitees = Object.keys(e.traitees || {});
      l.a_valider = Math.max(0, l.etiquettes.filter((t) => t.etiquette !== "autre").length - validees.length - traitees.length);
      return l;
    });
    let sel = lignes;
    if (c.cherche) { const q = plat(c.cherche);
      sel = sel.filter((l) => ["id", "expediteur", "client", "objet"].some((k) => plat(l[k]).includes(q))
        || l.etiquettes.some((t) => plat(t.label).includes(q))); }
    if (c.equipe) sel = sel.filter((l) => l.equipes.includes(c.equipe));
    if (c.etiquette) sel = sel.filter((l) => l.etiquettes.some((t) => t.etiquette === c.etiquette));
    const portee = sel;
    const compte = { "": portee.length,
      a_qualifier: portee.filter((l) => l.sortie === "a_qualifier" && !l.traitee).length,
      routees: portee.filter((l) => l.sortie === "routee" && !l.traitee).length,
      a_extraire: portee.filter((l) => l.a_extraire && !l.traitee).length,
      a_valider: portee.filter((l) => l.a_valider && !l.traitee).length,
      traitees: portee.filter((l) => l.traitee).length };
    if (c.etat === "a_qualifier") sel = sel.filter((l) => l.sortie === "a_qualifier" && !l.traitee);
    else if (c.etat === "routees") sel = sel.filter((l) => l.sortie === "routee" && !l.traitee);
    else if (c.etat === "a_extraire") sel = sel.filter((l) => l.a_extraire && !l.traitee);
    else if (c.etat === "a_valider") sel = sel.filter((l) => l.a_valider && !l.traitee);
    else if (c.etat === "traitees") sel = sel.filter((l) => l.traitee);
    sel.sort((a, b) => (a.traitee - b.traitee) || ((a.sortie !== "a_qualifier") - (b.sortie !== "a_qualifier"))
      || (b.date.localeCompare(a.date)) || a.id.localeCompare(b.id));
    return { ...D.file, demandes: sel, total: sel.length, comptes: compte, seuil: session.seuil };
  }

  const maintenant = () => new Date().toISOString();
  function repondre(route, c) {
    switch (route) {
      case "file": return file(c);
      case "demande": return demande(c.id);
      case "client": return copie(D.clients[c.numero]) || { error: "client inconnu" };
      case "equipes": return copie(D.equipes);
      case "nomenclatures": return copie(D.nomenclatures);
      case "reglages": return { ...copie(D.reglages), seuil: session.seuil };
      case "regler": if (c.seuil != null) session.seuil = Math.max(0, Math.min(100, +c.seuil));
        return { saved: true, ...copie(D.reglages), seuil: session.seuil };
      case "qualifier": { const e = etatDe(c.id);
        if (!(c.etiquettes || []).length) delete e.qualifiee;
        else e.qualifiee = { etiquettes: c.etiquettes, qui: c.auteur || "", le: maintenant(),
          proposees: D.demandes[c.id].etiquettes.map((t) => t.etiquette) };
        return { saved: true, ...demande(c.id) }; }
      case "extraire": { const d = demande(c.id);
        const l = d.lectures.find((x) => x.etiquette === c.etiquette);
        if (l && l.etat === "a_extraire") return { error: "démonstration statique : l’extraction par le modèle n’est pas disponible hors ligne. Les quarante demandes enregistrées sont déjà extraites." };
        return { saved: true, ...d }; }
      case "valider_extraction": { const e = etatDe(c.id); e.validees = e.validees || {};
        if (c.valeurs == null) delete e.validees[c.etiquette];
        else e.validees[c.etiquette] = { valeurs: c.valeurs, qui: c.auteur || "", le: maintenant() };
        return { saved: true, ...demande(c.id) }; }
      case "traiter": { const e = etatDe(c.id); e.traitees = e.traitees || {};
        if (c.etiquette) e.traitees[c.etiquette] = { qui: c.auteur || "", le: maintenant() };
        const d = demande(c.id);
        if (!c.etiquette || d.lectures.every((l) => l.etat === "traitee" || !l.extractible)) e.traitee = { qui: c.auteur || "", le: maintenant() };
        return { saved: true, ...demande(c.id) }; }
      case "rouvrir": session.etat[c.id] = {}; return { saved: true, ...demande(c.id) };
      default: return { error: "hors ligne : " + route };
    }
  }

  window.fetch = async function (url, init) {
    const u = String(url);
    if (u.startsWith("/api/demandes/")) {
      let charge = {};
      try { charge = JSON.parse((init && init.body) || "{}"); } catch (_) {}
      return json(repondre(u.slice("/api/demandes/".length), charge));
    }
    if (u.startsWith("/api/apps") || u.startsWith("/api/_apps")) return json({ apps: [] });
    return vrai(url, init);
  };
})();
