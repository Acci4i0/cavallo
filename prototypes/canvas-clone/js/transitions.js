/**
 * transitions.js — §F dello spec. Home ⇄ Info.
 *
 * Misurato: /info NON sostituisce la home. È un overlay position:fixed, z-index 9,
 * montato SOPRA il canvas che resta vivo e continua a girare sotto. Il passaggio
 * percepito è il crossfade dei layer (§E1: ease, 396 ms misurati / 400 dichiarati),
 * non una transizione di rotta.
 *
 * Le regole ::view-transition-*(work-page) a 0.35s ease-out riguardano solo
 * /works/*, fuori dallo scope della home.
 */

import { state } from './grid.js';

let onOpenChange = () => {};

export function initTransitions({ onChange } = {}) {
  onOpenChange = onChange ?? (() => {});
  const info = document.querySelector('[data-info]');
  const linkInfo = document.querySelector('.navbar__link_info');
  const linkWorks = document.querySelector('.navbar__link_works');
  if (!info || !linkInfo || !linkWorks) return {};

  const setInfo = (open) => {
    // Il canvas NON viene smontato: resta vivo sotto l'overlay (§F)
    info.classList.toggle('active', open);
    linkInfo.classList.toggle('active', open);
    linkWorks.classList.toggle('active', !open);
    document.querySelector('.main-wrapper')?.classList.toggle('behind', open);
    onOpenChange(open);
  };

  linkInfo.addEventListener('click', (e) => { e.preventDefault(); setInfo(true); });
  linkWorks.addEventListener('click', (e) => { e.preventDefault(); setInfo(false); });

  setInfo(false);
  return { setInfo };
}

export { state };
