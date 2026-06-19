/* =============================================================
  Econometric results - GSAP ScrollTrigger scrolly panels
   ============================================================= */

(() => {
  "use strict";

  function refreshResultsScrolly() {
    if (typeof ScrollTrigger !== "undefined") {
      ScrollTrigger.refresh();
    }
  }

  function setRailActive(step) {
    const rail = document.querySelector(".results-scrolly-rail");
    if (!rail) return;
    const s = String(step);
    rail.querySelectorAll("[data-step]").forEach((el) => {
      el.classList.toggle("is-active", el.getAttribute("data-step") === s);
    });
  }

  function init() {
    const root = document.querySelector(".results-scrolly");
    if (!root || typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("results-scrolly--reduced");
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const panels = gsap.utils.toArray(".results-scrolly-panel");
    const mm = gsap.matchMedia();

    const wirePanelReveal = (startPct, yFrom, duration) => {
      panels.forEach((panel) => {
        const reveal = panel.querySelector(".results-scrolly-reveal");
        if (!reveal) return;

        gsap.set(reveal, { opacity: 0, y: yFrom, clearProps: "scale" });

        ScrollTrigger.create({
          trigger: panel,
          start: `top ${startPct}%`,
          once: true,
          invalidateOnRefresh: true,
          onEnter: () => {
            gsap.to(reveal, {
              opacity: 1,
              y: 0,
              duration,
              ease: "power3.out",
              onComplete: () => {
                gsap.set(reveal, { clearProps: "transform" });
              },
            });
          },
        });

        const step = panel.dataset.step ?? "0";
        ScrollTrigger.create({
          trigger: panel,
          start: "top 40%",
          end: "bottom 40%",
          onEnter: () => setRailActive(step),
          onEnterBack: () => setRailActive(step),
          invalidateOnRefresh: true,
        });
      });
    };

    mm.add("(min-width: 900px)", () => {
      wirePanelReveal(80, 24, 0.46);
      return () => {};
    });

    mm.add("(max-width: 899px)", () => {
      wirePanelReveal(86, 18, 0.4);
      return () => {};
    });

    document.querySelector("#results details")?.addEventListener("toggle", refreshResultsScrolly);

    const openFullBatteryIfTargeted = () => {
      if (window.location.hash !== "#results-panel-all") return;
      const details = document.querySelector("#results-panel-all details");
      if (details && !details.open) {
        details.open = true;
        requestAnimationFrame(refreshResultsScrolly);
      }
    };

    document.querySelectorAll('a[href="#results-panel-all"]').forEach((link) => {
      link.addEventListener("click", () => {
        const details = document.querySelector("#results-panel-all details");
        if (details && !details.open) {
          details.open = true;
          requestAnimationFrame(refreshResultsScrolly);
        }
      });
    });

    window.addEventListener("hashchange", openFullBatteryIfTargeted);
    openFullBatteryIfTargeted();

    let resizeT;
    window.addEventListener("resize", () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(refreshResultsScrolly, 120);
    });

    requestAnimationFrame(refreshResultsScrolly);
  }

  window.refreshResultsScrolly = refreshResultsScrolly;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
