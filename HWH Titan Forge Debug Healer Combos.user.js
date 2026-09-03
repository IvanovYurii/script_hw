// ==UserScript==
// @name			HWH Titan Forge Debug Healer Combos
// @name:en			HWH Titan Forge Debug Healer Combos
// @name:ru			HWH Titan Forge Debug Healer Combos
// @namespace		HWHTitanForgeDebug
// @version			0.3.1-ui-button-fix
// WORK VERSION: v0.3.1-ui-button-fix
// FIX: attach Titan Forge button after the main menu is initialized
// SAFETY: no Worker or battle-result behavior changes

// @description		Extension for HeroWarsHelper script
// @description:en	Extension for HeroWarsHelper script
// @description:ru	Extension for HeroWarsHelper script
// @author			ZingerY
// @license 		Copyright ZingerY
// @homepage		https://zingery.ru/scripts/HWHBestDungeonExt_ec4d1eb36b22d19728e9d1d23ca84d1c.user.js
// @downloadURL		https://zingery.ru/scripts/HWHBestDungeonExt_ec4d1eb36b22d19728e9d1d23ca84d1c.user.js
// @updateURL		https://zingery.ru/scripts/HWHBestDungeonExt_ec4d1eb36b22d19728e9d1d23ca84d1c.user.js
// @icon			https://zingery.ru/scripts/VaultBoyIco16.ico
// @icon64			https://zingery.ru/scripts/VaultBoyIco64.png
// @match			https://www.hero-wars.com/*
// @match			https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at			document-start
// ==/UserScript==

(function () {
	if (!this.HWHClasses) {
		console.log('%cObject for extension not found', 'color: red');
		return;
	}

	console.log('%cStart Extension ' + GM_info.script.name + ', v' + GM_info.script.version + ' by ' + GM_info.script.author, 'color: red');
	const DEBUG_FORCE_CUSTOM_TEAMS = true;
	const DEBUG_LOG_SIMULATIONS = true;
	const DEBUG_STORAGE_KEY = 'HWHTitanForgeDebug.teams.v1';
	const DEBUG_TITAN_STATE_KEY = 'HWHTitanForgeDebug.titanState.v1';
	const DEBUG_MAX_SIMULATIONS = 100;
	const DEBUG_REPEAT_ATTEMPTS = 10;
	const DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT = 2;
	const DEBUG_MIN_TITAN_HP_DEFAULT = 30;
	const DEBUG_CONTROL_KEY = '__hwhTitanForgeControl';
	const { addExtentionName } = HWHFuncs;
	addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);

	const { getInput, setProgress, hideProgress, I18N, countdownTimer, getSaveVal, setSaveVal, popup, random } = HWHFuncs;

	const { DungeonFixBattle } = HWHClasses;

	function getDebugControl() {
		if (!window[DEBUG_CONTROL_KEY]) {
			window[DEBUG_CONTROL_KEY] = {
				stopAfterBattle: false,
			};
		}
		return window[DEBUG_CONTROL_KEY];
	}

	const DebugUI = {
		panel: null,
		output: null,
		input: null,
		status: null,
		logMode: 'technical',
		progress: null,
		battle: null,
		titanStats: null,
		config: null,
		currentDungeon: null,
		trackedTitanIds: [],
		lastBattleHpDetails: [],
		log(message, data = null) {
			const line = typeof message === 'string' ? message : JSON.stringify(message);
			const mode = this.config?.logMode || this.logMode || 'technical';
			const level = getDebugLogLevel(line);
			if (!shouldDisplayDebugLog(level, mode)) {
				return;
			}
			const text = formatDebugLogText(line, data, mode);
			console.log(text);
			if (!this.output) return;
			const item = document.createElement('div');
			item.textContent = text;
			if (text.startsWith('Battle order:')) {
				item.style.cssText = 'font-weight:800;color:#ffd86b;background:rgba(255,216,107,.08);border-left:3px solid #ffd86b;padding-left:6px;';
			}
			this.output.appendChild(item);
			this.output.scrollTop = this.output.scrollHeight;
		},
		async copyLog() {
			if (!this.output) return 0;
			const text = this.output.innerText.trim();
			try {
				await navigator.clipboard.writeText(text);
				return text.length;
			} catch (_error) {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.left = '-9999px';
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				document.execCommand('copy');
				ta.remove();
				return text.length;
			}
		},
			stopCurrentDungeon() {
				const control = getDebugControl();
				control.stopAfterBattle = true;
				if (this.currentDungeon) {
					this.currentDungeon.stop();
					return true;
			}
			return false;
		},
		setDungeonMessage(html) {
			if (this.progress) {
				this.progress.innerHTML = html;
			}
		},
		setBattleDetails(details, title = 'Last battle HP') {
			this.lastBattleHpDetails = Array.isArray(details) ? details : [];
			if (!this.battle) return;
			if (!this.lastBattleHpDetails.length) {
				this.battle.textContent = 'No battle HP details yet';
				return;
			}
			const lines = this.lastBattleHpDetails.map((item) => {
				const before = Math.round(item.beforePct * 100) / 100;
				const after = Math.round(item.afterPct * 100) / 100;
				return `${item.name}: ${before}% -> ${after}%${item.isDead ? ' DEAD' : ''}`;
			});
			this.battle.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">${title}</div><div>${lines.join('<br>')}</div>`;
		},
		setTitanStates(titanGetAll, titansStates, trackedTitanIds = []) {
			if (!this.titanStats) return;
			const tracked = new Set((trackedTitanIds || []).map(String));
			if (!tracked.size) {
				this.titanStats.innerHTML = '<div style="font-weight:700;margin-bottom:4px;">Current titan HP</div><div style="opacity:.75;">No battled titans yet</div>';
				return;
			}
			const columns = ['water', 'fire', 'earth', 'light', 'dark'];
			const sections = columns.map((type) => {
				const titans = Object.keys(titanGetAll || {})
					.filter((id) => getTitanElement(id) === type && tracked.has(String(id)))
					.map((id) => {
						const state = titansStates?.[id] ?? {};
						const maxHp = titanGetAll?.[id]?.hp ?? state.maxHp ?? null;
						const hpPct = state.hp != null && maxHp ? Math.max(0, Math.min(100, Math.round((state.hp / maxHp) * 100))) : null;
						return {
							name: cheats.translate(`LIB_HERO_NAME_${id}`),
							hpPct,
							energy: state.energy ?? 0,
							isDead: !!state.isDead,
						};
					});
				titans.sort((a, b) => {
					const av = a.hpPct == null ? 101 : a.hpPct;
					const bv = b.hpPct == null ? 101 : b.hpPct;
					return av - bv;
				});
				const lines = titans.map((item) => {
					const style = item.isDead || (item.hpPct != null && item.hpPct < 30) ? 'color:#ff7b7b;' : '';
					const hpText = item.hpPct == null ? 'HP ?' : `HP ${item.hpPct}%`;
					return `<div style="${style}">${item.name}: ${hpText} EN:${item.energy}${item.isDead ? ' DEAD' : ''}</div>`;
				});
				return `<div style="margin-bottom:6px;"><b>${type.toUpperCase()}</b><br>${lines.length ? lines.join('') : '—'}</div>`;
			});
			this.titanStats.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">Current titan HP</div>${sections.join('')}`;
		},
		ensure() {
			if (this.panel) return this.panel;
			const root = document.createElement('div');
			root.id = 'hwh-titan-forge-debug-panel';
			root.style.cssText = [
				'position:fixed',
				'z-index:2147483647',
				'right:12px',
				'bottom:12px',
				'width:420px',
				'max-width:calc(100vw - 24px)',
				'background:#1c120ce8',
				'color:#f6d7ab',
				'border:1px solid #c98b4f',
				'border-radius:12px',
				'box-shadow:0 12px 40px rgba(0,0,0,.45)',
				'font:13px/1.35 sans-serif',
				'padding:10px',
			].join(';');

			const input = document.createElement('textarea');
			input.rows = 2;
			input.style.cssText = 'display:none;';
			input.value = getSaveVal(DEBUG_STORAGE_KEY, '').toString();
			input.addEventListener('input', () => {
				setSaveVal(DEBUG_STORAGE_KEY, input.value);
			});
			this.input = input;
			const status = document.createElement('div');
			status.style.cssText = 'margin:0 0 8px;color:#ffd28a;display:flex;align-items:center;justify-content:space-between;gap:8px;';
			const statusText = document.createElement('span');
			statusText.textContent = 'Ready';
			const buttons = document.createElement('div');
			buttons.style.cssText = 'display:flex;align-items:center;gap:4px;flex:0 0 auto;';
			const makeToggleBtn = (label, title) => {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.textContent = label;
				btn.title = title;
				btn.style.cssText = 'border:1px solid #8a5b33;border-radius:999px;background:#2b1c12;color:#ffd28a;width:24px;height:22px;line-height:18px;padding:0;cursor:pointer;font-weight:700;flex:0 0 auto;';
				return btn;
			};
			const collapseHpBtn = makeToggleBtn('H', 'Toggle titan HP block');
			const collapseAllBtn = makeToggleBtn('A', 'Toggle all details');
			buttons.append(collapseHpBtn, collapseAllBtn);
			status.append(statusText, buttons);
			this.status = status;

			const progress = document.createElement('div');
			progress.style.cssText = 'margin:4px 0 8px;color:#f0e0b0;font-size:12px;line-height:1.35;background:#120c08;border:1px solid #57402c;border-radius:8px;padding:8px;white-space:pre-wrap;max-height:152px;overflow:hidden;';
			progress.innerHTML = 'Dungeon status will appear here';
			this.progress = progress;

			const battle = document.createElement('div');
			battle.style.cssText = 'margin:4px 0 8px;color:#d9f2ff;font-size:12px;line-height:1.35;background:#120c08;border:1px solid #57402c;border-radius:8px;padding:8px;white-space:pre-wrap;max-height:140px;overflow:auto;';
			battle.textContent = 'No battle HP details yet';
			this.battle = battle;

			const titanStats = document.createElement('div');
			titanStats.style.cssText = 'margin:4px 0 8px;color:#f3e7c7;font-size:12px;line-height:1.35;background:#120c08;border:1px solid #57402c;border-radius:8px;padding:8px;white-space:pre-wrap;max-height:420px;overflow:auto;';
			titanStats.textContent = 'Current titan HP will appear here';
			this.titanStats = titanStats;

			const topDetails = document.createElement('div');
			topDetails.append(progress, battle);
			const titanStatsWrap = document.createElement('div');
			titanStatsWrap.append(titanStats);
			let titanStatsCollapsed = false;
			let allDetailsCollapsed = false;
			const applyDetailsState = () => {
				topDetails.style.display = allDetailsCollapsed ? 'none' : 'block';
				titanStatsWrap.style.display = allDetailsCollapsed || titanStatsCollapsed ? 'none' : 'block';
				collapseHpBtn.textContent = titanStatsCollapsed ? '+' : 'H';
				collapseAllBtn.textContent = allDetailsCollapsed ? '+' : 'A';
			};
			collapseHpBtn.addEventListener('click', () => {
				titanStatsCollapsed = !titanStatsCollapsed;
				if (titanStatsCollapsed) {
					allDetailsCollapsed = false;
				}
				applyDetailsState();
			});
			collapseAllBtn.addEventListener('click', () => {
				allDetailsCollapsed = !allDetailsCollapsed;
				if (allDetailsCollapsed) {
					titanStatsCollapsed = false;
				}
				applyDetailsState();
			});
			applyDetailsState();

			this.output = null;
			root.append(status, topDetails, titanStatsWrap);
			(document.body || document.documentElement).appendChild(root);
			this.panel = root;
			return root;
		},
	};


	const DEBUG_WORKER_PROBE = true;
	let workerProbeDone = false;

	function runWorkerProbe(battleData, args = {}) {
		if (!DEBUG_WORKER_PROBE || workerProbeDone) return;
		workerProbeDone = true;

		const calcSource = typeof Calc === 'function' ? Calc.toString() : '';
		const battleCalcSource = typeof BattleCalc === 'function' ? BattleCalc.toString() : '';
		const battleTypeSource = typeof getBattleType === 'function' ? getBattleType.toString() : '';
		DebugUI.log('[DBG worker probe start]', {
			attackerType: args.attackerType ?? battleData?.attackerType ?? null,
			teamNum: args.teamNum ?? null,
			hasCalc: !!calcSource,
			hasBattleCalc: !!battleCalcSource,
			hasGetBattleType: !!battleTypeSource,
		});

		if (!calcSource || !battleCalcSource || !battleTypeSource) {
			DebugUI.log('[DBG worker probe result]', {
				ok: false,
				error: 'Required function source is unavailable',
			});
			return;
		}

		const workerCode = \`
			self.onmessage = async ({ data }) => {
				try {
					const getBattleType = eval('(' + data.battleTypeSource + ')');
					const BattleCalc = eval('(' + data.battleCalcSource + ')');
					const Calc = eval('(' + data.calcSource + ')');
					const result = await Calc(data.battleData);
					self.postMessage({
						ok: true,
						resultType: typeof result,
						resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
					});
				} catch (error) {
					self.postMessage({
						ok: false,
						error: {
							name: error?.name || 'Error',
							message: error?.message || String(error),
							stack: error?.stack || '',
						},
					});
				}
			};
		\`;
		const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
		const worker = new Worker(workerUrl);
		let settled = false;
		const finish = (payload) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			worker.terminate();
			URL.revokeObjectURL(workerUrl);
			DebugUI.log('[DBG worker probe result]', payload);
		};
		const timeoutId = setTimeout(() => finish({
			ok: false,
			error: { name: 'TimeoutError', message: 'Worker probe timed out' },
		}), 10000);
		worker.onmessage = (event) => finish(event.data);
		worker.onerror = (event) => finish({
			ok: false,
			error: {
				name: 'WorkerError',
				message: event.message || 'Worker execution failed',
				filename: event.filename || '',
				lineno: event.lineno || 0,
			},
		});
		worker.postMessage({ battleData, calcSource, battleCalcSource, battleTypeSource });
	}

	const originalSetProgress = HWHFuncs.setProgress;
	const originalHideProgress = HWHFuncs.hideProgress;
	HWHFuncs.setProgress = (message, ...rest) => {
		DebugUI.ensure();
		DebugUI.setDungeonMessage(String(message ?? ''));
		return true;
	};
	HWHFuncs.hideProgress = (...rest) => {
		if (DebugUI.progress) {
			DebugUI.progress.innerHTML = '';
		}
		return true;
	};

	function patchScriptMenuStatus() {
		const ScriptMenu = HWHClasses?.ScriptMenu;
		if (!ScriptMenu || ScriptMenu.__hwhTitanForgePatched) {
			return;
		}
		if (!document.getElementById('hwh-titan-forge-hide-scriptmenu-status')) {
			const style = document.createElement('style');
			style.id = 'hwh-titan-forge-hide-scriptmenu-status';
			style.textContent = `
				.scriptMenu_status {
					display: none !important;
				}
			`;
			(document.head || document.documentElement).appendChild(style);
		}
		const patchSetStatus = (target) => {
			if (!target || target.__hwhTitanForgePatched) return;
			const original = target.setStatus;
			const originalAdd = target.addStatus;
			target.setStatus = function (text, onclick) {
				DebugUI.ensure();
				DebugUI.setDungeonMessage(text ? String(text) : '');
				if (this.status) {
					this.status.classList.add('scriptMenu_statusHide');
					this.status.innerHTML = '';
				}
				return original?.call(this, '', onclick);
			};
			target.addStatus = function (text) {
				DebugUI.ensure();
				const next = `${this.status?.innerHTML || ''}${text || ''}`;
				DebugUI.setDungeonMessage(next);
				if (this.status) {
					this.status.classList.add('scriptMenu_statusHide');
					this.status.innerHTML = '';
				}
				return originalAdd?.call(this, '');
			};
			target.__hwhTitanForgePatched = true;
		};
		patchSetStatus(ScriptMenu.prototype);
		const inst = ScriptMenu.getInst?.();
		patchSetStatus(inst);
		if (inst?.status) {
			inst.status.classList.add('scriptMenu_statusHide');
		}
		ScriptMenu.__hwhTitanForgePatched = true;
	}
	patchScriptMenuStatus();

	if (!window.__hwhTitanForgeStatusObserver) {
		const observer = new MutationObserver(() => {
			const statusEl = document.querySelector('.scriptMenu_status');
			if (statusEl) {
				statusEl.style.display = 'none';
				statusEl.innerHTML = '';
			}
		});
		observer.observe(document.documentElement, { childList: true, subtree: true });
		window.__hwhTitanForgeStatusObserver = observer;
	}

	function parseTitanIds(raw) {
		return raw
			.split(/[\s,;]+/g)
			.map((part) => +part)
			.filter((id) => Number.isFinite(id) && id > 0);
	}

	function getBattlePackIds(pack) {
		return Object.values(pack).map((e) => e.id);
	}

	function safeParseJson(raw, fallback) {
		if (raw == null || raw === '') return fallback;
		if (typeof raw !== 'string') return raw;
		try {
			return JSON.parse(raw);
		} catch (_error) {
			return fallback;
		}
	}

	function getTodayKey() {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function loadDebugTitanState() {
		const saved = safeParseJson(getSaveVal(DEBUG_TITAN_STATE_KEY, ''), null);
		if (!saved || typeof saved !== 'object') return null;
		if (saved.day && saved.day !== getTodayKey()) return null;
		return saved;
	}

	function saveDebugTitanState(state) {
		setSaveVal(DEBUG_TITAN_STATE_KEY, JSON.stringify({
			day: getTodayKey(),
			titansStates: state?.titansStates || {},
			battledTitanIds: Array.isArray(state?.battledTitanIds) ? state.battledTitanIds : [],
		}));
	}

	function normalizeDebugLogMode(mode) {
		return ['minimal', 'human', 'technical'].includes(mode) ? mode : 'technical';
	}

	function getDebugLogLevel(message) {
		const text = typeof message === 'string' ? message : '';
		if (
			text.startsWith('[DBG run rejected]') ||
			text.startsWith('[DBG run error]') ||
			text.startsWith('[DBG stop requested]') ||
			text.startsWith('[DBG stop mode set]') ||
			text.startsWith('[DBG stop applied]') ||
			text.startsWith('Stop requested') ||
			text.startsWith('Stop mode enabled') ||
			text.startsWith('Stop applied') ||
			text === 'No active run' ||
			text.startsWith('[DBG fallback best battle]')
		) {
			return 'critical';
		}
		if (
			text.startsWith('[DBG retryBattle]') ||
			text.startsWith('[DBG endBattle]') ||
			text.startsWith('[DBG sim done]') ||
			text.startsWith('[DBG priority accepted]') ||
			text.startsWith('[DBG priority order]') ||
			text.startsWith('[DBG battle type resolved]') ||
			text.startsWith('[DBG countdown message]') ||
			text.startsWith('[DBG run requested]') ||
			text.startsWith('[DBG run finished]') ||
			text.startsWith('[DBG repeat pass start]')
		) {
			return 'human';
		}
		return 'technical';
	}

	function shouldDisplayDebugLog(level, mode) {
		const logMode = normalizeDebugLogMode(mode);
		if (logMode === 'technical') {
			return true;
		}
		if (logMode === 'human') {
			return level === 'human' || level === 'critical';
		}
		return level === 'critical';
	}

	function formatDebugLogText(line, data, mode) {
		if (normalizeDebugLogMode(mode) === 'technical') {
			return data ? `${line} ${typeof data === 'string' ? data : JSON.stringify(data)}` : line;
		}
		if (line.startsWith('[DBG run requested]') && data && typeof data === 'object') {
			const counts = data.battleCounts || {};
			return `Run requested: ${data.logMode || 'technical'}; battles water ${counts.water || 0}, fire ${counts.fire || 0}, earth ${counts.earth || 0}; mixed ${data.mixedCount || 0}`;
		}
		if (line.startsWith('[DBG priority order]') && Array.isArray(data)) {
			const order = data.map((item) => item.type || item.attackerType || 'unknown').join(', ');
			const selected = data[0]?.type || data[0]?.attackerType || 'unknown';
			return `Battle order: ${order}; selected: ${selected}`;
		}
		if (line.startsWith('[DBG priority accepted]') && data && typeof data === 'object') {
			return `Selected battle: ${data.type || data.attackerType || 'unknown'} team ${data.teamNum ?? '?'}`;
		}
		if (line.startsWith('[DBG repeat pass start]')) {
			return 'Repeat pass started';
		}
		if (line.startsWith('[DBG battle type resolved]') && data && typeof data === 'object') {
			return `Battle selected: ${data.resolvedBattleType || 'unknown'}`;
		}
		if (line.startsWith('[DBG countdown message]') && data && typeof data === 'object') {
			return `Battle in progress: ${data.resolvedBattleType || 'unknown'}`;
		}
		if (line.startsWith('[DBG popup opened]')) {
			return 'Popup opened';
		}
		if (line.startsWith('[DBG run finished]')) {
			return 'Run finished';
		}
		if (line.startsWith('[DBG reset]')) {
			return 'Reset to defaults';
		}
		if (line.startsWith('[DBG copied log]') && data && typeof data === 'object') {
			return `Log copied (${data.chars || 0} chars)`;
		}
		if (line.startsWith('[DBG run rejected]') && typeof data === 'string') {
			return `Run rejected: ${data}`;
		}
		if (line.startsWith('[DBG run error]') && typeof data === 'string') {
			return `Run error: ${data}`;
		}
		return line;
	}

	function getTitanElement(id) {
		return lib.data.titan[+id]?.element || null;
	}

	function truncateTo2Decimals(value) {
		return Math.trunc(value * 100) / 100;
	}

	function buildDefaultDebugConfig(titanAll) {
		const config = {
			minTitanHpPct: DEBUG_MIN_TITAN_HP_DEFAULT,
			logMode: 'technical',
			searchAttempts: DEBUG_MAX_SIMULATIONS,
			repeatAttempts: DEBUG_REPEAT_ATTEMPTS,
			repeatThresholdTolerancePct: DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT,
			thresholds: {
				water: 0,
				fire: 0,
				earth: 0,
				mixed: 0,
			},
			mixedHealHpPct: 0,
			priorities: {
				water: 1,
				mixed: 2,
				earth: 3,
				fire: 99,
			},
			stopBeforeBattle: {
				water: false,
				fire: false,
				earth: false,
				mixed: false,
			},
			titans: {},
		};

		for (const titan of Object.values(titanAll)) {
			const element = getTitanElement(titan.id);
			if (!['water', 'fire', 'earth', 'light', 'dark'].includes(element)) continue;
			config.titans[titan.id] = {
				battle: false,
				mixed: false,
				swap: false,
			};
		}

		return config;
	}

	function loadDebugConfig(titanAll) {
		const saved = safeParseJson(getSaveVal(DEBUG_STORAGE_KEY, ''), null);
		const config = buildDefaultDebugConfig(titanAll);
		if (!saved || typeof saved !== 'object') {
			return config;
		}

	config.minTitanHpPct = Number.isFinite(+saved.minTitanHpPct) ? +saved.minTitanHpPct : config.minTitanHpPct;
	config.logMode = normalizeDebugLogMode(saved.logMode || config.logMode);
	if (Number.isFinite(+saved.searchAttempts)) {
		config.searchAttempts = Math.max(1, Math.round(+saved.searchAttempts));
	}
	if (Number.isFinite(+saved.repeatAttempts)) {
		config.repeatAttempts = Math.max(1, Math.round(+saved.repeatAttempts));
	}
	if (Number.isFinite(+saved.repeatThresholdTolerancePct)) {
		config.repeatThresholdTolerancePct = Math.max(0, Math.round(+saved.repeatThresholdTolerancePct));
	}
	if (Number.isFinite(+saved.mixedHealHpPct)) {
		config.mixedHealHpPct = Math.max(0, Math.min(100, Math.round(+saved.mixedHealHpPct)));
	}
	for (const key of Object.keys(config.thresholds)) {
		if (Number.isFinite(+saved.thresholds?.[key])) {
			config.thresholds[key] = Math.round(+saved.thresholds[key]);
		}
		}
		for (const key of Object.keys(config.priorities)) {
			if (Number.isFinite(+saved.priorities?.[key])) {
				config.priorities[key] = Math.max(1, Math.round(+saved.priorities[key]));
			}
		}
		for (const key of Object.keys(config.stopBeforeBattle)) {
			config.stopBeforeBattle[key] = !!saved.stopBeforeBattle?.[key];
		}
		if (saved.stopBeforeMixedBattle) {
			config.stopBeforeBattle.mixed = true;
		}

		for (const [id, value] of Object.entries(saved.titans || {})) {
			if (!config.titans[id]) continue;
			config.titans[id].battle = !!value?.battle;
			config.titans[id].mixed = !!value?.mixed;
			config.titans[id].swap = !!value?.swap;
		}

		return config;
	}

	function saveDebugConfig(config) {
		setSaveVal(DEBUG_STORAGE_KEY, JSON.stringify(config));
	}

	function normalizeDebugBattleType(attackerType) {
		return attackerType === 'neutral' ? 'mixed' : attackerType;
	}

	function getDebugTeamIds(config, attackerType) {
		const battleType = normalizeDebugBattleType(attackerType);
		const titans = config?.titans || {};
		return Object.entries(titans)
			.filter(([id, row]) => {
				if (!row) return false;
				if (battleType === 'mixed') {
					return !!row.mixed;
				}
				return getTitanElement(id) === battleType && !!row.battle;
			})
			.map(([id]) => +id);
	}

	function getDebugTitanHpPct(id, titanGetAll, titanStates) {
		const state = titanStates?.[id];
		if (!state) return null;
		if (state.isDead) return null;
		const maxHp = titanGetAll?.[id]?.hp ?? state.maxHp ?? null;
		if (!maxHp || state.hp == null) return null;
		return Math.max(0, Math.min(100, (state.hp / maxHp) * 100));
	}

	function getDebugHealState(config, titanGetAll, titanStates) {
		const titans = config?.titans || {};
		const healThreshold = Number.isFinite(+config?.mixedHealHpPct) ? +config.mixedHealHpPct : 0;
		if (healThreshold <= 0) {
			return {
				healThreshold,
				regularHealCandidate: null,
				mixedHealCandidate: null,
				needsHealing: false,
			};
		}

		const titanIds = [...new Set([
			...Object.keys(titans),
			...Object.keys(titanStates || {}),
			...Object.keys(titanGetAll || {}),
		])];

		const candidates = titanIds
			.map((id) => {
				const row = titans[id] || {};
				const state = titanStates?.[id] || {};
				return {
					id: +id,
					element: getTitanElement(id) || titanGetAll?.[id]?.element || state.element || '',
					mixed: !!row.mixed || !!state.mixed,
					hpPct: getDebugTitanHpPct(id, titanGetAll, titanStates),
				};
			})
			.filter((item) => item.hpPct != null);

		const regularCandidates = candidates
			.filter((item) => !item.mixed && ['water', 'fire', 'earth'].includes(item.element))
			.map((item) => ({
				id: item.id,
				hpPct: item.hpPct,
			}))
			.sort((a, b) => a.hpPct - b.hpPct || a.id - b.id);

		const mixedCandidates = candidates
			.filter((item) => item.mixed)
			.map((item) => ({
				id: item.id,
				hpPct: item.hpPct,
			}))
			.sort((a, b) => a.hpPct - b.hpPct || a.id - b.id);

		const regularHealCandidate = regularCandidates.find((item) => item.hpPct < healThreshold) ?? null;
		const mixedHealCandidate = mixedCandidates.find((item) => item.hpPct < healThreshold) ?? null;
		const lowestHealCandidate = [...regularCandidates, ...mixedCandidates]
			.filter((item) => item.hpPct < healThreshold)
			.sort((a, b) => a.hpPct - b.hpPct || a.id - b.id)[0] ?? null;

		return {
			healThreshold,
			regularHealCandidate,
			mixedHealCandidate,
			lowestHealCandidate,
			needsHealing: !!lowestHealCandidate,
		};
	}

	function getDebugHealTriggerText(config, titanGetAll, titanStates) {
		const healState = getDebugHealState(config, titanGetAll, titanStates);
		const candidate = healState.lowestHealCandidate;
		if (!candidate) {
			return 'Heal trigger: none';
		}
		const titanName = cheats.translate(`LIB_HERO_NAME_${candidate.id}`);
		const element = (getTitanElement(candidate.id) || 'unknown').toUpperCase();
		return `Heal trigger: ${element} ${titanName} ${candidate.hpPct.toFixed(2)}%`;
	}

	function getDebugMixedBattleTeamIds(config, titanGetAll, titanStates) {
		const titans = config?.titans || {};
		const mixedIds = Object.entries(titans)
			.filter(([_id, row]) => !!row?.mixed)
			.map(([id]) => +id);
		if (!mixedIds.length) {
			return [];
		}

		const healState = getDebugHealState(config, titanGetAll, titanStates);
		const healThreshold = healState.healThreshold;
		const mixedSwapIds = mixedIds.filter((id) => !!titans[id]?.swap);
		if (!mixedSwapIds.length || healThreshold <= 0) {
			return mixedIds;
		}

		if (healState.lowestHealCandidate && mixedIds.includes(healState.lowestHealCandidate.id)) {
			return mixedIds;
		}

		const healCandidate = healState.lowestHealCandidate;
		if (!healCandidate) {
			return mixedIds;
		}

		const mixedSwapCandidates = mixedSwapIds
			.map((id) => ({
				id,
				hpPct: getDebugTitanHpPct(id, titanGetAll, titanStates),
			}))
			.sort((a, b) => (a.hpPct ?? 101) - (b.hpPct ?? 101) || a.id - b.id);
		const swapTarget = mixedSwapCandidates[0]?.id ?? mixedSwapIds[0];
		return mixedIds.filter((id) => id !== swapTarget).concat(healCandidate.id);
	}

	function getDebugBattleThreshold(config, attackerType, titanGetAll, titanStates) {
		const battleType = normalizeDebugBattleType(attackerType);
		if (battleType !== 'mixed') {
			return Math.round(+config?.thresholds?.[battleType] || 0);
		}
		const mixedIds = getDebugTeamIds(config, 'mixed');
		const lowestHpPct = mixedIds.reduce((lowest, id) => {
			const hpPct = getDebugTitanHpPct(id, titanGetAll, titanStates);
			return hpPct == null ? lowest : Math.min(lowest, hpPct);
		}, Infinity);
		if (!Number.isFinite(lowestHpPct)) {
			return Math.round(+config?.thresholds?.[battleType] || 0);
		}
		const deficit = 100 - lowestHpPct;
		if (deficit < 10) return -10;
		if (deficit < 20) return 0;
		return 10;
	}

	function getDebugBattlePriority(config, attackerType, titanGetAll, titanStates) {
		const battleType = normalizeDebugBattleType(attackerType);
		const priority = Number.isFinite(+config?.priorities?.[battleType]) ? +config.priorities[battleType] : 99;
		const healState = getDebugHealState(config, titanGetAll, titanStates);
		if (healState.needsHealing) {
			return battleType === 'mixed' ? 1 : priority + 1;
		}
		return battleType === 'mixed' ? 3 : priority;
	}

	function getDebugBattleSummary(config) {
		const countByType = (type, key) =>
			Object.entries(config?.titans || {}).filter(([id, row]) => getTitanElement(id) === type && !!row?.[key]).length;
			return {
				minTitanHpPct: config?.minTitanHpPct ?? DEBUG_MIN_TITAN_HP_DEFAULT,
				thresholds: config?.thresholds || {},
				priorities: config?.priorities || {},
				stopBeforeBattle: config?.stopBeforeBattle || {},
				battleCounts: {
					water: countByType('water', 'battle'),
					fire: countByType('fire', 'battle'),
				earth: countByType('earth', 'battle'),
			},
			mixedCount: Object.values(config?.titans || {}).filter((row) => !!row?.mixed).length,
		};
	}

	function formatSimResult(tag, calcResult, rec, pack, hpDetails = null, reason = null) {
		const total = pack.length || Object.keys(calcResult.progress?.[0]?.attackers?.heroes ?? {}).length || 0;
		const survivors = Object.keys(calcResult.progress?.[0]?.attackers?.heroes ?? {}).length;
		const survivorPct = total ? Math.round((survivors / total) * 100) : 0;
		const result = {
			tag,
			win: calcResult.result?.win,
			survivors,
			total,
			survivorPct,
			losses: rec.losses,
			hp: rec.hp,
			energy: rec.energy,
		};
		if (reason) {
			result.reason = reason;
		}
		if (hpDetails) {
			result.hpDetails = hpDetails;
		}
		return result;
	}

	function formatBattleResultText(prefix, calcResult, rec, hpDetails = null, reason = null, attempt = null, passName = null) {
		const status = calcResult?.result?.win ? 'виграш' : 'поразка';
		const hpText = Number.isFinite(rec?.hp) ? `${(rec.hp * 100).toFixed(2)}%` : '—';
		const parts = [
			`${prefix}${passName ? ` (${passName})` : ''}${attempt != null ? ` Спроба ${attempt}` : ''}: Статус: ${status}. ХП: ${hpText}.`,
		];
		if (reason) {
			parts[0] += ` Причина: ${reason}.`;
		}
		for (const item of hpDetails || []) {
			parts.push(`${item.name} ${item.beforePct.toFixed(2)} => ${item.afterPct.toFixed(2)}${item.isDead ? ' DEAD' : ''}`);
		}
		return parts.join('\n');
	}

	function formatBattleResultTextEn(prefix, calcResult, rec, hpDetails = null, reason = null, attempt = null, passName = null) {
		const status = calcResult?.result?.win ? 'win' : 'loss';
		const hpText = Number.isFinite(rec?.hp) ? `${(rec.hp * 100).toFixed(2)}%` : '-';
		const parts = [
			`${prefix}${passName ? ` (${passName})` : ''}${attempt != null ? ` try ${attempt}` : ''}: Status: ${status}. HP: ${hpText}.`,
		];
		if (reason) {
			parts[0] += ` Reason: ${reason}.`;
		}
		for (const item of hpDetails || []) {
			parts.push(`${item.name} ${item.beforePct.toFixed(2)} => ${item.afterPct.toFixed(2)}${item.isDead ? ' DEAD' : ''}`);
		}
		return parts.join('\n');
	}

	function getTitanHpDetails(calcResult) {
		const beforeTitans = calcResult.battleData?.attackers ?? {};
		const afterTitans = calcResult.progress?.[0]?.attackers?.heroes ?? {};
		return Object.keys(beforeTitans).map((titanId) => {
			const before = beforeTitans[titanId];
			const after = afterTitans[titanId];
			const beforeStateHp = before?.state?.hp ?? before?.hp ?? 0;
			const beforeMaxHp = before?.hp ?? 1;
			const afterHp = after?.hp ?? 0;
			return {
				id: +titanId,
				name: cheats.translate('LIB_HERO_NAME_' + titanId),
				beforePct: beforeMaxHp ? +(beforeStateHp / beforeMaxHp * 100).toFixed(2) : 0,
				afterPct: beforeMaxHp ? +(afterHp / beforeMaxHp * 100).toFixed(2) : 0,
				isDead: !!after?.isDead,
			};
		});
	}

	async function openDungeonForgeDebugPopup() {
		const titanAll = await Caller.send('titanGetAll');
		const config = loadDebugConfig(titanAll);
		const titans = Object.values(titanAll)
			.filter((titan) => ['water', 'fire', 'earth', 'light', 'dark'].includes(getTitanElement(titan.id)))
			.map((titan) => {
				const id = +titan.id;
				const label = cheats.translate('LIB_HERO_NAME_' + id);
				return {
					id,
					label,
					element: getTitanElement(id),
					hpPct: null,
					checkedBattle: !!config.titans[id]?.battle,
					checkedMixed: !!config.titans[id]?.mixed,
				};
			});

		const summaryForType = (type, values) => {
			return `${type}: ${values.filter((v) => v.element === type && v.checkedBattle).length}/${values.filter((v) => v.element === type).length}`;
		};

			popup.customPopup((complete) => {
				popup.custom.innerHTML = `
					<div style="display:flex;flex-direction:column;gap:10px;color:#fce1ac;font:600 13px/1.35 sans-serif;max-width:720px;">
					<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;align-items:end;">
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Min titan HP %</span>
							<input id="dbg-min-hp" type="number" min="0" max="100" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.minTitanHpPct}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Water threshold</span>
							<input id="dbg-threshold-water" type="number" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.thresholds.water}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Fire threshold</span>
							<input id="dbg-threshold-fire" type="number" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.thresholds.fire}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Earth threshold</span>
							<input id="dbg-threshold-earth" type="number" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.thresholds.earth}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Mixed threshold</span>
							<input id="dbg-threshold-mixed" type="number" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.thresholds.mixed}">
						</label>
					</div>
					<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:end;margin-top:8px;">
						<label style="display:flex;flex-direction:column;gap:4px;grid-column:1 / span 2;">
							<span>Mixed heal HP %</span>
							<input id="dbg-mixed-heal-hp" type="number" min="0" max="100" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.mixedHealHpPct ?? 0}">
						</label>
						<div style="grid-column:3 / span 3;opacity:.8;padding:7px 8px 0 8px;align-self:center;">Used only for mixed battles: if a non-mixed titan falls below this HP %, one mixed swap slot can be replaced.</div>
					</div>
					<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;align-items:end;margin-top:8px;">
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Water priority</span>
							<input id="dbg-priority-water" type="number" min="1" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.priorities.water}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Earth priority</span>
							<input id="dbg-priority-earth" type="number" min="1" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.priorities.earth}">
						</label>
					</div>
					<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px;padding:8px 10px;background:#120c08;border:1px solid #5b4028;border-radius:8px;">
						<span style="font-weight:700;">Log mode</span>
						<label style="display:flex;align-items:center;gap:6px;">
							<input type="radio" name="dbg-log-mode" value="minimal" ${normalizeDebugLogMode(config.logMode) === 'minimal' ? 'checked' : ''}>
							<span>minimal</span>
						</label>
						<label style="display:flex;align-items:center;gap:6px;">
							<input type="radio" name="dbg-log-mode" value="human" ${normalizeDebugLogMode(config.logMode) === 'human' ? 'checked' : ''}>
							<span>human</span>
						</label>
						<label style="display:flex;align-items:center;gap:6px;">
							<input type="radio" name="dbg-log-mode" value="technical" ${normalizeDebugLogMode(config.logMode) === 'technical' ? 'checked' : ''}>
							<span>technical</span>
						</label>
					</div>
					<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px;padding:8px 10px;background:#120c08;border:1px solid #5b4028;border-radius:8px;">
						<span style="font-weight:700;">Stop before battle</span>
						<label style="display:flex;align-items:center;gap:6px;">
							<input id="dbg-stop-before-water" type="checkbox" ${config.stopBeforeBattle.water ? 'checked' : ''}>
							<span>water</span>
						</label>
						<label style="display:flex;align-items:center;gap:6px;">
							<input id="dbg-stop-before-fire" type="checkbox" ${config.stopBeforeBattle.fire ? 'checked' : ''}>
							<span>fire</span>
						</label>
						<label style="display:flex;align-items:center;gap:6px;">
							<input id="dbg-stop-before-earth" type="checkbox" ${config.stopBeforeBattle.earth ? 'checked' : ''}>
							<span>earth</span>
						</label>
						<label style="display:flex;align-items:center;gap:6px;">
							<input id="dbg-stop-before-mixed" type="checkbox" ${config.stopBeforeBattle.mixed ? 'checked' : ''}>
							<span>mixed</span>
						</label>
					</div>
					<div style="display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:8px;align-items:end;margin-top:8px;">
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Search attempts</span>
							<input id="dbg-search-attempts" type="number" min="1" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.searchAttempts ?? DEBUG_MAX_SIMULATIONS}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Repeat attempts</span>
							<input id="dbg-repeat-attempts" type="number" min="1" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.repeatAttempts ?? DEBUG_REPEAT_ATTEMPTS}">
						</label>
						<label style="display:flex;flex-direction:column;gap:4px;">
							<span>Repeat tolerance %</span>
							<input id="dbg-repeat-tolerance" type="number" min="0" step="1" style="width:100%;box-sizing:border-box;background:#2b1c12;color:#fff;border:1px solid #8a5b33;border-radius:8px;padding:7px 8px;" value="${config.repeatThresholdTolerancePct ?? DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT}">
						</label>
					</div>
					<div id="dbg-team-wrap" style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto;padding-right:4px;"></div>
					<div style="display:flex;flex-wrap:wrap;gap:8px;">
						<button id="dbg-run" style="border:0;border-radius:8px;padding:8px 12px;background:#2f8f5b;color:#fff;cursor:pointer;font-weight:700;">Run test</button>
						<button id="dbg-stop" style="border:0;border-radius:8px;padding:8px 12px;background:#9d3131;color:#fff;cursor:pointer;font-weight:700;">Stop after battle</button>
						<button id="dbg-copy" style="border:0;border-radius:8px;padding:8px 12px;background:#6b5bd8;color:#fff;cursor:pointer;font-weight:700;">Copy log</button>
						<button id="dbg-reset" style="border:0;border-radius:8px;padding:8px 12px;background:#8a5b33;color:#fff;cursor:pointer;font-weight:700;">Reset</button>
						<button id="dbg-clear" style="border:0;border-radius:8px;padding:8px 12px;background:#666;color:#fff;cursor:pointer;font-weight:700;">Clear log</button>
					</div>
					<div id="dbg-status" style="color:#ffd28a;">Ready</div>
					<div style="color:#ffda8a;font-size:12px;opacity:.95;">Mixed team must contain no more than 5 titans. Every selected titan must stay at or above the min HP % and none may die.</div>
					<pre id="dbg-log" style="margin:0;height:260px;overflow:auto;white-space:pre-wrap;background:#120c08;border:1px solid #57402c;border-radius:8px;padding:8px;color:#d9f2ff;font-family:Consolas,monospace;"></pre>
				</div>
			`;

			const wrap = popup.custom.querySelector('#dbg-team-wrap');
			const logEl = popup.custom.querySelector('#dbg-log');
			const statusEl = popup.custom.querySelector('#dbg-status');
			const runBtn = popup.custom.querySelector('#dbg-run');
			const stopBtn = popup.custom.querySelector('#dbg-stop');
			const copyBtn = popup.custom.querySelector('#dbg-copy');
			const resetBtn = popup.custom.querySelector('#dbg-reset');
			const clearBtn = popup.custom.querySelector('#dbg-clear');
			const minHpInput = popup.custom.querySelector('#dbg-min-hp');
			const thresholdInputs = {
				water: popup.custom.querySelector('#dbg-threshold-water'),
				fire: popup.custom.querySelector('#dbg-threshold-fire'),
				earth: popup.custom.querySelector('#dbg-threshold-earth'),
				mixed: popup.custom.querySelector('#dbg-threshold-mixed'),
			};
			const mixedHealHpInput = popup.custom.querySelector('#dbg-mixed-heal-hp');
			const searchAttemptsInput = popup.custom.querySelector('#dbg-search-attempts');
			const repeatAttemptsInput = popup.custom.querySelector('#dbg-repeat-attempts');
			const repeatToleranceInput = popup.custom.querySelector('#dbg-repeat-tolerance');
			const priorityInputs = {
				water: popup.custom.querySelector('#dbg-priority-water'),
				earth: popup.custom.querySelector('#dbg-priority-earth'),
			};
			const logModeInputs = {
				minimal: popup.custom.querySelector('input[name="dbg-log-mode"][value="minimal"]'),
				human: popup.custom.querySelector('input[name="dbg-log-mode"][value="human"]'),
				technical: popup.custom.querySelector('input[name="dbg-log-mode"][value="technical"]'),
			};
			const stopBeforeInputs = {
				water: popup.custom.querySelector('#dbg-stop-before-water'),
				fire: popup.custom.querySelector('#dbg-stop-before-fire'),
				earth: popup.custom.querySelector('#dbg-stop-before-earth'),
				mixed: popup.custom.querySelector('#dbg-stop-before-mixed'),
			};

			DebugUI.output = logEl;
			DebugUI.status = statusEl;

			const rowsById = new Map();
			const renderSection = (type, items) => {
				const section = document.createElement('div');
				section.style.cssText = 'background:#1b120c;border:1px solid #5b4028;border-radius:10px;padding:8px;';
				const header = document.createElement('div');
				header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;font-weight:700;';
				const usesMixed = true;
				const checkedBattle = items.filter((item) => item.checkedBattle).length;
				const checkedMixed = usesMixed ? items.filter((item) => item.checkedMixed).length : 0;
				header.innerHTML = usesMixed
					? `<span>${type.toUpperCase()}</span><span style="opacity:.85;">battle ${checkedBattle}/${items.length} | mixed ${checkedMixed}/${items.length}</span>`
					: `<span>${type.toUpperCase()}</span><span style="opacity:.85;">battle ${checkedBattle}/${items.length}</span>`;
				section.append(header);

				const rows = document.createElement('div');
				rows.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
				for (const titan of items) {
					const row = document.createElement('label');
					row.style.cssText = usesMixed
						? 'display:grid;grid-template-columns:minmax(0,1fr) 92px 92px 84px;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;background:#120c08;'
						: 'display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;background:#120c08;';
					const name = document.createElement('span');
					name.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';
					const nameText = document.createElement('span');
					nameText.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const hpText = titan.hpPct == null ? '' : `HP ${titan.hpPct}%`;
					nameText.textContent = hpText ? `${titan.label} • ${hpText}` : titan.label;
					name.append(nameText);
					const battleCell = document.createElement('label');
					battleCell.style.cssText = 'display:flex;align-items:center;gap:6px;justify-content:flex-start;white-space:nowrap;';
					const battleCb = document.createElement('input');
					battleCb.type = 'checkbox';
					battleCb.dataset.role = 'battle';
					battleCb.dataset.id = titan.id;
					battleCb.checked = titan.checkedBattle;
					const battleTxt = document.createElement('span');
					battleTxt.textContent = 'battle';
					battleCell.append(battleCb, battleTxt);
					if (usesMixed) {
						const mixedCell = document.createElement('label');
						mixedCell.style.cssText = 'display:flex;align-items:center;gap:6px;justify-content:flex-start;white-space:nowrap;';
						const mixedCb = document.createElement('input');
						mixedCb.type = 'checkbox';
						mixedCb.dataset.role = 'mixed';
						mixedCb.dataset.id = titan.id;
						mixedCb.checked = titan.checkedMixed;
						const mixedTxt = document.createElement('span');
						mixedTxt.textContent = 'mixed';
						mixedCell.append(mixedCb, mixedTxt);
						const swapCell = document.createElement('label');
						swapCell.style.cssText = 'display:flex;align-items:center;gap:6px;justify-content:flex-start;white-space:nowrap;';
						const swapCb = document.createElement('input');
						swapCb.type = 'checkbox';
						swapCb.dataset.role = 'swap';
						swapCb.dataset.id = titan.id;
						swapCb.checked = !!titan.swap;
						swapCb.disabled = !mixedCb.checked;
						const updateSwapState = () => {
							swapCb.disabled = !mixedCb.checked;
							if (!mixedCb.checked) {
								swapCb.checked = false;
							}
						};
						mixedCb.addEventListener('change', updateSwapState);
						updateSwapState();
						const swapTxt = document.createElement('span');
						swapTxt.textContent = 'swap';
						swapCell.append(swapCb, swapTxt);
						row.append(name, battleCell, mixedCell, swapCell);
						rowsById.set(String(titan.id), { battleCb, mixedCb, swapCb, element: titan.element, label: titan.label, usesMixed });
					} else {
						row.append(name, battleCell);
						rowsById.set(String(titan.id), { battleCb, mixedCb: null, swapCb: null, element: titan.element, label: titan.label, usesMixed });
					}
					rows.append(row);
				}
				section.append(rows);
				wrap.append(section);
			};

			for (const type of ['water', 'fire', 'earth', 'light', 'dark']) {
				renderSection(
					type,
					titans.filter((titan) => titan.element === type)
				);
			}

			const readConfigFromUI = () => {
				const nextConfig = {
					minTitanHpPct: Math.max(0, Math.min(100, +minHpInput.value || 0)),
					thresholds: {
						water: Math.round(+thresholdInputs.water.value || 0),
						fire: Math.round(+thresholdInputs.fire.value || 0),
						earth: Math.round(+thresholdInputs.earth.value || 0),
						mixed: Math.round(+thresholdInputs.mixed.value || 0),
					},
					mixedHealHpPct: Math.max(0, Math.min(100, Math.round(+mixedHealHpInput.value || 0))),
					searchAttempts: Math.max(1, Math.round(+searchAttemptsInput.value || DEBUG_MAX_SIMULATIONS)),
					repeatAttempts: Math.max(1, Math.round(+repeatAttemptsInput.value || DEBUG_REPEAT_ATTEMPTS)),
					repeatThresholdTolerancePct: Math.max(0, Math.round(+repeatToleranceInput.value || DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT)),
					priorities: {
						water: Math.max(1, Math.round(+priorityInputs.water.value || 1)),
						earth: Math.max(1, Math.round(+priorityInputs.earth.value || 3)),
						fire: 99,
					},
					stopBeforeBattle: {
						water: !!stopBeforeInputs.water.checked,
						fire: !!stopBeforeInputs.fire.checked,
						earth: !!stopBeforeInputs.earth.checked,
						mixed: !!stopBeforeInputs.mixed.checked,
					},
					logMode: normalizeDebugLogMode(
						Object.entries(logModeInputs).find(([_key, input]) => input?.checked)?.[0]
					),
					titans: {},
				};
				for (const [id, row] of rowsById.entries()) {
					nextConfig.titans[id] = {
						battle: row.battleCb.checked,
						mixed: !!row.mixedCb?.checked,
						swap: !!row.swapCb?.checked,
					};
				}
				return nextConfig;
			};

			const applyConfigToUI = (nextConfig) => {
				minHpInput.value = nextConfig.minTitanHpPct;
				mixedHealHpInput.value = nextConfig.mixedHealHpPct ?? 0;
				searchAttemptsInput.value = nextConfig.searchAttempts ?? DEBUG_MAX_SIMULATIONS;
				repeatAttemptsInput.value = nextConfig.repeatAttempts ?? DEBUG_REPEAT_ATTEMPTS;
				repeatToleranceInput.value = nextConfig.repeatThresholdTolerancePct ?? DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT;
				for (const key of Object.keys(thresholdInputs)) {
					thresholdInputs[key].value = nextConfig.thresholds[key];
				}
				for (const key of Object.keys(priorityInputs)) {
					priorityInputs[key].value = nextConfig.priorities[key];
				}
				for (const [key, input] of Object.entries(logModeInputs)) {
					input.checked = normalizeDebugLogMode(nextConfig.logMode) === key;
				}
				for (const key of Object.keys(stopBeforeInputs)) {
					stopBeforeInputs[key].checked = !!nextConfig.stopBeforeBattle?.[key];
				}
				for (const [id, row] of rowsById.entries()) {
					row.battleCb.checked = !!nextConfig.titans[id]?.battle;
					if (row.mixedCb) {
						row.mixedCb.checked = !!nextConfig.titans[id]?.mixed;
						if (row.swapCb) {
							row.swapCb.checked = !!nextConfig.titans[id]?.swap;
							row.swapCb.disabled = !row.mixedCb.checked;
						}
					}
				}
			};

			const resetConfig = () => {
				const fresh = buildDefaultDebugConfig(titanAll);
				fresh.minTitanHpPct = DEBUG_MIN_TITAN_HP_DEFAULT;
				fresh.mixedHealHpPct = 0;
				fresh.searchAttempts = DEBUG_MAX_SIMULATIONS;
				fresh.repeatAttempts = DEBUG_REPEAT_ATTEMPTS;
				fresh.repeatThresholdTolerancePct = DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT;
				fresh.thresholds = { water: 0, fire: 0, earth: 0, mixed: 0 };
				fresh.priorities = { water: 1, mixed: 2, earth: 3, fire: 99 };
				fresh.logMode = 'technical';
				fresh.stopBeforeBattle = { water: false, fire: false, earth: false, mixed: false };
				for (const key of Object.keys(fresh.titans)) {
					fresh.titans[key].mixed = false;
					fresh.titans[key].swap = false;
				}
				applyConfigToUI(fresh);
				saveDebugConfig(fresh);
				DebugUI.config = fresh;
				DebugUI.logMode = fresh.logMode;
				statusEl.textContent = 'Reset to defaults';
				DebugUI.log('[DBG reset]', fresh);
			};

			const summarize = (nextConfig) => {
				const countByType = (type, key) =>
					Object.entries(nextConfig.titans).filter(([id, value]) => getTitanElement(id) === type && !!value[key]).length;
				return {
					minTitanHpPct: nextConfig.minTitanHpPct,
					mixedHealHpPct: nextConfig.mixedHealHpPct,
					searchAttempts: nextConfig.searchAttempts,
					repeatAttempts: nextConfig.repeatAttempts,
					repeatThresholdTolerancePct: nextConfig.repeatThresholdTolerancePct,
					thresholds: nextConfig.thresholds,
					priorities: nextConfig.priorities,
					logMode: nextConfig.logMode,
					stopBeforeBattle: nextConfig.stopBeforeBattle,
					battleCounts: {
						water: countByType('water', 'battle'),
						fire: countByType('fire', 'battle'),
						earth: countByType('earth', 'battle'),
					},
					mixedCount: Object.values(nextConfig.titans).filter((value) => value.mixed).length,
				};
			};

			const validateConfig = (nextConfig) => {
				const mixedIds = Object.entries(nextConfig.titans)
					.filter(([_id, value]) => value.mixed)
					.map(([id]) => +id);
				if (mixedIds.length > 5) {
					return `Mixed team has ${mixedIds.length} titans, but the limit is 5`;
				}
				return '';
			};

			const updateStatus = (text) => {
				statusEl.textContent = text;
			};

			const syncLogMode = () => {
				const nextConfig = readConfigFromUI();
				saveDebugConfig(nextConfig);
				DebugUI.config = nextConfig;
				DebugUI.logMode = nextConfig.logMode;
			};

			const copyLog = async () => {
				const chars = await DebugUI.copyLog();
				updateStatus(`Log copied (${chars} chars)`);
				DebugUI.log('[DBG copied log]', { chars });
			};

			const startRun = async () => {
				const nextConfig = readConfigFromUI();
				const error = validateConfig(nextConfig);
				if (error) {
					updateStatus(error);
					DebugUI.log('[DBG run rejected]', error);
					return;
				}
				saveDebugConfig(nextConfig);
				DebugUI.config = nextConfig;
				DebugUI.logMode = nextConfig.logMode;
				updateStatus('Running...');
				DebugUI.log('[DBG run requested]', summarize(nextConfig));
				runBtn.disabled = true;
				getDebugControl().stopAfterBattle = false;
				DebugUI.currentDungeon = null;
				try {
					const { executeDungeon } = HWHClasses;
					const dung = new executeDungeon(() => {}, () => {});
					DebugUI.currentDungeon = dung;
					await dung.start(getInput('countTitanit'));
					DebugUI.log('[DBG run finished]');
					updateStatus('Finished');
				} catch (error) {
					DebugUI.log('[DBG run error]', String(error?.stack || error));
					updateStatus('Error, see log');
				} finally {
					if (DebugUI.currentDungeon?.isStop) {
						updateStatus('Stopped');
					}
					if (DebugUI.currentDungeon) {
						DebugUI.currentDungeon = null;
					}
					runBtn.disabled = false;
				}
			};

			applyConfigToUI(config);
			DebugUI.config = config;
			DebugUI.logMode = config.logMode;
			DebugUI.log('[DBG popup opened]', summarize(config));
			for (const input of Object.values(logModeInputs)) {
				input.addEventListener('change', syncLogMode);
			}

			resetBtn.addEventListener('click', resetConfig);

			clearBtn.addEventListener('click', () => {
				logEl.innerHTML = '';
			});

			copyBtn.addEventListener('click', copyLog);

			stopBtn.addEventListener('click', () => {
				const stopped = DebugUI.stopCurrentDungeon();
				updateStatus(stopped ? 'Stop requested after current battle' : 'No active run');
			DebugUI.log(stopped ? 'Stop requested after current battle' : 'No active run');
			});

			runBtn.addEventListener('click', () => startRun());

			popup.addButton({ isClose: true }, () => {
				complete(false);
				popup.hide();
			});
			popup.show();
		});
	}

	class UpdateDungeonFixBattle extends DungeonFixBattle {
		getTimer() {
			if (this.count === 1) {
				this.isGetTimer = false;
				this.maxTimer = 100;
				return 168.8;
			}

			return this.randTimer();
		}

		setState() {
			this.lastState = DungeonUtils.getState(this.lastResult);
		}

		checkResult() {
			this.setState();
			if (DungeonUtils.compareScore(this.lastState, this.bestResult.value)) {
				this.bestResult = {
					count: this.count,
					timer: this.lastTimer,
					value: this.lastState,
					result: this.lastResult.result,
					progress: this.lastResult.progress,
				};
			}
		}
	}

	HWHClasses.DungeonFixBattle = UpdateDungeonFixBattle;

	const { i18nLangData } = HWHData;

	i18nLangData['en'] = Object.assign(i18nLangData['en'], {
		BEST_DUNGEON_FEEDBACK: 'Feedback',
		BEST_DUNGEON_FEEDBACK_TITLE: 'Go to Telegram group for feedback on the HWHBestDungeonExt script',
		BEST_DUNGEON_FEEDBACK_URL: 'https://t.me/+RHdutKsQQcFlODMy',
		BEST_DUNGEON_WINNING_FIGHT_NOT_FOUND: 'No winning fight found\n',
		BEST_DUNGEON_BEST_COMBINATION: 'Best combination:',
		BEST_DUNGEON_SET_USE_TITANS: 'Select titans for the dungeon:',
		BEST_DUNGEON_DUNGEON_SETTINGS_TITLE: 'Dungeon run Settings',
		BEST_DUNGEON_PER_HOUR: 'per hour',
		DUNGEON: 'Dgn',
	});

i18nLangData['ru'] = Object.assign(i18nLangData['ru'], {
    BEST_DUNGEON_FEEDBACK: 'Сообщить об ошибке',
    BEST_DUNGEON_FEEDBACK_TITLE: 'Перейти в Telegram-чат для связи с автором HWHBestDungeonExt',
    BEST_DUNGEON_FEEDBACK_URL: 'https://t.me/+1RpKpBDs9OAyZDdi',
    BEST_DUNGEON_WINNING_FIGHT_NOT_FOUND: 'Не найден подходящий бой.\n',
    BEST_DUNGEON_BEST_COMBINATION: 'Лучшее сочетание:',
    BEST_DUNGEON_SET_USE_TITANS: 'Выбрать титанов для подземелья:',
    BEST_DUNGEON_DUNGEON_SETTINGS_TITLE: 'Настройки подземелья',
    BEST_DUNGEON_PER_HOUR: 'в час',
    DUNGEON: 'Подземелье',
});

	const { buttons } = HWHData;

	buttons['HWHBestDungeonExt'] = {
		get name() { return I18N('BEST_DUNGEON_FEEDBACK'); },
		get title() { return I18N('BEST_DUNGEON_FEEDBACK_TITLE'); },
		color: 'blue',
		onClick: () => {
			window.open(I18N('BEST_DUNGEON_FEEDBACK_URL'), '_blank');
		},
	};

	buttons['HWHTitanForgeDebug'] = {
		name: 'Titan Forge',
		title: 'Open titan forge debug panel',
		color: 'purple',
		onClick: () => openDungeonForgeDebugPopup(),
	};

	const attachTitanForgeButton = () => {
		const button = buttons?.HWHTitanForgeDebug;
		const ScriptMenu = HWHClasses?.ScriptMenu;
		if (!button || button.button || !ScriptMenu) {
			return !!button?.button;
		}
		try {
			const scriptMenu = ScriptMenu.getInst();
			if (!scriptMenu?.addButton) {
				return false;
			}
			button.button = scriptMenu.addButton(button);
			return true;
		} catch (error) {
			DebugUI.log('[DBG button attach error]', String(error?.stack || error));
			return false;
		}
	};

	if (!attachTitanForgeButton()) {
		let attachAttempts = 0;
		const attachTimer = setInterval(() => {
			attachAttempts += 1;
			if (attachTitanForgeButton() || attachAttempts >= 40) {
				clearInterval(attachTimer);
			}
		}, 250);
	}

	if (buttons?.testDungeon && buttons.testDungeon?.combineList) {
		buttons.testDungeon.combineList.splice(1, 0, {
			name: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor" style="width: 25px;height: 25px;"><path d="M487.4 315.7l-42.6-24.6c4.3-23.2 4.3-47 0-70.2l42.6-24.6c4.9-2.8 7.1-8.6 5.5-14-11.1-35.6-30-67.8-54.7-94.6-3.8-4.1-10-5.1-14.8-2.3L380.8 110c-17.9-15.4-38.5-27.3-60.8-35.1V25.8c0-5.6-3.9-10.5-9.4-11.7-36.7-8.2-74.3-7.8-109.2 0-5.5 1.2-9.4 6.1-9.4 11.7V75c-22.2 7.9-42.8 19.8-60.8 35.1L88.7 85.5c-4.9-2.8-11-1.9-14.8 2.3-24.7 26.7-43.6 58.9-54.7 94.6-1.7 5.4.6 11.2 5.5 14L67.3 221c-4.3 23.2-4.3 47 0 70.2l-42.6 24.6c-4.9 2.8-7.1 8.6-5.5 14 11.1 35.6 30 67.8 54.7 94.6 3.8 4.1 10 5.1 14.8 2.3l42.6-24.6c17.9 15.4 38.5 27.3 60.8 35.1v49.2c0 5.6 3.9 10.5 9.4 11.7 36.7 8.2 74.3 7.8 109.2 0 5.5-1.2 9.4-6.1 9.4-11.7v-49.2c22.2-7.9 42.8-19.8 60.8-35.1l42.6 24.6c4.9 2.8 11 1.9 14.8-2.3 24.7-26.7 43.6-58.9 54.7-94.6 1.5-5.5-.7-11.3-5.6-14.1zM256 336c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"></path></svg>',
			onClick: async () => {
				const allowedTitanIds = getSaveVal('allowedTitanIds', []);
				const titanIds = Object.keys(await Caller.send('titanGetAll'));

				const answer = await popup.confirm(
					I18N('BEST_DUNGEON_SET_USE_TITANS'),
					[
						{ result: false, isClose: true },
						{ msg: 'Ok', result: true, color: 'green' },
					],
					titanIds.map((id) => ({
						name: id,
						label: cheats.translate('LIB_HERO_NAME_' + id),
						checked: !allowedTitanIds.length || allowedTitanIds.includes(+id),
					}))
				);

				if (answer) {
					const checkboxes = popup.getCheckBoxes();
					const select = checkboxes.filter((e) => e.checked).map((e) => +e.name);
					setSaveVal('allowedTitanIds', select);
				}
			},
			get title() {
				return I18N('BEST_DUNGEON_DUNGEON_SETTINGS_TITLE');
			},
			color: 'blue',
		});
	}

	class Stat {
		constructor(obj) {
			for (const key in obj) {
				if (obj.hasOwnProperty(key)) {
					this[key] = obj[key];
				}
			}
		}

		multiply(multiplier) {
			for (const key in this) {
				if (this.hasOwnProperty(key)) {
					this[key] *= multiplier;
				}
			}
		}

		add(obj) {
			for (const key in obj) {
				if (obj.hasOwnProperty(key)) {
					if (this.hasOwnProperty(key)) {
						this[key] += obj[key];
					} else {
						this[key] = obj[key];
					}
				}
			}
		}

		round() {
			for (const key in this) {
				if (this.hasOwnProperty(key)) {
					this[key] = Math.round(this[key] * 100) / 100;
				}
			}
		}
	}

	class TitanStats {
		constructor(titans, spirits, states) {
			this.titans = titans;
			this.spirits = spirits;
			this.states = states;
			this.heroLib = lib.data.hero;
			this.titanLib = lib.data.titan;
			this.artsLib = lib.data.titanArtifact;
			this.skinsLib = lib.data.skin;
			this.ruleLib = lib.data.rule;
			this.spiritSkills = lib.data.titanSpirit.skills;
			this.baseStats = new Stat({});
		}

		calculateBaseStats() {
			const titan = this.titans[this.titanId];
			const heroLib = this.heroLib[this.titanId];
			const titanLib = this.titanLib[this.titanId];
			this.baseStats = new Stat(heroLib.baseStats);
			const addStat = new Stat(titanLib.stars[titan.star].battleStatData);
			const coef = Math.pow(titan.level, this.ruleLib.titanLevelPowerCoefficient);
			addStat.multiply(coef);
			this.baseStats.add(addStat);
			this.baseStats.round();
		}

		addSkinStats() {
			const titan = this.titans[this.titanId];
			const skins = Object.entries(titan.skins);
			for (const [id, lvl] of skins) {
				const bonus = this.skinsLib[id].statData.levels[lvl].statBonus;
				this.baseStats.add(bonus);
			}
		}

		addArtifactStats() {
			const titan = this.titans[this.titanId];
			const titanLibArt = this.titanLib[this.titanId].artifacts;
			for (const index in titanLibArt) {
				const artId = titanLibArt[index];
				const { level, star } = titan.artifacts[index];
				if (!star) {
					continue;
				}
				const libArt = this.artsLib.id[artId];
				const battleEffects = libArt.battleEffect;
				const artStat = new Stat({});
				for (const effectId of battleEffects) {
					const effect = this.artsLib.battleEffect[effectId];
					const stat = effect.effect;
					artStat.add({
						[stat]: effect.levels[level],
					});
				}
				const multiplier = this.artsLib.type[libArt.type].evolution[star].battleEffectMultiplier;
				artStat.multiply(multiplier);
				artStat.round();
				this.baseStats.add(artStat);
			}
		}

		addTotemStats() {
			const titanLib = this.titanLib[this.titanId];
			const element = titanLib.element;
			const spirit = this.spirits[element];
			let spiritMultiplier = 0;
			const spiritStat = new Stat({});
			if (spirit.star) {
				const battleEffects = this.artsLib.id[spirit.id].battleEffect;
				for (const effectId of battleEffects) {
					const effect = this.artsLib.battleEffect[effectId];
					const stat = effect.effect;
					spiritStat.add({
						[stat]: effect.levels[spirit.level],
					});
				}

				spiritMultiplier = this.artsLib.type['spirit'].evolution[spirit.star].battleEffectMultiplier;
				spiritStat.multiply(spiritMultiplier);
			}
			const elementSpiritSkills = [];
			const skills = [];
			if (spirit.primalSkill) {
				skills.push(...Object.entries(spirit.primalSkill));
			}
			if (spirit.elementalSkill) {
				skills.push(...Object.entries(spirit.elementalSkill));
			}
			for (const [id, level] of skills) {
				const skillId = +id;
				const tierScale = this.spiritSkills[skillId].levelScale[level - 1];
				elementSpiritSkills.push({ skillId, level, tierScale });
			}
			const addSpirit = {
				element,
				elementSpiritLevel: spirit.level,
				elementSpiritStar: spirit.star,
				elementSpiritSkills,
				elementAffinityPower: spirit.level * spiritMultiplier,
			};
			spiritStat.add(addSpirit);
			this.baseStats.add(spiritStat);
		}

		getTitanStats(titanId) {
			this.titanId = titanId;
			this.calculateBaseStats();
			this.addSkinStats();
			this.addArtifactStats();
			this.addTotemStats();
			const state = this.states[titanId] ?? {
				hp: Math.floor(this.baseStats.hp),
				energy: 0,
				isDead: false,
			};
			return Object.assign(this.titans[this.titanId], this.baseStats, { state });
		}

		getAllowTitanIds(element = false, allowedIds = []) {
			return Object.values(this.titans)
				.map((e) => e.id)
				.filter(
					(id) =>
						!this.states[id]?.isDead &&
						(!element || element == this.titanLib[id]?.element) &&
						(!allowedIds.length || allowedIds.includes(id))
				);
		}
	}

	class GeneticAlgorithm {
		constructor({ values, combinationSize, populationSize, generations, mutationRate, eliteCount }) {
			this.values = values;
			this.combinationSize = combinationSize;
			this.populationSize = populationSize;
			this.generations = generations;
			this.mutationRate = mutationRate;
			this.eliteCount = eliteCount;
			this.evaluationCache = new Map();
			this.evaluationCalls = 0;
			this.bestScores = [];
		}


		generateInitialPopulation() {
			const population = [];
			for (let i = 0; i < this.populationSize; i++) {
				const shuffledValues = [...this.values];
				for (let j = shuffledValues.length - 1; j > 0; j--) {
					const randomIndex = Math.floor(Math.random() * (j + 1));
					[shuffledValues[j], shuffledValues[randomIndex]] = [shuffledValues[randomIndex], shuffledValues[j]];
				}
				const combination = shuffledValues.slice(0, this.combinationSize).sort();
				population.push(combination);
			}
			return population;
		}


		crossover(parent1, parent2) {
			const crossoverPoint = Math.floor(Math.random() * parent1.length);
			const child1 = [...new Set([...parent1.slice(0, crossoverPoint), ...parent2])].slice(0, this.combinationSize);
			const child2 = [...new Set([...parent2.slice(0, crossoverPoint), ...parent1])].slice(0, this.combinationSize);
			return [child1.sort(), child2.sort()];
		}


		mutate(combination) {
			const dynamicRate = this.mutationRate * (1 - this.evaluationCalls / 300);
			const availableValues = this.values.filter((value) => !combination.includes(value));
			for (let i = 0; i < combination.length; i++) {
				if (Math.random() < dynamicRate && availableValues.length > 0) {
					const randomIndex = Math.floor(Math.random() * availableValues.length);
					combination[i] = availableValues[randomIndex];
					availableValues.splice(randomIndex, 1);
				}
			}
			return combination.sort();
		}


		async evaluateCombination(combination) {
			const key = combination.join(',');
			if (!this.evaluationCache.has(key)) {
				const value = await this.getEvaluate(combination);
				this.evaluationCache.set(key, value);
				this.evaluationCalls++;
			}
			return this.evaluationCache.get(key);
		}

		async getEvaluate(combination) {
			return combination.reduce((sum, value) => sum + value, 0);
		}

		customSort(a, b) {
			return b.v - a.v;
		}

		compareScore(bestScore, targetScore) {
			return bestScore >= targetScore;
		}

		setEvaluate(evaFunction) {
			this.getEvaluate = evaFunction;
		}

		setCustomSort(customSort) {
			this.customSort = customSort;
		}

		setCompereScore(compareScore) {
			this.compareScore = compareScore;
		}

		async sortPopulation(population) {
			const evaluatedValues = await Promise.all(
				population.map(async (item) => ({
					item,
					v: await this.evaluateCombination(item),
				}))
			);

			evaluatedValues.sort(this.customSort);

			return evaluatedValues.map(({ item }) => item);
		}

		async selectParent(population, tournamentSize = 3) {
			let best = population[Math.floor(Math.random() * population.length)];
			for (let i = 1; i < tournamentSize; i++) {
				const candidate = population[Math.floor(Math.random() * population.length)];
				if ((await this.evaluateCombination(candidate)) > (await this.evaluateCombination(best))) {
					best = candidate;
				}
			}
			return best;
		}


		async run() {
			let population = this.generateInitialPopulation();
			this.bestScores = [];

			for (let generation = 0; generation < this.generations; generation++) {
				population = await this.sortPopulation(population);

				const bestScore = await this.evaluateCombination(population[0]);
				this.bestScores.push(bestScore);

				const nextPopulation = population.slice(0, this.eliteCount);

				while (nextPopulation.length < this.populationSize) {
					const parent1 = await this.selectParent(population);
					const parent2 = await this.selectParent(population);

					const [child1, child2] = this.crossover(parent1, parent2);
					nextPopulation.push(this.mutate(child1));
					if (nextPopulation.length < this.populationSize) {
						nextPopulation.push(this.mutate(child2));
					}
				}

				population = nextPopulation;
			}

			population = await this.sortPopulation(population);
			return population[0];
		}


		static generateParamSets(conf) {
			const paramSets = [];
			for (
				let populationSize = conf.populationSize.min;
				populationSize <= conf.populationSize.max;
				populationSize += conf.populationSize.step
			) {
				for (let generations = conf.generations.min; generations <= conf.generations.max; generations += conf.generations.step) {
					for (let mutationRate = conf.mutationRate.min; mutationRate <= conf.mutationRate.max; mutationRate += conf.mutationRate.step) {
						for (let eliteCount = conf.eliteCount.min; eliteCount <= conf.eliteCount.max; eliteCount += conf.eliteCount.step) {
							paramSets.push({ populationSize, generations, mutationRate, eliteCount });
						}
					}
				}
			}
			return paramSets;
		}

		static async testParams(values, combinationSize, params, countTest = 250) {
			const evaluationCalls = [];
			const scores = [];

			for (let i = 0; i < countTest; i++) {
				const ga = new GeneticAlgorithm({ values, combinationSize, ...params });
				const bestCombination = await ga.run();
				evaluationCalls.push(ga.evaluationCalls);
				const score = ((await ga.evaluateCombination(bestCombination)) - 20016) / 183;
				scores.push(score);
			}

			const avgScore = scores.reduce((a, b) => a + b) / scores.length;
			const avgEvaluationCalls = evaluationCalls.reduce((a, b) => a + b) / evaluationCalls.length;
			return {
				avgScore,
				avgEvaluationCalls,
			};
		}


		static async optimizeParameters(values, combinationSize, targetScore, optimizeConfig) {
			const paramSets = this.generateParamSets(optimizeConfig);
			let bestParams = { populationSize: 0, generations: 0, mutationRate: 0, eliteCount: 0 };
			let bestEfficiency = -Infinity;
			const bestData = {
				avgScore: 0,
				avgEvaluationCalls: 0,
			};
			let checkCount = 0;

			for (const params of paramSets) {
				const { avgScore, avgEvaluationCalls } = await this.testParams(values, combinationSize, params);
				const efficiency = (avgScore * avgScore) / avgEvaluationCalls;
				if (efficiency > bestEfficiency && avgScore >= targetScore) {
					bestEfficiency = efficiency;
					bestData.avgEvaluationCalls = avgEvaluationCalls;
					bestData.avgScore = avgScore;
					bestParams = params;
				}

				checkCount++;
				if (!(checkCount % 10)) {
					console.log(`${checkCount}/${paramSets.length}`, bestParams, bestData, process.uptime());
				}
			}
			console.log('Optimal Parameters:', checkCount, bestParams, bestData, process.uptime());
			return bestParams;
		}
	}

	class BestDungeon {
		constructor(resolve, reject) {
			this.resolve = resolve;
			this.reject = reject;
			this.isFixedBattle = true;
			this.dungeonActivity = 0;
			this.maxDungeonActivity = 150;
			this.currentActivity = 0;
			this.primeElement = '';
			this.titanGetAll = {};
			this.teams = { earth: [], fire: [], neutral: [], water: [], hero: {} };
			this.titansStates = {};
			this.talentMsg = '';
			this.talentMsgReward = '';
			this.isShowFixLog = false;
			this.timeoutFix = 15e3;
			this.countFix = 100;
			this.isStop = false;
			this.stopAfterBattle = false;
			this.startTime = Date.now();
			this.colors = {
				water: 'color: #3498db;',
				fire: 'color: #e74c3c;',
				earth: 'color: #2ecc71;',
				light: 'color: #f1c40f;',
				dark: 'color: #9b59b6;',
				neutral: 'color: yellow;',
				green: 'color: #0b0;',
				none: 'color: none;',
				red: 'color: #d00;',
			};
			this.defPowers = {
				earth: 0,
				fire: 0,
				neutral: 0,
				water: 0,
				hero: 0,
			};
			this.maxPowers = {
				earth: 396125,
				fire: 396125,
				neutral: 670725,
				water: 396125,
				hero: 242750,
			};
			this.timers = [];
			this.buffHealing = 0;
			this.debugBattleConfig = null;
			this.activeBattleType = '';
			this.lastBattleType = '';
			this.currentBattleType = '';
			this.currentBattleTimer = 0;
			this.debugBattleTrace = {
				bestFallbackAt: null,
				endBattleEnteredAt: null,
				endBattleSendAt: null,
				selectedRetry: null,
				selectedKind: null,
				bestRetry: null,
			};
		}

		async start() {
			let result = null;
			try {
				result = await Caller.send([
					'dungeonGetInfo',
					'teamGetAll',
					'teamGetFavor',
					'clanGetInfo',
					'titanGetAll',
					'inventoryGet',
					'titanSpirit_getAll',
				]);
			} catch (e) {
				this.endDungeon('Error', e);
			}
			this.startDungeon(result);
		}

		stop() {
			this.stopAfterBattle = true;
			getDebugControl().stopAfterBattle = true;
			DebugUI.log('Stop mode enabled');
		}

		getBattleConfigType(attackerType) {
			return normalizeDebugBattleType(attackerType);
		}

		applyDebugBattleConfig() {
			if (!this.debugBattleConfig) return;
			this.teams.water.heroes = getDebugTeamIds(this.debugBattleConfig, 'water');
			this.teams.fire.heroes = getDebugTeamIds(this.debugBattleConfig, 'fire');
			this.teams.earth.heroes = getDebugTeamIds(this.debugBattleConfig, 'earth');
			this.teams.neutral.heroes = getDebugTeamIds(this.debugBattleConfig, 'mixed');
			DebugUI.config = this.debugBattleConfig;
		}

		getDebugBattleConfig(attackerType) {
			const battleType = this.getBattleConfigType(attackerType);
			return {
				type: battleType,
				threshold: getDebugBattleThreshold(this.debugBattleConfig, battleType, this.titanGetAll, this.titansStates),
				priority: getDebugBattlePriority(this.debugBattleConfig, battleType, this.titanGetAll, this.titansStates),
				minTitanHpPct: this.debugBattleConfig?.minTitanHpPct ?? DEBUG_MIN_TITAN_HP_DEFAULT,
				teamIds: getDebugTeamIds(this.debugBattleConfig, battleType),
			};
		}

		getBattleRejectReason(result, battleCfg, options = {}) {
			const ignoreThreshold = !!options.ignoreThreshold;
			const rec = DungeonUtils.getState(result);
			const hpDetails = getTitanHpDetails(result);
			const minTitanHpPct = battleCfg.minTitanHpPct ?? DEBUG_MIN_TITAN_HP_DEFAULT;
			if (rec.losses?.length) {
				return { rec, hpDetails, reason: `a titan died: ${rec.losses.join(', ')}` };
			}
			const lowTitan = hpDetails.find((item) => item.afterPct < minTitanHpPct);
			if (lowTitan) {
				return { rec, hpDetails, reason: `${lowTitan.name} dropped below ${minTitanHpPct}%` };
			}
			if (!ignoreThreshold) {
				const thresholdValue = Number.isFinite(+battleCfg?.thresholdValue) ? +battleCfg.thresholdValue : null;
				const thresholdPct = battleCfg.threshold ?? 0;
				const threshold = thresholdValue ?? thresholdPct / 100;
				if (truncateTo2Decimals(rec.hp) < truncateTo2Decimals(threshold)) {
					return {
						rec,
						hpDetails,
						reason: thresholdValue != null
							? `total hp ${rec.hp.toFixed(4)} below best threshold ${threshold.toFixed(4)}`
							: `total hp ${rec.hp.toFixed(4)} below threshold ${thresholdPct}% (${threshold.toFixed(4)})`,
					};
				}
			}
			return { rec, hpDetails, reason: '' };
		}

		playFailureBeep() {
			try {
				const AudioContextClass = window.AudioContext || window.webkitAudioContext;
				if (!AudioContextClass) return;
				const ctx = new AudioContextClass();
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = 880;
				gain.gain.value = 0.03;
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.start();
				osc.stop(ctx.currentTime + 0.18);
				setTimeout(() => ctx.close?.(), 300);
			} catch (error) {
				console.warn('Beep error', error);
			}
		}

		getActivityPerHour() {
			const elapsedMs = Date.now() - this.startTime;
			const elapsedHours = elapsedMs / 36e5; // 1000 * 60 * 60

			return Math.floor(elapsedHours > 0 ? this.currentActivity / elapsedHours : 0);
		}

		getBattleTypeStyle(attackerType) {
			const type = normalizeDebugBattleType(attackerType);
			const styles = {
				water: this.colors.water,
				fire: this.colors.fire,
				earth: this.colors.earth,
				mixed: this.colors.neutral,
				hero: 'color: #f3f3f3;',
			};
			return styles[type] || this.colors.none;
		}

		async executeWithRetry(request, maxRetries = 10) {
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					const result = await Caller.send(request);
					return result;
				} catch (error) {
					console.error(`Retry ${attempt} / ${maxRetries} error:`, error);
					const delayMs = Math.min(random(500, 1000) * Math.pow(2, attempt - 1), 10000);
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			}
			return false;
		}

		getStatMessage(forcedBattleType = null, forcedTimer = null) {
			const activityPerHour = this.getActivityPerHour();
			const battleType = normalizeDebugBattleType(forcedBattleType || this.lastBattleType || this.activeBattleType || this.currentBattleType || '');
			const battleLine = battleType
				? `<span style="${this.getBattleTypeStyle(battleType)}font-weight:700;">${battleType.toUpperCase()}</span>`
				: '<span style="opacity:.7;">idle</span>';
			const timerValue = forcedTimer ?? this.currentBattleTimer;
			const timerLine = timerValue ? `${timerValue.toFixed(2)}` : '—';
			const lines = [
				`Dungeon: ${I18N('TITANIT')} ${this.dungeonActivity}/${this.maxDungeonActivity}`,
				`${I18N('TITANIT')}: ${this.currentActivity}`,
				`${activityPerHour} ${I18N('BEST_DUNGEON_PER_HOUR')}`,
				`Battle: ${battleLine}`,
				`Mixed priority: ${getDebugBattlePriority(this.debugBattleConfig, 'mixed', this.titanGetAll, this.titansStates)}`,
				getDebugHealTriggerText(this.debugBattleConfig, this.titanGetAll, this.titansStates),
				`Timer: ${timerLine}`,
			].filter(Boolean);
			return lines.join('<br>');
		}

		resolveBattleTypeFromInfo(battleInfo) {
			return normalizeDebugBattleType(
				battleInfo?.attackerType ||
					battleInfo?.battleData?.attackerType ||
					battleInfo?.battleData?.battle?.attackerType ||
					this.lastBattleType ||
					this.activeBattleType ||
					this.currentBattleType ||
					''
			);
		}

		startDungeon(data) {
			const [dungeonGetInfo, teamGetAll, teamGetFavor, clanGetInfo, titanGetAll, inventoryGet, titanSpirits] = data;

			if (!dungeonGetInfo) {
				this.endDungeon('noDungeon');
				return;
			}

			this.dungeonGetInfo = dungeonGetInfo;
			this.teamGetAll = teamGetAll;
			this.teamGetFavor = teamGetFavor;
			this.dungeonActivity = clanGetInfo.stat.todayDungeonActivity;
			this.titanGetAll = titanGetAll;
			this.titans = Object.values(titanGetAll);
			const liveTitanStates = dungeonGetInfo.states?.titans || {};
			const savedTitanState = loadDebugTitanState();
			this.titansStates = savedTitanState?.titansStates || liveTitanStates;
			this.battledTitanIds = new Set((savedTitanState?.battledTitanIds || []).map(String));
			this.lastBattleTitanIds = [];
			HWHData.countPredictionCard = inventoryGet.consumable[81] || 0;
			this.titanSpirits = titanSpirits.spirits;
			this.debugBattleConfig = loadDebugConfig(titanGetAll);
			this.applyDebugBattleConfig();
			DebugUI.trackedTitanIds = [...this.battledTitanIds];
			DebugUI.setTitanStates(this.titanGetAll, this.titansStates, DebugUI.trackedTitanIds);

			this.teams.hero = {
				favor: teamGetFavor.dungeon_hero,
				heroes: teamGetAll.dungeon_hero.filter((id) => id < 6000),
				teamNum: 0,
			};

			const heroPet = teamGetAll.dungeon_hero.find((id) => id >= 6000);
			if (heroPet) this.teams.hero.pet = heroPet;

			['neutral', 'water', 'fire', 'earth'].forEach((type) => {
				this.teams[type] = {
					favor: {},
					heroes: DungeonUtils.getTitanTeam(this.titans, type),
					teamNum: 0,
				};
			});

			this.checkFloor(dungeonGetInfo);
		}

    showTitanStates() {
        const titanGetAll = this.titanGetAll;
        const titans = this.titansStates;
        const colWhidth = 17;

        const columns = [
            { element: 'water', color: '#3498db', icon: 'W' },
            { element: 'fire', color: '#e74c3c', icon: 'F' },
            { element: 'earth', color: '#2ecc71', icon: 'E' },
            { element: 'light', color: '#f1c40f', icon: 'L' },
            { element: 'dark', color: '#9b59b6', icon: 'D' },
        ];

        const titansData = columns.reduce(
            (acc, col) => ({
                ...acc,
                [col.element]: Object.keys(titanGetAll)
                    .filter((id) => lib.data.titan[id].element === col.element)
                    .map((id) => {
                        const state = titans[id] ?? {};
                        const HP = state.hp ? Math.floor((state.hp / state.maxHp) * 100) : 100;
                        return {
                            name: cheats.translate(`LIB_HERO_NAME_${id}`),
                            status: state.isDead ? ' DEAD' : ` HP:${HP}% EN:${state.energy || 0}`,
                        };
                    }),
            }),
            {}
        );

        const maxRows = Math.max(...columns.map((col) => titansData[col.element].length));
        const emptyCell = ''.padEnd(colWhidth);

        const buildLine = (items) => items.map((content) => `%c${content}\t`).join('');

        const header = buildLine(columns.map((col) => `${col.icon} ${col.element.toUpperCase()}`.padEnd(colWhidth)));

        const rows = Array.from({ length: maxRows }, (_, i) =>
            buildLine(
                columns.map((col) => {
                    const titan = titansData[col.element][i];
                    return titan ? `${titan.name}${titan.status}`.padEnd(colWhidth) : emptyCell;
                })
            )
        );

        console.log(
            [header, ...rows].join('\n'),
            ...columns.map((col) => `font-weight: bold; color: ${col.color}`),
            ...rows.flatMap(() => columns.map((col) => `color: ${col.color}`))
        );
    }
		async checkFloor(dungeonInfo) {
			if (this.stopAfterBattle || getDebugControl().stopAfterBattle) {
				DebugUI.log('Stop applied after current battle');
				this.endDungeon('endDungeon', `${I18N('STOPPED')} after current battle`);
				return;
			}
			if (!dungeonInfo.floor || dungeonInfo.floor.state === 2) {
				await this.saveProgress();
				return;
			}

			const result = await this.checkTalent(dungeonInfo);
			if (!result) {
				this.endDungeon('ErrorReqests');
				return;
			}

			this.maxDungeonActivity = +getInput('countTitanit');
			if (this.dungeonActivity >= this.maxDungeonActivity) {
				this.endDungeon('endDungeon', `maxActive ${this.dungeonActivity}/${this.maxDungeonActivity}`);
				return;
			}

			const message = this.getStatMessage();
			DebugUI.setDungeonMessage(message);

			this.titansStates = dungeonInfo.states.titans;
			const floorChoices = dungeonInfo.floor.userData;
			const floorType = dungeonInfo.floorType;
			this.primeElement = dungeonInfo.elements.prime;

			if (floorType === 'battle') {
				const battles = await this.prepareBattles(floorChoices);
				if (!battles) {
					return;
				}
				if (battles.length === 0) {
					this.endDungeon('endDungeon', 'All Dead');
					return;
				}
				this.testProcessingPromises(battles);
			}
		}

		async prepareBattles(floorChoices) {
			const { fixTitanTeam } = DungeonUtils;
			const battles = [];
			for (const [teamNum, choice] of Object.entries(floorChoices)) {
				const { attackerType } = choice;
				let team = {
					favor: {},
					teamNum,
					heroes: [],
				};
				if (attackerType === 'hero') {
					team = this.teams[attackerType];
				} else {
					const selectedHeroes = this.teams[attackerType].heroes;
					team.heroes = fixTitanTeam(selectedHeroes, this.titansStates);
					if (team.heroes.length !== selectedHeroes.length) {
						DebugUI.log('[DBG battle team trimmed]', {
							attackerType,
							removedHeroes: selectedHeroes.filter((id) => this.titansStates?.[id]?.isDead),
							removedNames: selectedHeroes
								.filter((id) => this.titansStates?.[id]?.isDead)
								.map((id) => cheats.translate(`LIB_HERO_NAME_${id}`)),
						});
					}
				}
				if (team.heroes.length === 0) {
					this.endDungeon('endDungeon', `No configured titans for ${attackerType}`);
					return false;
				}

				const battleData = await this.executeWithRetry({ name: 'dungeonStartBattle', args: { ...team, teamNum } });
				if (!battleData) {
					return false;
				}

				battles.push({
					...battleData,
					progress: [{ attackers: { input: ['auto', 0, 0, 'auto', 0, 0] } }],
					teamNum,
					attackerType,
				});
			}
			return battles;
		}

		async checkTalent(dungeonInfo) {
			const { talent } = dungeonInfo;
			if (!talent) return true;

			const dungeonFloor = +dungeonInfo.floorNumber;
			const talentFloor = +talent.floorRandValue;
			let doorsAmount = 3 - talent.conditions.doorsAmount;

			if (dungeonFloor === talentFloor && (!doorsAmount || !talent.conditions?.farmedDoors[dungeonFloor])) {
				const results = await this.executeWithRetry([
					{ name: 'heroTalent_getReward', args: { talentType: 'tmntDungeonTalent', reroll: false } },
					{ name: 'heroTalent_farmReward', args: { talentType: 'tmntDungeonTalent' } },
				]);
				if (!results) {
					return false;
				}

				const [reward] = results;
				const type = Object.keys(reward).pop();
				if (reward[type]) {
					const itemId = +Object.keys(reward[type]).pop();
					const count = reward[type][itemId];
					const itemName = cheats.translate(`LIB_${type.toUpperCase()}_NAME_${itemId}`);
					this.talentMsgReward += `<br> ${count} <span style="color:${itemId == 300 ? 'red' : 'inherit'}">${itemName}</span>`;
					doorsAmount++;
				}
			}

			this.talentMsg = `<br>TMNT Talent: ${doorsAmount}/3 ${this.talentMsgReward}<br>`;
			return true;
		}

		updatePower(battle) {
			const type = battle.attackerType;
			const def = Object.values(battle.defenders[0]);
			const power = def.reduce((a, e) => a + e.power, 0);
			this.defPowers[type] = power;

			const buff = battle?.effects?.defenders?.percentBuffAllEnemy_healing;
			if (buff) {
				this.buffHealing = buff;
			}
		}

		async testProcessingPromises(battles) {
			const sortedBattles = [...battles].sort((a, b) => {
				const priorityA = getDebugBattlePriority(this.debugBattleConfig, a.attackerType, this.titanGetAll, this.titansStates);
				const priorityB = getDebugBattlePriority(this.debugBattleConfig, b.attackerType, this.titanGetAll, this.titansStates);
				if (priorityA !== priorityB) return priorityA - priorityB;
				return +a.teamNum - +b.teamNum;
			});
			const battleSummary = sortedBattles.reduce(
				(acc, battle) => {
					const type = normalizeDebugBattleType(battle.attackerType);
					acc.types[type] = (acc.types[type] || 0) + 1;
					acc.list.push({
						teamNum: battle.teamNum,
						attackerType: battle.attackerType,
						type,
						priority: getDebugBattlePriority(this.debugBattleConfig, battle.attackerType, this.titanGetAll, this.titansStates),
					});
					return acc;
				},
				{ types: {}, list: [] }
			);
			let selectBattle = null;
			let bestPack = null;

			DebugUI.log('[DBG config start]', {
				priorities: this.debugBattleConfig?.priorities || {},
				thresholds: this.debugBattleConfig?.thresholds || {},
				minTitanHpPct: this.debugBattleConfig?.minTitanHpPct ?? DEBUG_MIN_TITAN_HP_DEFAULT,
				stopBeforeBattle: this.debugBattleConfig?.stopBeforeBattle || {},
				battleCounts: battleSummary.types,
			});
			DebugUI.log(
				'[DBG priority order]',
				battleSummary.list
			);

			for (const battle of sortedBattles) {
				this.updatePower(battle);
				if (battle.attackerType === 'hero') {
					const resultHeroBattle = await Calc(battle);
					await this.endBattle(resultHeroBattle);
					return;
				}

				try {
					this.currentBattleType = battle.attackerType;
					this.lastBattleType = battle.attackerType;
					this.currentBattleTimer = 0;
					DebugUI.setDungeonMessage(this.getStatMessage());
					const titanStats = new TitanStats(this.titanGetAll, this.titanSpirits, this.titansStates);
					const evalute = new EnumAttackPack(titanStats, battle);
					bestPack = await evalute.getAttackers();
					selectBattle = battle;
					DebugUI.log('[DBG priority accepted]', {
						teamNum: battle.teamNum,
						attackerType: battle.attackerType,
						priority: getDebugBattlePriority(this.debugBattleConfig, battle.attackerType, this.titanGetAll, this.titansStates),
					});
					break;
				} catch (error) {
					DebugUI.log('[DBG sim error]', String(error?.stack || error));
					throw error;
				}
			}

			if (!selectBattle) {
				this.endDungeon(I18N('BEST_DUNGEON_WINNING_FIGHT_NOT_FOUND'), battles);
				return;
			}

			const stopBeforeBattle = this.debugBattleConfig?.stopBeforeBattle || {};
			const selectedBattleType = normalizeDebugBattleType(selectBattle.attackerType);
			if (stopBeforeBattle[selectedBattleType]) {
				const stopText = `Stopped before ${selectedBattleType} battle: team ${selectBattle.teamNum}`;
				console.log(`%c${stopText}`, this.colors.red);
				this.playFailureBeep();
				this.endDungeon('endDungeon', stopText);
				return;
			}

			this.activeBattleType = selectedBattleType;
			this.lastBattleType = selectedBattleType;
			this.currentBattleType = selectedBattleType;
			this.currentBattleTimer = 0;
			DebugUI.setDungeonMessage(this.getStatMessage(selectedBattleType, 0));
			const initialBattle = await this.startBattle(selectBattle.teamNum, selectBattle.attackerType, bestPack);
			this.logSelectPack({ ...initialBattle.battleData, attackerType: selectBattle.attackerType }, null);
			await this.retryBattle(initialBattle);
		}

		logBattleStats(battle, bestRec = null) {
			let colors = [];
			let text = '';
			if (bestRec) {
				colors = [this.colors.green, this.colors.none];
				text = ' %cbestStat: %c' + JSON.stringify(bestRec);
			}
			console.log(`%c${battle.attackerType}` + text, this.colors[battle.attackerType], ...colors);
			if (bestRec) {
				this.logPack(battle, battle.teamNum);
			}
		}

		logSelectPack(battle, recSelectBattle) {
			const attackerType = battle.attackerType;
			const pack = Object.values(battle.attackers).map((e) => e.id);
			this.recordStat(pack);
			console.log('Select: %c' + attackerType, this.colors[attackerType]);
			this.logPack(battle);
			console.log('%cbattleStat: %c' + JSON.stringify(recSelectBattle), this.colors.green, this.colors.none);
		}

		logPack(battle, teamNum = '') {
			const pack = Object.values(battle.attackers).map((e) => e.id);
			const list = pack.reduce(
				(a, e) => {
					a.names.push('%c' + cheats.translate('LIB_HERO_NAME_' + e));
					a.styles.push(this.colors[lib.data.titan[e].element]);
					return a;
				},
				{ names: [], styles: [] }
			);
			console.log(`%cPack ${teamNum}: ` + list.names.join(' '), this.colors[battle.attackerType], ...list.styles);
		}

		recordStat(pack) {}

		async sampleBattleStats(battle, samples) {
			const { getState, genBattleSeed, isRandomBattle } = DungeonUtils;
			const stats = [];

			if (!isRandomBattle(battle)) {
				samples = 1;
			}

			for (let i = 0; i < samples; i++) {
				const seed = genBattleSeed();
				const calcResult = await Calc({ ...battle, seed });
				const rec = getState(calcResult);
				if (DEBUG_LOG_SIMULATIONS) {
					DebugUI.log(formatBattleResultTextEn(`[DBG sampleBattleStats] seed ${seed}`, calcResult, rec, getTitanHpDetails(calcResult)));
				}
				stats.push(rec);
			}

			console.log('isRandomBattle', isRandomBattle(battle), stats);

			return stats;
		}


		async calculateThreshold(battle) {
			const { compareScore } = DungeonUtils;
			const samples = 100; // +getInput('countTestBattle')
			const q = 0.85; // Best 85%

			const stats = await this.sampleBattleStats(battle, samples);
			stats.sort((a, b) => {
				if (compareScore(a, b)) return 1;
				if (compareScore(b, a)) return -1;
				return 0;
			});

			return stats[Math.floor(stats.length * q)];
		}

		async retryBattle(initialBattle, _targetRec) {
			const countAutoBattle = Math.max(1, Math.round(+this.debugBattleConfig?.searchAttempts || DEBUG_MAX_SIMULATIONS));
			const repeatAutoBattle = Math.max(1, Math.round(+this.debugBattleConfig?.repeatAttempts || DEBUG_REPEAT_ATTEMPTS));
			const repeatTolerancePct = Math.max(0, Math.round(+this.debugBattleConfig?.repeatThresholdTolerancePct || DEBUG_REPEAT_THRESHOLD_TOLERANCE_PCT));
			const repeatTolerance = repeatTolerancePct / 100;
			const battleCfg = this.getDebugBattleConfig(initialBattle.attackerType);
			const retryStartedAt = Date.now();
			console.log(
				`%cBattle config: %ctype=${battleCfg.type} threshold=${battleCfg.threshold}% minHp=${battleCfg.minTitanHpPct}%`,
				this.colors.green,
				this.colors.none
			);

			const initialCheck = this.getBattleRejectReason(initialBattle, battleCfg);
			const initialEligibleCheck = this.getBattleRejectReason(initialBattle, battleCfg, { ignoreThreshold: true });
			if (!initialCheck.reason) {
				initialBattle.debugRetryAttempt = 0;
				initialBattle.debugSelectionKind = 'initial';
				this.debugBattleTrace.selectedRetry = 0;
				this.debugBattleTrace.selectedKind = 'initial';
				console.log(
					`%cInitial battle already fits the rules: %chp=${initialCheck.rec.hp.toFixed(4)} energy=${initialCheck.rec.energy.toFixed(4)}`,
					this.colors.green,
					this.colors.none
				);
				await this.endBattle(initialBattle);
				return;
			}

			let bestEligibleBattle = initialEligibleCheck.reason ? null : initialBattle;
			let bestEligibleCheck = initialEligibleCheck.reason ? null : initialEligibleCheck;
			let bestEligibleRetry = initialEligibleCheck.reason ? null : 0;
			let bestOverallBattle = initialBattle;
			let bestOverallCheck = initialCheck;
			let bestOverallRetry = 0;
			let lastReject = initialCheck.reason;

			const considerBest = (candidateBattle, candidateCheck, retryNum) => {
				if (!candidateCheck || candidateCheck.reason) return;
				if (!bestEligibleCheck || DungeonUtils.compareScore(candidateCheck.rec, bestEligibleCheck.rec)) {
					bestEligibleBattle = candidateBattle;
					bestEligibleCheck = candidateCheck;
					bestEligibleRetry = retryNum;
				}
			};

			const considerOverall = (candidateBattle, candidateCheck, retryNum) => {
				if (!bestOverallCheck || DungeonUtils.compareScore(candidateCheck.rec, bestOverallCheck.rec)) {
					bestOverallBattle = candidateBattle;
					bestOverallCheck = candidateCheck;
					bestOverallRetry = retryNum;
				}
			};

			considerBest(initialBattle, initialEligibleCheck, 0);

			const runPass = async (passName, passCfg, passAttempts) => {
				for (let i = 0; i < passAttempts; i++) {
					const result = await this.startBattle(initialBattle.teamNum, initialBattle.attackerType, initialBattle.battleData.attackers);
					if (!result) {
						this.endDungeon('ErrorReqests');
						return { stopped: true };
					}

					const checked = this.getBattleRejectReason(result, passCfg);
					const eligibleCheck = this.getBattleRejectReason(result, passCfg, { ignoreThreshold: true });
					if (DEBUG_LOG_SIMULATIONS) {
						DebugUI.log(
							formatBattleResultTextEn(
								'[DBG retryBattle]',
								result,
								checked.rec,
								checked.hpDetails,
								checked.reason || null,
								i + 1,
								passName
							)
						);
					}

					considerBest(result, eligibleCheck, i + 1);
					considerOverall(result, checked, i + 1);

					if (!checked.reason) {
						result.debugRetryAttempt = i + 1;
						result.debugSelectionKind = passName === 'repeat' ? 'repeat-accepted' : 'accepted';
						this.debugBattleTrace.selectedRetry = i + 1;
						this.debugBattleTrace.selectedKind = result.debugSelectionKind;
						console.log(
							`%cAcceptable fight found on attempt ${i + 1}: %chp=${checked.rec.hp.toFixed(4)} energy=${checked.rec.energy.toFixed(4)}`,
							this.colors.green,
							this.colors.none
						);
						await this.endBattle(result);
						return { stopped: true };
					}

					lastReject = checked.reason;
					console.log(`%c${passName === 'repeat' ? 'Repeat' : 'Retry'} ${i + 1}/${countAutoBattle}: rejected - ${checked.reason}`, this.colors.red);
				}
				return { stopped: false };
			};

			const firstPass = await runPass('retry', battleCfg, countAutoBattle);
			if (firstPass.stopped) return;

			if (bestEligibleCheck) {
				const repeatBaseHp = truncateTo2Decimals(bestEligibleCheck.rec.hp);
				const repeatTargetHp = truncateTo2Decimals(repeatBaseHp - repeatTolerance);
				const repeatBattleCfg = {
					...battleCfg,
					thresholdValue: repeatTargetHp,
				};
				let repeatRound = 0;
				while (true) {
					repeatRound += 1;
					console.log(
						`%cRepeat search threshold: %chp=${repeatTargetHp.toFixed(4)} from retry ${bestEligibleRetry ?? 0} (tolerance ${repeatTolerancePct}%)`,
						this.colors.green,
						this.colors.none
					);
					DebugUI.log('[DBG repeat pass start]', {
						repeatRound,
						repeatAttempts: repeatAutoBattle,
						repeatTolerancePct,
						repeatThresholdHp: repeatBaseHp,
						repeatTargetHp,
						bestEligibleRetry,
					});
					const repeatPass = await runPass(`repeat ${repeatRound}`, repeatBattleCfg, repeatAutoBattle);
					if (repeatPass.stopped) return;
				}
			}

			const finalText = `No acceptable ${battleCfg.type} battle after ${countAutoBattle} sims: ${lastReject}`;
			console.log(`%c${finalText}`, this.colors.red);
			DebugUI.log('[DBG no acceptable battle]', {
				battleType: battleCfg.type,
				lastReject,
				bestEligibleRetry: bestEligibleRetry ?? null,
				bestEligibleHp: bestEligibleCheck?.rec?.hp ?? null,
			});
			this.endDungeon('endDungeon', finalText);
		}

		async startBattle(teamNum, attackerType, pack = null) {
			const { fixTitanTeam } = DungeonUtils;
			let heroes = [];
			this.activeBattleType = attackerType;
			this.lastBattleType = attackerType;
			this.currentBattleType = attackerType;

			if (pack) {
				heroes = Object.values(pack).map((e) => e.id);
			} else {
				if (attackerType === 'hero') {
					heroes = this.teams.hero.heroes;
				} else if (normalizeDebugBattleType(attackerType) === 'mixed') {
					heroes = getDebugMixedBattleTeamIds(this.debugBattleConfig, this.titanGetAll, this.titansStates);
				} else {
					heroes = fixTitanTeam(this.teams[attackerType].heroes, this.titansStates);
				}
			}

			const requestStartedAt = performance.now();
			const battleData = await this.executeWithRetry({
				name: 'dungeonStartBattle',
				args: {
					favor: {},
					teamNum,
					heroes,
				},
			});
			const requestMs = performance.now() - requestStartedAt;
			if (!battleData) {
				DebugUI.log('[DBG timing] dungeonStartBattle failed', {
					attackerType,
					teamNum,
					requestMs: Math.round(requestMs * 100) / 100,
				});
				return false;
			}

			const result = await this.resultBattle(battleData, { teamNum, attackerType });
			DebugUI.log('[DBG timing] startBattle total', {
				attackerType,
				teamNum,
				requestMs: Math.round(requestMs * 100) / 100,
				resultAvailable: !!result,
			});
			return result;
		}
		async resultBattle(battleData, args = {}) {
			const startedAt = performance.now();
			runWorkerProbe(structuredClone(battleData), args);
			let fixedBattleMs = 0;
			let dfb = null;
			if (this.isFixedBattle) {
				const fixStartedAt = performance.now();
				dfb = new UpdateDungeonFixBattle(battleData);
				dfb.isShowResult = this.isShowFixLog;
				const fixData = await dfb.start(Date.now() + this.timeoutFix, this.countFix);
				fixedBattleMs = performance.now() - fixStartedAt;
				battleData.progress = [{ attackers: { input: ['auto', 0, 0, 'auto', 0, fixData.timer] } }];
			}
			const calcStartedAt = performance.now();
			const result = await Calc(battleData);
			DebugUI.log('[DBG timing] Calc/BattleCalc', {
				attackerType: args.attackerType ?? battleData.attackerType ?? null,
				teamNum: args.teamNum ?? battleData.teamNum ?? null,
				fixedBattleMs: Math.round(fixedBattleMs * 100) / 100,
				fixIterations: this.isFixedBattle ? (dfb.count ?? null) : 0,
				fixMaxIterations: this.isFixedBattle ? (dfb.maxCount ?? null) : 0,
				fixAvgCalcMs: this.isFixedBattle && Number.isFinite(dfb.avgTime) ? Math.round(dfb.avgTime * 100) / 100 : null,
				calcMs: Math.round((performance.now() - calcStartedAt) * 100) / 100,
				totalResultBattleMs: Math.round((performance.now() - startedAt) * 100) / 100,
			});
			return { ...result, ...args };
		}
		getThresholdTimer() {
			let { isSubActive } = HWHFuncs;
			if (typeof isSubActive !== 'function') {
				isSubActive = () => false;
			}
			const defaultTimer = isSubActive() ? 10 : 30;

			function median(arr) {
				const sorted = [...arr].sort((a, b) => a - b);
				const mid = Math.floor(sorted.length / 2);
				return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
			}

			function average(arr) {
				const sum = arr.reduce((total, num) => total + num);
				return sum / arr.length;
			}

			if (this.timers.length < 10) {
				return defaultTimer;
			}

			const thresholdAvg = average(this.timers);
			if (thresholdAvg > defaultTimer) {
				return thresholdAvg;
			}
			const thresholdMed = median(this.timers);
			if (thresholdMed > defaultTimer) {
				return thresholdMed;
			}
			return defaultTimer;
		}

		async endBattle(battleInfo) {
			this.debugBattleTrace.endBattleEnteredAt = Date.now();
			const enteredAt = this.debugBattleTrace.endBattleEnteredAt;
			const fallbackAt = this.debugBattleTrace.bestFallbackAt;
			if (fallbackAt) {
				DebugUI.log('[DBG endBattle timing]', {
					enteredAt,
					fallbackAt,
					deltaFromFallbackMs: enteredAt - fallbackAt,
					selectedRetry: battleInfo?.debugRetryAttempt ?? null,
					selectedKind: battleInfo?.debugSelectionKind ?? null,
				});
			} else {
				DebugUI.log('[DBG endBattle timing]', {
					enteredAt,
					fallbackAt: null,
					selectedRetry: battleInfo?.debugRetryAttempt ?? null,
					selectedKind: battleInfo?.debugSelectionKind ?? null,
				});
			}
			if (battleInfo.battleData.attackerType !== 'hero') {
				this.logPack(battleInfo.battleData);
				this.lastBattleTitanIds = getBattlePackIds(battleInfo.battleData.attackers || {});
			}
			if (DEBUG_LOG_SIMULATIONS && battleInfo.battleData.attackerType !== 'hero') {
				const rec = DungeonUtils.getState(battleInfo);
				DebugUI.log(formatBattleResultTextEn('[DBG endBattle]', battleInfo, rec, getTitanHpDetails(battleInfo)));
			}
			if (battleInfo.battleData.attackerType !== 'hero') {
				const resolvedBattleType = this.resolveBattleTypeFromInfo(battleInfo);
				DebugUI.log('[DBG battle type resolved]', {
					rawAttackerType: battleInfo?.attackerType ?? null,
					rawBattleDataAttackerType: battleInfo?.battleData?.attackerType ?? null,
					rawBattleDataBattleAttackerType: battleInfo?.battleData?.battle?.attackerType ?? null,
					resolvedBattleType,
					battleTimer: battleInfo?.battleTimer ?? null,
				});
				this.activeBattleType = resolvedBattleType;
				this.lastBattleType = resolvedBattleType;
				this.currentBattleType = resolvedBattleType;
				this.currentBattleTimer = battleInfo.battleTimer || 0;
				DebugUI.setDungeonMessage(this.getStatMessage(resolvedBattleType, this.currentBattleTimer));
				this.lastBattleHpDetails = getTitanHpDetails(battleInfo);
				DebugUI.setBattleDetails(this.lastBattleHpDetails, `Last battle: ${resolvedBattleType}`);
			}

			const battleState = DungeonUtils.getState(battleInfo);
			const isAllDead = !!battleState.losses?.length;
			if (!battleInfo.result.win && isAllDead) {
				this.endDungeon('dungeonEndBattle win: false\n', battleInfo);
				return;
			}
			const args = { result: battleInfo.result, progress: battleInfo.progress };

			this.timers.push(battleInfo.battleTimer);
			const thresholdTimer = this.getThresholdTimer();
			console.log('countCard', HWHData.countPredictionCard, 'battleTimer', battleInfo.battleTimer, 'thresholdTimer', thresholdTimer);
			if (HWHData.countPredictionCard && battleInfo.battleTimer > thresholdTimer) {
				args.isRaid = true;
			} else {
				const resolvedBattleType = this.resolveBattleTypeFromInfo(battleInfo);
				DebugUI.log('[DBG countdown message]', {
					resolvedBattleType,
					battleTimer: battleInfo.battleTimer,
				});
				const message = this.getStatMessage(resolvedBattleType, battleInfo.battleTimer);
				const timerFinished = await countdownTimer(battleInfo.battleTimer, message, () => false, false);
				console.log('timerFinished', timerFinished);
				if (!timerFinished) {
					this.endDungeon('endDungeon', I18N('STOPPED'));
					return;
				}
			}

			const resultEnd = await this.executeWithRetry({ name: 'dungeonEndBattle', args });
			this.debugBattleTrace.endBattleSendAt = Date.now();
			DebugUI.log('[DBG dungeonEndBattle sent]', {
				sentAt: this.debugBattleTrace.endBattleSendAt,
				enteredAt,
				fallbackAt,
				selectedRetry: battleInfo?.debugRetryAttempt ?? null,
				selectedKind: battleInfo?.debugSelectionKind ?? null,
				bestRetry: this.debugBattleTrace.bestRetry,
				deltaFromFallbackMs: fallbackAt ? this.debugBattleTrace.endBattleSendAt - fallbackAt : null,
				deltaFromEnterMs: this.debugBattleTrace.endBattleSendAt - enteredAt,
			});
			if (!resultEnd) {
				this.endDungeon('ErrorReqests');
				return;
			}
			this.resultEndBattle(resultEnd);
		}

		resultEndBattle(battleResult) {
			if (battleResult.error) {
				this.endDungeon('Error', battleResult.error);
			}
			if (DEBUG_LOG_SIMULATIONS) {
				DebugUI.log('[DBG resultEndBattle]', {
					error: battleResult.error || null,
					reward: battleResult.reward || null,
					dungeonHasReward: !!battleResult?.dungeon?.reward,
				});
			}
			const dungeonGetInfo = battleResult.dungeon ?? battleResult;
			if (dungeonGetInfo.states?.titans) {
				this.titansStates = dungeonGetInfo.states.titans;
				this.battledTitanIds = this.battledTitanIds || new Set();
				for (const id of this.lastBattleTitanIds || []) {
					this.battledTitanIds.add(String(id));
				}
				DebugUI.trackedTitanIds = [...this.battledTitanIds];
				DebugUI.setTitanStates(this.titanGetAll, this.titansStates, DebugUI.trackedTitanIds);
				saveDebugTitanState({
					titansStates: this.titansStates,
					battledTitanIds: [...this.battledTitanIds],
				});
			}
			if (dungeonGetInfo.reward) {
				this.dungeonGetInfo = dungeonGetInfo;
			} else {
				this.dungeonGetInfo.states = dungeonGetInfo.states;
			}
			const addActivity = battleResult.reward?.dungeonActivity ?? 0;
			this.dungeonActivity += addActivity;
			this.currentActivity += addActivity;

			Promise.resolve().then(async () => {
				if (battleResult.debugSelectionKind === 'repeat-accepted') {
					await new Promise((resolve) => setTimeout(resolve, 4000));
				}
				if (this.stopAfterBattle || getDebugControl().stopAfterBattle) {
					DebugUI.log('Stop applied after current battle');
					this.endDungeon('endDungeon', `${I18N('STOPPED')} after current battle`);
					return;
				}
				this.checkFloor(this.dungeonGetInfo);
			});
		}

		titanObjToArray(obj) {
			return Object.entries(obj).map(([id, data]) => ({ id, ...data }));
		}

		async saveProgress() {
			const result = await this.executeWithRetry('dungeonSaveProgress');
			if (!result) {
				this.endDungeon('ErrorReqests');
				return;
			}
			this.resultEndBattle(result);
		}

		showStat(type, stat) {}

		endDungeon(reason, info) {
			console.log('timerStat', this.timers);
			console.warn(reason, info);
			this.activeBattleType = '';
			this.lastBattleType = '';
			this.currentBattleType = '';
			this.currentBattleTimer = 0;
			DebugUI.setDungeonMessage(this.getStatMessage());
			if (reason === 'endDungeon' && info) {
				DebugUI.log('[DBG dungeon end]', String(info));
			}
			this.resolve();
		}
	}

	this.HWHClasses.executeDungeon = BestDungeon;


	class SelectAttackPack {
		constructor(heroStats, battle) {
			this.heroStats = heroStats;
			this.battle = structuredClone(battle);
		}

		sortByHpAndEnergy(a, b) {
			if (a.v.hp !== b.v.hp) {
				return b.v.hp - a.v.hp;
			}
			return b.v.energy - a.v.energy;
		}

		getBattleWithPack(pack) {
			const cloneBattle = structuredClone(this.battle);
			cloneBattle.attackers = this.getAttackersStat(pack);
			return cloneBattle;
		}

		getAttackersStat(pack) {
			return Object.fromEntries(pack.map((id) => [id, this.heroStats.getTitanStats(id)]));
		}

		async evaluatePack(pack) {
			const cloneBattle = this.getBattleWithPack(pack);
			const { isRandomBattle, genBattleSeed, getState, compareScore } = DungeonUtils;

			const maxResult = {
				hp: -Infinity,
				energy: -Infinity,
				seed: null,
			};

			let countTest = 10;
			const countTestBattle = isRandomBattle(cloneBattle) ? countTest : 1;
			for (let i = 0; i < countTestBattle; i++) {
				const seed = genBattleSeed();
				cloneBattle.seed = seed;
				const calcResult = await Calc(cloneBattle);
				const result = getState(calcResult);
				if (DEBUG_LOG_SIMULATIONS) {
					DebugUI.log(formatBattleResultTextEn(`[DBG evaluatePack] seed ${seed}`, calcResult, result, getTitanHpDetails(calcResult)));
				}

				if (compareScore(result, maxResult)) {
					maxResult.hp = result.hp;
					maxResult.energy = result.energy;
					maxResult.seed = seed;
				}
			}

			return maxResult;
		}
	}

	class EnumAttackPack extends SelectAttackPack {
		async getAttackers() {
			const config = DebugUI.config || safeParseJson(getSaveVal(DEBUG_STORAGE_KEY, ''), null);
			const battleType = normalizeDebugBattleType(this.battle.attackerType);
			const forcedPack = battleType === 'mixed'
				? getDebugMixedBattleTeamIds(config, this.heroStats.titans, this.heroStats.states)
				: getDebugTeamIds(config, battleType);
			if (!forcedPack.length) {
				throw new Error(`No selected titans for ${battleType} battle`);
			}
			if (battleType === 'mixed' && forcedPack.length > 5) {
				throw new Error(`Mixed team has ${forcedPack.length} titans, but the limit is 5`);
			}
			this.statBestCombination = {
				hp: null,
				energy: null,
				seed: null,
			};
			DebugUI.log('[DBG forced team]', {
				battleType,
				forcedPack,
				names: forcedPack.map((e) => cheats.translate('LIB_HERO_NAME_' + e)),
			});
			return this.getAttackersStat(forcedPack);
		}
	}

	class DungeonUtils {
		static getState(result) {
			const isAllDead = Object.values(result.progress[0].attackers.heroes).every((item) => item.isDead);
			if (isAllDead) {
				return {
					hp: -1e300,
					energy: -1e300,
					losses: Object.keys(result.battleData.attackers),
				};
			}

			let initialHP = 0;
			let initialEnergy = 0;
			const beforeTitans = result.battleData.attackers;
			for (let titanId in beforeTitans) {
				const titan = beforeTitans[titanId];
				const state = titan.state;
				if (state) {
					initialHP += state.hp / titan.hp;
					initialEnergy += state.energy / 1e3;
				}
			}

			let afterHP = 0;
			let afterEnergy = 0;
			const afterTitans = result.progress[0].attackers.heroes;
			for (let titanId in afterTitans) {
				const titan = afterTitans[titanId];
				afterHP += titan.hp / beforeTitans[titanId].hp;
				afterEnergy += titan.energy / 1e3;
			}

			const beforeIds = Object.keys(beforeTitans);
			const afterIds = Object.keys(afterTitans);
			const losses = beforeIds.filter((key) => !afterIds.includes(key));

			const hp = afterHP - initialHP;
			const energy = afterEnergy - initialEnergy;

			if (!afterIds.length || (hp <= 0 && energy <= 0 && !result.result.win)) {
				return {
					hp: -1e300,
					energy: -1e300,
					losses,
				};
			}

			return {
				hp,
				energy,
				losses,
			};
		}
		static isRandomPack(pack) {
			const ids = Object.values(pack).map((e) => +e.id);
			return ids.includes(4023) || ids.includes(4021);
		}

		static isRandomBattle(battle) {
			return DungeonUtils.isRandomPack(battle.attackers) || DungeonUtils.isRandomPack(battle.defenders[0]);
		}


		static compareScore(newScore, lastScore) {
			const newHp = truncateTo2Decimals(newScore.hp);
			const lastHp = truncateTo2Decimals(lastScore.hp);
			if (newHp > lastHp) {
				return true;
			}

			if (newHp === lastHp) {
				return newScore.energy >= lastScore.energy;
			}

			return false;
		}

		static titanObjToArray(obj) {
			return Object.entries(obj).map(([id, data]) => ({ id, ...data }));
		}

		static getTitanTeam(titans, type) {
			if (type === 'neutral') {
				return DungeonUtils.getNeutralTeam(titans);
			}

			const indexMap = { water: '0', fire: '1', earth: '2' };
			const index = indexMap[type];
			return titans.filter((e) => e.id.toString().slice(2, 3) === index).map((e) => e.id);
		}

		static getNeutralTeam(titans, states = {}) {
			return DungeonUtils.fixTitanTeam(titans, states)
				.sort((a, b) => b.power - a.power)
				.slice(0, 5)
				.map((e) => e.id);
		}

		static fixTitanTeam(titans, states = {}) {
			return titans.filter((titan) => {
				const id = titan.id ?? titan;
				return !states[id]?.isDead;
			});
		}

		static genBattleSeed() {
			return Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1e9);
		}
	}
})();
