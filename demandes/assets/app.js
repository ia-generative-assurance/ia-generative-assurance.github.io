/* Demandes clients : la file, puis la demande, la source à gauche et la lecture à droite.
 *
 *   #                        la file : étiquettes, score, routage, avancement
 *   #demande=D-2002          la demande
 *
 * Ce que l'écran doit rendre visible, et pourquoi :
 *
 * Les ÉTIQUETTES avec leur preuve. Une demande en porte plusieurs, chacune
 * pour une équipe, et chacune montre la phrase qui la fonde : un clic sur la
 * preuve l'allume dans le message. Sans cela, un gestionnaire ne peut ni la
 * corriger ni s'y fier, et le tri redevient une boîte noire.
 *
 * L'EXTRACTION par étiquette, en variables du système. Détecter un changement
 * d'adresse est utile ; la nouvelle adresse en JSON, prête à injecter, l'est
 * davantage. Chaque valeur est éditable, cite sa phrase, et passe des contrôles
 * contre la fiche client avant qu'on la valide.
 *
 * Le RATTRAPAGE d'une résiliation : un score de rétention composé du profil,
 * et une action fermée, parce qu'une phrase libre ne se compte pas.
 */
"use strict";

(function (global) {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const etat = {
    demande: "", filtre: "", cherche: "", equipe: "", etiquette: "",
    grille: null, lot: null, courant: null,
    gauche: "message", visionneuse: null, visionneusePour: "",
  };

  async function poste(route, charge) {
    const r = await fetch(`/api/demandes/${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(charge || {}),
    });
    const d = await r.json();
    if (d && d.error) throw new Error(d.error);
    return d;
  }

  const hote = () => $("#dmNiveaux");
  const attendre = (quoi, ou) => {
    (ou || hote()).innerHTML = `<p class="status"><span class="spin"></span> ${esc(quoi)}</p>`;
  };
  const jour = (iso) => (iso || "").slice(0, 10).split("-").reverse().join("/");
  const qui = () => (global.Session && Session.qui && Session.qui()) || "";

  function panneau(section, id, plein) {
    const s = typeof section === "string" ? $(section) : section;
    if (!s) return null;
    let d = s.querySelector(`#${id}`);
    if (!d) {
      d = document.createElement("div"); d.id = id;
      d.className = plein ? "dm-vue plein" : "dm-vue";
      s.innerHTML = ""; s.appendChild(d);
    }
    return d;
  }

  const chip = (t) => `<span class="dm-chip ${esc(t.equipe)}${t.confiance < 0.67 ? " faible" : ""}"
      title="${esc(t.label)} · ${Math.round(t.confiance * 100)} %">${esc(t.label)}<span class="c">${
      Math.round(t.confiance * 100)} %</span></span>`;

  /* ---------------------------------------------------------------- niveau 1 */

  async function montrerLaFile(force) {
    const dejaLa = hote().querySelector(".dm-grille");
    if (!dejaLa || force) {
      if (!dejaLa) attendre("Lecture des demandes…");
      etat.lot = await poste("file", { etat: etat.filtre, cherche: etat.cherche,
                                       equipe: etat.equipe, etiquette: etat.etiquette });
      dessinerLaFile();
    }
  }

  function dessinerLaFile() {
    const c = etat.lot.comptes || {};
    const onglet = (cle, texte) => `<button class="dm-filtre${etat.filtre === cle ? " on" : ""}"
      data-filtre="${cle}"${c[cle] === 0 && cle ? " disabled" : ""}>${esc(texte)} <b>${c[cle] || 0}</b></button>`;
    hote().innerHTML = `
      <div class="dm-filtres">
        ${Object.entries(etat.lot.filtres).map(([k, v]) => onglet(k, v)).join("")}
        <select class="dm-sel" id="dmEquipe" title="Une équipe">
          <option value="">Toutes les équipes</option>
          ${Object.entries(etat.lot.equipes).map(([k, v]) =>
            `<option value="${esc(k)}"${etat.equipe === k ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
        <select class="dm-sel" id="dmEtiquette" title="Une étiquette">
          <option value="">Toutes les étiquettes</option>
          ${Object.entries(etat.lot.etiquettes).map(([k, v]) =>
            `<option value="${esc(k)}"${etat.etiquette === k ? " selected" : ""}>${esc(v)}</option>`).join("")}
        </select>
        <input type="search" class="dm-cherche" id="dmCherche"
               placeholder="Chercher un client, un objet, une étiquette" value="${esc(etat.cherche)}">
      </div>
      <div class="dm-grille ag-theme-quartz" id="dmGrille"></div>
      <p class="dm-arret">Arrêté au ${jour(etat.lot.reference)} · ${etat.lot.total} demande${
        etat.lot.total > 1 ? "s" : ""} · seuil de routage ${etat.lot.seuil} · les étiquettes et le
        score se calculent sans appel de modèle, c'est ce qui tient mille demandes par jour.</p>`;

    hote().querySelectorAll("[data-filtre]").forEach((b) =>
      b.addEventListener("click", () => { etat.filtre = b.dataset.filtre; montrerLaFile(true); }));
    $("#dmEquipe").addEventListener("change", (e) => { etat.equipe = e.target.value; montrerLaFile(true); });
    $("#dmEtiquette").addEventListener("change", (e) => { etat.etiquette = e.target.value; montrerLaFile(true); });
    const champ = $("#dmCherche");
    let minuterie = null;
    champ.addEventListener("input", () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => {
        etat.cherche = champ.value.trim();
        montrerLaFile(true).then(() => {
          const n = $("#dmCherche");
          if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
        });
      }, 280);
    });

    const colonnes = [
      { field: "date", headerName: "Reçu", width: 112, valueFormatter: (p) => jour(p.value) },
      { field: "client", headerName: "Client", width: 175,
        cellRenderer: (p) => (p.value
          ? `${esc(p.value)}${p.data.canal === "espace_client" ? '<span class="dm-canal">EC</span>' : ""}`
          : `<span style="color:#b45309">${esc(p.data.expediteur)} · inconnu</span>`) },
      { field: "objet", headerName: "Objet", flex: 1.1, minWidth: 190 },
      // Le `valueGetter` sert au tri et a la recherche : une chaine. Le rendu,
      // lui, lit la liste dans la ligne. Les confondre faisait chercher `.map`
      // sur une chaine, et la colonne restait vide sans rien dire.
      { field: "etiquettes", headerName: "Étiquettes", flex: 1.6, minWidth: 300,
        cellRenderer: (p) => (p.data.etiquettes || []).map(chip).join(""),
        valueGetter: (p) => p.data.etiquettes.map((t) => t.label).join(", ") },
      { field: "score", headerName: "Score", width: 88,
        cellRenderer: (p) => {
          const n = Number(p.value) || 0;
          const t = n >= p.data.seuil ? "#047857" : n >= p.data.seuil - 20 ? "#b45309" : "#b91c1c";
          return `<b style="color:${t}">${n}</b><span style="color:var(--muted);font-size:11px">/${p.data.seuil}</span>`;
        } },
      // Le mot court dans la colonne, le motif au survol : « A qualifier par un
      // humain » se coupait a « hum… » et ne disait plus rien.
      { field: "sortie_label", headerName: "Routage", width: 130,
        cellRenderer: (p) => `<span class="dm-sortie ${esc(p.data.sortie)}" title="${esc(p.value)} · ${esc(p.data.motif)}">${
          p.data.sortie === "routee" ? "Routée" : "À qualifier"}</span>` },
      { field: "equipes_label", headerName: "Équipes", width: 190,
        valueFormatter: (p) => (p.value || []).join(", ") },
      { field: "a_extraire", headerName: "Avancement", width: 150,
        cellRenderer: (p) => p.data.traitee
          ? '<span style="color:#047857">traitée</span>'
          : (p.data.a_extraire ? `<span style="color:var(--muted)">${p.data.a_extraire} à extraire</span>` : "")
            + (p.data.a_valider ? `<span style="color:#b45309"> ${p.data.a_valider} à valider</span>` : "")
            || '<span style="color:var(--muted)">—</span>' },
    ];
    etat.grille = agGrid.createGrid($("#dmGrille"), {
      columnDefs: colonnes, rowData: etat.lot.demandes, rowHeight: 40, headerHeight: 36,
      defaultColDef: { sortable: true, resizable: true },
      onRowClicked: (e) => ouvrirDemande(e.data.id),
      getRowStyle: (p) => (p.data.sortie === "a_qualifier" && !p.data.traitee ? { background: "#fffbeb" } : undefined),
    });
  }

  /* ---------------------------------------------------------------- niveau 2 */

  async function ouvrirDemande(id, sansPousser) {
    etat.demande = id; etat.gauche = "message";
    etat.visionneuse = null; etat.visionneusePour = "";
    if (global.Route && !sansPousser) Route.pousser();
    attendre("Lecture de la demande…");
    try { etat.courant = await poste("demande", { id }); }
    catch (exc) { hote().innerHTML = `<p class="status err">${esc(exc.message)}</p>`; return; }
    dessinerLaDemande();
  }

  const NOM_DE_PARTIE = { objet: "Objet", appel: "Formule d'appel", corps_utile: "Corps",
                          politesse: "Formule de politesse", signature: "Signature" };
  const classeScore = (n, s) => (n >= s ? "hi" : n >= s - 20 ? "md" : "lo");
  const classeSS = (s) => (s.points >= s.max ? "plein" : s.points > 0 ? "partiel" : "vide");

  function dessinerLaDemande() {
    const d = etat.courant;
    const pieces = d.pieces || [];
    const sansTexte = !(d.corps || "").trim();

    const onglets = [`<button class="dm-onglet" data-onglet="message">Le message</button>`,
      `<button class="dm-onglet" data-onglet="client">${d.client ? "Le client" : "Client inconnu"}</button>`]
      .concat(pieces.map((p) => `<button class="dm-onglet${p.lisible === false ? " douteux" : ""}"
        data-onglet="${esc(p.id)}" title="${esc(p.titre)}">${esc(p.label || "pièce")}</button>`));

    hote().innerHTML = `
      <div class="dm-tete">
        <button class="dm-filtre" id="dmRetour">← Les demandes</button>
        <h2 class="dm-titre">${esc(d.objet || "(sans objet)")}</h2>
        <p class="dm-sous">${esc(d.expediteur_nom || d.expediteur)} &lt;${esc(d.expediteur)}&gt;
          · ${esc(d.canal_label)} · ${jour(d.date)} · ${esc(d.identite.certitude)}</p>
      </div>
      <div class="dm-deux">
        <div class="dm-gauche">
          <div class="dm-onglets">${onglets.join("")}</div>
          <div class="dm-mail" id="dmMessage">${rendreLeMessage(d, sansTexte)}</div>
          <div class="dm-client" id="dmClient" hidden>${rendreLeClient(d.client)}</div>
          <div class="dm-visionneuse" id="dmVisionneuse" hidden></div>
        </div>
        <div class="dm-droite" id="dmDroite"></div>
      </div>`;
    $("#dmRetour").addEventListener("click", revenirALaFile);
    hote().querySelectorAll("[data-onglet]").forEach((b) =>
      b.addEventListener("click", () => montrerAGauche(b.dataset.onglet)));
    dessinerLaDroite();
    montrerAGauche(sansTexte && pieces.length ? pieces[0].id : "message");
  }

  /* Le message, avec les preuves des étiquettes surlignées à leur place. */
  function rendreLeMessage(d, sansTexte) {
    const marques = [];
    (d.etiquettes || []).forEach((t) => (t.preuves || []).forEach((p) => {
      if (p.partie === "objet" || p.partie === "corps") marques.push({ ...p, etiquette: t.etiquette });
    }));
    const surligne = (texte, partie) => {
      const miennes = marques.filter((m) => m.partie === partie).sort((a, b) => a.debut - b.debut);
      let html = "", pos = 0;
      for (const m of miennes) {
        if (m.debut < pos) continue;
        html += esc(texte.slice(pos, m.debut))
          + `<mark data-et="${esc(m.etiquette)}">${esc(texte.slice(m.debut, m.fin))}</mark>`;
        pos = m.fin;
      }
      return html + esc(texte.slice(pos));
    };
    const parts = [];
    if (sansTexte) {
      parts.push(`<div class="dm-part"><div class="quoi">Message</div>
        <div class="texte dm-vide-texte">Aucun texte : ${d.canal === "espace_client"
          ? "un dépôt de pièce par l'espace client, sans un mot. La pièce dit la demande."
          : "le courriel n'a pas de corps."}</div></div>`);
    }
    parts.push(`<div class="dm-part"><div class="quoi">Objet</div>
      <div class="texte">${surligne(d.objet || "(sans objet)", "objet")}</div></div>`);
    if (!sansTexte) {
      parts.push(`<div class="dm-part"><div class="quoi">Message</div>
        <div class="texte">${surligne(d.corps, "corps")}</div></div>`);
    }
    if (d.canal === "espace_client") {
      parts.push(`<div class="dm-part"><div class="quoi">Canal</div><div class="texte">Espace client :
        ${esc(d.expediteur_nom)} s'est connecté. L'identité est authentifiée.</div></div>`);
    }
    return parts.join("");
  }

  function rendreLeClient(c) {
    if (!c) return '<p class="dm-vide">Aucun client du répertoire ne correspond à cet expéditeur.</p>';
    const a = c.adresse || {};
    return `<b>${esc(c.prenom)} ${esc(c.nom)}</b> · ${esc(c.numero)}
      <dl style="margin-top:8px">
        <dt>Adresse</dt><dd>${esc(a.numero)} ${esc(a.rue)}, ${esc(a.code_postal)} ${esc(a.ville)}</dd>
        <dt>Situation</dt><dd>${esc(c.situation)}</dd>
        <dt>Courriel</dt><dd>${esc(c.email)}</dd>
        <dt>IBAN</dt><dd>${esc(c.iban)}</dd>
        <dt>Client depuis</dt><dd>${jour(c.client_depuis)}</dd>
        <dt>Sinistres, 5 ans</dt><dd>${c.sinistres_5_ans}</dd>
      </dl>
      <h4>Contrats</h4>
      <table><tr><th>Numéro</th><th>Branche</th><th>Prime</th><th>Échéance</th></tr>
      ${(c.contrats || []).map((k) => `<tr><td>${esc(k.numero)}</td><td>${esc(k.branche)}</td>
        <td>${k.prime_annuelle} €</td><td>${esc(k.echeance)}</td></tr>`).join("")}</table>
      <p class="dm-note" style="margin-top:10px">La fiche telle que le système la connaît. C'est
        contre elle que chaque extraction se vérifie.</p>`;
  }

  function montrerAGauche(quoi) {
    const d = etat.courant;
    hote().querySelectorAll("[data-onglet]").forEach((b) => b.classList.toggle("on", b.dataset.onglet === quoi));
    const msg = $("#dmMessage"), cli = $("#dmClient"), vue = $("#dmVisionneuse");
    msg.hidden = quoi !== "message"; cli.hidden = quoi !== "client";
    const piece = (d.pieces || []).find((p) => p.id === quoi);
    vue.hidden = !piece;
    etat.gauche = quoi;
    if (!piece || etat.visionneusePour === piece.id) return;
    etat.visionneusePour = piece.id;
    if (!piece.pdf_url || !global.PdfViewer) { vue.innerHTML = '<p class="dm-vide">Fichier absent.</p>'; return; }
    etat.visionneuse = new PdfViewer({ host: "#dmVisionneuse", pdfUrl: piece.pdf_url });
  }

  /* Allumer la preuve d'une étiquette dans le message. */
  function allumer(etiquette, texte) {
    montrerAGauche("message");
    hote().querySelectorAll("#dmMessage mark").forEach((m) => {
      const on = m.dataset.et === etiquette && (!texte || m.textContent === texte);
      m.classList.toggle("on", on);
      if (on) m.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  /* ---------------------------------------------------------------- la droite */

  function dessinerLaDroite() {
    const d = etat.courant;
    const sousScore = (s) => `<div class="dm-s ${classeSS(s)}"><span class="pts">${s.points}/${s.max}</span>
      <span><b>${esc(s.nom)}</b><span class="obs">${esc(s.observe)}</span></span></div>`;

    const etiquette = (t) => `
      <div class="dm-et">
        <div class="l">${chip(t)}<span class="eq">→ ${esc(t.equipe_label)}${t.toujours_humain ? " · toujours par un humain" : ""}</span>
          ${d.traitee ? "" : `<button class="retirer" data-retirer="${esc(t.etiquette)}" title="Retirer cette étiquette">retirer</button>`}</div>
        <div class="dm-preuves">${(t.preuves || []).map((p) => p.piece
          ? `<button class="dm-preuve piece" data-piece="${esc(p.piece)}">pièce : ${esc(p.texte)}</button>`
          : `<button class="dm-preuve" data-allume="${esc(t.etiquette)}" data-texte="${esc(p.texte)}">« ${esc(p.texte)} »</button>`).join("")
          || '<span class="dm-note">ajoutée par un humain, sans motif dans le texte</span>'}</div>
      </div>`;

    const restantes = Object.entries(d.toutes_etiquettes)
      .filter(([k]) => k !== "autre" && !d.effectives.some((t) => t.etiquette === k));

    $("#dmDroite").innerHTML = `
      ${d.traitee ? `<div class="dm-fait">Demande traitée par ${esc(d.traitee_par || "—")} le ${jour(d.traitee_le)}.</div>` : ""}
      <div class="dm-bar">
        <div><div class="dm-score ${classeScore(d.score, d.seuil)}">${d.score}<span style="font-size:15px;color:var(--muted)">/${d.seuil}</span></div>
          <div class="dm-formule">${esc(d.formule)}</div></div>
        <div class="dm-conclu"><b class="dm-sortie ${esc(d.sortie)}">${esc(d.label)}</b>
          <div class="m">${esc(d.motif)}</div>
          <div class="m">Équipes : ${(d.equipes || []).map((e) => esc(d.equipes_labels[e] || e)).join(", ")}</div></div>
      </div>
      ${(d.sous_scores || []).map(sousScore).join("")}

      <h3 class="dm-h">Les étiquettes <span class="aide">— une par demande contenue dans le message, chacune avec sa phrase</span></h3>
      ${d.qualifiee ? `<div class="dm-fait">Étiquettes validées par ${esc(d.qualifiee.qui || "—")} le ${jour(d.qualifiee.le)}
        (la machine proposait : ${(d.qualifiee.proposees || []).map((k) => esc(d.toutes_etiquettes[k] || k)).join(", ")}).</div>` : ""}
      ${(d.effectives || []).map(etiquette).join("")}
      ${d.traitee ? "" : `<div class="dm-ajout">
        <select class="dm-sel" id="dmAjout"><option value="">Ajouter une étiquette…</option>
          ${restantes.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("")}</select>
        <button class="dm-btn${d.qualifiee ? "" : " valider"}" id="dmQualifier">${d.qualifiee ? "Revalider les étiquettes" : "Valider les étiquettes"}</button>
      </div>`}

      <h3 class="dm-h">Ce qu'on extrait, étiquette par étiquette
        <span class="aide">— en variables du système, prêt à injecter une fois validé</span></h3>
      ${(d.lectures || []).map(lecture).join("") || '<p class="dm-vide">Rien à extraire.</p>'}

      <div class="dm-gestes" id="dmFin">
        ${d.traitee
          ? '<button data-rouvrir="1">Rouvrir la demande</button>'
          : '<button data-traiter="1" title="Toutes les étiquettes sont injectées">Marquer la demande traitée</button>'}
      </div>`;

    const dr = $("#dmDroite");
    dr.querySelectorAll("[data-allume]").forEach((b) => b.addEventListener("click", () => allumer(b.dataset.allume, b.dataset.texte)));
    dr.querySelectorAll("[data-piece]").forEach((b) => b.addEventListener("click", () => montrerAGauche(b.dataset.piece)));
    dr.querySelectorAll("[data-retirer]").forEach((b) => b.addEventListener("click", () =>
      qualifier(d.effectives.map((t) => t.etiquette).filter((k) => k !== b.dataset.retirer))));
    const ajout = $("#dmAjout");
    if (ajout) ajout.addEventListener("change", () => {
      if (ajout.value) qualifier(d.effectives.map((t) => t.etiquette).filter((k) => k !== "autre").concat([ajout.value]));
    });
    const q = $("#dmQualifier");
    if (q) q.addEventListener("click", () => qualifier(d.effectives.map((t) => t.etiquette).filter((k) => k !== "autre")));
    dr.querySelectorAll("[data-extraire]").forEach((b) => b.addEventListener("click", () => extraire(b.dataset.extraire, b)));
    dr.querySelectorAll("[data-valider]").forEach((b) => b.addEventListener("click", () => validerExtraction(b.dataset.valider)));
    dr.querySelectorAll("[data-devalider]").forEach((b) => b.addEventListener("click", () => geste("valider_extraction", { etiquette: b.dataset.devalider, valeurs: null })));
    dr.querySelectorAll("[data-injecter]").forEach((b) => b.addEventListener("click", () => geste("traiter", { etiquette: b.dataset.injecter })));
    dr.querySelectorAll("[data-traiter]").forEach((b) => b.addEventListener("click", () => geste("traiter", {})));
    dr.querySelectorAll("[data-rouvrir]").forEach((b) => b.addEventListener("click", () => geste("rouvrir", {})));
    dr.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => allumerCitation(b.dataset.src)));
  }

  /* Une étiquette et son extraction : les variables, les contrôles, le JSON. */
  function lecture(l) {
    const etatLabel = { a_extraire: "à extraire", a_verifier: "à vérifier", bloque: "bloquée",
                        pret: "prête à injecter", validee: "validée", traitee: "injectée",
                        sans_extraction: "rien à extraire" }[l.etat] || l.etat;
    const fige = l.etat === "validee" || l.etat === "traitee";
    const champs = Object.entries(l.variables.champs || {});
    const plat = aplatir(l.valeurs || {});
    const citation = (l.valeurs || {}).citation || "";
    let corps = "";
    if (l.etat === "a_extraire") {
      corps = `<p class="dm-note">Le modèle n'a pas encore lu cette demande pour cette étiquette. L'extraction
        est cadrée par un schéma fermé et mise en cache : elle ne se paie qu'une fois.</p>
        <div class="dm-gestes"><button data-extraire="${esc(l.etiquette)}">Extraire</button></div>`;
    } else if (l.etat === "sans_extraction") {
      corps = `<p class="dm-note">Cette étiquette ne porte pas d'extraction : elle route, c'est tout.</p>`;
    } else {
      corps = `
        <table class="dm-champs"><tr><th>Variable</th><th>Valeur</th><th></th></tr>
        ${champs.map(([champ, variable]) => `<tr>
          <td class="var" title="${esc(l.variables.table)}">${esc(variable)}</td>
          <td><input data-champ="${esc(l.etiquette)}|${esc(champ)}" value="${esc(plat[champ] ?? "")}"${fige ? " disabled" : ""}></td>
          <td>${citation ? `<span class="src" data-src="${esc(citation)}" title="${esc(citation)}">source</span>` : ""}</td>
        </tr>`).join("")}</table>
        <div class="dm-ctrl">${(l.controles || []).map((c) => `
          <div class="dm-c ${c.ok === false ? "ko" : c.ok ? "ok" : "na"}"><span class="m">${c.ok === false ? "✗" : c.ok ? "✓" : "–"}</span>
            <span><b>${esc(c.nom)}</b> : ${esc(c.observe)}${c.attendu && c.ok === false ? ` <span class="att">(attendu : ${esc(c.attendu)})</span>` : ""}</span></div>`).join("")}</div>
        <details class="dm-json"><summary>JSON prêt à injecter · ${esc(l.variables.table || "")}</summary>
          <pre>${esc(JSON.stringify(l.charge_utile, null, 2))}</pre></details>
        ${l.retention ? retention(l.retention) : ""}
        ${etat.courant.traitee ? "" : `<div class="dm-gestes">
          ${l.etat === "traitee" ? "" : l.etat === "validee"
            ? `<button data-injecter="${esc(l.etiquette)}" class="valider">Marquer injectée dans le système</button>
               <button data-devalider="${esc(l.etiquette)}">Reprendre la saisie</button>`
            : `<button data-valider="${esc(l.etiquette)}" class="valider">Valider, prête à injecter</button>
               <button data-extraire="${esc(l.etiquette)}" title="Relancer le modèle">Réextraire</button>`}
        </div>`}`;
    }
    return `<div class="dm-lect" data-lecture="${esc(l.etiquette)}">
      <div class="tete"><b>${esc(l.label)}</b><span class="dm-chip ${esc(l.equipe)}">${esc(l.equipe_label)}</span>
        <span class="dm-etat ${esc(l.etat)}">${esc(etatLabel)}</span>
        ${l.validee_par ? `<span class="dm-note" style="margin:0">validée par ${esc(l.validee_par)} le ${jour(l.validee_le)}</span>` : ""}</div>
      ${corps}</div>`;
  }

  function retention(r) {
    return `<div class="dm-ret"><div><span class="sc">${r.score}</span><span style="color:var(--muted)">/100 de chances de retenir</span></div>
      <div class="t">${(r.termes || []).map((t) => `<span><b>${t.points}/${t.max}</b></span><span>${esc(t.cle)} · ${esc(t.observe)}</span>`).join("")}</div>
      <div class="act">→ ${esc(r.action_label)}</div>
      <div style="font-size:12px;color:var(--muted)">Leviers : ${esc(r.levier)}</div></div>`;
  }

  function aplatir(v, prefixe = "") {
    const out = {};
    Object.entries(v || {}).forEach(([k, x]) => {
      if (x && typeof x === "object" && !Array.isArray(x)) Object.assign(out, aplatir(x, `${prefixe}${k}.`));
      else out[`${prefixe}${k}`] = x;
    });
    return out;
  }
  function imbriquer(plat) {
    const out = {};
    Object.entries(plat).forEach(([k, v]) => {
      const bouts = k.split("."); let cur = out;
      bouts.forEach((b, i) => { if (i === bouts.length - 1) cur[b] = v; else cur = (cur[b] = cur[b] || {}); });
    });
    return out;
  }

  function allumerCitation(texte) {
    montrerAGauche("message");
    const corps = hote().querySelector("#dmMessage .dm-part:last-of-type .texte, #dmMessage .texte");
    if (!corps) return;
    const brut = corps.textContent;
    const i = brut.indexOf(texte);
    if (i < 0) return;
    corps.innerHTML = esc(brut.slice(0, i)) + `<mark class="on">${esc(texte)}</mark>` + esc(brut.slice(i + texte.length));
    corps.querySelector("mark.on").scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ---------------------------------------------------------------- les gestes */

  async function geste(route, charge) {
    try {
      etat.courant = await poste(route, { id: etat.courant.id, auteur: qui(), ...charge });
      etat.lot = null;
      dessinerLaDroite();
    } catch (exc) { alert(exc.message); }
  }

  async function qualifier(etiquettes) {
    await geste("qualifier", { etiquettes });
    // Le message change de surlignage avec les étiquettes retenues.
    $("#dmMessage").innerHTML = rendreLeMessage(etat.courant, !(etat.courant.corps || "").trim());
  }

  async function extraire(etiquette, bouton) {
    if (bouton) { bouton.disabled = true; bouton.textContent = "Le modèle lit…"; }
    await geste("extraire", { etiquette, force: !!(bouton && bouton.textContent === "Réextraire") });
  }

  async function validerExtraction(etiquette) {
    const plat = {};
    hote().querySelectorAll(`[data-champ^="${CSS.escape(etiquette)}|"]`).forEach((i) => {
      plat[i.dataset.champ.split("|")[1]] = i.value;
    });
    const l = etat.courant.lectures.find((x) => x.etiquette === etiquette);
    const valeurs = { ...(l.valeurs || {}), ...imbriquer(plat) };
    await geste("valider_extraction", { etiquette, valeurs });
  }

  function revenirALaFile() {
    etat.demande = "";
    if (global.Route) Route.pousser();
    montrerLaFile(true);
  }

  /* ---------------------------------------------------------------- vues */

  async function monterEquipes(section) {
    const h = panneau(section || "#vueEquipes", "dmEquipes", false);
    attendre("Lecture des équipes…", h);
    const d = await poste("equipes", {});
    h.innerHTML = `<h3 class="dm-h" style="margin-top:0">Ce que chaque équipe a dans sa file</h3>
      <p class="dm-note">Une demande à trois étiquettes est dans trois files. Cliquer une équipe ouvre sa file.</p>
      <div class="dm-equipes">${d.equipes.map((e) => `
        <button class="dm-eq" data-equipe="${esc(e.equipe)}"><b>${esc(e.label)}</b>
          <div class="n">${e.en_attente}</div>
          ${e.a_qualifier ? `<div class="q">${e.a_qualifier} à qualifier par un humain</div>` : ""}
          <div class="ets">${(e.etiquettes || []).map(esc).join(" · ") || "rien en attente"}</div></button>`).join("")}</div>`;
    h.querySelectorAll("[data-equipe]").forEach((b) => b.addEventListener("click", () => {
      etat.equipe = b.dataset.equipe; etat.filtre = "";
      AppNav.ouvrir("demandes", true); montrerLaFile(true);
    }));
  }

  async function monterReglage(section) {
    const h = panneau(section || "#vueReglage", "dmReglage", false);
    attendre("Lecture du réglage…", h);
    const d = await poste("reglages", {});
    h.innerHTML = `<h3 class="dm-h" style="margin-top:0">Le seuil de routage</h3>
      <p class="dm-note">Au-dessus, la demande part d'elle-même vers ses équipes ; en dessous, un humain la qualifie.
        Certaines étiquettes passent toujours par un humain, quel que soit le score.</p>
      <p><input type="range" min="0" max="100" value="${d.seuil}" id="dmSeuil"> <b id="dmVS">${d.seuil}</b>
        <span class="dm-note">· ${d.routees} routées, ${d.a_qualifier} à qualifier</span></p>
      <h3 class="dm-h">Les étiquettes et leurs équipes</h3>
      <table class="dm-champs"><tr><th>Étiquette</th><th>Équipe</th><th>Toujours un humain</th><th>Demandes</th></tr>
      ${d.etiquettes.map((e) => `<tr><td>${esc(e.label)}</td><td>${esc(e.equipe)}</td>
        <td>${e.toujours_humain ? "oui" : ""}</td><td>${e.n}</td></tr>`).join("")}</table>`;
    const s = $("#dmSeuil");
    s.addEventListener("input", () => { $("#dmVS").textContent = s.value; });
    s.addEventListener("change", async () => { await poste("regler", { seuil: +s.value }); etat.lot = null; monterReglage(section); });
  }

  /* ---------------------------------------------------------------- l'adresse */

  function brancherAdresse() {
    if (!global.Route) return;
    Route.declare({
      principal: "demande",
      lire: () => ({ demande: etat.demande }),
      appliquer: (e) => {
        if (!e.demande) { if (etat.demande) { etat.demande = ""; montrerLaFile(true); } return; }
        if (e.demande !== etat.demande) ouvrirDemande(e.demande, true);
      },
    });
  }

  async function demarrer() { await montrerLaFile(true); brancherAdresse(); }
  global.Demandes = { monterEquipes, monterReglage, ouvrirDemande };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})(window);
