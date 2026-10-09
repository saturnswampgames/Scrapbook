(() => {
  "use strict";

  const STORAGE_KEY = "evergreen-scrapbook-v2";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    editing: false,
    activeImageSlot: null,
    saveTimer: null,
    flip: null,
    pageCount: 0,
    originalPages: []
  };

  const flipbook = $("#flipbook");
  const bookFrame = $("#bookFrame");
  const editor = $("#editorPanel");
  const editButton = $("#editButton");
  const imageInput = $("#imageInput");
  const importInput = $("#importInput");

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2300);
  }

  function sanitizeEditableHTML(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value ?? "");
    const output = document.createDocumentFragment();

    function copySafe(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeName === "BR") {
        parent.appendChild(document.createElement("br"));
        return;
      }
      const block = node.nodeName === "DIV" || node.nodeName === "P";
      if (block && parent.childNodes.length) parent.appendChild(document.createElement("br"));
      node.childNodes.forEach((child) => copySafe(child, parent));
    }

    template.content.childNodes.forEach((node) => copySafe(node, output));
    const container = document.createElement("div");
    container.appendChild(output);
    return container.innerHTML;
  }

  function uniqueByKey(selector, attribute) {
    const seen = new Set();
    return $$(selector).filter((node) => {
      const key = node.getAttribute(attribute);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function serializeProject() {
    const texts = {};
    uniqueByKey("[data-edit-key]", "data-edit-key").forEach((node) => {
      texts[node.dataset.editKey] = node.innerHTML;
    });

    const images = {};
    uniqueByKey("[data-image-slot]", "data-image-slot").forEach((node) => {
      images[node.dataset.imageSlot] = node.dataset.image || "";
    });

    const positions = {};
    uniqueByKey("[data-item-key]", "data-item-key").forEach((node) => {
      positions[node.dataset.itemKey] = {
        left: node.style.left || "",
        top: node.style.top || "",
        right: node.style.right || "",
        bottom: node.style.bottom || "",
        transform: node.style.transform || ""
      };
    });

    const stickers = $$(".user-sticker[data-original='true']").map((node) => ({
      id: node.dataset.stickerId,
      value: node.textContent,
      pageId: node.closest(".book-page")?.dataset.pageId || "page-0",
      left: node.style.left,
      top: node.style.top
    }));

    return { version: 2, texts, images, positions, stickers, updatedAt: new Date().toISOString() };
  }

  function saveProject() {
    try {
      $("#saveStatus").textContent = "Saving…";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject()));
      setTimeout(() => { $("#saveStatus").textContent = "Saved locally"; }, 280);
    } catch {
      $("#saveStatus").textContent = "Could not save";
      showToast("Browser storage is full. Export a backup, then use smaller images.");
    }
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveProject, 420);
  }

  function syncText(key, html, source) {
    $$("[data-edit-key]").forEach((node) => {
      if (node !== source && node.dataset.editKey === key) node.innerHTML = html;
    });
  }

  function applyImageToSlot(slot, dataUrl) {
    $$("[data-image-slot]").forEach((node) => {
      if (node.dataset.imageSlot !== slot) return;
      node.dataset.image = dataUrl;
      node.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : "";
      node.classList.toggle("has-image", Boolean(dataUrl));
    });
  }

  function addSticker(data, restored = false) {
    const page = state.originalPages.find((item) => item.dataset.pageId === data.pageId)
      || state.originalPages[Math.min(state.flip?.getCurrentPageIndex?.() || 0, state.originalPages.length - 1)];
    const surface = $(".page-surface", page);
    if (!surface) return;

    const sticker = document.createElement("button");
    sticker.type = "button";
    sticker.className = "user-sticker draggable";
    sticker.dataset.original = "true";
    sticker.dataset.stickerId = data.id || `sticker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sticker.dataset.itemKey = sticker.dataset.stickerId;
    sticker.textContent = data.value;
    sticker.style.left = data.left || "44%";
    sticker.style.top = data.top || "44%";
    surface.appendChild(sticker);

    if (!restored) {
      saveProject();
      refreshBook();
    }
  }

  function restoreProject(project) {
    if (!project || project.version !== 2) return;

    Object.entries(project.texts || {}).forEach(([key, html]) => {
      const clean = sanitizeEditableHTML(html);
      $$("[data-edit-key]").forEach((node) => {
        if (node.dataset.editKey === key) node.innerHTML = clean;
      });
    });

    Object.entries(project.images || {}).forEach(([slot, dataUrl]) => {
      if (typeof dataUrl === "string") applyImageToSlot(slot, dataUrl);
    });

    Object.entries(project.positions || {}).forEach(([key, position]) => {
      $$("[data-item-key]").forEach((node) => {
        if (node.dataset.itemKey !== key) return;
        ["left", "top", "right", "bottom", "transform"].forEach((property) => {
          node.style[property] = position[property] || "";
        });
      });
    });

    project.stickers?.forEach((sticker) => addSticker(sticker, true));
  }

  function loadProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restoreProject(JSON.parse(saved));
    } catch {
      showToast("The saved scrapbook could not be restored.");
    }
  }

  async function compressImage(file) {
    const source = await createImageBitmap(file);
    const limit = 1600;
    const scale = Math.min(1, limit / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#f5eedf";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close();
    return canvas.toDataURL("image/jpeg", 0.86);
  }

  async function chooseImage(file) {
    if (!file || !file.type.startsWith("image/") || !state.activeImageSlot) return;
    try {
      $("#saveStatus").textContent = "Preparing photo…";
      const dataUrl = await compressImage(file);
      const preload = new Image();
      preload.src = dataUrl;
      if (preload.decode) await preload.decode();
      applyImageToSlot(state.activeImageSlot, dataUrl);
      saveProject();
      showToast("Photo added");
    } catch {
      showToast("This image could not be added.");
    }
  }

  function refreshBook() {
    if (!state.flip) return;
    const index = state.flip.getCurrentPageIndex();
    state.flip.updateFromHtml(state.originalPages);
    state.flip.turnToPage(Math.min(index, state.originalPages.length - 1));
    setEditorState(state.editing);
  }

  function setEditorState(enabled) {
    state.editing = enabled;
    document.body.classList.toggle("editing", enabled);
    editor.classList.toggle("open", enabled);
    editor.setAttribute("aria-hidden", String(!enabled));
    editButton.setAttribute("aria-pressed", String(enabled));
    $(".button-label", editButton).textContent = enabled ? "Done editing" : "Edit scrapbook";

    $$("[data-edit-key]").forEach((node) => {
      node.setAttribute("contenteditable", String(enabled));
      node.spellcheck = enabled;
    });

    if (!enabled) saveProject();
  }

  function updateStatus(index = 0) {
    const last = Math.max(0, state.pageCount - 1);
    let label = "Cover";
    if (index >= last) label = "Back cover";
    else if (index > 0) {
      const left = index % 2 === 0 ? index - 1 : index;
      label = `Pages ${left}–${Math.min(left + 1, last - 1)}`;
    }
    $("#pageLabel").textContent = label;
    $("#pageProgress").style.width = `${last ? (index / last) * 100 : 0}%`;
    $("#previousButton").disabled = index <= 0;
    $("#nextButton").disabled = index >= last;
  }

  function initFlipbook() {
    if (!window.St?.PageFlip) {
      document.body.classList.add("library-failed");
      showToast("The page-turn engine could not load. Please refresh.");
      return;
    }

    state.flip = new St.PageFlip(flipbook, {
      width: 430,
      height: 610,
      size: "stretch",
      minWidth: 285,
      maxWidth: 430,
      minHeight: 404,
      maxHeight: 610,
      maxShadowOpacity: 0.48,
      showCover: true,
      usePortrait: true,
      autoSize: true,
      mobileScrollSupport: false,
      swipeDistance: 24,
      flippingTime: 1050,
      drawShadow: true,
      clickEventForward: true,
      disableFlipByClick: false
    });

    state.flip.on("init", (event) => {
      state.pageCount = state.flip.getPageCount();
      updateStatus(event.data.page);
      setEditorState(false);
    });

    state.flip.on("flip", (event) => {
      updateStatus(event.data);
    });

    state.flip.on("changeState", (event) => {
      bookFrame.classList.toggle("is-dragging", event.data === "user_fold" || event.data === "flipping");
    });

    state.flip.loadFromHTML(state.originalPages);
  }

  function setupParallax() {
    const scene = $("#bookScene");
    scene.addEventListener("pointermove", (event) => {
      if (state.editing || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const rect = scene.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      bookFrame.style.setProperty("--tilt-x", `${2 - y * 5}deg`);
      bookFrame.style.setProperty("--tilt-y", `${-4 + x * 7}deg`);
    });
    scene.addEventListener("pointerleave", () => {
      bookFrame.style.setProperty("--tilt-x", "2deg");
      bookFrame.style.setProperty("--tilt-y", "-4deg");
    });
  }

  function setupEditingEvents() {
    document.addEventListener("input", (event) => {
      const target = event.target.closest("[data-edit-key]");
      if (!target || !state.editing) return;
      syncText(target.dataset.editKey, target.innerHTML, target);
      scheduleSave();
    });

    document.addEventListener("click", (event) => {
      const image = event.target.closest("[data-image-slot]");
      if (image && state.editing) {
        event.preventDefault();
        event.stopPropagation();
        state.activeImageSlot = image.dataset.imageSlot;
        imageInput.click();
      }
    }, true);

    let drag = null;
    document.addEventListener("pointerdown", (event) => {
      const target = event.target.closest(".draggable");
      if (!target || !state.editing || event.target.closest("[contenteditable=true]")) return;
      event.preventDefault();
      event.stopPropagation();
      const parent = target.offsetParent;
      const parentRect = parent.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      drag = {
        target,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top
      };
      target.style.left = `${drag.left}px`;
      target.style.top = `${drag.top}px`;
      target.style.right = "auto";
      target.style.bottom = "auto";
      target.classList.add("dragging");
      target.setPointerCapture?.(event.pointerId);
    }, true);

    document.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      const parent = drag.target.offsetParent;
      const maxLeft = parent.clientWidth - drag.target.offsetWidth;
      const maxTop = parent.clientHeight - drag.target.offsetHeight;
      drag.target.style.left = `${Math.max(0, Math.min(maxLeft, drag.left + event.clientX - drag.startX))}px`;
      drag.target.style.top = `${Math.max(0, Math.min(maxTop, drag.top + event.clientY - drag.startY))}px`;
    }, true);

    const stopDrag = () => {
      if (!drag) return;
      drag.target.classList.remove("dragging");
      drag = null;
      scheduleSave();
    };
    document.addEventListener("pointerup", stopDrag, true);
    document.addEventListener("pointercancel", stopDrag, true);
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "evergreen-scrapbook-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Backup exported");
  }

  function importProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(reader.result);
        if (project.version !== 2) throw new Error("Unsupported format");
        restoreProject(project);
        saveProject();
        refreshBook();
        showToast("Backup imported");
      } catch {
        showToast("This backup is not compatible.");
      }
    };
    reader.readAsText(file);
  }

  state.originalPages = $$(".book-page");
  state.originalPages.forEach((page, index) => { page.dataset.pageId = `page-${index}`; });
  loadProject();
  setupParallax();
  setupEditingEvents();
  initFlipbook();

  $("#previousButton").addEventListener("click", () => state.flip?.flipPrev("bottom"));
  $("#nextButton").addEventListener("click", () => state.flip?.flipNext("bottom"));
  editButton.addEventListener("click", () => setEditorState(!state.editing));
  $("#closeEditorButton").addEventListener("click", () => setEditorState(false));
  $("#exportButton").addEventListener("click", exportProject);
  $("#importButton").addEventListener("click", () => importInput.click());

  imageInput.addEventListener("change", () => {
    chooseImage(imageInput.files[0]);
    imageInput.value = "";
  });
  importInput.addEventListener("change", () => {
    if (importInput.files[0]) importProject(importInput.files[0]);
    importInput.value = "";
  });

  $("#stickerPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sticker]");
    if (!button) return;
    const pageIndex = state.flip?.getCurrentPageIndex?.() || 0;
    addSticker({
      value: button.dataset.sticker,
      pageId: `page-${Math.min(pageIndex, state.originalPages.length - 1)}`,
      left: `${38 + Math.random() * 18}%`,
      top: `${34 + Math.random() * 20}%`
    });
    showToast("Sticker added—drag it into place");
  });

  $("#resetButton").addEventListener("click", () => {
    if (!confirm("Reset every text, photo, and decoration change in this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  document.addEventListener("keydown", (event) => {
    if (state.editing) return;
    if (event.key === "ArrowRight") state.flip?.flipNext("bottom");
    if (event.key === "ArrowLeft") state.flip?.flipPrev("bottom");
  });
})();
