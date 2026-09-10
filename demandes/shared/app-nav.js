/* La barre d'une app, et ses vues.
 *
 * POURQUOI. Dans le portail, le bandeau ne portait que deux choses : un
 * retour vers l'accueil et le nom de l'app. Ouverte seule, l'app ajoutait un
 * rail de gauche dont le seul contenu etait... un retour vers l'accueil, plus
 * un titre qui redisait le nom. Trois surfaces pour une information, et zero
 * pour la seule question qui se pose une fois dans l'app : qu'est-ce que je
 * peux y faire d'autre que ce que j'ai sous les yeux ?
 *
 * Une app de travail a plusieurs vues. Relire une file, regarder le corpus
 * qu'elle porte et le modifier, savoir ou en est le lot, ouvrir le capot.
 * Elles vivent dans la meme app, elles se rejoignent par des onglets, et
 * chacune porte son adresse : le retour arriere defait UN onglet.
 *
 * USAGE
 *
 *   AppNav.monter({
 *     app: "Doc Extract", icone: "🗂️",
 *     vues: [
 *       { cle: "relire", label: "Relire", hote: "#vueRelire" },
 *       { cle: "documents", label: "Documents", hote: "#vueDocuments",
 *         monter: (hote) => AppVues.documents(hote, "doc_extract") },
 *     ],
 *   });
 *
 * `monter` est appele la PREMIERE fois qu'on ouvre la vue, pas au chargement :
 * une vue qu'on n'ouvre jamais ne coute rien. `rafraichir`, s'il existe, est
 * appele a chaque retour sur la vue.
 */
(function (global) {
  const dansLePortail = (function () {
    try { return window.self !== window.top; } catch (_) { return true; }
  })();

  const CSS = `
    .app-nav {
      display: flex; align-items: center; gap: 6px;
      padding: 0 18px; background: var(--card);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 1px 14px rgba(19, 38, 74, .06);
      font-size: 13.5px; flex: none; min-height: 54px;
      position: relative; z-index: 30;
    }
    .app-nav .an-marque {
      display: inline-flex; align-items: center; gap: 10px;
      font-family: var(--display); font-weight: 800; font-size: .95rem;
      color: var(--marine); margin-right: 16px;
      white-space: nowrap; cursor: default;
    }
    /* L'icone de l'app dans une tuile sable, comme les pictogrammes de la
     * barre du site de reference : elle a une assise au lieu de flotter. */
    .app-nav .an-icone {
      width: 30px; height: 30px; border-radius: 9px; background: var(--sand-l);
      display: inline-flex; align-items: center; justify-content: center; font-size: 15px;
    }
    /* Un onglet dit ou l'on est. L'actif est une pilule marine pleine, comme
     * la rubrique courante dans la barre du site de reference : elle se voit
     * de loin, et elle ne concurrence pas le bouton carmin de la vue. */
    .app-nav .an-onglet {
      appearance: none; border: 0; background: none;
      font-family: var(--display); font-size: .88rem; font-weight: 700;
      color: var(--ink-soft); cursor: pointer; padding: 7px 12px;
      border-radius: 10px; white-space: nowrap;
      display: inline-flex; align-items: center; gap: 7px;
      transition: background .15s ease, color .15s ease;
    }
    .app-nav .an-onglet:hover { background: var(--sand-l); color: var(--marine); }
    .app-nav .an-onglet.actif { background: var(--marine); color: #fff; }
    .app-nav .an-onglet .an-compte {
      font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px;
      background: var(--sand-l); border: 1px solid var(--line); color: var(--ink-soft);
      font-variant-numeric: tabular-nums;
    }
    .app-nav .an-onglet.actif .an-compte { border-color: transparent; background: rgba(255, 255, 255, .16); color: #fff; }
    .app-nav .an-espace { flex: 1; }
    .app-nav .an-etat { font-size: 12px; color: var(--muted); white-space: nowrap; }
    /* Le choix de langue, pose par le socle bilingue : une pilule sable comme
     * les autres commandes de la barre, pas un controle natif brut. */
    .app-nav .an-langue {
      appearance: none; -webkit-appearance: none; font: inherit; font-size: 12.5px;
      color: var(--ink-soft); background: var(--sand-l); border: 1px solid var(--line);
      border-radius: 10px; padding: 6px 28px 6px 12px; cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234a5567' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 10px center;
    }
    .app-nav .an-langue:hover { border-color: var(--accent-soft); color: var(--marine); }
    .app-nav .an-langue:focus { outline: none; border-color: var(--accent); }
    /* Dans le portail, le bandeau du haut porte deja le retour et le nom :
     * la marque de l'app ferait doublon, on la retire. */
    .dans-le-portail .app-nav .an-marque { display: none; }
    .app-nav .an-lanceur {
      width: 34px; height: 34px; margin-right: 4px; border: 0; border-radius: 9px;
      background: none; color: var(--ink-soft); cursor: pointer; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .app-nav .an-lanceur:hover, .app-nav .an-lanceur.on { background: var(--sand-l); color: var(--marine); }
    /* Le panneau du lanceur : la recherche en tete, les favoris en tuiles,
       puis toutes les apps par rubrique, l'accueil en pied. Il se pose sous
       le bouton, par-dessus tout, et se ferme d'un clic dehors ou d'Echap. */
    .an-lanceur-panneau {
      position: fixed; z-index: 10000; width: 360px; max-height: 76vh;
      display: flex; flex-direction: column;
      background: var(--card); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow-lg); overflow: hidden;
    }
    .an-l-tete { padding: 10px; border-bottom: 1px solid var(--line); }
    .an-l-cherche {
      width: 100%; box-sizing: border-box; padding: 9px 12px; font: inherit; font-size: 13.5px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--sand-l); color: var(--ink);
    }
    .an-l-cherche:focus { outline: none; border-color: var(--accent); background: #fff; }
    .an-l-liste { overflow: auto; padding: 6px 8px 10px; flex: 1; min-height: 0; }
    .an-l-k { font-family: var(--display); font-size: 10.5px; font-weight: 800;
      letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 10px 8px 4px; }
    .an-l-grille { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
    .an-l-grille .an-l-app { flex-direction: column; text-align: center; padding: 8px 4px; gap: 4px; }
    .an-l-grille .an-l-ic { font-size: 20px; }
    .an-l-grille .an-l-nom { font-size: 11.5px; line-height: 1.2; white-space: normal; }
    .an-l-app {
      display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 8px;
      color: var(--ink); text-decoration: none; font-size: 13.5px;
    }
    .an-l-app:hover { background: var(--sand-l); }
    .an-l-app.on { background: var(--accent-bg); color: var(--marine); font-weight: 700; }
    .an-l-ic { width: 22px; text-align: center; font-size: 16px; flex: none; }
    .an-l-nom { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .an-l-vide { margin: 10px 8px; color: var(--muted); font-size: 13px; }
    .an-l-pied {
      display: block; padding: 10px 14px; border-top: 1px solid var(--line);
      color: var(--cta); text-decoration: none; font-size: 13px; font-weight: 700;
      background: var(--sand-l);
    }
    .an-l-pied:hover { text-decoration: underline; }
    .an-vue[hidden] { display: none !important; }
    /* Sous 900 px, la barre se serre et passe a la ligne : avec un nom d'app
     * long (« Contrats, fiche benchmark ») et six onglets en Manrope, le
     * dernier sortait de l'ecran a 760 px. Un defilement de cote ne suffit
     * pas, un onglet qu'on ne voit pas n'existe pas : la barre s'enroule. */
    @media (max-width: 900px) {
      .app-nav { flex-wrap: wrap; gap: 3px; padding: 6px 12px; }
      .app-nav .an-marque { margin-right: 8px; font-size: .9rem; }
      .app-nav .an-onglet { padding: 6px 9px; font-size: .84rem; }
    }
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // La page se MARQUE quand elle tourne dans le portail. La classe venait de
  // `rail.js`, que ces pages ne chargent plus depuis qu'elles ont leur barre ;
  // des regles partagees s'y accrochent encore (le fond, la barre de titre),
  // et sans elle elles ne s'appliquaient plus.
  if (dansLePortail) document.documentElement.classList.add("dans-le-portail");

  const etat = { vues: [], courante: "", barre: null, montees: new Set() };

  function elementDe(hote) {
    return typeof hote === "string" ? document.querySelector(hote) : hote;
  }

  /* ---- le lanceur : toutes les apps, depuis n'importe quelle app ----
   *
   * Le catalogue vient du portail (`/api/apps`) quand l'app tourne sous lui,
   * et du moteur (`/api/_apps`, qui lit le meme fichier) quand elle tourne
   * seule. Les favoris sont ceux du portail (meme origine, meme
   * localStorage) ; sinon ceux du catalogue.
   *
   * L'adresse d'une app depend d'ou l'on est : sous le portail, `/a/<id>/` ;
   * seule sur le moteur, `/<id>/`. C'est le seul point ou les deux mondes
   * se voient. */
  const pli = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  async function catalogue() {
    for (const url of ["/api/apps", "/api/_apps"]) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const d = await r.json();
        if (d && Array.isArray(d.apps) && d.apps.length) return d.apps;
      } catch (_) { /* on essaie la suivante */ }
    }
    return [];
  }

  function favorisDuPortail(apps) {
    try {
      const brut = localStorage.getItem("hub_favs");
      if (brut !== null) return JSON.parse(brut) || [];
    } catch (_) { /* pas d'acces */ }
    return apps.filter((a) => a.favori).map((a) => a.id);
  }

  function brancherLeLanceur(bouton) {
    const sousPortail = location.pathname.startsWith("/a/");
    const courant = (location.pathname.replace(/^\/a\//, "/").split("/")[1] || "");
    const adresseDe = (id) => (sousPortail ? "/a/" : "/") + encodeURIComponent(id) + "/";

    const panneau = document.createElement("div");
    panneau.className = "an-lanceur-panneau";
    panneau.hidden = true;
    document.body.appendChild(panneau);
    let apps = null;

    function rendre(filtre) {
      const q = pli(filtre);
      const favs = favorisDuPortail(apps);
      const parId = new Map(apps.map((a) => [a.id, a]));
      const visible = (a) => !q || pli([a.name, a.description, (a.tags || []).join(" "),
                                       (a.keywords || []).join(" "), a.category].join(" ")).includes(q);
      const ligne = (a) => `<a class="an-l-app${a.id === courant ? " on" : ""}" href="${adresseDe(a.id)}"
          data-app="${a.id}"><span class="an-l-ic">${a.icon || "◆"}</span>
          <span class="an-l-nom">${a.name}</span></a>`;
      const parts = [];
      const favsVisibles = favs.map((id) => parId.get(id)).filter((a) => a && visible(a));
      if (!q && favsVisibles.length) {
        parts.push('<div class="an-l-k">Favoris</div><div class="an-l-grille">'
          + favsVisibles.map(ligne).join("") + "</div>");
      }
      // L'assurance d'abord, le generaliste ensuite, et les apps de bout en
      // bout en tete de l'assurance. Meme ordre que l'accueil du portail,
      // pour qu'on retrouve la meme chose aux deux endroits.
      const groupes = new Map();
      const assurance = apps.filter((a) => a.domaine === "assurance" && visible(a));
      const bout = assurance.filter((a) => a.bout_en_bout);
      const reste = assurance.filter((a) => !a.bout_en_bout);
      if (bout.length) groupes.set("De bout en bout", bout);
      if (reste.length) groupes.set("Assurance", reste);
      for (const a of apps) {
        if (!visible(a) || a.domaine === "assurance") continue;
        const c = a.category || "Autres";
        if (!groupes.has(c)) groupes.set(c, []);
        groupes.get(c).push(a);
      }
      if (!groupes.size) parts.push('<p class="an-l-vide">Aucune application pour ce mot.</p>');
      for (const [c, liste] of groupes) {
        parts.push(`<div class="an-l-k">${c}</div>` + liste.map(ligne).join(""));
      }
      panneau.querySelector(".an-l-liste").innerHTML = parts.join("");
    }

    async function ouvrirPanneau() {
      if (apps === null) {
        panneau.innerHTML = '<div class="an-l-tete"><input type="search" class="an-l-cherche"'
          + ' placeholder="Chercher une application…" aria-label="Chercher une application"></div>'
          + '<div class="an-l-liste"><p class="an-l-vide">Chargement…</p></div>'
          + '<a class="an-l-pied" href="/">Accueil des applications →</a>';
        panneau.querySelector(".an-l-cherche").addEventListener("input", (ev) => rendre(ev.target.value));
        panneau.querySelector(".an-l-cherche").addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter") return;
          const premier = panneau.querySelector(".an-l-liste a[href]");
          if (premier) { ev.preventDefault(); location.href = premier.getAttribute("href"); }
        });
        apps = await catalogue();
        rendre("");
      }
      const r = bouton.getBoundingClientRect();
      panneau.style.top = (r.bottom + 6) + "px";
      panneau.style.left = Math.max(8, r.left) + "px";
      panneau.hidden = false;
      bouton.classList.add("on");
      const champ = panneau.querySelector(".an-l-cherche");
      champ.value = ""; rendre(""); champ.focus();
    }
    function fermer() { panneau.hidden = true; bouton.classList.remove("on"); }

    bouton.addEventListener("click", () => (panneau.hidden ? ouvrirPanneau() : fermer()));
    document.addEventListener("click", (ev) => {
      if (!panneau.hidden && !panneau.contains(ev.target) && !bouton.contains(ev.target)) fermer();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !panneau.hidden) { ev.stopPropagation(); fermer(); }
    }, true);
  }

  function monter(config) {
    const vues = (config.vues || []).filter((v) => elementDe(v.hote));
    if (!vues.length) return null;
    etat.vues = vues;

    const barre = document.createElement("nav");
    barre.className = "app-nav";
    // A GAUCHE : le lanceur, puis le nom.
    //
    // Le retour au catalogue etait un bouton « Applications » a droite. Il
    // ne repondait qu'a la moitie du besoin : dans une app, on veut surtout
    // aller dans une AUTRE app, et repasser par l'accueil est un detour. Le
    // lanceur des suites bureautiques fait les deux : une icone a gauche du
    // nom, un panneau avec la recherche et toutes les apps, l'accueil en
    // pied. L'auteur, 2026-09-05 : « le bouton Applications, tu peux faire
    // mieux ».
    //
    // Le nom ne clique toujours pas : a gauche d'une barre, un nom est une
    // identite, et la commande est juste a cote de lui.
    const marque = dansLePortail ? "" : `
      <button class="an-lanceur" data-lanceur type="button" title="Applications"
              aria-label="Ouvrir la liste des applications">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="5" r="2.2"/><circle cx="12" cy="5" r="2.2"/><circle cx="19" cy="5" r="2.2"/>
          <circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/>
          <circle cx="5" cy="19" r="2.2"/><circle cx="12" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/>
        </svg>
      </button>
      <span class="an-marque">
        <span class="an-icone">${config.icone || "◆"}</span>${config.app || ""}
      </span>`;
    barre.innerHTML = marque
      + vues.map((v) => `<button class="an-onglet" data-vue="${v.cle}">
           ${v.label}${v.compte != null ? `<span class="an-compte" data-compte="${v.cle}"></span>` : ""}
         </button>`).join("")
      + `<span class="an-espace"></span><span class="an-etat" id="anEtat"></span>`;

    // La barre se pose AVANT la premiere vue, quelle que soit la structure
    // de la page : c'est la vue qui commande, pas l'ordre du HTML.
    const premiere = elementDe(vues[0].hote);
    premiere.parentNode.insertBefore(barre, premiere);
    etat.barre = barre;

    barre.querySelectorAll(".an-onglet").forEach((bouton) => {
      bouton.addEventListener("click", () => ouvrir(bouton.dataset.vue, true));
    });
    const lanceur = barre.querySelector("[data-lanceur]");
    if (lanceur) brancherLeLanceur(lanceur);

    // L'adresse porte l'onglet : un lien vers la vue Suivi doit ouvrir la vue
    // Suivi, et le retour arriere doit ramener a l'onglet precedent.
    if (global.Route) {
      Route.declare({
        lire: () => ({ vue: etat.courante === vues[0].cle ? "" : etat.courante }),
        appliquer: (adresse) => ouvrir(adresse.vue || vues[0].cle, false),
      });
    }
    ouvrir(vues[0].cle, false);
    // Ce que les autres onglets vont demander se charge maintenant, pendant
    // que le gestionnaire regarde le premier ecran : la table pese 2,2 Mo, et
    // le relais du portail multiplie par trente le cout de chaque fichier.
    if (global.AppVues && AppVues.preparerLaTable) AppVues.preparerLaTable();
    return { ouvrir, compte, etat: dire };
  }

  function ouvrir(cle, pousser) {
    const vue = etat.vues.find((v) => v.cle === cle) || etat.vues[0];
    if (!vue) return;
    etat.courante = vue.cle;
    for (const v of etat.vues) {
      const hote = elementDe(v.hote);
      if (hote) { hote.hidden = v.cle !== vue.cle; hote.classList.add("an-vue"); }
    }
    etat.barre.querySelectorAll(".an-onglet").forEach((b) => {
      b.classList.toggle("actif", b.dataset.vue === vue.cle);
    });
    const hote = elementDe(vue.hote);
    if (vue.monter && !etat.montees.has(vue.cle)) {
      etat.montees.add(vue.cle);
      try { vue.monter(hote); } catch (exc) {
        hote.innerHTML = `<div class="panel"><p class="status err">${exc.message}</p></div>`;
      }
    } else if (vue.rafraichir) {
      try { vue.rafraichir(hote); } catch (_) { /* une vue qui rate ne bloque pas */ }
    }
    if (pousser && global.Route) Route.pousser();
  }

  /** Poser un compte dans la pastille d'un onglet (documents a relire, etc.) */
  function compte(cle, valeur) {
    const pastille = etat.barre && etat.barre.querySelector(`[data-compte="${cle}"]`);
    if (pastille) pastille.textContent = valeur == null ? "" : String(valeur);
  }

  /** Un mot d'etat a droite de la barre. */
  function dire(texte) {
    const zone = document.getElementById("anEtat");
    if (zone) zone.textContent = texte || "";
  }

  global.AppNav = { monter, ouvrir, compte, etat: dire };
})(window);
