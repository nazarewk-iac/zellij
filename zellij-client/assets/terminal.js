import { build_link_handler } from "./links.js";
import { isMobileViewport } from "./utils.js";

export const NATURAL_MIN_TOTAL_ROWS = 25;
export const MOBILE_LEGIBLE_FLOOR_PX = 16;

// drawImage on a composited WebGL canvas returns blank pixels unless
// preserveDrawingBuffer is set (needed by the pinch overlay snapshot); this must
// run before xterm.js's WebglAddon creates its context.
function ensurePreserveDrawingBuffer() {
    if (window.__zjPreserveDrawingBuffer) return;
    window.__zjPreserveDrawingBuffer = true;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, options) {
        if (type === "webgl" || type === "webgl2") {
            options = Object.assign({}, options || {}, {
                preserveDrawingBuffer: true,
            });
        }
        return orig.call(this, type, options);
    };
}

export function terminalConfigOptions(config) {
    const options = {};
    if (!config) {
        return options;
    }
    if (typeof config.font === "string" && config.font !== "") {
        options.fontFamily = config.font;
    }
    if (config.theme) {
        options.theme = config.theme;
    }
    if (typeof config.cursor_blink !== "undefined") {
        options.cursorBlink = config.cursor_blink;
    }
    if (typeof config.mac_option_is_meta !== "undefined") {
        options.macOptionIsMeta = config.mac_option_is_meta;
    }
    if (typeof config.cursor_style !== "undefined") {
        options.cursorStyle = config.cursor_style;
    }
    if (typeof config.cursor_inactive_style !== "undefined") {
        options.cursorInactiveStyle = config.cursor_inactive_style;
    }
    return options;
}

export function applyTerminalBackground(config) {
    const background = (config && config.theme && config.theme.background) || null;
    const body = document.querySelector("body");
    if (body) {
        body.style.background = background || "black";
    }
    const terminal = document.getElementById("terminal");
    if (terminal) {
        terminal.style.background = background;
    }
}

// Per-browser font size, written by the pinch gesture and by the mobile menu. It survives a
// reload, so a device can be tuned without touching the server config.
export const FONT_SIZE_STORAGE_KEY = "zellij:font-size";

export function storedFontSize() {
    try {
        const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
        if (raw === null) return null;
        const value = Number(raw);
        return value > 0 ? clampFontSize(value) : null;
    } catch (e) {
        return null;
    }
}

export function storeFontSize(px) {
    try {
        if (px === null || px === undefined) {
            localStorage.removeItem(FONT_SIZE_STORAGE_KEY);
            return;
        }
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clampFontSize(px)));
    } catch (e) {
    }
}

// `mobile_font_device_px` names a size in DEVICE pixels per em, so the browser's
// `devicePixelRatio` turns it into the CSS pixels xterm wants: a 3x phone gets one third of the
// number, a 1.5x phone two thirds. That keeps glyph sharpness constant across screens whose CSS
// pixel is already density-independent, and it makes the text physically larger where the panel
// is coarser. It wins over `mobile_font_size`, which is a fixed CSS size.
export function configFontSize(config, mobileViewport) {
    const fontSize = config ? config.font_size : undefined;
    const mobileFontSize = config ? config.mobile_font_size : undefined;
    const devicePx = config ? config.mobile_font_device_px : undefined;
    const hasExplicitFontSize = typeof fontSize === "number" && fontSize > 0;
    const hasExplicitMobileFontSize =
        typeof mobileFontSize === "number" && mobileFontSize > 0;
    const hasDevicePx = typeof devicePx === "number" && devicePx > 0;
    if (mobileViewport) {
        if (hasDevicePx) {
            const dpr = window.devicePixelRatio || 1;
            return { px: clampFontSize(devicePx / dpr), explicit: true };
        }
        if (hasExplicitMobileFontSize) {
            return { px: mobileFontSize, explicit: true };
        }
    }
    if (hasExplicitFontSize) {
        return { px: fontSize, explicit: true };
    }
    return { px: mobileViewport ? 24 : 12, explicit: false };
}

export function settleFontSize(term, fitAddon, config) {
    const mobileViewport = isMobileViewport();
    const configured = configFontSize(config, mobileViewport);
    // The menu's "Reset" returns to this, whatever the config said.
    window.__zjDefaultFontSize = configured.px;
    const stored = storedFontSize();
    const baseFontPx = stored !== null ? stored : configured.px;
    applyFontSize(term, fitAddon, baseFontPx);
    const needsMobileDownscale =
        stored === null &&
        !configured.explicit &&
        mobileViewport &&
        term.rows < NATURAL_MIN_TOTAL_ROWS;
    if (needsMobileDownscale) {
        const downscaledPx = Math.max(
            Math.floor((baseFontPx * term.rows) / NATURAL_MIN_TOTAL_ROWS),
            MOBILE_LEGIBLE_FLOOR_PX
        );
        if (downscaledPx < baseFontPx) {
            applyFontSize(term, fitAddon, downscaledPx);
        }
    }
    applyTerminalBackground(config);
}

export function initTerminal(config) {
    ensurePreserveDrawingBuffer();
    const term = new Terminal(
        Object.assign(
            {
                fontFamily: "Monospace",
                allowProposedApi: true,
                scrollback: 0,
            },
            terminalConfigOptions(config)
        )
    );
    window.term = term;
    const fitAddon = new FitAddon.FitAddon();
    const clipboardAddon = new ClipboardAddon.ClipboardAddon();

    const { linkHandler, activateLink } = build_link_handler();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon(
        activateLink,
        linkHandler
    );
    term.options.linkHandler = linkHandler;

    const webglAddon = new WebglAddon.WebglAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(clipboardAddon);
    term.loadAddon(webLinksAddon);
    webglAddon.onContextLoss((e) => {
        webglAddon.dispose();
    });
    term.loadAddon(webglAddon);
    term.open(document.getElementById("terminal"));
    term.focus();
    return { term, fitAddon };
}

export const MIN_FONT_SIZE_PX = 6;
export const MAX_FONT_SIZE_PX = 96;

export function applyFontSize(term, fitAddon, requestedPx) {
    const requested =
        typeof requestedPx === "number" && requestedPx > 0
            ? requestedPx
            : term.options.fontSize || 12;
    const effective = clampFontSize(requested);
    if (term.options.fontSize !== effective) {
        term.options.fontSize = effective;
    }
    try {
        fitAddon.fit();
    } catch (e) {
    }
}

export function clampFontSize(px) {
    const n = Math.round(Number(px) || 0);
    if (n < MIN_FONT_SIZE_PX) return MIN_FONT_SIZE_PX;
    if (n > MAX_FONT_SIZE_PX) return MAX_FONT_SIZE_PX;
    return n;
}
