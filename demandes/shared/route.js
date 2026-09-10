/* L'adresse dit ou on en est.
 *
 * Pourquoi. Le portail ouvre les apps dans un cadre, et jusqu'ici l'adresse
 * ne portait que le nom de l'app. Consequence a l'usage : on cherchait
 * « fraude », on ouvrait une app, on revenait, et on retombait sur l'accueil
 * vide, recherche perdue. Idem dans une app : le document ouvert, l'onglet
 * choisi, le fil de conversation ne survivaient ni au retour arriere ni a un
 * rechargement, et aucun ecran ne se partageait par lien.
 *
 * Le bouton retour du navigateur est la premiere chose qu'on essaie. Il doit
 * defaire la derniere etape, pas la seance entiere.
 *
 * Une app declare ce qu'elle veut voir dans l'adresse, et ce qu'elle fait
 * quand l'adresse change :
 *
 *   Route.declare({
 *     principal: "doc",               // la cle qui vaut un segment de chemin
 *     lire: () => ({ doc: state.opened, onglet: state.onglet }),
 *     appliquer: (etat) => { ... },   // etat = objet plat, valeurs texte
 *   });
 *   Route.pousser();     // une etape franchie : une entree d'historique
 *   Route.remplacer();   // un detail : on remplace la derniere entree
 *
 * Le fragment s'ecrit `#doc=cg-habitation&onglet=texte`. Les valeurs vides
 * ne sont jamais ecrites : une adresse ne porte que ce qui la distingue de
 * l'ecran d'accueil.
 *
 * Dans le portail, chaque changement est aussi annonce au parent, qui le
 * recopie dans SA barre d'adresse. L'app pousse, le portail remplace : sans
 * cette regle, un seul geste creerait deux entrees d'historique et il
 * faudrait appuyer deux fois sur retour.
 *
 * `principal` nomme l'objet dont parle l'ecran : le document relu, le fil
 * ouvert. Le portail en fait un segment de chemin,
 * `/attestations/attestation_04_flotte`, et laisse le reste en parametres.
 * C'est ce qui separe une adresse qu'on lit d'une adresse qu'on subit. Sa
 * valeur doit donc etre un identifiant COURT et propre : pas de point (le
 * serveur y verrait un fichier), pas de barre oblique. L'app rend un nom
 * abrege et le retrouve elle-meme dans `appliquer`.
 */
(function (global) {
  const dansLePortail = (function () {
    try { return window.self !== window.top; } catch (_) { return true; }
  })();

  /* PLUSIEURS parties d'une app declarent leur bout d'adresse.
   *
   * Le composant de relecture nomme le document ouvert, la barre d'onglets
   * nomme la vue affichee. Tant qu'une seule declaration etait gardee, la
   * seconde effacait la premiere : la barre montee en dernier faisait
   * disparaitre le document de l'adresse. Les declarations s'additionnent
   * donc, `lire` fusionne ce que chacune rend, `appliquer` les appelle
   * toutes, et le premier `principal` declare gagne le segment de chemin. */
  const parties = [];
  const cfg = {
    get principal() {
      const p = parties.find((c) => c.principal);
      return p ? p.principal : "";
    },
    lire() {
      const out = {};
      for (const c of parties) Object.assign(out, (c.lire ? c.lire() : null) || {});
      return out;
    },
    appliquer(etat) {
      for (const c of parties) if (c.appliquer) c.appliquer(etat);
    },
  };
  let declaree = false;  // une app a-t-elle vraiment nomme ses etapes ?
  let dernier = null;    // le fragment qu'on vient d'ecrire soi-meme
  let applique = false;  // vrai pendant `appliquer` : on n'ecrit rien alors

  function encoder(etat) {
    const p = new URLSearchParams();
    // L'OBJET D'ABORD, le reste ensuite. `#vue=parametres&doc=nist-csf` se lit
    // a l'envers : on annonce un reglage puis on decouvre de quoi il parle.
    // L'ordre suivait celui des declarations, donc celui du montage des
    // scripts, ce qui n'est le sens de rien. La cle principale nomme l'objet
    // dont l'ecran parle : elle passe devant, comme dans le chemin que le
    // portail en fait (`/doc_extract/nist-csf?vue=parametres`).
    const cles = Object.keys(etat || {});
    const premier = cfg.principal;
    if (premier && cles.includes(premier)) {
      cles.splice(cles.indexOf(premier), 1);
      cles.unshift(premier);
    }
    for (const cle of cles) {
      if (cle === "_p") continue;   // nom de transport, jamais une adresse
      const v = etat[cle];
      if (v === null || v === undefined || v === "" || v === false) continue;
      p.set(cle, String(v));
    }
    return p.toString();
  }

  function decoder(fragment) {
    const brut = String(fragment || "").replace(/^#/, "").replace(/^\?/, "");
    const out = {};
    for (const [cle, v] of new URLSearchParams(brut)) out[cle] = v;
    // `_p` est le segment de chemin que le portail nous transmet sans savoir
    // comment on l'appelle. On lui rend son nom.
    if (out._p !== undefined) {
      if (cfg.principal) out[cfg.principal] = out._p;
      delete out._p;
    }
    return out;
  }

  /** Le fragment demande par l'etat courant de l'app.
   *
   * `#doc=x&champ=y`, et non `#?doc=x` : le point d'interrogation ne servait
   * a rien. Tout ce qui suit le croisillon est deja le fragment, le « ? » n'y
   * est qu'un caractere de plus, et il se lit comme une faute de frappe dans
   * une adresse qu'on colle dans un ticket. Il venait d'une symetrie avec
   * l'adresse du portail, `/factures?doc=x`, ou la, le « ? » est requis.
   *
   * Les adresses deja partagees continuent de marcher : `decoder` retire un
   * « ? » de tete s'il en trouve un, et `prevenirLePortail` aussi. */
  function fragmentCourant() {
    const s = encoder(declaree ? cfg.lire() : {});
    return s ? "#" + s : "";
  }

  function ecrire(remplacer) {
    if (!declaree || applique) return;
    const frag = fragmentCourant();
    if (frag === dernier) return;
    dernier = frag;
    // `location.hash = ""` laisse un « # » orphelin dans la barre : on passe
    // par l'URL complete pour revenir a une adresse propre.
    const url = location.pathname + location.search + frag;
    try {
      if (remplacer) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
    } catch (_) { location.hash = frag; }
    prevenirLePortail(frag);
  }

  function prevenirLePortail(frag) {
    if (!dansLePortail) return;
    const params = new URLSearchParams(frag.replace(/^#\??/, ""));
    const cle = cfg.principal;
    const chemin = cle ? (params.get(cle) || "") : "";
    if (cle) params.delete(cle);
    try {
      parent.postMessage({
        type: "hub:route",
        etat: params.toString(),   // ce qui reste va en parametres
        chemin: chemin,            // et l'objet principal, dans le chemin
      }, location.origin);
    } catch (_) { /* portail d'une autre origine : tant pis pour la barre */ }
  }

  /** L'adresse a change sans nous : on remet l'app dans l'etat demande. */
  function relire() {
    if (!declaree) return;
    const frag = location.hash || "";
    if (frag === dernier) return;
    dernier = frag;
    applique = true;
    try { cfg.appliquer(decoder(frag)); }
    finally { applique = false; }
    prevenirLePortail(frag);
  }

  /** Un exemple, par son nom : six apps faisaient le meme appel. */
  async function chargerExemple(nom) {
    const r = await fetch("/api/_pdf/example", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nom }),
    });
    const out = await r.json();
    return out && out.file_id ? out : null;
  }

  const Route = {
    chargerExemple,
    /** Branche l'app.
     *
     * Une adresse VIDE ne veut pas dire « etat vide » : elle veut dire « la
     * ou l'app demarre d'elle-meme », c'est-a-dire le dernier fil repris, le
     * dernier document ouvert. On n'applique donc rien dans ce cas, on ECRIT
     * ce que l'app vient de restaurer. Appliquer un etat vide au demarrage
     * aurait ferme le fil que l'app venait de rouvrir.
     */
    declare(config) {
      parties.push(config || {});
      if (!declaree) {
        window.addEventListener("popstate", relire);
        window.addEventListener("hashchange", relire);
      }
      declaree = true;
      const depart = location.hash || "";
      dernier = depart;
      if (depart) {
        applique = true;
        try { cfg.appliquer(decoder(depart)); }
        finally { applique = false; }
        prevenirLePortail(depart);
      } else {
        dernier = null;
        ecrire(true);
      }
      return Route;
    },
    /** L'etat lu dans l'adresse, sans rien appliquer. */
    etat() { return decoder(location.hash || ""); },
    /** Aller a une adresse de CETTE app, sans recharger la page.
     *
     * C'est ce qu'un clic dans l'historique demande : l'ecran doit se
     * remettre dans l'etat garde, mais recharger perdrait tout le reste
     * (le document deja parse, le fil en cours). On pousse l'adresse et on
     * la relit, comme si l'utilisateur avait fait « precedent » a l'envers. */
    aller(url) {
      const texte = String(url || "");
      const coupe = texte.indexOf("#");
      const frag = coupe >= 0 ? texte.slice(coupe) : "";
      if (frag === location.hash) return;
      history.pushState(null, "", texte);
      relire();
    },
    // Charger ce fichier ne route rien : encore faut-il qu'une app ait
    // declare ses etapes. Le controle automatique se fiait a la presence du
    // script, et voyait donc « branche » partout, y compris la ou personne
    // n'avait rien nomme.
    estBranchee() { return declaree; },
    pousser() { ecrire(false); },
    remplacer() { ecrire(true); },
    dansLePortail,
  };

  global.Route = Route;
})(window);
