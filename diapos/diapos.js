/* Le pilotage du deck : avancer, reculer, se situer, et faire tenir.

   Trois mecaniques, rien de plus.

   1. La mise a l'echelle. La scene fait 1200 x 675 quoi qu'il arrive, ce qui
      garantit que les schemas gardent la taille a laquelle ils sont dessines.
      C'est l'ecran qui s'adapte a la scene, par un transform: scale.
   2. L'ajustement d'une diapositive. Le decoupage est calcule au build sur des
      hauteurs mesurees, mais une police qui charge en retard ou un bloc deplie
      peuvent depasser. Le corps est alors reduit, jamais coupe.
   3. La navigation. Fleches, espace, Debut, Fin, clic, et le numero dans
      l'adresse pour partager une diapositive precise.
*/
(function () {
  var scene = document.querySelector('.scene');
  var diapos = [].slice.call(document.querySelectorAll('.diapo'));
  if (!scene || !diapos.length) { return; }

  // la scene, en unites : diapos.css porte les memes valeurs
  var cadreL = 1280, cadreH = 720;
  var i = 0;
  var jauge = document.querySelector('.jauge');
  var rang = document.querySelector('.pilote .rang');
  var ou = document.querySelector('.pilote .ou');
  var bPrec = document.querySelector('.pilote .prec');
  var bSuiv = document.querySelector('.pilote .suiv');
  var sommaire = document.querySelector('.sommaire');
  var suivante = scene.getAttribute('data-suivant') || '';
  var precedente = scene.getAttribute('data-precedent') || '';

  // 1. la scene s'adapte a la fenetre, jamais l'inverse.
  //    Le cadre prend la taille reelle de la scene apres mise a l'echelle :
  //    sans cela son encombrement reste celui de 1280 x 720 et la scene passe
  //    sous la barre de pilotage.
  function poserEchelle() {
    var pupitre = document.querySelector('.pupitre');
    var cadre = document.querySelector('.cadre');
    // clientWidth inclut le remplissage : on le retire, sinon la scene le mange
    var cs = getComputedStyle(pupitre);
    var l = pupitre.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = pupitre.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (l <= 0 || h <= 0) { return; }
    var k = Math.min(l / cadreL, h / cadreH);
    scene.style.transform = 'scale(' + k.toFixed(4) + ')';
    cadre.style.width = Math.round(cadreL * k) + 'px';
    cadre.style.height = Math.round(cadreH * k) + 'px';
  }

  // 2. une diapositive qui deborde se reduit, elle ne se coupe pas
  function ajuster(d) {
    var corps = d.querySelector('.diapo-corps');
    var cadre = d.querySelector('.diapo-cadre');
    if (!corps || !cadre) { return; }
    corps.style.transform = 'none';
    var dispo = cadre.clientHeight;
    var haut = corps.scrollHeight;
    if (haut > dispo && haut > 0) {
      var k = Math.max(0.5, dispo / haut);
      corps.style.transform = 'scale(' + k.toFixed(4) + ')';
      corps.setAttribute('data-reduit', k.toFixed(2));
    } else {
      corps.removeAttribute('data-reduit');
    }
  }

  // 3. la navigation
  function montrer(n, pousser) {
    n = Math.max(0, Math.min(diapos.length - 1, n));
    diapos.forEach(function (d, k) { d.classList.toggle('is-on', k === n); });
    i = n;
    ajuster(diapos[i]);
    if (jauge) { jauge.style.width = ((i + 1) / diapos.length * 100).toFixed(2) + '%'; }
    if (rang) { rang.textContent = (i + 1) + ' / ' + diapos.length; }
    if (ou) { ou.textContent = diapos[i].getAttribute('data-ou') || ''; }
    if (bPrec) { bPrec.disabled = (i === 0 && !precedente); }
    if (bSuiv) { bSuiv.disabled = (i === diapos.length - 1 && !suivante); }
    if (sommaire) {
      sommaire.querySelectorAll('button[data-n]').forEach(function (b) {
        b.classList.toggle('is-on', +b.getAttribute('data-n') === i);
      });
    }
    if (pousser !== false) {
      history.replaceState(null, '', '#d' + (i + 1));
    }
  }

  function avancer(pas) {
    if (pas > 0 && i === diapos.length - 1 && suivante) { location.href = suivante; return; }
    if (pas < 0 && i === 0 && precedente) { location.href = precedente + '#fin'; return; }
    montrer(i + pas);
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea')) { return; }
    var k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); avancer(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); avancer(-1); }
    else if (k === 'Home') { e.preventDefault(); montrer(0); }
    else if (k === 'End') { e.preventDefault(); montrer(diapos.length - 1); }
    else if (k === 's' || k === 'S') { e.preventDefault(); basculerSommaire(); }
    else if (k === 'Escape' && sommaire && sommaire.classList.contains('is-on')) { basculerSommaire(); }
  });

  if (bPrec) { bPrec.addEventListener('click', function () { avancer(-1); }); }
  if (bSuiv) { bSuiv.addEventListener('click', function () { avancer(1); }); }

  function basculerSommaire() {
    if (!sommaire) { return; }
    sommaire.classList.toggle('is-on');
  }
  var bSom = document.querySelector('.pilote .sommaire-btn');
  if (bSom) { bSom.addEventListener('click', basculerSommaire); }
  if (sommaire) {
    sommaire.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-n]');
      if (b) { montrer(+b.getAttribute('data-n')); basculerSommaire(); return; }
      if (e.target.closest('.fermer') || e.target === sommaire) { basculerSommaire(); }
    });
  }

  // un depliage (« sous le capot », une reponse d'exercice) change la hauteur
  scene.addEventListener('toggle', function () { ajuster(diapos[i]); }, true);
  window.addEventListener('resize', function () { poserEchelle(); ajuster(diapos[i]); });
  window.addEventListener('load', function () { poserEchelle(); ajuster(diapos[i]); });

  // le numero dans l'adresse : #d12, ou #fin quand on arrive en marche arriere
  var depart = 0;
  if (location.hash === '#fin') { depart = diapos.length - 1; }
  else {
    var m = /^#d(\d+)$/.exec(location.hash);
    if (m) { depart = Math.max(0, Math.min(diapos.length - 1, +m[1] - 1)); }
  }
  poserEchelle();
  montrer(depart, false);
})();
