(function () {
  "use strict";

  var q = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var qa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function money(cents) {
    if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
      return window.Shopify.formatMoney(cents);
    }
    return "$" + (cents / 100).toFixed(2);
  }

  function toast(msg) {
    var t = q("[data-facelift-toast]");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("data-facelift-toast", "");
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      t.classList.remove("is-shown");
    }, 2600);
  }

  /* ---- variant selection + price sync --------------------------------- */
  function optionValue(btn) {
    return btn.getAttribute("data-value") || btn.textContent.trim();
  }

  function syncForm(form, variant) {
    var priceEl = q("[data-price-current]", form);
    var compareEl = q("[data-price-compare]", form);
    var noteEl = q("[data-price-note]", form);
    var addBtn = q("[data-add-button]", form);
    var labelEl = q("[data-add-label]", form);
    var qtyEl = q("[data-quantity-input]", form);
    var qtyVal = q("[data-qty-val]", form);

    if (!variant) return;

    if (priceEl) {
      priceEl.textContent = money(variant.price);
      priceEl.setAttribute("data-price", variant.price);
    }
    if (compareEl) {
      compareEl.style.display =
        variant.compareAt > 0 && variant.compareAt > variant.price ? "" : "none";
      if (variant.compareAt > 0) compareEl.textContent = money(variant.compareAt);
    }
    if (noteEl) {
      if (variant.compareAt > variant.price && variant.compareAt > 0) {
        var pct = Math.round(
          ((variant.compareAt - variant.price) / variant.compareAt) * 100
        );
        noteEl.textContent = "Save " + pct + "%";
        noteEl.style.display = "";
      } else {
        noteEl.style.display = "none";
      }
    }
    if (addBtn) {
      addBtn.disabled = variant.soldout;
      if (labelEl) {
        labelEl.textContent = variant.soldout
          ? "Sold out"
          : "Add to bag — " + money(variant.price);
      }
    }
    if (qtyEl && qtyVal) {
      qtyEl.value = qtyVal.textContent;
    }
  }

  function currentVariantId(form) {
    var radio = q('input[name="id"]:checked', form);
    return radio ? radio.value : null;
  }

  function variantById(form, id) {
    var radio = q('input[name="id"][value="' + id + '"]', form);
    if (!radio) return null;
    return {
      id: id,
      price: parseInt(radio.getAttribute("data-price"), 10) || 0,
      compareAt: parseInt(radio.getAttribute("data-compare-at"), 10) || 0,
      soldout: radio.getAttribute("data-soldout") === "true",
    };
  }

  function findVariant(form, values) {
    var radios = qa('input[type="radio"][name="id"]', form);
    for (var i = 0; i < radios.length; i++) {
      var opts = radios[i].getAttribute("data-options") || "[]";
      var matches = true;
      try {
        opts = JSON.parse(opts);
      } catch (e) {
        matches = false;
      }
      if (!matches) continue;
      for (var j = 0; j < values.length; j++) {
        if (opts[j] !== values[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return variantById(form, radios[i].value);
    }
    return null;
  }

  function initProductForm(form) {
    if (form.__faceliftInit) return;
    form.__faceliftInit = true;

    qa("[data-variant-options]", form).forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.getAttribute("aria-disabled") === "true") return;
        var groups = qa("[data-option]", form);
        var values = [];
        groups.forEach(function (group) {
          var clicked = btn.closest("[data-option]");
          var chosen = clicked === group ? btn : q('[aria-pressed="true"]', group);
          if (!chosen) return;
          qa("[data-variant-options]", group).forEach(function (other) {
            other.setAttribute("aria-pressed", String(other === chosen));
          });
          var val = optionValue(chosen);
          values.push(val);
          var out = q("[data-selected]", group);
          if (out) out.textContent = val;
        });
        var v = findVariant(form, values);
        if (v) {
          var radio = q('input[name="id"][value="' + v.id + '"]', form);
          if (radio && !radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        syncForm(form, v || variantById(form, currentVariantId(form)));
      });
    });

    qa('input[type="radio"][name="id"]', form).forEach(function (radio) {
      radio.addEventListener("change", function () {
        syncForm(form, variantById(form, radio.value));
      });
    });

    qa('[data-step]', form).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var val = q("[data-qty-val]", form);
        if (!val) return;
        var n = Math.max(1, (parseInt(val.textContent, 10) || 1) + parseInt(btn.getAttribute("data-step"), 10));
        val.textContent = n;
      });
    });
  }

  /* ---- gallery --------------------------------------------------------- */
  function initGallery(root) {
    var container = q("[data-media-container]", root);
    var thumbs = qa(".thumb[data-src]", root);
    if (!container || !thumbs.length) return;
    thumbs.forEach(function (thumb) {
      thumb.addEventListener("click", function () {
        thumbs.forEach(function (t) {
          t.setAttribute("aria-selected", String(t === thumb));
        });
        var type = thumb.getAttribute("data-media-type");
        var alt = thumb.getAttribute("data-alt") || "";
        if (type === "video" && thumb.getAttribute("data-video-src")) {
          container.innerHTML =
            '<div class="gallery__video"><video controls muted playsinline style="width:100%;height:100%;object-fit:cover"><source src="' +
            thumb.getAttribute("data-video-src") +
            '" type="video/mp4"></video></div>';
        } else {
          container.innerHTML =
            '<img src="' + thumb.getAttribute("data-src") + '" alt="' + alt + '" style="width:100%;height:100%;object-fit:cover">';
        }
      });
    });
  }

  /* ---- accordions ------------------------------------------------------ */
  function initAccordions(scope) {
    qa(".accordion__trigger", scope || document).forEach(function (trigger) {
      if (trigger.__faceliftInit) return;
      trigger.__faceliftInit = true;
      trigger.addEventListener("click", function () {
        var item = trigger.closest(".accordion__item");
        if (!item) return;
        var open = item.getAttribute("data-open") === "true";
        item.setAttribute("data-open", String(!open));
      });
    });
  }

  /* ---- cart count + quick add ----------------------------------------- */
  function updateCount(n) {
    qa("[data-cart-count]").forEach(function (el) {
      el.textContent = n;
      el.style.display = n ? "" : "none";
    });
  }

  function openDrawer() {
    var drawer = q("[data-cart-drawer]");
    if (!drawer) return;
    drawer.classList.add("is-open");
    var veil = q("[data-cart-drawer-veil]");
    if (veil) veil.classList.add("is-open");
  }

  function closeDrawer() {
    qa("[data-cart-drawer], [data-cart-drawer-veil]").forEach(function (el) {
      el.classList.remove("is-open");
    });
  }

  function initCart() {
    qa("[data-nav-open]").forEach(function (btn) {
      btn.addEventListener("click", openDrawer);
    });
    qa("[data-nav-close]").forEach(function (btn) {
      btn.addEventListener("click", closeDrawer);
    });

    qa('form[action="/cart/add"] button.quick-add').forEach(function (btn) {
      var form = btn.closest("form");
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(form);
        fetch("/cart/add.js", { method: "POST", body: data })
          .then(function (res) {
            if (!res.ok) return res.text().then(function () { throw new Error("add failed"); });
            return res.json();
          })
          .then(function (cart) {
            updateCount(cart.item_count || 0);
            openDrawer();
            toast("Added to bag");
          })
          .catch(function () {
            toast("Sorry, that could not be added");
          });
      });
    });
  }

  function init() {
    qa("[data-product-form]").forEach(initProductForm);
    qa("[data-media-container]").forEach(function (el) {
      initGallery(el.closest(".pdp__media") || el.parentElement);
    });
    initAccordions(document);
    initCart();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
