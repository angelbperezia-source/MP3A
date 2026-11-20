document.getElementById('js-load-warning')?.remove();

/* =========================================================================
           1. ESTADO GLOBAL, LOGOS POR TEMA Y GESTIÓN DE TEMAS
           ========================================================================= */
        let currentTheme = 'default';
        let currentMobileView = 'music';
        let isPlaying = false;
        let currentTrackIndex = -1;
        let bassEnergy = 0;
        let playbackRate = 1.0;

        const THEME_LOGOS = {
            default: './ICONO NEW.jpg',
            retro: './RETRO.jpg',
            cristal: './CRISTAL.jpg',
            hacker: './HACKER.jpg',
            synthwave: './Synthwave.jpg',
            comic: './comic.jpg'
        };

        const tracks = [];

        function applyBrandLogoForTheme(theme) {
            const logoImg = document.getElementById('brand-logo-img');
            const nextLogo = THEME_LOGOS[theme] || './ICONO NEW.jpg';
            logoImg.onerror = () => {
                logoImg.onerror = null;
                logoImg.src = './ICONO NEW.jpg';
            };
            logoImg.src = nextLogo;
        }

        function showToast(msg, iconClass = 'fa-bolt') {
            const box = document.getElementById('toast-box');
            document.getElementById('toast-msg').textContent = msg;
            document.getElementById('toast-icon').className = `fa-solid ${iconClass} text-lg`;
            box.classList.remove('translate-x-full', 'opacity-0');
            setTimeout(() => {
                box.classList.add('translate-x-full', 'opacity-0');
            }, 2600);
        }

        function setMobileView(view) {
            currentMobileView = view;
            document.body.classList.remove('mobile-view-music', 'mobile-view-visualizer', 'mobile-view-themes', 'mobile-player-expanded');
            document.body.classList.add(`mobile-view-${view}`);
            document.querySelectorAll('.mobile-nav-button').forEach(button => {
                if (button.dataset.mobileView === view) {
                    button.setAttribute('aria-current', 'page');
                } else {
                    button.removeAttribute('aria-current');
                }
            });
            if (view === 'visualizer') requestAnimationFrame(() => resizeVisualizer());
        }

        function toggleMobilePlayer() {
            if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) return;
            if (document.body.classList.contains('mobile-player-expanded')) {
                document.body.classList.remove('mobile-player-expanded');
            } else {
                setMobileView('music');
                document.body.classList.add('mobile-player-expanded');
            }
        }

        function updateMobilePlayer() {
            const player = document.getElementById('mobile-mini-player');
            const hasTrack = currentTrackIndex >= 0 && currentTrackIndex < tracks.length;
            player.classList.toggle('hidden', !hasTrack);
            if (!hasTrack) return;
            const track = tracks[currentTrackIndex];
            document.getElementById('mobile-track-cover').src = track.cover || THEME_LOGOS[currentTheme] || './ICONO NEW.jpg';
            document.getElementById('mobile-track-title').textContent = track.title;
            document.getElementById('mobile-track-artist').textContent = track.artist;
        }

        function setTheme(theme) {
            currentTheme = theme;
            document.body.className = `min-h-screen flex flex-col justify-between relative selection:bg-emerald-500 selection:text-black mobile-view-${currentMobileView} ${theme !== 'default' ? 'theme-' + theme : ''}`;
            applyBrandLogoForTheme(theme);

            const showPartyBackground = theme === 'synthwave' && Boolean(partyBackgroundUrl);
            partyBackgroundLayer.classList.toggle('hidden', !showPartyBackground);
            document.body.classList.toggle('party-background-active', showPartyBackground);

            document.querySelectorAll('.game-panel').forEach(p => p.classList.add('hidden'));
            const activePanel = document.getElementById(`panel-${theme}`) || document.getElementById('panel-default');
            activePanel.classList.remove('hidden');

            if (theme === 'retro') {
                showToast('Aventura Retro 8-bit lista para jugar', 'fa-gamepad');
                resizeMarioCanvas();
                resetMarioGame();
            } else if (theme === 'cristal') {
                showToast('Tema Cristal: ¡Rompe el Hielo activado!', 'fa-snowflake');
                resizeIceCanvas();
                initIceGame();
            } else if (theme === 'hacker') {
                showToast('Tema Hacker: Terminal de código lista', 'fa-terminal');
                logTerminal('Módulo de intrusión cargado. Prueba "EXHIBIR CÓDIGO" o "DERRUMBAR".');
            } else if (theme === 'synthwave') {
                showToast('Tema Synthwave: ¡Fuegos artificiales sincronizados!', 'fa-fire');
                resizeSynthwaveCanvas();
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => spawnFirework(true), i * 180);
                }
            } else if (theme === 'comic') {
                showToast('Tema Cómic: ¡Modo Lápiz listo para dibujar!', 'fa-pencil');
                resizeComicCanvas();
            } else {
                showToast('Tema Oscuro estándar activado', 'fa-moon');
            }
        }

        /* =========================================================================
           2. MOTOR DE AUDIO + BIBLIOTECA LOCAL POR PERMISOS (INDEXEDDB + FS API)
           ========================================================================= */
        let audioCtx = null;
        let analyser = null;
        let dataArray = null;
        let customAudioEl = null;
        let customSourceNode = null;
        let progressTimer = null;
        let directoryHandle = null;

        const LIBRARY_DB_NAME = 'mp3_a_studio_library_v1';
        const LIBRARY_STORE = 'handles';

        function openLibraryDb() {
            return new Promise((resolve, reject) => {
                if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
                const req = indexedDB.open(LIBRARY_DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
                        db.createObjectStore(LIBRARY_STORE);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function saveDirectoryHandle(handle) {
            try {
                const db = await openLibraryDb();
                const tx = db.transaction(LIBRARY_STORE, 'readwrite');
                tx.objectStore(LIBRARY_STORE).put(handle, 'music_dir');
                await new Promise((res, rej) => {
                    tx.oncomplete = res;
                    tx.onerror = () => rej(tx.error);
                });
            } catch (_) {}
        }

        async function loadSavedDirectoryHandle() {
            try {
                const db = await openLibraryDb();
                const tx = db.transaction(LIBRARY_STORE, 'readonly');
                const req = tx.objectStore(LIBRARY_STORE).get('music_dir');
                return await new Promise((res, rej) => {
                    req.onsuccess = () => res(req.result || null);
                    req.onerror = () => rej(req.error);
                });
            } catch (_) {
                return null;
            }
        }

        function isAudioFileNameOrType(file) {
            if (file && file.type && file.type.startsWith('audio/')) return true;
            return /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(file.name || '');
        }

        async function collectAudioFilesFromDir(dirHandle, depth = 0, out = []) {
            if (depth > 3) return out;
            for await (const [, entry] of dirHandle.entries()) {
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    if (isAudioFileNameOrType(file)) {
                        out.push({ file, handle: entry });
                    }
                } else if (entry.kind === 'directory') {
                    await collectAudioFilesFromDir(entry, depth + 1, out);
                }
            }
            return out;
        }

        function setLibraryStatus(msg) {
            const el = document.getElementById('library-permission-status');
            if (el) el.textContent = msg;
        }

        async function ingestLocalAudioEntries(entries, sourceLabel = 'Biblioteca Local') {
            if (!entries || !entries.length) {
                showToast('No se encontraron archivos de audio en la selección', 'fa-circle-info');
                return;
            }
            let firstAddedIndex = -1;
            const existingKeys = new Set(tracks
                .filter(t => t.localFile)
                .map(t => `${t.localFile.name}|${t.localFile.size}|${t.localFile.lastModified}`));
            let added = 0;
            for (const item of entries) {
                const file = item.file || item;
                const key = `${file.name}|${file.size}|${file.lastModified}`;
                if (existingKeys.has(key)) continue;
                existingKeys.add(key);
                const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
                tracks.push({
                    title: cleanTitle,
                    artist: sourceLabel,
                    genre: 'Audio del Dispositivo',
                    cover: THEME_LOGOS[currentTheme] || './ICONO NEW.jpg',
                    duration: 0,
                    localFile: file,
                    fileHandle: item.handle || null
                });
                added++;
                if (firstAddedIndex === -1) firstAddedIndex = tracks.length - 1;
            }
            renderPlaylist();
            if (!added) {
                setLibraryStatus('Las canciones seleccionadas ya están cargadas.');
                showToast('No hay canciones nuevas para agregar', 'fa-circle-info');
                return;
            }
            setLibraryStatus(`${added} ${added === 1 ? 'canción cargada' : 'canciones cargadas'} desde "${sourceLabel}".`);
            showToast(`${added} ${added === 1 ? 'canción lista' : 'canciones listas'} para escuchar`, 'fa-music');
            selectTrack(firstAddedIndex);
            if (!isPlaying) {
                togglePlay();
            }
        }

        async function requestDeviceMusicAccess() {
            if (typeof window.showDirectoryPicker === 'function') {
                try {
                    const handle = await window.showDirectoryPicker({ mode: 'read' });
                    directoryHandle = handle;
                    await saveDirectoryHandle(handle);
                    const perm = await handle.requestPermission({ mode: 'read' });
                    if (perm !== 'granted') {
                        setLibraryStatus('Permiso de lectura denegado para la carpeta de música.');
                        showToast('Permiso de carpeta denegado', 'fa-lock');
                        return;
                    }
                    setLibraryStatus(`Escaneando carpeta "${handle.name}"...`);
                    const files = await collectAudioFilesFromDir(handle);
                    await ingestLocalAudioEntries(files, handle.name || 'Carpeta de Música');
                    return;
                } catch (err) {
                    if (err && err.name === 'AbortError') return;
                }
            }

            // Fallback multi-archivo / carpeta en navegadores móviles o sin showDirectoryPicker
            const folderInput = document.getElementById('folder-upload-fallback');
            folderInput.value = '';
            folderInput.click();
        }

        async function handleFolderFallbackUpload(e) {
            const files = Array.from(e.target.files || []).filter(isAudioFileNameOrType);
            await ingestLocalAudioEntries(files, 'Carpeta Seleccionada');
        }

        async function restoreSavedLibraryPrompt() {
            const saved = await loadSavedDirectoryHandle();
            if (!saved) return;
            directoryHandle = saved;
            setLibraryStatus(`Carpeta guardada "${saved.name}". Pulsa "Biblioteca Local" para reautorizar y cargar tus canciones.`);
        }

        function initAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.82;
                analyser.minDecibels = -90;
                analyser.maxDecibels = -10;
                dataArray = new Uint8Array(analyser.frequencyBinCount);
                timeDataArray = new Uint8Array(analyser.fftSize);
                analyser.connect(audioCtx.destination);
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        function renderPlaylist() {
            const container = document.getElementById('playlist-container');
            const countEl = document.getElementById('playlist-count');
            container.innerHTML = '';
            if (countEl) {
                const localCount = tracks.filter(t => Boolean(t.localFile || t.fileHandle)).length;
                countEl.textContent = `${localCount} ${localCount === 1 ? 'canción' : 'canciones'}`;
            }
            const searchInput = document.getElementById('playlist-search');
            const query = (searchInput?.value || '').trim().toLowerCase();
            const visibleTracks = tracks
                .map((track, originalIndex) => ({ track, originalIndex }))
                .filter(({ track }) => {
                    if (!query) return true;
                    return `${track.title} ${track.artist} ${track.genre}`.toLowerCase().includes(query);
                });
            visibleTracks.forEach(({ track: t, originalIndex: idx }) => {
                const active = idx === currentTrackIndex;
                const btn = document.createElement('button');
                btn.onclick = () => selectTrack(idx, true);
                btn.className = `w-full text-left p-2.5 rounded-lg flex items-center justify-between text-xs transition ${active ? 'accent-bg font-bold' : 'hover:bg-white/10'}`;
                const left = document.createElement('div');
                left.className = 'flex items-center gap-2.5 truncate';
                const number = document.createElement('span');
                number.className = 'opacity-70 font-mono';
                number.textContent = `${idx + 1}.`;
                const text = document.createElement('div');
                text.className = 'truncate';
                const title = document.createElement('div');
                title.className = 'truncate';
                if (t.localFile || t.fileHandle) {
                    const badge = document.createElement('i');
                    badge.className = 'fa-solid fa-mobile-screen mr-1 opacity-75';
                    title.appendChild(badge);
                }
                title.append(document.createTextNode(t.title));
                const artist = document.createElement('div');
                artist.className = 'text-[10px] opacity-75 truncate';
                artist.textContent = t.artist;
                text.append(title, artist);
                left.append(number, text);
                const duration = document.createElement('span');
                duration.className = 'text-[10px] font-mono opacity-80';
                duration.textContent = t.duration ? formatTime(t.duration) : 'MP3';
                btn.append(left, duration);
                container.appendChild(btn);
            });
            if (!visibleTracks.length) {
                const empty = document.createElement('p');
                empty.className = 'py-3 text-center text-[11px] opacity-60';
                empty.textContent = tracks.length
                    ? 'No se encontraron canciones'
                    : 'Carga MP3 o selecciona una carpeta para empezar';
                container.appendChild(empty);
            }
        }

        function formatTime(sec) {
            if (!sec || !Number.isFinite(sec)) return '00:00';
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = Math.floor(sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        async function playLocalTrack(track) {
            initAudioContext();
            if (customAudioEl) {
                customAudioEl.pause();
                customAudioEl = null;
            }

            let file = track.localFile || null;
            if (!file && track.fileHandle) {
                const perm = await track.fileHandle.requestPermission({ mode: 'read' });
                if (perm !== 'granted') {
                    showToast('Permiso necesario para reproducir el archivo', 'fa-lock');
                    return;
                }
                file = await track.fileHandle.getFile();
                track.localFile = file;
            }
            if (!file) return;

            const url = URL.createObjectURL(file);
            if (window.__lastUrl) URL.revokeObjectURL(window.__lastUrl);
            window.__lastUrl = url;
            customAudioEl = new Audio(url);
            customAudioEl.playbackRate = playbackRate;
            customAudioEl.volume = parseFloat(document.getElementById('volume-slider').value);

            customSourceNode = audioCtx.createMediaElementSource(customAudioEl);
            customSourceNode.connect(analyser);

            customAudioEl.onloadedmetadata = () => {
                track.duration = customAudioEl.duration;
                document.getElementById('total-time').textContent = formatTime(customAudioEl.duration);
                renderPlaylist();
            };
            customAudioEl.onended = () => handleEnded();

            isPlaying = true;
            updatePlayUI();
            await customAudioEl.play().catch(() => { isPlaying = false; updatePlayUI(); showToast("Toca play para reproducir", "fa-play"); });
            startProgressTimer();
        }

        function selectTrack(idx, autoPlayIfActive = false) {
            if (!Number.isInteger(idx) || idx < 0 || idx >= tracks.length) return;
            currentTrackIndex = idx;
            const t = tracks[idx];
            document.getElementById('track-title').textContent = t.title;
            document.getElementById('track-artist').textContent = t.artist;
            document.getElementById('track-genre').textContent = t.genre;
            document.getElementById('track-cover').src = t.cover || THEME_LOGOS[currentTheme] || './ICONO NEW.jpg';
            document.getElementById('total-time').textContent = formatTime(t.duration);
            document.getElementById('progress-bar').value = 0;
            document.getElementById('current-time').textContent = '00:00';
            renderPlaylist();
            updateMobilePlayer();

            if (isPlaying || autoPlayIfActive) {
                playLocalTrack(t);
            } else if (customAudioEl) {
                customAudioEl.pause();
                customAudioEl = null;
            }
        }

        function togglePlay() {
            if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
                showToast('Carga una canción local para reproducirla', 'fa-music');
                return;
            }
            const current = tracks[currentTrackIndex];

            if (!isPlaying) {
                isPlaying = true;
                updatePlayUI();
                if (customAudioEl && customAudioEl.src.startsWith('blob:')) {
                    customAudioEl.play();
                } else {
                    playLocalTrack(current);
                }
                startProgressTimer();
            } else {
                isPlaying = false;
                updatePlayUI();
                if (customAudioEl) customAudioEl.pause();
                clearInterval(progressTimer);
            }
        }

        function updatePlayUI() {
            const icon = document.getElementById('play-icon');
            const badge = document.getElementById('playing-badge');
            const mobileIcon = document.getElementById('mobile-play-icon');
            if (isPlaying) {
                icon.className = 'fa-solid fa-pause';
                mobileIcon.className = 'fa-solid fa-pause';
                badge.classList.remove('hidden');
            } else {
                icon.className = 'fa-solid fa-play ml-0.5';
                mobileIcon.className = 'fa-solid fa-play';
                badge.classList.add('hidden');
            }
        }

        function startProgressTimer() {
            clearInterval(progressTimer);
            progressTimer = setInterval(() => {
                if (!isPlaying || !customAudioEl || window.__seeking) return;
                const pct = (customAudioEl.currentTime / (customAudioEl.duration || 1)) * 100;
                document.getElementById('progress-bar').value = pct;
                document.getElementById('current-time').textContent = formatTime(customAudioEl.currentTime);
            }, 250);
        }

        function nextTrack() {
            if (!tracks.length) return;
            selectTrack(shuffleOn && tracks.length > 1 ? randomOther() : (currentTrackIndex + 1) % tracks.length, isPlaying);
        }

        function prevTrack() {
            if (!tracks.length) return;
            if (customAudioEl && customAudioEl.currentTime > 3) { customAudioEl.currentTime = 0; return; }
            selectTrack((currentTrackIndex - 1 + tracks.length) % tracks.length, isPlaying);
        }

        function changePlaybackRate(val) {
            playbackRate = parseFloat(val);
            document.getElementById('speed-display').textContent = playbackRate.toFixed(2) + 'x';
            document.getElementById('synth-speed-val').textContent = playbackRate.toFixed(2) + 'x';
            if (customAudioEl) customAudioEl.playbackRate = playbackRate;
        }

        async function handleFileUpload(e) {
            const files = Array.from(e.target.files || []).filter(isAudioFileNameOrType);
            e.target.value = '';
            if (!files.length) return;
            await ingestLocalAudioEntries(files, 'Archivos Locales');
        }

        document.getElementById('volume-slider').addEventListener('input', (e) => {
            if (customAudioEl) customAudioEl.volume = parseFloat(e.target.value);
        });

        
        /* =========================================================================
           MEJORAS: buscar en la canción, aleatorio/repetir, controles del sistema,
           atajos de teclado (PC) y preferencias guardadas
           ========================================================================= */
        let shuffleOn = false, repeatMode = 'off';
        const PREF_KEY = 'mp3a_prefs_v2';
        const volumeSlider = document.getElementById('volume-slider');
        function savePrefs() {
            try { localStorage.setItem(PREF_KEY, JSON.stringify({ theme: currentTheme, volume: +volumeSlider.value, rate: playbackRate, shuffle: shuffleOn, repeat: repeatMode })); } catch (_) {}
        }
        function randomOther() {
            let n; do { n = Math.floor(Math.random() * tracks.length); } while (n === currentTrackIndex);
            return n;
        }
        function refreshModeButtons() {
            const sh = document.getElementById('shuffle-btn'), rp = document.getElementById('repeat-btn');
            sh.classList.toggle('opacity-50', !shuffleOn); sh.style.color = shuffleOn ? 'var(--accent)' : ''; sh.setAttribute('aria-pressed', shuffleOn);
            rp.classList.toggle('opacity-50', repeatMode === 'off'); rp.style.color = repeatMode !== 'off' ? 'var(--accent)' : '';
            document.getElementById('repeat-one').classList.toggle('hidden', repeatMode !== 'one');
        }
        function toggleShuffle() { shuffleOn = !shuffleOn; refreshModeButtons(); savePrefs(); showToast(shuffleOn ? 'Aleatorio activado' : 'Aleatorio desactivado', 'fa-shuffle'); }
        function toggleRepeat() {
            repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
            refreshModeButtons(); savePrefs();
            showToast({ off: 'Repetir: desactivado', all: 'Repetir toda la lista', one: 'Repetir esta canción' }[repeatMode], 'fa-repeat');
        }
        function handleEnded() {
            if (repeatMode === 'one') { customAudioEl.currentTime = 0; customAudioEl.play(); return; }
            if (!shuffleOn && repeatMode === 'off' && currentTrackIndex === tracks.length - 1) {
                isPlaying = false; updatePlayUI(); clearInterval(progressTimer); return;
            }
            nextTrack();
        }

        // Buscar dentro de la canción (antes la barra no permitía saltar)
        const progressEl = document.getElementById('progress-bar');
        ['pointerdown', 'touchstart'].forEach(ev => progressEl.addEventListener(ev, () => { window.__seeking = true; }, { passive: true }));
        ['pointerup', 'touchend', 'change'].forEach(ev => progressEl.addEventListener(ev, () => { window.__seeking = false; }));
        progressEl.addEventListener('input', () => {
            if (!customAudioEl || !Number.isFinite(customAudioEl.duration)) return;
            customAudioEl.currentTime = progressEl.value / 100 * customAudioEl.duration;
            document.getElementById('current-time').textContent = formatTime(customAudioEl.currentTime);
        });
        function seekBy(sec) { if (customAudioEl) customAudioEl.currentTime = Math.max(0, Math.min(customAudioEl.duration || 0, customAudioEl.currentTime + sec)); }

        // Controles en pantalla bloqueada, notificación y teclas multimedia
        function updateMediaSession() {
            if (!('mediaSession' in navigator) || currentTrackIndex < 0 || !tracks[currentTrackIndex]) return;
            const t = tracks[currentTrackIndex];
            try {
                navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: 'MP3 A Studio', artwork: [{ src: './app-icon-512.png', sizes: '512x512', type: 'image/png' }] });
                navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
            } catch (_) {}
        }
        const _selectTrack = selectTrack; selectTrack = function () { _selectTrack.apply(this, arguments); updateMediaSession(); };
        const _updatePlayUI = updatePlayUI; updatePlayUI = function () { _updatePlayUI(); updateMediaSession(); };
        const _setTheme = setTheme; setTheme = function (t) { _setTheme(t); savePrefs(); };
        const _changeRate = changePlaybackRate; changePlaybackRate = function (v) { _changeRate(v); savePrefs(); };
        volumeSlider.addEventListener('input', savePrefs);
        if ('mediaSession' in navigator) {
            const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (_) {} };
            set('play', () => { if (!isPlaying) togglePlay(); });
            set('pause', () => { if (isPlaying) togglePlay(); });
            set('previoustrack', prevTrack); set('nexttrack', nextTrack);
            set('seekbackward', () => seekBy(-10)); set('seekforward', () => seekBy(10));
            set('seekto', d => { if (customAudioEl && d.seekTime != null) customAudioEl.currentTime = d.seekTime; });
            setInterval(() => {
                if (customAudioEl && Number.isFinite(customAudioEl.duration)) {
                    try { navigator.mediaSession.setPositionState({ duration: customAudioEl.duration, position: Math.min(customAudioEl.currentTime, customAudioEl.duration), playbackRate: customAudioEl.playbackRate || 1 }); } catch (_) {}
                }
            }, 1000);
        }

        // Atajos de teclado (PC). En el tema Retro, las teclas del juego tienen prioridad.
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const el = e.target;
            if (el instanceof HTMLElement && el.matches('input:not([type="range"]), textarea, select, [contenteditable="true"]')) return;
            const k = e.key.toLowerCase(), retro = currentTheme === 'retro';
            if (k === 'n') { nextTrack(); return; }
            if (k === 'p') { prevTrack(); return; }
            if (k === 'm') { volumeSlider.value = volumeSlider.value > 0 ? (window.__prevVol = volumeSlider.value, 0) : (window.__prevVol || 0.8); volumeSlider.dispatchEvent(new Event('input')); return; }
            if (retro) return;
            if ((k === ' ' || k === 'k') && !(el instanceof HTMLElement && el.closest('button, a, label'))) { e.preventDefault(); togglePlay(); }
            else if (e.key === 'ArrowRight' && !(el instanceof HTMLInputElement)) { e.preventDefault(); seekBy(5); }
            else if (e.key === 'ArrowLeft' && !(el instanceof HTMLInputElement)) { e.preventDefault(); seekBy(-5); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                if (el instanceof HTMLInputElement) return;
                e.preventDefault();
                volumeSlider.value = Math.max(0, Math.min(1, +volumeSlider.value + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
                volumeSlider.dispatchEvent(new Event('input'));
            }
            else if (k === 's') toggleShuffle();
            else if (k === 'r') toggleRepeat();
        });

        // Restaurar preferencias al abrir
        window.addEventListener('load', () => {
            let p = {}; try { p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (_) {}
            if (typeof p.volume === 'number') { volumeSlider.value = p.volume; volumeSlider.dispatchEvent(new Event('input')); }
            const r = document.getElementById('playback-rate');
            if (r && p.rate) { r.value = p.rate; if (r.value) changePlaybackRate(r.value); }
            shuffleOn = !!p.shuffle; repeatMode = p.repeat || 'off'; refreshModeButtons();
            if (p.theme && p.theme !== currentTheme) { try { setTheme(p.theme); } catch (_) {} }
        });

        /* =========================================================================
           3. MOTOR DE VISUALIZACIÓN MULTIMODO + DETECTOR DE BASS
           ========================================================================= */
        const visCanvas = document.getElementById('visualizer-canvas');
        const visCtx = visCanvas.getContext('2d', { alpha: true });
        const visualizerCard = document.getElementById('visualizer-card');
        const visualizerStage = document.getElementById('visualizer-stage');
        const visualizerStatus = document.getElementById('visualizer-status');
        const visualizerModeName = document.getElementById('visualizer-mode-name');
        const visualizerExpandButton = document.getElementById('visualizer-expand-button');
        const hackerNameInput = document.getElementById('hacker-username');
        const hackerNameVisualizer = document.getElementById('hacker-name-visualizer');

        let timeDataArray = null;
        let visualizerMode = 'spectrum';
        let visualizerWidth = 1;
        let visualizerHeight = 1;
        let visualizerDpr = 1;
        let lastVisualizerFrame = 0;
        const visualizerLevels = new Float32Array(96);
        const visualizerPeaks = new Float32Array(96);
        const visualizerModeNames = {
            spectrum: 'ESPECTRO',
            wave: 'ONDA',
            mirror: 'ESPEJO',
            radial: 'RADIAL',
            particles: 'PARTÍCULAS'
        };
        const visualizerPalettes = {
            default: ['#60a5fa', '#22d3ee', '#a78bfa'],
            retro: ['#ffcd75', '#f77622', '#94b0c2'],
            cristal: ['#e0f2fe', '#7dd3fc', '#38bdf8'],
            hacker: ['#c2ffd0', '#00ff41', '#087a28'],
            synthwave: ['#ff71ce', '#01cdfe', '#b967ff'],
            comic: ['#ef4444', '#facc15', '#2563eb']
        };
        const visualizerParticles = Array.from({ length: 76 }, (_, index) => ({
            x: Math.random(),
            y: Math.random(),
            vx: (Math.random() - 0.5) * 0.0007,
            vy: (Math.random() - 0.5) * 0.0007,
            radius: 0.8 + Math.random() * 1.9,
            phase: index * 0.73
        }));

        function updateHackerNameVisualizer() {
            if (!hackerNameInput || !hackerNameVisualizer) return;
            hackerNameVisualizer.textContent = hackerNameInput.value.trim().toUpperCase() || 'HACKER_ROOT';
        }
        hackerNameInput?.addEventListener('input', updateHackerNameVisualizer);

        function resizeVisualizer() {
            if (!visCanvas || !visualizerStage) return;
            const rect = visualizerStage.getBoundingClientRect();
            visualizerWidth = Math.max(1, Math.floor(rect.width));
            visualizerHeight = Math.max(1, Math.floor(rect.height));
            visualizerDpr = Math.min(window.devicePixelRatio || 1, 2);
            const pixelWidth = Math.max(1, Math.round(visualizerWidth * visualizerDpr));
            const pixelHeight = Math.max(1, Math.round(visualizerHeight * visualizerDpr));
            if (visCanvas.width !== pixelWidth || visCanvas.height !== pixelHeight) {
                visCanvas.width = pixelWidth;
                visCanvas.height = pixelHeight;
            }
            visCtx.setTransform(visualizerDpr, 0, 0, visualizerDpr, 0, 0);
        }

        function setVisualizerMode(mode) {
            if (!Object.prototype.hasOwnProperty.call(visualizerModeNames, mode)) return;
            visualizerMode = mode;
            document.querySelectorAll('[data-visualizer-mode]').forEach(button => {
                const active = button.dataset.visualizerMode === mode;
                button.classList.toggle('is-active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            if (visualizerModeName) visualizerModeName.textContent = visualizerModeNames[mode];
            visualizerLevels.fill(0);
            visualizerPeaks.fill(0);
            resizeVisualizer();
        }

        document.getElementById('visualizer-modebar')?.addEventListener('click', event => {
            const button = event.target.closest('[data-visualizer-mode]');
            if (button) setVisualizerMode(button.dataset.visualizerMode);
        });

        let visualizerTouchStart = null;
        visualizerStage?.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'touch' || event.target.closest('button')) return;
            visualizerTouchStart = { x: event.clientX, y: event.clientY };
        });
        visualizerStage?.addEventListener('pointerup', event => {
            if (!visualizerTouchStart || event.pointerType !== 'touch') return;
            const dx = event.clientX - visualizerTouchStart.x;
            const dy = event.clientY - visualizerTouchStart.y;
            visualizerTouchStart = null;
            if (Math.abs(dx) < 58 || Math.abs(dy) > 62) return;
            const modes = Object.keys(visualizerModeNames);
            const currentIndex = modes.indexOf(visualizerMode);
            const nextIndex = (currentIndex + (dx < 0 ? 1 : modes.length - 1)) % modes.length;
            setVisualizerMode(modes[nextIndex]);
        });
        visualizerStage?.addEventListener('pointercancel', () => { visualizerTouchStart = null; });

        function toggleVisualizerExpand() {
            const nativeFullscreen = document.fullscreenElement === visualizerStage;
            if (nativeFullscreen) {
                const exitResult = document.exitFullscreen?.();
                exitResult?.catch?.(() => {});
                return;
            }
            if (visualizerCard.classList.contains('visualizer-expanded')) {
                visualizerCard.classList.remove('visualizer-expanded');
                visualizerExpandButton?.setAttribute('aria-pressed', 'false');
                visualizerExpandButton?.setAttribute('aria-label', 'Ampliar visualizador');
                if (visualizerExpandButton) visualizerExpandButton.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i>';
                resizeVisualizer();
                return;
            }
            if (visualizerStage.requestFullscreen) {
                visualizerStage.requestFullscreen().catch(() => {
                    visualizerCard.classList.add('visualizer-expanded');
                    visualizerExpandButton?.setAttribute('aria-pressed', 'true');
                    visualizerExpandButton?.setAttribute('aria-label', 'Cerrar visualizador ampliado');
                    if (visualizerExpandButton) visualizerExpandButton.innerHTML = '<i class="fa-solid fa-compress" aria-hidden="true"></i>';
                    resizeVisualizer();
                });
            } else {
                visualizerCard.classList.add('visualizer-expanded');
                visualizerExpandButton?.setAttribute('aria-pressed', 'true');
                visualizerExpandButton?.setAttribute('aria-label', 'Cerrar visualizador ampliado');
                if (visualizerExpandButton) visualizerExpandButton.innerHTML = '<i class="fa-solid fa-compress" aria-hidden="true"></i>';
                resizeVisualizer();
            }
        }

        document.addEventListener('fullscreenchange', () => {
            const active = document.fullscreenElement === visualizerStage;
            if (visualizerExpandButton) {
                visualizerExpandButton.setAttribute('aria-pressed', String(active));
                visualizerExpandButton.setAttribute('aria-label', active ? 'Cerrar pantalla completa' : 'Ampliar visualizador');
                visualizerExpandButton.innerHTML = active
                    ? '<i class="fa-solid fa-compress" aria-hidden="true"></i>'
                    : '<i class="fa-solid fa-expand" aria-hidden="true"></i>';
            }
            requestAnimationFrame(resizeVisualizer);
        });

        function getVisualizerPalette() {
            return visualizerPalettes[currentTheme] || visualizerPalettes.default;
        }

        function sampleVisualizerLevel(index, count, time) {
            let raw;
            if (analyser && isPlaying && dataArray?.length) {
                const normalized = (index + 1) / count;
                const frequencyIndex = Math.min(dataArray.length - 1, Math.floor(Math.pow(normalized, 1.72) * (dataArray.length - 1)));
                raw = (dataArray[frequencyIndex] || 0) / 255;
            } else {
                raw = 0.055 + (Math.sin(time * 0.0016 + index * 0.39) + 1) * 0.035;
            }
            const previous = visualizerLevels[index] || 0;
            const smoothing = raw > previous ? 0.48 : 0.16;
            const next = previous + (raw - previous) * smoothing;
            visualizerLevels[index] = next;
            return next;
        }

        function drawVisualizerBackground(w, h, palette) {
            const bg = visCtx.createLinearGradient(0, 0, w, h);
            bg.addColorStop(0, 'rgba(7, 12, 25, .22)');
            bg.addColorStop(1, 'rgba(1, 3, 10, .42)');
            visCtx.fillStyle = bg;
            visCtx.fillRect(0, 0, w, h);
            visCtx.strokeStyle = 'rgba(255,255,255,.055)';
            visCtx.lineWidth = 1;
            visCtx.beginPath();
            for (let y = 28; y < h; y += 28) {
                visCtx.moveTo(0, y);
                visCtx.lineTo(w, y);
            }
            visCtx.stroke();
            const glow = visCtx.createRadialGradient(w * .5, h, 0, w * .5, h, h * .95);
            glow.addColorStop(0, `${palette[1]}25`);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            visCtx.fillStyle = glow;
            visCtx.fillRect(0, 0, w, h);
        }

        function drawSpectrum(w, h, time, palette, mirrored = false) {
            const count = Math.min(64, Math.max(28, Math.floor(w / 7)));
            const gap = Math.max(2, w / (count * 10));
            const barWidth = Math.max(1.5, (w - gap * (count + 1)) / count);
            const center = h * .52;
            for (let i = 0; i < count; i++) {
                const level = sampleVisualizerLevel(i, count, time);
                const barHeight = Math.max(2, level * (mirrored ? h * .36 : h * .78));
                const x = gap + i * (barWidth + gap);
                const grad = visCtx.createLinearGradient(0, mirrored ? center - barHeight : h - barHeight, 0, mirrored ? center + barHeight : h);
                grad.addColorStop(0, palette[0]);
                grad.addColorStop(.58, palette[1]);
                grad.addColorStop(1, palette[2]);
                visCtx.fillStyle = grad;
                visCtx.shadowColor = palette[1];
                visCtx.shadowBlur = 7;
                if (mirrored) {
                    const half = barHeight * .5;
                    visCtx.fillRect(x, center - half, barWidth, half - 1);
                    visCtx.fillRect(x, center + 1, barWidth, half - 1);
                } else {
                    visCtx.fillRect(x, h - barHeight - 8, barWidth, barHeight);
                    const peak = Math.max(level, (visualizerPeaks[i] || 0) - .006);
                    visualizerPeaks[i] = peak;
                    visCtx.shadowBlur = 0;
                    visCtx.fillStyle = palette[0];
                    visCtx.fillRect(x, h - peak * (h * .78) - 10, barWidth, 2);
                }
            }
            visCtx.shadowBlur = 0;
            if (mirrored) {
                visCtx.strokeStyle = `${palette[0]}88`;
                visCtx.beginPath();
                visCtx.moveTo(0, center);
                visCtx.lineTo(w, center);
                visCtx.stroke();
            }
        }

        function drawWave(w, h, time, palette) {
            if (analyser && isPlaying && timeDataArray?.length) {
                analyser.getByteTimeDomainData(timeDataArray);
            }
            const points = timeDataArray?.length || 128;
            const grad = visCtx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, palette[0]);
            grad.addColorStop(.5, palette[1]);
            grad.addColorStop(1, palette[2]);
            visCtx.beginPath();
            for (let i = 0; i < points; i++) {
                const x = (i / (points - 1)) * w;
                const sample = analyser && isPlaying && timeDataArray
                    ? (timeDataArray[i] - 128) / 128
                    : Math.sin((i / points) * Math.PI * 4 + time * .0018) * .24;
                const y = h * .52 + sample * h * .36;
                if (i === 0) visCtx.moveTo(x, y); else visCtx.lineTo(x, y);
            }
            visCtx.strokeStyle = grad;
            visCtx.lineWidth = 2.4;
            visCtx.shadowColor = palette[1];
            visCtx.shadowBlur = 13;
            visCtx.stroke();
            visCtx.shadowBlur = 0;
            visCtx.beginPath();
            visCtx.moveTo(0, h * .52);
            visCtx.lineTo(w, h * .52);
            visCtx.strokeStyle = 'rgba(255,255,255,.18)';
            visCtx.lineWidth = 1;
            visCtx.stroke();
        }

        function drawRadial(w, h, time, palette) {
            const cx = w * .5;
            const cy = h * .53;
            const baseRadius = Math.min(w * .19, h * .27);
            const count = 88;
            visCtx.lineCap = 'round';
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
                const level = sampleVisualizerLevel(i, count, time);
                const inner = baseRadius;
                const outer = inner + 5 + level * h * .31;
                const color = i % 3 === 0 ? palette[0] : (i % 3 === 1 ? palette[1] : palette[2]);
                visCtx.beginPath();
                visCtx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
                visCtx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
                visCtx.strokeStyle = color;
                visCtx.lineWidth = Math.max(1.4, w / 470);
                visCtx.shadowColor = color;
                visCtx.shadowBlur = 7;
                visCtx.stroke();
            }
            visCtx.shadowBlur = 0;
            const pulse = 1 + Math.min(.18, bassEnergy / 450);
            const core = visCtx.createRadialGradient(cx, cy, 2, cx, cy, baseRadius * pulse);
            core.addColorStop(0, `${palette[0]}cc`);
            core.addColorStop(.55, `${palette[1]}44`);
            core.addColorStop(1, 'rgba(0,0,0,0)');
            visCtx.fillStyle = core;
            visCtx.beginPath();
            visCtx.arc(cx, cy, baseRadius * pulse, 0, Math.PI * 2);
            visCtx.fill();
            visCtx.strokeStyle = `${palette[0]}99`;
            visCtx.lineWidth = 1.5;
            visCtx.beginPath();
            visCtx.arc(cx, cy, baseRadius * .58 * pulse, 0, Math.PI * 2);
            visCtx.stroke();
        }

        function drawParticles(w, h, time, palette) {
            const bassBoost = isPlaying ? bassEnergy / 100 : .12;
            const mobile = window.matchMedia('(max-width: 640px)').matches;
            const limit = mobile ? 42 : visualizerParticles.length;
            for (let i = 0; i < limit; i++) {
                const p = visualizerParticles[i];
                p.x += p.vx * (1 + bassBoost * 4);
                p.y += p.vy * (1 + bassBoost * 4);
                if (p.x < 0) p.x = 1;
                if (p.x > 1) p.x = 0;
                if (p.y < 0) p.y = 1;
                if (p.y > 1) p.y = 0;
                const x = p.x * w;
                const y = p.y * h;
                const pulse = .65 + (Math.sin(time * .002 + p.phase) + 1) * .35 + bassBoost * 1.8;
                const radius = p.radius * pulse;
                visCtx.beginPath();
                visCtx.arc(x, y, radius, 0, Math.PI * 2);
                visCtx.fillStyle = i % 3 === 0 ? palette[0] : (i % 3 === 1 ? palette[1] : palette[2]);
                visCtx.shadowColor = visCtx.fillStyle;
                visCtx.shadowBlur = 9;
                visCtx.fill();
                if (i % 2 === 0) {
                    const next = visualizerParticles[(i + 7) % limit];
                    const nx = next.x * w;
                    const ny = next.y * h;
                    const distance = Math.hypot(nx - x, ny - y);
                    if (distance < (mobile ? 68 : 100)) {
                        visCtx.beginPath();
                        visCtx.moveTo(x, y);
                        visCtx.lineTo(nx, ny);
                        visCtx.strokeStyle = `${palette[1]}${Math.max(12, Math.round((1 - distance / (mobile ? 68 : 100)) * 65)).toString(16).padStart(2, '0')}`;
                        visCtx.lineWidth = 1;
                        visCtx.stroke();
                    }
                }
            }
            visCtx.shadowBlur = 0;
            const ringRadius = 22 + bassBoost * 34;
            visCtx.strokeStyle = `${palette[1]}66`;
            visCtx.lineWidth = 1.4;
            visCtx.beginPath();
            visCtx.arc(w * .5, h * .5, ringRadius, time * .0004, time * .0004 + Math.PI * 1.45);
            visCtx.stroke();
        }

        function renderVisualizerLoop(timestamp = 0) {
            requestAnimationFrame(renderVisualizerLoop);
            const now = performance.now();
            const mobile = window.matchMedia('(max-width: 640px)').matches;
            const frameInterval = mobile ? 1000 / 30 : 1000 / 45;
            if (now - lastVisualizerFrame < frameInterval) return;
            lastVisualizerFrame = now;

            let bassSum = 0;
            if (analyser && isPlaying && dataArray?.length) {
                analyser.getByteFrequencyData(dataArray);
                const bassBins = Math.min(8, dataArray.length);
                for (let i = 0; i < bassBins; i++) bassSum += dataArray[i];
                bassEnergy = Math.min(100, Math.round((bassSum / (bassBins * 255)) * 100));
            } else {
                bassEnergy = Math.max(0, bassEnergy - (mobile ? 2 : 2.5));
            }

            const bassMeter = document.getElementById('bass-meter');
            const synthBassValue = document.getElementById('synth-bass-val');
            if (bassMeter) bassMeter.style.width = bassEnergy + '%';
            if (synthBassValue) synthBassValue.textContent = bassEnergy + '%';

            const namePulse = isPlaying ? Math.min(1, bassEnergy / 55) : 0;
            if (hackerNameVisualizer) {
                hackerNameVisualizer.style.transform = `scale(${1 + namePulse * .3})`;
                hackerNameVisualizer.style.textShadow = `0 0 ${8 + namePulse * 28}px rgba(0, 255, 65, ${.45 + namePulse * .55})`;
            }

            if (currentTheme === 'synthwave' && isPlaying && bassEnergy > 60 && Math.random() < .12 * playbackRate) {
                spawnFirework(true);
            }

            const visible = visualizerCard && visualizerCard.getClientRects().length > 0 && getComputedStyle(visualizerCard).display !== 'none';
            if (!visible) return;
            const w = visualizerWidth || visualizerStage.clientWidth || 1;
            const h = visualizerHeight || visualizerStage.clientHeight || 1;
            const palette = getVisualizerPalette();
            visCtx.clearRect(0, 0, w, h);
            drawVisualizerBackground(w, h, palette);

            if (visualizerMode === 'wave') drawWave(w, h, timestamp || now, palette);
            else if (visualizerMode === 'mirror') drawSpectrum(w, h, timestamp || now, palette, true);
            else if (visualizerMode === 'radial') drawRadial(w, h, timestamp || now, palette);
            else if (visualizerMode === 'particles') drawParticles(w, h, timestamp || now, palette);
            else drawSpectrum(w, h, timestamp || now, palette, false);

            if (visualizerStatus) {
                visualizerStatus.textContent = isPlaying
                    ? `● AUDIO EN VIVO · BASS ${bassEnergy}%`
                    : 'MODO AMBIENTE · CARGA MÚSICA PARA ACTIVAR';
            }
        }

        if ('ResizeObserver' in window) {
            const visualizerResizeObserver = new ResizeObserver(() => resizeVisualizer());
            visualizerResizeObserver.observe(visualizerStage);
        } else {
            window.addEventListener('resize', resizeVisualizer, { passive: true });
        }
        window.addEventListener('resize', () => {
            if (currentTheme === 'retro') {
                resizeMarioCanvas();
                resetMarioGame();
            }
            if (currentTheme === 'cristal') resizeIceCanvas();
            if (currentTheme === 'synthwave') resizeSynthwaveCanvas();
            if (currentTheme === 'comic') resizeComicCanvas();
        }, { passive: true });

        /* =========================================================================
           4. TEMA RETRO: AVENTURA DE PLATAFORMAS 8-BIT
           ========================================================================= */
        const marioCanvas = document.getElementById('mario-canvas');
        const marioCtx = marioCanvas.getContext('2d');
        const marioKeys = { left: false, right: false, run: false, brake: false, jump: false };
        let marioState = {};
        let marioLevelIndex = 0;
        let marioLives = 3;
        let marioTotalScore = 0;
        const marioLevels = [
            {
                name: 'MUNDO 1-1',
                sky: '#5c94fc',
                ground: '#c84c0c',
                grass: '#00a800',
                length: 2050,
                gaps: [[560, 635], [1130, 1210], [1680, 1760]],
                pipes: [[285, 42], [790, 54], [1300, 48], [1840, 62]],
                blocks: [[170, 105], [196, 105], [485, 132], [900, 98], [926, 98], [1460, 125], [1486, 125], [1730, 98]],
                platforms: [[365, 82, 88], [690, 118, 100], [1010, 80, 90], [1370, 112, 100], [1570, 86, 90], [1780, 120, 110]],
                coins: [[180, 145], [206, 145], [420, 115], [515, 155], [710, 155], [935, 135], [1050, 120], [1400, 150], [1495, 160], [1600, 130], [1800, 158], [1945, 120]],
                enemies: [[370, 42], [740, 36], [1030, 45], [1400, 38], [1600, 42], [1870, 35]]
            },
            {
                name: 'MUNDO 1-2',
                sky: '#3973c6',
                ground: '#9c4b16',
                grass: '#00a800',
                length: 2250,
                gaps: [[440, 525], [920, 1015], [1510, 1600], [1940, 2035]],
                pipes: [[215, 54], [660, 68], [1130, 48], [1710, 64], [2130, 55]],
                blocks: [[310, 110], [336, 110], [735, 138], [1040, 102], [1066, 102], [1390, 125], [1650, 108], [1676, 108], [1830, 138]],
                platforms: [[365, 120, 90], [550, 78, 100], [820, 108, 100], [1200, 86, 115], [1440, 145, 105], [1750, 102, 110], [2070, 125, 100]],
                coins: [[325, 150], [380, 165], [580, 120], [755, 170], [850, 140], [1080, 145], [1220, 130], [1460, 175], [1690, 140], [1770, 150], [1860, 170], [2090, 155], [2180, 125]],
                enemies: [[370, 38], [700, 42], [870, 32], [1260, 44], [1790, 40], [1880, 34], [2150, 38]]
            },
            {
                name: 'MUNDO 1-3',
                sky: '#241b64',
                ground: '#6e3a20',
                grass: '#26b94a',
                length: 2400,
                gaps: [[510, 600], [1050, 1160], [1660, 1770], [2120, 2225]],
                pipes: [[275, 58], [735, 75], [1260, 52], [1530, 65], [1910, 72], [2290, 58]],
                blocks: [[200, 125], [226, 125], [430, 155], [650, 108], [676, 108], [950, 135], [1220, 125], [1246, 125], [1460, 155], [1810, 112], [1836, 112], [2040, 145], [2250, 110]],
                platforms: [[340, 100, 95], [785, 125, 110], [990, 92, 100], [1330, 115, 115], [1580, 135, 95], [1870, 120, 120], [1980, 88, 85], [2235, 135, 100]],
                coins: [[210, 170], [440, 185], [690, 145], [815, 175], [1010, 145], [1240, 165], [1350, 155], [1480, 185], [1600, 175], [1850, 155], [2010, 135], [2060, 175], [2250, 165], [2350, 125]],
                enemies: [[370, 40], [830, 36], [970, 34], [1380, 42], [1610, 38], [1870, 44], [2050, 36], [2320, 40]]
            }
        ];

        function resizeMarioCanvas() {
            marioCanvas.width = marioCanvas.parentElement.clientWidth;
            marioCanvas.height = marioCanvas.parentElement.clientHeight;
        }

        function resetMarioGame() {
            document.getElementById('mario-overlay').classList.add('hidden');
            const w = marioCanvas.width || 500;
            const h = marioCanvas.height || 240;
            const scale = Math.min(1, w / 500);
            const size = value => value * scale;
            const groundY = h - size(36);
            const level = marioLevels[marioLevelIndex];
            const solids = [
                ...level.platforms.map(([x, height, width]) => ({
                    x: size(x), y: groundY - size(height), w: size(width), h: size(10), type: 'platform'
                })),
                ...level.pipes.map(([x, height]) => ({
                    x: size(x), y: groundY - size(height), w: size(38), h: size(height), type: 'pipe'
                })),
                ...level.blocks.map(([x, height]) => ({
                    x: size(x), y: groundY - size(height), w: size(26), h: size(26), type: 'block', hit: false
                }))
            ];
            marioState = {
                scale,
                x: size(40),
                y: groundY - size(28),
                vx: 0,
                vy: 0,
                w: size(22),
                h: size(28),
                grounded: true,
                score: marioTotalScore,
                won: false,
                groundY: groundY,
                solids,
                gaps: level.gaps.map(([start, end]) => [size(start), size(end)]),
                coins: level.coins.map(([x, height]) => ({ x: size(x), y: groundY - size(height), collected: false })),
                enemies: level.enemies.map(([x, range], index) => ({
                    x: size(x), y: groundY - size(20), w: size(20), h: size(20),
                    startX: size(x), range: size(range), direction: index % 2 ? -1 : 1, alive: true
                })),
                level,
                levelWidth: size(level.length),
                cameraX: 0,
                lastFrame: 0,
                facing: 1,
                flagX: size(level.length - 90)
            };
            document.getElementById('mario-level').textContent = level.name;
            document.getElementById('mario-lives').textContent = `VIDAS: ${marioLives}`;
            document.getElementById('mario-score').textContent = `PUNTOS: ${marioState.score}`;
        }

        function advanceMarioLevel() {
            marioLevelIndex++;
            if (marioLevelIndex >= marioLevels.length) {
                marioLevelIndex = 0;
                marioLives = 3;
                marioTotalScore = 0;
            }
            resetMarioGame();
        }

        function resetMarioProgress() {
            marioLevelIndex = 0;
            marioLives = 3;
            marioTotalScore = 0;
            resetMarioGame();
        }

        function loseMarioLife() {
            marioLives--;
            if (marioLives <= 0) {
                marioLives = 3;
                marioLevelIndex = 0;
                marioTotalScore = 0;
            }
            resetMarioGame();
            showToast(marioLives === 3 ? 'Fin de partida. Reiniciado desde el Mundo 1-1' : '¡Cuidado! Pierdes una vida', 'fa-heart-crack');
        }

        function marioJump() {
            if (marioState.grounded && !marioState.won) {
                marioState.vy = -9.6 * marioState.scale;
                marioState.grounded = false;
            }
        }

        window.addEventListener('keydown', (e) => {
            if (currentTheme !== 'retro') return;
            if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
            const key = e.key.toLowerCase();
            if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
            if (e.key === 'ArrowLeft' || key === 'a') marioKeys.left = true;
            if (e.key === 'ArrowRight' || key === 'd') marioKeys.right = true;
            if (e.key === 'ArrowDown' || key === 's') marioKeys.brake = true;
            if (e.key === 'Shift' || key === 'b') marioKeys.run = true;
            if (e.key === ' ' || e.key === 'ArrowUp' || key === 'w' || key === 'z') {
                if (!marioKeys.jump) marioJump();
                marioKeys.jump = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (e.key === 'ArrowLeft' || key === 'a') marioKeys.left = false;
            if (e.key === 'ArrowRight' || key === 'd') marioKeys.right = false;
            if (e.key === 'ArrowDown' || key === 's') marioKeys.brake = false;
            if (e.key === 'Shift' || key === 'b') marioKeys.run = false;
            if (e.key === ' ' || e.key === 'ArrowUp' || key === 'w' || key === 'z') marioKeys.jump = false;
        });
        window.addEventListener('blur', () => {
            Object.keys(marioKeys).forEach(key => { marioKeys[key] = false; });
        });

        function updateAndDrawMario(now = performance.now()) {
            requestAnimationFrame(updateAndDrawMario);
            if (currentTheme !== 'retro' || !marioState.groundY) return;

            const w = marioCanvas.width;
            const h = marioCanvas.height;
            const scale = marioState.scale;
            const dt = marioState.lastFrame ? Math.min((now - marioState.lastFrame) / 16.67, 2) : 1;
            marioState.lastFrame = now;
            const state = marioState;

            if (!state.won) {
                const previousBottom = state.y + state.h;
                const direction = (marioKeys.right ? 1 : 0) - (marioKeys.left ? 1 : 0);
                const maxSpeed = (marioKeys.run ? 4.1 : 2.8) * scale;
                if (marioKeys.brake) {
                    state.vx *= Math.pow(0.55, dt);
                } else if (direction) {
                    state.vx += direction * 0.42 * scale * dt;
                    state.vx = Math.max(-maxSpeed, Math.min(maxSpeed, state.vx));
                    state.facing = direction;
                } else {
                    state.vx *= Math.pow(0.78, dt);
                    if (Math.abs(state.vx) < 0.08 * scale) state.vx = 0;
                }

                state.x += state.vx * dt;
                state.x = Math.max(0, Math.min(state.levelWidth - state.w, state.x));
                for (const solid of state.solids) {
                    if (state.y + state.h <= solid.y || state.y >= solid.y + solid.h ||
                        state.x + state.w <= solid.x || state.x >= solid.x + solid.w) continue;
                    if (state.vx > 0) state.x = solid.x - state.w;
                    else if (state.vx < 0) state.x = solid.x + solid.w;
                    state.vx = 0;
                }

                if (marioKeys.jump && state.vy < 0) state.vy -= 0.12 * scale * dt;
                state.vy = Math.min(10 * scale, state.vy + 0.48 * scale * dt);
                state.y += state.vy * dt;
                state.grounded = false;

                for (const solid of state.solids) {
                    const overlapsX = state.x + state.w > solid.x && state.x < solid.x + solid.w;
                    if (!overlapsX || state.y + state.h <= solid.y || state.y >= solid.y + solid.h) continue;
                    if (state.vy > 0 && previousBottom <= solid.y + 4 * scale) {
                        state.y = solid.y - state.h;
                        state.vy = 0;
                        state.grounded = true;
                    } else if (state.vy < 0 && state.y < solid.y + solid.h) {
                        state.y = solid.y + solid.h;
                        state.vy = 0.5 * scale;
                        if (solid.type === 'block' && !solid.hit) {
                            solid.hit = true;
                            state.score += 100;
                            marioTotalScore = state.score;
                            document.getElementById('mario-score').textContent = `PUNTOS: ${state.score}`;
                        }
                    }
                }

                const playerCenter = state.x + state.w / 2;
                const overGap = state.gaps.some(([start, end]) => playerCenter >= start && playerCenter <= end);
                if (!overGap && state.y + state.h >= state.groundY && state.y < state.groundY) {
                    state.y = state.groundY - state.h;
                    state.vy = 0;
                    state.grounded = true;
                }

                for (const coin of state.coins) {
                    if (!coin.collected && Math.abs(playerCenter - coin.x) < 17 * scale &&
                        Math.abs((state.y + state.h / 2) - coin.y) < 20 * scale) {
                        coin.collected = true;
                        state.score += 50;
                        marioTotalScore = state.score;
                        document.getElementById('mario-score').textContent = `PUNTOS: ${state.score}`;
                    }
                }

                let hitEnemy = false;
                for (const enemy of state.enemies) {
                    if (!enemy.alive) continue;
                    enemy.x += 0.85 * scale * enemy.direction * dt;
                    if (enemy.x > enemy.startX + enemy.range || enemy.x < enemy.startX - enemy.range) {
                        enemy.direction *= -1;
                    }
                    const overlap = state.x + state.w > enemy.x && state.x < enemy.x + enemy.w &&
                        state.y + state.h > enemy.y && state.y < enemy.y + enemy.h;
                    if (!overlap) continue;
                    if (state.vy > 0 && previousBottom <= enemy.y + 8 * scale) {
                        enemy.alive = false;
                        state.vy = -6.5 * scale;
                        state.score += 200;
                        marioTotalScore = state.score;
                        document.getElementById('mario-score').textContent = `PUNTOS: ${state.score}`;
                    } else {
                        hitEnemy = true;
                        break;
                    }
                }

                if (hitEnemy || state.y > h + 24 * scale) {
                    loseMarioLife();
                } else if (state.x + state.w >= state.flagX) {
                    state.won = true;
                    state.score += 500;
                    marioTotalScore = state.score;
                    document.getElementById('mario-score').textContent = `PUNTOS: ${state.score}`;
                    document.getElementById('mario-msg').textContent = marioLevelIndex === marioLevels.length - 1
                        ? `¡AVENTURA COMPLETADA! PUNTOS: ${state.score}`
                        : `¡NIVEL SUPERADO! PUNTOS: ${state.score}`;
                    document.getElementById('mario-next-button').textContent = marioLevelIndex === marioLevels.length - 1
                        ? 'JUGAR DE NUEVO'
                        : 'SIGUIENTE NIVEL';
                    document.getElementById('mario-overlay').classList.remove('hidden');
                }
            }

            state.cameraX = Math.max(0, Math.min(state.levelWidth - w, state.x - w * 0.36));
            const cameraX = state.cameraX;
            const screenX = worldX => worldX - cameraX;
            marioCtx.fillStyle = state.level.sky;
            marioCtx.fillRect(0, 0, w, h);

            for (let cloud = Math.floor(cameraX * 0.2 / (150 * scale)); cloud < Math.ceil((cameraX * 0.2 + w) / (150 * scale)) + 1; cloud++) {
                const cx = cloud * 150 * scale - cameraX * 0.2 + 25 * scale;
                const cy = (28 + (cloud % 3) * 13) * scale;
                marioCtx.fillStyle = 'rgba(255,255,255,0.82)';
                marioCtx.fillRect(cx, cy, 38 * scale, 10 * scale);
                marioCtx.fillRect(cx + 8 * scale, cy - 7 * scale, 21 * scale, 9 * scale);
            }
            for (let hill = Math.floor(cameraX * 0.35 / (220 * scale)); hill < Math.ceil((cameraX * 0.35 + w) / (220 * scale)) + 1; hill++) {
                const hx = hill * 220 * scale - cameraX * 0.35;
                marioCtx.fillStyle = state.level.grass;
                marioCtx.beginPath();
                marioCtx.moveTo(hx, state.groundY);
                marioCtx.lineTo(hx + 95 * scale, state.groundY - 38 * scale);
                marioCtx.lineTo(hx + 190 * scale, state.groundY);
                marioCtx.fill();
            }

            const drawGround = (start, end) => {
                const x = screenX(start);
                const width = end - start;
                marioCtx.fillStyle = state.level.ground;
                marioCtx.fillRect(x, state.groundY, width, h - state.groundY);
                marioCtx.fillStyle = state.level.grass;
                marioCtx.fillRect(x, state.groundY, width, 6 * scale);
                marioCtx.strokeStyle = 'rgba(0,0,0,0.3)';
                marioCtx.lineWidth = scale;
                for (let tile = Math.ceil(start / (18 * scale)) * 18 * scale; tile < end; tile += 18 * scale) {
                    marioCtx.strokeRect(screenX(tile), state.groundY + 9 * scale, 18 * scale, 15 * scale);
                }
            };
            let groundCursor = 0;
            for (const [gapStart, gapEnd] of state.gaps) {
                drawGround(groundCursor, gapStart);
                groundCursor = gapEnd;
            }
            drawGround(groundCursor, state.levelWidth);
            state.gaps.forEach(([gapStart, gapEnd]) => {
                marioCtx.fillStyle = '#17203a';
                marioCtx.fillRect(screenX(gapStart), state.groundY, gapEnd - gapStart, h - state.groundY);
            });

            state.solids.forEach(solid => {
                const x = screenX(solid.x);
                if (x + solid.w < 0 || x > w) return;
                if (solid.type === 'pipe') {
                    marioCtx.fillStyle = '#00a800';
                    marioCtx.fillRect(x, solid.y, solid.w, solid.h);
                    marioCtx.fillStyle = '#21d421';
                    marioCtx.fillRect(x + 5 * scale, solid.y + 2 * scale, 6 * scale, solid.h - 2 * scale);
                    marioCtx.fillStyle = '#006000';
                    marioCtx.fillRect(x - 4 * scale, solid.y, solid.w + 8 * scale, 9 * scale);
                    marioCtx.strokeStyle = '#003b00';
                    marioCtx.lineWidth = 2 * scale;
                    marioCtx.strokeRect(x, solid.y, solid.w, solid.h);
                } else {
                    marioCtx.fillStyle = solid.type === 'block' ? (solid.hit ? '#887000' : '#fca044') : '#9a551d';
                    marioCtx.fillRect(x, solid.y, solid.w, solid.h);
                    marioCtx.strokeStyle = '#24170b';
                    marioCtx.lineWidth = 2 * scale;
                    marioCtx.strokeRect(x, solid.y, solid.w, solid.h);
                    if (solid.type === 'block' && !solid.hit) {
                        marioCtx.fillStyle = '#2c1b0e';
                        marioCtx.font = `bold ${Math.max(8, 14 * scale)}px monospace`;
                        marioCtx.fillText('?', x + 8 * scale, solid.y + 19 * scale);
                    }
                }
            });

            state.coins.forEach(coin => {
                if (coin.collected) return;
                const x = screenX(coin.x);
                const coinWidth = (Math.sin(now * 0.012 + coin.x) > 0.85 ? 3 : 6) * scale;
                marioCtx.fillStyle = '#ffcd35';
                marioCtx.fillRect(x - coinWidth, coin.y - 8 * scale, coinWidth * 2, 16 * scale);
                marioCtx.fillStyle = '#fff29b';
                marioCtx.fillRect(x - scale, coin.y - 5 * scale, 2 * scale, 10 * scale);
            });

            state.enemies.forEach(enemy => {
                if (!enemy.alive) return;
                const x = screenX(enemy.x);
                if (x + enemy.w < 0 || x > w) return;
                marioCtx.fillStyle = '#7c3f00';
                marioCtx.fillRect(x + 2 * scale, enemy.y + 3 * scale, enemy.w - 4 * scale, enemy.h - 3 * scale);
                marioCtx.fillStyle = '#d8a060';
                marioCtx.fillRect(x + 3 * scale, enemy.y + 6 * scale, enemy.w - 6 * scale, 7 * scale);
                marioCtx.fillStyle = '#000';
                marioCtx.fillRect(x + 5 * scale, enemy.y + 7 * scale, 3 * scale, 3 * scale);
                marioCtx.fillRect(x + 12 * scale, enemy.y + 7 * scale, 3 * scale, 3 * scale);
                marioCtx.fillRect(x, enemy.y + enemy.h - 2 * scale, 8 * scale, 3 * scale);
                marioCtx.fillRect(x + enemy.w - 8 * scale, enemy.y + enemy.h - 2 * scale, 8 * scale, 3 * scale);
            });

            const flagX = screenX(state.flagX);
            marioCtx.fillStyle = '#ffffff';
            marioCtx.fillRect(flagX, state.groundY - 110 * scale, 4 * scale, 110 * scale);
            marioCtx.fillStyle = state.level.grass;
            marioCtx.beginPath();
            marioCtx.moveTo(flagX + 4 * scale, state.groundY - 110 * scale);
            marioCtx.lineTo(flagX + 32 * scale, state.groundY - 96 * scale);
            marioCtx.lineTo(flagX + 4 * scale, state.groundY - 82 * scale);
            marioCtx.fill();

            const mx = screenX(state.x);
            const my = state.y;
            const walkFrame = Math.floor(now / 100) % 2;
            marioCtx.fillStyle = '#d63c36';
            marioCtx.fillRect(mx + 2 * scale, my, 18 * scale, 6 * scale);
            marioCtx.fillRect(mx + (state.facing > 0 ? 13 : 2) * scale, my + 6 * scale, 8 * scale, 4 * scale);
            marioCtx.fillStyle = '#f4b183';
            marioCtx.fillRect(mx + (state.facing > 0 ? 8 : 3) * scale, my + 6 * scale, 12 * scale, 8 * scale);
            marioCtx.fillStyle = '#30202a';
            marioCtx.fillRect(mx + (state.facing > 0 ? 16 : 4) * scale, my + 8 * scale, 2 * scale, 2 * scale);
            marioCtx.fillStyle = '#d63c36';
            marioCtx.fillRect(mx + 3 * scale, my + 14 * scale, 16 * scale, 6 * scale);
            marioCtx.fillStyle = '#2462b2';
            marioCtx.fillRect(mx + 4 * scale, my + 19 * scale, 14 * scale, 6 * scale);
            marioCtx.fillStyle = '#49322c';
            marioCtx.fillRect(mx + (walkFrame && state.grounded ? 1 : 3) * scale, my + 25 * scale, 8 * scale, 3 * scale);
            marioCtx.fillRect(mx + (walkFrame && state.grounded ? 13 : 11) * scale, my + 25 * scale, 8 * scale, 3 * scale);

            marioCtx.fillStyle = 'rgba(0,0,0,0.45)';
            marioCtx.fillRect(5 * scale, 5 * scale, w - 10 * scale, 4 * scale);
            marioCtx.fillStyle = '#ffcd75';
            marioCtx.fillRect(5 * scale, 5 * scale, Math.max(0, (w - 10 * scale) * state.x / state.flagX), 4 * scale);
        }

        /* =========================================================================
           5. TEMA CRISTAL: JUEGO ROMPE EL HIELO (BLOQUES FRACTURABLES + ESQUIRLAS)
           ========================================================================= */
        const iceCanvas = document.getElementById('ice-canvas');
        const iceCtx = iceCanvas.getContext('2d');
        let iceBlocks = [];
        let iceShards = [];
        let isBreakingIce = false;

        function resizeIceCanvas() {
            iceCanvas.width = iceCanvas.parentElement.clientWidth;
            iceCanvas.height = iceCanvas.parentElement.clientHeight;
        }

        function initIceGame() {
            resizeIceCanvas();
            iceBlocks = [];
            iceShards = [];
            const cols = 8;
            const rows = 5;
            const bw = iceCanvas.width / cols;
            const bh = iceCanvas.height / rows;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    iceBlocks.push({
                        x: c * bw,
                        y: r * bh,
                        w: bw,
                        h: bh,
                        hp: 2,
                        shimmer: Math.random() * Math.PI * 2
                    });
                }
            }
            updateIceProgress();
        }

        function updateIceProgress() {
            const total = iceBlocks.length * 2;
            const remaining = iceBlocks.reduce((acc, b) => acc + b.hp, 0);
            const pct = Math.round(((total - remaining) / total) * 100);
            document.getElementById('ice-progress').textContent = `${pct}% Roto`;
        }

        function hitIceAt(clientX, clientY) {
            const rect = iceCanvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            iceBlocks.forEach(b => {
                if (b.hp > 0 && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                    b.hp--;
                    for (let i = 0; i < 10; i++) {
                        iceShards.push({
                            x: x,
                            y: y,
                            vx: (Math.random() - 0.5) * 7,
                            vy: (Math.random() - 0.7) * 7,
                            size: 3 + Math.random() * 5,
                            alpha: 1,
                            rot: Math.random() * Math.PI
                        });
                    }
                    updateIceProgress();
                }
            });
        }

        iceCanvas.addEventListener('mousedown', (e) => { isBreakingIce = true; hitIceAt(e.clientX, e.clientY); });
        iceCanvas.addEventListener('mousemove', (e) => { if (isBreakingIce) hitIceAt(e.clientX, e.clientY); });
        window.addEventListener('mouseup', () => { isBreakingIce = false; });
        iceCanvas.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            hitIceAt(t.clientX, t.clientY);
        });
        iceCanvas.addEventListener('touchmove', (e) => {
            const t = e.touches[0];
            hitIceAt(t.clientX, t.clientY);
        });

        function renderIceLoop() {
            requestAnimationFrame(renderIceLoop);
            if (currentTheme !== 'cristal') return;

            const w = iceCanvas.width;
            const h = iceCanvas.height;
            iceCtx.clearRect(0, 0, w, h);

            const grad = iceCtx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6);
            grad.addColorStop(0, '#38bdf8');
            grad.addColorStop(0.5, '#0284c7');
            grad.addColorStop(1, '#082f49');
            iceCtx.fillStyle = grad;
            iceCtx.fillRect(0, 0, w, h);

            iceCtx.save();
            iceCtx.translate(w / 2, h / 2);
            iceCtx.rotate(Date.now() * 0.001);
            iceCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            iceCtx.beginPath();
            iceCtx.moveTo(0, -35);
            iceCtx.lineTo(28, 0);
            iceCtx.lineTo(0, 35);
            iceCtx.lineTo(-28, 0);
            iceCtx.closePath();
            iceCtx.fill();
            iceCtx.restore();

            iceBlocks.forEach(b => {
                if (b.hp <= 0) return;
                b.shimmer += 0.03;
                iceCtx.fillStyle = b.hp === 2 ? 'rgba(224, 242, 254, 0.78)' : 'rgba(186, 230, 253, 0.45)';
                iceCtx.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);

                iceCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                iceCtx.lineWidth = 1.5;
                iceCtx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);

                if (b.hp === 1) {
                    iceCtx.beginPath();
                    iceCtx.moveTo(b.x + 5, b.y + 5);
                    iceCtx.lineTo(b.x + b.w * 0.5, b.y + b.h * 0.5);
                    iceCtx.lineTo(b.x + b.w - 6, b.y + b.h * 0.3);
                    iceCtx.moveTo(b.x + b.w * 0.5, b.y + b.h * 0.5);
                    iceCtx.lineTo(b.x + b.w * 0.3, b.y + b.h - 4);
                    iceCtx.stroke();
                }
            });

            for (let i = iceShards.length - 1; i >= 0; i--) {
                const s = iceShards[i];
                s.x += s.vx;
                s.y += s.vy;
                s.vy += 0.25;
                s.alpha -= 0.025;
                if (s.alpha <= 0) {
                    iceShards.splice(i, 1);
                    continue;
                }
                iceCtx.save();
                iceCtx.globalAlpha = s.alpha;
                iceCtx.translate(s.x, s.y);
                iceCtx.rotate(s.rot);
                iceCtx.fillStyle = '#ffffff';
                iceCtx.beginPath();
                iceCtx.moveTo(0, -s.size);
                iceCtx.lineTo(s.size, s.size);
                iceCtx.lineTo(-s.size, s.size);
                iceCtx.closePath();
                iceCtx.fill();
                iceCtx.restore();
            }
        }

        /* =========================================================================
           6. TEMA HACKER: TERMINAL DE CÓDIGO, ESQUELETO (3s) Y DERRUMBE CON NOMBRE
           ========================================================================= */
        function logTerminal(text, isError = false) {
            const log = document.getElementById('hacker-terminal-log');
            const line = document.createElement('div');
            line.className = isError ? 'text-red-400' : 'text-green-400';
            line.innerHTML = `<span class="opacity-60">[${new Date().toLocaleTimeString()}]</span> ${text}`;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }

        function handleTerminalCommand(e) {
            e.preventDefault();
            const input = document.getElementById('terminal-cmd-input');
            const cmd = input.value.trim().toLowerCase();
            if (!cmd) return;
            input.value = '';
            logTerminal(`$ ${cmd}`);

            if (cmd === 'help') {
                logTerminal('Comandos: <b>skeleton</b> (modo esqueleto 3s), <b>collapse</b> (derrumbar web), <b>scan</b> (analizar DOM).');
            } else if (cmd === 'scan') {
                const nodes = document.querySelectorAll('*').length;
                logTerminal(`Escaneo completado: ${nodes} nodos DOM detectados. Vulnerabilidad CSS lista.`);
            } else if (cmd === 'skeleton') {
                triggerSkeletonHack();
            } else if (cmd === 'collapse') {
                triggerPageCollapse();
            } else {
                logTerminal(`Comando ejecutado: inyectando payload "${cmd}"... OK.`);
            }
        }

        function triggerSkeletonHack() {
            logTerminal('INICIANDO EXPLOIT: Despojando hojas de estilo y exponiendo código fuente por 3.0s...');
            const overlay = document.getElementById('hacker-code-overlay');
            const codeBox = document.getElementById('live-source-code');
            const timerBadge = document.getElementById('skeleton-timer');

            const rawHtml = document.documentElement.outerHTML.slice(0, 3800);
            codeBox.textContent = rawHtml;

            document.body.classList.add('skeleton-mode');
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');

            let remaining = 3.0;
            const interval = setInterval(() => {
                remaining -= 0.1;
                if (remaining <= 0) {
                    clearInterval(interval);
                    document.body.classList.remove('skeleton-mode');
                    overlay.classList.add('hidden');
                    overlay.classList.remove('flex');
                    logTerminal('SISTEMA RESTAURADO: CSS recompilado con éxito.');
                } else {
                    timerBadge.textContent = `RESTAURANDO EN: ${remaining.toFixed(1)}s`;
                }
            }, 100);
        }

        let letterRainParticles = [];
        let isLetterCollapseActive = false;

        function triggerPageCollapse() {
            const userInput = hackerNameInput.value.trim();
            const hackerName = (userInput || 'HACKER_ROOT').toUpperCase();

            logTerminal(`ALERTA CRÍTICA: Ejecutando derrumbe estructural firmado por [${hackerName}]...`, true);

            const blocks = document.querySelectorAll('.collapsible-block, #app-header');
            blocks.forEach((el, idx) => {
                const rot = (Math.random() - 0.5) * 35;
                const dropY = window.innerHeight + 250;
                setTimeout(() => {
                    el.classList.add('collapsing-element');
                    el.style.transform = `translateY(${dropY}px) rotate(${rot}deg)`;
                    el.style.opacity = '0.2';
                }, idx * 110);
            });

            setTimeout(() => {
                startLetterCollapseWithName(hackerName);
                document.getElementById('collapse-restore-banner').classList.remove('hidden');
            }, 600);
        }

        function startLetterCollapseWithName(name) {
            const fxCanvas = document.getElementById('global-fx-canvas');
            fxCanvas.width = window.innerWidth;
            fxCanvas.height = window.innerHeight;
            letterRainParticles = [];
            isLetterCollapseActive = true;

            const chars = name.split('');
            const totalParticles = 140;

            for (let i = 0; i < totalParticles; i++) {
                const ch = chars[i % chars.length];
                letterRainParticles.push({
                    char: ch,
                    x: Math.random() * fxCanvas.width,
                    y: -Math.random() * fxCanvas.height,
                    vy: 3 + Math.random() * 6,
                    vx: (Math.random() - 0.5) * 2,
                    size: 16 + Math.random() * 14,
                    isSignature: false,
                    targetX: 0,
                    targetY: 0
                });
            }

            const spacing = Math.min(48, (fxCanvas.width - 60) / Math.max(1, chars.length));
            const startX = (fxCanvas.width - (chars.length - 1) * spacing) / 2;
            const floorY = fxCanvas.height * 0.55;

            chars.forEach((ch, index) => {
                letterRainParticles.push({
                    char: ch,
                    x: startX + index * spacing + (Math.random() - 0.5) * 80,
                    y: -120 - index * 60,
                    vy: 2,
                    vx: 0,
                    size: Math.min(54, spacing * 1.1),
                    isSignature: true,
                    targetX: startX + index * spacing,
                    targetY: floorY
                });
            });
        }

        function restoreCollapsedPage() {
            isLetterCollapseActive = false;
            letterRainParticles = [];
            document.getElementById('collapse-restore-banner').classList.add('hidden');
            const blocks = document.querySelectorAll('.collapsible-block, #app-header');
            blocks.forEach(el => {
                el.style.transform = '';
                el.style.opacity = '';
                setTimeout(() => el.classList.remove('collapsing-element'), 500);
            });
            logTerminal('SISTEMA RECONSTRUIDO: Integridad del DOM al 100%.');
            showToast('Página restaurada correctamente', 'fa-shield-halved');
        }

        /* =========================================================================
           7. TEMA SYNTHWAVE: FUEGOS ARTIFICIALES SINCRONIZADOS CON BASS Y VELOCIDAD
           ========================================================================= */
        const synthCanvas = document.getElementById('synthwave-canvas');
        const synthCtx = synthCanvas.getContext('2d');
        let fireworks = [];
        let fwParticles = [];

        function resizeSynthwaveCanvas() {
            synthCanvas.width = synthCanvas.parentElement.clientWidth;
            synthCanvas.height = synthCanvas.parentElement.clientHeight;
        }

        function spawnFirework(fromAudio = false, customX = null, customY = null) {
            const w = synthCanvas.width || 500;
            const h = synthCanvas.height || 240;
            const colors = ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96'];
            const color = colors[Math.floor(Math.random() * colors.length)];

            const targetX = customX !== null ? customX : 40 + Math.random() * (w - 80);
            const targetY = customY !== null ? customY : 25 + Math.random() * (h * 0.55);

            fireworks.push({
                x: targetX,
                y: h,
                targetY: targetY,
                vy: -(5 + playbackRate * 3.5),
                color: color,
                power: fromAudio ? (0.8 + (bassEnergy / 100) * 1.2) : 1.2
            });
        }

        function launchManualFirework() {
            spawnFirework(false);
        }

        synthCanvas.addEventListener('click', (e) => {
            const rect = synthCanvas.getBoundingClientRect();
            spawnFirework(false, e.clientX - rect.left, e.clientY - rect.top);
        });

        function renderSynthwaveLoop() {
            requestAnimationFrame(renderSynthwaveLoop);
            if (currentTheme !== 'synthwave') return;

            const w = synthCanvas.width;
            const h = synthCanvas.height;

            synthCtx.fillStyle = 'rgba(9, 1, 20, 0.24)';
            synthCtx.fillRect(0, 0, w, h);

            const gridPulse = (bassEnergy / 100) * 12;
            synthCtx.strokeStyle = 'rgba(255, 113, 206, 0.25)';
            synthCtx.lineWidth = 1;
            synthCtx.beginPath();
            synthCtx.moveTo(0, h - 35 - gridPulse);
            synthCtx.lineTo(w, h - 35 - gridPulse);
            synthCtx.stroke();

            for (let i = fireworks.length - 1; i >= 0; i--) {
                const f = fireworks[i];
                f.y += f.vy;
                synthCtx.fillStyle = f.color;
                synthCtx.fillRect(f.x - 2, f.y, 4, 10);

                if (f.y <= f.targetY) {
                    const count = Math.floor(28 * f.power);
                    for (let p = 0; p < count; p++) {
                        const angle = (Math.PI * 2 * p) / count;
                        const speed = (1.5 + Math.random() * 3.5) * f.power * Math.sqrt(playbackRate);
                        fwParticles.push({
                            x: f.x,
                            y: f.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            color: f.color,
                            alpha: 1
                        });
                    }
                    fireworks.splice(i, 1);
                }
            }

            for (let i = fwParticles.length - 1; i >= 0; i--) {
                const p = fwParticles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.06;
                p.alpha -= 0.018 * playbackRate;
                if (p.alpha <= 0) {
                    fwParticles.splice(i, 1);
                    continue;
                }
                synthCtx.save();
                synthCtx.globalAlpha = p.alpha;
                synthCtx.fillStyle = p.color;
                synthCtx.shadowBlur = 8;
                synthCtx.shadowColor = p.color;
                synthCtx.beginPath();
                synthCtx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
                synthCtx.fill();
                synthCtx.restore();
            }
        }

        /* =========================================================================
           8. TEMA CÓMIC: SOLO LÁPIZ DE DIBUJO LIBRE
           ========================================================================= */
        const comicCanvas = document.getElementById('comic-canvas');
        const comicCtx = comicCanvas.getContext('2d');
        let isDrawingComic = false;
        let lastComicX = 0;
        let lastComicY = 0;

        function resizeComicCanvas() {
            const temp = comicCtx.getImageData(0, 0, comicCanvas.width || 1, comicCanvas.height || 1);
            comicCanvas.width = comicCanvas.parentElement.clientWidth;
            comicCanvas.height = comicCanvas.parentElement.clientHeight;
            comicCtx.putImageData(temp, 0, 0);
        }

        function clearComicCanvas() {
            comicCtx.clearRect(0, 0, comicCanvas.width, comicCanvas.height);
        }

        function getComicCoords(e) {
            const rect = comicCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        }

        function startComicDraw(e) {
            isDrawingComic = true;
            const pos = getComicCoords(e);
            lastComicX = pos.x;
            lastComicY = pos.y;
        }

        function moveComicDraw(e) {
            if (!isDrawingComic) return;
            if (e.touches) e.preventDefault();
            const pos = getComicCoords(e);
            comicCtx.strokeStyle = document.getElementById('comic-pencil-color').value;
            comicCtx.lineWidth = parseInt(document.getElementById('comic-pencil-size').value, 10);
            comicCtx.lineCap = 'round';
            comicCtx.lineJoin = 'round';

            comicCtx.beginPath();
            comicCtx.moveTo(lastComicX, lastComicY);
            comicCtx.lineTo(pos.x, pos.y);
            comicCtx.stroke();

            lastComicX = pos.x;
            lastComicY = pos.y;
        }

        function endComicDraw() {
            isDrawingComic = false;
        }

        comicCanvas.addEventListener('mousedown', startComicDraw);
        comicCanvas.addEventListener('mousemove', moveComicDraw);
        window.addEventListener('mouseup', endComicDraw);
        comicCanvas.addEventListener('touchstart', startComicDraw, { passive: false });
        comicCanvas.addEventListener('touchmove', moveComicDraw, { passive: false });
        comicCanvas.addEventListener('touchend', endComicDraw);

        /* =========================================================================
           9. LOOP GLOBAL DE EFECTOS (DERRUMBE DE LETRAS CON NOMBRE DEL USUARIO)
           ========================================================================= */
        const fxCanvas = document.getElementById('global-fx-canvas');
        const fxCtx = fxCanvas.getContext('2d');
        const auraParticles = [];
        const partyBackgroundLayer = document.getElementById('party-background-layer');
        const partyBackgroundImage = document.getElementById('party-background-image');
        const partyBackgroundVideo = document.getElementById('party-background-video');
        const partyBackgroundInput = document.getElementById('party-background-upload');
        const partyBackgroundClearButton = document.getElementById('party-background-clear');
        const partyBackgroundName = document.getElementById('party-background-name');
        const auraBurstMessage = document.getElementById('aura-burst-message');
        let partyBackgroundUrl = null;
        let auraMessageTimer = null;

        function resizeGlobalFxCanvas() {
            fxCanvas.width = window.innerWidth;
            fxCanvas.height = window.innerHeight;
        }

        window.addEventListener('resize', resizeGlobalFxCanvas);

        function releasePartyBackground() {
            partyBackgroundVideo.pause();
            partyBackgroundVideo.removeAttribute('src');
            partyBackgroundVideo.load();
            partyBackgroundImage.removeAttribute('src');
            if (partyBackgroundUrl) URL.revokeObjectURL(partyBackgroundUrl);
            partyBackgroundUrl = null;
            partyBackgroundLayer.classList.add('hidden');
            partyBackgroundImage.classList.add('hidden');
            partyBackgroundVideo.classList.add('hidden');
            document.body.classList.remove('party-background-active');
            partyBackgroundClearButton.disabled = true;
            partyBackgroundName.textContent = 'Sin fondo personalizado';
        }

        function handlePartyBackgroundUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            event.target.value = '';
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                showToast('Elige un archivo de imagen o video válido.', 'fa-triangle-exclamation');
                return;
            }

            releasePartyBackground();
            partyBackgroundUrl = URL.createObjectURL(file);
            const showPartyBackground = currentTheme === 'synthwave';
            partyBackgroundLayer.classList.toggle('hidden', !showPartyBackground);
            document.body.classList.toggle('party-background-active', showPartyBackground);
            partyBackgroundClearButton.disabled = false;
            partyBackgroundName.textContent = file.name;

            if (file.type.startsWith('video/')) {
                partyBackgroundVideo.src = partyBackgroundUrl;
                partyBackgroundVideo.classList.remove('hidden');
                partyBackgroundVideo.play().catch(() => {
                    showToast('No se pudo reproducir el video de fondo.', 'fa-circle-exclamation');
                });
            } else {
                partyBackgroundImage.onerror = () => {
                    showToast('No se pudo cargar la imagen de fondo.', 'fa-circle-exclamation');
                };
                partyBackgroundImage.src = partyBackgroundUrl;
                partyBackgroundImage.classList.remove('hidden');
            }

            showToast('Fondo a pantalla completa listo', 'fa-image');
        }

        function clearPartyBackground() {
            releasePartyBackground();
            partyBackgroundInput.value = '';
            showToast('Fondo personalizado quitado', 'fa-image');
        }

        function triggerAuraParty() {
            resizeGlobalFxCanvas();
            const colors = ['#ff4fd8', '#00e5ff', '#ffe600', '#7cff00', '#ff5e5b', '#9b5cff'];
            const audioBoost = isPlaying ? bassEnergy / 100 : 0;

            for (let burst = 0; burst < 9; burst++) {
                const centerX = 40 + Math.random() * Math.max(1, fxCanvas.width - 80);
                const centerY = 40 + Math.random() * Math.max(1, fxCanvas.height - 80);
                const particleCount = 24 + Math.round(audioBoost * 12);

                for (let index = 0; index < particleCount; index++) {
                    const angle = (Math.PI * 2 * index) / particleCount;
                    const speed = 2 + Math.random() * 4 + audioBoost * 2;
                    auraParticles.push({
                        x: centerX,
                        y: centerY,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        gravity: 0.035,
                        size: 3 + Math.random() * 5,
                        alpha: 1,
                        rotation: Math.random() * Math.PI,
                        spin: (Math.random() - 0.5) * 0.18,
                        color: colors[Math.floor(Math.random() * colors.length)]
                    });
                }
            }

            const messageText = auraBurstMessage.firstElementChild;
            auraBurstMessage.classList.remove('hidden');
            auraBurstMessage.classList.add('flex');
            messageText.classList.remove('aura-pop');
            void messageText.offsetWidth;
            messageText.classList.add('aura-pop');
            clearTimeout(auraMessageTimer);
            auraMessageTimer = setTimeout(() => {
                auraBurstMessage.classList.add('hidden');
                auraBurstMessage.classList.remove('flex');
                messageText.classList.remove('aura-pop');
            }, 1900);
            showToast('¡FIESTA FULL! +1000 AURA', 'fa-star');
        }

        function renderGlobalFxLoop() {
            requestAnimationFrame(renderGlobalFxLoop);
            if (!isLetterCollapseActive && auraParticles.length === 0) {
                fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
                return;
            }

            if (isLetterCollapseActive) {
                fxCtx.fillStyle = 'rgba(0, 5, 0, 0.22)';
                fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
            } else {
                fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
            }

            if (isLetterCollapseActive) {
                letterRainParticles.forEach(p => {
                    if (p.isSignature) {
                        p.x += (p.targetX - p.x) * 0.06;
                        if (p.y < p.targetY) {
                            p.vy += 0.45;
                            p.y += p.vy;
                        } else {
                            p.y = p.targetY;
                            p.vy = 0;
                        }
                        fxCtx.save();
                        fxCtx.font = `bold ${p.size}px "Fira Code", monospace`;
                        fxCtx.fillStyle = '#00ff41';
                        fxCtx.shadowBlur = 18;
                        fxCtx.shadowColor = '#00ff41';
                        fxCtx.textAlign = 'center';
                        fxCtx.fillText(p.char, p.x, p.y);
                        fxCtx.restore();
                    } else {
                        p.y += p.vy;
                        p.x += p.vx;
                        if (p.y > fxCanvas.height + 20) {
                            p.y = -20;
                            p.x = Math.random() * fxCanvas.width;
                        }
                        fxCtx.font = `${p.size}px "Fira Code", monospace`;
                        fxCtx.fillStyle = 'rgba(0, 255, 65, 0.65)';
                        fxCtx.fillText(p.char, p.x, p.y);
                    }
                });
            }

            for (let i = auraParticles.length - 1; i >= 0; i--) {
                const particle = auraParticles[i];
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.vy += particle.gravity;
                particle.vx *= 0.992;
                particle.rotation += particle.spin;
                particle.alpha -= 0.012;

                if (particle.alpha <= 0) {
                    auraParticles.splice(i, 1);
                    continue;
                }

                fxCtx.save();
                fxCtx.globalAlpha = particle.alpha;
                fxCtx.translate(particle.x, particle.y);
                fxCtx.rotate(particle.rotation);
                fxCtx.fillStyle = particle.color;
                fxCtx.shadowBlur = 8;
                fxCtx.shadowColor = particle.color;
                fxCtx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
                fxCtx.restore();
            }
        }

        let deferredInstallPrompt = null;

        window.addEventListener('beforeinstallprompt', event => {
            event.preventDefault();
            deferredInstallPrompt = event;
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            document.getElementById('install-app-button').classList.add('hidden');
            document.getElementById('offline-status').textContent = 'App instalada en este dispositivo';
            showToast('MP3 A quedó instalada', 'fa-circle-check');
        });

        async function installApp() {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            if (isStandalone) {
                showToast('La app ya está instalada', 'fa-circle-check');
                return;
            }

            if (window.location.protocol === 'file:') {
                showToast('Para instalarla, primero debe publicarse en HTTPS', 'fa-circle-info');
                return;
            }

            if (deferredInstallPrompt) {
                try {
                    const promptEvent = deferredInstallPrompt;
                    deferredInstallPrompt = null;
                    await promptEvent.prompt();
                    const { outcome } = await promptEvent.userChoice;
                    showToast(
                        outcome === 'accepted' ? 'Instalación iniciada' : 'Puedes instalarla desde el menú del navegador',
                        outcome === 'accepted' ? 'fa-circle-check' : 'fa-circle-info'
                    );
                } catch (error) {
                    console.error('No se pudo iniciar la instalación de MP3 A:', error);
                    showToast('No se pudo iniciar la instalación', 'fa-circle-exclamation');
                }
                return;
            }

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            showToast(
                isIOS
                    ? 'En Safari: Compartir y luego Añadir a pantalla de inicio'
                    : 'Abre el menú del navegador y elige Instalar aplicación o Añadir a pantalla de inicio',
                isIOS ? 'fa-share-from-square' : 'fa-circle-info'
            );
        }

        function initOfflineSupport() {
            const status = document.getElementById('offline-status');
            const installButton = document.getElementById('install-app-button');
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            if (isStandalone) {
                installButton.classList.add('hidden');
                status.textContent = navigator.onLine
                    ? 'App instalada • usa tus archivos locales'
                    : 'App instalada • importa audio local';
            }

            const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
            if (window.location.protocol !== 'https:' && !isLocalHost) {
                status.textContent = 'Para instalar y usar offline, abre la app desde HTTPS';
                return;
            }
            if (!('serviceWorker' in navigator)) {
                status.textContent = 'Este navegador no admite el modo sin conexión';
                return;
            }

            navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
                .then(() => navigator.serviceWorker.ready)
                .then(() => {
                    status.textContent = navigator.onLine
                        ? 'Lista para reproducir audio local'
                        : 'Sin conexión • elige audio de tu dispositivo';
                })
                .catch(error => {
                    status.textContent = 'No se pudo preparar el modo sin conexión';
                    console.error('No se pudo registrar el modo sin conexión de MP3 A:', error);
                });

            window.addEventListener('online', () => {
                status.textContent = 'Lista para reproducir audio local';
            });
            window.addEventListener('offline', () => {
                status.textContent = 'Sin conexión • elige audio de tu dispositivo';
            });
        }

        /* =========================================================================
           10. INICIALIZACIÓN AL CARGAR LA VENTANA
           ========================================================================= */
        window.onload = function () {
            applyBrandLogoForTheme('default');
            initOfflineSupport();
            restoreSavedLibraryPrompt();
            renderPlaylist();
            setVisualizerMode('spectrum');
            resizeVisualizer();
            renderVisualizerLoop();
            updateAndDrawMario();
            renderIceLoop();
            renderSynthwaveLoop();
            renderGlobalFxLoop();
            document.getElementById('playlist-search')?.addEventListener('input', renderPlaylist);
        };
