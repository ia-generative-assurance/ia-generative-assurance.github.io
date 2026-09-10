// PDF.js viewer (vanilla JS port of the Electron classic viewer).
//
// Renders ALL pages stacked in a scrollable container, auto-fits the width
// on load + on container resize, a top nav bar with page counter + zoom
// buttons. setHighlights([{page, x0, y0, x1, y1, kind}]) paints translucent
// rectangles on the matching pages. jumpTo({page, y0}) scrolls to the
// vertical position of a citation (not just page top).
//
// Usage :
//   <div id="pdfHost"></div>
//   <script src="/shared/pdf-viewer.js"></script>
//   const v = new PdfViewer({ host: "#pdfHost", pdfUrl: `/api/_pdf/${id}` });
//   await v.setPage(6);
//   v.setHighlights([{page:6, x0:108, y0:277, x1:505, y1:298, kind:"answer"}]);

(function () {
  const PDFJS_URL    = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

  let _pdfjsLoad = null;
  function loadPdfJs() {
    if (_pdfjsLoad) return _pdfjsLoad;
    _pdfjsLoad = import(PDFJS_URL).then((mod) => {
      const lib = mod.default || mod;
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
    return _pdfjsLoad;
  }

  const CSS = `
    .pdf-viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
    .pdf-viewer .pv-nav {
      display: flex; align-items: center; gap: 10px; padding: 8px 12px;
      /* Sur une colonne etroite, la barre passe a la ligne. Sans cela, le
       * champ de recherche se faisait ecraser a soixante pixels et on ne
       * voyait plus le mot qu'on venait de taper. */
      flex-wrap: wrap; row-gap: 6px;
      background: var(--card); border-bottom: 1px solid var(--line-soft);
      font-size: 13px; color: var(--muted); flex-shrink: 0;
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .pdf-viewer .pv-nav button {
      min-width: 30px; height: 28px; padding: 0 8px; border-radius: 6px;
      border: 1px solid var(--line); background: var(--card); cursor: pointer;
      color: var(--ink); font: inherit; font-weight: 600;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .pdf-viewer .pv-nav button:hover { background: var(--rail-hover); }
    .pdf-viewer .pv-nav button:disabled { opacity: 0.4; cursor: default; }
    /* Le champ du numero de page, et lui seul : la regle visait tous les
     * input de la barre, elle donnait donc 50 px de large a la case a
     * cocher « mot entier », qui devenait un grand carre vide. */
    .pdf-viewer .pv-nav input[type="number"] {
      width: 50px; height: 26px; padding: 0 6px;
      border: 1px solid var(--line); border-radius: 6px;
      font: inherit; font-size: 12.5px; text-align: center;
      background: var(--card); color: var(--ink);
    }
    .pdf-viewer .pv-nav .pv-spacer { flex: 1; }
    /* Ce qui va ensemble reste ensemble quand la barre passe a la ligne.
     * Sans ces groupes, le « + » du zoom se retrouvait seul sur la deuxieme
     * ligne, a dix centimetres du « - » qui va avec. */
    .pdf-viewer .pv-nav .pv-groupe {
      display: inline-flex; align-items: center; gap: 6px; flex: none;
    }
    .pdf-viewer .pv-nav .pv-style {
      height: 26px; max-width: 118px; border: 1px solid var(--line); border-radius: 6px;
      background: var(--card); color: var(--ink); font: inherit; font-size: 12px;
      padding: 0 4px; cursor: pointer;
      flex: none; width: auto; max-width: 140px;
    }
    .pdf-viewer .pv-scroll {
      flex: 1; overflow: auto; padding: 16px;
      display: flex; flex-direction: column; align-items: center; gap: 14px;
    }
    .pdf-viewer .pv-page {
      position: relative; background: #fff;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.10);
      border-radius: 2px;
    }
    .pdf-viewer .pv-page canvas { display: block; }
    /* pdf.js pose dans <body> un canvas de mesure pour la couche texte. Sa
     * feuille pdf_viewer.css le masque, nous ne la chargeons pas : il
     * restait en flux, et sa ligne poussait la page de 23 px. Un defilement
     * de rien du tout, mais assez pour decoller le contenu et decouvrir la
     * bande non peinte du bas. */
    canvas.hiddenCanvasElement { display: none !important; }
    /* La couche texte : les mots du PDF, invisibles, poses exactement sur
     * l'image. Sans elle une page est une photo, et on ne copie pas une
     * photo. Avec elle on selectionne, on copie, et Ctrl+F du navigateur
     * trouve le mot sur la page. */
    .pdf-viewer .pv-text {
      position: absolute; inset: 0; overflow: hidden;
      opacity: 1; line-height: 1; user-select: text;
      transform-origin: 0 0; z-index: 2;
    }
    .pdf-viewer .pv-text span, .pdf-viewer .pv-text br {
      position: absolute; white-space: pre; cursor: text;
      color: transparent; transform-origin: 0 0;
    }
    .pdf-viewer .pv-text ::selection { background: rgba(37, 99, 235, 0.35); }
    .pdf-viewer .pv-text span::selection { background: rgba(37, 99, 235, 0.35); }
    .pdf-viewer .pv-overlay {
      position: absolute; inset: 0;
      width: 100%; height: 100%; pointer-events: none; z-index: 3;
    }
    /* Tout le surlignage tient dans un calque SVG par page. Ce n'est pas
     * un gout de techno : c'est la seule facon d'avoir un trou net dans un
     * voile (masque) et une opacite qui ne s'additionne pas quand deux
     * surlignages se recouvrent (opacite de groupe). Les formes gardent les
     * classes pv-hl et pv-trouve : les controles d'ecran les comptent. */
    .pdf-viewer .pv-calque { position: absolute; inset: 0; pointer-events: none; }

    /* Les occurrences d'une recherche portent un jaune franc, different des
     * trois couleurs de source (ambre pour la recherche du modele, vert pour
     * sa reponse, violet pour la zone designee a la main) : on doit voir d'un
     * coup d'oeil ce qui vient du document et ce qui vient de sa fiche.
     * Celle qu'on regarde porte en plus un contour, sinon on ne sait pas
     * laquelle des douze le compteur designe. Les teintes sont dans le code
     * (TEINTES), pas ici : elles servent d'attributs SVG. */

    /* Le champ de recherche, dans la barre du lecteur. */
    .pdf-viewer .pv-find { display: inline-flex; align-items: center; gap: 6px; }
    .pdf-viewer .pv-find { flex: none; }
    .pdf-viewer .pv-find-champ {
      flex: none; width: 132px; min-width: 110px; height: 26px; padding: 0 8px;
      border: 1px solid var(--line); border-radius: 6px;
      font: inherit; font-size: 12.5px; background: var(--card); color: var(--ink);
    }
    .pdf-viewer .pv-find-champ:focus { outline: 2px solid rgba(37, 99, 235, .35); outline-offset: -1px; }
    .pdf-viewer .pv-find.cherche .pv-find-champ { opacity: .6; }
    .pdf-viewer .pv-find-entier {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; color: var(--muted); white-space: nowrap; cursor: pointer;
    }
    .pdf-viewer .pv-find-entier input {
      margin: 0; width: 13px; height: 13px; min-width: 0; padding: 0;
      accent-color: #b45309;
    }
    .pdf-viewer .pv-find-compte {
      font-size: 11.5px; color: var(--muted); min-width: 44px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .pdf-viewer .pv-find-compte.vide { color: #b91c1c; }
    .pdf-viewer .pv-find-compte.image { color: #b45309; }
    .pdf-viewer .pv-lire {
      height: 26px; padding: 0 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid #fed7aa; background: #fff7ed; color: #b45309;
      font: inherit; font-size: 12px; white-space: nowrap;
    }
    .pdf-viewer .pv-lire:hover:not(:disabled) { background: #ffedd5; }
    .pdf-viewer .pv-lire:disabled { opacity: .6; cursor: default; }

    /* ---- Cinq facons de designer un passage ----
     * Aucune n'est « la bonne » : un juriste veut voir le texte intact, un
     * gestionnaire veut trouver la ligne en une seconde, un demonstrateur
     * veut que ca se voie de loin. Le style se choisit dans la barre du
     * lecteur, et le choix se garde.
     *
     * Regle commune, et elle n'a pas bouge : on ne pose rien d'opaque PAR
     * DESSUS les lettres. Le dessin est fait dans _dessinerPage, en SVG,
     * parce que deux choses ne se font pas en CSS : percer un voile, et
     * empiler des aplats sans que la teinte fonce. */

    @keyframes pv-flash {
      0%   { box-shadow: 0 0 0 7px rgba(16, 185, 129, 0.45); }
      100% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.22); }
    }
    /* Mode « entourer la bonne zone ». La couche texte passe en dessous,
     * sinon le glisser selectionne des mots au lieu de tracer un cadre. */
    .pdf-viewer.pv-picking .pv-text { pointer-events: none; user-select: none; }
    .pdf-viewer.pv-picking .pv-overlay { pointer-events: auto; cursor: crosshair; }
    /* Les mots selectionnables. Ils ne se voient qu'en mode designation, et
     * a peine : c'est un repere, pas une decoration. Sous le cadre en cours
     * de trace, ils s'allument ; choisis, ils restent allumes. */
    .pdf-viewer .pv-mot {
      position: absolute; box-sizing: border-box; border-radius: 2px;
      border: 1px solid rgba(109, 40, 217, 0.18); cursor: pointer;
    }
    .pdf-viewer .pv-mot:hover { border-color: rgba(109, 40, 217, 0.6); }
    .pdf-viewer .pv-mot.apercu {
      background: rgba(139, 92, 246, 0.18); border-color: rgba(109, 40, 217, 0.7);
    }
    .pdf-viewer .pv-mot.on {
      background: rgba(139, 92, 246, 0.32); border: 1.5px solid rgba(109, 40, 217, 0.9);
    }
    .pdf-viewer .pv-mots { position: absolute; inset: 0; z-index: 5; }

    .pdf-viewer .pv-pick-box {
      position: absolute; z-index: 4; pointer-events: none;
      background: rgba(139, 92, 246, 0.18);
      border: 1.5px dashed rgba(109, 40, 217, 0.9);
    }
    .pdf-viewer .pv-pick-hint {
      position: sticky; top: 0; z-index: 6; align-self: stretch;
      margin: -16px -16px 0; padding: 8px 14px;
      background: #6d28d9; color: #fff; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 12px;
    }
    .pdf-viewer .pv-pick-quoi { flex: none; }
    .pdf-viewer .pv-pick-aide {
      flex: 0 1 auto; min-width: 0; font-weight: 400; opacity: .9;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Les commandes restent groupees a droite, quel que soit l'etat. */
    .pdf-viewer .pv-pick-hint:not(.a-choisi) .pv-pick-aide { margin-right: auto; }
    /* CE QU'ON A PRIS SE LIT EN ENTIER. Coupe a une ligne, l'apercu affichait
     * « PERIMETRE DE C... » alors que la selection faisait dix mots : on
     * validait sans savoir. Il prend donc la place, sur trois lignes au
     * besoin, et defile au-dela. */
    /* Un CHAMP, pas un texte mort : une lecture d'image se trompe, et la
     * personne qui la voit est la seule a pouvoir la corriger. Ce qu'elle
     * tape part dans la fiche, et l'ecart avec ce que la machine avait lu
     * remonte dans Admin : les corrections disent ou la lecture se trompe. */
    .pdf-viewer .pv-pick-hint .apercu-texte {
      flex: 1 1 260px; min-width: 220px; font-weight: 400; font-size: 12.5px;
      /* Interligne en PIXELS, pas en em : trois lignes doivent faire une
       * hauteur entiere, sinon la troisieme est rognee d'un ou deux pixels et
       * ca se voit. */
      line-height: 17px; padding: 5px 10px; font-family: inherit;
      border: 1px solid rgba(255, 255, 255, .45); border-radius: 6px;
      background: rgba(255, 255, 255, .14); color: #fff;
      /* Sur PLUSIEURS lignes : une selection de dix mots ne tient pas sur une,
       * et coupee a « PERIMETRE DE C... » on validait sans savoir ce qu'on
       * prenait. Au-dela de trois lignes, ca defile. */
      white-space: pre-wrap; overflow-wrap: anywhere;
      /* TROIS LIGNES ENTIERES, jamais deux et demie. La hauteur etait donnee
       * en em sans compter le rembourrage : la troisieme ligne se retrouvait
       * coupee en son milieu, ce qui se lit comme un defaut alors que le
       * texte est simplement plus long. */
      /* 3 lignes de 17 + 10 de rembourrage + 2 de bordure : le calcul est
       * en border-box, les bordures comptent. */
      max-height: 63px; overflow-y: auto;
    }
    .pdf-viewer .pv-pick-hint .apercu-texte:empty::before {
      content: attr(data-vide); color: rgba(255, 255, 255, .6);
    }
    .pdf-viewer .pv-pick-hint .apercu-texte:focus {
      outline: none; background: #fff; color: #3b0764; border-color: #fff;
    }
    .pdf-viewer .pv-pick-compte {
      flex: none; font-weight: 400; font-size: 11.5px; opacity: .8;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    /* LA BARRE A DEUX ETATS, et elle ne montre que ce qui a un sens dans
     * chacun. Avant de choisir : le nom du champ, la consigne, et de quoi
     * sortir. Un champ de correction vide n'a rien a corriger, un compteur
     * n'a rien a compter, et « Valider » ne validerait rien ; les trois
     * etaient pourtant la, et le champ vide, ecrase par la consigne, tombait
     * a trois lignes coupees en plein milieu.
     * Apres avoir choisi : la consigne s'efface, la place va au texte pris. */
    .pdf-viewer .pv-pick-hint.a-choisi .pv-pick-aide { display: none; }
    .pdf-viewer .pv-pick-hint:not(.a-choisi) .apercu-texte,
    .pdf-viewer .pv-pick-hint:not(.a-choisi) .pv-pick-compte,
    .pdf-viewer .pv-pick-hint:not(.a-choisi) [data-act="recommencer"],
    .pdf-viewer .pv-pick-hint:not(.a-choisi) [data-act="valider"] { display: none; }
    /* LES BOUTONS SE VOIENT, ET CELUI QUI COMPTE SE VOIT LE PREMIER.
     * Ils etaient transparents avec un filet blanc a moitie opaque sur du
     * violet : trois commandes de la meme couleur que le fond, et « Valider »
     * ne se distinguait pas de « Annuler ». On lit une barre d'action en
     * cherchant l'action principale ; si elle a l'air d'un lien, on la cherche.
     * Valider est donc plein, les deux autres tiennent un fond assez opaque
     * pour se detacher, et aucun ne se laisse pousser hors de l'ecran. */
    .pdf-viewer .pv-pick-hint button {
      flex: none; border: 1px solid rgba(255,255,255,.55);
      background: rgba(255,255,255,.16); color: #fff;
      border-radius: 6px; padding: 5px 12px; font: inherit; font-size: 12px;
      font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .pdf-viewer .pv-pick-hint button:hover { background: rgba(255,255,255,.28); }
    .pdf-viewer .pv-pick-hint [data-act="valider"] {
      background: #fff; border-color: #fff; color: #4c1d95;
    }
    .pdf-viewer .pv-pick-hint [data-act="valider"]:hover { background: #f5f3ff; }
  `;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const r = (n) => Math.round(n * 10) / 10;

  const MIN_SCALE = 0.4;
  const MAX_SCALE = 3;

  /* Une teinte par statut. `aplat` est la couleur pleine du surligneur : elle
   * est posee a plein dans un groupe qui porte, lui, l'opacite. `trait` est
   * la couleur du cadre, du soulignement et du repere de marge, ou l'opacite
   * n'a pas d'importance puisqu'un trait ne se superpose pas a lui-meme. */
  const TEINTES = {
    retrieval: { aplat: "#facc15", trait: "rgba(217, 119, 6, 0.85)" },
    answer:    { aplat: "#4ade80", trait: "rgba(5, 150, 105, 0.90)" },
    picked:    { aplat: "#a78bfa", trait: "rgba(109, 40, 217, 0.90)" },
    trouve:    { aplat: "#facc15", trait: "rgba(161, 98, 7, 0.55)" },
    courant:   { aplat: "#fb923c", trait: "rgba(194, 65, 12, 0.95)" },
  };
  /* L'opacite du groupe d'aplats. Une seule valeur, pour tout le calque :
   * c'est ce qui garantit qu'un chevauchement ne fonce pas. */
  const OPACITE_APLAT = 0.45;

  class PdfViewer {
    constructor({ host, pdfUrl, onReady, chercherTexte, lireImage }) {
      this.host = typeof host === "string" ? document.querySelector(host) : host;
      this.host.classList.add("pdf-viewer");
      this.host.innerHTML = "";

      // Nav bar.
      this.nav = document.createElement("div");
      this.nav.className = "pv-nav";
      this.nav.innerHTML = `
        <span class="pv-groupe">
          <button data-act="prev" title="Previous page">‹</button>
          <input type="number" min="1" value="1" />
          <span class="pv-total">/ 0</span>
          <button data-act="next" title="Next page">›</button>
        </span>
        <span class="pv-find" hidden>
          <input type="search" class="pv-find-champ" placeholder="Chercher : mot, ET, OU, SAUF"
            title="franchise ET vol : les deux sur la même page&#10;vol OU incendie : l&apos;un ou l&apos;autre&#10;franchise SAUF auto : la première, sans la seconde&#10;&quot;jours fériés&quot; : l&apos;expression telle quelle"
                 title="Le mot tel qu'il est tape. Entrée passe a l'occurrence suivante, Maj+Entrée a la précédente." />
          <span class="pv-find-compte"></span>
          <button data-act="find-prev" title="Occurrence précédente" hidden>‹</button>
          <button data-act="find-next" title="Occurrence suivante" hidden>›</button>
          <label class="pv-find-entier" title="La chaine doit couvrir des mots complets" hidden>
            <input type="checkbox" /> entier
          </label>
          <button class="pv-lire" data-act="lire-image" hidden
                  title="Ce document est une image : la lire une fois pour pouvoir y chercher">
            Lire l'image</button>
        </span>
        <span class="pv-spacer"></span>
        <span class="pv-groupe">
          <button data-act="zoom-out" title="Zoom out">−</button>
          <span class="pv-zoom" style="min-width: 40px; text-align: center;">100%</span>
          <button data-act="zoom-in"  title="Zoom in">+</button>
          <button data-act="fit"      title="Ajuster à la largeur">${window.Icones ? Icones.svg("ajuster", 15) : ""}</button>
        </span>
        <select class="pv-style" title="Comment montrer un passage" hidden>
          <option value="cadre">Cadre</option>
          <option value="marqueur">Surligneur</option>
          <option value="souligne">Souligne</option>
          <option value="marge">Repere de marge</option>
          <option value="projecteur">Projecteur</option>
        </select>
      `;
      this.host.appendChild(this.nav);

      // Scroll area with per-page containers stacked vertically.
      this.scroll = document.createElement("div");
      this.scroll.className = "pv-scroll";
      this.host.appendChild(this.scroll);

      this.pdfUrl = pdfUrl;
      this.onReady = onReady;
      /* Chercher un mot dans le document.
       *
       * La recherche n'est pas faite ici : le lecteur ne connait que des
       * pixels, et retrouver un mot coupe en trois morceaux de texte dans la
       * couche pdf.js est un travail d'a-peu-pres. L'appelant fournit une
       * fonction qui rend des boites en coordonnees PDF, celles du document,
       * et le lecteur les allume comme il allume la source d'un champ. Sans
       * cette fonction, le champ de recherche ne s'affiche pas. */
      this.chercherTexte = chercherTexte || null;
      /* Lire l'image d'un document sans couche texte. Comme la recherche, le
       * lecteur ne le fait pas lui-meme : l'appelant fournit la fonction, et
       * sans elle le bouton n'apparait pas. */
      this.lireImage = lireImage || null;
      this._image = false;
      this._sourceTrouve = "texte";
      this._finds = [];        // les occurrences trouvees
      this._findRang = -1;     // celle qu'on regarde
      this.pdfDoc = null;
      this.nPages = 0;
      this.currentPage = 1;
      this.scale = 1.25;
      /* Vrai des que le lecteur a touche au zoom : l'ajustement automatique
       * ne repasse plus par-dessus. */
      this._zoomManuel = false;
      this._highlights = [];
      this._pageEls = [];      // .pv-page divs
      this._canvasEls = [];    // canvas per page
      this._textEls = [];      // couche texte selectionnable par page
      this._overlayEls = [];   // .pv-overlay per page
      this._viewports = [];    // viewport per page at current scale
      this._renderTasks = [];  // in-flight pdf.js render tasks
      this._scrollLock = 0;    // timestamp of last programmatic scroll
      this._rendered = new Set();  // index des pages deja peintes
      this._lignesPx = {};     // lignes de texte mesurees, par page et par zoom
      // Deux lecteurs peuvent vivre dans la meme page (comparaison de deux
      // documents) : les masques SVG portent un identifiant propre, sinon le
      // second efface le voile du premier.
      this._uid = `pv${Math.random().toString(36).slice(2, 8)}`;
      // Le style de surlignage, garde d'une session a l'autre : c'est un
      // gout, pas un reglage a refaire chaque matin.
      this.hlStyle = "cadre";
      try {
        const garde = localStorage.getItem("pv:style-surlignage");
        if (garde) this.hlStyle = garde;
      } catch (_) { /* pas de memoire : le defaut suffit */ }
      this.host.classList.add(`hl-${this.hlStyle}`);
      this._io = null;         // observateur des pages visibles

      this._wireNav();
      this._wireScroll();
      this._loadPromise = this._load();
      this._observeResize();
    }

    _wireNav() {
      this.nav.querySelector('[data-act="prev"]').addEventListener("click", () => this.setPage(this.currentPage - 1));
      this.nav.querySelector('[data-act="next"]').addEventListener("click", () => this.setPage(this.currentPage + 1));
      this.nav.querySelector("input").addEventListener("change", (e) => {
        const p = parseInt(e.target.value, 10);
        if (!isNaN(p)) this.setPage(p);
      });
      this.nav.querySelector('[data-act="zoom-in"]').addEventListener("click",  () => this._zoom(1.2));
      this.nav.querySelector('[data-act="zoom-out"]').addEventListener("click", () => this._zoom(1 / 1.2));
      this.nav.querySelector('[data-act="fit"]').addEventListener("click",       () => this._fitWidth({ force: true }));
      const style = this.nav.querySelector(".pv-style");
      if (style) {
        style.value = this.hlStyle;
        style.addEventListener("change", () => this.setHighlightStyle(style.value));
      }
      this._wireFind();
    }

    /* La recherche : taper, voir combien, sauter d'une occurrence a l'autre.
     *
     * Le champ attend 250 ms apres la derniere frappe. Chercher a chaque
     * touche, c'est cinq requetes pour un mot de cinq lettres, dont quatre
     * dont la reponse ne sera jamais lue. */
    _wireFind() {
      const zone = this.nav.querySelector(".pv-find");
      if (!zone || !this.chercherTexte) return;
      zone.hidden = false;
      const champ = zone.querySelector(".pv-find-champ");
      const entier = zone.querySelector(".pv-find-entier input");
      let minuterie = null;

      const lancer = () => this.chercher(champ.value, entier.checked);
      champ.addEventListener("input", () => {
        // Le reglage « mot entier » n'apparait qu'une fois qu'on cherche
        // quelque chose : une case a cocher devant un champ vide est une
        // commande de plus a lire pour rien.
        zone.querySelector(".pv-find-entier").hidden = !champ.value.trim();
        clearTimeout(minuterie);
        minuterie = setTimeout(lancer, 250);
      });
      champ.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(minuterie);
          if (this._finds.length) this.occurrence(e.shiftKey ? -1 : 1);
          else lancer();
        }
        if (e.key === "Escape") { champ.value = ""; this.effacerRecherche(); }
      });
      entier.addEventListener("change", lancer);
      zone.querySelector('[data-act="find-prev"]')
          .addEventListener("click", () => this.occurrence(-1));
      zone.querySelector('[data-act="find-next"]')
          .addEventListener("click", () => this.occurrence(1));
      zone.querySelector('[data-act="lire-image"]')
          .addEventListener("click", () => this.lireLImage());
      this._majCompte();
    }

    async chercher(terme, entier) {
      if (!this.chercherTexte) return;
      const propre = (terme || "").trim();
      if (propre.length < 2) { this.effacerRecherche(); return; }
      const zone = this.nav.querySelector(".pv-find");
      zone.classList.add("cherche");
      try {
        const out = await this.chercherTexte(propre, !!entier);
        // Ce que chaque terme a rapporte, garde pour le compteur. Une
        // recherche combinee qui ne rend rien doit dire POURQUOI : « franchise
        // ET vol » a zero peut vouloir dire que « vol » est absent du
        // document, ou que les deux y sont sans jamais se croiser sur une
        // page. Sans ce detail, on retape la requete au hasard.
        this._termes = (out && out.termes) || [];
        this._combinee = !!(out && out.combinee);
        this._image = !!(out && out.image && !out.ocr_pret);
        this._sourceTrouve = (out && out.source) || "texte";
        this._finds = (out && out.hits) || [];
        this._pagesTrouvees = (out && out.pages) || [];
        this._findRang = this._finds.length ? 0 : -1;
        this._renderOverlays();
        if (this._finds.length) await this._allerALOccurrence();
      } catch (_) {
        this._finds = []; this._findRang = -1; this._renderOverlays();
      } finally {
        zone.classList.remove("cherche");
        this._majCompte();
      }
    }

    /** Passer a l'occurrence suivante (1) ou precedente (-1), en boucle. */
    async occurrence(pas) {
      if (!this._finds.length) return;
      const n = this._finds.length;
      this._findRang = ((this._findRang + pas) % n + n) % n;
      this._renderOverlays();
      this._majCompte();
      await this._allerALOccurrence();
    }

    async _allerALOccurrence() {
      const trouve = this._finds[this._findRang];
      if (!trouve) return;
      await this._renderPage(Number(trouve.page) - 1);
      this._renderOverlays();
      this.jumpTo({ page: trouve.page, y0: trouve.y0 });
    }

    _majCompte() {
      const compte = this.nav.querySelector(".pv-find-compte");
      if (!compte) return;
      const champ = this.nav.querySelector(".pv-find-champ");
      const fleches = this.nav.querySelectorAll('[data-act^="find-"]');
      const lire = this.nav.querySelector('[data-act="lire-image"]');
      const cherche = !!(champ && champ.value.trim());
      fleches.forEach((b) => { b.hidden = !this._finds.length; });
      if (lire) lire.hidden = !(cherche && this._image);
      if (!cherche) { compte.textContent = ""; compte.className = "pv-find-compte"; return; }
      // « aucune » sur un document qui montre le mot a l'ecran fait douter de
      // l'outil. S'il n'y a pas de couche texte, on le dit.
      if (this._image) {
        compte.textContent = "image";
        compte.className = "pv-find-compte image";
        compte.title = "Ce document est une image : il ne porte aucun texte a chercher.";
        return;
      }
      compte.title = this._sourceTrouve === "ocr"
        ? "Recherche sur le texte lu sur l'image, ligne par ligne."
        : "";
      const detail = (this._termes || [])
        .map((t) => `${t.terme} : ${t.occurrences}`).join(" · ");
      if (this._combinee && detail) {
        compte.title = detail + (this._finds.length ? ""
          : String.fromCharCode(10) + "Aucune page ne satisfait la combinaison.");
      }
      compte.textContent = this._finds.length
        ? `${this._findRang + 1} / ${this._finds.length}`
          + (this._sourceTrouve === "ocr" ? " (image)" : "")
          + (this._combinee ? ` · ${(this._pagesTrouvees || []).length} pages` : "")
        : (this._combinee && detail ? "aucune · " + detail : "aucune");
      compte.className = "pv-find-compte" + (this._finds.length ? "" : " vide");
    }

    /** Lire l'image une fois, puis relancer la recherche dessus. */
    async lireLImage() {
      if (!this.lireImage) return;
      const zone = this.nav.querySelector(".pv-find");
      const bouton = zone.querySelector('[data-act="lire-image"]');
      const compte = zone.querySelector(".pv-find-compte");
      bouton.disabled = true;
      compte.textContent = "lecture…";
      compte.className = "pv-find-compte";
      try {
        const out = await this.lireImage();
        if (out && out.error) throw new Error(out.error);
        this._image = false;
        const champ = zone.querySelector(".pv-find-champ");
        const entier = zone.querySelector(".pv-find-entier input");
        await this.chercher(champ.value, entier.checked);
      } catch (exc) {
        compte.textContent = "echec";
        compte.className = "pv-find-compte vide";
        compte.title = exc.message;
      } finally {
        bouton.disabled = false;
      }
    }

    effacerRecherche() {
      this._finds = [];
      this._findRang = -1;
      this._renderOverlays();
      this._majCompte();
    }

    _wireScroll() {
      this.scroll.addEventListener("scroll", () => {
        // Track the current page = last page whose top has crossed the top-third
        // of the scroll container.
        const rect = this.scroll.getBoundingClientRect();
        const probe = rect.top + this.scroll.clientHeight / 3;
        let n = 1;
        for (let i = 0; i < this._pageEls.length; i++) {
          const el = this._pageEls[i];
          if (el && el.getBoundingClientRect().top <= probe) n = i + 1;
        }
        if (n !== this.currentPage) {
          this.currentPage = n;
          this.nav.querySelector("input").value = String(n);
        }
      });
    }

    /** Recale la page sur la largeur disponible. Appele quand on regle les
     *  colonnes : le ResizeObserver le ferait aussi, mais 120 ms plus tard,
     *  ce qui se voit a l'ecran comme un saut. */
    refit() {
      return this._fitWidth();
    }

    _observeResize() {
      let t;
      const ro = new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => this._fitWidth(), 120);
      });
      ro.observe(this.scroll);
    }

    async _load() {
      const lib = await loadPdfJs();
      this._pdfjs = lib;          // garde pour la couche texte
      this.pdfDoc = await lib.getDocument(this.pdfUrl).promise;
      this.nPages = this.pdfDoc.numPages;
      this.nav.querySelector(".pv-total").textContent = `/ ${this.nPages}`;
      // Un document d'une page n'a pas de navigation de page : quatre
      // commandes qui ne servent a rien sur la moitie des documents.
      const groupePages = this.nav.querySelector(".pv-groupe");
      if (groupePages) groupePages.hidden = this.nPages < 2;
      this.nav.querySelector("input").max = String(this.nPages);
      // Build the page containers (empty canvases + overlays), then render.
      this._buildPageEls();
      // Try to fit width now (may bail if the pane isn't laid out yet). Then
      // ALWAYS render at the current scale so the canvas has content even
      // when the pane is momentarily 0-width. ResizeObserver will re-fit +
      // re-render once the layout stabilises.
      await this._fitWidth();
      await this._renderAll();
      if (this.onReady) this.onReady(this.nPages);
    }

    _buildPageEls() {
      this._pageEls = []; this._canvasEls = []; this._textEls = []; this._overlayEls = [];
      this.scroll.innerHTML = "";
      for (let i = 0; i < this.nPages; i++) {
        const wrap = document.createElement("div");
        wrap.className = "pv-page";
        wrap.dataset.page = String(i + 1);
        const canvas = document.createElement("canvas");
        const textLayer = document.createElement("div");
        textLayer.className = "pv-text";
        const overlay = document.createElement("div");
        overlay.className = "pv-overlay";
        wrap.appendChild(canvas);
        wrap.appendChild(textLayer);
        wrap.appendChild(overlay);
        this.scroll.appendChild(wrap);
        this._pageEls.push(wrap);
        this._canvasEls.push(canvas);
        this._textEls.push(textLayer);
        this._overlayEls.push(overlay);
      }
    }

    /** Ajuster a la largeur du cadre.
     *
     * `force` distingue les deux appelants, et c'est tout le sujet du zoom.
     * L'ouverture du document et le bouton « ajuster » demandent VRAIMENT une
     * mise a la largeur. L'observateur de taille, lui, se declenche pour tout
     * et n'importe quoi, y compris pour une consequence du zoom lui-meme :
     * agrandir la page la rend plus large que le cadre, une barre de
     * defilement horizontale apparait, le cadre perd quinze pixels, et
     * l'observateur rappelle cette fonction. Elle recalculait alors l'echelle
     * « pleine largeur » et ecrasait le choix du lecteur : on cliquait sur
     * « + », la page grossissait un instant et revenait a sa taille. Mesure du
     * 2026-09-10 sur `hr_search` : zoom porte a 180 %, un redimensionnement,
     * retour a 86 %. C'est ca, « le zoom ne fonctionne pas ».
     *
     * Des que le lecteur a regle le zoom a la main, l'ajustement automatique
     * se tait. Le bouton « ajuster » lui rend la parole.
     */
    async _fitWidth({ force = false } = {}) {
      if (!this.pdfDoc || this.scroll.clientWidth < 40) return;
      if (this._zoomManuel && !force) return;
      if (force) this._zoomManuel = false;
      const page = await this.pdfDoc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (this.scroll.clientWidth - 40) / vp1.width));
      if (Math.abs(this.scale - next) > 0.01) {
        this.scale = next;
        await this._renderAll();
      }
    }

    async _zoom(factor) {
      // Le lecteur a pris la main : elle ne lui est plus reprise.
      this._zoomManuel = true;
      this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
      await this._renderAll();
    }

    async _renderAll() {
      // Deux phases, et l'ordre compte. Phase 1 : mesurer TOUTES les pages
      // (getViewport est bon marche) pour que la geometrie soit connue tout
      // de suite. Phase 2 : ne peindre que les pages visibles, a la demande.
      //
      // L'ancienne version peignait les pages une par une avant de dessiner
      // le moindre surlignage : sur un Code du travail de 494 pages, la
      // citation n'apparaissait jamais. Un document long est la norme, pas
      // le cas limite.
      for (const t of this._renderTasks) { try { t.cancel(); } catch (_) {} }
      this._renderTasks = [];
      this._rendered = new Set();
      this.nav.querySelector(".pv-zoom").textContent = `${Math.round(this.scale * 100)}%`;

      // un changement d'echelle invalide les positions du texte
      for (const el of this._textEls || []) { el.dataset.done = ""; el.innerHTML = ""; }
      this._lignesPx = {};

      this._viewports = [];
      for (let i = 0; i < this.nPages; i++) {
        const page = await this.pdfDoc.getPage(i + 1);
        const vp = page.getViewport({ scale: this.scale });
        this._viewports.push(vp);
        const canvas = this._canvasEls[i];
        canvas.style.width  = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        this._pageEls[i].style.width  = `${vp.width}px`;
        this._pageEls[i].style.height = `${vp.height}px`;
      }
      // La geometrie est connue : les surlignages peuvent etre poses.
      this._renderOverlays();

      // LES BOITES DE MOTS SONT POSEES EN PIXELS, elles aussi. Le calque du
      // mode « designer la source » etait le seul a survivre au changement
      // d'echelle : ses divs gardaient les coordonnees calculees au zoom
      // precedent, et les cadres se retrouvaient decales du texte, en haut a
      // gauche des mots. On les jette et on les repose, selection comprise.
      for (const el of this._pageEls) {
        const couche = el && el.querySelector(".pv-mots");
        if (couche) couche.remove();
      }
      if (this._pickStart) {
        for (const p of [this.currentPage, this.currentPage + 1, this.currentPage - 1]) {
          if (p >= 1 && p <= this.nPages) await this._montrerMots(p);
        }
        this._majSelection();
      }

      this._observeVisiblePages();
      await this._renderVisible();
    }

    _observeVisiblePages() {
      if (this._io) this._io.disconnect();
      // marge d'une hauteur d'ecran : la page suivante est prete avant
      // qu'on l'atteigne au scroll
      this._io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this._renderPage(Number(e.target.dataset.pageIndex));
        }
      }, { root: this.scroll, rootMargin: "600px 0px" });
      this._pageEls.forEach((el, i) => {
        el.dataset.pageIndex = String(i);
        this._io.observe(el);
      });
    }

    async _renderPage(i) {
      if (this._rendered.has(i) || !this._viewports[i]) return;
      this._rendered.add(i);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = this._viewports[i];
      const canvas = this._canvasEls[i];
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      try {
        const page = await this.pdfDoc.getPage(i + 1);
        const task = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        this._renderTasks.push(task);
        await task.promise;
        await this._renderText(i, page, vp);
      } catch (_) {
        this._rendered.delete(i);   // annulee : re-rendre au prochain passage
      }
    }

    /** Pose les mots de la page, transparents, exactement sur l'image.
     *
     * Peinte seule, une page est une photo : rien a selectionner, rien a
     * copier, Ctrl+F ne trouve rien. La couche texte de pdf.js redonne au
     * lecteur le geste qu'il attend d'un document. Elle est posee APRES le
     * canvas de la meme page, donc uniquement sur les pages reellement
     * affichees : rien n'est calcule pour les pages qu'on ne regarde pas.
     */
    async _renderText(i, page, vp) {
      const holder = this._textEls[i];
      if (!holder || holder.dataset.done === "1") return;
      holder.innerHTML = "";
      holder.style.width = `${vp.width}px`;
      holder.style.height = `${vp.height}px`;
      try {
        const textContent = await page.getTextContent();
        const lib = this._pdfjs || window.pdfjsLib;
        if (lib && lib.TextLayer) {
          const layer = new lib.TextLayer({ textContentSource: textContent,
                                            container: holder, viewport: vp });
          await layer.render();
        } else if (lib && lib.renderTextLayer) {
          await lib.renderTextLayer({ textContentSource: textContent,
                                      container: holder, viewport: vp }).promise;
        } else {
          return;                       // pas de couche texte disponible
        }
        holder.dataset.done = "1";
        // Le soulignement pose avant la couche texte l'a ete sur le bloc
        // entier, faute de lignes a decouper. Elles existent : on redessine.
        delete this._lignesPx[i];
        this._dessinerPage(i);
      } catch (_) {
        holder.innerHTML = "";          // une page sans texte reste une image
      }
    }

    async _renderVisible() {
      const around = Math.max(0, this.currentPage - 2);
      for (let i = around; i < Math.min(this.nPages, around + 4); i++) {
        await this._renderPage(i);
      }
      this._renderOverlays();
    }

    /* Deux boites qui se touchent n'en font qu'une.
     *
     * Une valeur tenant sur deux mots donnait deux cadres accoles, et deux
     * lignes voisines empilaient leurs traits jusqu'a cacher le texte : sur
     * une facture, « BILL FROM » disparaissait sous le cadre de la ligne du
     * dessous. On regroupe donc par ligne (chevauchement vertical) puis on
     * fusionne ce qui se touche horizontalement. */
    _fusionner(boites) {
      const restantes = boites.map((b) => ({ ...b }));
      const sorties = [];
      restantes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      for (const boite of restantes) {
        const hauteur = Math.max(1, boite.y1 - boite.y0);
        const voisine = sorties.find((s) => {
          if (s.kind !== boite.kind) return false;
          const communVertical = Math.min(s.y1, boite.y1) - Math.max(s.y0, boite.y0);
          if (communVertical < hauteur * 0.5) return false;          // pas la meme ligne
          const ecart = Math.max(s.x0, boite.x0) - Math.min(s.x1, boite.x1);
          // Un interligne et demi d'ecart, et non 0,9 : un tiret de puce est
          // une ligne a lui seul, pose une douzaine de points avant son
          // texte, et restait encadre a part. Les colonnes d'un tableau sont
          // separees de bien plus (cent points et davantage sur les CG), elles
          // ne risquent rien.
          return ecart <= hauteur * 1.8;                              // mots voisins
        });
        if (voisine) {
          voisine.x0 = Math.min(voisine.x0, boite.x0);
          voisine.x1 = Math.max(voisine.x1, boite.x1);
          voisine.y0 = Math.min(voisine.y0, boite.y0);
          voisine.y1 = Math.max(voisine.y1, boite.y1);
        } else {
          sorties.push({ ...boite });
        }
      }
      return sorties;
    }

    _renderOverlays() {
      // Le choix du style de surlignage n'a de sens que devant un
      // surlignage. Toujours affiche, c'etait une commande de plus a lire
      // dans une barre deja chargee.
      const style = this.nav.querySelector(".pv-style");
      if (style) style.hidden = !(this._highlights.length || this._finds.length);
      for (let i = 0; i < this.nPages; i++) this._dessinerPage(i);
    }

    /** Le calque SVG d'une page : voile, aplats, traits.
     *
     * Trois couches, dans cet ordre. Le voile du projecteur, perce aux
     * endroits designes. Les aplats du surligneur, tous dans UN groupe qui
     * porte l'opacite : deux aplats qui se recouvrent ne foncent pas, le
     * dessus gagne. Les traits (cadres, soulignements, reperes de marge)
     * par-dessus, a pleine opacite.
     */
    _dessinerPage(index) {
      const vp = this._viewports[index];
      const overlay = this._overlayEls[index];
      if (!vp || !overlay) return;
      const page = index + 1;
      const s = this.scale;
      const enPx = (h) => ({
        g: (h.x0 - vp.viewBox[0]) * s,
        d: (h.x1 - vp.viewBox[0]) * s,
        haut: (h.y0 - vp.viewBox[1]) * s,
        bas: (h.y1 - vp.viewBox[1]) * s,
        kind: h.kind || "retrieval",
      });

      const blocs = this._fusionner(
        this._highlights.filter((h) => Number(h.page) === page)).map(enPx);
      // Les occurrences d'une recherche vivent A COTE de la source d'un
      // champ, elles ne la remplacent pas : on relit un contrat en gardant
      // sous les yeux d'ou sort la valeur qu'on verifie. Elles ne passent
      // pas par la fusion des lignes empilees non plus, un mot est un mot.
      const courant = this._finds[this._findRang];
      const trouves = this._finds
        .filter((h) => Number(h.page) === page)
        .map((h) => ({ ...enPx(h), kind: h === courant ? "courant" : "trouve" }));

      if (!blocs.length && !trouves.length) { overlay.innerHTML = ""; return; }

      // Le surligneur et le soulignement epousent le texte : un bloc de
      // plusieurs lignes est redecoupe ligne par ligne, sinon le feutre
      // deborde sur les blancs et le trait ne passe que sous la derniere.
      const colle = this.hlStyle === "marqueur" || this.hlStyle === "souligne";
      const morceaux = colle
        ? blocs.flatMap((b) => this._decouperEnLignes(b, index))
        : blocs;

      const W = vp.width;
      const H = vp.height;
      const aplats = [];
      const traits = [];
      const trous = [];

      for (const m of morceaux) {
        const teinte = TEINTES[m.kind] || TEINTES.retrieval;
        const hauteur = Math.max(1, m.bas - m.haut);
        if (this.hlStyle === "marqueur") {
          aplats.push(this._rect(m, 0, teinte.aplat, 1, 1, `pv-hl ${m.kind}`));
        } else if (this.hlStyle === "souligne") {
          // Un trait sous la ligne, jamais dessus : zero recouvrement, meme
          // quand deux lignes voisines sont designees.
          const epaisseur = m.kind === "answer" ? 2 : 1.5;
          // SOUS la ligne, pas dedans : pose au bas de la boite du texte, le
          // trait coupait les jambages des p et des q.
          traits.push(`<rect class="pv-hl ${m.kind}" x="${r(m.g)}" y="${r(m.bas)}"`
            + ` width="${r(Math.max(2, m.d - m.g))}" height="${epaisseur}" rx="1.5"`
            + ` fill="${teinte.trait}"></rect>`);
        } else if (this.hlStyle === "marge") {
          // Un trait dans la marge gauche, a la hauteur du passage, plus un
          // voile tres leger. La page reste intacte, on retrouve la ligne au
          // bord.
          aplats.push(this._rect(m, 3, teinte.aplat, 0.18, 2, `pv-hl ${m.kind}`));
          traits.push(`<rect class="pv-hl ${m.kind}" x="${r(Math.max(0, m.g - 12))}"`
            + ` y="${r(m.haut)}" width="2.5" height="${r(hauteur)}" rx="1.25"`
            + ` fill="${teinte.trait}"></rect>`);
        } else {
          // Cadre (le defaut) et projecteur : un trait autour, rien dessus.
          const marge = Math.min(3, Math.max(1, hauteur * 0.18));
          const cadre = { g: m.g - 3, d: m.d + 3, haut: m.haut - marge, bas: m.bas + marge };
          if (this.hlStyle === "projecteur") {
            // Le trou seul suffit a designer le passage : un contour blanc
            // par-dessus faisait un halo epais autour de chaque ligne.
            trous.push(this._rect(cadre, 3, "#000", 1, 0, `pv-hl ${m.kind}`));
          } else {
            traits.push(this._contour(cadre, 2, teinte.trait, 1, m.kind));
          }
        }
      }

      for (const t of trouves) {
        const teinte = TEINTES[t.kind];
        const boite = { g: t.g - 1.5, d: t.d + 1.5, haut: t.haut - 1.5, bas: t.bas + 1.5 };
        aplats.push(this._rect(boite, 2, teinte.aplat, 1, 2, "pv-trouve"
          + (t.kind === "courant" ? " courant" : "")));
        if (t.kind === "courant") {
          traits.push(this._contour(boite, 2, teinte.trait, 1.25, "courant", "pv-trouve"));
        }
      }

      // Le voile du projecteur. Un masque, pas un mode de fusion : le
      // `destination-out` du CSS n'existe pas, le rectangle restait blanc et
      // POSAIT UN CACHE sur la ligne qu'il devait montrer.
      let voile = "";
      if (this.hlStyle === "projecteur" && trous.length) {
        const id = `${this._uid}-m${page}`;
        voile = `<defs><mask id="${id}" maskUnits="userSpaceOnUse"`
          + ` x="0" y="0" width="${r(W)}" height="${r(H)}">`
          + `<rect x="0" y="0" width="${r(W)}" height="${r(H)}" fill="#fff"></rect>`
          + trous.join("") + `</mask></defs>`
          + `<rect x="0" y="0" width="${r(W)}" height="${r(H)}"`
          + ` fill="#0f172a" opacity="0.42" mask="url(#${id})"></rect>`;
      }

      // UN seul groupe pour tous les aplats, et c'est LUI qui porte
      // l'opacite : SVG aplatit le groupe avant de l'appliquer, donc deux
      // aplats superposes rendent la meme teinte qu'un seul.
      const groupe = aplats.length
        ? `<g opacity="${OPACITE_APLAT}" style="mix-blend-mode:multiply">${aplats.join("")}</g>`
        : "";
      overlay.innerHTML = `<svg class="pv-calque" width="${r(W)}" height="${r(H)}"`
        + ` viewBox="0 0 ${r(W)} ${r(H)}">${voile}${groupe}${traits.join("")}</svg>`;
    }

    _rect(b, rayon, couleur, opacite, marge, classe = "pv-hl") {
      const x = b.g - marge;
      const y = b.haut - marge;
      return `<rect class="${classe}" x="${r(x)}" y="${r(y)}"`
        + ` width="${r(Math.max(1, b.d - b.g + marge * 2))}"`
        + ` height="${r(Math.max(1, b.bas - b.haut + marge * 2))}" rx="${rayon}"`
        + ` fill="${couleur}"${opacite === 1 ? "" : ` fill-opacity="${opacite}"`}></rect>`;
    }

    _contour(b, rayon, couleur, epaisseur, kind, classe = "pv-hl") {
      // Le trait se dessine sur sa mediane : on rentre d'une demi-epaisseur
      // pour que le cadre ne deborde pas de la boite calculee.
      const e = epaisseur / 2;
      return `<rect class="${classe} ${kind}" x="${r(b.g + e)}" y="${r(b.haut + e)}"`
        + ` width="${r(Math.max(1, b.d - b.g - epaisseur))}"`
        + ` height="${r(Math.max(1, b.bas - b.haut - epaisseur))}" rx="${rayon}"`
        + ` fill="none" stroke="${couleur}" stroke-width="${epaisseur}"></rect>`;
    }

    /** Redecouper un bloc de plusieurs lignes sur les lignes reelles.
     *
     * Le serveur rend une boite par citation, lignes empilees deja fondues.
     * C'est ce qu'il faut pour un cadre, jamais pour un feutre ni pour un
     * soulignement : le feutre couvre alors le blanc de fin de paragraphe, et
     * le trait ne passe que sous la derniere ligne du bloc.
     *
     * Les lignes viennent de la couche texte de pdf.js, deja posee sur la
     * page : aucune requete, aucun calcul de plus. Sur un scan il n'y a pas
     * de couche texte, on garde le bloc entier, ce qui est le comportement
     * d'avant.
     */
    _decouperEnLignes(bloc, index) {
      const lignes = this._lignesDeLaPage(index).filter((l) => {
        const commun = Math.min(l.bas, bloc.bas) - Math.max(l.haut, bloc.haut);
        return commun > (l.bas - l.haut) * 0.5
          && Math.min(l.d, bloc.d) - Math.max(l.g, bloc.g) > 0;
      });
      if (lignes.length < 2) return [bloc];
      // LE BAS d'une ligne ne se lit pas sur la couche texte. Sur le
      // calendrier RH, les boites de pdf.js font 15 px pour des lettres qui
      // en font trente : le trait tombait au milieu des majuscules et rayait
      // le titre au lieu de le souligner. Le HAUT, lui, est juste. Chaque
      // ligne descend donc jusqu'au haut de la suivante, et la derniere
      // jusqu'au bas du bloc, qui vient du PDF et ne ment pas. On ne prend
      // surtout pas un interligne moyen : un titre suivi d'un paragraphe n'a
      // pas deux fois le meme, et la moyenne posait le trait de l'un sur les
      // lettres de l'autre.
      return lignes.map((l, i) => {
        const suivante = lignes[i + 1];
        if (!suivante) return { g: Math.max(l.g, bloc.g), d: Math.min(l.d, bloc.d),
                                haut: l.haut, bas: bloc.bas, kind: bloc.kind };
        const creux = Math.min(4, (suivante.haut - l.haut) * 0.15);
        return { g: Math.max(l.g, bloc.g), d: Math.min(l.d, bloc.d),
                 haut: l.haut, bas: suivante.haut - creux, kind: bloc.kind };
      });
    }

    /** Les lignes de texte d'une page, en pixels, telles qu'elles sont
     *  posees a l'ecran. Mesurees une fois par page et par zoom. */
    _lignesDeLaPage(index) {
      const couche = this._textEls[index];
      if (!couche || couche.dataset.done !== "1") return [];
      this._lignesPx = this._lignesPx || {};
      const garde = this._lignesPx[index];
      if (garde && garde.echelle === this.scale) return garde.lignes;

      const base = couche.getBoundingClientRect();
      const lignes = [];
      for (const span of couche.children) {
        if (!span.textContent || !span.textContent.trim()) continue;
        const boite = span.getBoundingClientRect();
        if (boite.height <= 0 || boite.width <= 0) continue;
        const haut = boite.top - base.top;
        const bas = boite.bottom - base.top;
        const g = boite.left - base.left;
        const d = boite.right - base.left;
        // Deux morceaux appartiennent a la meme ligne s'ils se recouvrent sur
        // plus de la moitie de leur hauteur : un exposant ou une capitale ne
        // fabriquent pas une ligne a eux seuls.
        const ligne = lignes.find((l) => {
          const commun = Math.min(l.bas, bas) - Math.max(l.haut, haut);
          return commun > Math.min(l.bas - l.haut, bas - haut) * 0.5;
        });
        if (ligne) {
          ligne.haut = Math.min(ligne.haut, haut); ligne.bas = Math.max(ligne.bas, bas);
          ligne.g = Math.min(ligne.g, g); ligne.d = Math.max(ligne.d, d);
        } else {
          lignes.push({ haut, bas, g, d });
        }
      }
      lignes.sort((a, b) => a.haut - b.haut);
      this._lignesPx[index] = { echelle: this.scale, lignes };
      return lignes;
    }

    async setPage(n) {
      await this._loadPromise;
      n = Math.max(1, Math.min(this.nPages, parseInt(n, 10) || 1));
      const el = this._pageEls[n - 1];
      if (!el) return;
      this._scrollLock = Date.now();
      this.currentPage = n;
      // peindre la page visee AVANT d'y aller : un saut a la page 113 ne
      // doit pas atterrir sur un canvas blanc
      await this._renderPage(n - 1);
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      this.currentPage = n;
      this.nav.querySelector("input").value = String(n);
    }

    async setHighlights(rects, page) {
      await this._loadPromise;
      const tag = page != null ? Number(page) : this.currentPage;
      this._highlights = (rects || []).map((r) => ({
        ...r, page: r.page != null ? Number(r.page) : tag,
      }));
      this._renderOverlays();
      // Scroll to the first highlight's page + vertical position.
      if (this._highlights.length) {
        const h = this._highlights[0];
        await this._renderPage(Number(h.page) - 1);
        this._renderOverlays();
        this.jumpTo({ page: h.page, y0: h.y0 });
      }
    }

    async jumpTo({ page, y0 }) {
      await this._loadPromise;
      // Peindre la page visee AVANT d'y aller, comme le fait `setPage` : un
      // saut a la page 113 ne doit pas atterrir sur un canvas blanc. Les
      // appelants qui passaient par `setHighlights` le faisaient eux-memes ;
      // celui qui ouvre une section du plan appelle `jumpTo` directement.
      await this._renderPage(Number(page) - 1);
      const el = this._pageEls[page - 1];
      const vp = this._viewports[page - 1];
      if (!el || !vp) return;
      const pageRect = el.getBoundingClientRect();
      const scRect   = this.scroll.getBoundingClientRect();
      let top = this.scroll.scrollTop + (pageRect.top - scRect.top);
      if (Number.isFinite(y0)) {
        top += Math.max(0, (y0 - vp.viewBox[1]) * this.scale - 80);
      }
      this.scroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }

    /** Choisir comment un passage se montre : cadre, surligneur, souligne,
     *  repere de marge, projecteur. */
    setHighlightStyle(nom) {
      const connus = ["cadre", "marqueur", "souligne", "marge", "projecteur"];
      if (!connus.includes(nom)) return;
      connus.forEach((n) => this.host.classList.remove(`hl-${n}`));
      this.hlStyle = nom;
      this.host.classList.add(`hl-${nom}`);
      // Le menu suit, meme quand le style est pose par le code : sinon il
      // annonce « Cadre » devant un projecteur.
      const menu = this.nav.querySelector(".pv-style");
      if (menu && menu.value !== nom) menu.value = nom;
      try { localStorage.setItem("pv:style-surlignage", nom); } catch (_) { /* session */ }
      this._renderOverlays();
    }

    clearHighlights() {
      this._highlights = [];
      this._renderOverlays();
    }

    /* ---------- Designer la source a la main ----------
     * Le modele se trompe d'endroit avant de se tromper de valeur : il lit
     * le bon type de chose au mauvais endroit de la page (le sous-total au
     * lieu du total, la date d'emission au lieu de la date d'effet). Taper
     * la valeur corrige le symptome ; entourer la zone corrige la source,
     * et la valeur se relit depuis la.
     *
     * `enablePick(cb)` arme le mode : le prochain rectangle trace sur une
     * page appelle `cb({page, x0, y0, x1, y1})` en coordonnees PDF, celles
     * du `line_df`, pas des pixels d'ecran. */
    /* ---- Designer une zone, en voyant ce qu'on prend ----
     *
     * `onPick` recoit { page, rects, text, box } : les boites choisies, leur
     * texte dans l'ordre de lecture, et le cadre englobant (utile quand la
     * zone ne contient aucun mot : c'est alors une image a lire autrement).
     *
     * `chargerMots(page)` est fourni par l'app : le lecteur ne connait pas
     * les routes du serveur. Sans lui, le mode retombe sur le cadre simple.
     */
    enablePick(onPick, { label = "Entourez la bonne zone dans la page",
                         champ = "", chargerMots = null } = {}) {
      this.disablePick();
      this._onPick = onPick;
      this._chargerMots = chargerMots;
      this._motsParPage = this._motsParPage || {};
      this._choisis = new Map();          // cle "page:index" -> mot
      this.host.classList.add("pv-picking");

      const hint = document.createElement("div");
      hint.className = "pv-pick-hint";
      hint.innerHTML = `<span class="pv-pick-quoi">${champ ? `« ${champ} »` : label}</span>
        <span class="pv-pick-aide">${champ ? label : ""}</span>
        <div class="apercu-texte" id="pvApercu" contenteditable="plaintext-only"
             spellcheck="false" data-vide="Corrigez la lecture ici"
             title="Ce qui a été lu. Corrigez-le ici si la lecture est fausse."></div>
        <span class="pv-pick-compte" id="pvCompte"></span>
        <button type="button" data-act="recommencer"
                title="Vider la selection sans quitter le mode">Recommencer</button>
        <button type="button" data-act="valider">Valider</button>
        <button type="button" data-act="annuler">Annuler</button>`;
      hint.querySelector('[data-act="annuler"]').addEventListener("click", () => {
        this.disablePick();
        if (this._onPickCancel) this._onPickCancel();
      });
      // On clique douze mots, on se rend compte qu'on a pris la mauvaise
      // ligne. Sans ce bouton il fallait les decliquer un a un, ou tout
      // annuler et rouvrir le mode. « Recommencer » vide la selection et
      // laisse le mode ouvert.
      hint.querySelector('[data-act="recommencer"]').addEventListener("click", () => {
        this._choisis.clear();
        this._dernierCadre = null;
        this._majSelection();
      });
      hint.querySelector('[data-act="valider"]').addEventListener("click", () => this._validerPick());
      this.scroll.insertBefore(hint, this.scroll.firstChild);
      this._pickHint = hint;

      const start = (e) => {
        const idx = this._pageEls.findIndex((el) => el && el.contains(e.target));
        if (idx < 0) return;
        this._montrerMots(idx + 1);

        // Un clic sur un mot l'ajoute ou le retire, un glisse trace un cadre.
        // LE MOT NE SE PREND PAS AU MOUSEDOWN : sa boite couvre toute la
        // surface du texte, donc un glisse commence presque toujours dessus
        // et etait pris pour un clic. On tracait, rien n'apparaissait, et un
        // mot au hasard s'allumait. On attend donc de savoir : au-dela de
        // quatre pixels de deplacement c'est un cadre, en deca c'est un clic.
        const mot = e.target.closest && e.target.closest(".pv-mot");
        e.preventDefault();
        const pageEl = this._pageEls[idx];
        const rect = pageEl.getBoundingClientRect();
        let box = null;
        const origin = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const SEUIL = 4;
        let glisse = false;

        const move = (ev) => {
          const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          if (!glisse) {
            if (Math.abs(x - origin.x) < SEUIL && Math.abs(y - origin.y) < SEUIL) return;
            glisse = true;
            box = document.createElement("div");
            box.className = "pv-pick-box";
            pageEl.appendChild(box);
          }
          box.style.left = `${Math.min(origin.x, x)}px`;
          box.style.top = `${Math.min(origin.y, y)}px`;
          box.style.width = `${Math.abs(x - origin.x)}px`;
          box.style.height = `${Math.abs(y - origin.y)}px`;
          // L'apercu, a chaque mouvement : les mots pris s'allument.
          const pdfBox = this._toPdfBox(idx, origin.x, origin.y, x, y);
          this._apercuMots(idx + 1, pdfBox);
        };
        const end = (ev) => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", end);
          const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          if (box) box.remove();
          if (!glisse) {
            // Reste un clic : le mot sous le curseur bascule.
            if (mot) this._basculerMot(idx + 1, Number(mot.dataset.i));
            return;
          }
          const pdfBox = this._toPdfBox(idx, origin.x, origin.y, x, y);
          this._apercuMots(idx + 1, null);
          if (!pdfBox) return;
          this._dernierCadre = pdfBox;
          const pris = this._motsDansCadre(idx + 1, pdfBox);
          if (!pris.length) {
            // Aucun mot : la zone est une image (scan, tampon, manuscrit).
            // On valide tout de suite, l'app saura qu'il faut la lire
            // autrement.
            const cb = this._onPick;
            this.disablePick();
            if (cb) cb({ page: idx + 1, rects: [], text: "", box: pdfBox });
            return;
          }
          pris.forEach(({ i, mot }) => this._choisis.set(`${idx + 1}:${i}`, mot));
          this._majSelection();
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", end);
      };

      this._pickStart = start;
      this.scroll.addEventListener("mousedown", start);

      // Les mots des pages en vue, montres tout de suite : on selectionne ce
      // qu'on voit, pas ce qu'on devine. Arme APRES le branchement, sinon la
      // garde de `_montrerMots` (qui verifie que le mode est actif) sort
      // avant d'avoir rien fait.
      for (const p of [this.currentPage, this.currentPage + 1, this.currentPage - 1]) {
        if (p >= 1 && p <= this.nPages) this._montrerMots(p);
      }

      // Entree valide, Echap annule : la selection se termine au clavier.
      this._pickClavier = (e) => {
        // Une frappe dans le champ de correction n'est pas un raccourci.
        if (e.target && e.target.id === "pvApercu" && e.key !== "Enter"
            && e.key !== "Escape") return;
        if (e.key === "Enter") { e.preventDefault(); this._validerPick(); }
        if (e.key === "Escape") { this.disablePick(); if (this._onPickCancel) this._onPickCancel(); }
      };
      document.addEventListener("keydown", this._pickClavier);
    }

    async _montrerMots(page) {
      if (!this._chargerMots || !this._pickStart) return;
      const idx = page - 1;
      const pageEl = this._pageEls[idx];
      if (!pageEl || pageEl.querySelector(".pv-mots")) return;
      let mots = this._motsParPage[page];
      if (!mots) {
        try {
          mots = await this._chargerMots(page);
        } catch (_) {
          mots = [];
        }
        this._motsParPage[page] = mots || [];
      }
      if (!this._pickStart) return;               // mode quitte entre-temps
      const vp = this._viewports[idx];
      if (!vp || !mots.length) return;
      const s = this.scale;
      const couche = document.createElement("div");
      couche.className = "pv-mots";
      couche.innerHTML = mots.map((m, i) => {
        const left = (m.x0 - vp.viewBox[0]) * s;
        const top = (m.y0 - vp.viewBox[1]) * s;
        const w = Math.max(2, (m.x1 - m.x0) * s);
        const h = Math.max(2, (m.y1 - m.y0) * s);
        return `<div class="pv-mot" data-i="${i}" title="${(m.text || "").replace(/"/g, "")}"
                 style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;"></div>`;
      }).join("");
      pageEl.appendChild(couche);
    }

    _motsDansCadre(page, box) {
      const mots = this._motsParPage[page] || [];
      const pris = [];
      if (!box) return pris;
      mots.forEach((m, i) => {
        const hauteur = Math.max(1e-6, m.y1 - m.y0);
        const vertical = Math.min(m.y1, box.y1) - Math.max(m.y0, box.y0);
        const horizontal = Math.min(m.x1, box.x1) - Math.max(m.x0, box.x0);
        // Meme regle que le serveur : la ligne doit etre vraiment couverte,
        // le contact horizontal suffit. Un cadre trace court prend quand
        // meme la valeur entiere.
        if (vertical / hauteur >= 0.4 && horizontal > 0) pris.push({ i, mot: m });
      });
      return pris;
    }

    _apercuMots(page, box) {
      const pageEl = this._pageEls[page - 1];
      if (!pageEl) return;
      const couche = pageEl.querySelector(".pv-mots");
      if (!couche) return;
      const pris = new Set(this._motsDansCadre(page, box).map((p) => p.i));
      couche.querySelectorAll(".pv-mot").forEach((el) => {
        el.classList.toggle("apercu", pris.has(Number(el.dataset.i)));
      });
    }

    _basculerMot(page, index) {
      const mots = this._motsParPage[page] || [];
      const mot = mots[index];
      if (!mot) return;
      const cle = `${page}:${index}`;
      if (this._choisis.has(cle)) this._choisis.delete(cle);
      else this._choisis.set(cle, mot);
      this._majSelection();
    }

    _majSelection() {
      for (let i = 0; i < this.nPages; i++) {
        const couche = this._pageEls[i] && this._pageEls[i].querySelector(".pv-mots");
        if (!couche) continue;
        couche.querySelectorAll(".pv-mot").forEach((el) => {
          el.classList.toggle("on", this._choisis.has(`${i + 1}:${el.dataset.i}`));
        });
      }
      const apercu = document.getElementById("pvApercu");
      const compte = document.getElementById("pvCompte");
      const barre = this.scroll.querySelector(".pv-pick-hint");
      const texte = this._texteSelection();
      const n = this._choisis.size;
      // Le champ est REECRIT a chaque changement de selection : ce qu'on
      // vient d'ajouter doit s'y voir. Une correction tapee avant d'ajouter
      // un mot est donc perdue, et c'est le moindre mal : garder l'ancien
      // texte apres avoir clique un mot de plus serait incomprehensible.
      if (apercu && apercu.textContent !== texte) apercu.textContent = texte;
      this._luParLaMachine = texte;
      if (compte) compte.textContent = n ? `${n} mot${n > 1 ? "s" : ""}` : "";
      // Des qu'on a choisi quelque chose, la consigne cede la place a ce
      // qu'on a pris : c'est ce qu'on relit avant de valider. Elle etait
      // affichee en entier a cote d'un apercu coupe a trois mots.
      if (barre) barre.classList.toggle("a-choisi", n > 0);
    }

    /** Le texte des mots choisis, dans l'ordre de lecture. */
    _texteSelection() {
      const mots = [...this._choisis.values()];
      if (!mots.length) return "";
      const hauteur = mots.reduce((a, m) => a + (m.y1 - m.y0), 0) / mots.length;
      mots.sort((a, b) => {
        const memeLigne = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < hauteur * 0.6;
        return memeLigne ? a.x0 - b.x0 : a.y0 - b.y0;
      });
      return mots.map((m) => m.text).join(" ").replace(/\s+/g, " ").trim();
    }

    _validerPick() {
      const mots = [...this._choisis.values()];
      const cb = this._onPick;
      const lu = this._texteSelection();
      // Ce qui part est ce que la personne a SOUS LES YEUX, corrections
      // comprises : une lecture d'image se trompe, et la corriger au moment
      // ou on la voit coute une frappe. `lu` suit, c'est ce que la machine
      // avait lu : la difference entre les deux est le signal qui dit ou la
      // lecture se trompe.
      const champ = document.getElementById("pvApercu");
      const tape = champ ? champ.textContent.replace(/\s+/g, " ").trim() : "";
      const texte = tape || lu;
      const page = Number((([...this._choisis.keys()][0] || "1:0").split(":"))[0]);
      const box = this._dernierCadre;
      const rects = mots.map((m) => ({ page, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 }));
      this.disablePick();
      if (cb) cb({ page, rects, text: texte, lu, box: rects.length ? null : box });
    }

    disablePick() {
      if (this._pickStart) this.scroll.removeEventListener("mousedown", this._pickStart);
      if (this._pickClavier) document.removeEventListener("keydown", this._pickClavier);
      if (this._pickHint) this._pickHint.remove();
      this.host.querySelectorAll(".pv-pick-box").forEach((el) => el.remove());
      this.host.querySelectorAll(".pv-mots").forEach((el) => el.remove());
      this._pickStart = null;
      this._pickClavier = null;
      this._pickHint = null;
      this._onPick = null;
      this._choisis = new Map();
      this.host.classList.remove("pv-picking");
    }

    /** Ecran -> PDF. Le backend raisonne en points PDF (ceux du line_df),
     *  jamais en pixels : le zoom du lecteur ne doit pas changer la zone
     *  qu'il a designee. */
    _toPdfBox(index, ax, ay, bx, by) {
      const vp = this._viewports[index];
      if (!vp) return null;
      const s = this.scale;
      const x0 = Math.min(ax, bx) / s + vp.viewBox[0];
      const x1 = Math.max(ax, bx) / s + vp.viewBox[0];
      const y0 = Math.min(ay, by) / s + vp.viewBox[1];
      const y1 = Math.max(ay, by) / s + vp.viewBox[1];
      if (x1 - x0 < 2 || y1 - y0 < 2) return null;
      return { page: index + 1, x0, y0, x1, y1 };
    }
  }

  /** Les rectangles a surligner pour une citation.
   *
   * Le backend rend `boxes`, une boite par ligne citee, les lignes empilees
   * deja fondues en un bloc. C'est ce qu'il faut peindre : dans un tableau,
   * l'enveloppe unique (`bbox`) couvre des cellules qu'on ne cite pas, et le
   * lecteur croit que la reponse s'appuie dessus. `bbox` reste le repli pour
   * les reponses d'avant ce changement, et pour les appels qui ne rendent
   * qu'une enveloppe.
   */
  PdfViewer.rectsFromCitation = function (cite) {
    if (!cite) return [];
    const boites = Array.isArray(cite.boxes) ? cite.boxes : [];
    const utiles = boites.filter((b) => b && b.x0 != null);
    if (utiles.length) {
      return utiles.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, kind: "answer" }));
    }
    // Repli : l'enveloppe. Elle ne vaut que pour une citation d'un seul
    // tenant ; des que la reponse s'appuie sur plusieurs morceaux separes,
    // elle couvre aussi ce qui les separe. C'est pourquoi le serveur rend
    // `boxes`, calcule plage par plage, et pourquoi ce repli ne sert que les
    // reponses enregistrees avant qu'il n'existe.
    const b = cite.bbox;
    return (b && b.x0 != null)
      ? [{ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, kind: "answer" }] : [];
  };

  window.PdfViewer = PdfViewer;
})();
