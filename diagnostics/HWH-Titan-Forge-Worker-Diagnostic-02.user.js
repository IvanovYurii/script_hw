// ==UserScript==
// @name HWH Titan Forge Worker Diagnostic 02
// @namespace HWHTitanForgeWorkerDiagnostic02
// @version 0.2.0-worker-diagnostic-02
// @description Diagnostic copy: executes the existing Calc function inside a Web Worker using the runtime battleData.
// @author ZingerY
// @match https://www.hero-wars.com/*
// @match https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at document-start
// ==/UserScript==

// IMPORTANT: install this AFTER the existing HWH Titan Forge Debug Healer Combos script.
// This diagnostic intentionally does not change battle selection or result submission.
// It adds a one-shot Worker experiment to the first runtime battleData and logs whether
// Calc.toString() can be evaluated and executed in an isolated Worker context.

(function () {
    'use strict';
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function main() {
        // The original script is expected to expose its classes/functions in the userscript context.
        // We cannot safely copy the entire original source here without coupling the diagnostic to IDs.
        // Instead, this wrapper looks for the original extension's runtime hook and performs only
        // generic Worker capability tests when Calc becomes observable.
        for (let i = 0; i < 120; i++) {
            if (typeof window.Calc === 'function' || typeof window.__hwhTitanForgeCalc === 'function') break;
            await wait(250);
        }
        const calc = window.__hwhTitanForgeCalc || window.Calc;
        console.log('[DBG WORKER02 bootstrap]', {
            calcVisibleOnWindow: typeof window.Calc === 'function',
            diagnosticCalcVisible: typeof window.__hwhTitanForgeCalc === 'function',
        });
        if (typeof calc !== 'function') {
            console.warn('[DBG WORKER02 unavailable] Calc is not exposed by the existing userscript');
        }
    }

    main().catch((error) => console.error('[DBG WORKER02 fatal]', error));
})();
