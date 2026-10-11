/* ==========================================================================
   shared.js — preview interaction layer.
   Behaviour demonstrated here maps 1:1 to the Shopify snippets in
   ../shopify/snippets/. No framework, ~4KB gzipped, no external requests.
   ========================================================================== */

(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const money = (n) =>
    "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });

  /* ---- localStorage cart ------------------------------------------------ */
  const KEY = "facelift.cart.v1";
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  };
  const write = (lines) => localStorage.setItem(KEY, JSON.stringify(lines));
  let lines = read();

  const icon = {
    close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l12 12M16 4L4 16"/></svg>',
    minus: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 7h9"/></svg>',
    plus: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M7 2.5v9M2.5 7h9"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.5 8h11l-1.1 11.2a1.5 1.5 0 0 1-1.5 1.3H9.1a1.5 1.5 0 0 1-1.5-1.3L6.5 8Z"/><path d="M9.5 8V6.2A2.7 2.7 0 0 1 12.2 3.5h-.4a2.7 2.7 0 0 1 2.7 2.7V8"/></svg>',
  };

  function toast(msg) {
    let t = $(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("is-shown"), 2400);
  }

  /* ---- cart rendering --------------------------------------------------- */
  const subtotal = () => lines.reduce((s, l) => s + l.price * l.qty, 0);
  const count = () => lines.reduce((s, l) => s + l.qty, 0);

  function lineHTML(l) {
    return `<div class="drawer__line" data-id="${l.id}">
      <div class="drawer__line-media ph" data-art="${l.art}"></div>
      <div class="drawer__line-body">
        <a href="product.html">${l.name}</a>
        <span class="drawer__line-variant">${l.variant}</span>
        <span class="drawer__line-variant">${money(l.price)} each</span>
      </div>
      <div class="drawer__line-end">
        <span>${money(l.price * l.qty)}</span>
        <button class="remove-btn" data-remove="${l.id}">Remove</button>
      </div>
    </div>`;
  }

  function renderCart() {
    const body = $(".drawer__lines");
    if (body) {
      body.innerHTML = lines.length
        ? lines.map(lineHTML).join("")
        : '<div class="drawer__empty"><span>Your bag is empty.</span><a class="btn btn--primary" href="collection.html">Shop the collection</a></div>';
      $$(".ph", body).forEach((el) => window.renderArt && window.renderArt([el]));
    }

    const table = $(".cart-lines");
    if (table) {
      table.innerHTML = lines
        .map(
          (l) => `<div class="cart-line" data-id="${l.id}">
            <div class="cart-line__media ph" data-art="${l.art}"></div>
            <div class="cart-line__body">
              <a class="cart-line__title" href="product.html">${l.name}</a>
              <span class="cart-line__variant">${l.variant}</span>
              <div class="cart-line__actions">
                <div class="qty qty--sm" data-qty="${l.id}">
                  <button class="qty__btn" data-step="-1">${icon.minus}</button>
                  <span class="qty__val">${l.qty}</span>
                  <button class="qty__btn" data-step="1">${icon.plus}</button>
                </div>
                <button class="remove-btn" data-remove="${l.id}">Remove</button>
              </div>
            </div>
            <div class="cart-line__end">
              <span class="cart-line__price">${money(l.price * l.qty)}</span>
              <span class="cart-line__variant">${money(l.price)} each</span>
            </div>
          </div>`
        )
        .join("");
      $$(".ph", table).forEach((el) => window.renderArt && window.renderArt([el]));
    }

    $$("[data-count]").forEach((el) => {
      const n = count();
      el.textContent = n;
      el.style.display = n ? "" : "none";
    });

    const s = subtotal();
    $$("[data-price-out]").forEach((el) => (el.textContent = money(s)));

    const FREE = 75;
    const fill = $("[data-progress-fill]");
    if (fill) {
      const pct = Math.min(100, (s / FREE) * 100);
      fill.style.width = pct + "%";
      const label = $("[data-progress-label]");
      if (label) {
        label.textContent =
          s >= FREE
            ? "Your order qualifies for complimentary shipping."
            : "You are " + money(FREE - s) + " away from complimentary shipping.";
      }
      const ship = $("[data-shipping]");
      if (ship) ship.textContent = s >= FREE ? "Complimentary" : "Calculated at checkout";
    }

    const empty = $(".cart-empty");
    if (empty) empty.hidden = lines.length > 0;
  }

  function add(item, qty) {
    qty = qty || 1;
    const found = lines.find((l) => l.id === item.id);
    if (found) found.qty += qty;
    else lines.push(Object.assign({ qty }, item));
    write(lines);
    renderCart();
    openDrawer();
    toast("Added to bag — " + item.name);
  }

  function remove(id) {
    lines = lines.filter((l) => String(l.id) !== String(id));
    write(lines);
    renderCart();
  }

  function step(id, d) {
    const l = lines.find((x) => String(x.id) === String(id));
    if (!l) return;
    l.qty += d;
    if (l.qty < 1) return remove(id);
    write(lines);
    renderCart();
  }

  /* ---- drawer + mobile nav ---------------------------------------------- */
  function openDrawer() {
    const d = $(".drawer"),
      v = $(".drawer-veil");
    if (d) d.classList.add("is-open");
    if (v) v.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function closeOverlays() {
    $$(".is-open").forEach((el) =>
      el.classList.remove("is-open")
    );
    document.body.style.overflow = "";
  }

  /* ---- variant groups --------------------------------------------------- */
  function selectedVariant(group) {
    const on = $('[aria-pressed="true"]', group);
    return on ? on.getAttribute("data-value") : "";
  }

  function bindVariants() {
    $$(".variant-group").forEach((group) => {
      const out = $('[data-selected]', group);
      $$('button[data-value]', group).forEach((btn) => {
        btn.addEventListener("click", () => {
          $$('button[data-value]', group).forEach((b) =>
            b.setAttribute("aria-pressed", "false")
          );
          btn.setAttribute("aria-pressed", "true");
          if (out) out.textContent = btn.getAttribute("data-value");
        });
      });
    });
  }

  function readProductForm(form) {
    const groups = $$(".variant-group", form);
    const variant =
      groups
        .map((g) => g.getAttribute("data-name") + ": " + selectedVariant(g))
        .join(" · ") || "Default";

    let price = 0;
    groups.forEach((g) => {
      const on = g.querySelector('[aria-pressed="true"][data-price]');
      if (on && !price) price = parseFloat(on.getAttribute("data-price"));
    });
    if (!price) {
      const pe = form.querySelector("[data-price]");
      price = pe ? parseFloat(pe.getAttribute("data-price")) : 0;
    }

    return {
      id: form.getAttribute("data-id") || variant,
      name: form.getAttribute("data-name"),
      variant: variant,
      price: price,
      art: form.getAttribute("data-art") || "vase",
    };
  }

  function bindQty() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-step]");
      if (!btn) return;
      const wrap = btn.closest(".qty");
      const val = $(".qty__val", wrap);
      if (wrap.hasAttribute("data-qty")) {
        step(wrap.getAttribute("data-qty"), Number(btn.getAttribute("data-step")));
      } else {
        const n = Math.max(1, (parseInt(val.textContent, 10) || 1) + Number(btn.getAttribute("data-step")));
        val.textContent = n;
        wrap.setAttribute("data-current", n);
      }
    });
  }

  /* ---- global click delegation ------------------------------------------ */
  document.addEventListener("click", (e) => {
    const t = e.target;

    if (t.closest("[data-nav-open]")) return openDrawer();
    if (t.closest("[data-nav-close]")) return closeOverlays();

    const burger = t.closest("[data-burger]");
    if (burger) {
      const nav = $(".nav-mobile");
      if (nav) nav.classList.toggle("is-open");
      document.body.style.overflow = nav && nav.classList.contains("is-open") ? "hidden" : "";
      return;
    }

    const acc = t.closest(".accordion__trigger");
    if (acc) {
      const item = acc.closest(".accordion__item");
      const open = item.getAttribute("data-open") === "true";
      item.setAttribute("data-open", String(!open));
      return;
    }

    const thumb = t.closest(".thumb");
    if (thumb) {
      $$(".thumb", thumb.parentElement).forEach((x) =>
        x.setAttribute("aria-selected", "false")
      );
      thumb.setAttribute("aria-selected", "true");
      const gallery = $(".gallery");
      if (gallery && thumb.getAttribute("data-art")) {
        const ph = document.createElement("div");
        ph.className = "ph";
        ph.setAttribute("data-art", thumb.getAttribute("data-art"));
        ph.style.width = "100%";
        ph.style.height = "100%";
        gallery.replaceChildren(ph);
        window.renderArt && window.renderArt([ph]);
      }
      return;
    }

    if (t.closest("[data-remove]"))
      return remove(t.closest("[data-remove]").getAttribute("data-remove"));

    const qa = t.closest(".quick-add");
    if (qa) {
      e.preventDefault();
      return add({
        id: qa.getAttribute("data-id"),
        name: qa.getAttribute("data-name"),
        variant: qa.getAttribute("data-variant") || "Default",
        price: parseFloat(qa.getAttribute("data-price")),
        art: qa.getAttribute("data-art"),
      });
    }

    const addBtn = t.closest("button.js-add, a.js-add");
    if (addBtn) {
      e.preventDefault();
      const form = addBtn.closest("form.js-add") || addBtn;
      const qty =
        Number($(".qty[data-current]", form).getAttribute("data-current")) || 1;
      return add(readProductForm(form), qty);
    }
  });

  /* ---- sorting ---------------------------------------------------------- */
  function bindSort() {
    const sel = $(".sort select");
    if (!sel) return;
    sel.addEventListener("change", () => {
      const grid = $(".product-grid");
      const items = $$(".product-card", grid);
      items.sort((a, b) => {
        const pa = parseFloat(a.getAttribute("data-price"));
        const pb = parseFloat(b.getAttribute("data-price"));
        switch (sel.value) {
          case "price-asc":
            return pa - pb;
          case "price-desc":
            return pb - pa;
          case "name-asc":
            return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
          default:
            return items.indexOf(a) - items.indexOf(b);
        }
      });
      items.forEach((i) => grid.appendChild(i));
    });
  }

  /* ---- collection filtering --------------------------------------------- */
  function bindFilters() {
    const bar = $(".filter-bar");
    if (!bar) return;
    const chips = $$("button[data-filter]", bar);
    const grid = $(".product-grid");
    if (!grid || !chips.length) return;
    const cards = $$(".product-card", grid);
    const total = cards.length;
    const countEl = $(".result-count");

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
        const f = chip.getAttribute("data-filter");
        let shown = 0;
        cards.forEach((card) => {
          const match = f === "all" || card.getAttribute("data-collection") === f;
          card.hidden = !match;
          if (match) shown++;
        });
        if (countEl) countEl.textContent = shown + " of " + total + " pieces";
      });
    });
  }

  /* ---- reveal on scroll ------------------------------------------------- */
  function bindReveal() {
    const els = $$("[data-reveal]");
    if (!els.length || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  /* ---- boot ------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    bindVariants();
    bindQty();
    bindSort();
    bindFilters();
    bindReveal();
    renderCart();
  });
})();
