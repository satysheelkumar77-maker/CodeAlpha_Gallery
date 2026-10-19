(function () {
  // ---- series / categories the user can file photos under ----
  const series = [
    { key: "nature",   label: "Nature" },
    { key: "urban",    label: "Urban" },
    { key: "portrait", label: "Portrait" },
    { key: "abstract", label: "Abstract" }
  ];
  const customFolders = loadCustomFolders();
  series.push(...customFolders);

  const ratios = ["4/5", "1/1", "3/4", "5/4", "4/3"];

  let plates = loadPlates(); // { id, category, categoryLabel, title, meta, src, ar }
  let active = "all";
  let currentIndex = 0; // index within the currently filtered list
  let nextId = plates.reduce((highest, plate) => Math.max(highest, plate.id), -1) + 1;

  function loadPlates() {
    try {
      return JSON.parse(localStorage.getItem("aperture-plates") || "[]");
    } catch (error) {
      return [];
    }
  }

  function savePlates() {
    const records = plates.map(plate => {
      const record = { ...plate };
      if (record.mediaKey || record.mediaMissing) delete record.src;
      return record;
    });
    localStorage.setItem("aperture-plates", JSON.stringify(records));
  }

  const mediaDatabase = openMediaDatabase();

  function openMediaDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("Persistent browser storage is unavailable."));
        return;
      }

      const request = window.indexedDB.open("stylish-gallery-media", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("media")) {
          database.createObjectStore("media", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open media storage."));
    });
  }

  async function storeMediaFile(id, file) {
    const database = await mediaDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      transaction.objectStore("media").put({ id, file });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save this file."));
      transaction.onabort = () => reject(transaction.error || new Error("Saving this file was cancelled."));
    });
  }

  async function getStoredMediaFile(id) {
    const database = await mediaDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readonly");
      const request = transaction.objectStore("media").get(id);
      request.onsuccess = () => resolve(request.result?.file || null);
      request.onerror = () => reject(request.error || new Error("Could not read saved media."));
    });
  }

  async function removeStoredMediaFiles(ids) {
    if (!ids.length) return;
    const database = await mediaDatabase;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      const store = transaction.objectStore("media");
      ids.forEach(id => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove saved media."));
      transaction.onabort = () => reject(transaction.error || new Error("Removing saved media was cancelled."));
    });
  }

  function removeStoredMediaFile(id) {
    return id === undefined || id === null ? Promise.resolve() : removeStoredMediaFiles([id]);
  }

  async function restoreMediaSources() {
    let updatedSizes = false;
    await Promise.all(plates.map(async plate => {
      if (plate.mediaKey !== undefined && plate.mediaKey !== null) {
        try {
          const file = await getStoredMediaFile(plate.mediaKey);
          if (file) {
            plate.src = URL.createObjectURL(file);
            plate.mediaMissing = false;
            if (typeof plate.sizeBytes !== "number") {
              plate.sizeBytes = file.size;
              updatedSizes = true;
            }
          } else {
            plate.mediaMissing = true;
          }
        } catch (error) {
          plate.mediaMissing = true;
        }
      } else if (typeof plate.src === "string" && plate.src.startsWith("blob:")) {
        plate.mediaMissing = true;
      }
    }));
    if (updatedSizes) savePlates();
  }

  function mediaSizeBytes(plate) {
    if (typeof plate.sizeBytes === "number") return plate.sizeBytes;
    const match = plate.meta.match(/([\d.]+)\s*(KB|MB)/i);
    if (!match) return 0;
    const unit = match[2].toUpperCase();
    return Number(match[1]) * (unit === "MB" ? 1024 * 1024 : 1024);
  }

  function formatStorage(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function loadCustomFolders() {
    try {
      return JSON.parse(localStorage.getItem("aperture-folders") || "[]");
    } catch (error) {
      return [];
    }
  }

  // ---- category <select> in the uploader ----
  const categorySelect = document.getElementById("categorySelect");
  series.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.label;
    categorySelect.appendChild(opt);
  });

  // ---- filter buttons ----
  const filtersEl = document.getElementById("filters");
  filtersEl.appendChild(makeFilterBtn("all", "All"));
  const photosFilterBtn = makeFilterBtn("photos", "Photos");
  photosFilterBtn.setAttribute("aria-expanded", "false");
  photosFilterBtn.setAttribute("aria-controls", "photoFolders");
  filtersEl.appendChild(photosFilterBtn);
  const photoFoldersEl = document.createElement("div");
  photoFoldersEl.id = "photoFolders";
  photoFoldersEl.className = "photo-folders";
  photoFoldersEl.setAttribute("role", "group");
  photoFoldersEl.setAttribute("aria-label", "Photo folders");
  photoFoldersEl.hidden = true;
  filtersEl.appendChild(photoFoldersEl);
  filtersEl.appendChild(makeFilterBtn("favorites", "Favorites"));
  series.forEach(s => photoFoldersEl.appendChild(makeFilterBtn(s.key, s.label)));
  filtersEl.appendChild(makeFilterBtn("videos", "Videos"));
  filtersEl.appendChild(makeFilterBtn("bin", "Bin"));

  function makeFilterBtn(key, label) {
    const b = document.createElement("button");
    b.className = "filter-btn" + (key === "all" ? " active" : "");
    b.dataset.key = key;
    const labelEl = document.createElement("span");
    labelEl.className = "filter-label";
    labelEl.textContent = label;
    const statsEl = document.createElement("span");
    statsEl.className = "filter-stats";
    b.append(labelEl, statsEl);
    b.addEventListener("click", () => {
      if (key === "photos") {
        photoFoldersEl.hidden = !photoFoldersEl.hidden;
        photosFilterBtn.setAttribute("aria-expanded", String(!photoFoldersEl.hidden));
      } else if (!photoFoldersEl.contains(b)) {
        photoFoldersEl.hidden = true;
        photosFilterBtn.setAttribute("aria-expanded", "false");
      }
      active = key;
      document.querySelectorAll(".filter-btn").forEach(el => el.classList.toggle("active", el.dataset.key === key));
      document.getElementById("emptyBin").hidden = key !== "bin" || !plates.some(p => p.deleted);
      render();
    });
    b.addEventListener("contextmenu", event => {
      if (!customFolders.some(folder => folder.key === key)) return;
      event.preventDefault();
      contextFolderKey = key;
      folderContextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 170)}px`;
      folderContextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 52)}px`;
      folderContextMenu.hidden = false;
    });
    return b;
  }

  const folderContextMenu = document.getElementById("folderContextMenu");
  let contextFolderKey = null;

  document.getElementById("deleteFolderAction").addEventListener("click", () => {
    const folderIndex = customFolders.findIndex(folder => folder.key === contextFolderKey);
    if (folderIndex < 0) return;

    const folder = customFolders[folderIndex];
    folderContextMenu.hidden = true;
    if (!window.confirm(`Delete folder "${folder.label}"? Its photos will stay in All Photos.`)) return;

    customFolders.splice(folderIndex, 1);
    const seriesIndex = series.findIndex(item => item.key === folder.key);
    if (seriesIndex >= 0) series.splice(seriesIndex, 1);
    localStorage.setItem("aperture-folders", JSON.stringify(customFolders));

    const filterButton = Array.from(photoFoldersEl.children).find(button => button.dataset.key === folder.key);
    if (filterButton) filterButton.remove();
    const categoryOption = Array.from(categorySelect.options).find(option => option.value === folder.key);
    if (categoryOption) categoryOption.remove();

    if (active === folder.key) setActiveFilter("all");
    if (categorySelect.value === folder.key) categorySelect.value = categorySelect.options[0]?.value || "";
    render();
  });

  function setActiveFilter(key) {
    active = key;
    document.querySelectorAll(".filter-btn").forEach(el => el.classList.toggle("active", el.dataset.key === key));
  }

  const moreMenuTrigger = document.getElementById("moreMenuTrigger");
  const moreMenu = document.getElementById("moreMenu");

  function closeMoreMenu() {
    moreMenu.hidden = true;
    moreMenuTrigger.setAttribute("aria-expanded", "false");
  }

  moreMenuTrigger.addEventListener("click", () => {
    const isOpen = !moreMenu.hidden;
    moreMenu.hidden = isOpen;
    moreMenuTrigger.setAttribute("aria-expanded", String(!isOpen));
  });

  moreMenu.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "new-folder") {
      const label = window.prompt("Name your new folder:")?.trim();
      if (label) {
        const key = `folder-${Date.now()}`;
        const folder = { key, label };
        customFolders.push(folder);
        series.push(folder);
        localStorage.setItem("aperture-folders", JSON.stringify(customFolders));

        const option = document.createElement("option");
        option.value = key;
        option.textContent = label;
        categorySelect.appendChild(option);
        photoFoldersEl.appendChild(makeFilterBtn(key, label));
        categorySelect.value = key;
        setActiveFilter(key);
        render();
      }
    } else if (action === "bin" || action === "favorites") {
      photoFoldersEl.hidden = true;
      photosFilterBtn.setAttribute("aria-expanded", "false");
      setActiveFilter(action);
      render();
    } else if (action === "settings") {
      document.getElementById("settingsDialog").showModal();
    }

    closeMoreMenu();
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".more-menu-wrap")) closeMoreMenu();
    if (!event.target.closest(".folder-context-menu")) folderContextMenu.hidden = true;
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMoreMenu();
      folderContextMenu.hidden = true;
    }
  });

  document.getElementById("settingsClose").addEventListener("click", () => {
    document.getElementById("settingsDialog").close();
  });

  // ---- file input: read the user's own photos ----
  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const chosenKey = categorySelect.value;
    const chosenLabel = series.find(s => s.key === chosenKey).label;

    let addedCount = 0;
    try {
      for (const [i, file] of files.entries()) {
        if (!file.type.startsWith("image/")) continue;
        const id = nextId++;
        await storeMediaFile(id, file);
        const name = file.name.replace(/\.[^/.]+$/, "");
        plates.push({
          id,
          mediaKey: id,
          category: chosenKey,
          categoryLabel: chosenLabel,
          title: name || "Untitled",
          meta: `${(file.size / 1024).toFixed(0)} KB \u00b7 added just now`,
          sizeBytes: file.size,
          src: URL.createObjectURL(file),
          ar: ratios[i % ratios.length]
        });
        addedCount++;
      }
    } catch (error) {
      window.alert("Could not save the photo. Check your browser storage space and try again.");
    }

    if (addedCount) {
      savePlates();
      setActiveFilter(chosenKey);
      render();
    }

    // allow re-selecting the same file(s) again later
    fileInput.value = "";
  });

  const videoInput = document.getElementById("videoInput");
  videoInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    let addedCount = 0;
    try {
      for (const file of files) {
        if (!file.type.startsWith("video/")) continue;
        const id = nextId++;
        await storeMediaFile(id, file);
        plates.push({
          id,
          mediaKey: id,
          type: "video",
          category: "video",
          categoryLabel: "Video",
          title: file.name.replace(/\.[^/.]+$/, "") || "Untitled",
          meta: `${(file.size / 1024 / 1024).toFixed(1)} MB \u00b7 added just now`,
          sizeBytes: file.size,
          src: URL.createObjectURL(file),
          ar: "16/9"
        });
        addedCount++;
      }
    } catch (error) {
      window.alert("Could not save the video. Check your browser storage space and try again.");
    }

    if (addedCount) {
      savePlates();
      setActiveFilter("videos");
      render();
    }
    videoInput.value = "";
  });

  // ---- gallery render ----
  const galleryEl = document.getElementById("gallery");
  const emptyEl = document.getElementById("emptyState");
  const countLabel = document.getElementById("countLabel");
  const gallerySearch = document.getElementById("gallerySearch");

  function currentList() {
    let list;
    if (active === "bin") list = plates.filter(p => p.deleted);
    else {
      const visiblePlates = plates.filter(p => !p.deleted);
      if (active === "videos") list = visiblePlates.filter(p => p.type === "video");
      else if (active === "all") list = visiblePlates;
      else if (active === "photos") list = visiblePlates.filter(p => p.type !== "video");
      else if (active === "favorites") list = visiblePlates.filter(p => p.favorite);
      else list = visiblePlates.filter(p => p.category === active);
    }

    const query = gallerySearch.value.trim().toLocaleLowerCase();
    if (!query) return list;
    return list.filter(p => `${p.title} ${p.categoryLabel} ${p.meta}`.toLocaleLowerCase().includes(query));
  }

  gallerySearch.addEventListener("input", render);

  function render() {
    const list = currentList();
    galleryEl.innerHTML = "";
    galleryEl.dataset.view = active;
    document.getElementById("emptyBin").hidden = active !== "bin" || !plates.some(p => p.deleted);
    updateFilterStats();

    if (!list.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = gallerySearch.value.trim() ? "No media matches your search."
        : active === "bin" ? "Your bin is empty. Deleted photos and videos will appear here."
        : active === "videos" ? "No videos yet. Use “+ Add videos” above to upload some."
        : active === "photos" ? "No photos yet. Use “+ Add photos” above to upload some."
        : active === "all" && plates.filter(p => !p.deleted).length === 0
        ? "No media yet — add photos or videos to your gallery."
        : active === "favorites" ? "No favorites yet — open a photo and tap the heart."
          : "Nothing filed under this series yet.";
    } else {
      emptyEl.hidden = true;
    }

    if (active === "all") {
      const totalItems = plates.filter(p => !p.deleted);
      const totalBytes = plates.reduce((total, plate) => total + mediaSizeBytes(plate), 0);
      countLabel.textContent = `Items: ${totalItems.length} \u00b7 Storage: ${formatStorage(totalBytes)}`;
    } else {
      const itemLabel = active === "videos" ? "video" : active === "bin" || active === "favorites" ? "item" : "photo";
      countLabel.textContent = `${list.length} ${itemLabel}${list.length === 1 ? "" : "s"}`;
    }

    list.forEach((p, i) => {
      const fig = document.createElement("figure");
      fig.className = "thumb-wrap";

      const btn = document.createElement("button");
      btn.className = "thumb";
      btn.setAttribute("aria-label", `Open ${p.title}, ${p.categoryLabel} series`);
      btn.disabled = !!p.mediaMissing;
      if (!p.mediaMissing) btn.addEventListener("click", () => openLightbox(i));

      if (p.mediaMissing) {
        const unavailable = document.createElement("span");
        unavailable.className = "media-unavailable";
        unavailable.textContent = "Original file unavailable";
        btn.appendChild(unavailable);
      } else {
        const art = document.createElement(p.type === "video" ? "video" : "img");
        art.className = "art";
        if (p.type === "video") {
          art.src = p.src;
          art.muted = true;
          art.loop = true;
          art.autoplay = true;
          art.playsInline = true;
          art.preload = "metadata";
          art.setAttribute("aria-label", p.title);
        } else {
          art.src = p.src;
          art.alt = p.title;
          art.loading = "lazy";
        }
        art.style.setProperty("--ar", p.ar);
        btn.appendChild(art);
      }

      const veil = document.createElement("span");
      veil.className = "thumb-veil";
      veil.innerHTML = `<span class="cap"><span class="n display">${escapeHtml(p.title)}</span><span class="m">${escapeHtml(p.categoryLabel)} &middot; ${escapeHtml(p.meta)}</span></span>`;

      btn.appendChild(veil);
      fig.appendChild(btn);

      if (active === "bin") {
        const actions = document.createElement("div");
        actions.className = "bin-actions";

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "bin-action";
        restoreBtn.type = "button";
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", () => restorePlate(p.id));

        const removeBtn = document.createElement("button");
        removeBtn.className = "bin-action bin-action-danger";
        removeBtn.type = "button";
        removeBtn.textContent = "Delete permanently";
        removeBtn.addEventListener("click", () => permanentlyDeletePlate(p.id));

        actions.append(restoreBtn, removeBtn);
        fig.appendChild(actions);
      }

      if (p.favorite) {
        const favBadge = document.createElement("span");
        favBadge.className = "fav-badge";
        favBadge.setAttribute("aria-hidden", "true");
        favBadge.innerHTML = "&#9829;";
        fig.appendChild(favBadge);
      }

      galleryEl.appendChild(fig);
    });
  }

  function updateFilterStats() {
    document.querySelectorAll(".filter-btn").forEach(button => {
      const key = button.dataset.key;
      const matching = plates.filter(plate => {
        if (key === "bin") return !!plate.deleted;
        if (plate.deleted) return false;
        if (key === "all") return true;
        if (key === "photos") return plate.type !== "video";
        if (key === "favorites") return !!plate.favorite;
        if (key === "videos") return plate.type === "video";
        return plate.category === key;
      });
      const bytes = matching.reduce((total, plate) => total + mediaSizeBytes(plate), 0);
      const stats = button.querySelector(".filter-stats");
      stats.textContent = `Items: ${matching.length} \u00b7 ${formatStorage(bytes)}`;
      stats.setAttribute("aria-label", `${matching.length} ${matching.length === 1 ? "item" : "items"}, ${formatStorage(bytes)} storage`);
    });
  }

  function deletePlate(id) {
    const p = plates.find(x => x.id === id);
    if (p) p.deleted = true;
    savePlates();
    render();
  }

  function restorePlate(id) {
    const p = plates.find(x => x.id === id);
    if (p) p.deleted = false;
    savePlates();
    render();
  }

  async function permanentlyDeletePlate(id) {
    const p = plates.find(x => x.id === id);
    try {
      await removeStoredMediaFile(p?.mediaKey);
    } catch (error) {
      window.alert("Could not permanently delete this file from browser storage.");
      return false;
    }
    if (p?.src?.startsWith("blob:")) URL.revokeObjectURL(p.src);
    plates = plates.filter(x => x.id !== id);
    savePlates();
    render();
    return true;
  }

  document.getElementById("emptyBin").addEventListener("click", async () => {
    const deletedPlates = plates.filter(p => p.deleted);
    try {
      await removeStoredMediaFiles(deletedPlates.map(p => p.mediaKey).filter(id => id !== undefined && id !== null));
    } catch (error) {
      window.alert("Could not empty the bin from browser storage. Please try again.");
      return;
    }
    deletedPlates.forEach(p => {
      if (p.src?.startsWith("blob:")) URL.revokeObjectURL(p.src);
    });
    plates = plates.filter(p => !p.deleted);
    savePlates();
    render();
  });

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- lightbox ----
  const lightbox = document.getElementById("lightbox");
  const lbArt = document.getElementById("lbArt");
  const lbVideo = document.getElementById("lbVideo");
  const lbTitle = document.getElementById("lbTitle");
  const lbMeta = document.getElementById("lbMeta");
  const lbSequence = document.getElementById("lbSequence");
  const lbFavorite = document.getElementById("lbFavorite");
  const lbDetailsBtn = document.getElementById("lbDetailsBtn");
  const lbDetailsPanel = document.getElementById("lbDetailsPanel");
  const lbFullscreen = document.getElementById("lbFullscreen");
  const lbRename = document.getElementById("lbRename");
  const lbDelete = document.getElementById("lbDelete");
  let lastFocused = null;
  let detailsOpen = false;
  let detailsEditing = false;
  let renameOnly = false;

  function openLightbox(index) {
    currentIndex = index;
    lastFocused = document.activeElement;
    detailsOpen = false;
    detailsEditing = false;
    renameOnly = false;
    paintLightbox();
    lightbox.classList.add("open");
    document.getElementById("lbBack").focus();
  }

  function paintLightbox() {
    const list = currentList();
    const p = list[currentIndex];
    if (!p) return closeLightbox();

    lbArt.hidden = p.type === "video";
    lbVideo.hidden = p.type !== "video";
    lbVideo.pause();
    if (p.type === "video") {
      if (lbVideo.src !== p.src) {
        lbVideo.src = p.src;
        lbVideo.load();
      }
    } else {
      lbArt.src = p.src;
      lbArt.alt = p.title;
      lbArt.style.setProperty("--ar", p.ar);
    }
    lbTitle.textContent = p.title;
    lbMeta.textContent = `${p.categoryLabel} \u00b7 ${p.meta}`;
    lbSequence.textContent = `${currentIndex + 1} / ${list.length}`;
    lbDelete.setAttribute("aria-label", p.deleted ? "Delete this item permanently" : "Move this item to the bin");
    lbDelete.title = p.deleted ? "Delete permanently" : "Move to bin";

    lbFavorite.querySelector(".action-icon").innerHTML = p.favorite ? "&#9829;" : "&#9825;";
    lbFavorite.querySelector(".action-label").textContent = p.favorite ? "Favorited" : "Favorite";
    lbFavorite.classList.toggle("is-active", !!p.favorite);
    lbFavorite.setAttribute("aria-pressed", String(!!p.favorite));
    lbFavorite.setAttribute("aria-label", p.favorite ? "Remove from favorites" : "Add to favorites");

    lbDetailsBtn.classList.toggle("is-active", detailsOpen);
    lbDetailsBtn.setAttribute("aria-pressed", String(detailsOpen));
    lbDetailsBtn.setAttribute("aria-label", detailsOpen ? "Hide details" : "Show details");
    lbDetailsBtn.querySelector(".action-label").textContent = detailsOpen ? "Hide details" : "Details";
    lbRename.hidden = !!p.deleted;
    renderDetailsPanel(p);
  }

  function renderDetailsPanel(p) {
    if (!detailsOpen) {
      lbDetailsPanel.hidden = true;
      return;
    }
    lbDetailsPanel.hidden = false;
    if (detailsEditing) {
      const folderOptions = p.type === "video" || renameOnly ? "" : `
        <label class="detail-edit-field">Folder
          <select id="lbEditCategory">
            ${series.map(folder => `<option value="${escapeHtml(folder.key)}" ${folder.key === p.category ? "selected" : ""}>${escapeHtml(folder.label)}</option>`).join("")}
          </select>
        </label>`;
      lbDetailsPanel.innerHTML = `
        <label class="detail-edit-field">Title
          <input id="lbEditTitle" type="text" maxlength="120" value="${escapeHtml(p.title)}">
        </label>
        ${folderOptions}
        <div class="detail-actions">
          <button type="button" data-detail-action="cancel">Cancel</button>
          <button type="button" data-detail-action="save">Save</button>
        </div>
      `;
      return;
    }

    const dims = p.width && p.height ? `${p.width} &times; ${p.height}px` : "loading&hellip;";
    lbDetailsPanel.innerHTML = `
      <div><dt>Series</dt><dd>${escapeHtml(p.categoryLabel)}</dd></div>
      <div><dt>File name</dt><dd>${escapeHtml(p.title)}</dd></div>
      <div><dt>Dimensions</dt><dd>${dims}</dd></div>
      <div><dt>Size</dt><dd>${escapeHtml(p.meta.split("\u00b7")[0].trim())}</dd></div>
      <div><dt>Favorite</dt><dd>${p.favorite ? "Yes" : "No"}</dd></div>
      <div class="detail-actions"><button type="button" data-detail-action="edit">Edit</button></div>
    `;
  }

  lbDetailsPanel.addEventListener("click", event => {
    const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
    if (!action) return;
    const p = currentList()[currentIndex];
    if (!p) return;

    if (action === "edit") {
      detailsEditing = true;
      renameOnly = false;
      renderDetailsPanel(p);
      document.getElementById("lbEditTitle").focus();
      return;
    }

    if (action === "cancel") {
      detailsEditing = false;
      renameOnly = false;
      renderDetailsPanel(p);
      return;
    }

    const titleInput = document.getElementById("lbEditTitle");
    p.title = titleInput.value.trim() || p.title;
    const categoryInput = document.getElementById("lbEditCategory");
    if (categoryInput) {
      const folder = series.find(item => item.key === categoryInput.value);
      if (folder) {
        p.category = folder.key;
        p.categoryLabel = folder.label;
      }
    }

    detailsEditing = false;
    renameOnly = false;
    savePlates();
    render();
    const updatedIndex = currentList().findIndex(item => item.id === p.id);
    if (updatedIndex < 0) {
      closeLightbox();
      return;
    }
    currentIndex = updatedIndex;
    paintLightbox();
  });

  lbArt.addEventListener("load", () => {
    const list = currentList();
    const p = list[currentIndex];
    if (!p) return;
    if (!p.width) {
      p.width = lbArt.naturalWidth;
      p.height = lbArt.naturalHeight;
      if (detailsOpen) renderDetailsPanel(p);
    }
  });

  lbVideo.addEventListener("loadedmetadata", () => {
    const list = currentList();
    const p = list[currentIndex];
    if (!p || p.type !== "video") return;
    p.width = lbVideo.videoWidth;
    p.height = lbVideo.videoHeight;
    if (detailsOpen) renderDetailsPanel(p);
  });

  lbFavorite.addEventListener("click", () => {
    const list = currentList();
    const p = list[currentIndex];
    if (!p) return;
    p.favorite = !p.favorite;
    savePlates();
    paintLightbox();
    render();
  });

  lbDetailsBtn.addEventListener("click", () => {
    detailsOpen = !detailsOpen;
    if (!detailsOpen) {
      detailsEditing = false;
      renameOnly = false;
    }
    paintLightbox();
  });

  lbRename.addEventListener("click", () => {
    const p = currentList()[currentIndex];
    if (!p || p.deleted) return;
    detailsOpen = true;
    detailsEditing = true;
    renameOnly = true;
    paintLightbox();
    const titleInput = document.getElementById("lbEditTitle");
    titleInput.focus();
    titleInput.select();
  });

  lbDetailsPanel.addEventListener("keydown", event => {
    if (event.target.id !== "lbEditTitle") return;
    if (event.key === "Enter") {
      event.preventDefault();
      lbDetailsPanel.querySelector('[data-detail-action="save"]').click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      lbDetailsPanel.querySelector('[data-detail-action="cancel"]').click();
    }
  });

  lbFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      lightbox.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  document.addEventListener("fullscreenchange", () => {
    lbFullscreen.querySelector(".action-icon").innerHTML = document.fullscreenElement ? "&#x2715;" : "&#x26F6;";
    lbFullscreen.querySelector(".action-label").textContent = document.fullscreenElement ? "Exit zoom" : "Zoom";
    lbFullscreen.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "View fullscreen");
  });

  function closeLightbox() {
    lightbox.classList.remove("open");
    lbVideo.pause();
    lbVideo.currentTime = 0;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (lastFocused) lastFocused.focus();
  }

  function step(dir) {
    const list = currentList();
    if (!list.length) return;
    currentIndex = (currentIndex + dir + list.length) % list.length;
    paintLightbox();
  }

  async function deleteCurrent() {
    const list = currentList();
    const p = list[currentIndex];
    if (!p) return;
    if (p.deleted) {
      const removed = await permanentlyDeletePlate(p.id);
      if (!removed) return;
    }
    else deletePlate(p.id);
    const newList = currentList();
    if (!newList.length) {
      closeLightbox();
      return;
    }
    currentIndex = currentIndex % newList.length;
    paintLightbox();
  }

  document.getElementById("lbBack").addEventListener("click", closeLightbox);
  lbDelete.addEventListener("click", deleteCurrent);
  document.getElementById("lbPrev").addEventListener("click", () => step(-1));
  document.getElementById("lbNext").addEventListener("click", () => step(1));

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteCurrent();
    }
  });

  const themeToggle = document.getElementById("themeToggle");
  const themeLabel = document.getElementById("themeLabel");
  const backgroundChoices = document.querySelectorAll('input[name="backgroundColor"]');
  const fontWeightSelect = document.getElementById("fontWeightSelect");
  const savedTheme = localStorage.getItem("aperture-theme");
  if (savedTheme === "dark") document.body.classList.add("dark-theme");

  const colorThemes = ["sky", "sage", "rose"];
  const savedColorTheme = localStorage.getItem("aperture-color-theme");
  const initialColorTheme = colorThemes.includes(savedColorTheme) ? savedColorTheme : "sky";
  document.body.dataset.colorTheme = initialColorTheme;
  backgroundChoices.forEach(choice => {
    choice.checked = choice.value === initialColorTheme;
    choice.addEventListener("change", () => {
      if (!choice.checked) return;
      document.body.dataset.colorTheme = choice.value;
      localStorage.setItem("aperture-color-theme", choice.value);
    });
  });

  const fontWeights = ["300", "400", "500", "600"];
  const savedFontWeight = localStorage.getItem("aperture-font-weight");
  const initialFontWeight = fontWeights.includes(savedFontWeight) ? savedFontWeight : "400";
  fontWeightSelect.value = initialFontWeight;
  document.documentElement.style.setProperty("--ui-font-weight", initialFontWeight);
  fontWeightSelect.addEventListener("change", () => {
    document.documentElement.style.setProperty("--ui-font-weight", fontWeightSelect.value);
    localStorage.setItem("aperture-font-weight", fontWeightSelect.value);
  });

  function updateThemeButton() {
    const isDark = document.body.classList.contains("dark-theme");
    themeLabel.textContent = isDark ? "Light mode" : "Dark mode";
    themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    themeToggle.setAttribute("aria-pressed", String(isDark));
  }

  themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    localStorage.setItem("aperture-theme", document.body.classList.contains("dark-theme") ? "dark" : "light");
    updateThemeButton();
  });
  updateThemeButton();

  restoreMediaSources().then(() => {
    render();
  }).catch(error => {
    console.error("Could not restore saved gallery media.", error);
    render();
  });
})();
