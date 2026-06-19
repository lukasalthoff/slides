/* Two Lives: interactive perspective engine.
 * Self-contained: reads data/two-lives.json, runs intro → 5 beats → dual endings.
 * No dependency on app.js or Chart.js. */
(function () {
  "use strict";

  const root = document.getElementById("two-lives-app");
  const stage = document.getElementById("tl-stage");
  if (!root || !stage) return;

  const src = root.dataset.src || "data/two-lives.json";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CHARS = ["pieter", "sipho"];
  // Score range used only to render the divergence bars (no numbers shown).
  const MIN_SCORE = -8;
  const MAX_SCORE = 20;

  // -- tiny DOM helper ------------------------------------------------------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    (Array.isArray(children) ? children : children != null ? [children] : [])
      .forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function focusFirst() {
    const target = stage.querySelector("[data-autofocus]") || stage.querySelector("h3, button");
    if (target) {
      target.setAttribute("tabindex", target.tabIndex < 0 ? "-1" : target.getAttribute("tabindex") || "-1");
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function nameWithToken(key) {
    return el("span", { class: "tl-name-wrap" }, [
      el("span", { class: `tl-token tl-token--${key}`, "aria-hidden": "true" }),
      el("span", { class: "tl-name-text", text: data.characters[key].name }),
    ]);
  }

  function accessLabel(opt) {
    if (opt == null || opt.access_pct == null) return null;
    const suffix = data.access_meta?.label || "of South Africans could take this path";
    return `~${opt.access_pct}% ${suffix}`;
  }

  // -- engine state ---------------------------------------------------------
  let data = null;
  let state = null;

  function freshState() {
    return {
      phase: "intro",
      beat: 0,
      scores: { pieter: data.characters.pieter.start, sipho: data.characters.sipho.start },
      reacted: false,
      lastReact: null,
      history: [],
    };
  }

  function bandObjFor(score) {
    for (const b of data.bands) if (score <= b.max) return b;
    return data.bands[data.bands.length - 1];
  }
  function bandFor(score) { return bandObjFor(score).key; }
  function fillPct(score) {
    const pct = ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
    return Math.max(5, Math.min(100, Math.round(pct)));
  }

  // -- render: progress (year ticks) ---------------------------------------
  function renderProgress() {
    const total = data.beats.length;
    const ticks = el("div", { class: "tl-progress", "aria-hidden": "true" });
    for (let i = 0; i < total; i++) {
      let dotCls = "tl-progress__dot";
      if (state.phase === "ending" || i < state.beat) dotCls += " is-done";
      else if (i === state.beat && state.phase === "beat") dotCls += " is-active";
      ticks.appendChild(el("div", { class: "tl-progress__tick" }, [
        el("span", { class: dotCls }),
        el("span", { class: "tl-progress__year", text: data.beats[i].year }),
      ]));
    }
    const label =
      state.phase === "ending"
        ? "Outcome · 2025"
        : state.phase === "beat"
        ? `Decision ${state.beat + 1} of ${total}`
        : "Start";
    return el("div", { class: "tl-progress-row" }, [
      el("p", { class: "tl-progress-label", text: label }),
      ticks,
    ]);
  }

  // -- render: divergence status track -------------------------------------
  function renderStatus() {
    return el("div", { class: "tl-status", "aria-label": "How each man is doing so far" },
      CHARS.map((k) => {
        const b = bandObjFor(state.scores[k]);
        return el("div", { class: `tl-status__row tl-status__row--${k}` }, [
          el("div", { class: "tl-status__head" }, [
            nameWithToken(k),
            el("span", { class: "tl-status__word", text: b.status }),
          ]),
          el("div", { class: "tl-status__track" }, [
            el("span", {
              class: "tl-status__fill",
              style: `width:${fillPct(state.scores[k])}%`,
            }),
          ]),
        ]);
      })
    );
  }

  // -- render: intro --------------------------------------------------------
  function renderIntro() {
    const i = data.intro;
    return el("div", { class: "tl-card tl-card--intro" }, [
      el("p", { class: "tl-kicker", text: i.kicker }),
      el("h3", { class: "tl-card__title", "data-autofocus": "", tabindex: "-1", text: "Meet two South Africans" }),
      el("p", { class: "tl-lede", text: i.lede }),
      el("div", { class: "tl-cast" }, CHARS.map((k) => {
        const c = data.characters[k];
        return el("div", { class: `tl-cast__member tl-cast__member--${k}` }, [
          el("p", { class: "tl-cast__name" }, [nameWithToken(k)]),
          el("p", { class: "tl-cast__tagline", text: c.tagline }),
          el("p", { class: "tl-cast__blurb", text: c.blurb }),
        ]);
      })),
      el("p", { class: "tl-hint", text: "Tip: press 1–4 to choose. After you pick, press → to continue." }),
      el("button", {
        class: "tl-btn tl-btn--primary",
        type: "button",
        onclick: () => { state.phase = "beat"; render(); },
      }, i.start_button),
    ]);
  }

  // -- render: a beat -------------------------------------------------------
  function renderBeat() {
    const beat = data.beats[state.beat];
    const wrap = el("div", { class: "tl-card tl-card--beat" });
    wrap.appendChild(renderStatus());
    wrap.appendChild(el("p", { class: "tl-kicker", text: `${beat.year} · ${beat.title}` }));
    wrap.appendChild(el("h3", { class: "tl-card__title", "data-autofocus": "", tabindex: "-1", text: beat.prompt }));
    wrap.appendChild(el("p", { class: "tl-scene", text: beat.scene }));

    if (!state.reacted) {
      const opts = el("div", { class: "tl-options", role: "group", "aria-label": "Choose what happens next" });
      beat.options.forEach((opt, idx) => {
        opts.appendChild(el("button", {
          class: "tl-option",
          type: "button",
          onclick: () => choose(idx),
        }, [
          el("span", { class: "tl-option__num", text: String(idx + 1), "aria-hidden": "true" }),
          el("span", { class: "tl-option__label", text: opt.label }),
        ]));
      });
      wrap.appendChild(opts);
    } else {
      const r = state.lastReact;
      const access = accessLabel(r);
      const choseHtml = access
        ? `You chose: <strong>${escapeHtml(r.label)}</strong> <span class="tl-chose__access">(${escapeHtml(access)})</span>`
        : `You chose: <strong>${escapeHtml(r.label)}</strong>`;
      wrap.appendChild(el("p", { class: "tl-chose", html: choseHtml }));
      if (r.access_basis) {
        wrap.appendChild(el("p", { class: "tl-access-note", text: r.access_basis }));
      } else if (data.access_meta?.disclaimer) {
        wrap.appendChild(el("p", { class: "tl-access-note", text: data.access_meta.disclaimer }));
      }
      wrap.appendChild(el("div", { class: "tl-react" }, CHARS.map((k) =>
        el("div", { class: `tl-react__col tl-react__col--${k}` }, [
          el("p", { class: "tl-react__name" }, [nameWithToken(k)]),
          el("p", { class: "tl-react__text", text: r.react[k] }),
        ])
      )));
      const isLast = state.beat >= data.beats.length - 1;
      wrap.appendChild(el("p", { class: "tl-hint", text: "Press → to continue." }));
      wrap.appendChild(el("button", {
        class: "tl-btn tl-btn--primary",
        type: "button",
        "data-autofocus": "",
        onclick: advance,
      }, isLast ? "See where they ended up →" : "Next, the years pass →"));
    }
    return wrap;
  }

  // -- render: endings + epilogue ------------------------------------------
  function renderEnding() {
    const ep = data.epilogue;
    const wrap = el("div", { class: "tl-card tl-card--ending" });
    wrap.appendChild(el("p", { class: "tl-kicker", text: "2025 · where they landed" }));
    wrap.appendChild(el("h3", { class: "tl-card__title", "data-autofocus": "", tabindex: "-1", text: ep.lede }));
    wrap.appendChild(renderStatus());

    wrap.appendChild(el("div", { class: "tl-endings" }, CHARS.map((k) => {
      const e = data.endings[k][bandFor(state.scores[k])];
      const stat = e.stat
        ? (e.statHref
            ? el("p", { class: "tl-ending__stat" }, [el("a", { href: e.statHref, text: e.stat })])
            : el("p", { class: "tl-ending__stat", text: e.stat }))
        : null;
      return el("div", { class: `tl-ending tl-ending--${k}` }, [
        el("p", { class: "tl-ending__name" }, [nameWithToken(k)]),
        el("p", { class: "tl-ending__tag", text: e.tag }),
        el("h4", { class: "tl-ending__title", text: e.title }),
        el("p", { class: "tl-ending__body", text: e.body }),
        stat,
      ].filter(Boolean));
    })));

    wrap.appendChild(el("p", { class: "tl-epilogue", text: ep.body }));

    if (ep.punchline) {
      wrap.appendChild(el("p", { class: "tl-punchline", text: ep.punchline }));
    }

    if (state.history.length) {
      const details = el("details", { class: "tl-recap" }, [
        el("summary", { class: "tl-recap__summary", text: ep.recap_label || "The choices you made" }),
        el("ol", { class: "tl-recap__list" }, state.history.map((h) =>
          el("li", { class: "tl-recap__item" }, [
            el("span", { class: "tl-recap__year", text: h.year }),
            el("span", { class: "tl-recap__label", text: h.label }),
            h.access_pct != null
              ? el("span", { class: "tl-recap__access", text: `~${h.access_pct}% ${data.access_meta?.label || "of South Africans could take this path"}` })
              : null,
          ].filter(Boolean))
        )),
      ]);
      wrap.appendChild(details);
    }

    wrap.appendChild(el("div", { class: "tl-actions" }, [
      el("button", {
        class: "tl-btn tl-btn--ghost",
        type: "button",
        onclick: () => { state = freshState(); render(); },
      }, ep.restart),
      el("a", { class: "tl-btn tl-btn--link", href: ep.cta.href }, ep.cta.label),
    ]));
    return wrap;
  }

  // -- actions --------------------------------------------------------------
  function choose(optIdx) {
    const beat = data.beats[state.beat];
    const opt = beat.options[optIdx];
    if (!opt) return;
    CHARS.forEach((k) => { state.scores[k] += opt.effects[k] || 0; });
    state.reacted = true;
    state.lastReact = opt;
    state.history.push({
      year: beat.year,
      label: opt.label,
      access_pct: opt.access_pct ?? null,
    });
    render();
  }

  function advance() {
    state.reacted = false;
    state.lastReact = null;
    if (state.beat >= data.beats.length - 1) state.phase = "ending";
    else state.beat += 1;
    render();
  }

  // -- keyboard shortcuts ---------------------------------------------------
  function onKey(e) {
    if (!state || state.phase !== "beat") return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!state.reacted) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= data.beats[state.beat].options.length) {
        e.preventDefault();
        choose(n - 1);
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      advance();
    }
  }

  // -- main render ----------------------------------------------------------
  function render() {
    clear(stage);
    if (reduceMotion) stage.classList.add("tl-reduce");
    stage.appendChild(renderProgress());
    if (state.phase === "intro") stage.appendChild(renderIntro());
    else if (state.phase === "beat") stage.appendChild(renderBeat());
    else stage.appendChild(renderEnding());
    if (state.phase !== "intro" || state.beat > 0) focusFirst();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // -- boot -----------------------------------------------------------------
  function showError() {
    clear(stage);
    stage.appendChild(el("p", { class: "tl-error", text: "The interactive could not load. Try refreshing the page." }));
  }

  fetch(src)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((json) => {
      data = json;
      state = freshState();
      render();
      root.addEventListener("keydown", onKey);
    })
    .catch((err) => { console.error("two-lives: failed to load", err); showError(); });
})();
