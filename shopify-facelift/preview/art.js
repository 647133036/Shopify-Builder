/* ==========================================================================
   art.js — self-contained SVG art placeholders for the preview only.
   Swap any data-art slot for a real product photo without layout changes:
   <img class="..." src="photo.jpg" alt="..."> takes the same aspect box.
   ========================================================================== */

(function () {
  const S = (vb, inner) =>
    `<svg class="ph-art" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${inner}</svg>`;

  const shadow = (cx, cy, rx, ry, o) =>
    `<ellipse class="a-sh" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" opacity="${o}"/>`;

  const ART = {
    /* Wide editorial hero — negative space left, object right */
    hero: () =>
      S(
        "0 0 1600 900",
        `<rect class="a-wall" x="0" y="0" width="1600" height="900"/>
         <rect class="a-floor" x="0" y="628" width="1600" height="272"/>
         <path class="a-light" d="M0 0h620v900H0z"/>
         ${shadow(1160, 648, 176, 18, 0.06)}
         <rect class="a-obj" x="1078" y="462" width="164" height="206" rx="82"/>
         <rect class="a-obj" x="1132" y="372" width="56" height="126" rx="28"/>
         <rect class="a-obj-2" x="1120" y="356" width="80" height="18" rx="9"/>
         <path class="a-obj-2" d="M1176 470h40c14 34 22 66 22 100 0 44-16 74-38 88-8 5-16 8-24 9z"/>
         <path class="a-branch" d="M1160 352c-6-58 14-104 44-150M1162 348c22-40 66-64 118-74M1160 352c-10-44-44-72-84-84"/>`
      ),

    /* Vessel — main gallery image */
    vase: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="800" width="800" height="200"/>
         ${shadow(400, 822, 210, 18, 0.07)}
         <rect class="a-obj" x="286" y="396" width="228" height="426" rx="114"/>
         <rect class="a-obj" x="358" y="242" width="84" height="180" rx="42"/>
         <rect class="a-obj-2" x="344" y="224" width="112" height="20" rx="10"/>
         <path class="a-obj-2" d="M414 404h66c16 40 24 78 24 116 0 58-20 96-46 116-10 7-20 12-32 14z"/>`
      ),

    /* Wide variant */
    vase2: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="790" width="800" height="210"/>
         ${shadow(400, 812, 250, 20, 0.07)}
         <rect class="a-obj" x="216" y="516" width="368" height="304" rx="152"/>
         <rect class="a-obj" x="342" y="404" width="116" height="132" rx="58"/>
         <rect class="a-obj-2" x="326" y="388" width="148" height="20" rx="10"/>
         <path class="a-obj-2" d="M452 528h62c18 44 26 88 26 126 0 66-24 108-52 128z"/>`
      ),

    /* Tall thin variant */
    vase3: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="806" width="800" height="194"/>
         ${shadow(400, 828, 150, 16, 0.07)}
         <rect class="a-obj" x="322" y="300" width="156" height="528" rx="78"/>
         <rect class="a-obj-2" x="356" y="272" width="88" height="20" rx="10"/>
         <path class="a-obj-2" d="M404 312h56c12 60 18 120 18 186 0 132-26 218-52 262z"/>
         <rect class="a-line" x="342" y="360" width="116" height="2"/>`
      ),

    /* Folded textile */
    linen: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="820" width="800" height="180"/>
         ${shadow(400, 842, 260, 20, 0.08)}
         <rect class="a-obj-3" x="148" y="664" width="504" height="146" rx="16"/>
         <rect class="a-obj" x="162" y="540" width="486" height="140" rx="16"/>
         <rect class="a-obj-4" x="174" y="418" width="462" height="136" rx="16"/>
         <path class="a-line" d="M162 606h486M148 734h504"/>`
      ),

    /* Matte black leather tote */
    tote: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="800" width="800" height="200"/>
         ${shadow(400, 822, 230, 20, 0.12)}
         <path class="a-obj-dark" d="M300 400c0-64 44-106 100-106s100 42 100 106"/>
         <rect class="a-obj-dark" x="244" y="396" width="312" height="426" rx="14"/>
         <rect class="a-obj-2" x="244" y="396" width="312" height="60" rx="14" opacity="0.5"/>
         <path class="a-line-dark" d="M244 468h312"/>`
      ),

    /* Brushed metal bottle */
    bottle: () =>
      S(
        "0 0 800 1000",
        `<rect class="a-wall" x="0" y="0" width="800" height="1000"/>
         <rect class="a-floor" x="0" y="806" width="800" height="194"/>
         ${shadow(400, 828, 150, 16, 0.08)}
         <rect class="a-obj" x="336" y="322" width="128" height="494" rx="64"/>
         <rect class="a-obj-2" x="366" y="252" width="68" height="82" rx="10"/>
         <rect class="a-hi" x="352" y="392" width="16" height="330" rx="8"/>
         <rect class="a-line" x="336" y="470" width="128" height="2" opacity="0.5"/>`
      ),

    /* Neutral interior detail — plaster wall and oak shelf */
    shelf: () =>
      S(
        "0 0 800 800",
        `<rect class="a-wall-2" x="0" y="0" width="800" height="800"/>
         <path class="a-light" d="M0 0h300v800H0z"/>
         <rect class="a-obj-dark" x="118" y="492" width="564" height="14" rx="4"/>
         <rect class="a-sh-soft" x="118" y="506" width="564" height="10" opacity="0.35"/>
         <rect class="a-obj" x="212" y="404" width="72" height="88" rx="34"/>
         <path class="a-obj-2" d="M256 416h22c8 18 12 34 12 46 0 20-8 34-20 42z"/>
         <path class="a-obj-2" d="M352 452c0-26 26-44 62-44s62 18 62 44v40H352z"/>
         <rect class="a-obj-3" x="352" y="470" width="124" height="22" rx="11" opacity="0.6"/>`
      ),

    /* Neutral interior — bed and plaster wall */
    bed: () =>
      S(
        "0 0 1600 900",
        `<rect class="a-wall-2" x="0" y="0" width="1600" height="900"/>
         <rect class="a-floor" x="0" y="648" width="1600" height="252"/>
         <path class="a-light" d="M0 0h420v900H0z"/>
         ${shadow(760, 700, 520, 22, 0.08)}
         <rect class="a-obj-3" x="228" y="336" width="880" height="216" rx="8"/>
         <rect class="a-obj-4" x="256" y="392" width="200" height="120" rx="26"/>
         <rect class="a-obj-4" x="470" y="392" width="200" height="120" rx="26"/>
         <rect class="a-obj" x="228" y="512" width="880" height="140" rx="10"/>
         <rect class="a-obj-4" x="252" y="512" width="832" height="86" rx="10"/>
         <rect class="a-obj-dark" x="1160" y="556" width="150" height="12" rx="4"/>
         <path class="a-obj-dark" d="M1180 568l-16 96M1290 568l16 96"/>`
      ),
  };

  function paint(el) {
    if (el.querySelector("svg.ph-art")) return;
    const key = el.getAttribute("data-art") || "vase";
    const make = ART[key] || ART.vase;
    el.classList.add("ph");
    // insert, never replace: some slots hold a link or quick-add button
    el.insertAdjacentHTML(
      "afterbegin",
      make() + '<span class="ph__tag">Placeholder</span>'
    );
  }

  function render(nodes) {
    const list =
      Array.isArray(nodes) || nodes instanceof NodeList
        ? nodes
        : document.querySelectorAll("[data-art]");
    Array.from(list).forEach(paint);
  }

  window.renderArt = render;

  render();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render());
  }
})();
