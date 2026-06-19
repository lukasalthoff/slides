/* =============================================================
  Econ 30 · Essay Guide: guided walkthrough + grounded Q&A
  Works fully client-side; optionally calls /api/chat when available.
  ============================================================= */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const STOPWORDS = new Set(
    "a an the and or but in on at to for of is are was were be been being it its that with from as by not no so if than then into who which their there they them we you your our".split(" ")
  );

  const SCORE_THRESHOLD = 0.55;
  const RETRIEVE_TOP_K = 5;
  const API_TIMEOUT_MS = 12000;
  const META_CHUNK_IDS = [
    "meta-scope",
    "meta-methods",
    "meta-sections",
    "meta-sa-context",
    "meta-findings",
  ];
  const ESSAY_ADJACENT_RE =
    /\b(essay|site|project|capstone|econ(?:omics)?\s*30|thesis|argument|claim|finding|conclusion|method|methodolog|data|dataset|source|chart|map|regression|evidence|caus|associat|apartheid|south africa|post.?1994|integration|inclusion|openness|trade|gear|rdp|unemployment|inequality|manufactur|sector|pieter|sipho|two lives|wdi|qlfs|benjamini|bonferroni|chow|present|professor|reader|section|walkthrough|gdp|provinc|geograph|policy|democrat|sanction|township|hallur|takeaway|summar|explain|compare|timeline|history|chronolog|event|sovereign|rating|downgrade|credit|junk|covid|pandemic|wto|commodity|crisis|financial|wealth|income|gugulethu|johannesburg|durban|metro|interactive|character|composite|tour|walkthrough|harmonis|qlfs|ohs|lfs|wid|tariff|liberalis|sanction|codesa|election|democrati|apartheid|factory|mining|agriculture|tradable|services|spread|western cape|eastern cape|gauteng|provinc)\b/i;

  const SITE_YEAR_RE = /\b(19[89]\d|20[0-2]\d)\b/;

  /** Words that appear in many queries but are not essay-specific — ignore for corpus overlap. */
  const GENERIC_QUERY_TOKENS = new Set(
    "about tell show mean help like good best much many some also just really very here there when where does did was were been being have has had can could would should make made year years time people work world country south africa who what why how compare explain summarize better won".split(
      " "
    )
  );

  const substantiveTokens = (query) =>
    tokenize(query).filter(
      (t) => !GENERIC_QUERY_TOKENS.has(t) && !/^\d+$/.test(t)
    );
  /** In-memory only: "Not now" / Escape hides invite until the next full page load. */
  const INVITE_DELAY_MS = 900;
  const INVITE_RESHOW_MS = 600;

  let corpus = { chunks: [] };
  let tour = { steps: [] };
  let tourIndex = 0;
  let tourActive = false;
  let tourStarted = false;
  let panelOpen = false;
  let mode = "ask"; // "ask" | "tour"
  let messages = [];
  let apiAvailable = null;
  let inviteVisible = false;
  let inviteDismissedForLoad = false;
  let inviteTimer = null;

  const sectionOrder = [
    "hero", "question", "from-the-ground", "timeline", "macro", "sectors",
    "inequality", "two-lives", "results", "map", "conclusions", "ask-anything", "sources",
  ];

  const ASK_LOGS = ["#essay-guide-log", "#ask-anything-log"];

  const DEFAULT_SUGGESTIONS = [
    "What is this project about?",
    "What data do you use?",
    "What are the main findings?",
    "Why didn't unemployment fall?",
  ];

  const ASK_ANYTHING_SUGGESTIONS = [
    "Summarize the essay in three sentences.",
    "What survived the regression tests?",
    "How should I explain this to my professor?",
    "What is GEAR and why does it matter here?",
  ];

  const tokenize = (text) =>
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const normalizeQuery = (q) =>
    String(q || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const parseWordLimit = (query) => {
    const q = String(query || "");
    const patterns = [
      /\b(\d{1,3})\s*[-]?\s*words?\b/i,
      /\bwithin\s+(\d{1,3})\s+words?\b/i,
      /\bmax(?:imum)?\s+(\d{1,3})\s+words?\b/i,
      /\bin\s+(\d{1,3})\s+words?\b/i,
    ];
    for (const re of patterns) {
      const m = q.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 5 && n <= 120) return n;
      }
    }
    return null;
  };

  const truncateToWordLimit = (text, limit) => {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length <= limit) return words.join(" ");
    return words.slice(0, limit).join(" ");
  };

  const escapeHtml = (text) =>
    String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  /** Plain text → safe <p> blocks (never inject tags then escape). */
  const formatAnswerHtml = (text, { compact = false } = {}) => {
    if (compact) {
      const one = String(text || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return one ? `<p>${escapeHtml(one)}</p>` : "<p></p>";
    }
    const raw = String(text || "").trim();
    if (!raw) return "<p></p>";
    const blocks = String(text || "")
      .replace(/<[^>]+>/g, "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const paras =
      blocks.length > 1
        ? blocks
        : String(text || "")
            .replace(/<[^>]+>/g, "")
            .split(/\n/)
            .map((p) => p.trim())
            .filter(Boolean);
    if (!paras.length) return `<p>${escapeHtml(raw)}</p>`;
    return paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  };

  const parseAnswerFormat = (query) => {
    const limit = parseWordLimit(query);
    if (limit) return { kind: "wordLimit", limit };
    const q = String(query || "").toLowerCase();
    if (/\b(one sentence|single sentence|in a sentence|one-line)\b/.test(q)) {
      return { kind: "oneSentence" };
    }
    if (
      /\b(very brief|briefly|short answer|keep it short|quick(ly)?|tl;dr|tl dr|concise)\b/.test(
        q
      )
    ) {
      return { kind: "brief" };
    }
    if (
      /\b(in depth|detailed|comprehensive|explain fully|walk me through|long answer|elaborate)\b/.test(
        q
      )
    ) {
      return { kind: "detailed" };
    }
    return { kind: "default" };
  };

  const isCompactFormat = (format) =>
    format.kind === "wordLimit" ||
    format.kind === "oneSentence" ||
    format.kind === "brief";

  const isStrongEssayAdjacent = (query) => {
    const n = normalizeQuery(query);
    if (!n || n.length < 3) return false;
    if (ESSAY_ADJACENT_RE.test(n)) return true;
    if (
      SITE_YEAR_RE.test(n) &&
      (ESSAY_ADJACENT_RE.test(n) || queryTouchesCorpus(query) || /\b(happened|when|during|event)\b/.test(n))
    ) {
      return true;
    }
    if (/\b(who|what|why|how|when)\b/.test(n) && queryTouchesCorpus(query)) return true;
    return false;
  };

  /** Good-faith follow-ups with no named topic — still answer from context. */
  const isVagueOpenQuestion = (query) =>
    /\b(tell me more|more about (?:this|it|that)|explain this|what about this|go on|continue|say more|elaborate)\b/i.test(
      String(query || "")
    );

  /** Lost / confused reader — still answer from project context. */
  const isLaypersonHelpQuery = (query) =>
    /\b(i am confused|i'?m confused|im confused|help i'?m confused|help im confused|i am lost|i'?m lost|im lost|don'?t understand any|do not understand any|no idea what this|make sense of this|what am i looking at|where do i even start|help me understand)\b/i.test(
      String(query || "")
    );

  /** Clearly unrelated topics — decline even if a generic word overlaps the corpus. */
  const OFF_TOPIC_TOPIC_RE =
    /\b(ishowspeed|taylor swift|minecraft|marvel|mcu|netflix|iphone|climate change|global warming|write my homework|homework for me|homework essay|translate(?: this)?(?: page)? to spanish|us election|presidential election|super bowl|best pizza|recipe for|fortnite|tiktok|nba\b|nfl\b|messi|ronaldo|disney\+|spotify)\b/i;

  let corpusVocab = null;
  const getCorpusVocab = () => {
    if (corpusVocab) return corpusVocab;
    const vocab = new Set(sectionOrder);
    for (const chunk of corpus.chunks) {
      tokenize(chunk.title).forEach((t) => vocab.add(t));
      tokenize(chunk.text).forEach((t) => {
        if (t.length >= 3) vocab.add(t);
      });
      (chunk.keywords || []).forEach((k) => vocab.add(String(k).toLowerCase()));
    }
    corpusVocab = vocab;
    return vocab;
  };

  const queryTouchesCorpus = (query) => {
    const vocab = getCorpusVocab();
    return substantiveTokens(query).some((t) => vocab.has(t));
  };

  /**
   * Obvious nonsense / unrelated: no substantive corpus link and not a curated FAQ hit.
   * Biased toward answering borderline questions.
   */
  const isObviousOffTopic = (query, rawHits) => {
    const n = normalizeQuery(query);
    if (OFF_TOPIC_TOPIC_RE.test(n)) return true;
    if (isStrongEssayAdjacent(query)) return false;
    if (isVagueOpenQuestion(query)) return false;
    if (isLaypersonHelpQuery(query)) return false;
    if (queryTouchesCorpus(query)) return false;
    if (rawHits[0]?.score >= 20) return false;
    if ((rawHits[0]?.score ?? 0) >= 2) return false;
    if (
      SITE_YEAR_RE.test(n) &&
      (queryTouchesCorpus(query) ||
        ESSAY_ADJACENT_RE.test(n) ||
        /\b(happened|when|during|event|what|why|how)\b/.test(n))
    ) {
      return false;
    }
    const subs = substantiveTokens(query);
    if (!subs.length) return true;
    return (rawHits[0]?.score ?? 0) < 2;
  };

  const obviousOffTopicAnswer = () => ({
    html: `<p>I can't help with that here. This agent answers questions about <em>The Price of Integration</em> and South Africa after 1994—try the thesis, data, charts, or <a href="#sources">Sources</a>.</p>`,
    anchors: ["#sources"],
    grounded: false,
  });

  /** @deprecated alias — prefer isStrongEssayAdjacent for guardrails */
  const isEssayAdjacentQuery = (query) =>
    isStrongEssayAdjacent(query) ||
    isVagueOpenQuestion(query) ||
    isLaypersonHelpQuery(query) ||
    queryTouchesCorpus(query);

  const getChunkById = (id) => corpus.chunks.find((c) => c.id === id);

  const getMetaHits = () =>
    META_CHUNK_IDS.map((id) => getChunkById(id))
      .filter(Boolean)
      .map((chunk) => ({ chunk, score: 1.2 }));

  const getSectionOverviewHit = (sectionId) => {
    const chunk = corpus.chunks.find(
      (c) =>
        c.section === sectionId &&
        !c.id.startsWith("kb-") &&
        !c.id.startsWith("meta-")
    );
    return chunk ? { chunk, score: 0.85 } : null;
  };

  const enrichHits = (query, hits, sectionId) => {
    const seen = new Set(hits.map((h) => h.chunk.id));
    const out = [...hits];
    const add = (item) => {
      if (item && !seen.has(item.chunk.id)) {
        seen.add(item.chunk.id);
        out.push(item);
      }
    };

    const weak =
      !hits.length || hits[0].score < SCORE_THRESHOLD;
    if (!isEssayAdjacentQuery(query) && !weak) {
      return out.sort((a, b) => b.score - a.score).slice(0, RETRIEVE_TOP_K);
    }

    getMetaHits().forEach(add);
    add(getSectionOverviewHit(sectionId));
    const hero =
      getChunkById("hero") ||
      corpus.chunks.find((c) => c.section === "hero");
    if (hero) add({ chunk: hero, score: 0.7 });

    if (/\b(method|data|regression|evidence|caus|benjamini|bonferroni|hac)\b/i.test(query)) {
      add(
        getChunkById("stats-meta")
          ? { chunk: getChunkById("stats-meta"), score: 1.5 }
          : null
      );
      add(
        getChunkById("meta-methods")
          ? { chunk: getChunkById("meta-methods"), score: 1.4 }
          : null
      );
    }
    if (/\b(finding|takeaway|conclusion|remember|summary|so what)\b/i.test(query)) {
      add(
        getChunkById("meta-findings")
          ? { chunk: getChunkById("meta-findings"), score: 1.4 }
          : null
      );
    }

    return out.sort((a, b) => b.score - a.score).slice(0, RETRIEVE_TOP_K);
  };

  const JUNK_SENTENCE =
    /(% of GDP|% of employed|World Bank WDI|OHS \/ LFS|QLFS|BH-significant|Not significant|→|Stat check|How to read|View source|Section \d|Built on WDI|Pick a term)/i;

  const cleanChunkText = (text) =>
    String(text || "")
      .replace(/\s+([,.])/g, "$1")
      .replace(/\b(Start with places|Jump to national charts|see sources)\b[^.]*\.?/gi, "")
      .replace(/Manufacturing, % of[^.]*\.?/gi, "")
      .replace(/Tradable sectors, % of[^.]*\.?/gi, "")
      .replace(/[–-]\s*→\s*[–-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const excerptFromChunk = (chunk) => {
    if (chunk.id?.startsWith("faq-")) return chunk.text;
    const text = cleanChunkText(chunk.text);
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 35 && !JUNK_SENTENCE.test(s));
    const picked = sentences.slice(0, 2).join(" ");
    const body = picked || text.slice(0, 280);
    return body.length > 320 ? `${body.slice(0, 317).trim()}…` : body;
  };

  const findTimelineChunk = (query) => {
    const q = normalizeQuery(query);
    const topicRules = [
      {
        test: () => /\b(sovereign|rating|downgrade|junk status|investment grade)\b/.test(q),
        id: "timeline-2017-sovereign-rating-downgrades",
      },
      {
        test: () => /\b(covid|coronavirus|pandemic)\b/.test(q),
        id: "timeline-2020-22-covid-19-shock",
      },
      { test: () => /\b(wto|world trade organization)\b/.test(q), id: "timeline-1995-joining-the-wto" },
      {
        test: () => /\b(financial crisis|global crisis)\b/.test(q) || (/\b2008\b/.test(q) && /\b(crisis|crash)\b/.test(q)),
        id: "timeline-2008-09-global-financial-crisis",
      },
      {
        test: () => /\b(commodity boom|minerals boom)\b/.test(q),
        id: "timeline-2000s-commodity-boom-years",
      },
      {
        test: () => /\b(timeline|chronology|what events)\b/.test(q),
        id: "timeline-overview",
      },
    ];
    for (const rule of topicRules) {
      if (!rule.test()) continue;
      const chunk = getChunkById(rule.id);
      if (chunk) return { chunk, score: 20 };
    }
    const year = q.match(SITE_YEAR_RE)?.[1];
    if (!year) return null;
    const yearQuestion =
      ESSAY_ADJACENT_RE.test(q) ||
      queryTouchesCorpus(query) ||
      /\b(happened|when|during|event|what|why|how)\b/.test(q);
    if (!yearQuestion) return null;
    const faq = corpus.chunks.find((c) => c.id.startsWith("faq-") && c.text.includes(year));
    if (faq) return { chunk: faq, score: 20 };
    const timeline = corpus.chunks.find(
      (c) =>
        c.id.startsWith("timeline-") &&
        c.id !== "timeline-overview" &&
        (c.id.includes(year) || (c.keywords || []).includes(year) || c.text.includes(year))
    );
    return timeline ? { chunk: timeline, score: 20 } : null;
  };

  /** Direct routing for common demo questions before keyword search. */
  const findCuratedChunk = (query) => {
    const q = normalizeQuery(query);
    const timelineHit = findTimelineChunk(query);
    if (timelineHit) return timelineHit;
    const rules = [
      { test: () => /\bwhat is this (essay|site|project)\b/.test(q) || q === "what is this essay about", id: "faq-what-is-this-essay-about" },
      { test: () => /\bwhat happened in 1994\b/.test(q) || (q.includes("1994") && q.includes("happened")), id: "faq-what-happened-in-1994" },
      { test: () => /\bwhat happened in 1996\b/.test(q) || (q.includes("1996") && q.includes("happened")), id: "faq-what-happened-in-1996" },
      { test: () => /\bwhat happened in 2017\b/.test(q) || (q.includes("2017") && q.includes("happened")), id: "faq-what-happened-in-2017" },
      { test: () => /\bwhat is gear\b/.test(q) || (q.includes("gear") && q.includes("what")), id: "faq-what-is-gear" },
      { test: () => /\bwhat is rdp\b/.test(q), id: "faq-what-is-rdp" },
      { test: () => /\bwhen did trade\b/.test(q) || (q.includes("trade") && (q.includes("rise") || q.includes("increase") || q.includes("grow"))), id: "faq-when-did-trade-rise" },
      { test: () => /\bwhy\b.*\bunemployment\b/.test(q) || /\bunemployment\b.*\b(stay|high|fall)\b/.test(q), id: "faq-why-unemployment" },
      { test: () => q.includes("map") && (q.includes("show") || q.includes("what")), id: "faq-what-does-the-map-show" },
      { test: () => q.includes("one sentence") || q.includes("remember"), id: "faq-remember-one-sentence" },
      { test: () => /\b(thesis|main argument|central claim|what is this (about|project))\b/.test(q), id: "faq-what-is-this-essay-about" },
      { test: () => /\b(method|methodolog|how did you (study|analyze)|what data)\b/.test(q), id: "faq-what-data-do-you-use" },
      { test: () => /\b(causation|causal|correlation|prove caus)\b/.test(q), id: "faq-causation-or-correlation" },
      { test: () => /\bwho is pieter\b/.test(q), id: "two-lives-pieter" },
      { test: () => /\bwho is sipho\b/.test(q), id: "two-lives-sipho" },
      { test: () => /\b(pieter|sipho|two lives|characters)\b/.test(q), id: "faq-who-are-pieter-and-sipho" },
      { test: () => /\b(two lives|interactive story)\b/.test(q) && /\b(real|actual|survey)\b/.test(q), id: "faq-is-two-lives-real-data" },
      { test: () => /\bwhat is two lives\b/.test(q) || /\btwo lives\b/.test(q) && /\bwhat\b/.test(q), id: "faq-what-is-two-lives" },
      { test: () => /\b(main finding|takeaway|headline|summar)/.test(q), id: "faq-what-are-the-main-findings" },
      { test: () => /\b(section|structure|navigate|organized)\b/.test(q), id: "meta-sections" },
      { test: () => /\b(capstone|econ\s*30|who wrote|author)\b/.test(q), id: "meta-scope" },
    ];
    for (const rule of rules) {
      if (!rule.test()) continue;
      const chunk = corpus.chunks.find((c) => c.id === rule.id);
      if (chunk) return { chunk, score: 20 };
    }
    return null;
  };

  const chunkNoisePenalty = (chunk) => {
    const t = chunk.text || "";
    let penalty = 0;
    if (chunk.id?.startsWith("meta-") || chunk.id?.startsWith("faq-")) return 0;
    if ((t.match(/→/g) || []).length >= 2) penalty += 4;
    if (/% of (GDP|employed)/i.test(t)) penalty += 3;
    if (chunk.id?.startsWith("kb-") && !chunk.id.includes("gear") && !chunk.id.includes("rdp")) penalty += 1.5;
    if (/^##\s/m.test(t)) penalty += 4;
    return penalty;
  };

  const getActiveSectionId = () => {
    const y = window.scrollY + window.innerHeight * 0.45;
    let active = sectionOrder[0];
    for (const id of sectionOrder) {
      const el = document.getElementById(id);
      if (el && el.offsetTop <= y) active = id;
    }
    return active;
  };

  const retrieve = (query, sectionBoostId) => {
    const qNorm = normalizeQuery(query);
    const qTokens = tokenize(query);
    if (!qNorm) return [];

    const scored = corpus.chunks.map((chunk) => {
      const hay = [
        chunk.text,
        chunk.title,
        ...(chunk.keywords || []),
        ...(chunk.kb || []),
      ].join(" ").toLowerCase();
      let score = 0;

      if (chunk.id.startsWith("faq-")) {
        const faqKey = chunk.id.replace("faq-", "").replace(/-/g, " ");
        if (qNorm.includes(faqKey)) score += 12;
        const faqWords = faqKey.split(" ").filter((w) => w.length > 2);
        const matched = faqWords.filter((w) => qNorm.includes(w)).length;
        score += matched * 2.5;
      }

      for (const t of qTokens) {
        if (hay.includes(t)) score += 1;
        if ((chunk.keywords || []).includes(t)) score += 0.5;
      }

      if (/\b(essay|project|site|about)\b/.test(qNorm) && chunk.section === "hero") score += 2;
      if (/\b1994\b/.test(qNorm) && ["timeline", "question", "hero"].includes(chunk.section)) {
        score += 2;
      }
      if (/\b1996\b/.test(qNorm) && ["timeline", "question"].includes(chunk.section)) {
        score += 3;
      }
      const qYear = qNorm.match(SITE_YEAR_RE)?.[1];
      if (qYear && (chunk.id?.includes(qYear) || (chunk.keywords || []).includes(qYear))) {
        score += 4;
      }
      if (/\b(trade|openness|exports|imports)\b/.test(qNorm) && chunk.section === "macro") {
        score += 3;
      }
      if (/\b(happened|when|timeline|year|event)\b/.test(qNorm) && chunk.section === "timeline") {
        score += 2;
      }
      if (chunk.id?.startsWith("timeline-")) score += 0.5;
      if (chunk.id?.startsWith("tour-")) score += 0.5;
      if (sectionBoostId && chunk.section === sectionBoostId) score += 1;

      if (/\b(method|data|regression|evidence|study|analyze)\b/.test(qNorm)) {
        if (["results", "sources"].includes(chunk.section) || chunk.id?.startsWith("stats-")) score += 2;
        if (chunk.id?.startsWith("meta-methods")) score += 4;
      }
      if (/\b(about|essay|project|capstone|thesis|argument)\b/.test(qNorm)) {
        if (chunk.section === "hero" || chunk.id?.startsWith("meta-scope")) score += 3;
      }
      if (/\b(finding|takeaway|conclusion|remember|summary)\b/.test(qNorm)) {
        if (["conclusions", "results"].includes(chunk.section)) score += 2;
        if (chunk.id === "meta-findings") score += 3;
      }
      if (/\b(section|navigate|where|find|structure)\b/.test(qNorm) && chunk.id === "meta-sections") {
        score += 4;
      }
      if (/\b(pieter|sipho|story|interactive|lives)\b/.test(qNorm) && chunk.section === "two-lives") {
        score += 3;
      }

      score -= chunkNoisePenalty(chunk);

      return { chunk, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, RETRIEVE_TOP_K);
  };

  const buildLocalAnswer = (query, hits) => {
    const format = parseAnswerFormat(query);
    const adjacent = isEssayAdjacentQuery(query);

    if (isCompactFormat(format) && hits.length) {
      const best = hits[0].chunk;
      let text = excerptFromChunk(best);
      if (format.kind === "wordLimit") {
        text = truncateToWordLimit(text, format.limit);
      } else if (format.kind === "oneSentence") {
        text = truncateToWordLimit(text.split(/(?<=[.!?])\s+/)[0] || text, 40);
      } else {
        text = truncateToWordLimit(text, 90);
      }
      return {
        html: formatAnswerHtml(text, { compact: true }),
        anchors: [best.anchor || `#${best.section}`],
        grounded: true,
      };
    }

    if (!hits.length) {
      if (adjacent) {
        const scope = getChunkById("meta-scope");
        if (scope) {
          return {
            html: `<p><strong>About this project.</strong> ${excerptFromChunk(scope)}</p>
              <p class="essay-guide__cite">Start at <a href="#hero">Intro</a> or browse <a href="#sources">Sources</a>.</p>`,
            anchors: ["#hero", "#sources"],
            grounded: true,
          };
        }
      }
      return {
        html: `<p>I do not have a specific passage for that. This guide focuses on <em>The Price of Integration</em> and related South African evidence on trade, jobs, inequality, and policy after 1994. Try asking about the thesis, methods, GEAR, the map, or main findings, or see <a href="#sources">Sources</a>.</p>`,
        anchors: ["#sources"],
        grounded: false,
      };
    }

    if (hits[0].score < SCORE_THRESHOLD && !isStrongEssayAdjacent(query) && !isVagueOpenQuestion(query) && !isLaypersonHelpQuery(query) && !queryTouchesCorpus(query)) {
      return {
        html: `<p>That looks outside this essay's scope. Ask about South Africa after 1994, trade openness, unemployment, inequality, GEAR, the map, regressions, or what the project argues. See <a href="#sources">Sources</a> for papers.</p>`,
        anchors: ["#sources"],
        grounded: false,
      };
    }

    const best = hits[0].chunk;
    const excerpt = excerptFromChunk(best);
    const anchor = best.anchor || `#${best.section}`;
    const sectionLabel = best.title || best.section.replace(/-/g, " ");
    const soft =
      hits[0].score < SCORE_THRESHOLD
        ? `<p class="essay-guide__cite">Here is the closest material in the project:</p>`
        : "";

    let body = `${soft}<p><strong>${sectionLabel}.</strong> ${excerpt}</p>`;
    if (hits.length > 1 && hits[0].score < 2) {
      const also = hits[1].chunk;
      const extra = excerptFromChunk(also);
      if (extra && extra !== excerpt) {
        body += `<p><strong>${also.title || also.section}.</strong> ${extra}</p>`;
      }
    }
    if (best.stats?.length) {
      const statLine = best.stats
        .map((s) => `<strong>${s.label}:</strong> ${s.value}`)
        .join(" · ");
      body += `<p class="essay-guide__stats mono">${statLine}</p>`;
    }
    body += `<p class="essay-guide__cite">Read more: <a href="${anchor}">${anchor.replace("#", "")}</a> · <a href="#sources">Sources</a></p>`;

    return { html: body, anchors: [anchor], grounded: true };
  };

  const tryApiAnswer = async (query, hits) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const context = hits.map((h) => ({
        id: h.chunk.id,
        section: h.chunk.section,
        title: h.chunk.title,
        text: h.chunk.text.slice(0, 800),
        anchor: h.chunk.anchor,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: query,
          section: getActiveSectionId(),
          context,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        apiAvailable = true;
        const msg =
          data.error ||
          "Too many questions. Please wait a few minutes and try again.";
        return {
          html: `<p>${msg.replace(/</g, "&lt;")}</p>`,
          anchors: ["#sources"],
          grounded: false,
          viaApi: true,
        };
      }
      if (res.status === 503) {
        apiAvailable = false;
        return null;
      }
      if (!res.ok) return null;
      if (!data?.answer) return null;
      apiAvailable = true;
      const format = parseAnswerFormat(query);
      const compact = data.compact ?? isCompactFormat(format);
      let answerText = data.answer;
      if (format.kind === "wordLimit") {
        answerText = truncateToWordLimit(
          answerText,
          data.wordLimit ?? format.limit
        );
      } else if (format.kind === "oneSentence") {
        answerText = truncateToWordLimit(
          (answerText.split(/(?<=[.!?])\s+/)[0] || answerText).trim(),
          40
        );
      } else if (format.kind === "brief") {
        answerText = truncateToWordLimit(answerText, 90);
      }
      const anchors = data.anchors || hits.map((h) => h.chunk.anchor).filter(Boolean);
      let html = formatAnswerHtml(answerText, { compact });
      if (compact && format.kind === "wordLimit") {
        const wc = answerText.split(/\s+/).filter(Boolean).length;
        const limit = data.wordLimit ?? format.limit;
        const link = anchors[0]
          ? `<a href="${anchors[0]}">${anchors[0].replace("#", "")}</a>`
          : '<a href="#hero">Intro</a>';
        html += `<p class="essay-guide__cite mono">${wc} / ${limit} words · ${link}</p>`;
      } else if (!compact && anchors.length) {
        html += `<p class="essay-guide__cite">See: ${anchors
          .map((a) => `<a href="${a}">${a.replace("#", "")}</a>`)
          .join(", ")}</p>`;
      }
      return { html, anchors, grounded: true, viaApi: true };
    } catch {
      clearTimeout(timer);
      apiAvailable = false;
      return null;
    }
  };

  const getAskLogs = () =>
    ASK_LOGS.map((sel) => $(sel)).filter(Boolean);

  const appendMessage = (role, html, logs = getAskLogs()) => {
    messages.push({ role, html });
    logs.forEach((log) => {
      const item = document.createElement("div");
      item.className = `essay-guide__msg essay-guide__msg--${role}`;
      item.innerHTML = role === "user"
        ? `<p>${html.replace(/</g, "&lt;")}</p>`
        : html;
      log.appendChild(item);
      log.scrollTop = log.scrollHeight;
    });
  };

  const thinkingLabel = () => {
    if (!corpus?.chunks?.length) return "Essay excerpts unavailable — showing limited answers.";
    if (apiAvailable === false) return "AI unavailable — showing closest passages.";
    return "Searching essay excerpts…";
  };

  const appendThinking = (logs = getAskLogs()) => {
    const nodes = [];
    logs.forEach((log) => {
      const thinking = document.createElement("div");
      thinking.className =
        "essay-guide__msg essay-guide__msg--assistant essay-guide__thinking";
      thinking.textContent = thinkingLabel();
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;
      nodes.push(thinking);
    });
    return () => nodes.forEach((n) => n.remove());
  };

  const resolveAnswer = async (query, sectionId) => {
    const q = String(query || "").trim();
    if (!q) return null;
    const { hits, offTopic } = resolveHits(q, sectionId);
    if (offTopic) return obviousOffTopicAnswer();
    const tryApi =
      apiAvailable !== false &&
      (hits.length > 0 || isEssayAdjacentQuery(q));
    if (tryApi) {
      const apiAnswer = await tryApiAnswer(q, hits);
      if (apiAnswer) return apiAnswer;
    }
    return buildLocalAnswer(q, hits);
  };

  const resolveHits = (query, sectionId) => {
    const curated = findCuratedChunk(query);
    let hits = curated ? [curated] : retrieve(query, sectionId);
    if (!curated && hits.length && hits[0].score < SCORE_THRESHOLD) {
      const retry = retrieve(query, null);
      if (retry[0]?.score > hits[0].score) hits = retry;
    }
    const offTopic = !curated && isObviousOffTopic(query, hits);
    if (offTopic) return { hits, offTopic: true };
    return { hits: enrichHits(query, hits, sectionId), offTopic: false };
  };

  const handleAsk = async (query, { sectionId } = {}) => {
    const q = String(query || "").trim();
    if (!q) return;
    appendMessage("user", q);
    const removeThinking = appendThinking();
    const answer = await resolveAnswer(
      q,
      sectionId ?? getActiveSectionId()
    );
    removeThinking();
    if (!answer) return;
    appendMessage("assistant", answer.html);
    refreshSuggestedChips();
  };

  const getTourSteps = () => (Array.isArray(tour?.steps) ? tour.steps : []);

  const tourScrollOffset = () => ($(".topbar")?.offsetHeight || 64) + 20;

  const scrollToAnchor = (anchor) => {
    const el = document.querySelector(anchor);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - tourScrollOffset());
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  };

  /** Align section start below the top bar (not vertical center — tall sections read wrong). */
  const scrollTourSectionToStart = (el) => {
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - tourScrollOffset());
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  };

  /** ScrollTrigger.refresh() can reset window scroll; re-apply after layout settles. */
  const scrollTourSectionToStartAfterLayout = (el) => {
    scrollTourSectionToStart(el);
    const reapply = () => scrollTourSectionToStart(el);
    requestAnimationFrame(() => {
      if (typeof ScrollTrigger !== "undefined") {
        try {
          ScrollTrigger.refresh();
        } catch { /* ignore */ }
      }
      reapply();
      requestAnimationFrame(reapply);
    });
  };

  const setTourHighlight = (selector) => {
    document.body.classList.toggle("essay-guide-tour-active", tourActive);
    $$("main section, main .hero").forEach((sec) => {
      sec.classList.remove("essay-guide-tour-focus");
      sec.style.removeProperty("opacity");
    });
    if (!tourActive || !selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add("essay-guide-tour-focus");
    el.style.opacity = "1";
  };

  const focusTourStep = (step) => {
    const anchor = step?.anchor || step?.highlight;
    if (!anchor) return;
    const el = document.querySelector(anchor);
    if (!el) return;
    setTourHighlight(step.highlight || anchor);
    scrollTourSectionToStartAfterLayout(el);
  };

  const renderTourStep = () => {
    if (mode !== "tour" || !panelOpen) return;
    const steps = getTourSteps();
    const step = steps[tourIndex];
    if (!step) return;

    const titleEl = $("#essay-guide-tour-title");
    const narrEl = $("#essay-guide-tour-narration");
    const progEl = $("#essay-guide-tour-progress");
    const prevBtn = $("#essay-guide-tour-prev");
    const nextBtn = $("#essay-guide-tour-next");

    if (titleEl) titleEl.textContent = step.title;
    if (narrEl) narrEl.textContent = step.narration;
    if (progEl) progEl.textContent = `Step ${tourIndex + 1} of ${steps.length}`;
    if (prevBtn) prevBtn.disabled = tourIndex === 0;
    if (nextBtn) {
      const isLast = tourIndex >= steps.length - 1;
      nextBtn.textContent = isLast ? "Finish tour" : "Next section →";
      nextBtn.setAttribute("aria-label", isLast ? "Finish walkthrough" : "Go to next section");
    }

    focusTourStep(step);

    const indicator = $("#section-indicator-text");
    if (indicator) {
      indicator.textContent = `Tour ${tourIndex + 1}/${steps.length} · ${step.title}`;
    }

    refreshSuggestedChips(step.suggestedQuestions);
  };

  const pauseTour = () => {
    tourActive = false;
    setTourHighlight(null);
    document.body.classList.remove("essay-guide-tour-active");
  };

  const resetTour = () => {
    tourStarted = false;
    tourIndex = 0;
    pauseTour();
  };

  const tourNext = () => {
    const steps = getTourSteps();
    if (!steps.length || mode !== "tour" || !panelOpen) return;
    if (tourIndex >= steps.length - 1) {
      resetTour();
      setModeTab("ask");
      return;
    }
    tourActive = true;
    tourIndex += 1;
    renderTourStep();
  };

  const tourPrev = () => {
    const steps = getTourSteps();
    if (!steps.length || tourIndex <= 0 || mode !== "tour" || !panelOpen) return;
    tourActive = true;
    tourIndex -= 1;
    renderTourStep();
  };

  const fillSuggestionChips = (wrap, questions, onPick) => {
    if (!wrap) return;
    wrap.innerHTML = "";
    questions.slice(0, 4).forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "essay-guide__chip";
      btn.textContent = q;
      btn.addEventListener("click", () => onPick(q));
      wrap.appendChild(btn);
    });
  };

  const refreshSuggestedChips = (overrideQuestions) => {
    let questions = overrideQuestions;
    if (!questions?.length) {
      const step = getTourSteps().find((s) => s.id === getActiveSectionId());
      questions = step?.suggestedQuestions || DEFAULT_SUGGESTIONS;
    }
    fillSuggestionChips($("#essay-guide-suggestions"), questions, (q) => {
      setModeTab("ask");
      $("#essay-guide-input")?.focus();
      handleAsk(q);
    });
    if (!overrideQuestions) {
      fillSuggestionChips($("#ask-anything-suggestions"), ASK_ANYTHING_SUGGESTIONS, (q) => {
        $("#ask-anything-input")?.focus();
        handleAsk(q, { sectionId: "ask-anything" });
      });
    }
  };

  const wireAskAnything = () => {
    const form = $("#ask-anything-form");
    const input = $("#ask-anything-input");
    if (!form || !input) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = input.value;
      input.value = "";
      handleAsk(val, { sectionId: "ask-anything" });
    });

    $("#ask-anything-open-guide")?.addEventListener("click", () => {
      openPanel("ask");
    });
  };

  const setModeTab = (next) => {
    mode = next;
    $$(".essay-guide__tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.mode === next);
      tab.setAttribute("aria-selected", tab.dataset.mode === next ? "true" : "false");
    });
    const tourPanel = $("#essay-guide-panel-tour");
    const askPanel = $("#essay-guide-panel-ask");
    tourPanel?.classList.toggle("is-hidden", next !== "tour");
    askPanel?.classList.toggle("is-hidden", next !== "ask");
    if (tourPanel) tourPanel.hidden = next !== "tour";
    if (askPanel) askPanel.hidden = next !== "ask";
    if (next === "tour") {
      if (!tourStarted) {
        tourStarted = true;
        tourIndex = 0;
      }
      tourActive = true;
      renderTourStep();
    } else if (next === "ask") {
      pauseTour();
      refreshSuggestedChips();
    }
  };

  const inviteDismissed = () => inviteDismissedForLoad;

  const hideInvite = (forThisLoad = false) => {
    if (forThisLoad) inviteDismissedForLoad = true;
    inviteVisible = false;
    const invite = $("#essay-guide-invite");
    invite?.classList.remove("is-visible");
    invite?.setAttribute("aria-hidden", "true");
    if (inviteTimer) {
      clearTimeout(inviteTimer);
      inviteTimer = null;
    }
  };

  const showInvite = () => {
    if (panelOpen || inviteDismissed()) return;
    if (tourActive) pauseTour();
    const invite = $("#essay-guide-invite");
    if (!invite) return;
    inviteVisible = true;
    invite.classList.add("is-visible");
    invite.setAttribute("aria-hidden", "false");
  };

  const scheduleInvite = (delayMs = INVITE_DELAY_MS) => {
    const themePrompt = $("#theme-prompt");
    if (themePrompt && !themePrompt.hidden) return;
    if (inviteDismissed() || panelOpen) return;
    if (inviteTimer) clearTimeout(inviteTimer);
    inviteTimer = window.setTimeout(() => {
      inviteTimer = null;
      showInvite();
    }, delayMs);
  };

  const openPanel = (initialMode) => {
    hideInvite(false);
    panelOpen = true;
    document.body.classList.add("essay-guide-panel-open");
    const root = $("#essay-guide");
    root?.classList.add("is-open");
    root?.setAttribute("aria-hidden", "false");
    $("#essay-guide-launcher")?.setAttribute("aria-expanded", "true");
    if (initialMode === "tour") {
      setModeTab("tour");
    } else {
      if (tourActive) pauseTour();
      setModeTab("ask");
      $("#essay-guide-input")?.focus();
    }
  };

  const closePanel = () => {
    panelOpen = false;
    pauseTour();
    document.body.classList.remove("essay-guide-panel-open");
    const root = $("#essay-guide");
    root?.classList.remove("is-open");
    root?.setAttribute("aria-hidden", "true");
    $("#essay-guide-launcher")?.setAttribute("aria-expanded", "false");
    scheduleInvite(INVITE_RESHOW_MS);
  };

  const togglePanel = () => {
    if (panelOpen) closePanel();
    else openPanel("ask");
  };

  const buildUI = () => {
    const wrap = document.createElement("div");
    wrap.id = "essay-guide";
    wrap.className = "essay-guide";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = `
      <div class="essay-guide__bar" role="dialog" aria-labelledby="essay-guide-heading" aria-modal="false">
        <div class="essay-guide__bar-head">
          <div class="essay-guide__bar-title-wrap">
            <p class="essay-guide__kicker">Essay Guide</p>
            <h2 id="essay-guide-heading" class="essay-guide__heading">Walkthrough &amp; questions</h2>
          </div>
          <div class="essay-guide__bar-actions">
            <div class="essay-guide__tabs" role="tablist" aria-label="Guide mode">
              <button type="button" class="essay-guide__tab is-active" id="essay-guide-tab-ask" data-mode="ask" role="tab" aria-selected="true" aria-controls="essay-guide-panel-ask">Ask</button>
              <button type="button" class="essay-guide__tab" id="essay-guide-tab-tour" data-mode="tour" role="tab" aria-selected="false" aria-controls="essay-guide-panel-tour">Walkthrough</button>
            </div>
            <button type="button" class="essay-guide__close ghost-btn ghost-btn--icon" aria-label="Close guide"><span class="ghost-btn__text" aria-hidden="true">×</span></button>
          </div>
        </div>
        <div id="essay-guide-panel-ask" class="essay-guide__panel" role="tabpanel" aria-labelledby="essay-guide-tab-ask">
          <div id="essay-guide-log" class="essay-guide__log" aria-live="polite" aria-relevant="additions"></div>
          <div id="essay-guide-suggestions" class="essay-guide__suggestions"></div>
          <form class="essay-guide__form" id="essay-guide-form">
            <label class="visually-hidden" for="essay-guide-input">Ask about this essay</label>
            <input id="essay-guide-input" class="essay-guide__input" type="text" placeholder="Ask about this essay…" autocomplete="off" />
            <button type="submit" class="essay-guide__send">Ask</button>
          </form>
          <p class="essay-guide__disclaimer">Answers come from this essay and its data. Not financial or policy advice.</p>
        </div>
        <div id="essay-guide-panel-tour" class="essay-guide__panel is-hidden" role="tabpanel" aria-labelledby="essay-guide-tab-tour" hidden>
          <p id="essay-guide-tour-progress" class="essay-guide__tour-progress mono"></p>
          <h3 id="essay-guide-tour-title" class="essay-guide__tour-title"></h3>
          <p id="essay-guide-tour-narration" class="essay-guide__tour-narration"></p>
          <div class="essay-guide__tour-nav">
            <button type="button" id="essay-guide-tour-prev" class="essay-guide__tour-btn ghost-btn"><span class="ghost-btn__text">Previous</span></button>
            <button type="button" id="essay-guide-tour-exit" class="essay-guide__tour-btn ghost-btn"><span class="ghost-btn__text">Exit tour</span></button>
            <button type="button" id="essay-guide-tour-next" class="essay-guide__next-btn">Next section →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const invite = document.createElement("aside");
    invite.id = "essay-guide-invite";
    invite.className = "essay-guide-invite";
    invite.setAttribute("role", "dialog");
    invite.setAttribute("aria-labelledby", "essay-guide-invite-title");
    invite.setAttribute("aria-live", "polite");
    invite.setAttribute("aria-hidden", "true");
    invite.innerHTML = `
      <button type="button" class="essay-guide-invite__close" aria-label="Dismiss">×</button>
      <p class="essay-guide-invite__kicker">Essay Guide</p>
      <h2 id="essay-guide-invite-title" class="essay-guide-invite__title">Would you like a walkthrough?</h2>
      <p class="essay-guide-invite__lede">Take an 11-step tour of this essay or ask questions grounded in the charts and sources. The Guide panel opens alongside the page so you can keep reading.</p>
      <div class="essay-guide-invite__actions">
        <button type="button" class="essay-guide-invite__primary" id="essay-guide-invite-tour">Start walkthrough</button>
        <button type="button" class="essay-guide-invite__secondary" id="essay-guide-invite-ask">Ask a question</button>
        <button type="button" class="essay-guide-invite__dismiss" id="essay-guide-invite-dismiss">Not now</button>
      </div>
    `;
    document.body.appendChild(invite);

    invite.querySelector(".essay-guide-invite__close")?.addEventListener("click", () => hideInvite(true));
    $("#essay-guide-invite-dismiss")?.addEventListener("click", () => hideInvite(true));
    $("#essay-guide-invite-tour")?.addEventListener("click", () => openPanel("tour"));
    $("#essay-guide-invite-ask")?.addEventListener("click", () => openPanel("ask"));

    const launcher = document.createElement("button");
    launcher.id = "essay-guide-launcher";
    launcher.type = "button";
    launcher.className = "essay-guide__launcher ghost-btn";
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "essay-guide");
    launcher.innerHTML = '<span class="ghost-btn__text">Guide</span>';
    const topbarInner = $(".topbar-inner");
    const themeBtn = $("#theme-toggle");
    if (topbarInner && themeBtn) {
      topbarInner.insertBefore(launcher, themeBtn);
    } else {
      launcher.classList.add("essay-guide__launcher--float");
      document.body.appendChild(launcher);
    }

    launcher.addEventListener("click", togglePanel);
    wrap.querySelector(".essay-guide__close")?.addEventListener("click", closePanel);
    $$(".essay-guide__tab", wrap).forEach((tab) => {
      tab.addEventListener("click", () => setModeTab(tab.dataset.mode));
    });
    $("#essay-guide-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#essay-guide-input");
      const val = input?.value;
      if (input) input.value = "";
      handleAsk(val);
    });
    $("#essay-guide-tour-prev")?.addEventListener("click", tourPrev);
    $("#essay-guide-tour-next")?.addEventListener("click", tourNext);
    $("#essay-guide-tour-exit")?.addEventListener("click", () => {
      resetTour();
      setModeTab("ask");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && inviteVisible) {
        e.preventDefault();
        hideInvite(true);
        return;
      }
      if (e.key === "Escape" && panelOpen) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (!panelOpen || mode !== "tour") return;
      if (e.key === "ArrowRight") tourNext();
      if (e.key === "ArrowLeft") tourPrev();
    });

    let scrollTick = false;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollTick || mode !== "ask" || !panelOpen) return;
        scrollTick = true;
        requestAnimationFrame(() => {
          scrollTick = false;
          if (mode === "ask" && panelOpen) refreshSuggestedChips();
        });
      },
      { passive: true }
    );
  };

  const clearLegacyInviteDismiss = () => {
    try {
      [
        "econ30-guide-invite-dismissed",
        "econ30-guide-invite-dismissed-v2",
        "econ30-guide-invite-dismissed-v3",
        "econ30-guide-invite-dismissed-session",
      ].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    } catch { /* ignore */ }
  };

  const boot = async () => {
    buildUI();
    wireAskAnything();
    pauseTour();
    clearLegacyInviteDismiss();
    scheduleInvite();

    try {
      const [corpusRes, tourRes] = await Promise.all([
        fetch("data/essay_corpus.json"),
        fetch("data/tour.json"),
      ]);
      if (corpusRes.ok) corpus = await corpusRes.json();
      if (tourRes.ok) tour = await tourRes.json();
      corpusVocab = null;
    } catch (e) {
      console.warn("Essay Guide: could not load data", e);
    }

    if (mode === "tour" && panelOpen && getTourSteps().length) {
      tourActive = true;
      renderTourStep();
    }

    const guideLog = $("#essay-guide-log");
    if (guideLog) {
      appendMessage(
        "assistant",
        `<p>Hi. I can walk you through <strong>The Price of Integration</strong> or answer questions about the argument, methods, data, and South African context around this essay.</p>
         <p>Try <strong>Walkthrough</strong> for an 11-step tour, or ask below (e.g. main findings, what data you use, or why unemployment stayed high).</p>`,
        [guideLog]
      );
    }
    refreshSuggestedChips();

    if (!inviteVisible && !inviteDismissed() && !panelOpen) {
      scheduleInvite(0);
    }

    // Probe API only on deployed hosts (/api/chat is a Vercel function, not static files)
    const isLocal =
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.hostname === "[::1]";
    if (isLocal) {
      apiAvailable = false;
    } else {
      fetch("/api/chat", { method: "HEAD" }).then((r) => {
        apiAvailable = r.ok;
      }).catch(() => {
        apiAvailable = false;
      });
    }

  };

  const onPageReady = () => {
    if (!inviteVisible && !inviteDismissed() && !panelOpen) {
      scheduleInvite(0);
    }
  };

  window.addEventListener("econ30-theme-chosen", () => {
    if (!inviteDismissed() && !panelOpen) scheduleInvite(800);
  });
  window.addEventListener("load", onPageReady);
  window.addEventListener("pageshow", (e) => {
    if (!panelOpen && tourActive) pauseTour();
    if (e.persisted && !inviteDismissed() && !panelOpen) {
      scheduleInvite(INVITE_RESHOW_MS);
    }
  });
  if (document.readyState === "complete") {
    onPageReady();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
