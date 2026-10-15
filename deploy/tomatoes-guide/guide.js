(() => {
  "use strict";
  const chapters = [...document.querySelectorAll(".chapter")];
  const links = [...document.querySelectorAll("#chapterNav a")];
  const toc = document.querySelector(".toc");
  if (window.matchMedia("(max-width: 900px)").matches) toc.open = false;
  links.forEach((link) => link.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 900px)").matches) toc.open = false;
  }));
  const printButton = document.getElementById("printGuide");
  printButton.hidden = false;
  printButton.addEventListener("click", () => window.print());
  // Include all FAQ answers when printing, restoring the reader's state afterwards.
  let openBeforePrint = [];
  window.addEventListener("beforeprint", () => {
    openBeforePrint = [...document.querySelectorAll(".faq-list details")].map((node) => [node, node.open]);
    openBeforePrint.forEach(([node]) => { node.open = true; });
  });
  window.addEventListener("afterprint", () => openBeforePrint.forEach(([node, open]) => { node.open = open; }));
  document.getElementById("searchBox").hidden = false;
  const search = document.getElementById("guideSearch");
  const results = document.getElementById("searchResults");
  const entries = chapters.map((node) => ({ id: node.id, title: node.querySelector("h2").textContent, text: node.textContent.toLocaleLowerCase() }));
  search.addEventListener("input", () => {
    results.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) return;
    const matches = entries.filter((entry) => query.split(/\s+/).every((word) => entry.text.includes(word)));
    if (!matches.length) { results.textContent = "没有找到相关章节，试试“计时”“回顾”“备份”或“同步”。"; return; }
    const note = document.createElement("p");
    note.textContent = `找到 ${matches.length} 个相关章节，点击跳转：`;
    results.append(note);
    matches.forEach((entry) => {
      const link = document.createElement("a");
      link.href = `#${entry.id}`;
      link.textContent = entry.title;
      results.append(link);
    });
  });
  if ("IntersectionObserver" in window) {
    const visible = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id));
      const current = chapters.find((node) => visible.has(node.id));
      if (current) links.forEach((link) => {
        const active = link.hash === `#${current.id}`;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-90px 0px -55% 0px" });
    chapters.forEach((node) => observer.observe(node));
  }
})();
