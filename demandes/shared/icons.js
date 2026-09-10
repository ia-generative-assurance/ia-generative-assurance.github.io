/* Le jeu d'icones des apps : un trait, jamais un caractere.
 *
 * Pourquoi ce fichier. Les ecrans melangeaient deux familles : des SVG a
 * trait sur la page d'accueil, et des GLYPHES DE TEXTE partout ailleurs
 * (« × », « ☰ », « ↻ », « ⚠️ », « 📎 »). Un glyphe de texte n'est pas une
 * icone : sa graisse ne suit pas celle de l'interface, sa taille depend de
 * la police installee, il ne s'aligne pas sur la ligne de base des voisins,
 * et il change de dessin d'un poste a l'autre. Le « ✕ » de fermeture etait
 * fin sur un Mac et gras sur Windows ; l'emoji « ⚠️ » arrivait en couleur au
 * milieu d'un texte gris.
 *
 * Grammaire, la meme que les cartes de l'accueil : boite 24x24, trait de 2,
 * extremites et jointures arrondies, `currentColor`. Une icone prend donc la
 * couleur de son bouton, sans regle supplementaire, et suit le theme.
 *
 * Usage :
 *   bouton.innerHTML = Icones.svg("fermer");          // 16 px par defaut
 *   bouton.innerHTML = Icones.svg("plan", 18);
 *   '<button>' + Icones.svg("recommencer") + ' nouvelle situation</button>'
 */
"use strict";

(function () {
  // Chaque entree est le CONTENU du <svg>, jamais la balise : la taille et
  // les attributs communs sont poses au montage, une seule fois.
  const TRACES = {
    // Fermer un panneau, retirer un element.
    fermer: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    // Afficher ou masquer la colonne de gauche (plan, corpus).
    plan: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    // Fermer ou rouvrir une colonne de GAUCHE. Le trait du panneau est a
    // gauche (x=9), comme la colonne dont on parle, et la fleche montre ou
    // elle part. Les deux icones ci-dessous ont leur trait a droite (x=15) :
    // elles disent une colonne de droite, et les prendre pour une colonne de
    // gauche dessine le contraire de ce qui va se passer.
    fermer_gauche: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'
                   + '<path d="m17 9-3 3 3 3"/>',
    ouvrir_gauche: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'
                   + '<path d="m14 9 3 3-3 3"/>',
    // Replier le panneau vers la gauche, le deplier vers la droite.
    replier: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'
             + '<path d="m11 9-3 3 3 3"/>',
    deplier: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'
             + '<path d="m8 9 3 3-3 3"/>',
    // Repartir de zero, revenir au remplissage automatique.
    recommencer: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    // Un avertissement dans le fil de la conversation.
    alerte: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'
            + '<path d="M12 9v4"/><path d="M12 17h.01"/>',
    // Le fichier joint a la conversation.
    trombone: '<path d="M21.4 11.1 12.2 20.3a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>',
    // Un document, quand il faut nommer la source d'une reponse.
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
              + '<path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    // Ajuster la page a la largeur du cadre.
    ajuster: '<path d="M3 8V6a2 2 0 0 1 2-2h2"/><path d="M17 4h2a2 2 0 0 1 2 2v2"/>'
             + '<path d="M21 16v2a2 2 0 0 1-2 2h-2"/><path d="M7 20H5a2 2 0 0 1-2-2v-2"/>'
             + '<path d="M8 12h8"/><path d="m11 9-3 3 3 3"/><path d="m13 9 3 3-3 3"/>',
    // Ce qui est fait, ce qui est valide.
    coche: '<path d="M20 6 9 17l-5-5"/>',
    // Le chevron des sections repliables.
    chevronBas: '<path d="m6 9 6 6 6-6"/>',
    chevronDroite: '<path d="m9 6 6 6-6 6"/>',
    // La marque du rail : trois couches, le document et ses lectures.
    marque: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  };

  /** Le SVG d'une icone, pret a poser dans un innerHTML.
   *
   * `taille` est en pixels et vaut 16 par defaut : la taille d'un glyphe
   * dans un bouton de barre. Un nom inconnu rend une chaine vide plutot que
   * de lever : une icone manquante ne doit jamais casser un ecran.
   */
  function svg(nom, taille) {
    const trace = TRACES[nom];
    if (!trace) return "";
    const t = Number(taille) || 16;
    return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t + '"'
      + ' fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true" focusable="false">' + trace + "</svg>";
  }

  window.Icones = { svg, TRACES };
})();
