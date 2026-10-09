(() => {
  const STORAGE_KEY = "evergreen-scrapbook-v1";
  const state = { open: false, editing: false, spread: 0, activeImageSlot: null, saveTimer: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const cover = $("#cover");
  const pages = $("#pages");
  const controls = $("#bookControls");
  const editor = $("#editorPanel");
  const editButton = $("#editButton");
  const imageInput = $("#imageInput");
  const importInput = $("#importInput");
  const turningPage = $("#turningPage");
  const spreads = $$(".spread");

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function sanitizeEditableHTML(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value);
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
      node.childNodes.forEach((child) => copySafe(child, parent));
    }

    template.content.childNodes.forEach((node) => copySafe(node, output));
    const container = document.createElement("div");
    container.appendChild(output);
    return container.innerHTML;
  }

  function openBook() {
    state.open = true;
    document.body.classList.add("book-open");
    pages.setAttribute("aria-hidden", "false");
    window.setTimeout(() => { controls.hidden = false; }, 550);
    updateNavigation();
  }

  function closeBook() {
    state.open = false;
    controls.hidden = true;
    document.body.classList.remove("book-open");
    pages.setAttribute("aria-hidden", "true");
  }

  function updateNavigation() {
    spreads.forEach((spread, index) => { spread.hidden = index !== state.spread; });
    $("#previousButton").disabled = state.spread === 0;
    $("#nextButton").disabled = state.spread === spreads.length - 1;
    $("#pageLabel").textContent = `Pages ${state.spread * 2 + 1}–${state.spread * 2 + 2}`;
    $$("#progressDots button").forEach((dot, index) => dot.classList.toggle("active", index === state.spread));
  }

  function turnTo(index) {
    if (index < 0 || index >= spreads.length || index === state.spread || turningPage.classList.length > 1) return;
    const direction = index > state.spread ? "turn-forward" : "turn-back";
    turningPage.classList.add(direction);
    window.setTimeout(() => {
      state.spread = index;
      updateNavigation();
    }, 340);
    window.setTimeout(() => turningPage.classList.remove(direction), 780);
  }

  function toggleEditor(force) {
    state.editing = typeof force === "boolean" ? force : !state.editing;
    document.body.classList.toggle("editing", state.editing);
    editor.classList.toggle("open", state.editing);
    editor.setAttribute("aria-hidden", String(!state.editing));
    editButton.setAttribute("aria-pressed", String(state.editing));
    $(".button-label", editButton).textContent = state.editing ? "Done editing" : "Edit scrapbook";
    $$(".editable-text").forEach((node) => node.setAttribute("contenteditable", String(state.editing)));
    if (state.editing && !state.open) openBook();
    if (!state.editing) saveProject();
  }

  function serializeProject() {
    const text = $$(".editable-text").map((node, index) => ({ index, html: node.innerHTML }));
    const images = $$("[data-image-slot]").map((node) => ({ slot: node.dataset.imageSlot, image: node.style.backgroundImage || "" }));
    const positions = $$("[data-draggable]").map((node, index) => ({
      index, left: node.style.left || "", top: node.style.top || "", transform: node.style.transform || ""
    }));
    const userStickers = $$(".user-sticker").map((node) => ({
      value: node.textContent,
      parent: node.parentElement?.dataset.spread ?? "cover",
      left: node.style.left,
      top: node.style.top
    }));
    return { version: 1, text, images, positions, userStickers, updatedAt: new Date().toISOString() };
  }

  function saveProject() {
    try {
      $("#saveStatus").textContent = "Saving…";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject()));
      window.setTimeout(() => { $("#saveStatus").textContent = "Saved locally"; }, 300);
    } catch {
      $("#saveStatus").textContent = "Could not save";
      showToast("That image may be too large for browser storage.");
    }
  }

  function scheduleSave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveProject, 450);
  }

  function restoreProject(project) {
    if (!project || project.version !== 1) throw new Error("Unsupported backup format");
    const textNodes = $$(".editable-text");
    project.text?.forEach(({ index, html }) => {
      if (textNodes[index]) textNodes[index].innerHTML = sanitizeEditableHTML(html);
    });
    project.images?.forEach(({ slot, image }) => {
      const node = document.querySelector(`[data-image-slot="${CSS.escape(slot)}"]`);
      if (node && image) {
        node.style.backgroundImage = image;
        node.classList.add("has-image");
      }
    });
    const draggableNodes = $$("[data-draggable]");
    project.positions?.forEach(({ index, left, top, transform }) => {
      const node = draggableNodes[index];
      if (node) {
        node.style.left = left;
        node.style.top = top;
        node.style.transform = transform;
      }
    });
    $$(".user-sticker").forEach((node) => node.remove());
    project.userStickers?.forEach(addUserSticker);
  }

  function loadProject() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restoreProject(JSON.parse(saved));
    } catch {
      showToast("The saved scrapbook could not be restored.");
    }
  }

  function chooseImage(event) {
    if (!state.editing) return;
    state.activeImageSlot = event.currentTarget.dataset.imageSlot;
    imageInput.click();
  }

  function applyImage(file) {
    if (!file || !file.type.startsWith("image/") || !state.activeImageSlot) return;
    const reader = new FileReader();
    reader.onload = () => {
      const target = document.querySelector(`[data-image-slot="${CSS.escape(state.activeImageSlot)}"]`);
      if (!target) return;
      target.style.backgroundImage = `url("${reader.result}")`;
      target.classList.add("has-image");
      saveProject();
      showToast("Photo added");
    };
    reader.readAsDataURL(file);
  }

  function makeDraggable(node) {
    let active = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    node.addEventListener("pointerdown", (event) => {
      if (!state.editing || event.target.closest('[contenteditable="true"]')) return;
      active = true;
      const parent = node.offsetParent;
      const parentRect = parent.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left - parentRect.left;
      originTop = rect.top - parentRect.top;
      node.style.left = `${originLeft}px`;
      node.style.top = `${originTop}px`;
      node.style.right = "auto";
      node.style.bottom = "auto";
      node.classList.add("dragging");
      node.setPointerCapture(event.pointerId);
    });

    node.addEventListener("pointermove", (event) => {
      if (!active) return;
      const parent = node.offsetParent;
      const maxLeft = parent.clientWidth - node.offsetWidth;
      const maxTop = parent.clientHeight - node.offsetHeight;
      node.style.left = `${Math.max(0, Math.min(maxLeft, originLeft + event.clientX - startX))}px`;
      node.style.top = `${Math.max(0, Math.min(maxTop, originTop + event.clientY - startY))}px`;
    });

    const stop = () => {
      if (!active) return;
      active = false;
      node.classList.remove("dragging");
      scheduleSave();
    };
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
  }

  function addUserSticker(data) {
    const parent = data.parent === "cover" ? cover : spreads[Number(data.parent)] || spreads[state.spread];
    const sticker = document.createElement("button");
    sticker.type = "button";
    sticker.className = "user-sticker";
    sticker.dataset.draggable = "";
    sticker.textContent = data.value;
    sticker.style.left = data.left || "44%";
    sticker.style.top = data.top || "44%";
    parent.appendChild(sticker);
    makeDraggable(sticker);
    return sticker;
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
        restoreProject(JSON.parse(reader.result));
        saveProject();
        showToast("Backup imported");
      } catch {
        showToast("This backup file is not valid.");
      }
    };
    reader.readAsText(file);
  }

  function createProgressDots() {
    spreads.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("aria-label", `Go to pages ${index * 2 + 1} and ${index * 2 + 2}`);
      dot.addEventListener("click", () => turnTo(index));
      $("#progressDots").appendChild(dot);
    });
  }

  $("#openBookButton").addEventListener("click", openBook);
  $("#closeBookButton").addEventListener("click", closeBook);
  $("#nextButton").addEventListener("click", () => turnTo(state.spread + 1));
  $("#previousButton").addEventListener("click", () => turnTo(state.spread - 1));
  editButton.addEventListener("click", () => toggleEditor());
  $("#closeEditorButton").addEventListener("click", () => toggleEditor(false));
  $("#exportButton").addEventListener("click", exportProject);
  $("#importButton").addEventListener("click", () => importInput.click());
  $("#resetButton").addEventListener("click", () => {
    if (!window.confirm("Reset every text, photo, and decoration change in this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });

  imageInput.addEventListener("change", () => {
    applyImage(imageInput.files[0]);
    imageInput.value = "";
  });
  importInput.addEventListener("change", () => {
    if (importInput.files[0]) importProject(importInput.files[0]);
    importInput.value = "";
  });
  $$("[data-image-slot]").forEach((node) => node.addEventListener("click", chooseImage));
  $$("[data-draggable]").forEach(makeDraggable);
  $$(".editable-text").forEach((node) => node.addEventListener("input", scheduleSave));

  $("#stickerPicker").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sticker]");
    if (!button) return;
    addUserSticker({
      value: button.dataset.sticker,
      parent: String(state.spread),
      left: `${38 + Math.random() * 18}%`,
      top: `${34 + Math.random() * 20}%`
    });
    saveProject();
    showToast("Sticker added—drag it into place");
  });

  document.addEventListener("keydown", (event) => {
    if (!state.open || state.editing) return;
    if (event.key === "ArrowRight") turnTo(state.spread + 1);
    if (event.key === "ArrowLeft") turnTo(state.spread - 1);
    if (event.key === "Escape") closeBook();
  });

  createProgressDots();
  loadProject();
  updateNavigation();
})();
