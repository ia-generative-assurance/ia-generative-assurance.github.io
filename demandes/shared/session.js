/* Tiny session helper shared across tool fronts.
 * Stores the last uploaded PDF (as base64 in sessionStorage) + the last
 * question + arbitrary per-tool state, so the user can navigate between
 * tools without having to re-upload.
 */
(function (global) {
  const KEY = "apps.session";

  function _get() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function _set(o) { sessionStorage.setItem(KEY, JSON.stringify(o)); }

  const Session = {
    get: _get,
    patch(partial) {
      const s = _get();
      Object.assign(s, partial);
      _set(s);
      return s;
    },
    clear() { sessionStorage.removeItem(KEY); },

    /* Qui travaille, pour signer une decision.
     *
     * Le parc n'a pas d'authentification : ce nom sert a marquer QUI a
     * tranche, pas a autoriser quoi que ce soit. Il vit dans le stockage du
     * navigateur, se pose par l'ecran des parametres, et vaut la chaine vide
     * tant que personne ne l'a pose. Les adaptateurs acceptent tous un auteur
     * vide.
     *
     * Cette fonction existe parce que deux apps l'appelaient DEJA sans
     * qu'elle existe : `Session.qui()` levait un TypeError, avale par le
     * try/catch qui entoure le geste, et le bouton ne faisait rien sans rien
     * dire. Une decision cliquee ne s'enregistrait pas. */
    qui() {
      try { return localStorage.getItem("hub_auteur") || ""; }
      catch (_) { return ""; }
    },
    poserQui(nom) {
      try { localStorage.setItem("hub_auteur", String(nom || "")); }
      catch (_) { /* stockage refuse : on signe vide */ }
      return Session.qui();
    },

    async setPdfFromBlob(blob, filename) {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      Session.patch({ pdf: { bytes_b64: b64, filename, dataUrl: "data:application/pdf;base64," + b64 } });
      return b64;
    },

    getPdfDataUrl() {
      const s = _get();
      return s.pdf ? s.pdf.dataUrl : null;
    },

    async getPdfBlob() {
      const s = _get();
      if (!s.pdf) return null;
      const bin = atob(s.pdf.bytes_b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: "application/pdf" });
    },
  };

  global.Session = Session;
})(window);
