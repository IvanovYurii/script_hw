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
			let fixedBattleMs = 0;
			if (this.isFixedBattle) {
				const fixStartedAt = performance.now();
				const dfb = new UpdateDungeonFixBattle(battleData);
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
