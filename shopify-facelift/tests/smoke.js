const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = "/workspace/shopify-facelift/preview";
const artSrc = fs.readFileSync(path.join(root, "art.js"), "utf8");
const sharedSrc = fs.readFileSync(path.join(root, "shared.js"), "utf8");

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label + (extra ? "  -> " + extra : ""));
  }
};

function load(file, prelude) {
  let html = fs.readFileSync(path.join(root, file), "utf8");
  if (prelude) html = html.replace("<head>", "<head><script>" + prelude + "</script>");
  const errors = [];
  const dom = new JSDOM(html, {
    url: "http://localhost/" + file,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
      .on("jsdomError", (e) => errors.push("jsdomError: " + e.message))
      .on("error", (e) => errors.push("error: " + e)),
  });
  const { window } = dom;
  window.eval(artSrc);
  window.eval(sharedSrc);
  window.document.dispatchEvent(
    new window.Event("DOMContentLoaded", { bubbles: true })
  );
  return { dom, window, document: window.document, errors };
}

const click = (doc, el) =>
  el.dispatchEvent(
    new el.ownerDocument.defaultView.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
  );

/* ---------- index.html ---------- */
console.log("\nindex.html");
{
  const { document: d, errors } = load("index.html");
  ok(errors.length === 0, "no runtime errors", errors.join(" | "));

  const svgs = d.querySelectorAll(".ph svg");
  ok(svgs.length >= 8, "art placeholders rendered", svgs.length + " svgs");
  ok(d.querySelectorAll(".product-card").length === 8, "8 product cards");
  ok(d.querySelector(".hero__title").textContent.length > 10, "hero title set");

  // quick add -> drawer opens, count updates
  const qa = d.querySelector(".quick-add");
  click(d, qa);
  const count = d.querySelector("[data-count]");
  ok(count.textContent === "1", "bag count = 1 after quick add", count.textContent);
  ok(
    d.querySelector(".drawer").classList.contains("is-open"),
    "drawer opens on add"
  );
  ok(d.querySelector(".toast").classList.contains("is-shown"), "toast shown on add");
  const sub = d.querySelector("[data-price-out]").textContent;
  ok(sub === "$68.00", "subtotal = $68.00", sub);

  // add a second item
  const qa2 = d.querySelectorAll(".quick-add")[3];
  click(d, qa2);
  ok(d.querySelector("[data-count]").textContent === "2", "bag count = 2");
  ok(d.querySelector("[data-price-out]").textContent === "$122.00", "subtotal $122.00");

  // remove a line from the drawer
  click(d, d.querySelector("[data-remove]"));
  ok(d.querySelector("[data-count]").textContent === "1", "count back to 1 after remove");

  // quantity stepper on pdp-less page: no .qty without data-qty, skip
  ok(d.querySelector(".footer").textContent.includes("MARLOW"), "footer present");
}

/* ---------- product.html ---------- */
console.log("\nproduct.html");
{
  const { document: d, errors } = load("product.html");
  ok(errors.length === 0, "no runtime errors", errors.join(" | "));

  ok(d.querySelector(".pdp__media .gallery svg"), "gallery art rendered");
  ok(d.querySelectorAll(".thumbs .thumb").length === 4, "4 thumbnails");
  ok(d.querySelectorAll(".trust-badge").length === 3, "3 trust badges");
  ok(d.querySelector("[data-count]").style.display === "none", "bag empty before any add");

  // colour swatch selection
  const swatches = d.querySelectorAll(".swatch");
  click(d, swatches[1]);
  const colourOut = d.querySelector('.variant-group[data-name="Colour"] [data-selected]');
  ok(colourOut.textContent === "Charcoal", "colour selection updates", colourOut.textContent);

  // size chip selection with price variance
  const chips = d.querySelectorAll('.variant-group[data-name="Size"] .chip');
  click(d, chips[3]);
  const sizeOut = d.querySelector('.variant-group[data-name="Size"] [data-selected]');
  ok(sizeOut.textContent === "38 cm", "size selection updates", sizeOut.textContent);

  // qty stepper
  const up = d.querySelector('.qty [data-step="1"]');
  click(d, up);
  click(d, up);
  const qv = d.querySelector(".qty .qty__val");
  ok(qv.textContent === "3", "qty = 3", qv.textContent);

  // click the actual add-to-bag button (not the form wrapper)
  click(d, d.querySelector("button.js-add"));
  ok(d.querySelector("[data-count]").textContent === "3", "count = 3 (qty)", d.querySelector("[data-count]").textContent);
  ok(d.querySelector("[data-price-out]").textContent === "$384.00", "subtotal 3 x 128", d.querySelector("[data-price-out]").textContent);
  const line = d.querySelector(".drawer__line");
  ok(/Colour: Charcoal/.test(line.textContent), "variant captured in line", line.textContent.slice(0, 90));
  ok(/Size: 38 cm/.test(line.textContent), "size captured in line");

  // accordion
  const trigger = d.querySelectorAll(".accordion__trigger")[1];
  click(d, trigger);
  ok(
    trigger.closest(".accordion__item").getAttribute("data-open") === "true",
    "accordion expands"
  );

  // gallery thumbnail swap
  const thumb = d.querySelectorAll(".thumb")[2];
  click(d, thumb);
  ok(thumb.getAttribute("aria-selected") === "true", "thumb selected");
  ok(d.querySelector(".gallery svg"), "gallery re-rendered after thumb click");
}

/* ---------- collection.html ---------- */
console.log("\ncollection.html");
{
  const { document: d, errors } = load("collection.html");
  ok(errors.length === 0, "no runtime errors", errors.join(" | "));
  ok(d.querySelectorAll(".product-card").length === 8, "8 cards");
  ok(d.querySelector(".breadcrumb").textContent.includes("Home"), "breadcrumb present");

  const grid = d.querySelector(".product-grid");
  const sel = d.querySelector(".sort select");
  sel.value = "price-asc";
  sel.dispatchEvent(new d.defaultView.Event("change", { bubbles: true }));
  const prices = Array.from(grid.querySelectorAll(".product-card")).map((c) =>
    parseFloat(c.getAttribute("data-price"))
  );
  ok(
    prices.every((p, i) => i === 0 || prices[i - 1] <= p),
    "sorted price ascending",
    prices.join(",")
  );

  sel.value = "price-desc";
  sel.dispatchEvent(new d.defaultView.Event("change", { bubbles: true }));
  const desc = Array.from(grid.querySelectorAll(".product-card")).map((c) =>
    parseFloat(c.getAttribute("data-price"))
  );
  ok(desc.every((p, i) => i === 0 || desc[i - 1] >= p), "sorted price descending", desc.join(","));

  // filter chips are exclusive within the bar and actually filter
  const chips = d.querySelectorAll(".filter-bar .chip");
  click(d, chips[1]);
  ok(chips[1].getAttribute("aria-pressed") === "true", "ceramics filter activates");
  ok(chips[0].getAttribute("aria-pressed") === "false", "other filters clear");
  const visible = Array.from(d.querySelectorAll(".product-card")).filter((c) => !c.hidden);
  ok(visible.length === 3, "3 ceramics shown", visible.length + " shown");
  ok(
    d.querySelector(".result-count").textContent === "3 of 8 pieces",
    "result count updates",
    d.querySelector(".result-count").textContent
  );
  click(d, chips[0]);
  ok(
    Array.from(d.querySelectorAll(".product-card")).every((c) => !c.hidden),
    "All filter restores every card"
  );
}

/* ---------- cart.html ---------- */
console.log("\ncart.html");
{
  const seed = [
    { id: "a", name: "Aria Stoneware Vase", variant: "Stone · 24 cm", price: 68, qty: 1, art: "vase" },
    { id: "b", name: "Ridge Steel Flask", variant: "500 ml", price: 54, qty: 2, art: "bottle" },
  ];
  const { document: d, errors } = load(
    "cart.html",
    "localStorage.setItem('facelift.cart.v1', " + JSON.stringify(JSON.stringify(seed)) + ");"
  );
  ok(errors.length === 0, "no runtime errors", errors.join(" | "));

  ok(d.querySelectorAll(".cart-line").length === 2, "2 cart lines rendered");
  ok(d.querySelector(".cart-empty").hidden, "empty state hidden when bag has lines");

  const total = d.querySelector(".summary__row--total [data-price-out]").textContent;
  ok(total === "$176.00", "cart total = $176.00", total);

  const fill = d.querySelector("[data-progress-fill]");
  ok(fill.style.width === "100%", "shipping bar full above $75", fill.style.width);
  ok(
    d.querySelector("[data-progress-label]").textContent.includes("complimentary"),
    "free shipping message shown"
  );

  const stepBtn = d.querySelector('.qty[data-qty="b"] [data-step="1"]');
  click(d, stepBtn);
  ok(d.querySelector('.qty[data-qty="b"] .qty__val').textContent === "3", "qty stepped to 3");
  ok(
    d.querySelector(".summary__row--total [data-price-out]").textContent === "$230.00",
    "total recalculated",
    d.querySelector(".summary__row--total [data-price-out]").textContent
  );

  // remove all lines (nodes are re-rendered on each removal)
  let guard = 0;
  while (d.querySelector("[data-remove]") && guard < 10) {
    click(d, d.querySelector("[data-remove]"));
    guard++;
  }
  ok(!d.querySelector(".cart-empty").hidden, "empty state shown when bag empty");
  ok(d.querySelector(".summary__row--total [data-price-out]").textContent === "$0.00", "total zeroed");
  ok(
    d.querySelector("[data-progress-label]").textContent.includes("away from"),
    "shipping countdown shown below threshold"
  );
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
